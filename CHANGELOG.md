# Changelog

All notable changes to this project. Dates are UTC.

## 0.3.1 - 2026-10-24

### Added

- Page, block and text marks for agents: mark a part as locked (an agent never changes it) or as reference (an agent
  reads it, never changes it). MCP and REST writes keep marked blocks as they were and say which ones they kept.
- More components (diagrams, interactive controls, media) and a kit of cover, header and empty-state images.

### Removed

- The plugin UI renderer (`plugin-ui.js`) that 0.3.0 still carried. This edition has no plugins; a plugin block
  saved by the hosted Acard app shows as an unknown block.

### Docs

- Building the desktop app from source installs the root dependencies first, and the macOS build makes one DMG for
  the Mac it runs on.
- `ACARD_LOCAL_API` is listed as on by default in the team server guide, as it is.

## 0.3.0 - 2026-10-24

### Added

- **Acard Local runs on its own.** The desktop app (`Acard-Local-Setup-0.3.0.exe`) now has two choices on its first
  screen: **Use on this computer** starts a built-in local server (data in `%APPDATA%\Acard Local\data`, port 47811 or
  the first free one up to 47830, no account, no password), and **Connect to a team server** works as before. The
  **Server** menu switches between them (`Ctrl/Cmd+Shift+S`). If you saved a server address in v0.2, the app keeps
  connecting to it. The app's language follows the operating system (Korean, Chinese, otherwise English).
- Token-free MCP and REST for agents on your own computer: `http://127.0.0.1:47811/mcp` and `/api/v1`. Set
  `ACARD_LOCAL_API=0` to turn it off.
- `ACARD_AGENT_TOKEN` for team servers: agents reach `/mcp` and `/api/v1` with `Authorization: Bearer <token>`.
  Without it, agents cannot reach them on a password-protected server; a person's password never works for agents.
- The local server serves `/AGENTS.md`, `/llms.txt` and `/api/v1/openapi.json`.

### Removed

- The AI buttons: ask your notes, photo to text and AI shortcuts. Existing photo-text blocks still show.
- The seeded agent rules page. `get_agent_skills` now only reads a page named `agent-skills` if a person wrote one;
  an existing page stays a normal page.
- The project auto-record sidebar and the first-run agent tools.
- The CLI `hooks` and `setup` commands and the agent add-on downloads. The CLI keeps `pull`, `push`, `mcp` and
  `whoami`.
- The cloud account section in "My data". It is off unless `ACARD_CLOUD_URL` is set.

### Docs

- Two install paths: [for yourself](docs/install-user.md) (one computer, the desktop app) and
  [for a team](docs/install-server.md) (one server; members [join it](docs/install-client.md)).
- README in all three languages: new "Connect your AI agent" section for local and team servers.

## v0.2.0 - 2026-10-23

### Renamed: OpenNotion is now Acard

- The project is now **Acard**, "the open Notion you can run locally". The repository moved from
  `Hakubisual/open-notion` to `Hakubisual/open-notion-acard`; GitHub redirects the old address, so existing clones
  keep working with `git pull`.
- New logo, favicon and app icons (the Acard mark), and the web app now shows the Acard name.
- The desktop client is now **Acard Local** (`Acard-Local-Setup-0.2.0.exe`, app id `dev.acard.local`). It installs
  alongside the hosted Acard app. On its first start it reads the server address saved by the OpenNotion app, so you
  do not need to reconnect.
- Nothing changes for your data: the server keeps the same `ACARD_*` settings, data folder and file format.

### Documentation

- README in English, Korean and Simplified Chinese.
- New: [Why Acard](docs/why-acard.md) (compared with Notion and Obsidian) and [Architecture](docs/architecture.md).
- New: contributing guide, code of conduct, security policy, issue and pull request templates, CI workflow.

### Since v0.1.0

- Backups: one archive with every table, every file and a Markdown copy of each page; daily automatic backups.
- Optional connection to a hosted account for publishing, off-site backup and multi-device sync.
- Columns, block colors, buttons, page icons and covers, database relations, sub-items, formulas and parts.

## v0.1.0 - 2026-10-18

- First public release as OpenNotion: self-hosted server, LAN mode with password sign-in, Windows desktop client.
