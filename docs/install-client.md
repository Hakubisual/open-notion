# Join a team server

This guide connects you to an Acard server someone on your team runs. You need its address and its password. Ask
whoever set it up (see [install-server.md](install-server.md)). Using Acard alone on your own computer instead? See
[install-user.md](install-user.md). The address looks like `http://192.168.0.10:47811`.

There are two ways to connect. Both show exactly the same app.

## Option A: a web browser (nothing to install)

1. Open Chrome, Edge, Firefox or Safari on any computer, tablet or phone in the same network.
2. Go to the server address, for example `http://192.168.0.10:47811`.
3. Enter the server password and press **Sign in**. You stay signed in for 30 days on that browser.
4. Optional: install it as an app from the browser menu (Chrome/Edge: *Install Acard*; iOS Safari: *Share → Add to Home Screen*).

To sign out, open `http://<server>/__local/logout`.

## Option B: the desktop app

The desktop app is a small window around the same web app. It remembers your server, opens in its own window and
keeps you signed in.

### Install

| OS | File (from the [latest release](https://github.com/Hakubisual/open-notion-acard/releases/latest)) | Steps |
| --- | --- | --- |
| Windows 10/11 (x64) | `Acard-Local-Setup-<version>.exe` | Run it. Windows SmartScreen may say *"Windows protected your PC"* because the installer is not code-signed yet: click **More info → Run anyway**. The app installs for your user only (no admin rights) and adds a Start menu and desktop shortcut. |
| macOS | build from source (below) | Release builds for macOS are not published yet. |
| Linux | build from source (below) | Release builds for Linux are not published yet. |

Acard Local is the open desktop client for your own server. It installs next to the hosted Acard app without touching
it (its own app id, install folder and settings folder). If you used the desktop app from v0.1 (the previous name),
Acard Local reads the server address saved there on its first start; you can uninstall the old app afterwards.

Uninstall on Windows from *Settings → Apps → Installed apps → Acard Local*.

### First start: connect to your server

1. Open **Acard Local**. The first screen has two choices: **Use on this computer** and **Connect to a team server**.
   Choose **Connect to a team server**; the address form opens.
2. Type the address, for example `192.168.0.10:47811` (`http://` is added for you) and press **Connect**.
   The app checks that an Acard server answers there before it continues.
3. The server's sign-in page opens. Enter the server password.
4. Your workspace opens. Next time the app goes straight to it.

To switch servers, use the menu **Server → Change server…** (or press `Ctrl+Shift+S` / `Cmd+Shift+S`). The same
menu has **Use on this computer** and **Connect to a team server…**. If you saved a server address in v0.2, the app
keeps connecting to it.
Links that point outside your server open in your normal browser.

### Build the desktop app from source

Requirements: [Bun](https://bun.sh) 1.3+ and, for macOS, Xcode command line tools.

```sh
git clone https://github.com/Hakubisual/open-notion-acard.git
cd open-notion-acard/desktop
bun install
bun run dist        # Windows: out/Acard-Local-Setup-<version>.exe
                    # macOS:   out/Acard-Local-<version>-<arch>.dmg (run on a Mac)
                    # Linux:   out/Acard-Local-<version>.AppImage (run on Linux)
```

`bun run start` runs the app without packaging it. The app code is in `desktop/main.cjs` (window, menu, saved server),
`desktop/connect.html` (first screen) and `desktop/preload.cjs`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| *"No Acard server answered at …"* | Check the address and port, that the server is running, and that you are on the same network or VPN. Try the address in a browser. |
| Browser says `Address not allowed.` | The server admin must add the name you typed to `ACARD_ALLOWED_HOSTS`. |
| Sign-in page keeps coming back | Cookies are blocked for the site, or the server password was changed. |
| Windows says the app is from an unknown publisher | Expected for unsigned builds; see the SmartScreen note above. |
