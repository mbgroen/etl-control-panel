# ET: Legacy Server Dashboard

A self-hosted web control panel for a **Wolfenstein: Enemy Territory (ET: Legacy)**
game server running in Docker. Monitor players live, start and stop the server,
edit the server config safely, manage custom maps, and run an optional HTTP
download (FastDL) server — all from a browser.

📖 **Full documentation, compose file and setup guide:**
<https://github.com/mbgroen/etlegacy_dashboard>

---

## What it does

- **Live monitoring** — player list with scores, ping and colour-coded names,
  current map, CPU/memory/uptime, and an activity history.
- **Server control** — start, stop and restart the game server; kick, ban and
  mute players.
- **RCON console** — full console with history and one-click common commands.
  The password is read from the server config, so there is nothing to keep in
  sync and changing it never locks you out.
- **Configuration** — guided forms for common cvars, a map-rotation builder, a
  raw editor with validation, and automatic timestamped backups.
- **Maps** — browse and upload `.pk3` packages from the browser; stock game
  files are protected from deletion.
- **FastDL** — enable HTTP map downloads in one action; it starts the web
  server *and* writes the matching cvars, then tests reachability.
- **Diagnostics** — every dependency checked, each failure paired with its fix.

## Quick start

This image is one service of a three-container stack (game server, dashboard,
FastDL). The simplest way to run it is the ready-made compose file:

```bash
mkdir -p ~/etlegacy && cd ~/etlegacy
curl -fsSLO https://raw.githubusercontent.com/mbgroen/etlegacy_dashboard/main/deploy/docker-compose.yml
docker compose up -d
```

Then open **`http://<host-ip>:8085`** and create your administrator account.
Do that straight away — until you do, anyone who can reach the port can claim
the dashboard.

**You must supply the base game data.** The ET: Legacy server image ships the
engine and the Legacy mod but no game assets. Copy `pak0.pk3`, `pak1.pk3`,
`pak2.pk3` and `mp_bin.pk3` from any Enemy Territory installation into
`etmain/`, or upload them from the dashboard's Maps page. ET has been freeware
since 2003, so the files are a free download.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `RCON_PASSWORD` | empty | Optional override. Normally left unset — the password is read from the server config |
| `ETL_HOST` / `ETL_PORT` | `etlegacy` / `27960` | How to reach the game server for status and RCON |
| `ETL_CONTAINER` | `etlegacy-server` | Container to start/stop and read logs from |
| `ETMAIN_PATH` | `/data/etlegacy/etmain` | Game data directory inside this container |
| `STATE_PATH` | `/data/dashboard` | Admin account, config backups, activity history |
| `MAX_UPLOAD_MB` | `256` | Initial upload limit; editable in the UI afterwards |
| `COOKIE_SECURE` | `false` | Set `true` only when serving over HTTPS |

The full list is in
[`.env.example`](https://github.com/mbgroen/etlegacy_dashboard/blob/main/.env.example).

**Ports and volumes.** Listens on **8080** inside the container (the compose
file publishes it on 8085, since 8080 is heavily contended on home servers).
Needs the game data directory mounted, a writable state directory, and the
Docker socket for container control and log streaming.

## Tags

| Tag | Meaning |
|---|---|
| `latest` | Newest release |
| `1.1.0` | An exact version. Never moves — use this to pin |

Every image records the commit it was built from:

```bash
docker inspect <image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Built for `linux/amd64`. Multi-arch builds are available from the workflow in
the repository if you run on ARM.

## Security

The dashboard controls a game server and mounts the Docker socket, which is
root-equivalent on the host. **Keep it on your LAN**; do not port-forward it.
FastDL (8081) and the game port (27960/udp) are the only ones that need to face
the internet. See the security notes in the repository for the hardened,
unprivileged variant.

## Licence

MIT — see the [repository](https://github.com/mbgroen/etlegacy_dashboard).
