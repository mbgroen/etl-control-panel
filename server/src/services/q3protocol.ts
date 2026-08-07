import dgram from 'node:dgram';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Quake 3 / ET: Legacy out-of-band UDP protocol.
 *
 * Connectionless packets are prefixed with four 0xFF bytes followed by an ASCII
 * command. The engine speaks a single-byte encoding, so every buffer here is
 * decoded as latin1 — decoding as UTF-8 corrupts high-byte characters that show
 * up in player names and silently breaks name matching for kick/ban.
 */
const OOB_PREFIX = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const WIRE_ENCODING = 'latin1' as const;

export interface QueryTarget {
  host: string;
  port: number;
  timeoutMs: number;
}

/** A single `key\value` map from an infoResponse / statusResponse header. */
export type InfoString = Record<string, string>;

export interface PlayerStatus {
  /** Server slot number. Only known when the data came from rcon `status`. */
  slot: number | null;
  name: string;
  /** Name with all `^x` colour escapes removed — use this for search and logs. */
  nameClean: string;
  score: number;
  ping: number;
  /** Present only from rcon `status`; null from the public getstatus query. */
  address: string | null;
  rate: number | null;
}

export interface ServerStatus {
  online: boolean;
  /** Round-trip time of the status query itself, in milliseconds. */
  latencyMs: number | null;
  hostname: string;
  hostnameClean: string;
  map: string;
  gametype: string;
  players: PlayerStatus[];
  maxClients: number;
  privateClients: number;
  /** True when the server requires a password to join. */
  needPass: boolean;
  version: string;
  mod: string;
  raw: InfoString;
  error?: string;
}

/**
 * Sends one out-of-band packet and gathers every datagram that comes back until
 * the socket goes quiet.
 *
 * Responses larger than one datagram (long rcon output, busy servers) arrive as
 * several packets with no length header and no terminator, so the only reliable
 * stop condition is a short idle gap after the first packet. `quietMs` is that
 * gap; `timeoutMs` bounds the wait for the *first* packet.
 */
export async function sendOob(
  target: QueryTarget,
  command: string,
  quietMs = 400,
): Promise<{ payloads: string[]; latencyMs: number }> {
  const socket = dgram.createSocket('udp4');
  const payloads: string[] = [];
  const startedAt = Date.now();

  try {
    return await new Promise<{ payloads: string[]; latencyMs: number }>((resolve, reject) => {
      let firstPacketAt: number | null = null;
      let quietTimer: NodeJS.Timeout | null = null;

      const overallTimer = setTimeout(() => {
        if (payloads.length > 0) {
          finish();
        } else {
          fail(new Error(`No response from ${target.host}:${target.port} after ${target.timeoutMs}ms`));
        }
      }, target.timeoutMs);

      function cleanup() {
        clearTimeout(overallTimer);
        if (quietTimer) clearTimeout(quietTimer);
        socket.removeAllListeners();
      }

      function finish() {
        cleanup();
        resolve({ payloads, latencyMs: (firstPacketAt ?? Date.now()) - startedAt });
      }

      function fail(err: Error) {
        cleanup();
        reject(err);
      }

      socket.on('error', fail);

      socket.on('message', (msg) => {
        // Strip the 0xFFFFFFFF connectionless header before handing the body on.
        const body = msg.subarray(0, 4).equals(OOB_PREFIX) ? msg.subarray(4) : msg;
        payloads.push(body.toString(WIRE_ENCODING));
        firstPacketAt ??= Date.now();

        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });

      const packet = Buffer.concat([OOB_PREFIX, Buffer.from(command, WIRE_ENCODING)]);
      socket.send(packet, target.port, target.host, (err) => {
        if (err) fail(err);
      });
    });
  } finally {
    // Safe to call even if the socket already errored out.
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Parses a `\key\value\key\value` info string.
 *
 * A trailing key with no value (which some mods emit) is kept with an empty
 * string rather than dropped, so round-tripping does not lose the key.
 */
export function parseInfoString(input: string): InfoString {
  const out: InfoString = {};
  const parts = input.replace(/^\\/, '').split('\\');
  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i];
    if (key === undefined || key === '') continue;
    out[key] = parts[i + 1] ?? '';
  }
  return out;
}

