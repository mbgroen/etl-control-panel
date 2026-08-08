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
 *
 * Every cvar here is one ET: Legacy 2.84 actually reads, checked against
 * g_cvars.c and sv_init.c. A starter config is the first thing an operator
 * copies from, so a plausible-looking line the engine ignores — fraglimit,
 * g_blood and sv_dl_maxRate all used to be here — propagates for years.
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

// Bytes per second per client. 0 lets each client ask for what it wants; a
// cap only helps when the server's uplink is the bottleneck.
set sv_maxRate       "0"


// --- Gameplay ----------------------------------------------------------------
// 2 = Objective, 3 = Stopwatch, 4 = Campaign, 5 = Last Man Standing
set g_gametype       "2"

// Usually replaced by the map script; this is only the fallback.
set timelimit        "25"

set g_friendlyFire   "1"
set g_gravity        "800"  // engine default
set g_speed          "320"  // engine default


// --- Downloads ---------------------------------------------------------------
// Leave this on: with it off, anyone missing a custom map cannot join at all.
set sv_allowDownload "1"

// Managed from the dashboard's FastDL page — it sets both values together
// and verifies the URL is reachable.
set sv_wwwDownload   "0"
set sv_wwwBaseURL    ""

// KB/s for the slow in-game UDP transfer, used when FastDL is off or a
// client cannot reach it. FastDL itself runs at whatever nginx manages.
set sv_dlRate        "100"


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
