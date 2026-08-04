/**
 * Starter server configuration.
 *
 * Bundled into the image as a string rather than shipped as a file to copy, so
 * a fresh install can create a working config from the web UI with no shell
 * access. Values here are deliberately safe defaults: a public objective server
 * with a working map rotation and downloads enabled.
 *
 * Passwords are left empty on purpose — the operator sets them in the
 * Configuration page, which keeps them out of any file this project ships.
 */
export const DEFAULT_SERVER_CONFIG = `// =============================================================================
// ET: Legacy — server configuration
//
// Created by the dashboard. Edit here or on the Configuration page, which
// keeps a timestamped backup of every change.
//
// Colour codes:
//   ^0 black   ^1 red     ^2 green   ^3 yellow  ^4 blue
//   ^5 cyan    ^6 magenta ^7 white   ^8 orange  ^9 grey
// =============================================================================


// --- Identity ----------------------------------------------------------------
set sv_hostname     "^7New ^1ET: Legacy ^7Server"
set g_motd          "Have fun!"

// 2 = dedicated internet server. Anything else and the master servers will not
// list you, so the server never shows up in the public browser.
set dedicated       "2"


// --- Players & access --------------------------------------------------------
set sv_maxclients    "20"   // total slots, including the private ones below
set g_maxGameClients "20"   // how many of those may join a team

set g_password       ""     // empty = public server

set sv_privateClients  "2"
set sv_privatePassword ""   // set this to use the reserved slots

// Needed for the dashboard console and player kick/ban. Set the SAME value in
// the RCON_PASSWORD environment variable of the dashboard container.
set rconpassword     ""

set sv_floodProtect  "1"


// --- Network -----------------------------------------------------------------
set net_ip           ""     // empty = bind all interfaces (required in Docker)
set net_port         "27960"

// The engine's stock rate limits date from the dial-up era.
set sv_maxRate       "25000"


// --- Gameplay ----------------------------------------------------------------
// 2 = Objective, 3 = Stopwatch, 4 = Campaign, 5 = Last Man Standing
set g_gametype       "2"

set timelimit        "25"
set fraglimit        "0"    // 0 = objectives decide the round, not kills
set g_friendlyFire   "1"
set g_gravity        "800"  // engine default
set g_speed          "320"  // engine default
set g_blood          "1"


// --- Downloads ---------------------------------------------------------------
// Leave this on: with it off, anyone missing a custom map cannot join at all.
set sv_allowDownload "1"

// Managed from the dashboard's Maps & FastDL page — it sets both values
// together and verifies the URL is reachable.
set sv_wwwDownload   "0"
set sv_wwwBaseURL    ""

// Only used when FastDL is off; this is the slow in-game UDP transfer.
set sv_dl_maxRate    "42000"


// --- Map rotation ------------------------------------------------------------
// Each entry loads a map and points "nextmap" at the following one; the last
// loops back to the first. The trailing vstr is what starts the rotation —
// without it the server sits on whatever map it booted with.
//
// The dashboard rewrites this block when you edit the rotation in the UI.
//
// >>> dashboard:rotation — managed block, edit via the dashboard
set mr1 "map oasis ; set nextmap vstr mr2"
set mr2 "map radar ; set nextmap vstr mr3"
set mr3 "map railgun ; set nextmap vstr mr4"
set mr4 "map fueldump ; set nextmap vstr mr5"
set mr5 "map battery ; set nextmap vstr mr6"
set mr6 "map goldrush ; set nextmap vstr mr1"
vstr mr1
// <<< dashboard:rotation
`;
