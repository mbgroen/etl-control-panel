import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Dashboard preferences that an operator can change from the browser.
 *
 * Deliberately not part of etl_server.cfg. That file belongs to the game
 * server: everything in it is a cvar the engine reads, it is backed up and
 * restored as a unit, and it is served to clients' download directory. A
 * dashboard preference has no business there — it would be an unknown cvar the
 * engine ignores, and a restore of an old backup would silently change it.
 *
 * So it lives beside the credential store in the state directory, which is
 * already the dashboard's own writable space.
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

export interface DashboardSettings {
  maxUploadMb: number;
}

let cache: DashboardSettings | null = null;

/**
 * Validates an upload limit, returning null for anything unusable.
 *
 * Exported so the bounds can be tested without touching the filesystem — and
 * so there is exactly one definition of "valid", used by both the stored-value
 * reader and the write path.
 */
export function parseUploadMb(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < MIN_UPLOAD_MB || rounded > MAX_UPLOAD_MB_CEILING) return null;
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
export async function readSettings(): Promise<DashboardSettings> {
  if (cache) return cache;

  const fallback: DashboardSettings = { maxUploadMb: env.MAX_UPLOAD_MB };

  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const stored = parseUploadMb((parsed as { maxUploadMb?: unknown })?.maxUploadMb);
    cache = stored === null ? fallback : { maxUploadMb: stored };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err }, 'could not read dashboard settings — using the environment defaults');
    }
    cache = fallback;
  }

  return cache;
}

export async function writeSettings(next: DashboardSettings): Promise<DashboardSettings> {
  const maxUploadMb = parseUploadMb(next.maxUploadMb);
  if (maxUploadMb === null) {
    throw new RangeError(
      `Upload limit must be between ${MIN_UPLOAD_MB} and ${MAX_UPLOAD_MB_CEILING} MB`,
    );
  }

  const settings: DashboardSettings = { maxUploadMb };
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });

  // Written to a temp file and renamed, so a crash mid-write cannot leave a
  // half-written file that would fall back to the defaults on next boot.
  const temp = `${SETTINGS_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(temp, SETTINGS_FILE);

  cache = settings;
  logger.info({ maxUploadMb }, 'dashboard settings updated');
  return settings;
}

/** Test seam: drops the cached copy so the next read hits disk again. */
export function resetSettingsCache(): void {
  cache = null;
}
