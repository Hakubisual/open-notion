import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cookie, setup } from "./db-harness";
import { buildFixture } from "./fixtures/import-fixtures.ts";

let h: ReturnType<typeof setup>;
beforeEach(async () => { h = setup(); await h.call("GET", "/api/tree"); });
afterEach(() => h.sqlite.close());

async function post(path: string, body: unknown, query = "") {
  const res = await h.worker.fetch(new Request("https://notes.test" + path + query, { method: "POST", headers: { cookie: await cookie(), "content-type": "application/json" }, body: JSON.stringify(body) }), h.env);
  return { status: res.status, data: await res.json().catch(() => null) as any };
}

const tree = async () => (await h.call("GET", "/api/tree")).data.pages.map((p: any) => p.slug) as string[];
const count = (table: string) => Number((h.sqlite.query("SELECT COUNT(*) AS n FROM " + table).get() as any).n);

const plan = {
  format: "notion-md",
  name: "test",
  sources: [
    { key: "Home.md", source: "notion:aaaa", kind: "page", title: "Home" },
    { key: "Home/Child.md", source: "notion:bbbb", kind: "page", title: "Child" },
    { key: "Home/Tasks.csv", source: "notion:cccc", kind: "db", title: "Tasks" },
    { key: "Home/Tasks/Row A.md", source: "notion:dddd", kind: "row", title: "Row A" },
  ],
};

function chunk(map: any) {
  return {
    map,
    pages: [
      { key: "Home.md", title: "Home", parent: null, kind: "note", tags: ["work"], blocks: [{ id: "b1", type: "paragraph", text: "see Child", meta: { richText: [{ text: "see " }, { text: "Child", href: "imp-page:Home/Child.md" }] } }] },
      { key: "Home/Child.md", title: "Child", parent: "Home.md", kind: "note", blocks: [{ id: "c1", type: "paragraph", text: "<script>alert(1)</script>hi" }] },
      { key: "Home/Tasks/Row A.md", title: "Row A", parent: "Home/Tasks.csv", kind: "db_row", blocks: [] },
    ],
    databases: [{ key: "Home/Tasks.csv", title: "Tasks", parent: "Home.md", properties: [{ id: "title", name: "Name", type: "title" }, { id: "p1", name: "Done", type: "checkbox" }] }],
    rows: [{ database: "Home/Tasks.csv", page: "Home/Tasks/Row A.md", index: 1, values: { title: "Row A", p1: true } }],
  };
}

async function runBatch(query = "") {
  const created = await post("/api/import/batches", plan, query);
  if (created.status !== 200) return { created };
  const id = created.data.id;
  const written = await post("/api/import/batches/" + id + "/chunk", chunk(created.data.map));
  const finished = await post("/api/import/batches/" + id + "/finish", { report: { counts: { pages: 3 } } });
  return { created, id, written, finished };
}

