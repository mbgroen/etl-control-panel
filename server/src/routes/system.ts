import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { asyncHandler } from '../http/errors.js';
import * as docker from '../services/docker.js';
import { rcon, RconError } from '../services/q3protocol.js';
import { resolveRconPassword } from '../services/rconCredentials.js';
import { configExists, CONFIG_PATH } from '../services/serverConfig.js';

const rconTarget = { host: env.ETL_HOST, port: env.ETL_PORT, timeoutMs: env.RCON_TIMEOUT_MS };

/**
 * The version reported to the UI.
 *
 * npm_package_version is populated only when the process is started by an npm
 * script, and the image runs `node dist/index.js` directly — so it was always
 * undefined and the dashboard showed a hardcoded 1.0.0 whatever was released.
 * Read package.json instead; the Dockerfile copies it beside dist exactly so it
 * is available at run time. Both the compiled and the source layout put it two
 * directories up from here.
 */
const VERSION: string = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const parsed: unknown = JSON.parse(
      readFileSync(path.resolve(here, '../../package.json'), 'utf8'),
    );
    const version = (parsed as { version?: unknown }).version;
    if (typeof version === 'string' && version) return version;
  } catch {
    /* fall through — a missing package.json must not stop the server booting */
  }
  return 'unknown';
})();

interface RconCheck {
  ok: boolean;
  detail: string;
  remedy: string | null;
}

/**
 * Proves the rcon credential works, rather than that one exists.
 *
 * Checking only whether a password is set answers the wrong question: the
 * failure operators actually hit is a password that is present but no longer
 * matches the running server. That reported "Configured" while every console
 * command failed, which is worse than no check at all.
 */
async function checkRcon(): Promise<RconCheck> {
  const credential = await resolveRconPassword();

  if (credential.source === 'none') {
    return {
      ok: false,
      detail: 'Not set — console and player admin are disabled',
      remedy:
        'Set rconpassword on the Configuration page. The dashboard picks it up straight away; no restart and no environment variable needed.',
    };
  }

  const from = credential.source === 'config' ? 'the server config' : 'RCON_PASSWORD';
  const ignored = credential.environmentIgnored
    ? ' RCON_PASSWORD is also set to a different value and is being ignored — remove it to avoid confusion.'
    : '';

  try {
    await rcon(rconTarget, credential.password, 'serverinfo');
    return { ok: true, detail: `Authenticated using ${from}.${ignored}`, remedy: null };
  } catch (err) {
    if (err instanceof RconError && err.kind === 'bad-password') {
      return {
        ok: false,
        detail: `The running server rejected the password from ${from}.`,
        remedy:
          'The running server still holds an older password. Restart the game server so it re-reads the config, then check again.',
      };
    }
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'RCON check failed',
      remedy: 'Confirm the game server is running and reachable from the dashboard container.',
    };
  }
}

export const systemRouter = Router();

/**
 * Diagnostics for the "is this thing wired up correctly?" question.
 *
 * Every dependency the dashboard needs is checked here and reported with a
 * remedy, because the failure modes (socket not mounted, wrong data path,
 * missing rcon password) all look identical from the UI otherwise: nothing
 * works and no error says why.
 */
systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [dockerPing, gameContainer, fastdlContainer, hasConfig, rconCheck] = await Promise.all([
      docker.ping(),
      docker.inspect('game').catch(() => null),
      docker.inspect('fastdl').catch(() => null),
      configExists(),
      checkRcon(),
    ]);

    const checks = [
      {
        id: 'docker',
        label: 'Docker socket',
        ok: dockerPing.ok,
        detail: dockerPing.ok
          ? `Connected to Docker ${dockerPing.version}`
          : (dockerPing.error ?? 'Unreachable'),
        remedy: dockerPing.ok
          ? null
          : `Mount the socket into the dashboard container: -v ${env.DOCKER_SOCKET}:${env.DOCKER_SOCKET}`,
      },
      {
        id: 'game_container',
        label: 'Game server container',
        ok: Boolean(gameContainer?.exists),
        detail: gameContainer?.exists
          ? `"${gameContainer.name}" is ${gameContainer.status}`
          : `No container named "${env.ETL_CONTAINER}"`,
        remedy: gameContainer?.exists
          ? null
          : 'Check ETL_CONTAINER matches the container_name in your compose file.',
      },
      {
        id: 'config',
        label: 'Server configuration file',
        ok: hasConfig,
        detail: hasConfig ? CONFIG_PATH : `Not found at ${CONFIG_PATH}`,
        remedy: hasConfig
          ? null
          : 'Ensure ETMAIN_PATH points at the same host directory the game server mounts as /legacy/server/etmain.',
      },
      {
        id: 'rcon',
        label: 'RCON credentials',
        ok: rconCheck.ok,
        detail: rconCheck.detail,
        remedy: rconCheck.remedy,
      },
      {
        id: 'fastdl_container',
        label: 'FastDL container',
        ok: Boolean(fastdlContainer?.exists),
        detail: fastdlContainer?.exists
          ? `"${fastdlContainer.name}" is ${fastdlContainer.status}`
          : `No container named "${env.FASTDL_CONTAINER}" (optional)`,
        remedy: fastdlContainer?.exists
          ? null
          : 'Only needed if you want HTTP downloads. Run "docker compose up -d" to create it.',
        optional: true,
      },
    ];

    const degraded = checks.some((c) => !c.ok && !('optional' in c && c.optional));
    res.status(degraded ? 503 : 200).json({ status: degraded ? 'degraded' : 'ok', checks });
  }),
);

/** Non-secret runtime configuration, so the UI can label paths and ports. */
systemRouter.get(
  '/info',
  asyncHandler(async (_req, res) => {
    const credential = await resolveRconPassword();
    res.json({
      version: VERSION,
      gameServer: { host: env.ETL_HOST, port: env.ETL_PORT, container: env.ETL_CONTAINER },
      fastdl: { container: env.FASTDL_CONTAINER, suggestedBaseUrl: env.FASTDL_BASE_URL },
      paths: { etmain: env.ETMAIN_PATH, legacy: env.LEGACY_PATH, config: CONFIG_PATH },
      limits: { maxUploadMb: env.MAX_UPLOAD_MB },
      pollIntervalSec: env.POLL_INTERVAL_SEC,
      rconConfigured: credential.source !== 'none',
      // Which of the two possible sources supplied it, so the UI can say where
      // to change it instead of guessing.
      rconSource: credential.source,
    });
  }),
);

/** Log tail for the initial paint; the live feed arrives over the WebSocket. */
systemRouter.get(
  '/logs/:service',
  asyncHandler(async (req, res) => {
    const service = req.params.service === 'fastdl' ? 'fastdl' : 'game';
    const tail = Math.min(Math.max(Number(req.query.tail ?? 200), 10), 2_000);
    res.json({ service, lines: (await docker.logsSnapshot(service, tail)).split('\n') });
  }),
);
