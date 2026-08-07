/**
 * The ET: Legacy server settings the dashboard exposes as a form.
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
  /** Hidden behind "Show advanced" — correct defaults, rarely worth touching. */
  advanced?: boolean;
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
        hint: 'Unlocks the console and player kick/ban. The dashboard picks this up immediately — nothing to copy elsewhere, no restart.',
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
    id: 'match',
    title: 'Match & warm-up',
    description: 'How a match starts, pauses and ends.',
    cvars: [
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
        key: 'g_allowVote',
        label: 'Allow voting',
        kind: 'boolean',
        hint: 'Turns the whole voting system on or off.',
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
    id: 'downloads',
    title: 'Downloads',
    description:
      'How clients fetch maps they are missing. The Maps & FastDL page sets these up for you.',
    cvars: [
      {
        key: 'sv_allowDownload',
        label: 'Allow downloads',
        kind: 'boolean',
        hint: 'Off means players without a map simply cannot join.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_wwwDownload',
        label: 'HTTP downloads (FastDL)',
        kind: 'boolean',
        hint: 'Fetches maps over HTTP instead of the slow in-game transfer.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_wwwBaseURL',
        label: 'FastDL base URL',
        kind: 'text',
        hint: 'The address players can reach, e.g. http://198.51.100.10:8081 — not an internal Docker name.',
        appliesOn: 'immediately',
      },
      {
        key: 'sv_wwwFallbackURL',
        label: 'Fallback URL',
        kind: 'text',
        hint: 'Tried when the base URL refuses or fails client-side.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_wwwDlDisconnected',
        label: 'Download while disconnected',
        kind: 'boolean',
        hint: 'Lets clients keep downloading after they drop out. Off is safer on flaky connections.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_dlRate',
        label: 'In-game download rate (KB/s)',
        kind: 'number',
        min: 0,
        max: 10_000,
        hint: 'Only applies to the slow built-in transfer, not to FastDL.',
        appliesOn: 'immediately',
        advanced: true,
      },
      {
        key: 'sv_dl_timeout',
        label: 'Download timeout (seconds)',
        kind: 'number',
        min: 10,
        max: 600,
        appliesOn: 'immediately',
        advanced: true,
      },
    ],
  },

  {
    id: 'connection',
    title: 'Connection quality',
    description: 'Who may connect, and how much bandwidth each client gets.',
    cvars: [
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
        key: 'sv_protect',
        label: 'Server protection',
        kind: 'select',
        options: [
          { value: '0', label: 'Off' },
          { value: '1', label: 'DDoS protection' },
          { value: '2', label: 'DRDoS protection' },
        ],
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
];

export const APPLIES_LABEL: Record<CvarSpec['appliesOn'], string> = {
  immediately: 'Applies immediately',
  'map-change': 'Applies on next map',
  restart: 'Requires a restart',
};

/** Every cvar the form knows about, for search and validation. */
export const ALL_CVARS: CvarSpec[] = CVAR_SECTIONS.flatMap((section) => section.cvars);

export { onOff };
