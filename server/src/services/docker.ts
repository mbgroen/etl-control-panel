import Docker from 'dockerode';
import type { Duplex } from 'node:stream';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Docker control plane.
 *
 * The control panel is given the Docker socket, which is equivalent to root on the
 * host. To keep the blast radius small, every operation in this module is gated
 * through `resolve()`, which refuses to touch any container other than the two
 * this control panel is configured to manage. A compromised session can therefore
 * restart the game server — it cannot spawn a privileged container.
 */
const docker = new Docker({ socketPath: env.DOCKER_SOCKET });

export type ManagedService = 'game' | 'fastdl';

const CONTAINER_NAMES: Record<ManagedService, string> = {
  game: env.ETL_CONTAINER,
  fastdl: env.FASTDL_CONTAINER,
};

export class ContainerNotFoundError extends Error {
  constructor(name: string) {
    super(`Container "${name}" does not exist. Has the compose stack been started?`);
    this.name = 'ContainerNotFoundError';
  }
}

export function containerNameFor(service: ManagedService): string {
  return CONTAINER_NAMES[service];
}

/** Maps a service key to a container handle, rejecting anything unmanaged. */
function resolve(service: ManagedService): Docker.Container {
  const name = CONTAINER_NAMES[service];
  if (!name) throw new Error(`Unknown managed service: ${service}`);
  return docker.getContainer(name);
}

export interface ContainerState {
  name: string;
  exists: boolean;
  /** created | restarting | running | removing | paused | exited | dead */
  status: string;
  running: boolean;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  startedAt: string | null;
  /** Seconds since the container started, or null when not running. */
  uptimeSec: number | null;
  restartCount: number;
  image: string;
  exitCode: number | null;
}

const UNKNOWN_STATE = (name: string): ContainerState => ({
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
});

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === 404;
}

export async function inspect(service: ManagedService): Promise<ContainerState> {
  const name = CONTAINER_NAMES[service];
  try {
    const info = await resolve(service).inspect();
    const startedAt = info.State.StartedAt && !info.State.StartedAt.startsWith('0001-')
      ? info.State.StartedAt
      : null;

    return {
      name,
      exists: true,
      status: info.State.Status,
      running: info.State.Running,
      health: (info.State.Health?.Status as ContainerState['health']) ?? 'none',
      startedAt,
      uptimeSec:
        info.State.Running && startedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
          : null,
      restartCount: info.RestartCount ?? 0,
      image: info.Config.Image ?? '',
      exitCode: info.State.Running ? null : (info.State.ExitCode ?? null),
    };
  } catch (err) {
    if (isNotFound(err)) return UNKNOWN_STATE(name);
    throw err;
  }
}

export type LifecycleAction = 'start' | 'stop' | 'restart';

export async function lifecycle(service: ManagedService, action: LifecycleAction): Promise<void> {
  const container = resolve(service);
  const name = CONTAINER_NAMES[service];
  logger.info({ service, container: name, action }, 'container lifecycle action');

  try {
    switch (action) {
      case 'start':
        await container.start();
        break;
      case 'stop':
        // Generous grace period: ET: Legacy flushes its logs on SIGTERM.
        await container.stop({ t: 15 });
        break;
      case 'restart':
        await container.restart({ t: 15 });
        break;
    }
  } catch (err) {
    if (isNotFound(err)) throw new ContainerNotFoundError(name);
    // 304 means the container was already in the requested state — not an error
    // worth surfacing to the operator, who asked for exactly this outcome.
    if (typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === 304) {
      logger.debug({ service, action }, 'container already in requested state');
      return;
    }
    throw err;
  }
}

export interface ResourceSample {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  netRxBytes: number;
  netTxBytes: number;
}

/**
 * Takes a single (non-streaming) resource sample.
 *
 * Docker's one-shot stats call returns a `precpu_stats` block of zeroes on the
 * very first read for a container, which would compute as either NaN or a wild
 * spike. We clamp that case to 0 rather than publishing a bogus number.
 */
