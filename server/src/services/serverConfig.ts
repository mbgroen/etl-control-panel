import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { readSettings } from './controlPanelSettings.js';
import { logger } from '../logger.js';

/**
 * Read/write access to the ET: Legacy server config.
 *
 * Two invariants drive the design:
 *  1. The file is shared with a running game server, so writes are atomic
 *     (temp file + rename) — a half-written cfg would break the next map load.
 *  2. Operators hand-edit these files and care about their comments, so
 *     targeted cvar edits patch lines in place instead of regenerating the file.
 */

export const CONFIG_PATH = path.join(env.ETMAIN_PATH, env.SERVER_CONFIG_NAME);
const BACKUP_DIR = path.join(env.STATE_PATH, 'backups');


/** Cvars that hold secrets. Their values are masked before leaving the API. */
export const SECRET_CVARS = new Set([
  'rconpassword',
  'sv_privatepassword',
  'g_password',
  'refereepassword',
  'sv_referencedpakpassword',
  'omnibot_password',
]);

export const MASK = '••••••••';

export interface Cvar {
  key: string;
  value: string;
  /** `set`, `seta`, `sets` or `setu` — preserved on rewrite. */
  command: string;
  line: number;
  secret: boolean;
}

export interface ConfigSnapshot {
  path: string;
  content: string;
  /** SHA-256 of the content, used for optimistic concurrency on save. */
  revision: string;
  modifiedAt: string;
  sizeBytes: number;
}

function revisionOf(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export class ConfigConflictError extends Error {
  constructor(readonly currentRevision: string) {
    super('The config file changed on disk since it was loaded');
    this.name = 'ConfigConflictError';
  }
}

export class ConfigValidationError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(`Config failed validation with ${problems.length} problem(s)`);
    this.name = 'ConfigValidationError';
  }
}

export async function readConfig(): Promise<ConfigSnapshot> {
  const [content, stat] = await Promise.all([
    fs.readFile(CONFIG_PATH, 'utf8'),
    fs.stat(CONFIG_PATH),
  ]);
  return {
    path: CONFIG_PATH,
    content,
    revision: revisionOf(content),
    modifiedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Matches a cvar assignment.
 *
 * Values may be quoted or bare; `//` starts a comment. Quoted values are taken
 * verbatim (they legitimately contain `//`, as in URLs, and `;`).
 */
const CVAR_RE = /^\s*(set[augs]?)\s+([A-Za-z_][\w]*)\s+(?:"([^"]*)"|(\S+))/i;

export function parseCvars(content: string): Cvar[] {
  const cvars: Cvar[] = [];
  const lines = content.split('\n');

  lines.forEach((raw, index) => {
    const line = raw.trimStart();
    if (line.startsWith('//') || line.startsWith('#') || line === '') return;

    const match = CVAR_RE.exec(raw);
    if (!match) return;

    const key = match[2] ?? '';
    cvars.push({
      key,
      value: match[3] ?? match[4] ?? '',
      command: (match[1] ?? 'set').toLowerCase(),
      line: index + 1,
      secret: SECRET_CVARS.has(key.toLowerCase()),
    });
  });

  return cvars;
}

/** Returns cvars as a plain map, last assignment winning (as the engine does). */
export function cvarMap(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cvar of parseCvars(content)) out[cvar.key.toLowerCase()] = cvar.value;
  return out;
}

/** Replaces secret values with a mask so they never reach the browser. */
export function maskSecrets(cvars: Cvar[]): Cvar[] {
  return cvars.map((cvar) =>
    cvar.secret && cvar.value !== '' ? { ...cvar, value: MASK } : cvar,
  );
}

export interface ConfigProblem {
  line: number | null;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Static analysis of a config before it is written.
 *
 * Errors block the save; warnings are advisory and surfaced in the editor. The
 * goal is to catch the mistakes that leave a server silently unreachable —
 * those cost far more to debug from the outside than they do to check here.
 */
export function validateConfig(content: string): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const lines = content.split('\n');

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (line.startsWith('//') || line === '') return;

    // An unbalanced quote swallows every following line until the next quote,
    // which is the single most common way to break one of these files.
    const quotes = (raw.match(/"/g) ?? []).length;
    if (quotes % 2 !== 0) {
      problems.push({ line: lineNo, severity: 'error', message: 'Unbalanced double quote' });
    }

    if (/^\s*set[augs]?\s+[A-Za-z_]\w*\s*$/i.test(raw)) {
      problems.push({
        line: lineNo,
        severity: 'warning',
        message: 'Cvar is set with no value — the engine will store an empty string',
      });
    }
  });