/**
 * Removes Quake 3 colour escapes.
 *
 * The engine treats `^` followed by any character other than another `^` as an
 * escape, so this deliberately strips things like `^ ` too — matching engine
 * behaviour matters more than intuition here.
 */
export function stripColors(input: string): string {
  return input.replace(/\^[^^]/g, '');
}

/** Parses the `score ping "name"` player lines of a statusResponse. */
function parseStatusPlayers(lines: string[]): PlayerStatus[] {
  const players: PlayerStatus[] = [];
  for (const line of lines) {
    const match = /^(-?\d+)\s+(\d+)\s+"(.*)"$/.exec(line.trim());
    if (!match) continue;
    const name = match[3] ?? '';
    players.push({
      slot: null,
      name,
      nameClean: stripColors(name),
      score: Number.parseInt(match[1] ?? '0', 10),
      ping: Number.parseInt(match[2] ?? '0', 10),
      address: null,
      rate: null,
    });
  }
  return players;
}

const GAMETYPE_NAMES: Record<string, string> = {
  '0': 'Single Player',
  '1': 'Cooperative',
  '2': 'Objective',
  '3': 'Stopwatch',
  '4': 'Campaign',
  '5': 'Last Man Standing',
  '6': 'Map Voting',
};

export function gametypeName(value: string | undefined): string {
  if (!value) return 'Unknown';
  return GAMETYPE_NAMES[value] ?? `Type ${value}`;
}

/**
 * Queries the game server with `getstatus`.
 *
 * Never throws: an unreachable or still-booting server is a normal state for a
 * dashboard to render, not an exception. Failures come back as
 * `{ online: false, error }`.
 */
export async function getServerStatus(target: QueryTarget): Promise<ServerStatus> {
  const offline = (error: string): ServerStatus => ({
    online: false,
    latencyMs: null,
    hostname: '',
    hostnameClean: '',
    map: '',
    gametype: '',
    players: [],
    maxClients: 0,
    privateClients: 0,
    needPass: false,
    version: '',
    mod: '',
    raw: {},
    error,
  });

  try {
    const { payloads, latencyMs } = await sendOob(target, 'getstatus', 250);
    const text = payloads.join('');
    const lines = text.split('\n');

    if (!lines[0]?.startsWith('statusResponse')) {
      return offline('Unexpected response to getstatus');
    }

    const info = parseInfoString(lines[1] ?? '');
    const hostname = info.sv_hostname ?? '';

    return {
      online: true,
      latencyMs,
      hostname,
      hostnameClean: stripColors(hostname),
      map: info.mapname ?? '',
      gametype: gametypeName(info.g_gametype),
      players: parseStatusPlayers(lines.slice(2)),
      maxClients: Number.parseInt(info.sv_maxclients ?? '0', 10) || 0,
      privateClients: Number.parseInt(info.sv_privateClients ?? '0', 10) || 0,
      needPass: (info.g_needpass ?? '0') !== '0',
      version: info.version ?? '',
      mod: info.gamename ?? info.gamedir ?? '',
      raw: info,
    };
  } catch (err) {
    return offline(err instanceof Error ? err.message : String(err));
  }
}

export class RconError extends Error {
  constructor(
    message: string,
    readonly kind: 'no-password' | 'bad-password' | 'timeout' | 'unknown',
  ) {
    super(message);
    this.name = 'RconError';
  }
}

/**
 * Executes an rcon command and returns the server's printed output.
 *
 * Note that rcon is an unauthenticated-by-design UDP protocol: the password
 * travels in cleartext. It is only ever sent to the configured game server
 * address, and the password itself is never returned to API clients.
 */
