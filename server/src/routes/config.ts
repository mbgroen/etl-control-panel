import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import { logger } from '../logger.js';
import { DEFAULT_SERVER_CONFIG } from '../services/defaultConfig.js';
import { poller } from '../services/poller.js';
import { rcon } from '../services/q3protocol.js';
import { canSendAsRconArgument, resolveRconPassword } from '../services/rconCredentials.js';
import {
  applyCvarUpdates,
  buildRotation,
  configExists,
  CONFIG_PATH,
  cvarMap,
  deleteBackup,
  listBackups,
  maskSecrets,
  MASK,
  parseCvars,
  parseRotation,
  readBackup,
  readConfig,
  saveConfig,
  validateConfig,
} from '../services/serverConfig.js';

export const configRouter = Router();

const target = { host: env.ETL_HOST, port: env.ETL_PORT, timeoutMs: env.RCON_TIMEOUT_MS };

configRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    if (!(await configExists())) {
      throw new ApiError(
        404,
        'config_missing',
        `No ${env.SERVER_CONFIG_NAME} found in ${env.ETMAIN_PATH}. Copy the example config there to get started.`,
      );
    }

    const snapshot = await readConfig();
    res.json({
      ...snapshot,
      cvars: maskSecrets(parseCvars(snapshot.content)),
      rotation: parseRotation(snapshot.content),
      problems: validateConfig(snapshot.content),
    });
  }),
);

/**
 * Writes a starter config when none exists.
 *
 * Completes the WebUI-only install: without this, a fresh deployment leaves the
 * operator needing shell access just to place a file. Refuses to overwrite,
 * so it can never clobber an existing configuration.
 */
configRouter.post(
  '/initialize',
  asyncHandler(async (_req, res) => {
    if (await configExists()) {
      throw new ApiError(
        409,
        'config_exists',
        'A configuration file already exists — edit it instead of recreating it.',
      );
    }

    const result = await saveConfig(DEFAULT_SERVER_CONFIG, {
      note: 'Default configuration created',
      force: true,
    });

    res.status(201).json({ ...result, path: CONFIG_PATH });
  }),
);

const saveSchema = z.object({
  content: z.string().max(1_000_000),
  expectedRevision: z.string().optional(),
  note: z.string().max(200).optional(),
  force: z.boolean().default(false),
  /** Ask the running server to re-exec the config after a successful write. */
  reload: z.boolean().default(false),
});

configRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { content, expectedRevision, note, force, reload } = saveSchema.parse(req.body);

    // Captured before the write so the old password is still available to
    // authenticate the handover below.
    const previous = await readConfig().catch(() => null);

    const result = await saveConfig(content, { expectedRevision, note, force });
    const rconPassword = previous ? await handOverRconPassword(previous.content, content) : null;
    const reloaded = reload ? await reloadServerConfig() : null;

    res.json({ ...result, reloaded, rconPassword });
  }),
);

/**
 * Structured edit path used by the settings forms.
 *
 * Secrets arrive masked when the operator did not change them; those keys are
 * dropped so an untouched password field cannot overwrite the real value with
 * a row of bullets.
 */
const patchSchema = z.object({
  updates: z.record(z.string().max(1_024)),
  expectedRevision: z.string().optional(),
  reload: z.boolean().default(false),
});

configRouter.patch(
  '/cvars',
  asyncHandler(async (req, res) => {
    const { updates, expectedRevision, reload } = patchSchema.parse(req.body);

    const effective = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== MASK),
    );
    if (Object.keys(effective).length === 0) {
      throw new ApiError(400, 'no_changes', 'No changes to apply');
    }

    const current = await readConfig();
    const next = applyCvarUpdates(current.content, effective);
    const result = await saveConfig(next, {
      expectedRevision: expectedRevision ?? current.revision,
      note: `Updated ${Object.keys(effective).join(', ')}`,
    });

    // Before the reload, so the running server is already on the new password
    // when the config is re-exec'd rather than being locked out by it.
    const rconPassword = await handOverRconPassword(current.content, next);
    const reloaded = reload ? await reloadServerConfig() : null;
    await poller.refresh();

    res.json({ ...result, applied: Object.keys(effective), reloaded, rconPassword });
  }),
);

const rotationSchema = z.object({
  maps: z
    .array(z.string().regex(/^[A-Za-z0-9_\-]{1,64}$/, 'Invalid map name'))
    .max(64),
  expectedRevision: z.string().optional(),
});

/**
 * Appends maps to the rotation without replacing it.
 *
 * The Maps page needs "add this one" rather than "here is the whole list
 * again": rebuilding the full rotation from a screen that does not show it
 * would mean the caller having to fetch, merge and resend it just to add one
 * entry, with a lost update waiting in the gap.
 */
configRouter.post(
  '/rotation/add',
  asyncHandler(async (req, res) => {
    const { maps } = z
      .object({
        maps: z
          .array(z.string().regex(/^[A-Za-z0-9_\-]{1,64}$/, 'Invalid map name'))
          .min(1)
          .max(64),
      })
      .parse(req.body);

    const current = await readConfig();
    const existing = parseRotation(current.content).map((entry) => entry.map);
    // Already-present maps are dropped rather than rejected: adding a map twice
    // is a mistake, not an error worth stopping the whole request for.
    const additions = maps.filter((map) => !existing.includes(map));

    if (additions.length === 0) {
      res.json({ added: [], rotation: parseRotation(current.content), alreadyPresent: maps });
      return;
    }

    const next = buildRotation(current.content, [...existing, ...additions]);
    const result = await saveConfig(next, {
      expectedRevision: current.revision,
      note: `Added ${additions.join(', ')} to the rotation`,
    });

    res.json({
      ...result,
      added: additions,
      alreadyPresent: maps.filter((map) => existing.includes(map)),
      rotation: parseRotation(next),
    });
  }),
);

