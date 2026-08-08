import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { readSettings } from './dashboardSettings.js';
import { classify, lookupCached, normaliseAddress, resolveInBackground } from './geoip.js';
import type { PlayerStatus } from './q3protocol.js';

/**
 * Who has played here, and for how long.
 *
 * The game server keeps no history: query it and you learn who is connected
 * this second. Anyone who left is gone without trace, so "has anyone been using
 * my server?" was unanswerable — which is the question an operator running a
 * public server actually has.
 *
 * Sessions are derived from the status the dashboard already polls. A player
 * present in one poll and absent from the next has left; the gap between their
 * first and last sighting is how long they stayed. That makes the resolution
 * one poll interval, which for "played for 40 minutes" is ample and costs the
 * game server nothing extra.
 */

const HISTORY_FILE = path.join(env.STATE_PATH, 'player-sessions.json');



/**
 * A player must be missing this long before the session is closed.
 *
 * A single dropped status reply — one lost UDP packet — would otherwise end
 * everyone's session and start a new one, turning one evening into a shredded
 * list of two-minute visits.
 *
 * Kept short because it is dead time: someone who has left is in neither list
 * until it elapses. Four missed polls at the default interval is already far
 * more tolerance than a lost packet needs.
 */
const ABSENCE_GRACE_MS = 45_000;

export interface PlayerSession {
  id: string;
  name: string;
  nameClean: string;
  /** Null when rcon is unavailable: the public query does not expose addresses. */
  address: string | null;
  countryCode: string | null;
  countryName: string | null;
  addressKind: 'public' | 'private' | 'loopback' | 'bot' | 'unknown' | null;
  joinedAt: string;
  lastSeenAt: string;
  /** Null while the player is still connected. */
  leftAt: string | null;
  seconds: number;
}

interface OpenSession extends PlayerSession {
  missingSince: number | null;
}

let open = new Map<string, OpenSession>();
let history: PlayerSession[] | null = null;
let geoEnabled = env.GEO_LOOKUP;

/**
 * Identity for matching a player across polls.
 *
 * The cleaned name alone, deliberately. The address would be a stronger signal
 * but only appears once an rcon query has run, so a key including it would
 * change the moment the address became known — closing the session that was
 * open and starting a second one for the same player still sitting there.
 *
 * The cost is that two players using the same name at once count as one
 * session. On a server small enough to be watched this way that is rare, and
 * far less confusing than a list that splits one visit in two.
 */
function keyFor(player: { nameClean: string }): string {
  return player.nameClean;
}

async function loadHistory(): Promise<PlayerSession[]> {
  if (history) return history;
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    history = Array.isArray(parsed) ? (parsed as PlayerSession[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err }, 'could not read the player session history — starting empty');
    }
    history = [];
  }
  return history;
}

