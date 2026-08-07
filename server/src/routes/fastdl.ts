import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import { logger } from '../logger.js';
import * as docker from '../services/docker.js';
import { baseUrlSchema } from '../services/fastdlUrl.js';
import { listMaps } from '../services/maps.js';
import { poller } from '../services/poller.js';
import {
  applyCvarUpdates,
  cvarMap,
  readConfig,
  saveConfig,
} from '../services/serverConfig.js';

export const fastdlRouter = Router();

/**
 * FastDL (HTTP redirect downloads).
 *
 * Without it, clients pull custom maps over the game's UDP channel at a few
 * hundred KB/s and time out on anything large. With it, the engine fetches
 * `<sv_wwwBaseURL>/<gamedir>/<file>.pk3` over HTTP from the nginx sidecar,
 * which serves the very same etmain directory the game server uses — so there
 * is no mirror to keep in sync.
 *
 * "Enabled" therefore means two things at once, and this module always changes
 * them together: the nginx container is running, *and* the game config has
 * sv_wwwDownload/sv_wwwBaseURL pointing at it. Half-enabled is the state that
 * produces mysterious client-side download failures.
 */

export interface FastdlState {
  container: docker.ContainerState;
  configured: boolean;
  baseUrl: string;
  fileCount: number;
  totalBytes: number;
  /** Result of the last reachability probe, if one has been run. */
  health: { ok: boolean; message: string; checkedAt: string } | null;
}

let lastHealth: FastdlState['health'] = null;

fastdlRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [container, maps, config] = await Promise.all([
      docker.inspect('fastdl'),
      listMaps(),
      readConfig().catch(() => null),
    ]);

    const cvars = config ? cvarMap(config.content) : {};

    const state: FastdlState = {
      container,
      configured: cvars.sv_wwwdownload === '1',
      baseUrl: cvars.sv_wwwbaseurl ?? env.FASTDL_BASE_URL,
      fileCount: maps.length,
      totalBytes: maps.reduce((sum, m) => sum + m.sizeBytes, 0),
      health: lastHealth,
    };

    res.json({
      ...state,
      suggestedBaseUrl: env.FASTDL_BASE_URL,
      containerName: docker.containerNameFor('fastdl'),
    });
  }),
);

const enableSchema = z.object({
  baseUrl: baseUrlSchema,
  /**
   * When true the engine also uses HTTP for clients that disconnect mid-download.
   * Off by default: it is the safer behaviour on flaky home connections.
   */
  allowDisconnectedDownload: z.boolean().default(false),
  reload: z.boolean().default(true),
});

fastdlRouter.post(
  '/enable',
  asyncHandler(async (req, res) => {
    const { baseUrl, allowDisconnectedDownload } = enableSchema.parse(req.body);

    const container = await docker.inspect('fastdl');
    if (!container.exists) {
      throw new ApiError(
        404,
        'container_missing',
        `The "${docker.containerNameFor('fastdl')}" container does not exist. Run "docker compose up -d" so it is created, then enable it here.`,
      );
    }

    if (!container.running) {
      await docker.lifecycle('fastdl', 'start');
    }

    const current = await readConfig();
    const next = applyCvarUpdates(current.content, {
      sv_allowDownload: '1',
      sv_wwwDownload: '1',
      sv_wwwBaseURL: baseUrl,
      sv_wwwDlDisconnected: allowDisconnectedDownload ? '1' : '0',
    });
    const saved = await saveConfig(next, {
      expectedRevision: current.revision,
      note: 'FastDL enabled',
    });

    logger.info({ baseUrl }, 'fastdl enabled');
    await poller.refresh();

    res.json({
      ok: true,
      baseUrl,
      revision: saved.revision,
      backupId: saved.backupId,
      note: 'Restart the game server (or run "exec ' + env.SERVER_CONFIG_NAME + '" in the console) so it picks up the new download settings.',
    });
  }),
);

fastdlRouter.post(
  '/disable',
  asyncHandler(async (req, res) => {
    const { stopContainer } = z
      .object({ stopContainer: z.boolean().default(true) })
      .parse(req.body ?? {});

    const current = await readConfig();
    // sv_allowDownload stays on: clients should still be able to fall back to
    // the slow UDP transfer rather than being unable to join at all.
    const next = applyCvarUpdates(current.content, { sv_wwwDownload: '0' });
    const saved = await saveConfig(next, {
      expectedRevision: current.revision,
      note: 'FastDL disabled',
    });

    if (stopContainer) {
      const container = await docker.inspect('fastdl');
      if (container.running) await docker.lifecycle('fastdl', 'stop');
    }

    logger.info({ stopContainer }, 'fastdl disabled');
    await poller.refresh();
    lastHealth = null;

    res.json({ ok: true, revision: saved.revision, backupId: saved.backupId });
  }),
);

/**
 * End-to-end reachability probe.
 *
 * Fetches a real pk3 through the configured public base URL, exactly as a game
 * client would. Testing the container's own port would prove far less: the
 * common failure is a base URL the clients cannot resolve, not a dead nginx.
 */
fastdlRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    const { baseUrl } = z.object({ baseUrl: baseUrlSchema.optional() }).parse(req.body ?? {});

    const config = await readConfig().catch(() => null);
    const effectiveBase =
      baseUrl ?? (config ? cvarMap(config.content).sv_wwwbaseurl : '') ?? env.FASTDL_BASE_URL;

    if (!effectiveBase) {
      throw new ApiError(400, 'no_base_url', 'Set a FastDL base URL before testing');
    }

    const maps = await listMaps();
    const probe = maps.find((m) => !m.stock) ?? maps[0];
    if (!probe) {
      throw new ApiError(400, 'no_files', 'There are no .pk3 files in etmain to test with');
    }

    const url = `${effectiveBase}/etmain/${encodeURIComponent(probe.filename)}`;
    const result = await probeUrl(url, probe.sizeBytes);

    lastHealth = { ...result, checkedAt: new Date().toISOString() };
    res.json({ ...lastHealth, url, testedFile: probe.filename });
  }),
);

async function probeUrl(url: string, expectedBytes: number): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);

  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });

    if (!response.ok) {
      return {
        ok: false,
        message: `Server responded ${response.status} ${response.statusText}. Check that the FastDL container is running and the URL is reachable from outside the host.`,
      };
    }

    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > 0 && length !== expectedBytes) {
      return {
        ok: false,
        message: `Reachable, but the file size differs (${length} bytes served vs ${expectedBytes} on disk). The web server may be serving a different directory.`,
      };
    }

    return { ok: true, message: 'Clients can download map packages over HTTP.' };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : String(err);
    return {
      ok: false,
      message: `Could not reach ${url} (${reason}). Verify the port is published and any firewall allows it.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
