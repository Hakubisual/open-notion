# Changelog

All notable changes to this project. Dates are UTC.

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
