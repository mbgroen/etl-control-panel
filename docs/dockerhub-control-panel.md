# ET: Legacy Control Panel

A self-hosted web control panel for a **Wolfenstein: Enemy Territory (ET: Legacy)**
game server running in Docker. Monitor players live, start and stop the server,
edit the server config safely, manage custom maps, and run an optional HTTP
download (FastDL) server — all from a browser.

![The Overview page: server name and state, players online, current map, uptime, CPU and memory, six hours of player-count and CPU history, and Restart and Stop beside the server name.](https://raw.githubusercontent.com/mbgroen/etl-control-panel/main/docs/screenshots/overview.png)

*A demo server — the players, addresses and server name in the screenshots are invented.*

📖 **Full documentation, more screenshots, compose file and setup guide:**
<https://github.com/mbgroen/etl-control-panel>

---

## What it does

- **Live monitoring** — player list with scores, ping and colour-coded names,
  current map, CPU/memory/uptime, and an activity history.
- **Server control** — start, stop and restart the game server; kick, ban and
  mute players.
- **RCON console** — full console with history and one-click common commands.
  The password is read from the server config, so there is nothing to keep in
  sync and changing it never locks you out.
- **Configuration** — guided forms for around 190 server cvars in eighteen
  sections, behind three levels of detail so the everyday ones stay findable; a
  map-rotation builder, a raw editor with validation, and automatic timestamped
  backups. Settings the mod only reads in certain game types are badged with
  their scope and marked when your game type is not one of them, so a setting
  that cannot do anything says so instead of failing silently.
- **Maps** — browse and upload `.pk3` packages, see which maps each one
  contains, and add any of them to the rotation in a click. Stock game files
  are protected from deletion.
- **FastDL** — enable HTTP map downloads in one action; it starts the web
  server *and* writes the matching cvars, then tests reachability. Every
  download setting lives here, including the in-game transfer limits. The
  Legacy mod package — the file a client downloads when its build differs from
  the server's — is copied out of the game server image automatically, because
  it is the one thing FastDL cannot serve from disk and the one download every
  joining player needs.
- **Logs** — the game server's and FastDL's container output, streamed live,
  with filtering, pause-and-buffer and a download that saves a deeper tail than
  the pane holds. The engine's terminal colour codes are stripped, so what you
  read is the text and not the escapes.
- **Players** — who is playing now, with kick and ban, and who has played
  before: duration, address and country, kept across restarts. Bot visits are
  hidden by default and can be deleted in one action.
- **Accounts** — several administrators, each with their own login. Add and
  remove them, or set a password for someone who has lost theirs; removing an
  account ends its session at once.
- **Diagnostics** — every dependency checked, each failure paired with its fix,
  including one that looks outward: it asks the ET master server what port it
  advertises for you and compares it with the port your server binds. When NAT
  rewrites the heartbeat those differ, and the result is a server that is
  listed, answers queries, and turns away every player who clicks Join.

## Quick start

This image is one service of a three-container stack (game server, control panel,
FastDL). The simplest way to run it is the ready-made compose file:

```bash
mkdir -p ~/etl && cd ~/etl
curl -fsSLO https://raw.githubusercontent.com/mbgroen/etl-control-panel/main/deploy/docker-compose.yml
docker compose up -d
```

Then open **`http://<host-ip>:8085`** and create your administrator account.
Do that straight away — until you do, anyone who can reach the port can claim
the control panel.

**You must supply the base game data.** The ET: Legacy server image ships the
engine and the Legacy mod but no game assets. Copy `pak0.pk3`, `pak1.pk3`,
`pak2.pk3` and `mp_bin.pk3` from any Enemy Territory installation into
`etmain/`, or upload them from the control panel's Maps page. ET has been freeware
since 2003, so the files are a free download.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `RCON_PASSWORD` | empty | Optional override. Normally left unset — the password is read from the server config |
| `ETL_HOST` / `ETL_PORT` | `host.docker.internal` / `27960` | How to reach the game server for status and RCON. It is `host.docker.internal` rather than a service name because the game server runs on the host network — add `extra_hosts: ["host.docker.internal:host-gateway"]` beside it, or use the host's LAN IP |
| `ETL_CONTAINER` | `etl-server` | Container to start/stop and read logs from |
| `ETMAIN_PATH` | `/data/etl-server/etmain` | Game data directory inside this container |
| `STATE_PATH` | `/data/control-panel` | Admin accounts, config backups, player history |
| `SERVER_HOME_PATH` | `/data/etl-server/homepath` | The game server's home directory. Only read, to check the server can write its XP database there |
| `MAX_UPLOAD_MB` | `256` | Initial upload limit; editable under Settings afterwards, along with backup and visit retention |
| `COOKIE_SECURE` | `false` | Set `true` only when serving over HTTPS |

The full list is in
[`.env.example`](https://github.com/mbgroen/etl-control-panel/blob/main/.env.example).

**Why the game server is on the host network.** A server's heartbeat to the
master carries no port number — the master reads it off the packet's source.
Behind a Docker bridge that source port is rewritten to a random high one, so
the public browser lists your server on a port nothing answers on: it appears
in the list, and every Join fails. `network_mode: host` for the game server is
what avoids that, and it is what the compose file in the repository does.

**Ports and volumes.** Listens on **8080** inside the container (the compose
file publishes it on 8085, since 8080 is heavily contended on home servers).
Needs the game data directory mounted, a writable state directory, and the
Docker socket for container control and log streaming.

The game server alongside it needs one more mount than is obvious: its home
directory, where it keeps the XP database, the game and attack logs and the
cvars it archives itself. Without it those live in the container and vanish on
the next `docker compose pull`. It must be owned by uid 1000 — Diagnostics
checks this and names the fix, because a server that cannot write there says
nothing about it.

## Tags

| Tag | Meaning |
|---|---|
| `latest` | Newest release |
| `1.12.2`, `1.11.0`, … | An exact release. Never moves — use one to pin. See the [releases](https://github.com/mbgroen/etl-control-panel/releases) |

Every image records the commit it was built from:

```bash
docker inspect <image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Built for `linux/amd64`. Multi-arch builds are available from the workflow in
the repository if you run on ARM.

## Security

The control panel controls a game server and mounts the Docker socket, which is
root-equivalent on the host. **Keep it on your LAN**; do not port-forward it.
FastDL (8081) and the game port (27960/udp) are the only ones that need to face
the internet. See the security notes in the repository for the hardened,
unprivileged variant.

## Licence

MIT — see the [repository](https://github.com/mbgroen/etl-control-panel).
