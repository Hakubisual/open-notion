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
        get: op('getAgentSkills', 'Read the editable agent-skills page, seeding Korean defaults only if missing', {}, { 200: ok('Rules', ref('Page')) }),
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

> Acard is a private Notion-like notes app. AI agents write markdown pages and work logs; the human owner (주인님) reads and edits them. Connect over MCP or the HTTP API with an agent token or OAuth.

## Connect

- [MCP (Streamable HTTP)](${origin}/mcp): main endpoint for MCP clients
- [MCP (legacy SSE)](${origin}/sse): for clients that only speak SSE
- [OpenAPI 3.1 spec](${origin}/api/v1/openapi.json): HTTP API under ${origin}/api/v1
- Auth: header \`Authorization: Bearer acard_...\` (token made by the owner in 설정 > 에이전트 연결), or OAuth 2.1 with PKCE S256 and dynamic client registration at ${origin}/oauth/register
- Local stdio: \`npx -y --package=${origin}/acard-cli.tgz acard mcp\` with env ACARD_TOKEN and ACARD_URL=${origin}

## Conventions

- [AGENTS.md](${origin}/AGENTS.md): full rules. Read it before writing.
- [Agent skills](${origin}/api/v1/agent-skills): call get_agent_skills first. The owner edits the agent-skills page; missing rules are seeded in Korean.
- Prefer read_blocks and update_block/insert_blocks/delete_block with expected_version from the read. On 409 re-read and merge.
- Visuals (cards, tables with totals, charts, heatmaps, flows): pick a part with list_parts and send only JSON data (\`\`\`acard-part fence or set_part_data), not a new HTML block.
- Flows: a flow, process, pipeline or structure (전체 흐름, 구조도, 구성도) is the \`dag\` part: \`nodes\` [{id, label, desc, items, tags [{text, kind: agent|api|lib|person}], gate, state}], \`edges\` [[from, to, label?]], \`numbered\`, \`callout\` {title, text}. It draws step cards joined by arrows (left to right, top-down on phones) in the page theme. Never hand-write stacked HTML cards with ▼/→ arrows or white/black boxes; such a write returns \`htmlWarnings\` naming the part to use. To change an HTML block send only the changed text with patch_block.
- One work-log page per project; add to existing logs with append, don't rewrite them.
- Flag owner decisions with a callout \`> [!decision] 주인님 결정 필요: <question>\`. They show up in GET /api/v1/decisions.
- Contents: never hand-write a \`## 목차\` list. One \`- [toc]\` line makes linked contents from the page's headings. A workflow, pipeline or structure diagram is the dag part, not stacked HTML cards or an uploaded image. Change one section with the block tools (GET/PATCH/POST /api/v1/pages/{slug}/blocks), not a text replace over the whole page markdown.
- Never put secrets, tokens or passwords in pages.
- Write for the owner in Korean.

## Optional

- [Webhooks](${origin}/webhooks.md): Acard POSTs to your https URL when pages change (signed, debounced, retried)
- [MCP tools](${origin}/AGENTS.md): whoami, get_agent_skills, read_blocks, update_block, insert_blocks, delete_block, list_pages, read_page, create_page, update_page, append_to_page, list_databases, read_database, add_database_row, update_database_row, list_decisions, upload_media, list_components, set_component_data
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

Acard (${origin}) is a Notion-like notes app. Agents write markdown. The human owner, called 주인님, reads and edits the same pages in a block editor on phone and PC. Your pages are their window into your work, so keep them tidy and readable.

## Authenticate

- MCP Streamable HTTP: ${origin}/mcp (legacy SSE: ${origin}/sse)
- HTTP API: ${origin}/api/v1 (spec: ${origin}/api/v1/openapi.json)
- Send \`Authorization: Bearer acard_...\`. The owner creates tokens in "설정 > 에이전트 연결". Or use OAuth 2.1 (PKCE S256, dynamic registration at ${origin}/oauth/register).
- Command-only clients: \`npx -y --package=${origin}/acard-cli.tgz acard mcp\` with env ACARD_TOKEN and ACARD_URL=${origin}.
- Call \`whoami\` (GET /api/v1/me) first to check your identity and scopes.
- Call \`get_agent_skills\` (GET /api/v1/agent-skills) before writing. It reads the editable \`agent-skills\` page and seeds Korean defaults only if missing. Preserve the owner's changes to these rules.

## Edit individual blocks

- \`read_blocks\` takes \`page\` (slug), returning ordered \`{id,type,text,markdown}\` blocks and \`version\`/\`updated\` stamps. HTTP: GET /api/v1/pages/{slug}/blocks.
- \`update_block\` takes \`page, block_id, markdown, expected_version\`. Markdown must describe exactly one block; its ID and indentation stay unchanged. HTTP: PATCH /api/v1/pages/{slug}/blocks/{id}.
- \`insert_blocks\` takes \`page, after_block_id, markdown, expected_version\`. A null anchor inserts at the start; an ID inserts immediately after that block. HTTP: POST /api/v1/pages/{slug}/blocks.
- Visuals: write \`\`\`mermaid (flowchart, sequenceDiagram, timeline, gantt, mindmap), \`\`\`acard-chart (JSON {type,labels,series}) or \`\`\`acard-visual (sandboxed HTML/SVG, no network, 64 KB) fences, or, only when no part fits and the user asked for it, \`\`\`html-embed for an HTML block (HTML/CSS/JS charts, interactive demos, styled layouts; runs in a sandboxed iframe with scripts but no network, cookies or parent access, 64 KB) with {"caption":...,"alt":...} after the language. The block follows the page's light/dark theme and grows to its content: use the Acard CSS variables (var(--fg), var(--fg-dim), var(--bg), var(--bg-soft), var(--surface), var(--line), var(--accent), var(--tag-<color>-bg/-fg)) instead of hard-coded white/black, and leave fonts, body font size and height alone; plain table, h2-h4, .card, .pill/.tag and .muted already look like the page. Blocks are never cut: a visual/chart/diagram/HTML block over 64 KB (UTF-8) or any other block over 100,000 characters makes the whole write fail with 413 and a message naming the block, so split it into several blocks. Images: \`upload_media\` takes \`page, data\` (base64 png/jpeg/webp/gif, 4 MB; SVG is refused) and returns a markdown image line. HTTP: POST /api/v1/media (multipart file, page, mime).
- Parts first: when a page needs a visual (status cards, a table with totals or shares, a chart, a heatmap, a step flow), do not write a new HTML block. Call \`list_parts\` (the 5 defaults badge, table, chart, heatmap, dag plus parts registered from HTML blocks, each with its JSON data schema and fence) and write \`\`\`acard-part {"part":"table","v":1} with only the JSON data, or call \`set_part_data\` with \`page\`, \`block_id\` (or \`part\` and optional \`after_block_id\`, \`caption\`), \`data\` and \`expected_version\` from \`read_blocks\`. Data is checked against the part's schema (a mismatch fails and names the field); the part's code is never in the page, it runs in the same sandbox as HTML blocks, computes sums/averages/ratios itself and follows the page's dark theme. To change a number, send only the new data with \`set_part_data\`. A part block a person edited keeps the person's data; yours becomes an update suggestion. Measured on a 5-block sample: parts are about 5% of the tokens of the same HTML blocks to write, and a one-number change is 180 tokens instead of 3,900.
- Editing an HTML block: do not resend the whole block. Call \`patch_block\` with \`page\`, \`block_id\`, \`expected_version\` and \`edits\` (a list of {find, replace}; each find must appear exactly once in the block) and only that text changes. If the HTML block draws cards, a table, a chart, a heatmap or a flow, suggest to the user turning it into a part with data and do it with \`set_part_data\` (\`part\` + \`after_block_id\`, then \`delete_block\` on the old one) once they agree.
- \`delete_block\` takes \`page, block_id, expected_version\`. It deletes only that block, leaving descendants untouched. HTTP: DELETE /api/v1/pages/{slug}/blocks/{id} with a JSON body.
- Prefer these tools over replacing a whole page. Send the exact \`version\` you read as \`expected_version\`; each successful write returns a new version. A stale version is HTTP 409, or MCP \`isError: true\` with \`structuredContent.status: 409\`. Re-read and merge instead of forcing a write.


${componentsMd(components)}
## Where to write work logs

- You'll be told a parent page. Create one page per project under it (create_page with \`parent\`).
- A project or topic page is a folder: create it with \`view: folder\` and a one-line \`description\`, and write every long text (overview, log, plan, notes) as its own sub-page under it. Never put a long write-up into the folder page itself.
- A person decides whether a page is a folder or an article (⋯ 폴더로 보기 / 글로 보기). update_page, append_to_page and block edits on a folder page are refused with 409; add a sub-page instead. An article page is written as before. \`set_page_view\` (PUT /api/v1/pages/{slug}/view) changes it only on pages no person has set.
- If a log page already exists, add to it with \`append_to_page\` (POST /api/v1/pages/{slug}/append). Don't rewrite the whole page to add an entry.
- Search first with \`list_pages\` (GET /api/v1/pages?q=) so you don't make duplicates.

## Frontmatter

\`\`\`yaml
---
title: Page title
parent: parent-slug
icon: "📒"
tags: [log, project]
---
\`\`\`

\`title\`, \`parent\`, \`icon\` and \`tags\` are writable. \`slug\` is read-only once the page exists.

## Markdown blocks

| Markdown | Block |
| --- | --- |
| \`# H1\` to \`### H3\` | headings |
| \`- item\` / \`1. item\` | bulleted / numbered list |
| \`- [ ] task\` / \`- [x] task\` | to-do (the owner ticks it; use this for any checklist) |
| \`- [toggle] Title\` | toggle |
| \`- [toc]\` | table of contents built from the headings |
| \`> [!tip] text\` | callout |
| \`> quote\` | quote |
| fenced \`\`\` code \`\`\` | code |
| \`---\` | divider |
| \`| a | b |\` table | database (table/board) |
| \`![caption](url "60")\` | image (last number is width %) |
| \`![a](url "g=drafts")\` lines in a row | images with the same g= sit in one row (a set of drafts or screenshots) |
| \`[[slug]]\` | page link (shows in backlinks) |

## Asking the owner to decide

When you need 주인님 to choose something, add a callout:

\`\`\`
> [!decision] 주인님 결정 필요: <one-sentence question>
\`\`\`

It shows up in GET /api/v1/decisions and the \`list_decisions\` tool. The owner answers by editing the page and removing the callout. Check \`list_decisions\` before you act on something you flagged; if the callout is gone, read the page for the answer.

## Rules

- Never put secrets, tokens, passwords or private keys in a page.
- Read before you overwrite. Prefer append over replace.
- Long documents: one write takes up to 400,000 characters and a page up to 2,000 blocks. Up to ~50 KB (~1,000 blocks) saves in a few seconds; for more, create the page with the first sections and add the rest with \`append_to_page\` (POST /api/v1/pages/{slug}/append) in 30-50 KB pieces split at \`##\` headings, or put big sections in sub-pages. Over the limit is a 413 that says how to split.
- Retries are safe: a create or append is saved whole or not at all, and the same call sent again (same body, or the same \`Idempotency-Key\` header / \`idempotencyKey\` field) returns the first result with \`duplicate: true\` instead of a second page or a second copy. After a timeout send the same call again; don't create under a new title.
- Always pass \`expectedUpdated\` (the \`updated\` value you read) to update_page, or send \`If-Match\` with the ETag from GET /api/v1/pages/{slug}. Without it, a page a person edited after your last write is refused with 409. A 409 means the page changed since you read it: re-read, merge your change with theirs, then write again. Never drop the owner's edits.
- Write in Korean when the text is for the owner.
- Keep pages short. Lead with what changed and what's next.
`;
}

