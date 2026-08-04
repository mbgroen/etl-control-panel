# ET: Legacy Server Dashboard

A self-hosted control panel for a Wolfenstein: Enemy Territory (ET: Legacy) game
server running in Docker. Monitor players in real time, start and stop the
server, edit the server config safely, manage custom maps, and run an optional
HTTP download (FastDL) server — all from a browser on your LAN.

Built to run alongside the game server on an OpenMediaVault host with the
Compose plugin, but it is plain Docker Compose and runs anywhere Docker does.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration reference](#configuration-reference)
- [Using the dashboard](#using-the-dashboard)
- [FastDL — HTTP map downloads](#fastdl--http-map-downloads)
- [Security](#security)
- [API reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## What it does

| Area | Capabilities |
|---|---|
| **Monitoring** | Live player list with scores, ping and colour-coded names; current map; CPU, memory and uptime; 8-hour activity history |
| **Control** | Start / stop / restart the game server container; kick, ban and mute players |
| **Console** | Full RCON console with command history, plus one-click common commands |
| **Logs** | Live-streamed container logs with filtering, pause-and-buffer, and follow-tail |
| **Configuration** | Guided forms for common cvars, a map-rotation builder, a raw editor with validation, and automatic timestamped backups |
| **Maps** | Browse installed `.pk3` packages, drag-and-drop upload with progress, delete custom maps (stock paks are protected) |
| **FastDL** | Enable/disable HTTP downloads in one action — starts the web server *and* writes the matching cvars — with a reachability test |
| **Diagnostics** | Every dependency checked, each failure paired with the fix |

The UI is keyboard-navigable, screen-reader labelled, responsive down to phone
width, and ships light and dark themes.

---

## Architecture

```
                        ┌──────────────────────────────┐
   browser  ──HTTP/WS──▶│  etlegacy-dashboard  :8080   │
                        │  Node 22 · Express · React   │
                        └──┬──────────┬────────────┬───┘
                           │          │            │
              docker.sock  │          │ UDP 27960  │ bind mount
                           ▼          ▼            ▼
                  ┌────────────┐ ┌──────────┐ ┌──────────────┐
                  │  Docker    │ │ etlegacy │ │ etmain/      │
                  │  daemon    │ │  -server │ │  *.pk3, .cfg │
                  └────────────┘ └──────────┘ └──────┬───────┘
                                                     │ read-only
                                              ┌──────▼────────┐
                                              │ etlegacy-     │
                                              │ fastdl  :8081 │
                                              │ nginx         │
                                              └───────────────┘
```

Three containers on one bridge network:

- **`etlegacy-server`** — the game server, unchanged from the official image.
- **`etlegacy-dashboard`** — this project. Talks to the Docker daemon for
  container lifecycle and logs, to the game server over UDP for status and
  RCON, and to the bind-mounted `etmain` directory for config and map files.
- **`etlegacy-fastdl`** — nginx serving `etmain` read-only over HTTP. Optional;
  the dashboard starts and stops it on demand.

The dashboard and FastDL both mount **the same host directory** the game server
uses. There is no copying or syncing: what the server has installed is exactly
what the dashboard lists and what clients can download.

---

## Prerequisites

- **Docker Engine 20.10+** and the **Docker Compose v2** plugin.
  On OpenMediaVault 8: *System → Plugins → `openmediavault-compose`*.
- **A host directory for persistent data**, on a data disk rather than the OS
  disk. On OMV this is the Compose plugin's configured *Data* path.
- **UDP port 27960** reachable by players (port-forwarded on your router if the
  server should be public).
- **TCP port 8080** for the dashboard, and **8081** if you use FastDL.
- Roughly **400 MB of disk** for the images, plus whatever your maps need.

> **Upgrading an existing server?** This stack manages the same `etmain`
> directory your current server uses. Point `COMPOSE_DATA_PATH` at your existing
> data location and your maps and config carry over untouched.

---

## Installation

### 1. Get the files onto the host

```bash
cd /srv/dev-disk-by-uuid-xxxxxxxx/appdata   # your data disk
git clone https://github.com/mbgroen/etlegacy_dashboard.git
cd etlegacy_dashboard
```

### 2. Create the data directories

```bash
# Substitute your own data path
export DATA=/srv/dev-disk-by-uuid-xxxxxxxx/appdata

mkdir -p "$DATA"/etlegacy/{etmain,legacy} "$DATA"/dashboard
```

### 3. Install a server config

```bash
cp config/etl_server.cfg.example "$DATA"/etlegacy/etmain/etl_server.cfg
```

Open it and change at least `sv_hostname`, `rconpassword` and
`sv_privatePassword`. The dashboard can edit everything else later.

### 4. Generate credentials

The dashboard stores a **bcrypt hash**, never your password. Build the image and
use its built-in generator:

```bash
docker compose build dashboard
docker compose run --rm --no-deps --entrypoint node dashboard dist/cli/hashPassword.js
```

It prompts for a password and prints an `ADMIN_PASSWORD_HASH` and a random
`SESSION_SECRET`. Keep both.

### 5. Fill in the environment

```bash
cp .env.example .env
nano .env
```

The values you must set are `COMPOSE_DATA_PATH`, `ADMIN_PASSWORD_HASH`,
`SESSION_SECRET`, and `RCON_PASSWORD`. Find the two ID values like this:

```bash
# GID of the docker group — lets the dashboard use the socket unprivileged
getent group docker | cut -d: -f3

# Owner of your etmain directory — the dashboard must be able to write here
stat -c '%u %g' "$DATA"/etlegacy/etmain
```

Put those in `DOCKER_GID`, and `PUID`/`PGID` respectively.

> **`$` in the hash:** bcrypt hashes contain `$`. Docker Compose does not expand
> variables inside a `.env` file, so pasting it plainly is fine. If you export it
> from a shell instead, single-quote it.

### 6. Start

```bash
docker compose up -d
docker compose ps
```

Open **`http://<host-ip>:8080`** and sign in.

Go to **Diagnostics** first — it verifies the Docker socket, the container
names, the config path and the RCON credentials, and tells you how to fix
anything that is wrong.

### Installing on OpenMediaVault 8

1. *Services → Compose → Files → **＋***.
2. Paste `docker-compose.yml` into the file box.
3. Paste your completed `.env` contents into the **Environment** box — OMV
   writes it as the `.env` next to the compose file.
4. OMV substitutes its configured data path for `CHANGE_TO_COMPOSE_DATA_PATH`;
   this project uses `${COMPOSE_DATA_PATH}` instead, so set that variable to the
   same path in the Environment box.
5. Save, then *Up*.

The `fastdl/nginx.conf` bind mount is relative to the compose file. If OMV
stores your compose file elsewhere, either clone the repo next to it or change
that volume line to an absolute path.

---

## Configuration reference

All settings are environment variables; see `.env.example` for the annotated
list. The ones that matter most:

| Variable | Default | Notes |
|---|---|---|
| `COMPOSE_DATA_PATH` | — | **Required.** Host directory holding `etlegacy/` and `dashboard/` |
| `ADMIN_USERNAME` | `admin` | Dashboard login |
| `ADMIN_PASSWORD_HASH` | — | **Required.** Bcrypt hash; generate as shown above |
| `SESSION_SECRET` | — | **Required.** 32+ bytes. Changing it signs everyone out |
| `RCON_PASSWORD` | empty | Must match `rconpassword` in the server config, or the console and player admin stay disabled |
| `COOKIE_SECURE` | `false` | Set `true` **only** behind HTTPS — otherwise sign-in silently fails |
| `SERVER_CONFIG_NAME` | `etl_server.cfg` | Filename the game server execs, inside `etmain` |
| `FASTDL_BASE_URL` | empty | Pre-fills the FastDL URL field. Must be reachable **by players** |
| `PUID` / `PGID` | `1000` / `100` | Must be able to write `etmain` |
| `DOCKER_GID` | `999` | Host `docker` group GID |
| `POLL_INTERVAL_SEC` | `10` | Status poll frequency |
| `MAX_UPLOAD_MB` | `256` | Per-file `.pk3` upload limit |

### Keeping RCON in sync

`RCON_PASSWORD` (dashboard) and `rconpassword` (game server) are two copies of
one secret. If you change it in the Configuration page, update `.env` and run
`docker compose up -d dashboard` too, or the console stops working.

---

## Using the dashboard

**Overview** — status, players, trends, and the start/stop/restart controls.
Kick and ban appear once RCON is configured, since they need slot numbers that
only RCON exposes.

**Console** — a real RCON console. Arrow keys recall history. Note that
commands typed here change the *running* server only; they are lost on restart.
Use Configuration to make a change permanent.

**Logs** — live container output. Auto-scroll releases the moment you scroll up
to read something, and pausing buffers rather than drops lines.

**Configuration** — four views over one file:

- *Settings* — guided fields for the cvars people actually change. Each says
  whether it applies immediately, at the next map, or needs a restart.
- *Map rotation* — build the rotation as an ordered list. The dashboard writes
  the `vstr` chain, which is fiddly to hand-write correctly.
- *Raw file* — the whole config, validated as you type. Always the source of
  truth; the other views only patch it.
- *Backups* — every save is snapshotted first. The 30 most recent are kept, as
  plain files you can also recover with `cp`.

Passwords show as `••••••••` and are never sent to the browser. Leaving a
password field untouched leaves it unchanged.

**Maps & FastDL** — the pk3 library and the download server. See below.

**Diagnostics** — dependency checks and the exact remedy for each failure.

---

## FastDL — HTTP map downloads

Without FastDL, a player missing a custom map downloads it through the game's
UDP channel at roughly 100 KB/s. A 60 MB map pack takes ten minutes and usually
times out. With FastDL the client fetches it over HTTP at full line speed.

**To enable:** *Maps & FastDL → Public base URL → Enable HTTP downloads.*

The base URL must be the address **players** can reach — your LAN IP or public
hostname with the FastDL port. Not `localhost`, and not a Docker service name.

```
http://192.168.1.10:8081        LAN only
http://et.example.com:8081      internet (forward TCP 8081 on your router)
```

Enabling does three things at once, which is the point: it starts the nginx
container, sets `sv_wwwDownload 1` and `sv_wwwBaseURL`, and leaves
`sv_allowDownload` on as a fallback. Half of that configuration is the usual
cause of downloads that mysteriously fail.

Then press **Test connection** — it fetches a real `.pk3` through the public URL
exactly as a client would, and compares the size against the file on disk.

Clients request `<base URL>/etmain/<map>.pk3`. nginx serves **only** `.pk3`
files from `etmain` and `legacy`; configs, logs and ban lists in the same
directory are not reachable.

Restart the game server (or run `exec etl_server.cfg` in the console) so it
picks up the new download settings.

---

## Security

**This dashboard is not built to face the public internet.** Run it on your LAN,
or behind a VPN or an authenticating reverse proxy.

- **The Docker socket is mounted.** That is equivalent to root on the host. The
  dashboard refuses to touch any container except the two it is configured to
  manage, but the socket itself is the trust boundary. For a hardened setup, put
  a socket proxy such as `tecnativa/docker-socket-proxy` in front of it and
  grant only `CONTAINERS=1`, `POST=1`.
- **Run behind TLS if it leaves your LAN**, and set `COOKIE_SECURE=true` when
  you do.
- **RCON is cleartext UDP** — that is the protocol, not this implementation.
  Keep the game server and dashboard on the same host or a trusted network.
- Sessions are httpOnly, `SameSite=Strict` JWT cookies. Login is rate-limited
  to 10 attempts per 10 minutes per IP; the RCON endpoint to 60/minute.
- Uploads accept only `.pk3` filenames matching a strict pattern, are written to
  a temp directory first, and cannot escape `etmain`.
- Secrets are masked in API responses and redacted from logs.

**Rotate any password that has been shared or committed.** If a config with real
passwords in it has ever been pasted into a chat, an issue tracker, or a public
repository, change `rconpassword` and `sv_privatePassword` and update `.env`.

---

## API reference

Everything the UI does is available over REST. All endpoints require the session
cookie from `POST /api/auth/login`; all responses are JSON, and errors share one
envelope:

```json
{ "error": { "code": "config_conflict", "message": "…", "details": {} } }
```

<details>
<summary><strong>Endpoints</strong></summary>

### Authentication
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | `{username, password}` → sets session cookie |
| `POST` | `/api/auth/logout` | Clears the session |
| `GET` | `/api/auth/session` | Current user, or 401 |

### Server
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/server/status` | Full snapshot: container, resources, game status |
| `POST` | `/api/server/lifecycle` | `{service, action}` — `start` / `stop` / `restart` |
| `GET` | `/api/server/players` | Player list; detailed (with slots) when RCON is configured |
| `POST` | `/api/server/players/action` | `{slot, action, reason}` — `kick` / `ban` / `mute` / `unmute` |
| `GET` | `/api/server/history?minutes=&points=` | Activity samples and summary |

### Console
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/console/rcon` | `{command}` → server output |
| `GET` | `/api/console/commands` | Curated quick-command palette |

### Configuration
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/config` | Content, parsed cvars (masked), rotation, validation problems |
| `PUT` | `/api/config` | Replace whole file; supports `expectedRevision`, `force`, `reload` |
| `PATCH` | `/api/config/cvars` | Patch specific cvars in place |
| `PUT` | `/api/config/rotation` | `{maps: [...]}` → rewrites the rotation block |
| `POST` | `/api/config/validate` | Lint without saving |
| `GET` | `/api/config/backups` | List backups |
| `POST` | `/api/config/backups/:id/restore` | Restore (takes a backup first) |

### Maps & FastDL
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/maps` | Installed packages and storage usage |
| `POST` | `/api/maps/upload` | multipart `files` — up to 8 `.pk3` per request |
| `DELETE` | `/api/maps/:filename` | Delete a custom pak (stock paks return 403) |
| `GET` | `/api/fastdl` | FastDL state |
| `POST` | `/api/fastdl/enable` | `{baseUrl, allowDisconnectedDownload}` |
| `POST` | `/api/fastdl/disable` | Turns it off and stops the web server |
| `POST` | `/api/fastdl/test` | Reachability probe through the public URL |

### System
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/system/health` | Dependency checks with remedies; 503 when degraded |
| `GET` | `/api/system/info` | Non-secret runtime configuration |
| `GET` | `/api/system/logs/:service?tail=` | Log tail snapshot |
| `GET` | `/healthz` | Unauthenticated liveness probe |

### WebSocket

`GET /api/ws` — authenticated by the same session cookie.

Server → client: `{type:'snapshot', data}`, `{type:'log', service, line}`,
`{type:'log-backlog', service, lines}`.
Client → server: `{type:'subscribe'|'unsubscribe', channel}` where channel is
`status`, `logs:game` or `logs:fastdl`.

</details>

**Example**

```bash
curl -c jar -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"…"}'

curl -b jar http://localhost:8080/api/server/status | jq '.game.status.players'

curl -b jar -X POST http://localhost:8080/api/console/rcon \
  -H 'Content-Type: application/json' \
  -d '{"command":"say Server restarting in 5 minutes"}'
```

---

## Troubleshooting

**Diagnostics is the first stop** — it names the failing dependency and the fix.

| Symptom | Cause and fix |
|---|---|
| Sign-in does nothing, no error | `COOKIE_SECURE=true` on plain HTTP. Set it to `false`, or serve over HTTPS |
| "Container does not exist" | `ETL_CONTAINER` does not match `container_name` in the compose file |
| Docker socket check fails | Socket not mounted, or `DOCKER_GID` is wrong. Check `getent group docker \| cut -d: -f3` |
| Server shows offline but players are on it | The dashboard cannot reach `etlegacy:27960`. Confirm both containers share the `etlegacy` network |
| Console says RCON is not configured | Set `RCON_PASSWORD` in `.env` to match `rconpassword`, then `docker compose up -d dashboard` |
| "Bad rconpassword" | The two copies have drifted apart. Make them match |
| Config saves fail with a permission error | `PUID`/`PGID` cannot write `etmain`. Compare with `stat -c '%u %g' …/etmain` |
| Config edits have no effect | Cvar is latched — check the badge on the field. Restart, or the file is not the one the server execs (`SERVER_CONFIG_NAME`) |
| Uploads fail at ~100% | File exceeds `MAX_UPLOAD_MB` |
| FastDL test fails | The base URL is not reachable from outside the host. Use the LAN/public IP, not `localhost`, and check the port is published and forwarded |
| Clients still download slowly | The game server has not re-read the config. Restart it, or run `exec etl_server.cfg` in the console |
| Map rotation is ignored | Campaign cvars set with `g_gametype 2`. Campaign settings only apply in gametype 4 — see the example config |

Logs:

```bash
docker compose logs -f dashboard
docker compose logs -f etlegacy
```

---

## Development

```bash
# Backend — http://localhost:8080
cd server && npm install
ADMIN_PASSWORD_HASH='…' SESSION_SECRET='…' ETMAIN_PATH=./dev-data npm run dev

# Frontend — http://localhost:5173, proxies /api to the backend
cd web && npm install && npm run dev
```

```bash
cd server && npm test        # protocol and config parsers
cd server && npm run typecheck
cd web && npm run build
```

### Layout

```
server/src/
  services/q3protocol.ts   Quake 3 UDP protocol: getstatus, rcon, parsing
  services/serverConfig.ts cfg parsing, validation, atomic writes, backups
  services/docker.ts       Container lifecycle, stats, log streams
  services/maps.ts         pk3 library, upload safety
  services/poller.ts       Single shared background poll
  routes/                  REST endpoints
  http/                    App wiring, auth, errors, WebSocket hub
web/src/
  pages/                   One file per screen
  components/              Design-system primitives
  lib/                     API client, live socket, formatting, tokens
```

The colour, spacing and type tokens live in `web/src/styles/global.css`. Both
themes are defined there as variable sets; components never hard-code a colour.

---

## Licence

MIT — see `LICENSE`.
