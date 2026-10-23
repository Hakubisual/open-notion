// Public agent-discovery documents for Acard.
// Text-inlined into the Cloudflare worker: no imports, pure functions only.

export function openapiSpec(origin) {
  const err = { $ref: '#/components/responses/Error' };
  const errors = { 401: err, 403: err, 404: err, 409: err, 413: err };
  const json = (schema) => ({ content: { 'application/json': { schema } } });
  const ok = (description, schema) => ({ description, ...json(schema) });
  const ref = (name) => ({ $ref: '#/components/schemas/' + name });
  const str = { type: 'string' };
  const num = { type: 'number' };
  const slugParam = { name: 'slug', in: 'path', required: true, schema: str };
  const dbParam = { name: 'slug', in: 'path', required: true, schema: str, description: 'Database slug' };
  const blockParam = { name: 'blockId', in: 'path', required: true, schema: str };
  const blockWrite = { type: 'object', properties: { page: str, version: num, updated: num, block_ids: { type: 'array', items: str } } };
  const op = (operationId, summary, extra, responses) => ({
    operationId,
    summary,
    ...extra,
    responses: { ...responses, ...errors },
  });
  const markdownBody = (props, required) => ({
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', required, properties: { markdown: str, ...props } },
      },
      'text/markdown': { schema: str },
    },
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'Acard API',
      version: '1.0.0',
      description:
        'Acard is a Notion-like notes app. Agents write markdown pages; the human owner reads and edits them. ' +
        'Conventions: ' + origin + '/AGENTS.md. MCP: ' + origin + '/mcp.',
    },
    servers: [{ url: origin + '/api/v1' }],
    security: [{ bearer: [] }, { oauth2: ['read', 'write'] }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Acard agent token `acard_...` created in 설정 > 에이전트 연결.',
        },
        oauth2: {
          type: 'oauth2',
          description:
            'OAuth 2.1 authorization code with PKCE (S256). Clients can register dynamically at ' +
            origin + '/oauth/register.',
          flows: {
            authorizationCode: {
              authorizationUrl: origin + '/oauth/authorize',
              tokenUrl: origin + '/oauth/token',
              scopes: { read: 'Read pages, databases and decisions', write: 'Create and change pages and rows' },
            },
          },
        },
      },
      responses: {
        Error: { description: 'Error', ...json(ref('Error')) },
      },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: str } },
        Author: {
          type: 'object',
          properties: { agent: str, via: str, action: str, created: num },
        },
        PageSummary: {
          type: 'object',
          properties: {
            slug: str, title: str, parent: { type: ['string', 'null'] }, kind: str,
            icon: { type: ['string', 'null'] }, updated: num, hit: str,
          },
        },
        Page: {
          type: 'object',
          properties: {
            slug: str, title: str, parent: { type: ['string', 'null'] }, icon: { type: ['string', 'null'] },
            tags: { type: 'array', items: str }, updated: num,
            authors: { type: 'array', items: ref('Author') }, markdown: str,
          },
        },
        Props: { type: 'object', additionalProperties: true, description: 'Keyed by property id or name' },
      },
    },
    paths: {
      '/agent-skills': {
        get: op('getAgentSkills', "Read the 'agent-skills' page if one exists", {}, { 200: ok('Rules', ref('Page')) }),
      },
      '/pages/{slug}/blocks': {
        get: op('readBlocks', 'Read ordered blocks and their page version', { parameters: [slugParam] }, {
          200: ok('Blocks', { type: 'object', properties: { page: str, version: num, updated: num,
            blocks: { type: 'array', items: { type: 'object', properties: { id: str, type: str, text: str, markdown: str } } } } }),
        }),
        post: op('insertBlocks', 'Insert immediately after an ID, or at the start for a null anchor', {
          parameters: [slugParam], requestBody: { required: true, ...json({ type: 'object', required: ['markdown', 'after_block_id', 'expected_version'],
            properties: { markdown: str, after_block_id: { type: ['string', 'null'] }, expected_version: num } }) },
        }, { 200: ok('Inserted', blockWrite) }),
      },
      '/pages/{slug}/blocks/{blockId}': {
        patch: op('updateBlock', 'Replace exactly one block, retaining its ID and indentation', {
          parameters: [slugParam, blockParam], requestBody: { required: true, ...json({ type: 'object', required: ['markdown', 'expected_version'], properties: { markdown: str, expected_version: num } }) },
        }, { 200: ok('Updated', blockWrite) }),
        delete: op('deleteBlock', 'Delete only the named block, not its descendants', {
          parameters: [slugParam, blockParam], requestBody: { required: true, ...json({ type: 'object', required: ['expected_version'], properties: { expected_version: num } }) },
        }, { 200: ok('Deleted', blockWrite) }),
      },
      '/me': {
        get: op('whoami', 'Who am I', {}, {
          200: ok('Current agent', {
            type: 'object',
            properties: { agent: str, via: { type: 'string', enum: ['token', 'oauth'] }, scopes: { type: 'array', items: str } },
          }),
        }),
      },
      '/pages': {
        get: op('listPages', 'List pages, or search title and body with q', {
          parameters: [{ name: 'q', in: 'query', required: false, schema: str }],
        }, {
          200: ok('Pages', { type: 'object', properties: { pages: { type: 'array', items: ref('PageSummary') } } }),
        }),
        post: op('createPage', 'Create a page from markdown (frontmatter title/parent/icon/tags). Up to 2,000 blocks; send Idempotency-Key to make retries return the first page (200, duplicate: true)', {
          requestBody: markdownBody({
            title: str, parent: str, icon: str, tags: { type: 'array', items: str }, slug: str,
          }, ['markdown']),
        }, {
          201: ok('Created', {
            type: 'object',
            properties: { slug: str, title: str, parent: { type: ['string', 'null'] }, url: str, created: num },
          }),
        }),
      },
      '/pages/{slug}': {
        get: op('readPage', 'Read a page. Accept: text/markdown or ?format=markdown returns raw markdown with frontmatter', {
          parameters: [slugParam, { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['markdown'] } }],
        }, {
          200: {
            description: 'Page',
            content: { 'application/json': { schema: ref('Page') }, 'text/markdown': { schema: str } },
          },
        }),
        put: op('updatePage', 'Replace a page. Send expectedUpdated (the updated value from GET) or If-Match with the GET ETag. 409 if the page changed since that read, or if expectedUpdated is missing and a person edited the page after the last agent write', {
          parameters: [slugParam, { name: 'If-Match', in: 'header', required: false, schema: str }],
          requestBody: { required: true, ...json({ type: 'object', required: ['markdown'], properties: { markdown: str, expectedUpdated: num } }) },
        }, {
          200: ok('Updated', {
            type: 'object',
            properties: { slug: str, title: str, parent: { type: ['string', 'null'] }, updated: { type: 'boolean' } },
          }),
        }),
      },
      '/pages/{slug}/append': {
        post: op('appendToPage', 'Append markdown to the end of a page. Write long documents as 30-50 KB pieces; a repeated piece (same body or Idempotency-Key) is not added twice', {
          parameters: [slugParam],
          requestBody: markdownBody({}, ['markdown']),
        }, {
          200: ok('Appended', { type: 'object', properties: { slug: str, appended: num } }),
        }),
      },
      '/databases': {
        get: op('listDatabases', 'List databases', {}, {
          200: ok('Databases', {
            type: 'object',
            properties: { databases: { type: 'array', items: { type: 'object', properties: { slug: str, title: str, icon: { type: ['string', 'null'] } } } } },
          }),
        }),
      },
      '/databases/{slug}/rows': {
        get: op('readDatabase', 'Read database properties and rows', { parameters: [dbParam] }, {
          200: ok('Rows', {
            type: 'object',
            properties: {
              database: { type: 'object', properties: { slug: str, title: str } },
              properties: { type: 'array', items: { type: 'object', properties: { id: str, name: str, type: str } } },
              rows: { type: 'array', items: { type: 'object', properties: { id: str, page: str, title: str, props: ref('Props') } } },
            },
          }),
        }),
        post: op('addDatabaseRow', 'Add a database row', {
          parameters: [dbParam],
          requestBody: { required: true, ...json({ type: 'object', required: ['props'], properties: { props: ref('Props') } }) },
        }, {
          201: ok('Created', {
            type: 'object',
            properties: {
              row: { type: 'object', properties: { id: str, page: str, ord: num, props: ref('Props'), created: num, updated: num } },
            },
          }),
        }),
      },
      '/databases/{slug}/rows/{rowId}': {
        patch: op('updateDatabaseRow', 'Update database row properties', {
          parameters: [dbParam, { name: 'rowId', in: 'path', required: true, schema: str }],
          requestBody: { required: true, ...json({ type: 'object', required: ['props'], properties: { props: ref('Props') } }) },
        }, {
          200: ok('Updated', { type: 'object', properties: { ok: { type: 'boolean' } } }),
        }),
      },
      '/decisions': {
        get: op('listDecisions', 'List open `> [!decision]` callouts waiting for the owner', {}, {
          200: ok('Decisions', {
            type: 'object',
            properties: {
              decisions: { type: 'array', items: { type: 'object', properties: { slug: str, title: str, block: str, text: str, updated: num } } },
            },
          }),
        }),
      },
    },
    webhooks: {
      pageChange: {
        post: {
          operationId: 'pageChangeWebhook',
          summary: 'Acard POSTs this to a webhook URL when a page changes (setup: 설정 > 에이전트 연결 > 웹훅; details: ' + origin + '/webhooks.md)',
          parameters: [
            { name: 'X-Acard-Signature', in: 'header', required: true, schema: str, description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint secret>' },
            { name: 'X-Acard-Event', in: 'header', required: true, schema: str },
            { name: 'X-Acard-Delivery', in: 'header', required: true, schema: str, description: 'Same value on every retry of one delivery: use it to drop duplicates' },
          ],
          requestBody: { required: true, ...json({
            type: 'object',
            required: ['id', 'type', 'version', 'occurred_at', 'workspace', 'page', 'changes', 'actor'],
            properties: {
              id: str,
              type: { type: 'string', enum: ['page.created', 'page.updated', 'page.renamed', 'page.moved', 'page.trashed', 'page.restored', 'page.deleted', 'ping'] },
              version: { type: 'integer', const: 1 },
              occurred_at: { type: 'string', format: 'date-time' },
              attempt: { type: 'integer' },
              workspace: { type: 'object', properties: { id: str } },
              page: { type: ['object', 'null'], properties: { slug: str, title: { type: ['string', 'null'] }, parent: { type: ['string', 'null'] }, kind: { type: ['string', 'null'] }, trashed: { type: 'boolean' }, url: { type: ['string', 'null'] }, api: { type: ['string', 'null'] } } },
              changes: { type: 'array', items: str },
              actor: { type: 'object', properties: { kind: { type: 'string', enum: ['human', 'api_token', 'oauth_app', 'agent', 'guest', 'system'] }, name: str, token_id: str } },
            },
          }) },
          responses: { 200: { description: 'Any 2xx within 10 seconds counts as delivered; anything else (redirects too) is retried' } },
        },
      },
    },
  };
}

