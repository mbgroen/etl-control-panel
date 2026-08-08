import fs from 'node:fs/promises';

/**
 * Reads the map names out of a pk3.
 *
 * A pk3 is a zip, and the maps it provides are the `maps/<name>.bsp` entries
 * inside it. Without this the only way to learn what a package contains is to
 * ask the running server over rcon (`dir maps bsp`) and read the answer, which
 * is why adding a map meant visiting three screens.
 *
 * Only the central directory is read, never the archive body: pak0.pk3 is over
 * 200 MB and nothing here needs a single byte of its contents. The directory
 * lives at the end of the file, so this seeks rather than streams — listing a
 * full map library stays in the millisecond range.
 */

/** End of Central Directory signature, and the largest a trailing comment may be. */
const EOCD_SIGNATURE = 0x0605_4b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

const CENTRAL_FILE_SIGNATURE = 0x0201_4b50;

interface CentralDirectory {
  offset: number;
  size: number;
  entries: number;
}

/** Finds the end-of-central-directory record by scanning backwards. */
function locateEocd(tail: Buffer): CentralDirectory | null {
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    return {
      entries: tail.readUInt16LE(i + 10),
      size: tail.readUInt32LE(i + 12),
      offset: tail.readUInt32LE(i + 16),
    };
  }
  return null;
}

/**
 * Every file path stored in the archive.
 *
 * Returns an empty list rather than throwing for anything unreadable or not a
 * zip: a corrupt or exotic pk3 should leave the map list looking sparse, not
 * break the page that lists it.
 */
export async function listArchiveEntries(path: string): Promise<string[]> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(path, 'r');
    const { size } = await handle.stat();
    if (size < EOCD_MIN_SIZE) return [];

    const tailLength = Math.min(size, EOCD_MIN_SIZE + MAX_COMMENT);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);

    const eocd = locateEocd(tail);
    // Zip64, or simply not a zip. Both are "cannot answer", not "is broken".
    if (!eocd || eocd.offset === 0xffff_ffff || eocd.size === 0) return [];

    const central = Buffer.alloc(Math.min(eocd.size, size));
    await handle.read(central, 0, central.length, eocd.offset);

    const names: string[] = [];
    let cursor = 0;
    for (let entry = 0; entry < eocd.entries; entry += 1) {
      if (cursor + 46 > central.length) break;
      if (central.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) break;

      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);

      const start = cursor + 46;
      if (start + nameLength > central.length) break;
      names.push(central.toString('utf8', start, start + nameLength));

      cursor = start + nameLength + extraLength + commentLength;
    }
    return names;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * The playable map names a pk3 provides.
 *
 * `maps/oasis.bsp` becomes `oasis` — the name the engine takes for `map` and
 * for a rotation entry, which is the whole point of looking inside.
 */
export async function mapNamesIn(path: string): Promise<string[]> {
  const entries = await listArchiveEntries(path);
  const names = new Set<string>();

  for (const entry of entries) {
    const match = /^maps\/([A-Za-z0-9_-]+)\.bsp$/i.exec(entry.replace(/\\/g, '/'));
    if (match?.[1]) names.add(match[1].toLowerCase());
  }

  return [...names].sort();
}
