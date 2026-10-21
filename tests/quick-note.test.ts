import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cookie, setup } from "./db-harness";
import { assembleWorkerSource } from "./assemble-worker";

const source = assembleWorkerSource(`
registerFeature({ afterSave: async (db, slug, blocks) => {
  globalThis.__quickNoteSaved = { slug, blocks: JSON.parse(JSON.stringify(blocks)) };
} });`);
let sqlite: Database;
let env: any;
let worker: any;
let auth: string;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  worker = new Function(source)();
  ({ env } = setup({ sqlite, worker }));
  // Unlike db-harness's async statement loop, a D1 batch cannot interleave
  // transactions. Keep real SQLite statements and commit synchronously, as in
  // search-fts.test.ts, so independent workers can exercise concurrent requests.
  const statement = (sql: string, params: any[] = []) => ({
    sql,
    bind: (...values: any[]) => statement(sql, values),
    execute: () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    run: async () => statement(sql, params).execute(),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env.DB = { prepare: statement, batch: async (items: ReturnType<typeof statement>[]) => sqlite.transaction(() => items.map(item => item.execute()))() };
  auth = await cookie();
  expect((await call("/api/tree")).status).toBe(200);
});

afterEach(() => {
  sqlite.close();
  delete (globalThis as any).__quickNoteSaved;
});