export function connectClients(origin) {
  const mcp = origin + '/mcp';
  const pkg = '--package=' + origin + '/acard-cli.tgz';
  const stdioJson = (key) =>
    JSON.stringify({
      [key]: {
        acard: {
          command: 'npx',
          args: ['-y', pkg, 'acard', 'mcp'],
          env: { ACARD_TOKEN: '<TOKEN>', ACARD_URL: origin },
        },
      },
    }, null, 2);
  const headerJson = (outer, inner) =>
    JSON.stringify({ [outer]: { acard: { ...inner, headers: { Authorization: 'Bearer <TOKEN>' } } } }, null, 2);
  const c = (id, name, docUrl, note, methods) => ({ id, name, status: 'unverified', docUrl, note, methods });
  const verified = (client) => ({ ...client, status: 'verified' });

  return [
    verified(c('omo', 'OMO', origin + '/AGENTS.md',
      '이 PC 의 OMO 로 실제 페이지를 만들고 덧붙여 확인했어요. 토큰은 ACARD_TOKEN 환경변수에 넣어 둡니다. 프로젝트 파일(.omo/mcp.json)은 OMO 를 --approve 로 켜야 읽혀요.',
      [
        { label: '설정 파일에 추가', kind: 'file', path: '~/.omo/agent/mcp.json', code: JSON.stringify({ mcpServers: { acard: { type: 'http', url: mcp, auth: 'bearer', bearerTokenEnv: 'ACARD_TOKEN' } } }, null, 2) },
        { label: '명령 방식(주소가 안 될 때)', kind: 'file', path: '~/.omo/agent/mcp.json', code: stdioJson('mcpServers') },
      ])),
    verified(c('claude-code', 'Claude Code', 'https://code.claude.com/docs/en/mcp',
      '이 PC 의 Claude Code 로 실제 페이지를 만들고 고쳐서 확인했어요. 토큰 줄을 빼고 추가한 뒤 Claude Code 안에서 /mcp 를 실행하면 로그인으로 연결할 수도 있어요.',
      [
        { label: '명령 한 줄', kind: 'command', code: `claude mcp add --transport http acard ${mcp} --header "Authorization: Bearer <TOKEN>"` },
        { label: '프로젝트 설정 파일', kind: 'file', path: '.mcp.json', code: headerJson('mcpServers', { type: 'http', url: mcp }) },
      ])),
    c('claude-desktop', 'Claude Desktop', 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
      '설정 > 커넥터 > 사용자 지정 커넥터 추가에 주소를 넣으면 로그인 창이 뜹니다. 안 되면 아래 설정 파일 방식을 씁니다.',
      [
        { label: '커넥터 주소', kind: 'command', code: mcp },
        { label: '설정 파일(명령 방식)', kind: 'file', path: '%APPDATA%\\Claude\\claude_desktop_config.json', code: stdioJson('mcpServers') },
      ]),
    c('codex', 'Codex CLI', 'https://developers.openai.com/codex/mcp',
      '토큰은 ACARD_TOKEN 환경변수에 넣어 둡니다. 로그인 방식은 두 번째 명령을 씁니다.',
      [
        { label: '설정 파일에 추가', kind: 'file', path: '~/.codex/config.toml', code: `[mcp_servers.acard]\nurl = "${mcp}"\nbearer_token_env_var = "ACARD_TOKEN"` },
        { label: '로그인으로 연결', kind: 'command', code: `codex mcp add acard --url ${mcp}` },
      ]),
    c('amp', 'Amp', 'https://ampcode.com/docs/customize/mcp',
      '명령으로 추가하면 로그인 창이 뜹니다. 토큰을 쓰려면 설정 파일 방식을 씁니다.',
      [
        { label: '명령 한 줄', kind: 'command', code: `amp mcp add acard ${mcp}` },
        { label: '설정에 추가', kind: 'file', path: 'settings.json', code: JSON.stringify({ 'amp.mcpServers': { acard: { url: mcp, headers: { Authorization: 'Bearer <TOKEN>' } } } }, null, 2) },
      ]),
    c('openclaw', 'OpenClaw (가재)', 'https://docs.openclaw.ai/cli/mcp',
      '전송 방식을 빼면 기본값이 SSE 라서, streamable-http 를 꼭 적어야 합니다.',
      [
        { label: '로그인으로 연결', kind: 'command', code: `openclaw mcp add acard --url ${mcp} --transport streamable-http --auth oauth\nopenclaw mcp login acard` },
        { label: '토큰으로 연결', kind: 'command', code: `openclaw mcp set acard '${JSON.stringify({ url: mcp, transport: 'streamable-http', headers: { Authorization: 'Bearer <TOKEN>' } })}'` },
      ]),
    c('cursor', 'Cursor', 'https://cursor.com/docs/context/mcp',
      'headers 를 빼면 Cursor 가 로그인 창을 띄웁니다.',
      [{ label: '설정 파일에 추가', kind: 'file', path: '~/.cursor/mcp.json', code: headerJson('mcpServers', { url: mcp }) }]),
    c('windsurf', 'Windsurf', 'https://docs.windsurf.com/windsurf/cascade/mcp',
      '윈도우에서는 %APPDATA%\\devin\\mcp_config.json 에 있습니다(현재 문서 기준).',
      [{ label: '설정 파일에 추가', kind: 'file', path: '%APPDATA%\\devin\\mcp_config.json', code: headerJson('mcpServers', { serverUrl: mcp }) }]),
    c('cline', 'Cline', 'https://docs.cline.bot/mcp/configuring-mcp-servers',
      'type 을 빼면 SSE 로 연결되니 streamableHttp 를 꼭 적습니다.',
      [{ label: '설정 파일에 추가', kind: 'file', path: 'cline_mcp_settings.json', code: headerJson('mcpServers', { type: 'streamableHttp', url: mcp }) }]),
    c('continue', 'Continue', 'https://docs.continue.dev/customize/deep-dives/mcp',
      '공식 문서에 토큰 넣는 방법이 없어서, 명령을 실행하는 방식을 권합니다.',
      [{
        label: '설정 파일 만들기', kind: 'file', path: '.continue/mcpServers/acard.yaml',
        code: `name: Acard\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: acard\n    command: npx\n    args:\n      - "-y"\n      - "${pkg}"\n      - acard\n      - mcp\n    env:\n      ACARD_TOKEN: <TOKEN>\n      ACARD_URL: ${origin}`,
      }]),
    c('gemini-cli', 'Gemini CLI', 'https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md',
      'headers 를 빼면 처음 연결할 때 로그인 창이 뜹니다. SSE 를 쓰려면 "url": "' + origin + '/sse" 로 바꿉니다.',
      [{ label: '설정 파일에 추가', kind: 'file', path: '~/.gemini/settings.json', code: headerJson('mcpServers', { httpUrl: mcp }) }]),
    c('opencode', 'opencode', 'https://opencode.ai/docs/mcp-servers/',
      '로그인 방식은 headers 를 빼고 opencode mcp auth acard 를 실행합니다.',
      [{ label: '설정 파일에 추가', kind: 'file', path: 'opencode.json', code: JSON.stringify({ mcp: { acard: { type: 'remote', url: mcp, headers: { Authorization: 'Bearer <TOKEN>' } } } }, null, 2) }]),
    c('goose', 'Goose', 'https://goose-docs.ai/docs/getting-started/using-extensions',
      '처음 연결할 때 로그인 창이 뜹니다. 토큰을 직접 넣는 방법은 공식 문서에 없습니다.',
      [{
        label: '설정 파일에 추가', kind: 'file', path: '~/.config/goose/config.yaml',
        code: `extensions:\n  acard:\n    name: Acard\n    type: streamable_http\n    uri: ${mcp}\n    enabled: true\n    timeout: 300`,
      }]),
    c('zed', 'Zed', 'https://zed.dev/docs/ai/mcp',
      'headers 를 빼면 Zed 가 로그인 창을 띄웁니다.',
      [{ label: '설정 파일에 추가', kind: 'file', path: 'settings.json', code: headerJson('context_servers', { url: mcp }) }]),
    c('vscode-copilot', 'VS Code (Copilot 에이전트)', 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
      '처음 쓸 때 VS Code 가 토큰을 물어봅니다. 파일에 토큰을 직접 적지 않아도 됩니다.',
      [{
        label: '설정 파일에 추가', kind: 'file', path: '.vscode/mcp.json',
        code: JSON.stringify({
          servers: { acard: { type: 'http', url: mcp, headers: { Authorization: 'Bearer ${input:acard-token}' } } },
          inputs: [{ type: 'promptString', id: 'acard-token', description: 'Acard token', password: true }],
        }, null, 2),
      }]),
  ];
}
