# ET: Legacy FastDL

An nginx web server that serves **Wolfenstein: Enemy Territory (ET: Legacy)**
map packages to game clients over HTTP, instead of the slow in-game UDP
transfer. Part of the
[ET: Legacy Control Panel](https://github.com/mbgroen/etl-control-panel)
stack, and usable on its own.

📖 **Full documentation and compose file:**
<https://github.com/mbgroen/etl-control-panel>

---

## Why

Without FastDL, a client missing a map downloads it through the game protocol
at roughly 100 KB/s, and often times out on anything large. With it, the engine
fetches `<sv_wwwBaseURL>/<gamedir>/<file>.pk3` over HTTP at full line speed.

This image serves the game server's **own** `etmain` directory, so there is no
mirror to keep in sync: what the server has installed is exactly what clients
can download, which removes the most common cause of "client downloads a pk3
and still gets kicked for a checksum mismatch".

## Usage

Mount the game server's map directories read-only and publish port 80:

```bash
docker run -d --name etl-fastdl \
  -p 8081:80 \
  -v /srv/appdata/etl-server/etmain:/srv/fastdl/etmain:ro \
  -v /srv/appdata/etl-server/legacy:/srv/fastdl/legacy:ro \
  mbgroen/etl-fastdl:latest
```

Then in your server config:

```
set sv_allowDownload  "1"
set sv_wwwDownload    "1"
set sv_wwwBaseURL     "http://<address players can reach>:8081"
```

The control panel does both halves in one action if you run the full stack.

**The base URL must be reachable by players** — a public address or LAN IP, not
`localhost` and not an internal Docker name. Forward the port on your router if
players connect from the internet.

## What it serves

Only `.pk3` files, and only under `/etmain/` and `/legacy/`:

```
GET /etmain/oasis.pk3        → 200
GET /etmain/missing.pk3      → 404
GET /etmain/etl_server.cfg   → 403   ← configs, logs and ban lists stay private
GET /                        → 403   ← no directory listing
GET /healthz                 → 200   ← for uptime monitoring
```

The allowlist is by extension rather than a deny-list of known-sensitive names,
so anything else an operator drops into `etmain` — server configs containing
the RCON password, logs, ban lists — is never downloadable.

## File permissions

nginx runs its workers as the `nginx` user while the game server writes as a
different one, so **map packages must be world-readable**. Files copied from an
existing installation are often mode `0600` and will answer **403** even though
they exist:

```bash
chmod o+r /srv/appdata/etl-server/etmain/*.pk3
```

A missing file returns 404 and an unreadable one returns 403 — that difference
is the quickest way to tell the two apart.

## Tags

| Tag | Meaning |
|---|---|
| `latest` | Newest release |
| `1.12.2`, `1.11.0`, … | An exact release. Never moves — use one to pin. See the [releases](https://github.com/mbgroen/etl-control-panel/releases) |

Every image records the commit it was built from:

```bash
docker inspect <image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Built for `linux/amd64`. Based on `nginx:1.27-alpine`; the download
configuration is baked in, so no config file needs mounting.

## Licence

MIT — see the [repository](https://github.com/mbgroen/etl-control-panel).
