/**
 * The subset of ET: Legacy cvars the dashboard exposes as a form.
 *
 * This is deliberately a curated list, not everything the engine accepts: a
 * form with 300 fields is worse than a text editor. Anything not here is still
 * editable in the raw editor, which stays the source of truth.
 *
 * `appliesOn` is the honest answer to "why did nothing change?" — many cvars
 * are latched by the engine and only take effect on a map change or restart.
 */

export type CvarKind = 'text' | 'number' | 'boolean' | 'select' | 'password';

export interface CvarSpec {
  key: string;
  label: string;
  kind: CvarKind;
  hint?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  appliesOn: 'immediately' | 'map-change' | 'restart';
}

export interface CvarSection {
  id: string;
  title: string;
  description: string;
  cvars: CvarSpec[];
}

export const CVAR_SECTIONS: CvarSection[] = [
  {
    id: 'identity',
    title: 'Identity',
    description: 'How your server presents itself in the in-game browser.',
    cvars: [
      {
        key: 'sv_hostname',
        label: 'Server name',
        kind: 'text',
        hint: 'Colour codes work: ^1 red, ^2 green, ^3 yellow, ^4 blue, ^7 white.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_motd',
        label: 'Message of the day',
        kind: 'text',
        hint: 'Shown to players as they connect.',
        appliesOn: 'map-change',
      },
      {
        key: 'dedicated',
        label: 'Server visibility',
        kind: 'select',
        options: [
          { value: '0', label: 'Listen server (not dedicated)' },
          { value: '1', label: 'Dedicated — LAN only' },
          { value: '2', label: 'Dedicated — advertised on the internet' },
        ],
        hint: 'Use "internet" so the master servers list you publicly.',
        appliesOn: 'restart',
      },
    ],
  },
  {
    id: 'slots',
    title: 'Players & access',
    description: 'Capacity and who is allowed in.',
    cvars: [
      {
        key: 'sv_maxclients',
        label: 'Maximum players',
        kind: 'number',
        min: 1,
        max: 64,
        hint: 'Includes private slots. 20–32 is typical for objective play.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_privateClients',
        label: 'Reserved slots',
        kind: 'number',
        min: 0,
        max: 32,
        hint: 'Held back for people who know the private password.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_privatePassword',
        label: 'Private slot password',
        kind: 'password',
        hint: 'Required to claim a reserved slot.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_password',
        label: 'Server password',
        kind: 'password',
        hint: 'Leave empty for a public server. Setting it makes the server private.',
        appliesOn: 'immediately',
      },
      {
        key: 'rconpassword',
        label: 'RCON password',
        kind: 'password',
        hint: 'Unlocks the console and player kick/ban. The dashboard picks this up immediately — nothing to copy elsewhere, no restart.',
        appliesOn: 'immediately',
      },
    ],
  },
  {
    id: 'gameplay',
    title: 'Gameplay',
    description: 'Match rules and the feel of the game.',
    cvars: [
      {
        key: 'g_gametype',
        label: 'Game type',
        kind: 'select',
        options: [
          { value: '2', label: 'Objective' },
          { value: '3', label: 'Stopwatch' },
          { value: '4', label: 'Campaign' },
          { value: '5', label: 'Last Man Standing' },
          { value: '6', label: 'Map Voting' },
        ],
        hint: 'Objective is the classic single-map mode; Campaign chains maps from a campaign file.',
        appliesOn: 'map-change',
      },
      {
        key: 'timelimit',
        label: 'Time limit (minutes)',
        kind: 'number',
        min: 0,
        max: 180,
        hint: '0 disables the timer. Most objective maps are designed around 20–30.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_friendlyFire',
        label: 'Friendly fire',
        kind: 'boolean',
        hint: 'Teammates can damage each other.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_speed',
        label: 'Movement speed',
        kind: 'number',
        min: 100,
        max: 1_000,
        hint: 'Default is 320. Changing it noticeably alters the game feel.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_gravity',
        label: 'Gravity',
        kind: 'number',
        min: 100,
        max: 2_000,
        hint: 'Default is 800.',
        appliesOn: 'map-change',
      },
      {
        key: 'sv_floodProtect',
        label: 'Flood protection',
        kind: 'boolean',
        hint: 'Rate-limits chat and commands from a single client.',
        appliesOn: 'immediately',
      },
    ],
  },
  {
    id: 'network',
    title: 'Network & downloads',
    description: 'Bandwidth limits and how clients fetch custom content.',
    cvars: [
      {
        key: 'net_port',
        label: 'UDP port',
        kind: 'number',
        min: 1,
        max: 65_535,
        hint: 'Must match the published port in your compose file.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_maxRate',
        label: 'Maximum client rate',
        kind: 'number',
        min: 1_000,
        max: 100_000,
        hint: '25000 is a sensible modern default; the engine default is far too low.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_allowDownload',
        label: 'Allow downloads',
        kind: 'boolean',
        hint: 'Lets clients fetch maps they are missing. Turn off and players simply cannot join.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_dl_maxRate',
        label: 'In-game download rate',
        kind: 'number',
        min: 1_000,
        max: 100_000,
        hint: 'Only used when FastDL is off. Manage FastDL itself on the Maps & FastDL page.',
        appliesOn: 'immediately',
      },
    ],
  },
];

export const APPLIES_LABEL: Record<CvarSpec['appliesOn'], string> = {
  immediately: 'Applies immediately',
  'map-change': 'Applies on next map',
  restart: 'Requires a restart',
};

/** Every key the form knows about, for splitting known from unknown cvars. */
export const KNOWN_KEYS = new Set(
  CVAR_SECTIONS.flatMap((section) => section.cvars.map((cvar) => cvar.key.toLowerCase())),
);
