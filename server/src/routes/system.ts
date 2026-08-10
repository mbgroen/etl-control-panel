import { Router } from 'express';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { asyncHandler } from '../http/errors.js';
import * as docker from '../services/docker.js';
import {
  MAX_BACKUPS_CEILING,
  MAX_HISTORY_CEILING,
  MAX_UPLOAD_MB_CEILING,
  MIN_BACKUPS,
  MIN_HISTORY,
  MIN_UPLOAD_MB,
  readSettings,
  writeSettings,
} from '../services/controlPanelSettings.js';
import { rcon, RconError } from '../services/q3protocol.js';
import { resolveRconPassword } from '../services/rconCredentials.js';
import { configExists, CONFIG_PATH } from '../services/serverConfig.js';

const rconTarget = { host: env.ETL_HOST, port: env.ETL_PORT, timeoutMs: env.RCON_TIMEOUT_MS };

/**
 * The version reported to the UI.
 *
 * npm_package_version is populated only when the process is started by an npm
 * script, and the image runs `node dist/index.js` directly — so it was always
 * undefined and the control panel showed a hardcoded 1.0.0 whatever was released.
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
        'Set rconpassword on the Configuration page. The control panel picks it up straight away; no restart and no environment variable needed.',
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
      remedy: 'Confirm the game server is running and reachable from the control panel container.',
    };
  }
}

/**
 * Can the game server write to its own home directory?
 *
 * It keeps the XP database, the game and attack logs and its archived cvars
 * there. The directory is bind-mounted from the host, so Docker creates it
 * owned by root while the game server runs as uid 1000 — it then cannot write,
 * says nothing about it, and the first anyone knows is that a week of saved XP
 * was never saved. Cheap to check, miserable to discover.
 */
async function checkServerHome(): Promise<{ ok: boolean; detail: string; remedy: string | null }> {
  const dir = env.SERVER_HOME_PATH;
  const advice = `Create it and give it to the server's user: mkdir -p <data>/etl-server/homepath && chown -R ${SERVER_UID}:${SERVER_UID} <data>/etl-server/homepath`;

  try {
    const info = await stat(dir);
    if (!info.isDirectory()) {
      return { ok: false, detail: `${dir} exists but is not a directory`, remedy: advice };
    }

    // The control panel runs as root, so it can always write there itself —
    // the question is whether uid 1000 can, which is what the mode and owner
    // say. Anything world-writable is fine too.
    const mode = info.mode & 0o777;
    const writable = info.uid === SERVER_UID || (mode & 0o002) !== 0;

    return writable
      ? { ok: true, detail: `${dir} — writable by the game server`, remedy: null }
      : {
          ok: false,
          detail: `${dir} is owned by uid ${info.uid}, and the game server runs as uid ${SERVER_UID}`,
          remedy: advice,
        };
  } catch {
    return {
      ok: false,
      detail: `${dir} does not exist, so the XP database and logs are not being kept`,
      remedy: advice,
    };
  }
}

/** The uid the official etlegacy/server image runs as. */
const SERVER_UID = 1000;

export const systemRouter = Router();

/**
 * Diagnostics for the "is this thing wired up correctly?" question.
 *
 * Every dependency the control panel needs is checked here and reported with a
 * remedy, because the failure modes (socket not mounted, wrong data path,
 * missing rcon password) all look identical from the UI otherwise: nothing
 * works and no error says why.
 */
systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [dockerPing, gameContainer, fastdlContainer, hasConfig, rconCheck, home] =
      await Promise.all([
        docker.ping(),
        docker.inspect('game').catch(() => null),
        docker.inspect('fastdl').catch(() => null),
        configExists(),
        checkRcon(),
        checkServerHome(),
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
          : `Mount the socket into the control panel container: -v ${env.DOCKER_SOCKET}:${env.DOCKER_SOCKET}`,
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
        id: 'server_home',
        label: 'Game server home directory',
        ok: home.ok,
        detail: home.detail,
        remedy: home.remedy,
        optional: true,
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

    // Deliberately 200 even when degraded. The *request* succeeded — a report
    // of what is broken is exactly what this endpoint is for, and answering
    // 503 made clients treat the report itself as a failure and discard it,
    // blanking the one page that could explain the problem. The payload's
    // `status` carries the health; the HTTP status carries whether the call
    // worked. (The unauthenticated /healthz probe is what container
    // orchestration watches, and it is unaffected by this.)
    res.json({ status: degraded ? 'degraded' : 'ok', checks });
  }),
);

