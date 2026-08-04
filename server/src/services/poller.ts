import { EventEmitter } from 'node:events';
import { env } from '../env.js';
import { logger } from '../logger.js';
import * as docker from './docker.js';
import { history } from './metrics.js';
import { getServerStatus, type ServerStatus } from './q3protocol.js';
import { cvarMap, readConfig } from './serverConfig.js';

/**
 * Single background poller feeding every connected client.
 *
 * Polling once centrally — rather than per HTTP request or per WebSocket —
 * keeps load on the game server constant no matter how many browser tabs are
 * open. A busy ET server answering a getstatus flood is a real problem; this
 * design makes it impossible.
 */

export interface Snapshot {
  updatedAt: string;
  game: {
    container: docker.ContainerState;
    resources: docker.ResourceSample | null;
    status: ServerStatus;
  };
  fastdl: {
    container: docker.ContainerState;
    /** Reflects sv_wwwDownload in the live config, not just container state. */
    configured: boolean;
    baseUrl: string;
  };
  docker: { ok: boolean; error?: string };
}

const target = {
  host: env.ETL_HOST,
  port: env.ETL_PORT,
  timeoutMs: env.RCON_TIMEOUT_MS,
};

class Poller extends EventEmitter {
  private snapshot: Snapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  current(): Snapshot | null {
    return this.snapshot;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), env.POLL_INTERVAL_SEC * 1_000);
    // Do not hold the event loop open just for polling during shutdown.
    this.timer.unref();
    logger.info({ intervalSec: env.POLL_INTERVAL_SEC }, 'status poller started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs a poll immediately, e.g. right after a lifecycle action. */
  async refresh(): Promise<Snapshot | null> {
    await this.tick();
    return this.snapshot;
  }

  private async tick(): Promise<void> {
    // A slow game server must not cause overlapping polls to pile up.
    if (this.running) return;
    this.running = true;

    try {
      const [gameContainer, fastdlContainer, dockerPing] = await Promise.all([
        docker.inspect('game').catch(() => null),
        docker.inspect('fastdl').catch(() => null),
        docker.ping(),
      ]);

      // Skip the UDP query when the container is known to be down — otherwise
      // every poll pays the full timeout for nothing. But when Docker itself is
      // unreachable the container state is *unknown*, not "stopped", so query
      // anyway: a dashboard running without the Docker socket must still report
      // a live game server truthfully rather than declaring it offline on no
      // evidence.
      const containerKnown = gameContainer?.exists ?? false;
      const shouldQuery = containerKnown ? gameContainer!.running : !dockerPing.ok;

      const [status, resources] = await Promise.all([
        shouldQuery
          ? getServerStatus(target)
          : Promise.resolve(offlineStatus('Container is not running')),
        containerKnown && gameContainer!.running ? docker.stats('game') : Promise.resolve(null),
      ]);

      const wwwConfig = await readWwwConfig();

      const snapshot: Snapshot = {
        updatedAt: new Date().toISOString(),
        game: {
          container: gameContainer ?? absent(env.ETL_CONTAINER),
          resources,
          status,
        },
        fastdl: {
          container: fastdlContainer ?? absent(env.FASTDL_CONTAINER),
          configured: wwwConfig.enabled,
          baseUrl: wwwConfig.baseUrl || env.FASTDL_BASE_URL,
        },
        docker: dockerPing.ok
          ? { ok: true }
          : { ok: false, error: dockerPing.error ?? 'Docker daemon unreachable' },
      };

      this.snapshot = snapshot;

      history.push({
        t: Date.now(),
        players: status.players.length,
        maxPlayers: status.maxClients,
        cpuPercent: resources?.cpuPercent ?? 0,
        memoryBytes: resources?.memoryBytes ?? 0,
        online: status.online,
        map: status.map,
      });

      this.emit('snapshot', snapshot);
    } catch (err) {
      logger.error({ err }, 'poll failed');
    } finally {
      this.running = false;
    }
  }
}

function absent(name: string): docker.ContainerState {
  return {
    name,
    exists: false,
    status: 'absent',
    running: false,
    health: 'none',
    startedAt: null,
    uptimeSec: null,
    restartCount: 0,
    image: '',
    exitCode: null,
  };
}

function offlineStatus(reason: string): ServerStatus {
  return {
    online: false,
    latencyMs: null,
    hostname: '',
    hostnameClean: '',
    map: '',
    gametype: '',
    players: [],
    maxClients: 0,
    privateClients: 0,
    needPass: false,
    version: '',
    mod: '',
    raw: {},
    error: reason,
  };
}

async function readWwwConfig(): Promise<{ enabled: boolean; baseUrl: string }> {
  try {
    const { content } = await readConfig();
    const cvars = cvarMap(content);
    return {
      enabled: cvars.sv_wwwdownload === '1',
      baseUrl: cvars.sv_wwwbaseurl ?? '',
    };
  } catch {
    // No config yet is a normal first-run state, not an error.
    return { enabled: false, baseUrl: '' };
  }
}

export const poller = new Poller();