describe("import batches", () => {
  test("create -> chunk -> finish writes pages, database, row, links and tags, hidden until finish", async () => {
    const created = await post("/api/import/batches", plan);
    expect(created.status).toBe(200);
    const map = created.data.map;
    expect(Object.keys(map).sort()).toEqual(plan.sources.map((s) => s.key).sort());
    const written = await post("/api/import/batches/" + created.data.id + "/chunk", chunk(map));
    expect(written.status).toBe(200);
    // Hidden while importing: not in the tree, page answers like a deleted page.
    expect(await tree()).not.toContain(map["Home.md"].slug);
    expect((await h.call("GET", "/api/page/" + map["Home.md"].slug)).status).toBe(404);
    const finished = await post("/api/import/batches/" + created.data.id + "/finish", {});
    expect(finished.status).toBe(200);
    const slugs = await tree();
    expect(slugs).toContain(map["Home.md"].slug);
    expect(slugs).toContain(map["Home/Child.md"].slug);
    const home = (await h.call("GET", "/api/page/" + map["Home.md"].slug)).data;
    expect(JSON.stringify(home.blocks)).toContain("/" + map["Home/Child.md"].slug + "/");
    expect(JSON.stringify(home.blocks)).not.toContain("imp-page:");
    const child = (await h.call("GET", "/api/page/" + map["Home/Child.md"].slug)).data;
    expect(JSON.stringify(child.blocks)).not.toContain("<script");
    const dbRow = h.sqlite.query("SELECT props FROM db_rows WHERE database_id = ?").get(map["Home/Tasks.csv"].id) as any;
    expect(Object.values(JSON.parse(dbRow.props))).toContain(true);
    expect(count("page_tags")).toBe(1);
    expect(Number((h.sqlite.query("SELECT COUNT(*) AS n FROM editor_trash").get() as any).n)).toBe(0);
  });

  test("the same export again asks first; skip writes nothing new and copy writes a full new set", async () => {
    const first = await runBatch();
    expect(first.finished!.status).toBe(200);
    const pagesBefore = count("pages");
    const again = await post("/api/import/batches", plan);
    expect(again.status).toBe(409);
    expect(again.data).toMatchObject({ code: "conflict", duplicates: 4 });
    const skip = await runBatch("?duplicates=skip");
    expect(skip.created.status).toBe(200);
    expect(count("pages")).toBe(pagesBefore);
    const copy = await runBatch("?duplicates=copy");
    expect(copy.created.status).toBe(200);
    expect(count("pages")).toBeGreaterThan(pagesBefore);
  });

  test("undo moves every page of the import to the trash, so a re-import is no longer a duplicate", async () => {
    const done = await runBatch();
    const undo = await post("/api/import/batches/" + done.id + "/undo", {});
    expect(undo.status).toBe(200);
    expect(undo.data.trashed).toBe(4);
    const slugs = await tree();
    for (const ref of Object.values(done.created.data.map) as any[]) expect(slugs).not.toContain(ref.slug);
    expect((await post("/api/import/batches", plan)).status).toBe(200);
  });

  test("abort and the 30-minute sweep leave no row behind", async () => {
    const before = Object.fromEntries(["pages", "blocks", "databases", "db_rows", "db_properties", "editor_trash", "page_imports", "media"].map((t) => [t, count(t)]));
    const created = await post("/api/import/batches", plan);
    await post("/api/import/batches/" + created.data.id + "/chunk", chunk(created.data.map));
    const aborted = await post("/api/import/batches/" + created.data.id + "/abort", {});
    expect(aborted.status).toBe(200);
    const after = Object.fromEntries(Object.keys(before).map((t) => [t, count(t)]));
    expect(after).toEqual(before);
    const stale = await post("/api/import/batches", plan);
    await post("/api/import/batches/" + stale.data.id + "/chunk", chunk(stale.data.map));
    h.sqlite.query("UPDATE import_batches SET updated = 0 WHERE id = ?").run(stale.data.id);
    await post("/api/import/batches", { format: "notion-md", name: "x", sources: [{ key: "x.md", source: "notion:x", kind: "page", title: "x" }] });
    expect(count("databases")).toBe(before.databases);
    expect((h.sqlite.query("SELECT status FROM import_batches WHERE id = ?").get(stale.data.id) as any).status).toBe("aborted");
  });

  test("a finished import cannot be aborted; it goes back only through undo, into the trash", async () => {
    const { id, finished } = await runBatch();
    expect(finished.status).toBe(200);
    const pages = count("pages");
    const aborted = await post("/api/import/batches/" + id + "/abort", {});
    expect(aborted.status).toBe(409);
    expect(count("pages")).toBe(pages);
    expect((h.sqlite.query("SELECT status FROM import_batches WHERE id = ?").get(id) as any).status).toBe("done");
  });

  test("a chunk uses a fixed number of write statements however many pages it holds", async () => {
    const many = { format: "markdown", name: "many", sources: Array.from({ length: 300 }, (_, i) => ({ key: "p" + i + ".md", source: "md:p" + i, kind: "page", title: "Page " + i })) };
    const created = await post("/api/import/batches", many);
    const pages = many.sources.map((s, i) => ({ key: s.key, title: s.title, parent: i ? "p0.md" : null, kind: "note", tags: ["t" + (i % 3)], blocks: [{ id: "a", type: "paragraph", text: "x " + i }, { id: "b", type: "to_do", text: "y" }] }));
    const res = await post("/api/import/batches/" + created.data.id + "/chunk", { map: created.data.map, pages, databases: [], rows: [] });
    expect(res.status).toBe(200);
    expect(res.data.pages).toBe(300);
    expect(res.data.statements).toBeLessThanOrEqual(15);
  });

  test("a guest of a shared page cannot use any import route", async () => {
    const guestDb: any = Object.assign(Object.create(h.env.DB), { acardRoles: new Map() });
    const env = { ...h.env, DB: guestDb };
    const res = await h.worker.fetch(new Request("https://notes.test/api/import/batches", { method: "POST", headers: { cookie: await cookie(), "content-type": "application/json" }, body: JSON.stringify(plan) }), env);
    expect([401, 403]).toContain(res.status);
  });
});

