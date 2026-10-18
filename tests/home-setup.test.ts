import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { assembleWorkerSource } from "./assemble-worker";

const source = assembleWorkerSource();
let sqlite: Database, worker: any, env: any, cookie: string;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...values: any[]) => statement(sql, values),
    execute: () => sqlite.query(sql).run(...params),
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
