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
const VOTES: { key: string; label: string }[] = [
  { key: 'vote_allow_config', label: 'Game config' },
  { key: 'vote_allow_gametype', label: 'Game type' },
  { key: 'vote_allow_kick', label: 'Kick a player' },
  { key: 'vote_allow_map', label: 'Change map' },
  { key: 'vote_allow_maprestart', label: 'Restart map' },
  { key: 'vote_allow_matchreset', label: 'Reset match' },
  { key: 'vote_allow_mutespecs', label: 'Mute spectators' },
  { key: 'vote_allow_muting', label: 'Mute a player' },
  { key: 'vote_allow_nextmap', label: 'Next map' },
  { key: 'vote_allow_referee', label: 'Grant referee' },
  { key: 'vote_allow_shuffleteams', label: 'Shuffle teams' },
  { key: 'vote_allow_shuffleteams_norestart', label: 'Shuffle without restart' },
  { key: 'vote_allow_swapteams', label: 'Swap teams' },
  { key: 'vote_allow_friendlyfire', label: 'Friendly fire' },
  { key: 'vote_allow_timelimit', label: 'Time limit' },
  { key: 'vote_allow_warmupdamage', label: 'Warm-up damage' },
  { key: 'vote_allow_antilag', label: 'Anti-lag' },
  { key: 'vote_allow_balancedteams', label: 'Balanced teams' },
  { key: 'vote_allow_surrender', label: 'Surrender' },
  { key: 'vote_allow_restartcampaign', label: 'Restart campaign' },
  { key: 'vote_allow_nextcampaign', label: 'Next campaign' },
  { key: 'vote_allow_poll', label: 'Open poll' },
  { key: 'vote_allow_cointoss', label: 'Coin toss' },
];

