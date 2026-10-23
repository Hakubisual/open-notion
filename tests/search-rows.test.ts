import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

async function page(slug: string, title: string, text: string, parent?: string) {
  expect((await call("/api/pages", "POST", { slug, title, parent })).status).toBe(200);
  const current = await (await call("/api/page/" + slug)).json();
  expect((await call("/api/page/" + slug, "PUT", { title, base_updated: current.page.updated, blocks: [{ id: "b1", type: "paragraph", text }] })).status).toBe(200);
}

async function row(slug: string, title: string, text: string, parent = "tasks") {
  await page(slug, title, text, parent);
  sqlite.query("UPDATE pages SET kind = 'db_row' WHERE slug = ?").run(slug);
}

async function search(q: string) {
  const response = await call("/api/search?q=" + encodeURIComponent(q));
  expect(response.status).toBe(200);
  return (await response.json()).results as { slug: string; title: string; hit: string; kind: string }[];
}

test("database rows are found by title and by body, with kind db_row", async () => {
  await page("tasks", "Tasks", "");
  await row("r1", "zephyr launch", "plain");
  await row("r2", "Other", "회의록 quasar 정리");
  expect((await search("zephyr")).map(hit => [hit.slug, hit.kind])).toEqual([["r1", "db_row"]]);
  expect((await search("quasar")).map(hit => hit.slug)).toEqual(["r2"]);
  expect((await search("회의록")).map(hit => hit.slug)).toEqual(["r2"]);
});

test("trashed rows and rows of a trashed database stay hidden", async () => {
  await page("tasks", "Tasks", "");
  await page("other", "Other db", "");
  await row("gone", "nebula gone", "x");
  await row("orphan", "nebula orphan", "x", "other");
  await row("kept", "nebula kept", "x");
  expect((await call("/api/page/gone", "DELETE")).status).toBe(200);
  expect((await call("/api/page/other", "DELETE")).status).toBe(200);
  expect((await search("nebula")).map(hit => hit.slug)).toEqual(["kept"]);
});

test("rows the viewer may not read are filtered out", async () => {
  await page("tasks", "Tasks", "");
  await row("open", "comet open", "x");
  await row("secret", "comet secret", "x");
  env.DB.acardVisible = new Set(["tasks", "open"]);
  expect((await search("comet")).map(hit => hit.slug)).toEqual(["open"]);
});

test("palette labels a row hit", () => {
  const app = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");
  const block = app.slice(app.indexOf("  function esc(t)"), app.indexOf("  function renderPalette()"));
  const itemHtml = new Function(block + "return itemHtml;")();
  expect(itemHtml({ slug: "r1", title: "Row", kind: "db_row" }, false)).toContain("표 행");
  expect(itemHtml({ slug: "n1", title: "Note", kind: "note" }, false)).not.toContain("표 행");
});