export function llmsTxt(origin) {
  return `# Acard

> Acard is a Notion-style notes app. Agents read and write pages as Markdown over MCP or the HTTP API; people read and edit the same pages in a block editor.

## Connect

- [MCP (Streamable HTTP)](${origin}/mcp): endpoint for MCP clients
- [OpenAPI 3.1 spec](${origin}/api/v1/openapi.json): HTTP API under ${origin}/api/v1
- Auth: on this computer no token is needed; on a team server send \`Authorization: Bearer <ACARD_AGENT_TOKEN>\`
- Local stdio: \`npx -y --package=${origin}/acard-cli.tgz acard mcp\` with env ACARD_URL=${origin}

## Conventions

- [AGENTS.md](${origin}/AGENTS.md): tools, Markdown blocks and rules.
- Prefer read_blocks and update_block/insert_blocks/delete_block with expected_version from the read. On 409 re-read and merge.
- Parts (badge, table, chart, heatmap, dag): list_parts gives each one's JSON data schema and a ready fence; write the fence with JSON data only, or change one with set_part_data.
- Decisions: a callout \`> [!decision] <question>\` shows up in GET /api/v1/decisions and list_decisions.
- Contents: a \`- [toc]\` line shows a linked table of contents built from the page's headings.
- Never put secrets, tokens or passwords in pages.

## MCP tools

whoami, list_pages, read_page, create_page, update_page, append_to_page, read_blocks, update_block, insert_blocks, delete_block, list_databases, read_database, add_database_row, update_database_row, list_decisions, upload_media, list_parts, set_part_data, patch_block, list_components, set_component_data
`;
}

