import { logger } from '../logger.js';

/**
 * Country lookup for player addresses.
 *
 * Players connect from the public internet, so an address usually does resolve
 * to a country — unlike anything on the operator's own LAN, which is why
 * private ranges are labelled rather than looked up. They are also never sent
 * anywhere: a request for 192.168.1.20 would tell a third party about the
 * operator's network and get "unknown" back.
 *
 * Lookups are cached for the process lifetime, done one address at a time in
 * the background, and never block a response. A player list that renders
 * without a flag is fine; one that waits on someone else's API is not.
 */

export type AddressKind = 'public' | 'private' | 'loopback' | 'bot' | 'unknown';

export interface GeoResult {
  kind: AddressKind;
  /** ISO 3166-1 alpha-2, uppercase. Null unless the lookup succeeded. */
  countryCode: string | null;
  countryName: string | null;
}

/** Strips the port and any IPv6 brackets from an engine-reported address. */
export function normaliseAddress(raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1] ?? '';

  // IPv4 with a port, or a bare IPv4. A bare IPv6 has several colons, so only
  // split when there is exactly one.
  const parts = value.split(':');
  if (parts.length === 2) return parts[0] ?? '';
  return value;
}

/**
 * Classifies an address without contacting anything.
 *
 * RFC 1918, carrier-grade NAT, link-local and loopback all mean "not something
 * a geo database can answer", and are far more common in this application than
 * the failure cases of an actual lookup.
 */
export function classify(raw: string): AddressKind {
  const address = normaliseAddress(raw).toLowerCase();
  if (!address) return 'unknown';
  if (address === 'bot') return 'bot';
  if (address === 'loopback' || address === '::1' || address.startsWith('127.')) return 'loopback';

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 169 && b === 254) return 'private';
    // Carrier-grade NAT: a real internet address, but shared and not locatable
    // to anything more useful than the carrier.
    if (a === 100 && b >= 64 && b <= 127) return 'private';
    if (a === 0 || a >= 224) return 'unknown';
    return 'public';
  }

  if (address.includes(':')) {
    // Unique-local and link-local IPv6.
    if (/^f[cd]/.test(address) || address.startsWith('fe80')) return 'private';
    return 'public';
  }

  return 'unknown';
}

const cache = new Map<string, GeoResult>();
const inFlight = new Set<string>();

/** What is known right now, without waiting for anything. */
export function lookupCached(raw: string): GeoResult {
  const address = normaliseAddress(raw);
  const kind = classify(address);

  if (kind !== 'public') return { kind, countryCode: null, countryName: null };
  return cache.get(address) ?? { kind, countryCode: null, countryName: null };
}

/**
 * Resolves an address in the background, if it is worth resolving.
 *
 * Deliberately returns nothing: callers record what they know and the flag
 * appears on a later refresh. Making them await this would put a third party's
 * latency in front of the player list.
 */
export function resolveInBackground(raw: string, enabled: boolean): void {
  if (!enabled) return;

  const address = normaliseAddress(raw);
  if (classify(address) !== 'public') return;
  if (cache.has(address) || inFlight.has(address)) return;

  inFlight.add(address);
  void lookup(address)
    .then((result) => {
      if (result) cache.set(address, result);
    })
    .finally(() => inFlight.delete(address));
}

async function lookup(address: string): Promise<GeoResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    // ipwho.is: no key, no registration, HTTPS, and it answers with the country
    // code directly. Only the address is sent — nothing about the player.
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(address)}?fields=success,country,country_code`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      success?: boolean;
      country?: string;
      country_code?: string;
    };
    if (!body.success || typeof body.country_code !== 'string') return null;

    return {
      kind: 'public',
      countryCode: body.country_code.toUpperCase(),
      countryName: typeof body.country === 'string' ? body.country : null,
    };
  } catch (err) {
    // A failed lookup is not worth a warning per player; the column simply
    // stays empty and will be retried next time the process restarts.
    logger.debug({ err, address }, 'country lookup failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Test seam. */
export function resetGeoCache(): void {
  cache.clear();
  inFlight.clear();
}