  const cvars = cvarMap(content);

  const requireNumeric = (key: string, min: number, max: number) => {
    const raw = cvars[key];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      problems.push({
        line: parseCvars(content).find((c) => c.key.toLowerCase() === key)?.line ?? null,
        severity: 'error',
        message: `${key} must be a number between ${min} and ${max} (got "${raw}")`,
      });
    }
  };

  requireNumeric('sv_maxclients', 1, 64);
  requireNumeric('g_gametype', 0, 9);
  requireNumeric('timelimit', 0, 1440);
  requireNumeric('sv_privateclients', 0, 64);
  requireNumeric('net_port', 1, 65535);

  const maxClients = Number(cvars.sv_maxclients ?? NaN);
  const privateClients = Number(cvars.sv_privateclients ?? NaN);
  if (Number.isFinite(maxClients) && Number.isFinite(privateClients) && privateClients >= maxClients) {
    problems.push({
      line: null,
      severity: 'error',
      message: `sv_privateClients (${privateClients}) must be lower than sv_maxclients (${maxClients}), or no public slot is ever free`,
    });
  }

  if (!cvars.rconpassword) {
    problems.push({
      line: null,
      severity: 'warning',
      message: 'No rconpassword set — the control panel console and player admin will be unavailable',
    });
  }

  if (cvars.sv_wwwdownload === '1' && !cvars.sv_wwwbaseurl) {
    problems.push({
      line: null,
      severity: 'error',
      message: 'sv_wwwDownload is enabled but sv_wwwBaseURL is empty — clients will fail to download',
    });
  }

  if (cvars.sv_privatepassword === '' && Number(cvars.sv_privateclients ?? 0) > 0) {
    problems.push({
      line: null,
      severity: 'warning',
      message: 'Private slots are reserved but sv_privatePassword is empty, so nobody can claim them',
    });
  }

  if (cvars.dedicated !== undefined && cvars.dedicated !== '2') {
    problems.push({
      line: null,
      severity: 'warning',
      message: 'dedicated is not "2" — the server will not advertise itself to the master servers',
    });
  }

  return problems;
}

/**
 * Rewrites specific cvars, leaving the rest of the file — comments, ordering,
 * blank lines — exactly as the operator wrote it.
 *
 * When a key appears more than once, only the last assignment is patched
 * because that is the one the engine actually applies. Unknown keys are
 * appended in a clearly-marked block at the end of the file.
 */
export function applyCvarUpdates(content: string, updates: Record<string, string>): string {
  const lines = content.split('\n');
  // Keyed case-insensitively, because a config may spell a cvar any way it
  // likes and the engine does not care — but the original spelling is kept so
  // an appended line reads like the rest of the file rather than shouting
  // g_medicchargetime at someone who wrote g_medicChargeTime everywhere else.
  const pending = new Map(
    Object.entries(updates).map(([k, v]) => [k.toLowerCase(), { key: k, value: v }]),
  );

  const lastOccurrence = new Map<string, number>();
  lines.forEach((raw, index) => {
    const match = CVAR_RE.exec(raw);
    const key = match?.[2]?.toLowerCase();
    if (key && pending.has(key)) lastOccurrence.set(key, index);
  });

  for (const [key, index] of lastOccurrence) {
    const raw = lines[index];
    if (raw === undefined) continue;
    const match = CVAR_RE.exec(raw);
    if (!match) continue;

    const indent = /^\s*/.exec(raw)?.[0] ?? '';
    const command = match[1] ?? 'set';
    const original = match[2] ?? key;
    const value = pending.get(key)?.value ?? '';

    // Preserve any trailing comment the operator left on the line.
    const consumed = match[0].length;
    const trailer = raw.slice(consumed).trimEnd();

    lines[index] = `${indent}${command} ${original} "${escapeValue(value)}"${trailer ? ` ${trailer.trim()}` : ''}`;
    pending.delete(key);
  }

  if (pending.size > 0) {
    const added = [...pending.values()].map(
      (entry) => `set ${entry.key} "${escapeValue(entry.value)}"`,
    );
    lines.push('', '// --- Added by the control panel ---', ...added);
  }

  return lines.join('\n');
}

/**
 * Deletes assignments of the given cvars.
 *
 * Setting a cvar to nothing is not the same as not setting it: the engine reads
 * an empty value back as 0, which for g_redlimbotime is a modulo by zero. The
 * only way to hand a setting back to the engine's own default is to take the
 * line out, so that has to be an operation the API offers rather than something
 * only the raw editor can do.
 *
 * Every assignment of the key goes, not just the last: leaving an earlier one
 * behind would look like the setting had been removed while the engine still
 * applied it.
 */
