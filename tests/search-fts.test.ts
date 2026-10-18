import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer } from "../agents/mcp-tools";
import { assembleWorkerSource } from "./assemble-worker";

const source = assembleWorkerSource();
let sqlite: Database;
let worker: any;
let env: any;
let cookie: string;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...values: any[]) => statement(sql, values),
    execute: () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    run: async () => statement(sql, params).execute(),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = {
    GATE_PASSWORD: "test-pw", GATE_SECRET: "test-secret",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    DB: { prepare: statement, batch: async (items: ReturnType<typeof statement>[]) => sqlite.transaction(() => items.map(item => item.execute()))() },
  };
  worker = new Function(source)();
  const login = await worker.fetch(new Request("https://notes.test/__gate", { method: "POST", body: new URLSearchParams({ pw: "test-pw" }) }), env);
  cookie = login.headers.get("set-cookie").split(";")[0];
  expect((await call("/api/tree")).status).toBe(200);
});
afterEach(() => sqlite.close());

function call(path: string, method = "GET", body?: unknown) {
  return worker.fetch(new Request("https://notes.test" + path, {
    method, headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env) as Promise<Response>;
}

async function save(slug: string, title: string, text: string) {
  const response = await call("/api/page/" + slug, "PUT", { title, blocks: [{ id: "b1", type: "paragraph", text }] });
  expect(response.status).toBe(200);
}

async function page(slug: string, title: string, text = "") {
  expect((await call("/api/pages", "POST", { slug, title })).status).toBe(200);
  await save(slug, title, text);
}

async function search(q: string) {
  const response = await call("/api/search?q=" + encodeURIComponent(q));
  expect(response.status).toBe(200);
  return (await response.json()).results as { slug: string; title: string; hit: string }[];
}

test("title match ranks above body-only match with bounded plain snippets", async () => {
  await page("body", "Other", "orbital notes");
  await page("title", "orbital notes", "Other");
  expect((await search("orbital")).map(row => row.slug)).toEqual(["title", "body"]);
  expect((await search("orbital"))[1].hit).toBe("orbital notes");
});

test("save replaces title and body terms in both indexes immediately", async () => {
  await page("edit", "oldtitle", "oldword 옛기록들");
  await search("oldword");
  await save("edit", "newtitle", "newword 새노트들");
  expect((sqlite.query("SELECT body FROM page_fts WHERE slug = 'edit'").get() as any).body).toBe("newword 새노트들");
  for (const old of ["oldword", "oldtitle", "기록"]) expect(await search(old)).toEqual([]);
  for (const fresh of ["newword", "newtitle", "노트"]) expect((await search(fresh)).map(row => row.slug)).toEqual(["edit"]);
});

test("trash deletes both index rows and restore reindexes without a save", async () => {
  await page("trash", "findable 노트들");
  await page("keep", "unrelated");
  await search("findable");
  expect((await call("/api/page/trash", "DELETE")).status).toBe(200);
  for (const table of ["page_fts", "page_fts_ko"]) expect(sqlite.query(`SELECT slug FROM ${table} WHERE slug = 'trash'`).all()).toEqual([]);
  expect(await search("findable")).toEqual([]);
  expect(await search("노트")).toEqual([]);
  expect((await call("/api/page/trash/restore", "POST")).status).toBe(200);
  expect((await search("findable")).map(row => row.slug)).toEqual(["trash"]);
});

test("Korean short and infix queries work without trigram's three-character minimum", async () => {
  sqlite.exec("CREATE VIRTUAL TABLE trigram_probe USING fts5(text, tokenize='trigram'); INSERT INTO trigram_probe VALUES ('노트들')");
  expect(sqlite.query("SELECT text FROM trigram_probe WHERE trigram_probe MATCH ?").all('"노트"')).toEqual([]);
  await page("korean", "내노트들", "회의기록들을 정리해요");
  await page("separate", "노 트");
  for (const q of ["노트", "기록", "회의기록", "노트".normalize("NFD")]) expect((await search(q)).map(row => row.slug)).toEqual(["korean"]);
  expect((await search("기록"))[0].hit).toBe("회의기록들을 정리해요");
  expect(sqlite.query("SELECT slug FROM page_fts WHERE page_fts MATCH ?").all('"노트"')).toEqual([]);
});

test("empty and punctuation-only search returns no results", async () => {
  await page("empty", "something");
  for (const q of ["", "  ", '" * () : -']) expect(await search(q)).toEqual([]);
});

test("missing version or empty index backfills all pages, not just recently saved pages", async () => {
  await page("legacy", "legacyword");
  await page("recent", "recentword");
  sqlite.exec("DELETE FROM page_fts; DELETE FROM page_fts_ko; DELETE FROM page_fts_dirty; DELETE FROM page_fts_state");
  await save("recent", "recentword", "recentbody");
  expect((await search("legacyword")).map(row => row.slug)).toEqual(["legacy"]);
  sqlite.exec("DELETE FROM page_fts; DELETE FROM page_fts_ko");
  expect((await search("legacyword")).map(row => row.slug)).toEqual(["legacy"]);
  expect(sqlite.query("SELECT value FROM page_fts_state WHERE key = 'version'").get()).toEqual({ value: "1" });
});

test("rename and direct block writes invalidate search without editing core routes", async () => {
  await page("direct", "beforeword", "beforebody");
  await search("beforeword");
  expect((await call("/api/page/direct/rename", "POST", { title: "afterword" })).status).toBe(200);
  sqlite.exec("UPDATE blocks SET text = 'afterbody' WHERE page = 'direct'");
  expect(await search("beforeword")).toEqual([]);
  expect(await search("beforebody")).toEqual([]);
  expect((await search("afterword"))[0].slug).toBe("direct");
  expect((await search("afterbody"))[0].slug).toBe("direct");
});

test("seed upsert of an already-dirty page does not violate the dirty-mark key", () => {
  // Regression: an outer INSERT ... ON CONFLICT DO UPDATE overrides trigger-level OR IGNORE,
  // which made every seed sync after the FTS deploy fail with UNIQUE(page_fts_dirty.slug).
  sqlite.exec("INSERT INTO page_fts_dirty (slug) VALUES ('seeded') ON CONFLICT DO NOTHING");
  const upsert = "INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES ('seeded', 'Seeded', NULL, 0, 'note', ?, 'markdown', ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, updated = excluded.updated, hash = excluded.hash";
  sqlite.query(upsert).run(1, "h1");
  expect(() => sqlite.query(upsert).run(2, "h2")).not.toThrow();
  expect(sqlite.query("SELECT COUNT(*) AS n FROM page_fts_dirty WHERE slug = 'seeded'").get()).toEqual({ n: 1 });
});

test("migration matches schema hook and can be applied repeatedly", () => {
  const before = sqlite.query("SELECT name, sql FROM sqlite_master WHERE name LIKE 'page_fts%' ORDER BY name").all();
  // Production applies nx-001 then the nx-006 trigger fix; the runtime hook must equal that end state.
  const migration = ["nx-001-search-fts.sql", "nx-006-fts-trigger-fix.sql"]
    .map((name) => readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8")).join("\n");
  sqlite.exec(migration);
  sqlite.exec(migration);
  expect(sqlite.query("SELECT name, sql FROM sqlite_master WHERE name LIKE 'page_fts%' ORDER BY name").all()).toEqual(before);
});

test("agent REST and MCP list_pages share ranked search and exclude database rows", async () => {
  await page("body", "Other", "orbital");
  await page("title", "orbital", "Other");
  await page("row", "orbital");
  sqlite.exec("UPDATE pages SET kind = 'db_row' WHERE slug = 'row'");
  const principal = { name: "Test", via: "token", scopes: ["read"] };
  const response = await worker.acardHost.serveV1(new Request("https://notes.test/api/v1/pages?q=orbital"), env, principal);
  expect((await response.json()).pages.map((row: any) => row.slug)).toEqual(["title", "body"]);
  const server = createAcardMcpServer((operation, input) => worker.acardHost.run(env, principal, operation, input), "test", worker.acardHost.mcpTools);
  const client = new Client({ name: "search-test", version: "test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "list_pages", arguments: { query: "orbital" } });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.content as any)[0].text).pages.map((row: any) => row.slug)).toEqual(["title", "body"]);
  } finally { await client.close(); await server.close(); }
});