/** Class and weapon caps, which share a shape: 0 means no limit. */
const LIMITS: { key: string; label: string }[] = [
  { key: 'team_maxSoldiers', label: 'Soldiers' },
  { key: 'team_maxMedics', label: 'Medics' },
  { key: 'team_maxEngineers', label: 'Engineers' },
  { key: 'team_maxFieldops', label: 'Field ops' },
  { key: 'team_maxCovertops', label: 'Covert ops' },
  { key: 'team_maxMortars', label: 'Mortars' },
  { key: 'team_maxFlamers', label: 'Flamethrowers' },
  { key: 'team_maxMachineguns', label: 'Machine guns' },
  { key: 'team_maxRockets', label: 'Rocket launchers' },
  { key: 'team_maxRiflegrenades', label: 'Rifle grenades' },
  { key: 'team_maxLandmines', label: 'Landmines' },
  { key: 'team_maxAirstrikes', label: 'Airstrikes' },
  { key: 'team_maxArtillery', label: 'Artillery' },
];

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
        hint: 'Colour codes work: ^1 red, ^2 green, ^3 yellow, ^4 blue, ^7 white. Around 26 visible characters fit.',
        appliesOn: 'immediately',
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
      {
        key: 'sv_advert',
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
        label: 'Show country flags',
        kind: 'boolean',
        hint: "Displays each player's country beside their name in-game.",
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
        label: 'Allow extended characters in names',
        kind: 'boolean',
        hint: 'Off strips anything outside the classic character set, which keeps names readable in the console and the logs.',
        appliesOn: 'immediately',
        advanced: true,
      },
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
        max: 64,
        hint: 'Held back for people who know the private password.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_privatepassword',
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
        key: 'sv_ipMaxClients',
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
        label: 'RCON password',
        kind: 'password',
        hint: 'Unlocks the console and player kick/ban. The control panel picks this up immediately — nothing to copy elsewhere, no restart.',
        appliesOn: 'immediately',
      },
      {
        key: 'refereePassword',
        label: 'Referee password',
        kind: 'password',
        hint: 'Lets a player promote themselves to referee to run match commands.',
        appliesOn: 'immediately',
      },
      {
        key: 'shoutcastPassword',
        label: 'Shoutcaster password',
        kind: 'password',
        hint: 'Grants the spectator view used for casting, without full referee rights.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_pure',
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
        appliesOn: 'immediately',
      },
      {
        key: 'g_antilag',
        label: 'Anti-lag',
        kind: 'boolean',
        hint: 'Compensates for latency when registering hits. Expected on by most players.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_teamforcebalance',
        label: 'Force balanced teams',
        kind: 'boolean',
        hint: 'Stops players joining the team that already has more players.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_noTeamSwitching',
        label: 'Lock team switching',
        kind: 'boolean',
        hint: 'Prevents changing sides once play has started.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_maxlives',
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
        label: 'Ammo packs dropped on death',
        kind: 'number',
        min: 0,
        max: 10,
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_dropHealth',
        label: 'Health packs dropped on death',
        kind: 'number',
        min: 0,
        max: 10,
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_fastres',
        label: 'Instant revive',
        kind: 'boolean',
        hint: 'Revived players are active immediately instead of getting up.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_autofireteams',
        label: 'Automatic fireteams',
        kind: 'boolean',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_voiceChatsAllowed',
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
            hint: 'Makes the map count and the maximum age below irrelevant. !resetxp still works.',
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
        kind: 'text' as const,
        hint: 'Four XP thresholds, lowest first — the default is "20 50 90 140".',
        appliesOn: 'map-change' as const,
        advanced: true,
      })),
      {
        key: 'g_skillRating',
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
        label: 'Prestige',
        kind: 'boolean',
        hint: 'Lets players who have maxed out a skill trade it for a prestige level. Objective, Stopwatch and LMS ignore it.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_resetXPMapCount',
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
        key: 'g_redlimbotime',
        label: 'Axis respawn interval',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds between Axis spawn waves. 30000 is the stock 30 seconds; maps may override it.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_bluelimbotime',
        label: 'Allied respawn interval',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds between Allied spawn waves.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_forcerespawn',
        label: 'Force respawn after',
        kind: 'number',
        hint: 'Seconds a body may stay in limbo before it is sent back automatically. 0 lets players lie there; -1 respawns instantly.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_inactivity',
        label: 'Move idle players to spectator after',
        kind: 'number',
        min: 0,
        hint: 'Seconds without input. 0 never does. Frees a slot on a full server without kicking anyone.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_enforcemaxlives',
        label: 'Enforce the life limit',
        kind: 'boolean',
        hint: 'Stops a player who is out of lives from rejoining to get more. Only matters with a limit set under Gameplay.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_maxlivesRespawnPenalty',
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
        label: 'Soldier',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 20000 — panzer, mortar, flamer and mobile MG fuel.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_medicChargeTime',
        label: 'Medic',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 45000 — the syringe.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_engineerChargeTime',
        label: 'Engineer',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 30000 — landmines, dynamite and repairs.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_fieldopsChargeTime',
        label: 'Field ops',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 40000 — artillery and airstrikes.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_covertopsChargeTime',
        label: 'Covert ops',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 30000 — satchel, smoke and the disguise.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_stickyCharge',
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
        label: 'Syringe heals living players',
        kind: 'boolean',
        hint: 'A medic can top up a teammate who is still standing, not only revive the dead.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_legacyRevives',
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
        label: 'Leave bodies lying',
        kind: 'boolean',
        hint: 'Off removes a body as soon as its player respawns. On is prettier and costs entities.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_landminetimeout',
        label: 'Blow up mines when their engineer leaves',
        kind: 'boolean',
        hint: 'Off leaves mines armed after the player who planted them disconnects or switches team.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_dropObjDelay',
        label: 'Delay before the objective can be dropped',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds after picking it up. Default 3000 — stops the objective being tossed around a spawn.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_shoveNoZ',
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
        label: 'Player speed',
        kind: 'number',
        min: 1,
        hint: 'Default 320. Anything else is a mod, not a tweak.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_gravity',
        label: 'Gravity',
        kind: 'number',
        min: 0,
        hint: 'Default 800.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_knockback',
        label: 'Knockback',
        kind: 'number',
        min: 0,
        hint: 'How far explosions throw a player. Default 1000.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_movespeed',
        label: 'Movement speed scale',
        kind: 'number',
        min: 1,
        hint: 'Default 76. Used by the engine alongside player speed; leave it alone unless you are copying a known config.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_pronedelay',
        label: 'Delay before firing after going prone',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. 0 is stock behaviour.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_misc',
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
        label: 'Frame-rate independent physics',
        kind: 'boolean',
        hint: 'Makes jumps behave the same regardless of a player\u2019s FPS.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_fixedphysicsfps',
        label: 'Physics emulated at',
        kind: 'number',
        min: 1,
        hint: 'FPS the physics above pretends everyone runs at. Default 125.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_realHead',
        label: 'Accurate head hitbox',
        kind: 'boolean',
        hint: 'Head shots follow the model\u2019s actual head rather than a fixed box.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_moverScale',
        label: 'Mover speed scale',
        kind: 'text',
        hint: 'How fast tanks and doors travel. Default 1.0.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'g_filtercams',
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
        label: 'Maps on the ballot',
        kind: 'number',
        min: 1,
        hint: 'How many candidates players choose between. Default 6.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_minMapAge',
        label: 'Maps to wait before a repeat',
        kind: 'number',
        min: 0,
        hint: 'A map that has just been played is kept off the ballot this many rounds. Default 3.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_excludedMaps',
        label: 'Never offer these maps',
        kind: 'text',
        hint: 'Space-separated map names, e.g. "railgun". They stay installed and playable by other means.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_mapVoteFlags',
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
        label: 'Maximum playing clients',
        kind: 'number',
        min: 0,
        hint: '0 means every slot may play. Anything higher keeps the rest as spectators.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'match_timeoutlength',
        label: 'Time-out length',
        kind: 'number',
        min: 0,
        hint: 'Seconds a called time-out lasts. Default 180.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_multiview',
        label: 'Multiview for spectators',
        kind: 'boolean',
        hint: 'Lets a spectator watch several players at once. Needs a restart, and clients must support it.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_etltv_flags',
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
        label: 'Warm-up period',
        kind: 'boolean',
        hint: 'Players warm up before the match counts.',
        appliesOn: 'map-change',
      },
      {
        key: 'g_warmup',
        label: 'Warm-up duration (seconds)',
        kind: 'number',
        min: 0,
        max: 300,
        appliesOn: 'map-change',
      },
      {
        key: 'match_warmupDamage',
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
        label: 'Minimum players to start',
        kind: 'number',
        min: 1,
        max: 32,
        appliesOn: 'immediately',
      },
      {
        key: 'match_readypercent',
        label: 'Ready percentage',
        kind: 'number',
        min: 1,
        max: 100,
        hint: 'Share of players who must be ready before a match begins.',
        appliesOn: 'immediately',
      },
      {
        key: 'match_latejoin',
        label: 'Allow late joins',
        kind: 'boolean',
        hint: 'Lets players join a match already in progress.',
        appliesOn: 'immediately',
      },
      {
        key: 'match_mutespecs',
        label: 'Mute spectators',
        kind: 'boolean',
        hint: 'Stops spectators talking to players in a match.',
        appliesOn: 'immediately',
      },
      {
        key: 'match_timeoutcount',
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
        label: 'Team-damage complaint threshold',
        kind: 'number',
        hint: 'Percentage of a player\u2019s health that team damage must reach before a complaint is offered. Negative disables it.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_complaintlimit',
        label: 'Complaints before a kick',
        kind: 'number',
        min: 0,
        max: 50,
        hint: '0 turns complaints off.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_ipcomplaintlimit',
        label: 'Distinct complainants needed',
        kind: 'number',
        min: 0,
        max: 50,
        hint: 'How many different players must complain, so one person cannot force a kick.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_disableComplaints',
        label: 'Ignore explosive team kills',
        kind: 'boolean',
        hint: 'Excludes airstrikes, artillery, mortars and landmines, which cause most accidental team kills.',
        appliesOn: 'immediately',
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
        label: 'Rounds per match',
        kind: 'number',
        min: 1,
        max: 20,
        appliesOn: 'map-change',
      },
      {
        key: 'g_lms_matchlimit',
        label: 'Matches per map',
        kind: 'number',
        min: 1,
        max: 20,
        appliesOn: 'map-change',
      },
      {
        key: 'g_lms_followTeamOnly',
        label: 'Spectate own team only',
        kind: 'boolean',
        appliesOn: 'immediately',
      },
      {
        key: 'g_lms_lockTeams',
        label: 'Lock teams during a round',
        kind: 'boolean',
        appliesOn: 'immediately',
      },
      {
        key: 'g_lms_teamForceBalance',
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
        label: 'Players per team',
        kind: 'number',
        min: 0,
        max: 32,
        appliesOn: 'immediately',
      },
      {
        key: 'team_nocontrols',
        label: 'Disable team controls',
        kind: 'boolean',
        hint: 'Stops players using team commands such as ready and lock.',
        appliesOn: 'immediately',
        advanced: true,
      },
      ...LIMITS.map((limit) => ({
        key: limit.key,
        label: limit.label,
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
        hint: 'Older builds used this as the master switch. ET: Legacy 2.83 and later ignore it — switch the individual votes below off instead.',
        appliesOn: 'immediately',
      },
      {
        key: 'vote_limit',
        label: 'Votes per player each map',
        kind: 'number',
        min: 0,
        max: 20,
        appliesOn: 'immediately',
      },
      {
        key: 'vote_percent',
        label: 'Percentage needed to pass',
        kind: 'number',
        min: 1,
        max: 100,
        appliesOn: 'immediately',
      },
      ...VOTES.map((vote) => ({
        key: vote.key,
        label: vote.label,
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
        key: 'g_antiwarp',
        label: 'Anti-warp',
        kind: 'boolean',
        hint: 'Smooths players whose connection stutters instead of letting them teleport around.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_maxWarp',
        label: 'Warp tolerance',
        kind: 'number',
        min: 1,
        hint: 'Server frames a client may fall behind before anti-warp steps in. Default 4; higher is more forgiving.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_skipCorrection',
        label: 'Correct skipped movement',
        kind: 'boolean',
        hint: 'Replays movement a lagging client missed rather than dropping it.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_teamInfoUpdateRate',
        label: 'Team overlay update interval',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds between team status updates sent to clients. Default 1000; lower costs bandwidth.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_minPing',
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
        label: 'Maximum ping',
        kind: 'number',
        min: 0,
        max: 1000,
        hint: '0 means no maximum. Set this to keep distant players out — it refuses them at connect.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_maxRate',
        label: 'Maximum rate (bytes/s)',
        kind: 'number',
        min: 0,
        max: 100_000,
        hint: '25000 suits ET well. 0 is unlimited.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_spectatorInactivity',
        label: 'Spectator inactivity (seconds)',
        kind: 'number',
        min: 0,
        max: 3600,
        hint: 'Kicks idle spectators so they do not hold a slot. 0 disables it.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_floodProtect',
        label: 'Flood protection',
        kind: 'boolean',
        hint: 'Rate-limits chat and command spam from one client.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_userInfofloodProtect',
        label: 'User-info flood protection',
        kind: 'boolean',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_timeout',
        label: 'Client timeout (seconds)',
        kind: 'number',
        min: 10,
        max: 300,
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'pmove_fixed',
        label: 'Frame-rate independent physics',
        kind: 'boolean',
        hint: 'Makes movement identical regardless of a client’s frame rate. Competitive servers usually enable it.',
        appliesOn: 'map-change',
        advanced: true,
      },
      {
        key: 'pmove_msec',
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
        label: 'Block wallhacks',
        kind: 'boolean',
        // The only measure here that a modified client cannot defeat: the
        // information a wallhack would draw is never sent.
        hint: 'The server stops sending the real position of players you cannot see, so a wallhack has nothing to draw. Costs some CPU.',
        appliesOn: 'restart',
      },
      {
        key: 'sv_wh_bbox_horz',
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
        label: 'Attack log file',
        kind: 'text',
        hint: 'Where blocked flood and rcon attempts are recorded. Empty writes nothing.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_protectLogInterval',
        label: 'Attack log interval',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds between entries, so an attack cannot fill the disk. Default 1000.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_floodProtection',
        label: 'Chat flood protection',
        kind: 'boolean',
        hint: 'Game-side, for chat and commands. The engine has its own limit under Connection quality.',
        appliesOn: 'immediately',
      },
      {
        key: 'g_floodLimit',
        label: 'Messages allowed',
        kind: 'number',
        min: 1,
        hint: 'Within the window below. Default 5.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_floodWait',
        label: 'Flood window',
        kind: 'number',
        min: 0,
        hint: 'Milliseconds. Default 1000.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_logTimestamp',
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
        label: 'Banned addresses',
        kind: 'text',
        hint: 'Space-separated. A trailing 0 wildcards an octet, e.g. "192.168.1.0".',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_filterBan',
        label: 'Enforce the ban list',
        kind: 'boolean',
        hint: 'Off leaves the addresses above listed but lets them connect.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_protect',
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
        label: 'Mod-side protection',
        kind: 'boolean',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_guidCheck',
        label: 'Require a valid GUID',
        kind: 'boolean',
        hint: 'Refuses clients without a valid identifier, which blocks some very old builds.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'g_log',
        label: 'Game log file',
        kind: 'text',
        hint: 'Records kills, connects and weapon changes. Leave empty to disable.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'g_logSync',
        label: 'Write the game log immediately',
        kind: 'boolean',
        hint: 'Slower, but nothing is lost if the server stops abruptly.',
        appliesOn: 'restart',
        advanced: true,
      },
      {
        key: 'logfile',
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
        label: 'Enable bots',
        kind: 'boolean',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'omnibot_path',
        label: 'Omni-bot directory',
        kind: 'text',
        hint: 'Inside the container, e.g. "legacy/omni-bot". Must be the path the game server sees, not the host path.',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'omnibot_flags',
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
        label: 'Modules to load',
        kind: 'text',
        hint: 'Space-separated paths, e.g. "luascripts/wolfadmin/main.lua". Ignored when a module list file is set below.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
      {
        key: 'lua_allowedModules',
        label: 'Allowed module signatures',
        kind: 'text',
        hint: 'Empty allows any module. Otherwise only modules whose signature is listed here may load.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_luaModuleList',
        label: 'Module list file',
        kind: 'text',
        hint: 'A file listing modules to load. When set, it replaces the list above entirely.',
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
        label: 'Extra config to apply',
        kind: 'text',
        hint: 'Executed after the main config, so it wins. Public servers often use "defaultpublic".',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_mapConfigs',
        label: 'Per-map config directory',
        kind: 'text',
        hint: 'A config in here named after the map is applied when that map loads. Empty disables it.',
        appliesOn: 'map-change',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_campaignFile',
        label: 'Campaign file',
        kind: 'text',
        hint: 'Only used by the Campaign game type. Empty uses the campaigns found in the installed pk3 files.',
        appliesOn: 'restart',
        advanced: true,
        expert: true,
      },
      {
        key: 'g_mapScriptDirectory',
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
