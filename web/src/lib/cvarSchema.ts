/**
 * The ET: Legacy server settings the control panel exposes as a form.
 *
 * Names and defaults are taken from the configs the official server image
 * ships — etl_server.cfg and legacy.cfg — rather than from memory, because a
 * misspelled cvar is written to the file, silently ignored by the engine, and
 * looks exactly like a setting that does not work.
 *
 * The coverage deliberately matches what the game's own HOST menus offer, plus
 * the server-side settings those menus leave out. Anything not here is still
 * editable in the raw editor, which remains the source of truth.
 *
 * `appliesOn` is the honest answer to "why did nothing change?" — many cvars
 * are latched by the engine and only take effect on a map change or restart.
 */

export type CvarKind = 'text' | 'number' | 'boolean' | 'select' | 'password' | 'flags';

export interface CvarSpec {
  key: string;
  label: string;
  kind: CvarKind;
  hint?: string;
  /**
   * What the engine uses when the config does not mention this cvar.
   *
   * Shown in the field when the setting is absent, because "not in the file"
   * is not "off": vote_allow_kick defaults to 1, and a form that renders an
   * unset toggle as off tells the operator the opposite of the truth. Taken
   * from g_cvars.c and the engine's own Cvar_Get calls at v2.84.0 — where both
   * register a cvar, the engine wins, since it registers first and Cvar_Get
   * keeps the value an existing cvar already has.
   */
  defaultValue?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /**
   * For `flags`: the bits of a bitmask cvar, each shown as its own checkbox.
   *
   * The engine takes one number, which is why a config guide will tell you to
   * write 15 and leave you to work out what you just switched off.
   */
  flags?: { bit: number; label: string; hint?: string }[];
  appliesOn: 'immediately' | 'map-change' | 'restart';
  /** Hidden behind "Show advanced" — correct defaults, rarely worth touching. */
  advanced?: boolean;
  /**
   * Hidden behind "Expert" on top of advanced.
   *
   * For settings that point at files, load code, or run bots: getting one wrong
   * does not tune the server, it stops it from starting. They belong in the
   * control panel — hunting for them in a text editor is worse — but not one
   * mis-click away from someone looking for the round timer.
   */
  expert?: boolean;
}

export interface CvarSection {
  id: string;
  title: string;
  description: string;
  cvars: CvarSpec[];
}

const onOff = (onLabel = 'Enabled', offLabel = 'Disabled') => [
  { value: '1', label: onLabel },
  { value: '0', label: offLabel },
];

/** Every vote the engine can be asked to allow, as the game's menu lists them. */
const VOTES: { key: string; defaultValue: string; label: string }[] = [
  { key: 'vote_allow_config', defaultValue: '1', label: 'Game config' },
  { key: 'vote_allow_gametype', defaultValue: '1', label: 'Game type' },
  { key: 'vote_allow_kick', defaultValue: '1', label: 'Kick a player' },
  { key: 'vote_allow_map', defaultValue: '1', label: 'Change map' },
  { key: 'vote_allow_maprestart', defaultValue: '1', label: 'Restart map' },
  { key: 'vote_allow_matchreset', defaultValue: '1', label: 'Reset match' },
  { key: 'vote_allow_mutespecs', defaultValue: '1', label: 'Mute spectators' },
  { key: 'vote_allow_muting', defaultValue: '1', label: 'Mute a player' },
  { key: 'vote_allow_nextmap', defaultValue: '1', label: 'Next map' },
  { key: 'vote_allow_referee', defaultValue: '0', label: 'Grant referee' },
  { key: 'vote_allow_shuffleteams', defaultValue: '1', label: 'Shuffle teams' },
  { key: 'vote_allow_shuffleteams_norestart', defaultValue: '1', label: 'Shuffle without restart' },
  { key: 'vote_allow_swapteams', defaultValue: '1', label: 'Swap teams' },
  { key: 'vote_allow_friendlyfire', defaultValue: '1', label: 'Friendly fire' },
  { key: 'vote_allow_timelimit', defaultValue: '0', label: 'Time limit' },
  { key: 'vote_allow_warmupdamage', defaultValue: '1', label: 'Warm-up damage' },
  { key: 'vote_allow_antilag', defaultValue: '1', label: 'Anti-lag' },
  { key: 'vote_allow_balancedteams', defaultValue: '1', label: 'Balanced teams' },
  { key: 'vote_allow_surrender', defaultValue: '1', label: 'Surrender' },
  { key: 'vote_allow_restartcampaign', defaultValue: '1', label: 'Restart campaign' },
  { key: 'vote_allow_nextcampaign', defaultValue: '1', label: 'Next campaign' },
  { key: 'vote_allow_poll', defaultValue: '1', label: 'Open poll' },
  { key: 'vote_allow_cointoss', defaultValue: '1', label: 'Coin toss' },
];

/** Class and weapon caps, which share a shape: 0 means no limit. */
const LIMITS: { key: string; defaultValue: string; label: string }[] = [
  { key: 'team_maxSoldiers', defaultValue: '-1', label: 'Soldiers' },
  { key: 'team_maxMedics', defaultValue: '-1', label: 'Medics' },
  { key: 'team_maxEngineers', defaultValue: '-1', label: 'Engineers' },
  { key: 'team_maxFieldops', defaultValue: '-1', label: 'Field ops' },
  { key: 'team_maxCovertops', defaultValue: '-1', label: 'Covert ops' },
  { key: 'team_maxMortars', defaultValue: '-1', label: 'Mortars' },
  { key: 'team_maxFlamers', defaultValue: '-1', label: 'Flamethrowers' },
  { key: 'team_maxMachineguns', defaultValue: '-1', label: 'Machine guns' },
  { key: 'team_maxRockets', defaultValue: '-1', label: 'Rocket launchers' },
  { key: 'team_maxRiflegrenades', defaultValue: '-1', label: 'Rifle grenades' },
  { key: 'team_maxLandmines', defaultValue: '10', label: 'Landmines' },
  { key: 'team_maxAirstrikes', defaultValue: '0.0', label: 'Airstrikes' },
  { key: 'team_maxArtillery', defaultValue: '0.0', label: 'Artillery' },
];