configRouter.put(
  '/rotation',
  asyncHandler(async (req, res) => {
    const { maps, expectedRevision } = rotationSchema.parse(req.body);
    const current = await readConfig();
    const next = buildRotation(current.content, maps);

    const result = await saveConfig(next, {
      expectedRevision: expectedRevision ?? current.revision,
      note: `Rotation set to ${maps.length} map(s)`,
    });

    res.json({ ...result, rotation: parseRotation(next) });
  }),
);

configRouter.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const { content } = z.object({ content: z.string().max(1_000_000) }).parse(req.body);
    res.json({ problems: validateConfig(content) });
  }),
);

configRouter.get(
  '/backups',
  asyncHandler(async (_req, res) => {
    res.json({ backups: await listBackups() });
  }),
);

configRouter.get(
  '/backups/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().regex(/^[A-Za-z0-9\-]+$/).parse(req.params.id);
    res.json({ id, content: await readBackup(id) });
  }),
);

configRouter.post(
  '/backups/:id/restore',
  asyncHandler(async (req, res) => {
    const id = z.string().regex(/^[A-Za-z0-9\-]+$/).parse(req.params.id);
    const content = await readBackup(id);
    const previous = await readConfig().catch(() => null);
    // Restoring takes its own backup first, so a mistaken restore is reversible.
    const result = await saveConfig(content, { note: `Restored from backup ${id}`, force: true });
    // A backup carries whatever password was in force when it was taken, so a
    // restore moves the password just as surely as an edit does.
    const rconPassword = previous ? await handOverRconPassword(previous.content, content) : null;
    res.json({ ...result, restoredFrom: id, rconPassword });
  }),
);

const backupIdSchema = z.string().regex(/^[A-Za-z0-9-]+$/, 'Invalid backup id');

configRouter.delete(
  '/backups/:id',
  asyncHandler(async (req, res) => {
    await deleteBackup(backupIdSchema.parse(req.params.id));
    res.status(204).end();
  }),
);

/**
 * Deletes several at once.
 *
 * A separate endpoint rather than repeated DELETEs so that clearing a dozen
 * backups is one action with one confirmation, and one line in the log.
 */
configRouter.post(
  '/backups/delete',
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(backupIdSchema).min(1).max(100) }).parse(req.body);
    await Promise.all(ids.map((id) => deleteBackup(id)));
    res.json({ deleted: ids.length });
  }),
);

/** Asks the live server to re-read the config without a full restart. */
async function reloadServerConfig(): Promise<{ ok: boolean; message: string }> {
  const credential = await resolveRconPassword();
  if (credential.source === 'none') {
    return { ok: false, message: 'No rcon password configured, so the server was not reloaded' };
  }
  try {
    await rcon(target, credential.password, `exec ${env.SERVER_CONFIG_NAME}`);
    return { ok: true, message: 'Config re-executed on the running server' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Reload failed',
    };
  }
}

export interface RconHandover {
  ok: boolean;
  message: string;
}

/**
 * Moves the running server onto a new rcon password at the moment it changes.
 *
 * Writing a new `rconpassword` to the config leaves three copies disagreeing:
 * the file has the new one, the running server still holds the old one in
 * memory until something re-execs the config, and the dashboard needs whichever
 * the server will actually accept. Left alone that window never closes on its
 * own, and it locks the operator out of the console — the one place they would
 * go to fix it.
 *
 * The way out is to do the handover while the *old* password is still valid:
 * authenticate with it and set the cvar live. After this returns ok the file,
 * the server and the dashboard all agree, with no restart and no gap.
 *
 * Returns null when the password did not change, so callers can stay quiet.
 */
async function handOverRconPassword(
  previousContent: string,
  nextContent: string,
): Promise<RconHandover | null> {
  const previous = (cvarMap(previousContent).rconpassword ?? '').trim();
  const next = (cvarMap(nextContent).rconpassword ?? '').trim();

  if (previous === next) return null;

  if (!previous) {
    // Nothing to authenticate with — the server has no rcon password set yet,
    // so it cannot be told about the new one.
    return {
      ok: false,
      message:
        'Saved. The running server has no rcon password yet, so restart it (or re-exec the config) to start using this one.',
    };
  }

  if (!canSendAsRconArgument(next)) {
    return {
      ok: false,
      message:
        'Saved. This password contains a quote, semicolon or newline, which cannot be sent over rcon safely — restart the server to apply it.',
    };
  }

  try {
    // Quoted so a password containing spaces survives the console parser.
    await rcon(target, previous, `rconpassword "${next}"`);
    logger.info('rcon password handed over to the running server');
    return {
      ok: true,
      message: next
        ? 'Applied to the running server immediately — no restart needed.'
        : 'RCON is now disabled on the running server.',
    };
  } catch (err) {
    return {
      ok: false,
      message: `Saved, but the running server could not be updated (${
        err instanceof Error ? err.message : 'unknown error'
      }). It still expects the previous password until you restart it.`,
    };
  }
}
