# Client install

You need the address of an OpenNotion server on your network and its password. Ask whoever set it up
(see [install-server.md](install-server.md)). The address looks like `http://192.168.0.10:47811`.

There are two ways to connect. Both show exactly the same app.

## Option A: a web browser (nothing to install)

1. Open Chrome, Edge, Firefox or Safari on any computer, tablet or phone in the same network.
2. Go to the server address, for example `http://192.168.0.10:47811`.
3. Enter the server password and press **Sign in**. You stay signed in for 30 days on that browser.
4. Optional: install it as an app from the browser menu (Chrome/Edge: *Install OpenNotion*; iOS Safari: *Share → Add to Home Screen*).

To sign out, open `http://<server>/__local/logout`.

## Option B: the desktop app

The desktop app is a small window around the same web app. It remembers your server, opens in its own window and
keeps you signed in.

### Install

| OS | File (from the [latest release](https://github.com/Hakubisual/open-notion/releases/latest)) | Steps |
| --- | --- | --- |
| Windows 10/11 (x64) | `OpenNotion-Setup-<version>.exe` | Run it. Windows SmartScreen may say *"Windows protected your PC"* because the installer is not code-signed yet: click **More info → Run anyway**. The app installs for your user only (no admin rights) and adds a Start menu and desktop shortcut. |
| macOS | build from source (below) | Release builds for macOS are not published yet. |
| Linux | build from source (below) | Release builds for Linux are not published yet. |

Uninstall on Windows from *Settings → Apps → Installed apps → OpenNotion*.

### First start: connect to your server

1. Open **OpenNotion**. The first screen asks for the server address.
2. Type the address, for example `192.168.0.10:47811` (`http://` is added for you) and press **Connect**.
   The app checks that an OpenNotion server answers there before it continues.
3. The server's sign-in page opens. Enter the server password.
4. Your workspace opens. Next time the app goes straight to it.

To switch servers, use the menu **Server → Change server…** (or press `Ctrl+Shift+S` / `Cmd+Shift+S`).
Links that point outside your server open in your normal browser.

### Build the desktop app from source

Requirements: [Bun](https://bun.sh) 1.3+ and, for macOS, Xcode command line tools.

```sh
git clone https://github.com/Hakubisual/open-notion.git
cd open-notion/desktop
bun install
bun run dist        # Windows: out/OpenNotion-Setup-<version>.exe
                    # macOS:   out/OpenNotion-<version>-<arch>.dmg (run on a Mac)
                    # Linux:   out/OpenNotion-<version>.AppImage (run on Linux)
```

`bun run start` runs the app without packaging it. The app code is in `desktop/main.cjs` (window, menu, saved server),
`desktop/connect.html` (first screen) and `desktop/preload.cjs`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| *"No OpenNotion server answered at …"* | Check the address and port, that the server is running, and that you are on the same network or VPN. Try the address in a browser. |
| Browser says `Address not allowed.` | The server admin must add the name you typed to `ACARD_ALLOWED_HOSTS`. |
| Sign-in page keeps coming back | Cookies are blocked for the site, or the server password was changed. |
| Windows says the app is from an unknown publisher | Expected for unsigned builds; see the SmartScreen note above. |