export const CVAR_SECTIONS: CvarSection[] = [
  {
    id: 'identity',
    title: 'Identity',
    description: 'How your server presents itself in the in-game browser.',
    cvars: [
      {
        key: 'sv_hostname',
        defaultValue: 'ETLHost',
        label: 'Server name',
        kind: 'text',
        hint: 'Colour codes work: ^1 red, ^2 green, ^3 yellow, ^4 blue, ^7 white. Around 26 visible characters fit.',
        appliesOn: 'immediately',
      },
      {
        key: 'dedicated',
        defaultValue: '2',
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
      {
        key: 'sv_advert',
        defaultValue: '1',
        label: 'Master server reporting',
        kind: 'select',
        options: [
          { value: '0', label: 'Do not report' },
          { value: '1', label: 'Heartbeat to master servers' },
          { value: '3', label: 'Heartbeat and Trackbase statistics' },
        ],
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_countryFlags',
        defaultValue: '1',
        label: 'Country flags',
        kind: 'flags',
        flags: [
          { bit: 1, label: 'Show a flag beside each player name' },
          { bit: 2, label: 'Name the country in the connect announcement' },
        ],
        appliesOn: 'map-change',
      },
    ],
  },

  {
    id: 'motd',
    title: 'Message of the day',
    description: 'Up to five lines shown in the corner of the join screen.',
    cvars: ([0, 1, 2, 3, 4, 5] as const).map((line) => ({
      key: `server_motd${line}`,
      label: `Line ${line + 1}`,
      defaultValue: line === 0 ? ' ^NEnemy Territory ^7MOTD ' : '',
      kind: 'text' as const,
      appliesOn: 'map-change' as const,
      ...(line === 0
        ? { hint: 'Colour codes work here too. Leave the rest blank for a shorter message.' }
        : { advanced: line > 2 }),
    })),
  },

  {
    id: 'access',
    title: 'Players & access',
    description: 'Capacity, reserved slots and who is allowed in.',
    cvars: [
      {
        key: 'g_extendedNames',
        defaultValue: '1',
        label: 'Allow extended characters in names',
        kind: 'boolean',
        hint: 'Off strips anything outside the classic character set, which keeps names readable in the console and the logs.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_maxclients',
        defaultValue: '20',
        label: 'Maximum players',
        kind: 'number',
        min: 1,
        max: 64,
        hint: 'Includes private slots. 20–32 is typical for objective play.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_privateClients',
        defaultValue: '0',
        label: 'Reserved slots',
        kind: 'number',
        min: 0,
        max: 64,
        hint: 'Held back for people who know the private password.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_privatepassword',
        defaultValue: '',
        label: 'Private slot password',
        kind: 'password',
        hint: 'Required to claim a reserved slot.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_password',
        defaultValue: 'none',
        label: 'Server password',
        kind: 'password',
        hint: 'Leave empty for a public server. Setting it makes the server private.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_ipMaxClients',
        defaultValue: '0',
        label: 'Connections per IP address',
        kind: 'number',
        min: 0,
        max: 32,
        hint: '0 means no limit. Useful against a single host filling the server.',
        appliesOn: 'immediately',
        advanced: true,
      },
    ],
  },

  {
    id: 'admin',
    title: 'Administration',
    description: 'Passwords that grant control rather than access.',
    cvars: [
      {
        key: 'rconpassword',
        defaultValue: '',
        label: 'RCON password',
        kind: 'password',
        hint: 'Unlocks the console and player kick/ban. The control panel picks this up immediately — nothing to copy elsewhere, no restart.',
        appliesOn: 'immediately',
      },
      {
        key: 'refereePassword',
        // The engine ships the literal string "none", which it treats exactly
        // like empty. Never shown in the field: it is a sentinel, not a
        // password, and a browser offered to remember it.
        defaultValue: 'none',
        label: 'Referee password',
        kind: 'password',
        hint: 'Lets a player promote themselves to referee to run match commands. Empty disables it — as does the engine\u2019s own default of "none", which is a sentinel rather than a password.',
        appliesOn: 'immediately',
      },
      {
        key: 'shoutcastPassword',
        defaultValue: 'none',
        label: 'Shoutcaster password',
        kind: 'password',
        hint: 'Grants the spectator view used for casting, without full referee rights. Empty disables it, as does the engine default of "none".',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_pure',
        defaultValue: '1',
        label: 'Pure server',
        kind: 'boolean',
        hint: 'Requires clients to use the same pk3 files as the server. Leave on unless you know why not.',
        appliesOn: 'restart',
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
        defaultValue: '4',
        label: 'Game type',
        kind: 'select',
        options: [
          { value: '2', label: 'Objective' },
          { value: '3', label: 'Stopwatch' },
          { value: '4', label: 'Campaign' },
          { value: '5', label: 'Last Man Standing' },
          { value: '6', label: 'Map voting' },
        ],
        hint: 'Objective is the classic single-map mode; Campaign chains maps from a campaign file.',
        appliesOn: 'restart',
      },
      {
        key: 'timelimit',
        defaultValue: '0',
        label: 'Time limit (minutes)',
        kind: 'number',
        min: 0,
        max: 180,
        hint: '0 disables the timer. Most objective maps are designed around 20–30.',
        appliesOn: 'map-change',
      },
      {
        // Read as a bitmask in exactly one place (the disguised covert ops
        // case) and as a plain boolean everywhere else; only bit 1 is defined.
        key: 'g_friendlyFire',
        defaultValue: '1',
        label: 'Friendly fire',
        kind: 'boolean',
        appliesOn: 'immediately',
      },
      {
        key: 'g_antilag',
        defaultValue: '1',
        label: 'Anti-lag',
        kind: 'boolean',
        hint: 'Compensates for latency when registering hits. Expected on by most players.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_teamforcebalance',
        defaultValue: '0',
        label: 'Force balanced teams',
        kind: 'boolean',
        hint: 'Stops players joining the team that already has more players.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_noTeamSwitching',
        defaultValue: '0',
        label: 'Lock team switching',
        kind: 'boolean',
        hint: 'Prevents changing sides once play has started.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_maxlives',
        defaultValue: '0',
        label: 'Lives per player',
        kind: 'number',
        min: 0,
        max: 100,
        hint: '0 is unlimited respawns.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_alliedmaxlives',
        defaultValue: '0',
        label: 'Allied lives',
        kind: 'number',
        min: 0,
        max: 100,
        hint: 'Overrides the shared limit for the Allied team. 0 is unlimited.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_axismaxlives',
        defaultValue: '0',
        label: 'Axis lives',
        kind: 'number',
        min: 0,
        max: 100,
        hint: 'Overrides the shared limit for the Axis team. 0 is unlimited.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_altStopwatchMode',
        defaultValue: '0',
        label: 'Stopwatch round order',
        kind: 'select',
        options: [
          { value: '0', label: 'ABBA — sides swap once' },
          { value: '1', label: 'ABAB — sides alternate' },
        ],
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_heavyWeaponRestriction',
        defaultValue: '100',
        label: 'Heavy weapons (% of team)',
        kind: 'number',
        min: 0,
        max: 100,
        hint: 'Share of each team allowed to carry heavy weapons. 100 is no restriction.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_shove',
        defaultValue: '60',
        label: 'Shove strength',
        kind: 'number',
        min: 0,
        max: 100,
        hint: '0 disables shoving teammates out of the way.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_dropAmmo',
        defaultValue: '0',
        label: 'Ammo packs dropped on death',
        kind: 'number',
        min: 0,
        max: 10,
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_dropHealth',
        defaultValue: '0',
        label: 'Health packs dropped on death',
        kind: 'number',
        min: 0,
        max: 10,
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_fastres',
        defaultValue: '0',
        label: 'Instant revive',
        kind: 'boolean',
        hint: 'Revived players are active immediately instead of getting up.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_autofireteams',
        defaultValue: '1',
        label: 'Fireteams on joining a team',
        kind: 'select',
        // Modelled as a switch until someone turned it "off" to get the prompt
        // back and got no prompt at all. On meant "ask", off meant "nothing",
        // and the value that actually joins people silently was unreachable.
        options: [
          { value: '1', label: 'Ask the player (F1 / F2)' },
          { value: '2', label: 'Join one automatically, no prompt' },
          { value: '0', label: 'Do nothing' },
        ],
        hint: 'What happens when a player joins a team. Asking is the stock behaviour.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_voiceChatsAllowed',
        defaultValue: '5',
        label: 'Voice chats per 30 seconds',
        kind: 'number',
        min: 0,
        max: 50,
        hint: 'Caps voice-chat spam without muting anyone.',
        appliesOn: 'immediately',
        advanced: true,
      },
    ],
  },

  {
    id: 'xp',
    title: 'XP & progression',
    description:
      'Whether players keep the XP they earn, and when it is wiped. Off by default: a fresh server resets everyone at every map.',
    cvars: [
      {
        key: 'g_xpSaver',
        defaultValue: '0',
        label: 'XP saving',
        kind: 'flags',
        flags: [
          {
            bit: 1,
            label: 'Save XP when a player disconnects',
            hint: 'Required — with this off the server sets the whole cvar back to 0 at start-up.',
          },
          { bit: 2, label: 'Keep the current map\u2019s XP through a map restart' },
          {
            bit: 4,
            label: 'Never reset saved XP',
            hint: 'Makes \u201cKeep saved XP for\u201d and \u201cReset XP every N maps\u201d irrelevant. !resetxp still works.',
          },
          {
            bit: 8,
            label: 'Drop an existing client with the same GUID',
            hint: 'Two connections sharing a GUID can corrupt each other\u2019s saved XP.',
          },
          { bit: 16, label: 'Do not save XP in Stopwatch' },
          {
            bit: 32,
            label: 'Import XP from the old .xp files once',
            hint: 'Only useful when migrating a server that predates the database. Turn it off afterwards.',
          },
        ],
        hint: 'Saved XP lives in the server database (db_mode 2 by default, in etl.db).',
        appliesOn: 'restart',
      },
      {
        key: 'g_xpSaverMaxAge',
        defaultValue: '86400',
        label: 'Keep saved XP for',
        kind: 'number',
        min: 0,
        hint: 'Seconds. 86400 is a day, 604800 a week. Ignored while "never reset" is ticked.',
        appliesOn: 'restart',
      },

      ...(
        [
          ['skill_battlesense', 'Battle sense'],
          ['skill_engineer', 'Engineering'],
          ['skill_medic', 'First aid'],
          ['skill_fieldops', 'Signals'],
          ['skill_lightweapons', 'Light weapons'],
          ['skill_soldier', 'Heavy weapons'],
          ['skill_covertops', 'Covert ops'],
        ] as const
      ).map(([key, label]) => ({
        key,
        label: `${label} levels`,
        defaultValue: '20 50 90 140',
        kind: 'text' as const,
        hint: 'Four XP thresholds, lowest first — the default is "20 50 90 140".',
        appliesOn: 'map-change' as const,
        advanced: true,
      })),
      {
        key: 'g_skillRating',
        defaultValue: '2',
        label: 'Skill rating',
        kind: 'select',
        options: [
          { value: '0', label: 'Off' },
          { value: '1', label: 'Rate players' },
          { value: '2', label: 'Rate players and maps' },
        ],
        hint: 'Estimates player strength across matches. Level 2 also weighs how one-sided each map is.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_prestige',
        defaultValue: '1',
        label: 'Prestige',
        kind: 'boolean',
        hint: 'Lets players who have maxed out a skill trade it for a prestige level. Objective, Stopwatch and LMS ignore it.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_resetXPMapCount',
        defaultValue: '0',
        label: 'Reset XP every N maps',
        kind: 'number',
        min: 0,
        hint: '0 never resets on a map count. Ignored while "never reset" is ticked.',
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'respawn',
    title: 'Respawn & limbo',
    description: 'How long the dead wait, and what happens to players who stop playing.',
    cvars: [
      {
        key: 'g_userAxisRespawnTime',
        defaultValue: '0',
        label: 'Axis respawn wave',
        kind: 'number',
        min: 0,
        hint: 'Seconds. 0 uses whatever each map asks for — most maps set their own. Anything else overrides every map, which is what makes a faster server stay faster.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_userAlliedRespawnTime',
        defaultValue: '0',
        label: 'Allied respawn wave',
        kind: 'number',
        min: 0,
        hint: 'Seconds. 0 uses the map\u2019s own value.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_redlimbotime',
        defaultValue: '30000',
        label: 'Axis respawn interval (raw)',
        kind: 'number',
        min: 0,
        // The units trip everyone up, and setting it is usually pointless: the
        // map script rewrites it at load from wm_axis_respawntime.
        hint: 'Milliseconds — 30000 is thirty seconds. Prefer \u201cAxis respawn wave\u201d, which is in seconds: map scripts overwrite this cvar at map load and honour that one instead.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_bluelimbotime',
        defaultValue: '30000',
        label: 'Allied respawn interval (raw)',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Same caveat as \u201cAxis respawn interval\u201d — prefer \u201cAllied respawn wave\u201d, in seconds.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_forcerespawn',
        defaultValue: '0',
        label: 'Force respawn after',
        kind: 'number',
        hint: 'Seconds a body may stay in limbo before it is sent back automatically. 0 lets players lie there; -1 respawns instantly.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_inactivity',
        defaultValue: '0',
        label: 'Move idle players to spectator after',
        kind: 'number',
        min: 0,
        hint: 'Seconds without input. 0 never does. Frees a slot on a full server without kicking anyone.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_enforcemaxlives',
        defaultValue: '1',
        label: 'Enforce the life limit',
        kind: 'boolean',
        hint: 'Stops a player who is out of lives from rejoining to get more. Only matters with a limit set under Gameplay.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_maxlivesRespawnPenalty',
        defaultValue: '0',
        label: 'Extra wait after losing a life',
        kind: 'number',
        min: 0,
        hint: 'Seconds added to the respawn wait while a life limit is in force.',
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'charge',
    title: 'Class charge times',
    description:
      'How long each class waits for its special ability. Lower is more airstrikes, more ammo, more of everything.',
    cvars: [
      {
        key: 'g_soldierChargeTime',
        defaultValue: '20000',
        label: 'Soldier',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 20000 — panzer, mortar, flamer and mobile MG fuel.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_medicChargeTime',
        defaultValue: '45000',
        label: 'Medic',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 45000 — the syringe.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_engineerChargeTime',
        defaultValue: '30000',
        label: 'Engineer',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 30000 — landmines, dynamite and repairs.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_fieldopsChargeTime',
        defaultValue: '40000',
        label: 'Field ops',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 40000 — artillery and airstrikes.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_covertopsChargeTime',
        defaultValue: '30000',
        label: 'Covert ops',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 30000 — satchel, smoke and the disguise.',
        appliesOn: 'map-change',
      },
      {
        // A bitmask in the source (1 selfkill, 2 any death), but 2 subsumes 1,
        // so three options cover every distinct behaviour and read better than
        // two checkboxes where one silently overrides the other.
        key: 'g_stickyCharge',
        defaultValue: '0',
        label: 'Keep the charge bar on death',
        kind: 'select',
        options: [
          { value: '0', label: 'Reset on any death' },
          { value: '1', label: 'Keep after a selfkill or team kill' },
          { value: '2', label: 'Keep after any death' },
        ],
        hint: 'Option 1 removes the reason to selfkill for a fresh charge bar.',
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'combat',
    title: 'Weapons & medics',
    description: 'The small rules that decide how a firefight ends.',
    cvars: [
      {
        key: 'g_syringeHealing',
        defaultValue: '0',
        label: 'Syringe heals living players',
        kind: 'boolean',
        hint: 'A medic can top up a teammate who is still standing, not only revive the dead.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_legacyRevives',
        defaultValue: '1',
        label: 'Revive rules',
        kind: 'select',
        options: [
          { value: '1', label: 'Legacy — revived players keep more health' },
          { value: '0', label: 'Vanilla 2.60b behaviour' },
        ],
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_corpses',
        defaultValue: '0',
        label: 'Leave bodies lying',
        kind: 'boolean',
        hint: 'Off removes a body as soon as its player respawns. On is prettier and costs entities.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_landminetimeout',
        defaultValue: '1',
        label: 'Blow up mines when their engineer leaves',
        kind: 'boolean',
        hint: 'Off leaves mines armed after the player who planted them disconnects or switches team.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_dropObjDelay',
        defaultValue: '3000',
        label: 'Delay before the objective can be dropped',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds after picking it up. Default 3000 — stops the objective being tossed around a spawn.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_shoveNoZ',
        defaultValue: '0',
        label: 'No boost when shoving upward',
        kind: 'boolean',
        hint: 'Only applies while the shove-boost flag under Movement is off.',
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'movement',
    title: 'Movement & physics',
    description:
      'The feel of the game. These are the settings that make a server "trickjump" or "vanilla" — change one and regulars will notice.',
    cvars: [
      {
        key: 'g_speed',
        defaultValue: '320',
        label: 'Player speed',
        kind: 'number',
        min: 1,
        hint: 'Default 320. Anything else is a mod, not a tweak.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_gravity',
        defaultValue: '800',
        label: 'Gravity',
        kind: 'number',
        min: 0,
        hint: 'Default 800.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_knockback',
        defaultValue: '1000',
        label: 'Knockback',
        kind: 'number',
        min: 0,
        hint: 'How far explosions throw a player. Default 1000.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_movespeed',
        defaultValue: '76',
        label: 'Movement speed scale',
        kind: 'number',
        min: 1,
        hint: 'Default 76. Used by the engine alongside player speed; leave it alone unless you are copying a known config.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_pronedelay',
        defaultValue: '0',
        label: 'Delay before firing after going prone',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. 0 is stock behaviour.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_misc',
        defaultValue: '0',
        label: 'Movement options',
        kind: 'flags',
        flags: [
          {
            bit: 1,
            label: 'ETPro-style shove boost',
            hint: 'Shoving someone upward gives a real boost instead of a fixed nudge. This is what trickjump servers turn on.',
          },
        ],
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_fixedphysics',
        defaultValue: '1',
        label: 'Frame-rate independent physics',
        kind: 'boolean',
        hint: 'Makes jumps behave the same regardless of a player\u2019s FPS.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_fixedphysicsfps',
        defaultValue: '125',
        label: 'Physics emulated at',
        kind: 'number',
        min: 1,
        hint: 'The frame rate \u201cFrame-rate independent physics\u201d pretends everyone runs at. Default 125.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_realHead',
        defaultValue: '1',
        label: 'Head hitbox',
        kind: 'flags',
        flags: [
          {
            bit: 1,
            label: 'Follow the model\u2019s actual head',
            hint: 'Off falls back to a fixed box, which is kinder to high-ping players and less accurate for everyone.',
          },
          { bit: 128, label: 'Trace hits against the skeleton' },
        ],
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_moverScale',
        defaultValue: '1.0',
        label: 'Mover speed scale',
        kind: 'text',
        hint: 'How fast tanks and doors travel. Default 1.0.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_filtercams',
        defaultValue: '0',
        label: 'Filter camera movement',
        kind: 'boolean',
        hint: 'Smooths scripted camera paths in cutscenes.',
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'mapvote',
    title: 'Map voting',
    description:
      'Only used by the Map voting game type. Players pick the next map from the ones installed.',
    cvars: [
      {
        key: 'g_maxMapsVotedFor',
        defaultValue: '6',
        label: 'Maps on the ballot',
        kind: 'number',
        min: 1,
        hint: 'How many candidates players choose between. Default 6.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_minMapAge',
        defaultValue: '3',
        label: 'Maps to wait before a repeat',
        kind: 'number',
        min: 0,
        hint: 'A map that has just been played is kept off the ballot this many rounds. Default 3.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_excludedMaps',
        defaultValue: '',
        label: 'Never offer these maps',
        kind: 'text',
        hint: 'Space-separated map names, e.g. "railgun". They stay installed and playable by other means.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_mapVoteFlags',
        defaultValue: '0',
        label: 'Voting options',
        kind: 'flags',
        flags: [
          { bit: 1, label: 'Break a tie in favour of the least-played map' },
          { bit: 4, label: 'Let a player vote for more than one map' },
          { bit: 16, label: 'Let players vote for the next map mid-round' },
        ],
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'match',
    title: 'Match & warm-up',
    description: 'How a match starts, pauses and ends.',
    cvars: [
      {
        key: 'g_maxGameClients',
        defaultValue: '0',
        label: 'Maximum playing clients',
        kind: 'number',
        min: 0,
        hint: '0 means every slot may play. Anything higher keeps the rest as spectators.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'match_timeoutlength',
        defaultValue: '180',
        label: 'Time-out length',
        kind: 'number',
        min: 0,
        hint: 'Seconds a called time-out lasts. Default 180.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_multiview',
        defaultValue: '0',
        label: 'Multiview for spectators',
        kind: 'boolean',
        hint: 'Lets a spectator watch several players at once. Needs a restart, and clients must support it.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_etltv_flags',
        defaultValue: '3',
        label: 'ETLTV connections',
        kind: 'flags',
        flags: [
          {
            bit: 1,
            label: 'Keep them out of the teams',
            hint: 'They also cannot be vote-kicked, so a stray vote does not end the broadcast.',
          },
          { bit: 2, label: 'Make them shoutcasters automatically' },
        ],
        hint: 'Only affects clients connecting as an ETLTV relay.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_doWarmup',
        defaultValue: '0',
        label: 'Warm-up period',
        kind: 'boolean',
        hint: 'Players warm up before the match counts.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_warmup',
        defaultValue: '60',
        label: 'Warm-up duration (seconds)',
        kind: 'number',
        min: 0,
        max: 300,
        appliesOn: 'map-change',
      },
      {
        key: 'match_warmupDamage',
        defaultValue: '1',
        label: 'Warm-up damage',
        kind: 'select',
        options: [
          { value: '0', label: 'Off' },
          { value: '1', label: 'Enemies only' },
          { value: '2', label: 'Everybody' },
        ],
        appliesOn: 'map-change',
      },
      {
        key: 'match_minplayers',
        defaultValue: '4',
        label: 'Minimum players to start',
        kind: 'number',
        min: 1,
        max: 32,
        appliesOn: 'immediately',
      },
      {
        key: 'match_readypercent',
        defaultValue: '100',
        label: 'Ready percentage',
        kind: 'number',
        min: 1,
        max: 100,
        hint: 'Share of players who must be ready before a match begins.',
        appliesOn: 'immediately',
      },
      {
        key: 'match_latejoin',
        defaultValue: '1',
        label: 'Allow late joins',
        kind: 'boolean',
        hint: 'Lets players join a match already in progress.',
        appliesOn: 'immediately',
      },
      {
        key: 'match_mutespecs',
        defaultValue: '0',
        label: 'Mute spectators',
        kind: 'boolean',
        hint: 'Stops spectators talking to players in a match.',
        appliesOn: 'immediately',
      },
      {
        key: 'match_timeoutcount',
        defaultValue: '3',
        label: 'Timeouts per team',
        kind: 'number',
        min: 0,
        max: 10,
        hint: '0 disables timeouts entirely.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_intermissionTime',
        defaultValue: '60',
        label: 'Intermission length (seconds)',
        kind: 'number',
        min: 0,
        max: 300,
        hint: 'How long the scoreboard is shown between maps.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_intermissionReadyPercent',
        defaultValue: '100',
        label: 'Intermission ready percentage',
        kind: 'number',
        min: 1,
        max: 100,
        hint: 'Share of players who must be ready to skip ahead to the next map.',
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'complaints',
    title: 'Complaints',
    description: 'The team-kill complaint system.',
    cvars: [
      {
        key: 'g_teambleedComplaint',
        defaultValue: '50',
        label: 'Team-damage complaint threshold',
        kind: 'number',
        hint: 'Percentage of a player\u2019s health that team damage must reach before a complaint is offered. Negative disables it.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_complaintlimit',
        defaultValue: '6',
        label: 'Complaints before a kick',
        kind: 'number',
        min: 0,
        max: 50,
        hint: '0 turns complaints off.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_ipcomplaintlimit',
        defaultValue: '3',
        label: 'Distinct complainants needed',
        kind: 'number',
        min: 0,
        max: 50,
        hint: 'How many different players must complain, so one person cannot force a kick.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_disableComplaints',
        defaultValue: '0',
        label: 'No complaints for',
        kind: 'flags',
        // The mod's own sample config calls 1 "disable complaints for
        // airstrike, artillery, mortar and landmines", which is three weapons
        // too many: 1 is landmines alone. All three is 7.
        flags: [
          { bit: 1, label: 'Landmines' },
          { bit: 2, label: 'Airstrikes and artillery' },
          { bit: 4, label: 'Mortar' },
        ],
        hint: 'Team kills by these weapons stop offering a complaint. They are usually accidents, and they generate most of the complaints on a busy server.',
        appliesOn: 'immediately',
        advanced: true,
      },
    ],
  },

  {
    id: 'lms',
    title: 'Last Man Standing',
    description: 'Only used when the game type is Last Man Standing.',
    cvars: [
      {
        key: 'g_lms_roundlimit',
        defaultValue: '3',
        label: 'Rounds per match',
        kind: 'number',
        min: 1,
        max: 20,
        appliesOn: 'map-change',
      },
      {
        key: 'g_lms_matchlimit',
        defaultValue: '2',
        label: 'Matches per map',
        kind: 'number',
        min: 1,
        max: 20,
        appliesOn: 'map-change',
      },
      {
        key: 'g_lms_followTeamOnly',
        defaultValue: '1',
        label: 'Spectate own team only',
        kind: 'boolean',
        appliesOn: 'immediately',
      },
      {
        key: 'g_lms_lockTeams',
        defaultValue: '0',
        label: 'Lock teams during a round',
        kind: 'boolean',
        appliesOn: 'immediately',
      },
      {
        key: 'g_lms_teamForceBalance',
        defaultValue: '1',
        label: 'Force balanced teams',
        kind: 'boolean',
        appliesOn: 'immediately',
      },
    ],
  },

  {
    id: 'teams',
    title: 'Team & class limits',
    description: 'Caps per team. 0 means no limit.',
    cvars: [
      {
        key: 'team_maxplayers',
        defaultValue: '0',
        label: 'Players per team',
        kind: 'number',
        min: 0,
        max: 32,
        appliesOn: 'immediately',
      },
      {
        key: 'team_nocontrols',
        defaultValue: '1',
        label: 'Disable team controls',
        kind: 'boolean',
        hint: 'Stops players using team commands such as ready and lock.',
        appliesOn: 'immediately',
        advanced: true,
      },
      ...LIMITS.map((limit) => ({
        key: limit.key,
        label: limit.label,
        defaultValue: limit.defaultValue,
        kind: 'number' as const,
        min: 0,
        max: 32,
        appliesOn: 'map-change' as const,
        advanced: true,
      })),
    ],
  },

  {
    id: 'voting',
    title: 'Voting',
    description: 'What players may put to a vote, and how a vote passes.',
    cvars: [
      {
        key: 'g_voting',
        defaultValue: '0',
        label: 'Vote counting',
        kind: 'flags',
        flags: [
          {
            bit: 1,
            label: 'Count everyone, not just those who voted',
            hint: 'Silence counts as "no", so a vote needs real support to pass.',
          },
          { bit: 2, label: 'A vote that passes does not count towards a player’s vote limit' },
          { bit: 4, label: 'Show who called the vote' },
        ],
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_allowVote',
        label: 'Allow voting',
        kind: 'boolean',
        // Kept because the mod's own sample config still sets it and every
        // guide repeats it — but nothing in 2.83 or 2.84 reads it. Saying so
        // here is the difference between "voting is off" and an evening spent
        // wondering why players can still call votes.
        hint: 'Older builds used this as the master switch. ET: Legacy 2.83 and later ignore it — switch the individual vote_allow_ settings in this section off instead.',
        appliesOn: 'immediately',
      },
      {
        key: 'vote_limit',
        defaultValue: '5',
        label: 'Votes per player each map',
        kind: 'number',
        min: 0,
        max: 20,
        appliesOn: 'immediately',
      },
      {
        key: 'vote_percent',
        defaultValue: '50',
        label: 'Percentage needed to pass',
        kind: 'number',
        min: 1,
        max: 100,
        appliesOn: 'immediately',
      },
      ...VOTES.map((vote) => ({
        key: vote.key,
        label: vote.label,
        defaultValue: vote.defaultValue,
        kind: 'boolean' as const,
        appliesOn: 'immediately' as const,
        advanced: true,
      })),
    ],
  },

  {
    id: 'connection',
    title: 'Connection quality',
    description: 'Who may connect, and how much bandwidth each client gets.',
    cvars: [
      {
        // Bits 16 and 32 exist but are developer telemetry — one of them is
        // commented "eats bandwidth like popcorn". On/off is the whole setting
        // for an operator.
        key: 'g_antiwarp',
        defaultValue: '1',
        label: 'Anti-warp',
        kind: 'boolean',
        hint: 'Smooths players whose connection stutters instead of letting them teleport around.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_maxWarp',
        defaultValue: '4',
        label: 'Warp tolerance',
        kind: 'number',
        min: 1,
        hint: 'Server frames a client may fall behind before anti-warp steps in. Default 4; higher is more forgiving.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_skipCorrection',
        defaultValue: '1',
        label: 'Correct skipped movement',
        kind: 'boolean',
        hint: 'Replays movement a lagging client missed rather than dropping it.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_teamInfoUpdateRate',
        defaultValue: '1000',
        label: 'Team overlay update interval',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds between team status updates sent to clients. Default 1000; lower costs bandwidth.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_minPing',
        defaultValue: '0',
        label: 'Minimum ping',
        kind: 'number',
        min: 0,
        max: 1000,
        hint: '0 means no minimum. Rarely useful.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_maxPing',
        defaultValue: '0',
        label: 'Maximum ping',
        kind: 'number',
        min: 0,
        max: 1000,
        hint: '0 means no maximum. Set this to keep distant players out — it refuses them at connect.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_maxRate',
        defaultValue: '0',
        label: 'Maximum rate (bytes/s)',
        kind: 'number',
        min: 0,
        max: 100_000,
        hint: '25000 suits ET well. 0 is unlimited.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_spectatorInactivity',
        defaultValue: '0',
        label: 'Spectator inactivity (seconds)',
        kind: 'number',
        min: 0,
        max: 3600,
        hint: 'Kicks idle spectators so they do not hold a slot. 0 disables it.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_floodProtect',
        defaultValue: '1',
        label: 'Flood protection',
        kind: 'boolean',
        hint: 'Rate-limits chat and command spam from one client.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_userInfofloodProtect',
        defaultValue: '1',
        label: 'User-info flood protection',
        kind: 'boolean',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_timeout',
        defaultValue: '60',
        label: 'Client timeout (seconds)',
        kind: 'number',
        min: 10,
        max: 300,
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'pmove_fixed',
        defaultValue: '0',
        label: 'Frame-rate independent physics',
        kind: 'boolean',
        hint: 'Makes movement identical regardless of a client’s frame rate. Competitive servers usually enable it.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'pmove_msec',
        defaultValue: '8',
        label: 'Physics interval (ms)',
        kind: 'number',
        min: 3,
        max: 33,
        hint: '8 emulates 125 FPS, the historical competitive standard.',
        appliesOn: 'map-change',
        advanced: true,
      },
    ],
  },

  {
    id: 'protection',
    title: 'Protection & logging',
    description: 'Defences against abuse, and what gets written to disk.',
    cvars: [
      {
        key: 'sv_wh_active',
        defaultValue: '0',
        label: 'Block wallhacks',
        kind: 'boolean',
        // The only measure here that a modified client cannot defeat: the
        // information a wallhack would draw is never sent.
        hint: 'The server stops sending the real position of players you cannot see, so a wallhack has nothing to draw. Costs some CPU.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_wh_bbox_horz',
        defaultValue: '60',
        label: 'Visibility box — width',
        kind: 'number',
        min: 20,
        max: 100,
        hint: 'How generously the server decides a player is visible. Default 60; lower is stricter and risks players popping in late.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'sv_wh_bbox_vert',
        defaultValue: '100',
        label: 'Visibility box — height',
        kind: 'number',
        min: 40,
        max: 150,
        hint: 'Default 100. Values outside 40–150 are clamped by the server.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'sv_protectLog',
        defaultValue: '',
        label: 'Attack log file',
        kind: 'text',
        hint: 'Where blocked flood and rcon attempts are recorded. Empty writes nothing.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_protectLogInterval',
        defaultValue: '1000',
        label: 'Attack log interval',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds between entries, so an attack cannot fill the disk. Default 1000.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_floodProtection',
        defaultValue: '1',
        label: 'Chat flood protection',
        kind: 'boolean',
        hint: 'Game-side, for chat and commands. The engine has its own limit under Connection quality.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_floodLimit',
        defaultValue: '5',
        label: 'Messages allowed',
        kind: 'number',
        min: 1,
        hint: 'Within the \u201cFlood window\u201d. Default 5.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_floodWait',
        defaultValue: '1000',
        label: 'Flood window',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 1000.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_logTimestamp',
        defaultValue: '1',
        label: 'Log timestamps',
        kind: 'select',
        options: [
          { value: '1', label: 'Level time' },
          { value: '2', label: 'Time since start-up' },
          { value: '3', label: 'Clock time' },
          { value: '0', label: 'None' },
        ],
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_banIPs',
        defaultValue: '',
        label: 'Banned addresses',
        kind: 'text',
        hint: 'Space-separated. A trailing 0 wildcards an octet, e.g. "192.168.1.0".',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_filterBan',
        defaultValue: '1',
        label: 'Enforce the ban list',
        kind: 'boolean',
        hint: 'Off leaves \u201cBanned addresses\u201d listed but lets them connect.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_protect',
        defaultValue: '0',
        label: 'Server protection',
        kind: 'flags',
        // A bitmask, not a choice of three. Offering it as a select made these
        // mutually exclusive, so anyone picking "DDoS protection" silently gave
        // up the reflection guard — the one that stops the server being used as
        // a weapon against a third party.
        flags: [
          {
            bit: 1,
            label: 'Rate-limit status queries',
            hint: 'Caps getstatus and getinfo at 10 per second per address, so a flood of them cannot wedge the server.',
          },
          {
            bit: 2,
            label: 'Block reflection attacks (DRDoS)',
            hint: 'A spoofed query makes the server fire a much larger reply at whoever the attacker named. This stops it — protecting the victim, your uplink and your standing with your ISP. Your LAN is exempt.',
          },
          { bit: 4, label: 'Print blocked attempts to the console' },
        ],
        hint: 'Leave both of the first two on unless you have a reason not to.',
        appliesOn: 'restart',
      },
      {
        key: 'g_protect',
        defaultValue: '0',
        label: 'Mod-side protection',
        kind: 'flags',
        flags: [
          {
            bit: 1,
            label: 'Refuse referee to a localhost connection',
            hint: 'Matters when the game server shares a host with something a stranger can reach.',
          },
          { bit: 2, label: 'Ban the GUID of a player evading the life limit' },
        ],
        appliesOn: 'restart',
      },
      {
        key: 'g_guidCheck',
        defaultValue: '1',
        label: 'Require a valid GUID',
        kind: 'boolean',
        hint: 'Refuses clients without a valid identifier, which blocks some very old builds.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_log',
        defaultValue: '',
        label: 'Game log file',
        kind: 'text',
        hint: 'Records kills, connects and weapon changes. Leave empty to disable.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_logSync',
        defaultValue: '0',
        label: 'Write the game log immediately',
        kind: 'boolean',
        hint: 'Slower, but nothing is lost if the server stops abruptly.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'logfile',
        defaultValue: '0',
        label: 'Console log',
        kind: 'select',
        options: [
          { value: '0', label: 'Off' },
          { value: '1', label: 'Enabled' },
          { value: '2', label: 'Enabled and written immediately' },
        ],
        appliesOn: 'restart',
        advanced: true,
      },
    ],
  },

  {
    id: 'bots',
    title: 'Bots (Omni-bot)',
    description:
      'Requires Omni-bot installed on the server. Wrong paths here mean bots silently never appear.',
    cvars: [
      {
        key: 'omnibot_enable',
        defaultValue: '0',
        label: 'Enable bots',
        kind: 'boolean',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'omnibot_path',
        defaultValue: 'legacy/omni-bot',
        label: 'Omni-bot directory',
        kind: 'text',
        hint: 'Inside the container, e.g. "legacy/omni-bot". Must be the path the game server sees, not the host path.',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'omnibot_flags',
        defaultValue: '0',
        label: 'Bot behaviour',
        kind: 'flags',
        flags: [
          { bit: 1, label: 'Do not save XP for bots' },
          { bit: 2, label: 'Bots cannot mount tanks' },
          { bit: 4, label: 'Bots cannot mount emplaced guns' },
          { bit: 8, label: 'Do not count bots in the player count' },
          { bit: 16, label: 'Bots finish off wounded enemies' },
          { bit: 32, label: 'Bots trigger team and spotted mines' },
          { bit: 64, label: 'Bots may shove' },
        ],
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_allowBotSwap',
        defaultValue: '0',
        label: 'Let a joining player take a bot\u2019s place',
        kind: 'boolean',
        hint: 'Keeps the teams the same size when a human arrives on a full server.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
    ],
  },

  {
    id: 'lua',
    title: 'Lua modules',
    description:
      'Server-side scripts such as WolfAdmin. A module that fails to load takes its features with it and says so only in the log.',
    cvars: [
      {
        key: 'lua_modules',
        defaultValue: '',
        label: 'Modules to load',
        kind: 'text',
        hint: 'Space-separated paths, e.g. "luascripts/wolfadmin/main.lua". Ignored when \u201cModule list file\u201d is set.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
      {
        key: 'lua_allowedModules',
        defaultValue: '',
        label: 'Allowed module signatures',
        kind: 'text',
        hint: 'Empty allows any module. Otherwise only modules whose signature is listed here may load.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_luaModuleList',
        defaultValue: '',
        label: 'Module list file',
        kind: 'text',
        hint: 'A file listing modules to load. When set, it replaces \u201cModules to load\u201d entirely.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
    ],
  },

  {
    id: 'files',
    title: 'Config & campaign files',
    description:
      'Paths the server reads at start-up. A typo here is not a wrong setting — it is a server that comes up with defaults you did not choose.',
    cvars: [
      {
        key: 'g_customConfig',
        defaultValue: 'defaultpublic',
        label: 'Extra config to apply',
        kind: 'text',
        hint: 'Executed after the main config, so it wins. Public servers often use "defaultpublic".',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_mapConfigs',
        defaultValue: '',
        label: 'Per-map config directory',
        kind: 'text',
        hint: 'A config in here named after the map is applied when that map loads. Empty disables it.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_campaignFile',
        defaultValue: '',
        label: 'Campaign file',
        kind: 'text',
        hint: 'Only used by the Campaign game type. Empty uses the campaigns found in the installed pk3 files.',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_mapScriptDirectory',
        defaultValue: 'mapscripts',
        label: 'Map script directory',
        kind: 'text',
        hint: 'Default "mapscripts". Scripts here override the ones inside a map\u2019s pk3.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
    ],
  },

];

export const APPLIES_LABEL: Record<CvarSpec['appliesOn'], string> = {
  immediately: 'Applies immediately',
  'map-change': 'Applies on next map',
  restart: 'Requires a restart',
};

/** Every cvar the form knows about, for search and validation. */
export const ALL_CVARS: CvarSpec[] = CVAR_SECTIONS.flatMap((section) => section.cvars);

export { onOff };
