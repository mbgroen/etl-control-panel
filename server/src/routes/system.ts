import { Router } from 'express';
import { env } from '../env.js';
import { asyncHandler } from '../http/errors.js';
import * as docker from '../services/docker.js';
import { configExists, CONFIG_PATH } from '../services/serverConfig.js';

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
    const [dockerPing, gameContainer, fastdlContainer, hasConfig] = await Promise.all([
      docker.ping(),
      docker.inspect('game').catch(() => null),
      docker.inspect('fastdl').catch(() => null),
      configExists(),
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
        ok: env.RCON_PASSWORD !== '',
        detail: env.RCON_PASSWORD ? 'Configured' : 'Not set — console and player admin are disabled',
        remedy: env.RCON_PASSWORD
          ? null
          : 'Set RCON_PASSWORD in the dashboard environment to match rconpassword in the server config.',
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
systemRouter.get('/info', (_req, res) => {
  res.json({
    version: process.env.npm_package_version ?? '1.0.0',
    gameServer: { host: env.ETL_HOST, port: env.ETL_PORT, container: env.ETL_CONTAINER },
    fastdl: { container: env.FASTDL_CONTAINER, suggestedBaseUrl: env.FASTDL_BASE_URL },
    paths: { etmain: env.ETMAIN_PATH, legacy: env.LEGACY_PATH, config: CONFIG_PATH },
    limits: { maxUploadMb: env.MAX_UPLOAD_MB },
    pollIntervalSec: env.POLL_INTERVAL_SEC,
    rconConfigured: env.RCON_PASSWORD !== '',
  });
});

/** Log tail for the initial paint; the live feed arrives over the WebSocket. */
systemRouter.get(
  '/logs/:service',
  asyncHandler(async (req, res) => {
    const service = req.params.service === 'fastdl' ? 'fastdl' : 'game';
    const tail = Math.min(Math.max(Number(req.query.tail ?? 200), 10), 2_000);
    res.json({ service, lines: (await docker.logsSnapshot(service, tail)).split('\n') });
  }),
);
