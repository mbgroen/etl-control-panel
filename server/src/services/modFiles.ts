import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';
import * as docker from './docker.js';

/**
 * Keeps the Legacy mod package available for HTTP download.
 *
 * A client joining a server whose mod it does not have must fetch that mod's
 * pk3 — `legacy/legacy_v2.85.0.pk3` and friends — exactly as it fetches a map.
 * The engine asks for `<sv_wwwBaseURL>/legacy/<file>.pk3`, and FastDL serves
 * the host's `legacy/` directory.
 *
 * That directory is empty on every installation of this stack, and cannot be
 * anything else: the mod lives *inside* the game server image, and bind-mounting
 * over `/legacy/server/legacy` would hide the game module the engine loads at
 * start-up. So the one file every joining player needs 404s, the engine quietly
 * falls back to its in-game UDP transfer, and a 34 MB download crawls at
 * sv_dlRate until the player gives up. The server looks healthy from the
 * outside — listed, answering, running — and simply never keeps anyone.
 *
 * The fix is a copy, and the only thing that makes it hard is remembering to
 * redo it after every image update, when the version in the filename changes.
 * So the control panel does it: on start-up, and after it starts or restarts
 * the game server itself.
 */

/** Where the official image keeps the mod, alongside qagame and the Lua tree. */
const MOD_DIR = '/legacy/server/legacy';

export interface ModPakStatus {
  /** The pk3 the running game server ships, e.g. `legacy_v2.85.0.pk3`. */
  name: string | null;
  /** Its size inside the container, for comparing against what is published. */
  sizeBytes: number | null;
  /** True when FastDL can already serve exactly this file. */
  published: boolean;
  /** Set when the question could not be answered at all. */
  error?: string;
}

/**
 * Lists the mod packages inside the running game server.
 *
 * One `sh` invocation rather than a call per file: this runs on every start-up
 * and the container may be mid-boot, so the fewer round trips the better.
 */
async function containerPaks(): Promise<{ name: string; size: number }[]> {
  const output = await docker.exec('game', [
    'sh',
    '-c',
    `for f in ${MOD_DIR}/*.pk3; do [ -f "$f" ] && printf '%s %s\\n' "$(stat -c %s "$f" 2>/dev/null || echo 0)" "\${f##*/}"; done`,
  ]);

  return output
    .split('\n')
    .map((line) => /^(\d+)\s+(.+\.pk3)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[2] as string, size: Number.parseInt(match[1] as string, 10) }));
}

/**
 * Which pk3 is *the* mod package.
 *
 * The image has shipped exactly one for every release so far; if that ever
 * changes, the newest by version string is the one a client will be asked for.
 */
function pickModPak(paks: { name: string; size: number }[]): { name: string; size: number } | null {
  if (paks.length === 0) return null;
  const sorted = [...paks].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }),
  );
  return sorted[sorted.length - 1] ?? null;
}

/** What the game server ships, and whether FastDL already has it. */
export async function status(): Promise<ModPakStatus> {
  try {
    const pak = pickModPak(await containerPaks());
    if (!pak) {
      return { name: null, sizeBytes: null, published: false, error: `No .pk3 found in ${MOD_DIR}` };
    }

    const target = path.join(env.LEGACY_PATH, pak.name);
    const published = await fs
      .stat(target)
      .then((stat) => stat.isFile() && stat.size === pak.size)
      .catch(() => false);

    return { name: pak.name, sizeBytes: pak.size, published };
  } catch (err) {
    return {
      name: null,
      sizeBytes: null,
      published: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface PublishResult extends ModPakStatus {
  /** True when this call actually copied the file. */
  copied: boolean;
}

/**
 * Copies the mod package into the FastDL directory unless it is already there.
 *
 * Idempotent by size: an interrupted copy leaves a `.part` file and is redone,
 * and a file already published byte-for-byte is left alone rather than rewritten
 * on every restart.
 */
export async function publish(): Promise<PublishResult> {
  const current = await status();
  if (!current.name || current.error) return { ...current, copied: false };
  if (current.published) return { ...current, copied: false };

  const target = path.join(env.LEGACY_PATH, current.name);
  try {
    const bytes = await docker.copyFileFrom('game', `${MOD_DIR}/${current.name}`, target);
    logger.info(
      { file: current.name, bytes, target },
      'published the Legacy mod package for FastDL',
    );
    return { ...current, published: true, copied: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, file: current.name }, 'could not publish the mod package for FastDL');
    return { ...current, published: false, copied: false, error: message };
  }
}

/**
 * Publishes in the background, for callers that must not wait on a 34 MB copy.
 *
 * Failure is logged and dropped: this runs on start-up and after a restart,
 * where there is nobody to report to, and Diagnostics answers the question
 * whenever somebody does ask.
 */
export function publishInBackground(reason: string): void {
  void publish()
    .then((result) => {
      if (result.copied) logger.info({ reason, file: result.name }, 'mod package published');
    })
    .catch((err) => logger.warn({ err, reason }, 'mod package publish failed'));
}
