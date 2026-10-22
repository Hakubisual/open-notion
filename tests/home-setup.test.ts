import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { assembleWorkerSource } from "./assemble-worker";
import { workspaceToZip } from "../notion-export";

const source = assembleWorkerSource();
let sqlite: Database, worker: any, env: any, cookie: string;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...values: any[]) => statement(sql, values),
    execute: () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = {
    GATE_PASSWORD: "home-pw", GATE_SECRET: "home-secret",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    DB: { prepare: statement, batch: async (statements: ReturnType<typeof statement>[]) => sqlite.transaction(() => statements.map((item) => item.execute()))() },
  };
  worker = new Function(source)();
  const login = await worker.fetch(new Request("https://notes.test/__gate", { method: "POST", body: new URLSearchParams({ pw: "home-pw" }) }), env);
  cookie = login.headers.get("set-cookie").split(";")[0];
});
afterEach(() => sqlite.close());

const call = (path: string, method = "GET", body?: unknown) => worker.fetch(new Request("https://notes.test/api" + path, {
  method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
}), env) as Promise<Response>;

test("starter presets build a status board, draft blog and pinned notes once, even under concurrent retries", async () => {
  const runs = await Promise.all([1, 2, 3].map(() => call("/home/starter", "POST", { presets: ["board", "blog", "notes", "bogus"] })));
  expect(runs.every((r) => r.status === 200)).toBe(true);
  const created = (await Promise.all(runs.map((r) => r.json()))).flatMap((b: any) => b.results.filter((x: any) => x.created).map((x: any) => x.key));
  expect(created.sort()).toEqual(["blog", "board", "notes"]);
  expect((sqlite.query("SELECT COUNT(*) AS n FROM databases").get() as any).n).toBe(2);

  const summary: any = await (await call("/home/summary")).json();
  expect(summary.board.columns.map((c: any) => c.name)).toEqual(["할 일", "진행 중", "완료"]);
  expect(summary.board.rows.length).toBe(7);
  expect(summary.board.rows.filter((r: any) => r.status === "doing").length).toBe(2);
  expect(summary.blog.rows.every((r: any) => r.status === "draft")).toBe(true);
  expect(summary.pinned.map((p: any) => p.slug)).toContain(summary.notes.slug);
  expect(summary.sessions).toEqual([]);
  expect((sqlite.query("SELECT COUNT(*) AS n FROM share_links").get() as any)?.n ?? 0).toBe(0);
});

test("a deleted starter disappears from the summary and is not rebuilt", async () => {
  await call("/home/starter", "POST", { presets: ["board"] });
  const { board } = await (await call("/home/summary")).json() as any;
  sqlite.query("INSERT INTO editor_trash (page, deleted) VALUES (?, ?)").run(board.slug, Date.now());
  expect((await (await call("/home/summary")).json() as any).board).toBeNull();
  const again: any = await (await call("/home/starter", "POST", { presets: ["board"] })).json();
  expect(again.results[0].created).toBe(false);
});

test("checklist excludes home, seeded pages, starter presets, examples, imports and trashed pages from first authored page", async () => {
  await call("/home/starter", "POST", { presets: ["board", "blog", "notes"] });
  const insert = sqlite.query("INSERT INTO pages (slug,title,kind,source,updated) VALUES (?,?,?,?,?)");
  insert.run("index", "Home", "note", "editor", 1);
  insert.run("seed", "Seed", "note", "markdown", 2);
  insert.run("example", "Example", "note", "editor", 3);
  insert.run("folder", "Folder", "folder", "editor", 4);
  sqlite.query("INSERT INTO feature_templates_state (key,value) VALUES ('examples',?)").run(JSON.stringify([{ slug: "example" }]));
  const form = new FormData();
  form.append("file", new File(["# Imported"], "imported.md"));
  const imported = await worker.fetch(new Request("https://notes.test/api/import/md", { method: "POST", headers: { cookie }, body: form }), env);
  expect(imported.status).toBe(200);
  let checklist = (await (await call("/home/summary")).json() as any).checklist;
  expect(checklist).toMatchObject({ page: false, agent: false, import: true, share: false });
  const made: any = await (await call("/pages", "POST", { title: "My first page", slug: "my-page" })).json();
  checklist = (await (await call("/home/summary")).json() as any).checklist;
  expect(checklist.page).toBe(true);
  expect(checklist.shareSlug).toBe(made.slug);
  sqlite.query("INSERT INTO editor_trash (page,deleted) VALUES (?,?)").run(made.slug, Date.now());
  expect((await (await call("/home/summary")).json() as any).checklist.page).toBe(false);
});

test("checklist uses first-run connection and durable import and link/publish receipts", async () => {
  await call("/home/summary");
  for (const state of ["waiting_connect", "connected", "project_set", "dismissed"]) {
    sqlite.query("INSERT INTO first_run (id,state,updated) VALUES (1,?,1) ON CONFLICT(id) DO UPDATE SET state=excluded.state").run(state);
    expect((await (await call("/home/summary")).json() as any).checklist.agent).toBe(["connected", "project_set"].includes(state));
  }
  for (const principal of ["link", "publish"]) {
    sqlite.query("DELETE FROM share_rules").run();
    sqlite.query("INSERT INTO share_rules (id,page,principal,role,created) VALUES ('r','index',?,'read',1)").run(principal);
    expect((await (await call("/home/summary")).json() as any).checklist.share).toBe(true);
  }
  sqlite.query("INSERT INTO page_imports (page,kind,created) VALUES ('old-import','zip',1)").run();
  expect((await (await call("/home/summary")).json() as any).checklist.import).toBe(true);
});

test("ZIP imports complete import without counting as a first authored page, even after editing", async () => {
  const zip = new Uint8Array(workspaceToZip([{ slug: "zip-note", title: "ZIP note", blocks: [{ id: "b1", type: "paragraph", text: "Imported text" }] }]));
  const response = await worker.fetch(new Request("https://notes.test/api/import", { method: "POST", headers: { cookie, "content-type": "application/zip" }, body: zip }), env);
  expect(response.status).toBe(200);
  const result: any = await response.json();
  const slug = result.pages[0].slug;
  const page: any = await (await call("/page/" + encodeURIComponent(slug))).json();
  const saved = await call("/page/" + encodeURIComponent(slug), "PUT", { base_updated: page.page.updated, blocks: [{ id: "b1", type: "paragraph", text: "Edited import" }] });
  expect(saved.status).toBe(200);
  expect((await (await call("/home/summary")).json() as any).checklist).toMatchObject({ page: false, import: true });
});
