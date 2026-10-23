import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pgD1 } from "../gate/pg-d1";
import { setup } from "./db-harness";
import { displayValue, normaliseCellValue } from "../db-model.js";

const ROOT = join(import.meta.dir, "..");

async function pgCtx() {
  const lite = new PGlite();
  const strip = (sql: string) => sql.replace(/REVOKE[^;]*;/g, "").replace(/GRANT[^;]*;/g, "").replace(/DROP POLICY[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, "");
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/001-acard-schema.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/002-acard-search.sql"), "utf8")).replace(/CREATE EXTENSION[^;]*;/, "").replace(/CREATE INDEX IF NOT EXISTS page_fts_trgm[^;]*;/, ""));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/021-acard-db-recurrence.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/023-acard-db-relations.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/025-acard-db-value-backups.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/026-acard-db-template-savers.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/032-acard-db-button-savers.sql"), "utf8")));
  await lite.exec("SET search_path = acard");
  const query = (db: { query: PGlite["query"] }) => async (text: string, params: unknown[]) => {
    const r = await db.query<Record<string, unknown>>(text, params);
    return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
  };
  const ctx = setup();
  ctx.env.DB = pgD1({ query: query(lite), transaction: (fn) => lite.transaction((tx) => fn(query(tx))) });
  return ctx;
}

async function numbered(ctx: ReturnType<typeof setup>, label: string) {
  const created = (await ctx.call("POST", "/api/db", { title: "ID " + label })).data;
  const base = "/api/db/" + encodeURIComponent(created.slug);
  for (const name of ["하나", "둘", "셋"]) {
    const schema = (await ctx.call("GET", base)).data;
    const title = schema.properties.find((p: any) => p.type === "title");
    expect((await ctx.call("POST", base + "/rows", { props: { [title.id]: name } })).status).toBe(200);
  }
  const added = await ctx.call("POST", base + "/properties", { name: "번호", type: "unique_id", config: { prefix: "T-" } });
  expect(added.status).toBe(200);
  return { base, propId: added.data.property.id as string };
}

const ids = async (ctx: ReturnType<typeof setup>, base: string, propId: string) =>
  ((await ctx.call("GET", base)).data.rows as any[]).map((row) => row.props[propId]).sort((a: number, b: number) => a - b);

