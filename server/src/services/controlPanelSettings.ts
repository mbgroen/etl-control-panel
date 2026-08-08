import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Control panel preferences that an operator can change from the browser.
 *
 * Deliberately not part of etl_server.cfg. That file belongs to the game
 * server: everything in it is a cvar the engine reads, it is backed up and
 * restored as a unit, and it is served to clients' download directory. A
 * control panel preference has no business there — it would be an unknown cvar the
 * engine ignores, and a restore of an old backup would silently change it.
 *
 * So it lives beside the credential store in the state directory, which is
 * already the control panel's own writable space.
 */

const SETTINGS_FILE = path.join(env.STATE_PATH, 'settings.json');

/**
 * Upper bound on the upload limit.
 *
 * Not arbitrary: multer buffers each upload to a temp file before it is moved
 * into etmain, and the two are usually different mounts, so the move becomes a
 * copy. A limit above this would let a single upload need several gigabytes of
 * scratch space on a NAS that may not have it.
 */
export const MAX_UPLOAD_MB_CEILING = 2048;
export const MIN_UPLOAD_MB = 1;

/**
 * Retention bounds.
 *
 * Both lists were fixed in code — thirty backups, five hundred visits — which
 * is a policy decision an operator should be making. A ceiling still exists
 * because both are single JSON files rewritten in one go, and "keep
 * everything" would eventually mean rewriting megabytes on every save.
 */
export const MIN_BACKUPS = 1;
export const MAX_BACKUPS_CEILING = 200;
export const MIN_HISTORY = 10;
export const MAX_HISTORY_CEILING = 5000;

export interface ControlPanelSettings {
  maxUploadMb: number;
  /** Config snapshots kept before the oldest is pruned. */
  maxBackups: number;
  /** Finished player visits kept before the oldest is pruned. */
  maxPlayerSessions: number;
}

let cache: ControlPanelSettings | null = null;

/**
 * Validates an upload limit, returning null for anything unusable.
 *
 * Exported so the bounds can be tested without touching the filesystem — and
 * so there is exactly one definition of "valid", used by both the stored-value
 * reader and the write path.
 */
export function parseUploadMb(value: unknown): number | null {
  return parseBounded(value, MIN_UPLOAD_MB, MAX_UPLOAD_MB_CEILING);
}

/** Shared bounds check, so "valid" has one definition per setting. */
export function parseBounded(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

/**
 * Reads the stored settings, falling back to the environment.
 *
 * MAX_UPLOAD_MB stays meaningful as the starting value for a deployment that
 * has never touched the setting in the UI — but once it is set here, this wins:
 * a value the operator chose in the browser should not be silently overridden
 * by one they configured months ago and forgot.
 */
export async function readSettings(): Promise<ControlPanelSettings> {
  if (cache) return cache;

  const fallback: ControlPanelSettings = {
    maxUploadMb: env.MAX_UPLOAD_MB,
    maxBackups: 30,
    maxPlayerSessions: 500,
  };

  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Record<keyof ControlPanelSettings, unknown>>;
    // Each setting falls back independently, so one unreadable value does not
    // discard the others.
    cache = {
      maxUploadMb: parseUploadMb(parsed?.maxUploadMb) ?? fallback.maxUploadMb,
      maxBackups:
        parseBounded(parsed?.maxBackups, MIN_BACKUPS, MAX_BACKUPS_CEILING) ?? fallback.maxBackups,
      maxPlayerSessions:
        parseBounded(parsed?.maxPlayerSessions, MIN_HISTORY, MAX_HISTORY_CEILING) ??
        fallback.maxPlayerSessions,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err }, 'could not read control panel settings — using the environment defaults');
    }
    cache = fallback;
  }

  return cache;
}

export async function writeSettings(next: ControlPanelSettings): Promise<ControlPanelSettings> {
  const maxUploadMb = parseUploadMb(next.maxUploadMb);
  if (maxUploadMb === null) {
    throw new RangeError(
      `Upload limit must be between ${MIN_UPLOAD_MB} and ${MAX_UPLOAD_MB_CEILING} MB`,
    );
  }
  const maxBackups = parseBounded(next.maxBackups, MIN_BACKUPS, MAX_BACKUPS_CEILING);
  if (maxBackups === null) {
    throw new RangeError(`Backups kept must be between ${MIN_BACKUPS} and ${MAX_BACKUPS_CEILING}`);
  }
  const maxPlayerSessions = parseBounded(next.maxPlayerSessions, MIN_HISTORY, MAX_HISTORY_CEILING);
  if (maxPlayerSessions === null) {
    throw new RangeError(
      `Player visits kept must be between ${MIN_HISTORY} and ${MAX_HISTORY_CEILING}`,
    );
  }

  const settings: ControlPanelSettings = { maxUploadMb, maxBackups, maxPlayerSessions };
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });

  // Written to a temp file and renamed, so a crash mid-write cannot leave a
  // half-written file that would fall back to the defaults on next boot.
  const temp = `${SETTINGS_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(temp, SETTINGS_FILE);

  cache = settings;
  logger.info({ maxUploadMb, maxBackups, maxPlayerSessions }, 'control panel settings updated');
  return settings;
}

/** Test seam: drops the cached copy so the next read hits disk again. */
export function resetSettingsCache(): void {
  cache = null;
}
