/**
 * Country presentation.
 *
 * Flags are built from the country code rather than shipped as images: every
 * ISO 3166-1 alpha-2 code maps to a pair of regional indicator symbols, so
 * there is no sprite sheet to bundle, nothing to fetch, and no missing-image
 * gap for a country nobody anticipated.
 */

const REGIONAL_INDICATOR_A = 0x1f1e6;
const LETTER_A = 'A'.charCodeAt(0);

/** Flag emoji for a country code, or null when the code is not a country. */
export function flagFor(countryCode: string | null): string | null {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  return [...countryCode.toUpperCase()]
    .map((letter) => String.fromCodePoint(REGIONAL_INDICATOR_A + letter.charCodeAt(0) - LETTER_A))
    .join('');
}

export type AddressKind = 'public' | 'private' | 'loopback' | 'bot' | 'unknown' | null;

export interface CountryLabel {
  /** Flag emoji, or null when an icon should be shown instead. */
  flag: string | null;
  /** Short text beside the flag or icon. */
  text: string;
  /** Fuller wording for a tooltip, explaining why there is no country. */
  title: string;
  /** Which non-country icon to draw, if any. */
  icon: 'home' | 'server' | 'bot' | 'unknown' | null;
}

/**
 * Turns an address classification into something displayable.
 *
 * A blank cell would leave the reader guessing whether the lookup failed, the
 * player is local, or the feature is off — three different situations that
 * deserve three different answers.
 */
export function countryLabel(
  countryCode: string | null,
  countryName: string | null,
  kind: AddressKind,
): CountryLabel {
  const flag = flagFor(countryCode);
  if (flag) {
    return {
      flag,
      text: countryName ?? countryCode ?? '',
      title: countryName ?? countryCode ?? '',
      icon: null,
    };
  }

  switch (kind) {
    case 'private':
      return {
        flag: null,
        text: 'Local network',
        title: 'A private address on your own network, which has no country to look up.',
        icon: 'home',
      };
    case 'loopback':
      return {
        flag: null,
        text: 'This host',
        title: 'Connected from the machine running the server itself.',
        icon: 'server',
      };
    case 'bot':
      return { flag: null, text: 'Bot', title: 'A bot, not a connected player.', icon: 'bot' };
    case 'public':
      return {
        flag: null,
        text: 'Unknown',
        title: 'A public address whose country could not be determined.',
        icon: 'unknown',
      };
    default:
      return {
        flag: null,
        text: 'Unknown',
        title: 'No address is available for this player. RCON is required to see addresses.',
        icon: 'unknown',
      };
  }
}

/** "2h 14m" / "6m 30s" — compact enough for a table cell. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