function call(path: string, method = "GET", body?: unknown, target = worker) {
  return target.fetch(new Request("https://notes.test" + path, {
    method, headers: { cookie: auth, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env) as Promise<Response>;
}

async function capture(clientId: string, text: string, target = worker) {
  const response = await call("/api/quick-note", "POST", { clientId, text }, target);
  return { status: response.status, data: await response.json() as any };
}

async function otherWorker() {
  const other = new Function(source)();
  expect((await call("/api/tree", "GET", undefined, other)).status).toBe(200);
  return other;
}

test("creates one inbox, appends timestamped paragraphs, and indexes through saveBlocks", async () => {
  const first = await capture("first", "  orbital 회의기록  ");
  expect(first.status).toBe(200);
  expect(first.data.clientId).toBe("first");
  expect(typeof first.data.created).toBe("number");
  expect(typeof first.data.blockId).toBe("string");
  expect(typeof first.data.slug).toBe("string");
  const second = await capture("second", "second entry");
  expect(second.status).toBe(200);
  expect(second.data.slug).toBe(first.data.slug);
  expect(sqlite.query("SELECT title FROM pages").all()).toEqual([{ title: "빠른 메모" }]);
  const page = await (await call("/api/page/" + first.data.slug)).json() as any;
  expect(page.blocks.map((block: any) => block.text)).toEqual([
    new Date(first.data.created).toISOString() + "\norbital 회의기록",
    new Date(second.data.created).toISOString() + "\nsecond entry",
  ]);
  expect(page.blocks.every((block: any) => block.type === "paragraph")).toBe(true);
  expect((globalThis as any).__quickNoteSaved.blocks.map((block: any) => block.id)).toEqual(page.blocks.map((block: any) => block.id));
  // Check the index before searching: a lazy search reindex cannot hide a
  // missing saveBlocks/afterSave invocation.
  expect((sqlite.query("SELECT body FROM page_fts WHERE slug = ?").get(first.data.slug) as any).body).toBe(page.blocks.map((block: any) => block.text).join("\n"));
  for (const query of ["orbital", "회의", "second"]) {
    const found = await (await call("/api/search?q=" + encodeURIComponent(query))).json() as any;
    expect(found.results.map((row: any) => row.slug)).toEqual([first.data.slug]);
  }
});

test("adopts an existing inbox without replacing its blocks, metadata, or links", async () => {
  const created = await (await call("/api/pages", "POST", { slug: "existing-inbox", title: "빠른 메모" })).json();
  const original = { id: "original", type: "paragraph", text: "[[linked]] original", checked: true, indent: 2, meta: { color: "blue", custom: { keep: true } } };
  await call("/api/page/existing-inbox", "PUT", { blocks: [original], base_updated: created.updated });
  const result = await capture("append", "[[another]] capture");
  expect(result.status).toBe(200);
  expect(result.data.slug).toBe("existing-inbox");
  const page = await (await call("/api/page/existing-inbox")).json() as any;
  expect(page.blocks[0]).toEqual(original);
  expect(sqlite.query("SELECT dst FROM links WHERE src = ? ORDER BY dst").all(result.data.slug)).toEqual([{ dst: "another" }, { dst: "linked" }]);
  expect(sqlite.query("SELECT slug FROM pages").all()).toHaveLength(1);
});

test("durable clientId retries return the original receipt across workers", async () => {
  const first = await capture("retry", "stable");
  const updated = sqlite.query("SELECT updated FROM pages WHERE slug = ?").get(first.data.slug);
  expect(await capture("retry", " stable ", await otherWorker())).toEqual(first);
  expect(sqlite.query("SELECT id FROM blocks").all()).toHaveLength(1);
  expect(sqlite.query("SELECT updated FROM pages WHERE slug = ?").get(first.data.slug)).toEqual(updated);
  expect((await capture("retry", "different")).status).toBe(409);
  expect(sqlite.query("SELECT id FROM blocks").all()).toHaveLength(1);
  // Removing a captured block intentionally must not make a retry resurrect it.
  const page = await (await call("/api/page/" + first.data.slug)).json();
  await call("/api/page/" + first.data.slug, "PUT", { blocks: [], base_updated: page.page.updated });
  expect(await capture("retry", "stable")).toEqual(first);
  expect(sqlite.query("SELECT id FROM blocks").all()).toHaveLength(0);
});

test("distinct clientIds preserve identical note text as separate captures", async () => {
  const first = await capture("one", "same");
  const second = await capture("two", "same");
  expect(first.data.slug).toBe(second.data.slug);
  expect(first.data.blockId).not.toBe(second.data.blockId);
  expect(sqlite.query("SELECT id FROM blocks").all()).toHaveLength(2);
});

test("concurrent independent workers keep every distinct append and one inbox", async () => {
  const other = await otherWorker();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => capture("parallel-" + i, "concurrentword" + i, i % 2 ? other : worker)));
  expect(results.every(result => result.status === 200)).toBe(true);
  expect(new Set(results.map(result => result.data.slug)).size).toBe(1);
  expect(sqlite.query("SELECT slug FROM pages").all()).toHaveLength(1);
  const blocks = sqlite.query("SELECT id, ord, text FROM blocks ORDER BY ord").all() as any[];
  expect(blocks).toHaveLength(12);
  expect(blocks.map(block => block.ord)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  for (const result of results) expect(blocks.some(block => block.id === result.data.blockId)).toBe(true);
  for (let i = 0; i < 12; i++) {
    const found = await (await call("/api/search?q=concurrentword" + i)).json() as any;
    expect(found.results.map((row: any) => row.slug)).toEqual([results[0].data.slug]);
  }
});

test("concurrent same-client retries append once and return one receipt", async () => {
  const other = await otherWorker();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => capture("duplicate", "once", i % 2 ? other : worker)));
  expect(results.every(result => result.status === 200)).toBe(true);
  for (const result of results) expect(result).toEqual(results[0]);
  expect(sqlite.query("SELECT id FROM blocks").all()).toHaveLength(1);
});