for (const backend of ["sqlite", "postgres"] as const) {
  test("ID property numbers existing rows 1..n, then new and concurrent rows get the next numbers (" + backend + ")", async () => {
    const ctx = backend === "sqlite" ? setup() : await pgCtx();
    const { base, propId } = await numbered(ctx, backend);
    expect(await ids(ctx, base, propId)).toEqual([1, 2, 3]);

    const one = await ctx.call("POST", base + "/rows", { props: {} });
    expect(one.data.row.props[propId]).toBe(4);

    const schema = (await ctx.call("GET", base)).data;
    const burst = await Promise.all([
      ...Array.from({ length: 10 }, () => ctx.call("POST", base + "/rows", { props: {} })),
      ctx.call("PATCH", base + "/properties/" + encodeURIComponent(propId), { name: "번호 2" }),
    ]);
    const given = burst.slice(0, 10).map((r) => r.data.row.props[propId]).sort((x: number, y: number) => x - y);
    expect(given).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

    // 이름을 바꾸고 접두어 config 를 다시 저장해도 카운터는 그대로다.
    await ctx.call("PATCH", base + "/properties/" + encodeURIComponent(propId), { config: { prefix: "X-" } });
    const after = await ctx.call("POST", base + "/rows", { props: {} });
    expect(after.data.row.props[propId]).toBe(15);

    // 사람·에이전트가 번호를 바꾸려 해도 무시된다.
    const rowId = one.data.row.id;
    expect((await ctx.call("PATCH", base + "/rows/" + encodeURIComponent(rowId), { props: { [propId]: 99 } })).status).toBe(200);
    expect(await ids(ctx, base, propId)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const prop = (await ctx.call("GET", base)).data.properties.find((p: any) => p.id === propId);
    expect(displayValue(prop, 4)).toBe("X-4");
    expect(schema.properties.length).toBeGreaterThan(1);
  });
}

// 두 요청의 카운터 문장을 한곳에 붙잡았다가 함께 놓아 준다. 원자적 발급이면 그래도 번호가 갈리고,
// "읽고 나서 쓰기"라면 두 요청이 같은 값을 읽어 번호가 겹친다.
function holdCounterCalls(db: any, parties: number) {
  let waiting: (() => void)[] = [];
  let armed = true;
  const gate = () => new Promise<void>((resolve) => {
    waiting.push(resolve);
    if (waiting.length >= parties) { armed = false; const go = waiting; waiting = []; go.forEach((fn) => fn()); }
  });
  const wrap = (stmt: any, sql: string): any => ({
    ...stmt,
    bind: (...p: unknown[]) => wrap(stmt.bind(...p), sql),
    first: async (...a: unknown[]) => { if (armed && /db_counters/.test(sql) && !/INSERT/.test(sql)) await gate(); return stmt.first(...a); },
  });
  // 테스트용 SQLite 는 BEGIN 을 겹쳐 열 수 없어 batch 만 차례로 보낸다(실제 D1·DO·Postgres 는 각자 처리한다).
  let line: Promise<unknown> = Promise.resolve();
  const batch = (list: any[]) => { const run = line.then(() => db.batch(list)); line = run.catch(() => undefined); return run; };
  return { ...db, prepare: (sql: string) => wrap(db.prepare(sql), sql), batch };
}

test("two rows created at the same moment never share an ID number", async () => {
  const ctx = setup();
  const { base, propId } = await numbered(ctx, "race");
  const plain = ctx.env.DB;
  ctx.env.DB = holdCounterCalls(plain, 2);
  const title = (await ctx.call("GET", base)).data.properties.find((p: any) => p.type === "title").id;
  const [a, b] = await Promise.all(["가", "나"].map((name) => ctx.call("POST", base + "/rows", { props: { [title]: name } })));
  ctx.env.DB = plain;
  expect([a.data.row.props[propId], b.data.row.props[propId]].sort()).toEqual([4, 5]);
});

test("two rows with the same title added at the same moment are both saved with their own pages", async () => {
  const ctx = setup();
  const { base, propId } = await numbered(ctx, "same");
  const plain = ctx.env.DB;
  ctx.env.DB = holdCounterCalls(plain, 2);
  const [a, b] = await Promise.all([ctx.call("POST", base + "/rows", { props: {} }), ctx.call("POST", base + "/rows", { props: {} })]);
  ctx.env.DB = plain;
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(a.data.row.page).not.toBe(b.data.row.page);
  expect([a.data.row.props[propId], b.data.row.props[propId]].sort()).toEqual([4, 5]);
});

test("deleting the ID property removes its counter, and a new ID property starts again at 1", async () => {
  const ctx = setup();
  const { base, propId } = await numbered(ctx, "del");
  expect((await ctx.call("DELETE", base + "/properties/" + encodeURIComponent(propId))).status).toBe(200);
  expect(ctx.sqlite.query("SELECT count(*) AS n FROM db_counters WHERE property_id = ?").get(propId)).toEqual({ n: 0 });
  const again = await ctx.call("POST", base + "/properties", { name: "번호", type: "unique_id" });
  expect(await ids(ctx, base, again.data.property.id)).toEqual([1, 2, 3]);
});

test("ID cell values are positive integers only", () => {
  const prop = { id: "p", name: "ID", type: "unique_id", config: { prefix: "" } };
  expect(normaliseCellValue(prop, 3)).toBe(3);
  expect(normaliseCellValue(prop, "x")).toBeNull();
  expect(normaliseCellValue(prop, -1)).toBeNull();
  expect(displayValue(prop, null)).toBe("");
});
