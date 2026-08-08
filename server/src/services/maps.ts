import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { mapNamesIn } from './pk3.js';

/**
 * The pk3 library.
 *
 * pk3 files in etmain are what clients download; the same directory is served
 * read-only by the FastDL nginx container, so "installed" and "downloadable"
 * are the same set of files by construction rather than by a sync step.
 */

export interface MapPackage {
  filename: string;
  /** Filename without the .pk3 suffix — what `map <name>` roughly refers to. */
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  /** True for the stock paks that ship with the game and must not be removed. */
  stock: boolean;
  /**
   * Playable maps the package actually contains, read from its `maps/*.bsp`
   * entries. A pk3 is frequently named differently from the map inside it, so
   * this is the only reliable answer to "what do I put in the rotation?" —
   * previously an rcon round trip on another screen.
   */
  maps: string[];
}

/**
 * Stock ET paks. Deleting one of these breaks pure-server checks for every
 * client, so the API refuses to touch them.
 */
const STOCK_PAKS = new Set([
  'pak0.pk3',
  'pak1.pk3',
  'pak2.pk3',
  'mp_bin.pk3',
  'pak0.pk3.md5',
]);

export function isStockPak(filename: string): boolean {
  return STOCK_PAKS.has(filename.toLowerCase());
}

/**
 * Failure modes callers can act on, so the API returns a specific status and a
 * message worth showing rather than a generic 500.
 */
export class MapError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid-name' | 'protected' | 'conflict' | 'missing',
  ) {
    super(message);
    this.name = 'MapError';
  }
}

/**
 * Validates a client-supplied filename.
 *
 * Rejects anything with a path separator, a leading dot, or a non-pk3
 * extension. Upload and delete both funnel through this — path traversal into
 * the host filesystem is the highest-severity bug this service could have.
 */
export function assertSafePk3Name(filename: string): string {
  const base = path.basename(filename);
  if (base !== filename || base.startsWith('.') || base.includes('/') || base.includes('\\')) {
    throw new MapError('Invalid filename', 'invalid-name');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-]{0,120}\.pk3$/.test(base)) {
    throw new MapError(
      'Filename must be a simple .pk3 name (letters, digits, dot, dash, underscore)',
      'invalid-name',
    );
  }
  return base;
}

export async function listMaps(): Promise<MapPackage[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(env.ETMAIN_PATH);
  } catch (err) {
    logger.warn({ err, path: env.ETMAIN_PATH }, 'cannot read etmain directory');
    return [];
  }

  const packages = await Promise.all(
    entries
      .filter((name) => name.toLowerCase().endsWith('.pk3'))
      .map(async (filename): Promise<MapPackage | null> => {
        try {
          const stat = await fs.stat(path.join(env.ETMAIN_PATH, filename));
          if (!stat.isFile()) return null;
          return {
            filename,
            name: filename.replace(/\.pk3$/i, ''),
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            stock: isStockPak(filename),
            maps: await mapNamesIn(path.join(env.ETMAIN_PATH, filename)),
          };
        } catch {
          // File vanished between readdir and stat — skip it.
          return null;
        }
      }),
  );

  return packages
    .filter((p): p is MapPackage => p !== null)
    .sort((a, b) => Number(a.stock) - Number(b.stock) || a.filename.localeCompare(b.filename));
}

export async function deleteMap(filename: string): Promise<void> {
  const safe = assertSafePk3Name(filename);
  if (isStockPak(safe)) {
    throw new MapError(
      `${safe} ships with the game and cannot be deleted — removing it would break every client's checksum validation`,
      'protected',
    );
  }
  await fs.rm(path.join(env.ETMAIN_PATH, safe), { force: true });
  logger.info({ filename: safe }, 'map package deleted');
}

/** Moves a finished upload into etmain, refusing to clobber an existing pak. */
export async function installUpload(tempPath: string, originalName: string): Promise<MapPackage> {
  const safe = assertSafePk3Name(originalName);
  const target = path.join(env.ETMAIN_PATH, safe);

  const exists = await fs
    .access(target)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    await fs.rm(tempPath, { force: true });
    throw new MapError(
      `${safe} already exists — delete it first if you want to replace it`,
      'conflict',
    );
  }

  await fs.mkdir(env.ETMAIN_PATH, { recursive: true });

  // rename() fails across filesystems (the temp dir and etmain are usually
  // different mounts here), so fall back to a copy.
  try {
    await fs.rename(tempPath, target);
  } catch {
    await fs.copyFile(tempPath, target);
    await fs.rm(tempPath, { force: true });
  }

  // Clients fetch these over plain HTTP from nginx; make sure they are readable.
  await fs.chmod(target, 0o644).catch(() => undefined);

  const stat = await fs.stat(target);
  logger.info({ filename: safe, bytes: stat.size }, 'map package installed');

  return {
    filename: safe,
    name: safe.replace(/\.pk3$/i, ''),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    stock: false,
    maps: await mapNamesIn(target),
  };
}

/** Streams a checksum of a pak, for verifying a FastDL mirror matches. */
export async function checksum(filename: string): Promise<string> {
  const safe = assertSafePk3Name(filename);
  const hash = createHash('sha256');
  const stream = createReadStream(path.join(env.ETMAIN_PATH, safe));
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface StorageUsage {
  mapCount: number;
  customMapCount: number;
  totalBytes: number;
  customBytes: number;
}

export async function storageUsage(): Promise<StorageUsage> {
  const maps = await listMaps();
  return {
    mapCount: maps.length,
    customMapCount: maps.filter((m) => !m.stock).length,
    totalBytes: maps.reduce((sum, m) => sum + m.sizeBytes, 0),
    customBytes: maps.filter((m) => !m.stock).reduce((sum, m) => sum + m.sizeBytes, 0),
  };
}
