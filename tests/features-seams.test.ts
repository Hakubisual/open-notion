import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { assembleWorkerSource } from "./assemble-worker";

const fixture = `(() => {
  registerFeature({
    schema: async db => {
      await db.prepare("CREATE TABLE IF NOT EXISTS fixture_events (slug TEXT, text TEXT, title TEXT)").run();
      await db.prepare("INSERT INTO fixture_events VALUES ('schema', '', '')").run();
    },
    api: async ({ path, method, helpers, env, db, url, request }) => path === '/api/fixture'
      ? helpers.json({ method, path, sameUrl: url.href === request.url, db: db === env.DB, helpers: Object.keys(helpers) }) : null,
    afterSave: [async (db, slug, blocks, page) => {
      if (blocks.some(block => block.text === 'throw')) throw new Error('fixture save failure');
      await db.prepare("INSERT INTO fixture_events VALUES (?, ?, ?)").bind(slug, blocks.map(block => block.text).join(' '), page.title).run();
    }, async (db, slug) => {
      await db.prepare("INSERT INTO fixture_events VALUES (?, 'last-hook', '')").bind(slug).run();
    }],
    publicRoutes: [async ({ helpers, path }) => helpers.json({ public: path })],
    services: {
      search: async (db, q, limit) => [{ slug: 'fixture', title: q, hit: String(limit) }],
      mcpTools: [{ name: 'fixture_read', description: 'Read fixture', inputSchema: z => ({ value: z.string() }), scope: 'read', operation: 'fixtureRead' }]
    },
    agentOps: { fixtureRead: async (db, principal, helpers, input) => ({ value: input.value, name: principal.name }) }
  });
  // Exercise the seam independently of production /p/ handlers that now own the namespace.
  ACARD_FEATURES.publicRoutes.unshift(ACARD_FEATURES.publicRoutes.pop());
  registerFeature({ services: { mcpTools: [{ name: 'fixture_write', description: 'Write fixture', inputSchema: z => ({ value: z.string() }), scope: 'write', operation: 'fixtureWrite' }] },
    agentOps: { fixtureWrite: async (db, principal, helpers, input) => ({ value: input.value }) } });
})();`;

const source = assembleWorkerSource(fixture);
let sqlite: Database;
let worker: any;
let env: any;
let cookie: string;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...values: any[]) => statement(sql, values),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = {
    GATE_PASSWORD: "fixture-pw", GATE_SECRET: "fixture-secret",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    DB: {
      prepare: statement,
      batch: async (statements: ReturnType<typeof statement>[]) => {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const item of statements) results.push(await item.run());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    },
  };
  worker = new Function(source)();
  const login = await worker.fetch(new Request("https://notes.test/__gate", { method: "POST", body: new URLSearchParams({ pw: "fixture-pw" }) }), env);
  cookie = login.headers.get("set-cookie").split(";")[0];
});

afterEach(() => sqlite.close());

