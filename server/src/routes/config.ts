import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import { DEFAULT_SERVER_CONFIG } from '../services/defaultConfig.js';
import { poller } from '../services/poller.js';
import { rcon } from '../services/q3protocol.js';
import {
  applyCvarUpdates,
  buildRotation,
  configExists,
  CONFIG_PATH,
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

    const result = await saveConfig(content, { expectedRevision, note, force });
    const reloaded = reload ? await reloadServerConfig() : null;

    res.json({ ...result, reloaded });
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

    const reloaded = reload ? await reloadServerConfig() : null;
    await poller.refresh();

    res.json({ ...result, applied: Object.keys(effective), reloaded });
  }),
);

const rotationSchema = z.object({
  maps: z
    .array(z.string().regex(/^[A-Za-z0-9_\-]{1,64}$/, 'Invalid map name'))
    .max(64),
  expectedRevision: z.string().optional(),
});

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
    // Restoring takes its own backup first, so a mistaken restore is reversible.
    const result = await saveConfig(content, { note: `Restored from backup ${id}`, force: true });
    res.json({ ...result, restoredFrom: id });
  }),
);

/** Asks the live server to re-read the config without a full restart. */
async function reloadServerConfig(): Promise<{ ok: boolean; message: string }> {
  if (!env.RCON_PASSWORD) {
    return { ok: false, message: 'No rcon password configured, so the server was not reloaded' };
  }
  try {
    await rcon(target, env.RCON_PASSWORD, `exec ${env.SERVER_CONFIG_NAME}`);
    return { ok: true, message: 'Config re-executed on the running server' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Reload failed',
    };
  }
}