/** Non-secret runtime configuration, so the UI can label paths and ports. */
systemRouter.get(
  '/info',
  asyncHandler(async (_req, res) => {
    const [credential, settings] = await Promise.all([resolveRconPassword(), readSettings()]);
    res.json({
      version: VERSION,
      gameServer: { host: env.ETL_HOST, port: env.ETL_PORT, container: env.ETL_CONTAINER },
      fastdl: { container: env.FASTDL_CONTAINER, suggestedBaseUrl: env.FASTDL_BASE_URL },
      paths: { etmain: env.ETMAIN_PATH, legacy: env.LEGACY_PATH, config: CONFIG_PATH },
      limits: { maxUploadMb: settings.maxUploadMb, maxUploadMbCeiling: MAX_UPLOAD_MB_CEILING },
      pollIntervalSec: env.POLL_INTERVAL_SEC,
      rconConfigured: credential.source !== 'none',
      // Which of the two possible sources supplied it, so the UI can say where
      // to change it instead of guessing.
      rconSource: credential.source,
    });
  }),
);

/**
 * Control panel preferences.
 *
 * Separate from /config, which owns the game server's cvar file. These are the
 * control panel's own settings and are stored in its state directory, so restoring
 * an old server-config backup cannot change them.
 */
systemRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await readSettings();
    res.json({ ...settings, limits: {
        minUploadMb: MIN_UPLOAD_MB,
        maxUploadMb: MAX_UPLOAD_MB_CEILING,
        minBackups: MIN_BACKUPS,
        maxBackups: MAX_BACKUPS_CEILING,
        minPlayerSessions: MIN_HISTORY,
        maxPlayerSessions: MAX_HISTORY_CEILING,
      } });
  }),
);

const settingsSchema = z.object({
  maxUploadMb: z.coerce
    .number()
    .int('Whole megabytes only')
    .min(MIN_UPLOAD_MB, `Must be at least ${MIN_UPLOAD_MB} MB`)
    .max(MAX_UPLOAD_MB_CEILING, `Must be ${MAX_UPLOAD_MB_CEILING} MB or less`),
  maxBackups: z.coerce
    .number()
    .int('Whole backups only')
    .min(MIN_BACKUPS, `Keep at least ${MIN_BACKUPS}`)
    .max(MAX_BACKUPS_CEILING, `Keep ${MAX_BACKUPS_CEILING} or fewer`),
  maxPlayerSessions: z.coerce
    .number()
    .int('Whole visits only')
    .min(MIN_HISTORY, `Keep at least ${MIN_HISTORY}`)
    .max(MAX_HISTORY_CEILING, `Keep ${MAX_HISTORY_CEILING} or fewer`),
});

systemRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const settings = await writeSettings(settingsSchema.parse(req.body));
    res.json({ ...settings, limits: {
        minUploadMb: MIN_UPLOAD_MB,
        maxUploadMb: MAX_UPLOAD_MB_CEILING,
        minBackups: MIN_BACKUPS,
        maxBackups: MAX_BACKUPS_CEILING,
        minPlayerSessions: MIN_HISTORY,
        maxPlayerSessions: MAX_HISTORY_CEILING,
      } });
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

/**
 * The same tail as a file.
 *
 * A log you can only read in a browser pane is a log you cannot attach to a bug
 * report, diff against yesterday's, or grep. The tail is deeper than the live
 * pane keeps in memory, because the reason to save a log is usually something
 * that happened before you thought to look.
 */
systemRouter.get(
  '/logs/:service/download',
  asyncHandler(async (req, res) => {
    const service = req.params.service === 'fastdl' ? 'fastdl' : 'game';
    const tail = Math.min(Math.max(Number(req.query.tail ?? 5_000), 10), 20_000);
    const text = await docker.logsSnapshot(service, tail);

    // Colons are legal in a filename on Linux and a nuisance everywhere else.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const name = `${docker.containerNameFor(service)}-${stamp}.log`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(text.endsWith('\n') ? text : `${text}\n`);
  }),
);