test("concurrent reuse with different text has one winner and one conflict", async () => {
  const other = await otherWorker();
  const results = await Promise.all([capture("conflict", "one"), capture("conflict", "two", other)]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  const blocks = sqlite.query("SELECT text FROM blocks").all() as any[];
  expect(blocks).toHaveLength(1);
  const winner = results.findIndex(result => result.status === 200);
  expect(blocks[0].text.endsWith("\n" + ["one", "two"][winner])).toBe(true);
});

test("a failed receipt write rolls back the append so the same clientId can retry", async () => {
  await capture("initial", "preserved");
  sqlite.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON meta WHEN new.key = 'quick-note:request:rollback' BEGIN SELECT RAISE(ABORT, 'test receipt failure'); END");
  expect((await capture("rollback", "retryable")).status).toBe(500);
  expect(sqlite.query("SELECT id FROM blocks").all()).toHaveLength(1);
  expect(sqlite.query("SELECT value FROM meta WHERE key = 'quick-note:request:rollback'").get()).toBeNull();
  sqlite.exec("DROP TRIGGER reject_receipt");
  const retried = await capture("rollback", "retryable");
  expect(retried.status).toBe(200);
  expect(sqlite.query("SELECT id FROM blocks").all()).toHaveLength(2);
  expect(await capture("rollback", "retryable")).toEqual(retried);
});

test("an editor write and another capture before commit cannot be overwritten by a stale snapshot", async () => {
  const initial = await capture("initial", "original");
  const other = await otherWorker();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const batch = env.DB.batch;
  let intercept = true;
  env.DB.batch = async (items: any[]) => {
    if (intercept && items[0]?.sql.startsWith("INSERT INTO blocks")) {
      intercept = false;
      entered.resolve();
      await release.promise;
    }
    return batch(items);
  };
  const pending = capture("paused", "last");
  await entered.promise;
  try {
    const page = await (await call("/api/page/" + initial.data.slug)).json();
    expect((await call("/api/page/" + initial.data.slug, "PUT", { blocks: [{ id: "edited", type: "paragraph", text: "editor changes" }], base_updated: page.page.updated })).status).toBe(200);
    expect((await capture("interleaved", "middle", other)).status).toBe(200);
  } finally { release.resolve(); }
  expect((await pending).status).toBe(200);
  const blocks = sqlite.query("SELECT text FROM blocks ORDER BY ord").all() as any[];
  expect(blocks).toHaveLength(3);
  expect(blocks[0].text).toBe("editor changes");
  expect(blocks[1].text.endsWith("\nmiddle")).toBe(true);
  expect(blocks[2].text.endsWith("\nlast")).toBe(true);
}, 5000);

test("renaming an inbox keeps its identity and trashing it creates a visible inbox", async () => {
  const first = await capture("before-rename", "first");
  await call("/api/page/" + first.data.slug + "/rename", "POST", { title: "Renamed inbox" });
  expect((await capture("after-rename", "second")).data.slug).toBe(first.data.slug);
  expect((await call("/api/page/" + first.data.slug, "DELETE")).status).toBe(200);
  const next = await capture("after-trash", "third");
  expect(next.status).toBe(200);
  expect(next.data.slug).not.toBe(first.data.slug);
  const page = await (await call("/api/page/" + next.data.slug)).json() as any;
  expect(page.page.title).toBe("빠른 메모");
  expect(await capture("before-rename", "first")).toEqual(first);
});

test("anonymous capture is rejected by the existing cookie gate", async () => {
  const response = await worker.fetch(new Request("https://notes.test/api/quick-note", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: "anonymous", text: "private" }),
  }), env);
  expect(response.status).toBe(401);
  expect(sqlite.query("SELECT slug FROM pages").all()).toEqual([]);
});

test("malformed, missing, non-string, and empty inputs are rejected without writes", async () => {
  for (const body of [null, [], "text", {}, { text: "x" }, { clientId: "x" }, { clientId: "", text: "x" }, { clientId: "bad id", text: "x" }, { clientId: "x".repeat(129), text: "x" }, { clientId: 1, text: "x" }, { clientId: "x", text: 42 }, { clientId: "x", text: " \n\t " }]) {
    expect((await call("/api/quick-note", "POST", body)).status).toBe(400);
  }
  for (const body of ["{", "", "undefined"]) {
    const response = await worker.fetch(new Request("https://notes.test/api/quick-note", { method: "POST", headers: { cookie: auth }, body }), env);
    expect(response.status).toBe(400);
  }
  expect((await call("/api/quick-note")).status).toBe(405);
  expect(sqlite.query("SELECT slug FROM pages").all()).toEqual([]);
});

test("text and raw request limits reject oversize bodies and accept boundary text", async () => {
  expect((await capture("long", "x".repeat(10001))).status).toBe(413);
  expect((await capture("whitespace", " ".repeat(10000) + "x")).status).toBe(413);
  expect((await call("/api/quick-note", "POST", { clientId: "large", text: "ok", extra: "x".repeat(65536) })).status).toBe(413);
  expect(sqlite.query("SELECT slug FROM pages").all()).toEqual([]);
  expect((await capture("boundary", "한".repeat(10000))).status).toBe(200);
  expect((sqlite.query("SELECT text FROM blocks").get() as any).text.endsWith("\n" + "한".repeat(10000))).toBe(true);
});
