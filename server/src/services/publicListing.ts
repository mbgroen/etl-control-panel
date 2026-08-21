import { env } from '../env.js';
import { logger } from '../logger.js';
import { sendOob } from './q3protocol.js';
import { cvarMap, readConfig } from './serverConfig.js';

/**
 * Is the server listed where players can actually reach it?
 *
 * A server registers with the master by sending a heartbeat, and that heartbeat
 * carries no address and no port — sv_main.c writes `heartbeat <msg>` and
 * nothing more. The master takes both from the packet's source, which means any
 * NAT between the server and the master decides what the public browser will
 * advertise. Behind a Docker bridge with a published port, the outbound packet
 * is masqueraded to a random high port, so the browser sends every player to a
 * port nothing is listening on.
 *
 * Nothing about that is visible from the server itself. It is listed. It
 * answers getstatus on the real port. The map rotates and the bots play. The
 * only symptom is that no human ever arrives, which reads like a quiet server
 * rather than a broken one — this check exists because that cost a week to find
 * by hand.
 *
 * Two outbound requests, and only when the config says the server is meant to
 * be public: one to learn this host's public address, one to ask the master
 * what it holds. Neither sends anything about players.
 */

/** The list every ET client and browser reads. Others exist; this is the one. */
const MASTER = 'master.etlegacy.com';
const MASTER_PORT = 27950;

/** ET's network protocol version. The master keys its list by it. */
const PROTOCOL = 84;

/** dedicated 2 is "public internet server"; 1 is LAN-only. */
const DEDICATED_PUBLIC = '2';

/** sv_advert bit 1: report to the master servers at all. */
const ADVERT_MASTER = 1;

/**
 * How long an answer is reused.
 *
 * The master is someone else's machine and the answer changes on the order of
 * minutes — the engine heartbeats every five. Re-asking on every Diagnostics
 * load would be rude and would tell us nothing new.
 */
const CACHE_MS = 10 * 60 * 1000;

export interface ListingStatus {
  /** False when this server is not trying to be public at all. */
  advertised: boolean;
  /** This host as the internet sees it, when it could be determined. */
  publicIp: string | null;
  /** The port the engine binds, from net_port. */
  expectedPort: number;
  /** What the master advertises for this address. Empty when it has nothing. */
  listedPorts: number[];
  ok: boolean;
  detail: string;
  remedy: string | null;
}

let cached: { at: number; value: ListingStatus } | null = null;

/**
 * Parses a getserversResponse.
 *
 * The payload is `getserversResponse` followed by one record per server:
 * a backslash, four address bytes, two port bytes big-endian, and finally the
 * literal `EOT`. It arrives here as latin1, where one character is one byte, so
 * it can be walked as a string without a second decode.
 *
 * A record whose port is zero is a padding artefact rather than a server, and
 * a truncated tail is simply ignored: half an address is not worth guessing at.
 */
export function parseServerList(payload: string): { ip: string; port: number }[] {
  const start = payload.indexOf('getserversResponse');
  if (start === -1) return [];

  const body = payload.slice(start + 'getserversResponse'.length);
  const servers: { ip: string; port: number }[] = [];

  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') continue;
    if (body.startsWith('EOT', i + 1)) break;
    if (i + 7 > body.length) break;

    const bytes = [1, 2, 3, 4].map((offset) => body.charCodeAt(i + offset) & 0xff);
    const port = ((body.charCodeAt(i + 5) & 0xff) << 8) | (body.charCodeAt(i + 6) & 0xff);
    if (port === 0) continue;

    servers.push({ ip: bytes.join('.'), port });
    i += 6;
  }

  return servers;
}

/** Asks the master for every server it holds for this protocol. */
async function askMaster(): Promise<{ ip: string; port: number }[]> {
  const { payloads } = await sendOob(
    { host: MASTER, port: MASTER_PORT, timeoutMs: 5_000 },
    `getservers ${PROTOCOL} empty full`,
    600,
  );
  return parseServerList(payloads.join(''));
}