test("2,000 pages on a workspace that never searched: 7 chunks + finish + first search stay far under the daily write quota", async () => {
  let writes = 0;
  const real = h.env.DB;
  h.env.DB = new Proxy(real, { get(target: any, key) {
    if (key === "prepare") return (sqlText: string) => { const st = target.prepare(sqlText); return new Proxy(st, { get: (o: any, k) => (k === "bind" ? (...args: unknown[]) => { const bound = o.bind(...args); bound.__sql = sqlText; return bound; } : k === "run" ? async () => { if (/^\s*(insert|update|delete)\b/i.test(sqlText)) writes += 1; return o.run(); } : o[k]) }); };
    if (key === "batch") return async (list: any[]) => { writes += list.filter((st) => /^\s*(insert|update|delete)\b/i.test(st.__sql || "")).length; return target.batch(list); };
    const v = target[key]; return typeof v === "function" ? v.bind(target) : v;
  } });
  const many = { format: "markdown", name: "big", sources: Array.from({ length: 2000 }, (_, i) => ({ key: "z" + i + ".md", source: "md:z" + i, kind: "page", title: "Big " + i })) };
  const created = await post("/api/import/batches", many);
  for (let c = 0; c < 2000; c += 300) {
    const pages = many.sources.slice(c, c + 300).map((src, i) => ({ key: src.key, title: src.title, parent: null, kind: "note", blocks: [{ id: "a", type: "paragraph", text: "okapi " + (c + i) }] }));
    expect((await post("/api/import/batches/" + created.data.id + "/chunk", { map: created.data.map, pages })).status).toBe(200);
  }
  expect((await post("/api/import/batches/" + created.data.id + "/finish", {})).status).toBe(200);
  expect((await h.call("GET", "/api/search?q=okapi")).data.results.length).toBeGreaterThan(0);
  h.env.DB = real;
  expect(writes).toBeLessThan(200);
}, 60000);