async function persistHistory(): Promise<void> {
  if (!history) return;
  try {
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    const temp = `${HISTORY_FILE}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
    await fs.rename(temp, HISTORY_FILE);
  } catch (err) {
    logger.warn({ err }, 'could not persist the player session history');
  }
}

const secondsBetween = (fromIso: string, toIso: string): number =>
  Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1_000));

/** Enables or disables outbound country lookups. */
export function setGeoLookupEnabled(enabled: boolean): void {
  geoEnabled = enabled;
}

/**
 * Reconciles the players seen in one poll against the open sessions.
 *
 * `players` carries addresses only when the caller had rcon available; without
 * it the tracking still works, just without a country.
 */
export async function observe(players: PlayerStatus[], observedAt = new Date()): Promise<void> {
  await loadHistory();

  const now = observedAt.getTime();
  const nowIso = observedAt.toISOString();
  const seen = new Set<string>();

  for (const player of players) {
    const address = player.address ? normaliseAddress(player.address) : null;
    const key = keyFor(player);
    seen.add(key);

    if (address) resolveInBackground(address, geoEnabled);
    const geo = address ? lookupCached(address) : null;

    const existing = open.get(key);
    if (existing) {
      existing.lastSeenAt = nowIso;
      existing.missingSince = null;
      existing.seconds = secondsBetween(existing.joinedAt, nowIso);
      // A country may only arrive once the background lookup finishes.
      if (address && !existing.address) {
        existing.address = address;
        existing.addressKind = classify(address);
      }
      if (geo?.countryCode && !existing.countryCode) {
        existing.countryCode = geo.countryCode;
        existing.countryName = geo.countryName;
      }
      continue;
    }

    open.set(key, {
      id: `${now.toString(36)}-${key}`,
      name: player.name,
      nameClean: player.nameClean,
      address,
      countryCode: geo?.countryCode ?? null,
      countryName: geo?.countryName ?? null,
      addressKind: address ? classify(address) : null,
      joinedAt: nowIso,
      lastSeenAt: nowIso,
      leftAt: null,
      seconds: 0,
      missingSince: null,
    });
  }

  let closedAny = false;
  for (const [key, session] of open) {
    if (seen.has(key)) continue;

    if (session.missingSince === null) {
      session.missingSince = now;
      continue;
    }
    if (now - session.missingSince < ABSENCE_GRACE_MS) continue;

    const { missingSince: _missingSince, ...finished } = session;
    // Credited to the last time they were actually seen, not to the moment the
    // grace period ran out.
    finished.leftAt = session.lastSeenAt;
    finished.seconds = secondsBetween(session.joinedAt, session.lastSeenAt);
    history?.unshift(finished);
    open.delete(key);
    closedAny = true;
  }

  if (closedAny && history) {
    const { maxPlayerSessions } = await readSettings();
    history.length = Math.min(history.length, maxPlayerSessions);
    await persistHistory();
  }
}

/**
 * Sessions in progress, longest-connected first.
 *
 * Only players seen in the most recent poll. A session inside its grace period
 * is still open — so a dropped reply does not split the visit — but it is not
 * reported as playing, because it isn't: the Overview reads the live server
 * directly, and the two pages contradicting each other is worse than a brief
 * gap before the visit shows up under earlier ones.
 */
export function current(): PlayerSession[] {
  const nowIso = new Date().toISOString();
  return [...open.values()]
    .filter((session) => session.missingSince === null)
    .map(({ missingSince: _missingSince, ...session }) => ({
      ...session,
      seconds: secondsBetween(session.joinedAt, nowIso),
      // Fill in a country that arrived after the session opened.
      ...(session.countryCode
        ? {}
        : session.address
          ? {
              countryCode: lookupCached(session.address).countryCode,
              countryName: lookupCached(session.address).countryName,
            }
          : {}),
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

export async function recent(limit = 100): Promise<PlayerSession[]> {
  const stored = await loadHistory();
  return stored.slice(0, Math.max(1, limit));
}

/** Removes specific finished visits. Returns how many actually went. */
export async function forget(ids: string[]): Promise<number> {
  const stored = await loadHistory();
  const wanted = new Set(ids);
  const remaining = stored.filter((session) => !wanted.has(session.id));
  const removed = stored.length - remaining.length;

  if (removed > 0) {
    history = remaining;
    await persistHistory();
    logger.info({ removed }, 'player visits deleted');
  }
  return removed;
}

/** Clears the whole history. Sessions in progress are untouched. */
export async function forgetAll(): Promise<number> {
  const stored = await loadHistory();
  history = [];
  await persistHistory();
  logger.info({ removed: stored.length }, 'player visit history cleared');
  return stored.length;
}

/** Aggregate view: who has been here, how often, and for how long in total. */
export async function summary(): Promise<{
  totalSessions: number;
  uniquePlayers: number;
  countries: { code: string; name: string | null; sessions: number }[];
}> {
  const stored = await loadHistory();
  const all = [...stored, ...current()];

  const byCountry = new Map<string, { name: string | null; sessions: number }>();
  for (const session of all) {
    if (!session.countryCode) continue;
    const entry = byCountry.get(session.countryCode) ?? { name: session.countryName, sessions: 0 };
    entry.sessions += 1;
    byCountry.set(session.countryCode, entry);
  }

  return {
    totalSessions: all.length,
    uniquePlayers: new Set(all.map((session) => session.nameClean)).size,
    countries: [...byCountry.entries()]
      .map(([code, entry]) => ({ code, name: entry.name, sessions: entry.sessions }))
      .sort((a, b) => b.sessions - a.sessions),
  };
}

/** Test seam. */
export function resetPlayerSessions(): void {
  open = new Map();
  history = null;
}
