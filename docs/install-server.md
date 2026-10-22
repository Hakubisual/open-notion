# Server install

This guide sets up one Acard server on a machine inside your network (office LAN, home lab, VPN).
Everyone else connects to it with a browser or the desktop app (see [install-client.md](install-client.md)).

The server is a single Bun process that stores everything in SQLite files in one data folder.
There is no separate database server to run.

## 1. Requirements

| | Minimum |
| --- | --- |
| OS | Windows 10/11 or Windows Server 2019+, any recent 64-bit Linux, macOS 13+ |
| CPU / RAM | 2 cores, 1 GB RAM free (a team of 20 uses far less) |
| Disk | 500 MB for the app, plus your notes and images |
| Runtime | [Bun](https://bun.sh) 1.3 or newer |
| Tools | `git` (or download the source zip from the release page) |
| Network | one TCP port reachable from client machines (default `47811`) |

Install Bun:

```powershell
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

```sh
# Linux / macOS
curl -fsSL https://bun.sh/install | bash
```

Open a new terminal afterwards and check `bun --version`.

## 2. Get the code and build it

```sh
git clone https://github.com/Hakubisual/open-notion-acard.git
cd open-notion-acard
bun install
bun run build
```

`bun run build` writes the web app into `dist/` and the server core into `.build/`. It takes about a minute.

## 3. Configure

The server is configured with environment variables:

| Variable | Required | Example | What it does |
| --- | --- | --- | --- |
| `ACARD_DATA_DIR` | yes | `./data` | Folder for the SQLite files (`acard.sqlite`, `media.sqlite`) and the session secret. Created if missing. |
| `ACARD_APP_DIR` | yes | `./dist` | The built web app from step 2. |
| `ACARD_PORT` | no | `47811` | TCP port. Default `47811`. |
| `ACARD_HOST` | for LAN | `0.0.0.0` | Address to listen on. Default `127.0.0.1` (this machine only). Use `0.0.0.0` to accept LAN clients. |
| `ACARD_PASSWORD` | for LAN | `a long passphrase` | Turns on the sign-in page. **The server refuses to listen on a non-loopback address without it.** |
| `ACARD_ALLOWED_HOSTS` | for LAN | `192.168.0.10,notes.lan` | Comma-separated host names clients use in the address bar. Requests with any other `Host` header are rejected (DNS-rebinding protection). `*` accepts any name. |
| `ACARD_LANG` | no | `en` | Interface language: `en`, `ko` or `zh`. The examples below use English. Unset shows the original Korean interface. |

The `ACARD_` prefix comes from the upstream project and is kept so both share one code base.

Find the server's LAN address:

```powershell
# Windows
ipconfig    # look for "IPv4 Address", e.g. 192.168.0.10
```

```sh
# Linux
hostname -I
```

## 4. First start

Windows (PowerShell), from the `open-notion-acard` folder:

```powershell
$env:ACARD_DATA_DIR = "$PWD\data"
$env:ACARD_APP_DIR  = "$PWD\dist"
$env:ACARD_PORT     = "47811"
$env:ACARD_HOST     = "0.0.0.0"
$env:ACARD_PASSWORD = "change-me-to-a-long-passphrase"
$env:ACARD_ALLOWED_HOSTS = "192.168.0.10"   # your server's LAN IP or DNS name
$env:ACARD_LANG     = "en"
bun local/main.ts
```

Linux / macOS:

```sh
ACARD_DATA_DIR=$PWD/data ACARD_APP_DIR=$PWD/dist ACARD_PORT=47811 \
ACARD_HOST=0.0.0.0 ACARD_PASSWORD='change-me-to-a-long-passphrase' \
ACARD_ALLOWED_HOSTS=192.168.0.10 ACARD_LANG=en bun local/main.ts
```

You should see:

```
READY http://127.0.0.1:47811/ (password login on)
```

Check it from the server itself: `curl http://127.0.0.1:47811/__local/health` prints `acard-local ok`.
Then open `http://192.168.0.10:47811/` from another machine; you get the sign-in page.

### Database and migrations

There is nothing to run by hand. On first start the server creates the SQLite files in `ACARD_DATA_DIR` and applies the
schema; newer versions upgrade the schema in place on start. The `migrations/` folder is used by the optional
Cloudflare/Postgres deployment, not by the LAN server.

## 5. Open the firewall

Windows (PowerShell as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Acard Local" -Direction Inbound -Protocol TCP -LocalPort 47811 -Action Allow -Profile Domain,Private
```

Linux:

```sh
sudo ufw allow 47811/tcp            # Ubuntu / Debian with ufw
sudo firewall-cmd --add-port=47811/tcp --permanent && sudo firewall-cmd --reload   # Fedora / RHEL
```

Keep the port closed on public networks. Acard Local is meant to sit inside your LAN or VPN.

## 6. Run it as a service

### Windows service (NSSM)

[NSSM](https://nssm.cc) wraps any program as a Windows service. Download it, then in an Administrator PowerShell:

```powershell
$dir = "C:\open-notion-acard"                     # where you cloned the repo
$bun = (Get-Command bun).Source
nssm install AcardLocal $bun "local/main.ts"
nssm set AcardLocal AppDirectory $dir
nssm set AcardLocal AppEnvironmentExtra `
  "ACARD_DATA_DIR=$dir\data" "ACARD_APP_DIR=$dir\dist" "ACARD_PORT=47811" `
  "ACARD_HOST=0.0.0.0" "ACARD_PASSWORD=change-me-to-a-long-passphrase" "ACARD_ALLOWED_HOSTS=192.168.0.10" "ACARD_LANG=en"
nssm set AcardLocal AppStdout "$dir\data\server.log"
nssm set AcardLocal AppStderr "$dir\data\server.log"
nssm set AcardLocal Start SERVICE_AUTO_START
nssm start AcardLocal
```

`nssm status AcardLocal` should print `SERVICE_RUNNING`. Stop or restart with `nssm stop AcardLocal` / `nssm restart AcardLocal`.

### Linux (systemd)

Create a user and copy the app:

```sh
sudo useradd --system --home /opt/acard-local --shell /usr/sbin/nologin acard
sudo git clone https://github.com/Hakubisual/open-notion-acard.git /opt/acard-local
cd /opt/acard-local && sudo bun install && sudo bun run build
sudo mkdir -p /var/lib/acard-local && sudo chown -R acard: /opt/acard-local /var/lib/acard-local
```

Put the settings in `/etc/acard-local.env` (readable by root only, `chmod 600`):

```sh
ACARD_DATA_DIR=/var/lib/acard-local
ACARD_APP_DIR=/opt/acard-local/dist
ACARD_PORT=47811
ACARD_HOST=0.0.0.0
ACARD_PASSWORD=change-me-to-a-long-passphrase
ACARD_ALLOWED_HOSTS=192.168.0.10,notes.lan
ACARD_LANG=en
```

`/etc/systemd/system/acard-local.service`:

```ini
[Unit]
Description=Acard Local server
After=network-online.target
Wants=network-online.target

[Service]
User=acard
WorkingDirectory=/opt/acard-local
EnvironmentFile=/etc/acard-local.env
ExecStart=/usr/local/bin/bun local/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Adjust `ExecStart` to the output of `which bun`. Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now acard-local
systemctl status acard-local
```

## 7. Backups

All data lives in `ACARD_DATA_DIR`. The SQLite files run in WAL mode, so copy them with SQLite's backup command
rather than a plain file copy while the server runs:

```sh
sqlite3 data/acard.sqlite ".backup 'backup/acard-$(date +%F).sqlite'"
sqlite3 data/media.sqlite ".backup 'backup/media-$(date +%F).sqlite'"
```

Or stop the service, copy the whole data folder, and start it again. Schedule either with Task Scheduler or cron.
To restore, stop the server, put the files back into the data folder and start it.

## 8. Updating

```sh
cd open-notion-acard
git pull
bun install
bun run build
```

Then restart the service (`nssm restart AcardLocal` or `sudo systemctl restart acard-local`). Back up first.

Installed v0.1 under the previous name? Keep your folders, service and data as they are: only the project name changed.
`git pull` follows GitHub's redirect to the new repository, the `ACARD_*` settings and the data folder are the same,
and an existing service keeps the name you gave it (use that name in the restart command above).

## 9. HTTPS (optional)

On a trusted LAN plain HTTP works. Put a reverse proxy in front if you want HTTPS, for example
[Caddy](https://caddyserver.com) with its internal CA:

```
notes.lan {
  tls internal
  reverse_proxy 127.0.0.1:47811
}
```

Run the server with `ACARD_HOST=127.0.0.1` and `ACARD_ALLOWED_HOSTS=notes.lan` behind the proxy, and install Caddy's root
certificate on client machines. The sign-in cookie is marked `Secure` automatically when requests arrive over HTTPS.

## 10. Security notes

- Everyone with the server password shares one workspace. Give the password only to people who should see every page.
- Changing `ACARD_PASSWORD` (or deleting `session-secret` in the data folder) signs everyone out.
- Accounts, Google sign-in and the remote MCP endpoint of the hosted service are not part of the LAN server.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Listening on 0.0.0.0 needs a password (ACARD_PASSWORD).` | Set `ACARD_PASSWORD`, or use `ACARD_HOST=127.0.0.1` for single-machine use. |
| Browser shows `Address not allowed.` | Add the name in the address bar to `ACARD_ALLOWED_HOSTS`. |
| `ACARD_DATA_DIR and ACARD_APP_DIR (with editor.html) are required` | Run `bun run build` and point `ACARD_APP_DIR` at `dist`. |
| Clients time out | Firewall rule (step 5), or the server is on a different subnet / VPN. |