export function removeCvars(content: string, keys: string[]): string {
  if (keys.length === 0) return content;
  const wanted = new Set(keys.map((key) => key.toLowerCase()));

  return content
    .split('\n')
    .filter((line) => {
      const match = CVAR_RE.exec(line);
      const key = match?.[2]?.toLowerCase();
      return !(key && wanted.has(key));
    })
    .join('\n');
}

/** Config values cannot contain a raw double quote; the parser has no escape. */
function escapeValue(value: string): string {
  return value.replace(/"/g, "'");
}

/* ------------------------------------------------------------------ *
 * Map rotation
 * ------------------------------------------------------------------ */

const ROTATION_START = '// >>> control-panel:rotation — managed block, edit via the control panel';
const ROTATION_END = '// <<< control-panel:rotation';

/**
 * Both spellings of the markers, because configs written before the rename say
 * `dashboard:rotation`.
 *
 * Matching only the new name would leave the old block in place and append a
 * second one below it — two rotations in one file, with the last `vstr` quietly
 * deciding which one runs. Read either, write the current one.
 */
const ROTATION_START_ANY = /^\/\/\s*>>>\s*(control-panel|dashboard):rotation\b/;
const ROTATION_END_ANY = /^\/\/\s*<<<\s*(control-panel|dashboard):rotation\b/;

export interface RotationEntry {
  map: string;
}

/**
 * Reads the map rotation out of a config.
 *
 * ET rotations are a chain of cvars, each of which loads a map and points
 * `nextmap` at the following link:
 *
 *     set mr1 "map oasis ; set nextmap vstr mr2"
 *     set mr2 "map radar ; set nextmap vstr mr1"
 *     vstr mr1
 *
 * The chain is followed from the trailing `vstr` so rotations written by hand
 * (in any variable naming scheme) are read correctly, and a cycle is detected
 * rather than looped forever.
 */
export function parseRotation(content: string): RotationEntry[] {
  const chain = new Map<string, { map: string; next: string | null }>();

  for (const line of content.split('\n')) {
    const match = /^\s*set[augs]?\s+([A-Za-z_]\w*)\s+"([^"]*)"/i.exec(line);
    if (!match) continue;
    const body = match[2] ?? '';
    const mapMatch = /\bmap\s+([A-Za-z0-9_\-]+)/i.exec(body);
    if (!mapMatch) continue;
    const nextMatch = /\bset\s+nextmap\s+vstr\s+([A-Za-z_]\w*)/i.exec(body);
    chain.set((match[1] ?? '').toLowerCase(), {
      map: mapMatch[1] ?? '',
      next: nextMatch?.[1]?.toLowerCase() ?? null,
    });
  }

  // The last bare `vstr <var>` in the file is what actually starts the rotation.
  const starters = [...content.matchAll(/^\s*vstr\s+([A-Za-z_]\w*)\s*$/gim)];
  const start = starters.at(-1)?.[1]?.toLowerCase();
  if (!start || !chain.has(start)) return [];

  const entries: RotationEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = start;

  while (cursor && chain.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const node = chain.get(cursor);
    if (!node) break;
    entries.push({ map: node.map });
    cursor = node.next;
  }

  return entries;
}

/**
 * Replaces the rotation with a new map list, writing it into a managed block so
 * repeated edits never accumulate duplicates or disturb the rest of the file.
 */
export function buildRotation(content: string, maps: string[]): string {
  const cleaned = removeManagedRotation(content);
  if (maps.length === 0) return cleaned;

  const vars = maps.map((_, index) => `mr${index + 1}`);
  const lines = maps.map((map, index) => {
    const next = vars[(index + 1) % vars.length];
    return `set ${vars[index]} "map ${map} ; set nextmap vstr ${next}"`;
  });

  return [
    cleaned.trimEnd(),
    '',
    ROTATION_START,
    ...lines,
    `vstr ${vars[0]}`,
    ROTATION_END,
    '',
  ].join('\n');
}

function removeManagedRotation(content: string): string {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => ROTATION_START_ANY.test(l.trim()));
  if (start === -1) return content;
  const end = lines.findIndex((l, i) => i > start && ROTATION_END_ANY.test(l.trim()));
  if (end === -1) return content;
  lines.splice(start, end - start + 1);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Persistence & backups
 * ------------------------------------------------------------------ */

