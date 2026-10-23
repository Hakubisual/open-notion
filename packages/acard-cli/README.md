# acard-cli

A small command-line client for your own Acard server: sync pages with local Markdown files and bridge the server's MCP endpoint over stdio. Runs on Node 18+ and Bun.

## Setup

By default the CLI talks to the local server on this computer (`http://127.0.0.1:47811`). No account or token is needed there.

```bash
export ACARD_URL=http://127.0.0.1:47811   # optional, the default; or pass --server <url>
export ACARD_TOKEN=...                     # only for a team server: the server's agent token
```

The token is sent as `Authorization: Bearer` and is never printed.

## Commands

```bash
acard whoami          # print {agent, via, scopes}
acard pull [dir]      # save pages as <dir>/<slug>.md (default ./acard)
acard push [dir]      # upload local changes
acard mcp             # stdio MCP server that forwards to {server}/mcp
```

Without installing: `npx -y --package=http://127.0.0.1:47811/acard-cli.tgz acard <command>`. Inside the repository: `node packages/acard-cli/bin/acard.js <command>`.

### pull / push

- Sync state is kept in `<dir>/.acard-sync.json` as `slug -> {updated, hash}`.
- `pull` does not overwrite files you changed since the last pull; it reports them as `skipped`.
- `push` prints `created` / `updated` / `unchanged` / `conflict` / `error` per file.
  - Only files whose content hash changed are sent (`PUT /api/v1/pages/{slug}`).
  - When the remote page is newer than your last pull, the file is a **conflict** and is skipped; remote edits are never overwritten silently.
  - A new `.md` file is created with `POST /api/v1/pages` and renamed to the `<slug>.md` the server picks. Title, parent, icon and tags come from frontmatter.
  - Any conflict or error makes the exit code non-zero.

New page example:

```markdown
---
title: Meeting notes
parent: hello
tags: [meeting]
---

Body
```

### MCP client example

Most MCP clients can use the server's `/mcp` URL directly. For a client that only runs stdio servers:

```json
{
  "mcpServers": {
    "acard": {
      "command": "npx",
      "args": ["-y", "--package=http://127.0.0.1:47811/acard-cli.tgz", "acard", "mcp"]
    }
  }
}
```

For a team server add `"env": { "ACARD_URL": "https://notes.example.com", "ACARD_TOKEN": "..." }`. Local image paths (`![](./shot.png)`) in page Markdown are uploaded first and replaced with their media address.

## Tests

```bash
cd packages/acard-cli && bun test
```