// Outgoing webhooks, served at /webhooks.md and linked from llms.txt and the settings screen. The values match
// WEBHOOK_CONFIG in gate/webhooks.ts.
export function webhooksMd(origin) {
  return `# Acard webhooks

Acard can POST to your server when a page changes, so a tool that mirrors Acard (a task tracker such as Vikunja, an n8n
flow, your own script) does not have to poll. Set it up in 설정 > 에이전트 연결 > 웹훅 (${origin}/settings/agents/#webhooks):
an https address, the events to send, then copy the signing secret. It is shown once; "비밀값 다시 만들기" makes a new one.

Webhooks are plain HTTP calls between servers. They use no AI and no AI tokens.

## Events

| type | when |
| --- | --- |
| \`page.created\` | a page was made |
| \`page.updated\` | its content changed |
| \`page.renamed\` | its title changed |
| \`page.moved\` | it moved under another page |
| \`page.trashed\` / \`page.restored\` | it went to the trash / came back |
| \`page.deleted\` | it was deleted for good |
| \`ping\` | the "테스트 보내기" button |

Edits are grouped per page: Acard waits until the page has been quiet for 10 seconds (at most 60 seconds while someone
keeps typing) and sends one request. \`type\` is the strongest change in the group (deleted > trashed > restored > created >
moved > renamed > updated) and \`changes\` lists all of them.

## Request

\`POST\` with \`content-type: application/json\` and these headers:

- \`X-Acard-Event\`: the event type
- \`X-Acard-Delivery\`: the delivery id, the same on every retry of it; drop a delivery id you already handled
- \`X-Acard-Signature\`: \`t=<unix seconds>,v1=<hex HMAC-SHA256>\`

\`\`\`json
{
  "id": "4f0c8f8e-6c1a-4c55-9d43-2f1f0b6b2a10",
  "type": "page.updated",
  "version": 1,
  "occurred_at": "2026-10-22T05:12:03.000Z",
  "attempt": 1,
  "workspace": { "id": "…" },
  "page": { "slug": "weekly-plan", "title": "Weekly plan", "parent": null, "kind": "note", "trashed": false,
            "url": "${origin}/weekly-plan/", "api": "${origin}/api/v1/pages/weekly-plan" },
  "changes": ["page.updated"],
  "actor": { "kind": "human" }
}
\`\`\`

The body never carries page content. Read it with an agent token from \`page.api\` (GET /api/v1/pages/{slug}, see
${origin}/api/v1/openapi.json). For \`page.deleted\` the url fields are null and title/parent are the last ones sent.

\`actor.kind\` says who made the change: \`human\` (the editor), \`api_token\` or \`oauth_app\` (with \`name\` and, for
tokens, \`token_id\`), \`agent\` (the agent built into Acard), \`guest\` (someone a page was shared with), \`system\`.
If your receiver writes back to Acard, skip events whose actor is your own token, or every write triggers another
webhook and the two systems loop.

## Checking the signature

Compute HMAC-SHA256 with the secret over \`<t>.<raw body>\` (the exact bytes received, before parsing), compare with
\`v1\` in constant time, and refuse a \`t\` more than 5 minutes from your clock.

Node.js:

\`\`\`js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyAcard(secret, header, rawBody) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.trim().split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(t + "." + rawBody).digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
// express: app.post("/acard", express.raw({ type: "application/json" }), (req, res) => {
//   if (!verifyAcard(process.env.ACARD_WEBHOOK_SECRET, req.get("x-acard-signature"), req.body.toString("utf8"))) return res.sendStatus(401);
//   const event = JSON.parse(req.body); res.sendStatus(200); /* then handle event */ });
\`\`\`

Python:

\`\`\`python
import hashlib, hmac, time

def verify_acard(secret: str, header: str, raw_body: bytes) -> bool:
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
\`\`\`

## Answering, retries and limits

- Answer any 2xx within 10 seconds. Do slow work after answering.
- Redirects are not followed and count as failures, like timeouts and other statuses.
- A failed delivery is sent again after 30 s, 1 min, 2 min, 4 min … (doubling, at most 1 hour apart), up to 8 attempts.
  Retries can arrive after newer events of the same page; order by \`occurred_at\`.
- After 10 failed attempts in a row the webhook turns itself off and the settings screen shows "자동으로 꺼짐".
  Switching it back on resets the count. Deliveries waiting while it was off are dropped.
- Up to 5 webhooks per workspace. The last 20 deliveries of each are listed under "최근 기록" (kept 7 days).
- Only public https addresses on port 443: no localhost, private, link-local or cloud metadata addresses. The name is
  resolved again before each send and refused if it points inside a private network.
- The desktop (local) edition does not send webhooks yet.
`;
}

