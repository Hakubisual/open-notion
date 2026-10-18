# Worker features

Add top-level `features/*.js` files. Build and test assembly inline them in sorted
filename order at `//__FEATURES__`, before the worker export. Single-line imports
and leading `export ` keywords are stripped, like the existing inlines. Use an
IIFE for private names; call `registerFeature(def)` at module evaluation time.
Do not import runtime packages or register hooks after requests start.

`def.api`, `def.schema`, and `def.afterSave` accept a function or an array of
functions. `def.publicRoutes` is an array. Hooks run sequentially in registration
order. API and public hooks must return a `Response` or `null` (continue).

- `schema(db)`: awaited once per worker schema initialization, after core and
  editor tables. Use add-only, idempotent SQL. Concurrent initialization shares
  the same promise; failures permit a later initialization retry.
- `api(ctx)`: awaited before core human API routes, after cookie authentication,
  schema initialization and seed sync. `ctx = { request, env, db, url, path,
  method, helpers }`; `path` is the full pathname, e.g. `/api/example`.
- `publicRoutes`: the same context, before the cookie check, only for paths
  starting `/p/`. Schema is initialized when DB exists. Gate configuration must
  still exist. Returning `null` falls through to the cookie gate. Public hooks
  own their token and read-only method validation. They cannot intercept `/`,
  `/api/*`, OAuth, MCP or static assets.
- `afterSave(db, slug, blocks, page)`: awaited after `saveBlocks` commits its
  blocks and links transaction. `page` is the current pages row. Each error is
  logged and swallowed and later hooks still run. No request context is present
  at this shared helper. Seed/import/agent saves also use it; direct SQL batches
  that do not call `saveBlocks` do not fire it. Avoid recursively saving here.

- `authenticatedRoutes(ctx)`: non-API page routes after cookie authentication,
  before core editor/reader routing. Return `null` for unrelated paths. Matching
  hooks initialize schema themselves before database access; these routes never
  bypass the gate. The form-row feature uses this for `/form/<id>`.

## Database forms

`GET /api/db/<slug>/form` returns `{ form, properties }` (form is null until
configured). `PUT` accepts `{ config: { title, fields: [{ property, label,
required }] } }` and upserts one stable form ID per database. Property IDs are
scoped IDs, not names. Title and status use text and select controls respectively.
`GET /api/forms/<id>` reads the config and its current properties.
`POST /api/forms/<id>/submit` accepts `{ props: { [propertyId]: value } }`,
validates all configured fields before writing, then calls `dbRowRequest`.
Success is 201 `{ row, url }`; invalid input is 400 `{ error, errors }`, with
Korean messages keyed by property ID. Unknown and unconfigured submitted keys
are ignored. Required checkboxes must be true. `/form/<id>` renders an
authenticated native HTML form and accepts its POST without client JavaScript.

`ctx.helpers` exposes `json`, `readPage`, `readTree`, `saveBlocks`,
`normaliseBlocks`, `slugify`, `resolveSlug`, `markdownToBlocks`,
`blocksToMarkdown`, `readDatabase`, and `escapeHtml` with their core signatures.

`def.services.search = async (db, q, limit) => results` overrides nonempty searches
in `/api/search` (limit 40) and agent `listPages` / MCP `list_pages` (limit 50).
Queries are trimmed. Return rows with `slug`, `title`, `hit` and optional
`parent`, `updated`, `kind`; the human envelope is `{ results }`, agent envelope
`{ pages }`. Without the service, the existing LIKE queries are unchanged.
Empty human searches return no results; empty agent searches list the tree.
Services merge by key, with the last registered service winning.

`def.beforeRowWrite(ctx)` accepts a function or array. It runs after row input
validation and normalization, before create/update persistence, for human, agent
and form writes. `ctx = { db, database, properties, before, props }`; `before` is
the stored props for updates or null for creation. Hooks mutate `props` in place;
they must not save rows recursively. Rule matches use the original normalized
input, with later matching rules winning when they target the same property.
Bulk schema conversions, seed imports and page-title synchronization are not row
API writes. Existing page history snapshots do not include row properties.

`GET /api/db/<slug>/rules` returns `{ rules, properties, limit: 20 }` behind the
cookie gate. `POST` creates a rule from `{ config, enabled? }`; `PATCH /rules/<id>`
changes config or enabled; `DELETE /rules/<id>` removes it. Config is
`{ trigger: { type: "created" } | { type: "changed", property, value }, action:
{ type: "today", property } | { type: "set", property, value } }`. Property IDs
are scoped IDs. Changed triggers support select, status and checkbox, and match
only an actual transition on an existing row. The action targets a different,
writable property; today is a UTC date. Rules with removed properties/options
are returned with `valid: false` and do not run. All rules, including disabled
ones, count toward the SQL-enforced limit. The order is `created, id`; the last
matching action wins. No third-party rules engine or client runtime is loaded.

`def.services.mcpTools` arrays append, rather than replace. Each entry is
`{ name, description, inputSchema: z => ({ field: z.string() }), scope:
"read" | "write", operation }`. The existing 11 MCP tools remain registered.
Use unique tool and operation names. Register implementations with
`def.agentOps = { operation: async (db, principal, helpers, input) => value }`.
The helpers match core agent helpers, including `services`. `acardHost.run`
dispatches core operations first, then feature operations; core names cannot be
overridden. It enforces the associated tool scope (write wins if multiple tools
share an operation; unlisted operations require write). Implementations may
apply additional validation. `acardHost.mcpTools` exposes the combined list.
Feature operations are MCP extensions; no generic REST operation route is added.

`def.agentApi(ctx)` adds authenticated `/api/v1/*` routes. It runs after bearer
authentication, schema initialization and seed sync, before core agent routes.
The context is the API context plus `principal` and `run(operation, input)`;
`run` enforces the same operation scope as MCP. Return a Response or null.
AgentError is mapped to its HTTP status. Human API hooks remain cookie-only.
