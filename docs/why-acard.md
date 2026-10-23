<p align="center"><b>English</b> · <a href="why-acard.ko.md">한국어</a> · <a href="why-acard.zh-CN.md">简体中文</a></p>

# Why Acard

Acard is the open Notion you can run locally. This page explains what that means next to the two tools people
usually compare it with, Notion and Obsidian. Both are excellent, and each makes sense for many people. Acard is a
different trade-off, and the table below says where.

Every Acard claim points to the file in this repository that implements it. Facts about Notion and Obsidian come
from their own help pages (linked at the end) as of October 2026; they may change.

## At a glance

| | Acard | Notion | Obsidian |
| --- | --- | --- | --- |
| Where data lives | SQLite files in one folder you choose | Notion's cloud; offline copies in its apps | Markdown files in a local vault |
| Self-host for a team | Yes: one Bun process on your LAN or VPN | No | Not built in; shared vaults use Obsidian Sync |
| Editing model | Blocks, columns, databases | Blocks, columns, databases | Markdown text, plugins |
| Databases | 7 views, relations, rollups, sub-items, formulas, row templates | Many views, relations, rollups, formulas | Bases: database views over note properties |
| Works offline | Always: the server runs on your machine | Pages you download in the desktop and mobile apps | Always |
| Agents and scripts | MCP endpoint and REST API on your own server | API and hosted MCP in Notion's cloud | Community plugins, or edit the files |
| Backup format | One zip: every table, every file, a Markdown copy of each page | Export to Markdown/CSV, HTML or PDF | The vault folder itself |
| Source | AGPL-3.0 licensed | Closed | Closed app, open plugin API |

## Compared with Notion

**Your documents stay on your hardware.** The Acard server writes everything into `acard.sqlite` and `media.sqlite`
in the folder you set with `ACARD_DATA_DIR` (`local/server.ts`). There is no account to create and no outside service
in the path. Notion keeps the workspace in its cloud and downloads chosen pages for offline use in its apps.

**You can run it for your team.** `ACARD_HOST=0.0.0.0` plus `ACARD_PASSWORD` turns the same process into a LAN server
with password sign-in and a host allow-list against DNS rebinding (`local/main.ts`, `local/server.ts`). The
[server guide](install-server.md) sets it up as a Windows or Linux service. Notion has no self-hosted edition.

**Familiar editing, open code.** Pages are blocks with `/` commands, columns, toggles, callouts and databases with
table, board, gallery, list, calendar, timeline and chart views (`db-model.js`, `editor-next/`). You can read and
change every line under the AGPL-3.0 license.

**Notion pages come with you.** `notion-import.ts` reads Notion's "Markdown & CSV" export zip, pages and databases
included. `notion-export.ts` writes Markdown, standalone HTML and a workspace zip back out.

**Agents work on your server, not someone else's.** The local server exposes MCP at `/mcp` and a REST API
(`agents/mcp-tools.ts`, `agent-api.js`). An agent on your machine reads and writes pages as Markdown without a cloud
round trip.

Where Notion is ahead: real-time multi-cursor collaboration, a large template and integration ecosystem, polished
mobile apps, and many more database features. If you want a managed service, Notion (or the hosted
[Acard](https://acard.dev)) is the easier choice.

## Compared with Obsidian

**Databases and blocks are first-class.** Acard stores pages as ordered blocks and databases as real tables with
typed properties, views, relations, sub-items and formulas (`gate/_worker.js` schema, `db-formula.js`). Obsidian
centers on Markdown text; its Bases plugin adds database-style views over note properties.

**One server, many devices, no sync service.** Every browser, phone and desktop app talks to the same server, and
a live feed (`/api/live`, `gate/live.ts`) refreshes open pages when something changes. A team shares one workspace
by sharing one address. Obsidian keeps a vault per device; sharing a vault between people uses Obsidian Sync.

**Built for people and agents together.** Agents write Markdown through MCP or REST; people read the same content
as clean pages and edit it as blocks (`markdown-blocks.ts` is the single Markdown-to-blocks rule). Pages can be
published or shared by link as read-only views (`features/share.js`).

**Readable backups.** A backup zip (`gate/archive.ts`) holds every table as JSON, every file, and a Markdown copy of
each page, so your notes stay readable without Acard. `local/auto-backup.ts` writes one every day and keeps the
newest copies. `packages/acard-cli` can also mirror pages into a folder of `.md` files.

Where Obsidian is ahead: your notes *are* plain files, so any editor, Git or file sync works on them directly. It has
a huge plugin and theme ecosystem, a graph view, mature mobile apps, and end-to-end encrypted Sync. If you want a
personal Markdown vault, Obsidian is a great fit.

## When Acard is the right choice

- You want Notion-style pages and databases, but the documents must stay on your own machine or network.
- A small team needs one shared workspace on an office server, without per-seat cloud accounts.
- You use AI agents and want them to read and write your notes locally through MCP.
- You want to read, audit or change the code.

## Sources

- Notion offline: https://www.notion.com/help/use-pages-offline
- Notion export: https://www.notion.com/help/export-your-content
- Obsidian Bases: https://obsidian.md/help/bases
- Obsidian shared vaults: https://obsidian.md/help/sync/collaborate
- Obsidian license: https://obsidian.md/license