// AGENTS.md "Components" section, built from componentCatalog() (component-registry.js) so it lists exactly the
// registered components. Without a catalog it still points at list_components.
export function componentsMd(catalog) {
  const list = Array.isArray(catalog) ? catalog : [];
  const fields = (schema) => {
    const props = Object.keys((schema && schema.properties) || {});
    const required = new Set((schema && schema.required) || []);
    return props.map((key) => (required.has(key) ? key + '*' : key)).join(', ');
  };
  const lines = list.map((c) => '- `' + c.id + '` ' + c.name + ': ' + c.description + (fields(c.schema) ? ' Fields: ' + fields(c.schema) + '.' : ''));
  const example = list[0] ? '\n\n' + list[0].markdown : '';
  return `## Components

For a summary, key numbers, steps, a comparison or a timeline, write a component instead of HTML: a \`\`\`acard-ui {"ui":"<id>"} fence holding JSON data only (no HTML, no CSS). \`list_components\` (GET /api/v1/components, or /api/v1/components/{id}) gives each one's schema, defaults and a ready fence. To change one later call \`set_component_data\` with \`page\`, \`block_id\` (or \`ui\` and optional \`after_block_id\` for a new block), \`data\` and \`expected_version\` from \`read_blocks\`; data that does not fit the schema is refused and the error names the field. A missing or malformed field is drawn with its default; the stored data is never changed by drawing.
` + (lines.length ? '\n' + lines.join('\n') + '\n\n* required.' + example + '\n' : '');
}