/** This host's address as the internet sees it. */
async function publicAddress(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch('https://ipwho.is/?fields=ip', { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { ip?: unknown };
    return typeof body.ip === 'string' ? body.ip : null;
  } catch (err) {
    logger.debug({ err }, 'could not determine the public address');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The port the engine actually binds.
 *
 * net_port in the config, since that is what the game server reads. ETL_PORT is
 * how the *control panel* reaches it, which on a host-networked server is the
 * same number and on a bridged one need not be.
 */
async function expectedPort(): Promise<number> {
  const config = await readConfig().catch(() => null);
  const raw = config ? cvarMap(config.content).net_port : undefined;
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : env.ETL_PORT;
}

async function evaluate(): Promise<ListingStatus> {
  const port = await expectedPort();
  const config = await readConfig().catch(() => null);
  const cvars = config ? cvarMap(config.content) : {};

  // Engine defaults: dedicated 2, sv_advert 1. A config that says nothing is a
  // public server, so absence must not read as "not advertised".
  const dedicated = cvars.dedicated ?? DEDICATED_PUBLIC;
  const advert = Number.parseInt(cvars.sv_advert ?? '1', 10);

  if (dedicated !== DEDICATED_PUBLIC || !(advert & ADVERT_MASTER)) {
    return {
      advertised: false,
      publicIp: null,
      expectedPort: port,
      listedPorts: [],
      ok: true,
      detail:
        dedicated !== DEDICATED_PUBLIC
          ? 'Not a public server (dedicated is not 2), so nothing is advertised'
          : 'sv_advert does not include the master servers, so nothing is advertised',
      remedy: null,
    };
  }

  const [ip, servers] = await Promise.all([publicAddress(), askMaster()]);

  if (!ip) {
    return {
      advertised: true,
      publicIp: null,
      expectedPort: port,
      listedPorts: [],
      ok: true,
      detail: 'Could not determine this host’s public address, so the listing was not checked',
      remedy: null,
    };
  }

  const listedPorts = servers.filter((server) => server.ip === ip).map((server) => server.port);

  if (listedPorts.length === 0) {
    return {
      advertised: true,
      publicIp: ip,
      expectedPort: port,
      listedPorts,
      ok: false,
      detail: `${MASTER} holds no entry for ${ip}, so the server is not in the public browser`,
      remedy:
        'A restart takes a few minutes to reappear: the engine heartbeats every five, and the master verifies before listing. If it stays missing, check that the game server reaches the internet and that sv_advert includes the master servers.',
    };
  }

  if (listedPorts.includes(port)) {
    return {
      advertised: true,
      publicIp: ip,
      expectedPort: port,
      listedPorts,
      ok: true,
      detail: `Listed as ${ip}:${port} — the port the server is on`,
      remedy: null,
    };
  }

  return {
    advertised: true,
    publicIp: ip,
    expectedPort: port,
    listedPorts,
    ok: false,
    detail: `Listed as ${ip}:${listedPorts.join(', ')}, but the server is on ${port}. Everyone who clicks Join is sent to a port nothing answers on.`,
    remedy:
      'Outbound NAT rewrote the heartbeat’s source port, and the master believes what it saw. Run the game server on the host network (network_mode: host) so the heartbeat leaves from the real port — the compose files in the repository do this.',
  };
}

/** The cached verdict, refreshed at most every CACHE_MS. */
export async function status(): Promise<ListingStatus> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  try {
    const value = await evaluate();
    cached = { at: Date.now(), value };
    return value;
  } catch (err) {
    const value: ListingStatus = {
      advertised: true,
      publicIp: null,
      expectedPort: env.ETL_PORT,
      listedPorts: [],
      ok: true,
      detail: `Could not reach ${MASTER}: ${err instanceof Error ? err.message : String(err)}`,
      remedy: null,
    };
    // Cached too, so a master that is down does not mean a slow Diagnostics
    // page on every load.
    cached = { at: Date.now(), value };
    return value;
  }
}