function call(path: string, method = "GET", body?: unknown, anonymous = false) {
  return worker.fetch(new Request("https://notes.test" + path, {
    method, headers: { ...(anonymous ? {} : { cookie }), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env) as Promise<Response>;
}

test("authenticated API hooks get the full context and core routes fall through", async () => {
  expect((await call("/api/fixture", "GET", undefined, true)).status).toBe(401);
  const response = await call("/api/fixture");
  expect(response.status).toBe(200);
  const value = await response.json();
  expect(value).toMatchObject({ path: "/api/fixture", method: "GET", sameUrl: true, db: true });
  expect(value.helpers.sort()).toEqual(["json", "readPage", "readTree", "saveBlocks", "normaliseBlocks", "slugify", "resolveSlug", "markdownToBlocks", "blocksToMarkdown", "readDatabase", "escapeHtml"].sort());
  expect((await call("/api/tree")).status).toBe(200);
  expect(sqlite.query("SELECT COUNT(*) AS n FROM fixture_events WHERE slug = 'schema'").get()).toEqual({ n: 1 });
});

test("schema hooks run once when initialization requests overlap", async () => {
  const responses = await Promise.all([call("/api/fixture"), call("/api/tree")]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(sqlite.query("SELECT COUNT(*) AS n FROM fixture_events WHERE slug = 'schema'").get()).toEqual({ n: 1 });
});

test("afterSave observes committed blocks and the current page", async () => {
  const page = await (await call("/api/pages", "POST", { title: "Fixture" })).json();
  const response = await call("/api/page/" + page.slug, "PUT", { title: "Saved title", blocks: [{ id: "b1", type: "paragraph", text: "saved word" }] });
  expect(response.status).toBe(200);
  expect(sqlite.query("SELECT text FROM blocks WHERE page = ?").get(page.slug)).toEqual({ text: "saved word" });
  expect(sqlite.query("SELECT title FROM fixture_events WHERE slug = ? AND text = 'saved word'").get(page.slug)).toEqual({ title: "Saved title" });
});

test("a throwing afterSave never fails a save or skips later hooks", async () => {
  const page = await (await call("/api/pages", "POST", { title: "Throwing" })).json();
  sqlite.exec("DELETE FROM fixture_events");
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await call("/api/page/" + page.slug, "PUT", { blocks: [{ id: "b1", type: "paragraph", text: "throw" }] })).status).toBe(200);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(sqlite.query("SELECT text FROM blocks WHERE page = ?").get(page.slug)).toEqual({ text: "throw" });
    expect(sqlite.query("SELECT text FROM fixture_events WHERE slug = ?").all(page.slug)).toEqual([{ text: "last-hook" }]);
  } finally { logged.mockRestore(); }
});

test("search overrides serve human, REST agent and MCP operation searches", async () => {
  expect(await (await call("/api/search?q=%20needle%20")).json()).toEqual({ results: [{ slug: "fixture", title: "needle", hit: "40" }] });
  expect(await (await call("/api/search?q=")).json()).toEqual({ results: [] });
  const principal = { name: "Fixture", via: "token", scopes: ["read"] };
  expect(await worker.acardHost.run(env, principal, "listPages", { query: "needle" })).toEqual({ pages: [{ slug: "fixture", title: "needle", hit: "50" }] });
  const agent = await worker.acardHost.serveV1(new Request("https://notes.test/api/v1/pages?q=needle"), env, principal);
  expect(await agent.json()).toEqual({ pages: [{ slug: "fixture", title: "needle", hit: "50" }] });
});

test("public hooks can only handle /p/ and cannot bypass the cookie gate elsewhere", async () => {
  expect(await (await call("/p/fixture", "GET", undefined, true)).json()).toEqual({ public: "/p/fixture" });
  for (const path of ["/", "/api/tree", "/api/fixture", "/p", "/p/../api/tree", "/features.js"]) {
    expect((await call(path, "GET", undefined, true)).status).toBe(401);
  }
  expect((await call("/api/v1/pages", "GET", undefined, true)).status).toBe(401);
  expect(await (await call("/api/tree")).json()).toEqual({ pages: [] });
});

test("MCP appends feature tools, validates inputs and enforces operation scopes", async () => {
  const principal = { name: "Fixture", via: "token", scopes: ["read"] };
  const server = createAcardMcpServer(async (operation, input) => {
    try { return await worker.acardHost.run(env, principal, operation, input); }
    catch (error: any) { throw new OperationFailure(error.message, error.status); }
  }, "test", worker.acardHost.mcpTools);
  const client = new Client({ name: "fixture", version: "test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(11 + worker.acardHost.mcpTools.length);
    expect(tools.map(tool => tool.name)).toEqual(["whoami", "list_pages", "read_page", "create_page", "update_page", "append_to_page", "list_databases", "read_database", "add_database_row", "update_database_row", "list_decisions", ...worker.acardHost.mcpTools.map((tool: any) => tool.name)]);
    expect(tools.slice(-2).map(tool => tool.name)).toEqual(["fixture_read", "fixture_write"]);
    const found = await client.callTool({ name: "fixture_read", arguments: { value: "hello" } });
    expect(found.isError).not.toBe(true);
    expect(JSON.parse((found.content as any)[0].text)).toEqual({ value: "hello", name: "Fixture" });
    expect((await client.callTool({ name: "fixture_read", arguments: { value: 12 } })).isError).toBe(true);
    expect((await client.callTool({ name: "fixture_write", arguments: { value: "denied" } })).isError).toBe(true);
    expect(await worker.acardHost.run(env, { ...principal, scopes: ["read", "write"] }, "fixtureWrite", { value: "allowed" })).toEqual({ value: "allowed" });
    await expect(worker.acardHost.run(env, principal, "toString", {})).rejects.toMatchObject({ status: 404 });
  } finally { await client.close(); await server.close(); }
});