export function agentsMd(origin, components) {
  return `# AGENTS.md (Acard)

Acard (${origin}) is a Notion-style notes app. Agents read and write pages as Markdown; people read and edit the same pages in a block editor.

## Authenticate

- MCP Streamable HTTP: ${origin}/mcp
- HTTP API: ${origin}/api/v1 (spec: ${origin}/api/v1/openapi.json)
- On this computer no token is needed. On a team server send \`Authorization: Bearer <ACARD_AGENT_TOKEN>\` (the token the server was started with).
- Command-only clients: \`npx -y --package=${origin}/acard-cli.tgz acard mcp\` with env ACARD_URL=${origin}.
- \`whoami\` (GET /api/v1/me) shows your identity and scopes.

## Edit individual blocks

- \`read_blocks\` takes \`page\` (slug), returning ordered \`{id,type,text,markdown}\` blocks and \`version\`/\`updated\` stamps. HTTP: GET /api/v1/pages/{slug}/blocks.
- \`update_block\` takes \`page, block_id, markdown, expected_version\`. Markdown must describe exactly one block; its ID and indentation stay unchanged. HTTP: PATCH /api/v1/pages/{slug}/blocks/{id}.
- \`insert_blocks\` takes \`page, after_block_id, markdown, expected_version\`. A null anchor inserts at the start; an ID inserts immediately after that block. HTTP: POST /api/v1/pages/{slug}/blocks.
- \`delete_block\` takes \`page, block_id, expected_version\`. It deletes only that block, leaving descendants untouched. HTTP: DELETE /api/v1/pages/{slug}/blocks/{id} with a JSON body.
- Parts: \`list_parts\` returns the part types (badge, table, chart, heatmap, dag, plus parts made from HTML blocks) with their JSON data schema and a ready fence. Write the \`\`\`acard-part fence with JSON data only, or change one with \`set_part_data\` (\`page\`, \`block_id\`, \`data\`, \`expected_version\`).
- HTML blocks: \`patch_block\` changes part of an existing HTML block with \`edits\` (a list of {find, replace}; each find appears exactly once in the block).
- Prefer these tools over replacing a whole page. Send the exact \`version\` you read as \`expected_version\`; each successful write returns a new version. A stale version is HTTP 409, or MCP \`isError: true\` with \`structuredContent.status: 409\`. Re-read and merge.

${componentsMd(components)}
## Frontmatter

\`\`\`yaml
---
title: Page title
parent: parent-slug
icon: "📒"
tags: [notes]
---
\`\`\`

\`title\`, \`parent\`, \`icon\` and \`tags\` are writable. \`slug\` is read-only once the page exists.

## Markdown blocks

| Markdown | Block |
| --- | --- |
| \`# H1\` to \`#### H4\` | headings |
| \`- item\` / \`1. item\` | bulleted / numbered list |
| \`- [ ] task\` / \`- [x] task\` | to-do |
| \`- [toggle] Title\` | toggle |
| \`- [toc]\` | table of contents built from the headings |
| \`> [!tip] text\` | callout |
| \`> quote\` | quote |
| fenced \`\`\` code \`\`\` | code |
| \`---\` | divider |
| \`| a | b |\` table | table |
| \`![caption](url "60")\` | image (last number is width %) |
| \`[[slug]]\` | page link (shows in backlinks) |

## Decisions

To ask a person to decide something, add a callout:

\`\`\`
> [!decision] <one-sentence question>
\`\`\`

It shows up in GET /api/v1/decisions and the \`list_decisions\` tool. The person answers by editing the page and removing the callout.

## Rules

- Never put secrets, tokens, passwords or private keys in a page.
- Read before you overwrite. Pass \`expectedUpdated\` (the \`updated\` value you read) to update_page, or send \`If-Match\` with the ETag from GET /api/v1/pages/{slug}. A 409 means the page changed since you read it: re-read, merge, then write again.
- One write takes up to 400,000 characters and a page up to 2,000 blocks; add more with \`append_to_page\` (POST /api/v1/pages/{slug}/append).
- Retries are safe: the same create or append sent again (same body, or the same \`Idempotency-Key\` header / \`idempotencyKey\` field) returns the first result with \`duplicate: true\`.
`;
}

export function connectClients(origin) {
  const mcp = origin + '/mcp';
  const c = (id, name, docUrl, note, methods) => ({ id, name, status: 'unverified', docUrl, note, methods });
  return [
    c('claude-code', 'Claude Code', 'https://code.claude.com/docs/en/mcp', 'Adds Acard as an MCP server.',
      [{ label: 'Command', kind: 'command', code: `claude mcp add --transport http acard ${mcp}` }]),
    c('codex', 'Codex CLI', 'https://developers.openai.com/codex/mcp', 'Adds Acard as an MCP server.',
      [{ label: 'Command', kind: 'command', code: `codex mcp add acard --url ${mcp}` }]),
    c('mcp', 'Other MCP clients', 'https://modelcontextprotocol.io/docs/getting-started/intro', 'Any client that speaks MCP over Streamable HTTP or stdio.',
      [
        { label: 'Config file', kind: 'file', path: 'mcp.json', code: JSON.stringify({ mcpServers: { acard: { url: mcp } } }, null, 2) },
        { label: 'stdio command', kind: 'command', code: `npx -y --package=${origin}/acard-cli.tgz acard mcp` },
      ]),
  ];
}
