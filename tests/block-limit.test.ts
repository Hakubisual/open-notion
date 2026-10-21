import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { createAgentToken } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

// #21: blocks used to be cut at 20,000 characters on every write. HTML / visual / chart / diagram blocks take 64 KB,
// other blocks 100,000 characters, and anything longer is refused with 413 instead of being silently cut.
const source = assembleWorkerSource();
const writer = { name: "Limit agent", via: "token" as const, scopes: ["read", "write"] };
let sqlite: Database, env: any, worker: any, token: string, client: Client, server: ReturnType<typeof createAcardMcpServer>;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...next: any[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = { GATE_PASSWORD: "test-pw", GATE_SECRET: "test-secret", ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    DB: { prepare: statement, batch: async (statements: ReturnType<typeof statement>[]) => {
      sqlite.exec("BEGIN");
      try { const out = []; for (const item of statements) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    } } };
  worker = new Function(source)();
  await worker.acardHost.run(env, writer, "whoami", {});
  token = (await createAgentToken(env.DB, { name: writer.name, scopes: writer.scopes })).token;
  server = createAcardMcpServer(async (operation, input) => {
    try { return await worker.acardHost.run(env, writer, operation, input); }
    catch (error: any) { throw new OperationFailure(error.message, error.status); }
  }, "test", worker.acardHost.mcpTools);
  client = new Client({ name: "limit-test", version: "test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});

afterEach(async () => { await client.close(); await server.close(); sqlite.close(); });

// A dashboard-like HTML source of exactly `bytes` UTF-8 bytes, with Korean text so bytes != characters.
function html(bytes: number) {
  const head = "<div class=\"kpi\"><b>매출 현황</b><canvas id=\"c\"></canvas></div>\n<script>";
  const tail = "</script>";
  const fill = bytes - new TextEncoder().encode(head + tail).length;
  return head + "x".repeat(fill) + tail;
}
const fence = (body: string) => "```html-embed\n" + body + "\n```";

function rest(path: string, method = "GET", body?: unknown) {
  return worker.fetch(new Request("https://notes.test/api/v1" + path, { method,
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }), env) as Promise<Response>;
}

async function mcp(name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args }) as Promise<any>;
}

test("REST: a 60 KB html-embed block round-trips byte-identical", async () => {
  const body = html(60 * 1024);
  const created = await rest("/pages", "POST", { slug: "dash", title: "Dash", markdown: fence(body) });
  expect(created.status).toBe(201);
  const row = sqlite.query("SELECT type, text FROM blocks WHERE page = 'dash'").get() as any;
  expect(row.type).toBe("html");
  expect(row.text).toBe(body);
  const read = await (await rest("/pages/dash")).json();
  expect(read.markdown).toContain(fence(body));
});

test("REST: a 70 KB html-embed block is refused with a Korean 413 on create, update and append", async () => {
  const big = fence(html(70 * 1024));
  const created = await rest("/pages", "POST", { slug: "dash", title: "Dash", markdown: big });
  expect(created.status).toBe(413);
  expect((await created.json()).error).toContain("64KB");
  expect(sqlite.query("SELECT slug FROM pages WHERE slug = 'dash'").get()).toBeNull();
  expect((await rest("/pages", "POST", { slug: "ok", title: "Ok", markdown: "hello" })).status).toBe(201);
  const updated = await rest("/pages/ok", "PUT", { markdown: big });
  expect(updated.status).toBe(413);
  const appended = await rest("/pages/ok/append", "POST", { markdown: big });
  expect(appended.status).toBe(413);
  expect((sqlite.query("SELECT text FROM blocks WHERE page = 'ok'").all() as any[]).map(r => r.text)).toEqual(["hello"]);
});

test("a 25,000-character text block is stored whole", async () => {
  const text = "가".repeat(25_000);
  expect((await rest("/pages", "POST", { slug: "long", title: "Long", markdown: text })).status).toBe(201);
  expect((sqlite.query("SELECT text FROM blocks WHERE page = 'long'").get() as any).text).toBe(text);
});

test("MCP: insert_blocks takes a 60 KB html-embed block byte-identical and refuses 70 KB", async () => {
  await worker.acardHost.run(env, writer, "createPage", { slug: "m", title: "M", markdown: "first" });
  const before = JSON.parse((await mcp("read_blocks", { page: "m" })).content[0].text);
  const body = html(60 * 1024);
  const ok = await mcp("insert_blocks", { page: "m", after_block_id: before.blocks[0].id, markdown: fence(body), expected_version: before.version });
  expect(ok.isError).not.toBe(true);
  const after = JSON.parse((await mcp("read_blocks", { page: "m" })).content[0].text);
  expect(after.blocks[1].type).toBe("html");
  expect(after.blocks[1].text).toBe(body);
  const refused = await mcp("update_block", { page: "m", block_id: after.blocks[1].id, markdown: fence(html(70 * 1024)), expected_version: after.version });
  expect(refused.isError).toBe(true);
  expect(refused.content[0].text).toContain("64KB");
  expect((sqlite.query("SELECT text FROM blocks WHERE page = 'm' AND type = 'html'").get() as any).text).toBe(body);
});

test("editor save (PUT /api/page) refuses an over-limit block with 413 instead of cutting it", async () => {
  await worker.acardHost.run(env, writer, "createPage", { slug: "e", title: "E", markdown: "first" });
  const cookie = await (async () => {
    const res = await worker.fetch(new Request("https://notes.test/__gate", { method: "POST", body: new URLSearchParams({ pw: "test-pw", next: "/" }), redirect: "manual" }), env);
    return /dn_auth=[^;]+/.exec(res.headers.get("set-cookie") || "")![0];
  })();
  const page = await worker.fetch(new Request("https://notes.test/api/page/e", { headers: { cookie } }), env).then((r: Response) => r.json());
  const put = (blocks: unknown[]) => worker.fetch(new Request("https://notes.test/api/page/e", { method: "PUT",
    headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ blocks, base_updated: page.page.updated }) }), env) as Promise<Response>;
  const refused = await put([{ id: "b1", type: "html", text: html(70 * 1024) }]);
  expect(refused.status).toBe(413);
  expect((await refused.json()).error).toContain("64KB");
  const body = html(60 * 1024);
  expect((await put([{ id: "b1", type: "html", text: body }])).status).toBe(200);
  expect((sqlite.query("SELECT text FROM blocks WHERE page = 'e'").get() as any).text).toBe(body);
});