export interface BackupEntry {
  id: string;
  createdAt: string;
  sizeBytes: number;
  note: string;
}

async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/**
 * Snapshots the current config before it is overwritten.
 *
 * Backups are plain files named by timestamp so an operator can recover one
 * with `cp` alone if the control panel itself is down — recovery tooling that
 * depends on the thing that broke is not recovery tooling.
 */
async function createBackup(note: string): Promise<string | null> {
  if (!(await configExists())) return null;
  await ensureBackupDir();

  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const target = path.join(BACKUP_DIR, `${id}.cfg`);
  await fs.copyFile(CONFIG_PATH, target);
  await fs.writeFile(path.join(BACKUP_DIR, `${id}.json`), JSON.stringify({ id, note }), 'utf8');

  await pruneBackups();
  return id;
}

async function pruneBackups(): Promise<void> {
  const backups = await listBackups();
  const { maxBackups } = await readSettings();
  const excess = backups.slice(maxBackups);
  await Promise.all(
    excess.flatMap((entry) => [
      fs.rm(path.join(BACKUP_DIR, `${entry.id}.cfg`), { force: true }),
      fs.rm(path.join(BACKUP_DIR, `${entry.id}.json`), { force: true }),
    ]),
  );
}

export async function listBackups(): Promise<BackupEntry[]> {
  await ensureBackupDir();
  const files = await fs.readdir(BACKUP_DIR);
  const entries = await Promise.all(
    files
      .filter((f) => f.endsWith('.cfg'))
      .map(async (file): Promise<BackupEntry> => {
        const id = file.replace(/\.cfg$/, '');
        const stat = await fs.stat(path.join(BACKUP_DIR, file));
        let note = '';
        try {
          const meta = JSON.parse(await fs.readFile(path.join(BACKUP_DIR, `${id}.json`), 'utf8'));
          note = typeof meta.note === 'string' ? meta.note : '';
        } catch {
          /* metadata is best-effort */
        }
        return { id, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size, note };
      }),
  );

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Removes one backup.
 *
 * Backups are pruned automatically to the configured retention, but that keeps the newest
 * regardless of what they contain — so a snapshot taken with a password in it,
 * or one an operator simply does not want kept, could only be removed from a
 * shell. Deleting the pair is enough; a missing file is treated as success so
 * that a half-removed backup can still be cleared.
 */
export async function deleteBackup(id: string): Promise<void> {
  const safe = /^[A-Za-z0-9-]+$/.test(id) ? id : null;
  if (!safe) throw new Error('Invalid backup id');

  await Promise.all([
    fs.rm(path.join(BACKUP_DIR, `${safe}.cfg`), { force: true }),
    fs.rm(path.join(BACKUP_DIR, `${safe}.json`), { force: true }),
  ]);
  logger.info({ backupId: safe }, 'config backup deleted');
}

export async function readBackup(id: string): Promise<string> {
  assertSafeBackupId(id);
  return fs.readFile(path.join(BACKUP_DIR, `${id}.cfg`), 'utf8');
}

/** Backup ids come from the client, so they must never escape the backup dir. */
function assertSafeBackupId(id: string): void {
  if (!/^[A-Za-z0-9\-]+$/.test(id)) throw new Error('Invalid backup id');
}

export interface SaveOptions {
  /** Revision the editor loaded; a mismatch means someone else saved first. */
  expectedRevision?: string;
  note?: string;
  /** Persist despite validation warnings/errors. Errors still block by default. */
  force?: boolean;
}

export async function saveConfig(
  content: string,
  options: SaveOptions = {},
): Promise<{ revision: string; backupId: string | null; problems: ConfigProblem[] }> {
  const problems = validateConfig(content);
  const blocking = problems.filter((p) => p.severity === 'error');
  if (blocking.length > 0 && !options.force) {
    throw new ConfigValidationError(blocking);
  }

  if (options.expectedRevision) {
    const current = await readConfig().catch(() => null);
    if (current && current.revision !== options.expectedRevision) {
      throw new ConfigConflictError(current.revision);
    }
  }

  const backupId = await createBackup(options.note ?? 'Saved from control panel');

  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });

  // Atomic replace: the game server may read this file at any moment, and a
  // torn write would leave it with a truncated config.
  const normalised = content.endsWith('\n') ? content : `${content}\n`;
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temp, normalised, 'utf8');
  await fs.rename(temp, CONFIG_PATH);

  logger.info({ backupId, bytes: normalised.length }, 'server config saved');
  return { revision: revisionOf(normalised), backupId, problems };
}