export async function stats(service: ManagedService): Promise<ResourceSample | null> {
  try {
    const raw = (await resolve(service).stats({ stream: false })) as unknown as DockerStats;

    const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - (raw.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const systemDelta = raw.cpu_stats.system_cpu_usage - (raw.precpu_stats?.system_cpu_usage ?? 0);
    const cores = raw.cpu_stats.online_cpus || raw.cpu_stats.cpu_usage.percpu_usage?.length || 1;

    const cpuPercent =
      systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cores * 100 : 0;

    // cache is counted inside usage but is reclaimable; docker stats subtracts it.
    const cache = raw.memory_stats.stats?.inactive_file ?? raw.memory_stats.stats?.cache ?? 0;
    const memoryBytes = Math.max(0, (raw.memory_stats.usage ?? 0) - cache);
    const memoryLimitBytes = raw.memory_stats.limit ?? 0;

    let netRxBytes = 0;
    let netTxBytes = 0;
    for (const iface of Object.values(raw.networks ?? {})) {
      netRxBytes += iface.rx_bytes ?? 0;
      netTxBytes += iface.tx_bytes ?? 0;
    }

    return {
      cpuPercent: Number(cpuPercent.toFixed(2)),
      memoryBytes,
      memoryLimitBytes,
      memoryPercent:
        memoryLimitBytes > 0 ? Number(((memoryBytes / memoryLimitBytes) * 100).toFixed(2)) : 0,
      netRxBytes,
      netTxBytes,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    logger.warn({ err, service }, 'failed to read container stats');
    return null;
  }
}

interface DockerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: { cache?: number; inactive_file?: number };
  };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
}

/** Fetches the tail of a container's logs as plain text. */
export async function logsSnapshot(service: ManagedService, tail = 200): Promise<string> {
  try {
    const buffer = (await resolve(service).logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: false,
    })) as unknown as Buffer;
    return stripTerminalCodes(demultiplex(buffer));
  } catch (err) {
    if (isNotFound(err)) throw new ContainerNotFoundError(CONTAINER_NAMES[service]);
    throw err;
  }
}

/**
 * Opens a follow stream of container logs.
 *
 * The caller owns the returned stream and must destroy it. Output is raw and
 * may be multiplexed — see `demultiplex` for why.
 */
export async function logsStream(service: ManagedService, tail = 100): Promise<Duplex> {
  const container = resolve(service);
  try {
    return (await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail,
      timestamps: false,
    })) as unknown as Duplex;
  } catch (err) {
    if (isNotFound(err)) throw new ContainerNotFoundError(CONTAINER_NAMES[service]);
    throw err;
  }
}

/**
 * Removes terminal escape sequences from log output.
 *
 * The game engine colours its console with ANSI escapes — every player name and
 * every chat line arrives wrapped in them. A browser is not a terminal, so what
 * reaches the log pane is the escape *text*: `<ESC>[0m` renders as a replacement
 * box followed by `[0m`, several times per line, and a readable line like
 * `Harde Henk entered the game` becomes something nobody wants to read.
 *
 * Stripping rather than rendering the colours is deliberate. The pane is a
 * diagnostic tool, and colour here carries no information the words do not: the
 * engine paints names, not severity.
 *
 * Also drops the other C0 control characters (keeping tab), which the engine
 * emits occasionally and which render as more boxes.
 */
export function stripTerminalCodes(text: string): string {
  return (
    text
      // CSI sequences: ESC [ ... final byte. Colours, cursor moves, erases.
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      // OSC sequences (window titles), terminated by BEL or ST.
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
      // Whatever escapes are left, then the rest of the C0 set bar tab and the
      // line endings, which the caller still needs to split on.
      .replace(/\x1B[@-_]?/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  );
}

/**
 * Strips Docker's stream multiplexing headers.
 *
 * Containers started without a TTY get their logs framed in 8-byte headers
 * (stream type + 4-byte big-endian length). Containers *with* a TTY emit raw
 * bytes. We detect the framing per-chunk instead of assuming, because the same
 * control panel may manage containers configured either way.
 */
export function demultiplex(chunk: Buffer): string {
  let offset = 0;
  const parts: string[] = [];

  while (offset < chunk.length) {
    const streamType = chunk[offset];
    // A valid header starts with 0..2 followed by three zero bytes.
    const looksFramed =
      offset + 8 <= chunk.length &&
      streamType !== undefined &&
      streamType <= 2 &&
      chunk[offset + 1] === 0 &&
      chunk[offset + 2] === 0 &&
      chunk[offset + 3] === 0;

    if (!looksFramed) {
      parts.push(chunk.subarray(offset).toString('utf8'));
      break;
    }

    const length = chunk.readUInt32BE(offset + 4);
    parts.push(chunk.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    offset += 8 + length;
  }

  return parts.join('');
}

/** Verifies the control panel can actually talk to the Docker daemon. */
export async function ping(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const version = await docker.version();
    return { ok: true, version: version.Version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
