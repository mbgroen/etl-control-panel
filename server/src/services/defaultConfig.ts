/**
 * Starter server configuration.
 *
 * Bundled into the image as a string rather than shipped as a file to copy, so
 * a fresh install can create a working config from the web UI with no shell
 * access.
 *
 * Deliberately opinionated: a blank file makes someone paste a stranger's
 * config, and those carry cvars the engine stopped reading years ago. Every
 * setting here is one ET: Legacy 2.84 actually reads, checked against
 * g_cvars.c and the engine's own Cvar_Get calls, and every line that departs
 * from the default says what the default was and why.
 *
 * No identity and no secrets: the hostname is a placeholder, the message of the
 * day is empty, and every password field is blank. A password that ships in a
 * public image is a password everyone has.
 */
export const DEFAULT_SERVER_CONFIG = `// =============================================================================
// ET: Legacy — server configuration
//
// Created by the control panel. Edit here or on the Configuration page, which
// keeps a timestamped backup of every change.
//
// This is a working public objective server, not a blank file: every setting
// below is one ET: Legacy 2.84 actually reads, and every line that departs from
// the engine default says what the default was and why this differs. Delete a
// line to go back to the default — an empty value is not "unset", it is zero.
//
// Colour codes:
//   ^0 black   ^1 red     ^2 green   ^3 yellow  ^4 blue
//   ^5 cyan    ^6 magenta ^7 white   ^8 orange  ^9 grey
// =============================================================================


// --- Identity ----------------------------------------------------------------
// Yours to write. Keep it under 26 visible characters or the server browser
// truncates it; colour codes do not count towards that.
set sv_hostname      "^7ET: ^1Legacy ^7Server"

// Shown when a player joins. Both are empty on purpose — say something or
// leave them silent.
set g_motd           ""
set server_motd0     ""

// 2 = dedicated internet server. Anything else and the master servers will not
// list you, so the server never appears in the public browser.
set dedicated        "2"

// Default 1 (heartbeat only). 3 also reports to Trackbase, which is what puts
// your server in the public stats sites.
set sv_advert        "3"

set g_countryFlags   "1"


// --- Players & access --------------------------------------------------------
// Default 20 slots. 24 with four held back as spectator space: a full server
// that cannot be watched is a server nobody joins.
set sv_maxclients    "24"
set g_maxGameClients "20"   // of those, how many may join a team. 0 = all

set g_password       ""     // empty = public server

// Default 0 reserved. Two slots that only sv_privatePassword opens, so you can
// always get in. Set the password or the slots simply go unused.
set sv_privateClients  "2"
set sv_privatePassword ""

// Needed for the control panel console and player kick/ban. Set it here — the
// control panel reads it straight from this file, so nothing else has to change.
set rconpassword     ""

// Default 0 = unlimited. Four connections from one address is generous for a
// household and stops one host filling the server.
set sv_ipMaxClients  "4"


// --- Network -----------------------------------------------------------------
set net_ip           ""     // empty = bind all interfaces (required in Docker)
set net_port         "27960"

// Bytes per second per client. 0 lets each client ask for what it wants; a cap
// only helps when the server's uplink is the bottleneck.
set sv_maxRate       "0"

set sv_floodProtect         "1"
set sv_userInfofloodProtect "1"
set g_floodProtection       "1"


// --- Protection --------------------------------------------------------------
// Refuses modified pk3 files, which is what stops see-through-wall skins.
set sv_pure          "1"

// A bitmask, and both bits matter. 1 rate-limits status queries so a flood
// cannot wedge the server. 2 refuses to answer a spoofed query — without it
// your server is a reflector: a 15-byte request produces a reply many times
// larger, aimed at whoever the attacker named. Default is 0.
set sv_protect       "3"

// Server-side wallhack blocking: positions of players you cannot see are not
// sent, so there is nothing for a wallhack to draw. Default 0 because it costs
// CPU — measure before turning it off again.
set sv_wh_active     "1"

set g_protect        "1"
set g_guidCheck      "1"


// --- Gameplay ----------------------------------------------------------------
// 2 = Objective, 3 = Stopwatch, 4 = Campaign, 5 = Last Man Standing,
// 6 = Map voting.
set g_gametype       "2"

// Usually replaced by the map script; this is only the fallback.
set timelimit        "25"

set g_friendlyFire   "1"
set g_antilag        "1"

// Default 0. Stops players stacking one side.
set g_teamforcebalance "1"

// Default 0. Prevents switching sides mid-round; spectators can still join.
set g_noTeamSwitching  "1"

// Default 0 seconds (never). Idle players go to spectator, then out, freeing
// slots on a full server without anyone having to intervene.
set g_inactivity          "300"
set g_spectatorInactivity "600"

// Default 0 = a body may lie in limbo until the next wave. 30 seconds keeps
// the game moving without shortening the respawn wave itself.
set g_forcerespawn   "30"

// Respawn waves, in SECONDS, and 0 means "use whatever the map asks for".
// These are the ones to change: nearly every map script overwrites
// g_redlimbotime/g_bluelimbotime at load, and honours these instead.
set g_userAxisRespawnTime   "0"
set g_userAlliedRespawnTime "0"


// --- Complaints --------------------------------------------------------------
// Six team kills and the player is removed. Default 6, restated because it is
// the safety net that lets a public server run unattended.
set g_complaintlimit "6"

// Default 0. Exempts airstrike, artillery, mortar and landmine team kills,
// which are usually accidents and otherwise generate most complaints.
set g_disableComplaints "1"


// --- XP ----------------------------------------------------------------------
// Bitmask: 1 save on disconnect, 2 keep this map's XP through a restart,
// 8 drop a duplicate GUID. Default 0 — XP resets constantly, which regulars
// notice. Flag 4 (never reset) is deliberately absent so the age below applies.
set g_xpSaver        "11"
set g_xpSaverMaxAge  "604800"   // one week; default is one day


// --- Warm-up & intermission --------------------------------------------------
// Default 0. A short warm-up lets people load in before the round counts.
set g_doWarmup       "1"
set g_warmup         "15"   // default 60, which is a long time to stand around

set match_warmupDamage  "2"   // default 1 (enemy only); 2 = everybody
set match_readypercent  "50"  // default 100, which one idle player can block

set g_intermissionTime  "15"  // default 60


// --- Voting ------------------------------------------------------------------
// Bit 4 appends "(called by ...)" to the vote, so a vote is never anonymous.
set g_voting         "4"
set vote_percent     "50"
set vote_limit       "5"

// Every vote_allow_* defaults to 1 except referee and timelimit. They are all
// listed here — including the ones already on — because a missing line reads
// as "off" and is not.
set vote_allow_map                    "1"
set vote_allow_nextmap                "1"
set vote_allow_maprestart             "1"
set vote_allow_matchreset             "1"
set vote_allow_shuffleteams           "1"
set vote_allow_shuffleteams_norestart "1"
set vote_allow_balancedteams          "1"
set vote_allow_muting                 "1"
set vote_allow_mutespecs              "1"
set vote_allow_antilag                "1"
set vote_allow_poll                   "1"
set vote_allow_surrender              "1"
set vote_allow_swapteams              "1"
set vote_allow_warmupdamage           "1"
set vote_allow_cointoss               "1"

// Off deliberately. Kick is what a complaint system and an admin are for;
// config swaps rewrite dozens of settings at once; the rest change the shape
// of the server rather than the round.
set vote_allow_kick             "0"
set vote_allow_config           "0"
set vote_allow_gametype         "0"
set vote_allow_referee          "0"
set vote_allow_friendlyfire     "0"
set vote_allow_timelimit        "0"
set vote_allow_restartcampaign  "0"
set vote_allow_nextcampaign     "0"


// --- Connection quality ------------------------------------------------------
set g_antiwarp       "1"
set g_maxWarp        "4"


// --- Downloads ---------------------------------------------------------------
// Leave this on: with it off, anyone missing a custom map cannot join at all.
set sv_allowDownload "1"

// Managed from the control panel's FastDL page — it sets both values together
// and verifies the URL is reachable.
set sv_wwwDownload   "0"
set sv_wwwBaseURL    ""

// KB/s for the slow in-game UDP transfer, used when FastDL is off or a client
// cannot reach it. FastDL itself runs at whatever nginx manages.
set sv_dlRate        "100"


// --- Map rotation ------------------------------------------------------------
// Each entry loads a map and points "nextmap" at the following one; the last
// loops back to the first. The trailing vstr is what starts the rotation —
// without it the server sits on whatever map it booted with.
//
// The control panel rewrites this block when you edit the rotation in the UI.
//
// >>> control-panel:rotation — managed block, edit via the control panel
set mr1 "map oasis ; set nextmap vstr mr2"
set mr2 "map radar ; set nextmap vstr mr3"
set mr3 "map railgun ; set nextmap vstr mr4"
set mr4 "map fueldump ; set nextmap vstr mr5"
set mr5 "map battery ; set nextmap vstr mr6"
set mr6 "map goldrush ; set nextmap vstr mr1"
vstr mr1
// <<< control-panel:rotation
`;