export async function rcon(
  target: QueryTarget,
  password: string,
  command: string,
): Promise<string> {
  if (!password) {
    throw new RconError('No rcon password is configured for the dashboard', 'no-password');
  }

  let payloads: string[];
  try {
    ({ payloads } = await sendOob(target, `rcon ${password} ${command}`, 600));
  } catch (err) {
    throw new RconError(
      err instanceof Error ? err.message : String(err),
      /timed out|No response/i.test(String(err)) ? 'timeout' : 'unknown',
    );
  }

  const output = payloads
    .map((p) => (p.startsWith('print\n') ? p.slice('print\n'.length) : p))
    .join('');

  if (/Bad rconpassword|Invalid password/i.test(output)) {
    throw new RconError('The game server rejected the rcon password', 'bad-password');
  }
  if (/No rconpassword set on the server/i.test(output)) {
    throw new RconError('The game server has no rconpassword set', 'no-password');
  }

  return output.replace(/\0/g, '').trimEnd();
}

/**
 * Parses the table produced by the rcon `status` command, which — unlike the
 * public getstatus query — includes slot numbers and client addresses. Slot
 * numbers are what `clientkick` and `ban` take as arguments.
 */
export function parseRconStatus(output: string): { map: string; players: PlayerStatus[] } {
  const lines = output.split('\n');
  const map = /^map:\s*(\S+)/m.exec(output)?.[1] ?? '';
  const players: PlayerStatus[] = [];

  for (const line of lines) {
    const player = parseRconStatusRow(line);
    if (player) players.push(player);
  }

  return { map, players };
}

const isUnsignedInteger = (token: string): boolean => /^\d+$/.test(token);

/**
 * Parses one row of the rcon `status` table.
 *
 * The engine prints `%3i %5i %4i %-*s %7i %-21s %5i %5i %i` — num, score, ping,
 * name, lastmsg, address, qport, rate, lastConnectTime. Two properties of that
 * make a single anchored regex the wrong tool: the name column is variable
 * width and may contain spaces, and the number of trailing integer columns
 * differs between engine versions and mods (ET:Legacy appends lastConnectTime;
 * stock ET does not). Matching a fixed field count silently yields *no players
 * at all* rather than a visibly wrong row, which is a miserable failure to
 * diagnose from the UI.
 *
 * So anchor on the address instead. Every column to its right is an integer and
 * the address never is — it holds an IPv4 or IPv6 address, `loopback`, or `bot`
 * — which makes the last non-integer token the address, whatever follows it.
 * The name is then everything between the ping and the lastmsg that precedes it.
 */
function parseRconStatusRow(line: string): PlayerStatus | null {
  const tokens = line.trim().split(/\s+/);
  // At minimum: num, score, ping, name, lastmsg, address, qport.
  if (tokens.length < 7) return null;
  // Skips the header, the dashed separator, and any surrounding prose.
  if (!isUnsignedInteger(tokens[0] ?? '')) return null;
  if (!/^-?\d+$/.test(tokens[1] ?? '')) return null;

  // Index 5 is the earliest an address can sit — anything before it would leave
  // no room for a name, and index 2 may be a non-numeric ping state.
  let addressAt = -1;
  for (let index = tokens.length - 1; index >= 5; index--) {
    if (!isUnsignedInteger(tokens[index] ?? '')) {
      addressAt = index;
      break;
    }
  }
  if (addressAt === -1) return null;

  const name = tokens.slice(3, addressAt - 1).join(' ');
  if (!name) return null;

  // Connecting, demo and zombie clients print DEMO/CNCT/ZMBI here instead of a
  // number. They are still real occupants of a slot, so report them with an
  // unknown ping rather than dropping the row.
  const ping = Number.parseInt(tokens[2] ?? '', 10);
  const rate = Number.parseInt(tokens[addressAt + 2] ?? '', 10);

  return {
    slot: Number.parseInt(tokens[0] ?? '0', 10),
    name,
    nameClean: stripColors(name),
    score: Number.parseInt(tokens[1] ?? '0', 10),
    ping: Number.isNaN(ping) ? 0 : ping,
    address: tokens[addressAt] ?? null,
    rate: Number.isNaN(rate) || rate === 0 ? null : rate,
  };
}

/** Waits for the server to answer getstatus again, e.g. after a restart. */
export async function waitForServer(target: QueryTarget, attempts = 15): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const status = await getServerStatus({ ...target, timeoutMs: 1_000 });
    if (status.online) return true;
    await delay(1_000);
  }
  return false;
}