test("300 pages: chunk + finish + the first search stay within the member store limits (writes, bound parameters)", async () => {
  const seen = { writes: 0, maxParams: 0 };
  const real = h.env.DB;
  const wrap = (stmt: any, sqlText: string) => ({
    ...stmt,
    bind: (...args: unknown[]) => { seen.maxParams = Math.max(seen.maxParams, args.length); return wrapBound(stmt.bind(...args), sqlText); },
  });
  const wrapBound = (bound: any, sqlText: string) => new Proxy(bound, { get: (o, k) => (k === "__sql" ? sqlText : (o as any)[k]) });
  h.env.DB = new Proxy(real, {
    get(target: any, key) {
      if (key === "prepare") return (sqlText: string) => { const st = target.prepare(sqlText); return new Proxy(st, { get: (o: any, k) => (k === "bind" ? (...args: unknown[]) => { seen.maxParams = Math.max(seen.maxParams, args.length); const b = o.bind(...args); b.__sql = sqlText; return b; } : k === "__sql" ? sqlText : o[k]) }); };
      if (key === "batch") return async (list: any[]) => { for (const st of list) if (/^\s*(insert|update|delete|replace)\b/i.test(st.__sql || "")) seen.writes += 1; return target.batch(list); };
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const many = { format: "markdown", name: "many", sources: Array.from({ length: 300 }, (_, i) => ({ key: "q" + i + ".md", source: "md:q" + i, kind: "page", title: "Note " + i })) };
  const created = await post("/api/import/batches", many);
  const pages = many.sources.map((src, i) => ({ key: src.key, title: src.title, parent: null, kind: "note", blocks: [{ id: "a", type: "paragraph", text: "zebrafinch " + i }] }));
  expect((await post("/api/import/batches/" + created.data.id + "/chunk", { map: created.data.map, pages })).status).toBe(200);
  expect((await post("/api/import/batches/" + created.data.id + "/finish", {})).status).toBe(200);
  const found = await h.call("GET", "/api/search?q=zebrafinch");
  h.env.DB = real;
  expect(found.data.results.length).toBeGreaterThan(0);
  expect(seen.maxParams).toBeLessThanOrEqual(100);
  expect(seen.writes).toBeLessThanOrEqual(25);
});

test("a 20,000-row Notion table (E7) comes in whole: rows travel in their own chunks, not under the page cap", async () => {
  const fixture = await buildFixture("E7");
  const res = await h.worker.fetch(new Request("https://notes.test/api/import", { method: "POST", headers: { cookie: await cookie(), "content-type": "application/zip" }, body: fixture.zip }), h.env);
  const body = (await res.json()) as any;
  expect(res.status).toBe(200);
  expect(body.counts.dbRows).toBe(20_000);
  expect(count("db_rows")).toBe(20_000);
  const last = h.sqlite.query("SELECT props FROM db_rows ORDER BY ord DESC LIMIT 1").get() as any;
  expect(Object.values(JSON.parse(last.props))).toContain("Row 20000");
}, 60_000);

test("more rows than one table may hold is refused with limit-rows before anything is written", async () => {
  const sources = [{ key: "T.csv", source: "notion:t", kind: "db", title: "T" }, ...Array.from({ length: 20_001 }, (_, i) => ({ key: "T/r" + i + ".md", source: "notion:r" + i, kind: "row", title: "r" + i }))];
  const r = await post("/api/import/batches", { format: "notion-md", name: "big", sources });
  expect(r.status).toBe(413);
  expect(r.data.code).toBe("limit-rows");
  expect(count("import_batches")).toBe(0);
});

test("a file part with no type (what Workers gives a zip entry) is stored by its name: a .pdf becomes a PDF file", async () => {
  const kv = new Map<string, ArrayBuffer>();
  h.env.MEDIA = { put: async (k: string, v: ArrayBuffer) => { kv.set(k, v); }, get: async (k: string) => kv.get(k) ?? null, getWithMetadata: async (k: string) => ({ value: kv.get(k) ?? null, metadata: null }), delete: async (k: string) => { kv.delete(k); } };
  const created = await post("/api/import/batches", { format: "notion-md", name: "pdf", sources: [{ key: "A.md", source: "notion:pdfa", kind: "page", title: "A" }] });
  const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  // Bun guesses a type from the file name; the Workers runtime does not, so the part reaches the handler as application/octet-stream.
  const typeless = Object.defineProperty(new File([bytes], "brief.pdf"), "type", { value: "application/octet-stream" });
  const form = new FormData();
  form.append("key", "A/brief.pdf");
  const request = new Request("https://notes.test/api/import/batches/" + created.data.id + "/files", { method: "POST", headers: { cookie: await cookie() }, body: "x" });
  Object.defineProperty(request, "formData", { value: async () => ({ get: (name: string) => (name === "file" ? typeless : form.get(name)) }) });
  const res = await h.worker.fetch(request, h.env);
  const body = (await res.json()) as any;
  expect([res.status, body.code]).toEqual([200, undefined]);
  expect(h.sqlite.query("SELECT mime FROM media WHERE name = 'brief.pdf'").get()).toEqual({ mime: "application/pdf" });
});

test("creating a 2,000-page batch reads the store in batches, not once per page", async () => {
  await h.call("POST", "/api/pages", { title: "Big 7" });
  let reads = 0;
  const real = h.env.DB;
  h.env.DB = new Proxy(real, { get(target: any, key) {
    if (key === "prepare") return (sqlText: string) => { if (/^\s*select/i.test(sqlText)) reads += 1; return target.prepare(sqlText); };
    const v = target[key]; return typeof v === "function" ? v.bind(target) : v;
  } });
  const many = { format: "markdown", name: "big", sources: Array.from({ length: 2000 }, (_, i) => ({ key: "z" + i + ".md", source: "md:z" + i, kind: "page", title: "Big " + i })) };
  const created = await post("/api/import/batches", many);
  h.env.DB = real;
  expect(created.status).toBe(200);
  const slugs = Object.values(created.data.map).map((r: any) => r.slug);
  expect(new Set(slugs).size).toBe(2000);
  expect(slugs).not.toContain((await tree()).find((s) => s.startsWith("big-7")));
  expect(reads).toBeLessThan(60);
}, 60000);
