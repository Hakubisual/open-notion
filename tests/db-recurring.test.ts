import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pgD1 } from "../gate/pg-d1";
import { setup } from "./db-harness";

const ROOT = join(import.meta.dir, "..");
const HOUR = 3600000;

async function pgCtx() {
  const lite = new PGlite();
  const strip = (sql: string) => sql.replace(/REVOKE[^;]*;/g, "").replace(/GRANT[^;]*;/g, "").replace(/DROP POLICY[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, "");
  for (const file of ["001-acard-schema.sql", "021-acard-db-recurrence.sql", "023-acard-db-relations.sql", "025-acard-db-value-backups.sql", "026-acard-db-template-savers.sql", "032-acard-db-button-savers.sql"]) await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase", file), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/002-acard-search.sql"), "utf8")).replace(/CREATE EXTENSION[^;]*;/, "").replace(/CREATE INDEX IF NOT EXISTS page_fts_trgm[^;]*;/, ""));
  await lite.exec("SET search_path = acard");
  const query = (db: { query: PGlite["query"] }) => async (text: string, params: unknown[]) => {
    const r = await db.query<Record<string, unknown>>(text, params);
    return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
  };
  const ctx = setup();
  ctx.env.DB = pgD1({ query: query(lite), transaction: (fn) => lite.transaction((tx) => fn(query(tx))) });
  return ctx;
}

// 템플릿 하나(매일 07:00 KST, 제목 "일기 {{date}}", 본문 제목 2개 + ID 속성)와 그 next_run 을 만든다.
async function diary(ctx: ReturnType<typeof setup>) {
  const db = (await ctx.call("POST", "/api/db", { title: "감사 일기" })).data;
  const base = "/api/db/" + encodeURIComponent(db.slug);
  const schema = (await ctx.call("GET", base)).data;
  const title = schema.properties.find((p: any) => p.type === "title").id;
  const id = (await ctx.call("POST", base + "/properties", { name: "번호", type: "unique_id", config: { prefix: "D-" } })).data.property.id;
  const blocks = [{ id: "b1", type: "heading2", text: "감사 1" }, { id: "b2", type: "heading2", text: "감사 2" }];
  const tpl = (await ctx.call("POST", base + "/templates", { name: "오늘", props: { [title]: "일기 {{date}}" }, blocks })).data.template;
  const saved = (await ctx.call("PATCH", base + "/templates/" + encodeURIComponent(tpl.id), { recurrence: { freq: "day", hour: 7, minute: 0, tz: "Asia/Seoul" } })).data.template;
  return { base, tpl: saved, title, id };
}

const rowsOf = async (ctx: ReturnType<typeof setup>, base: string) => (await ctx.call("GET", base)).data.rows as any[];
const tick = (ctx: ReturnType<typeof setup>, now: number) => (ctx.worker as any).acardHost.recurringTick(ctx.env, now);

for (const backend of ["sqlite", "postgres"] as const) {
  test("(a)(b)(c) a due template makes one row, a repeat tick at the same time makes none, three missed days make one (" + backend + ")", async () => {
    const ctx = backend === "sqlite" ? setup() : await pgCtx();
    const { base, tpl, title, id } = await diary(ctx);
    const at = tpl.recurrence.next_run;
    expect((await tick(ctx, at - 1)).created).toEqual([]);
    const first = await tick(ctx, at + 1000);
    expect(first.created.length).toBe(1);
    expect(first.next).toBe(at + 24 * HOUR);
    let rows = await rowsOf(ctx, base);
    expect(rows.length).toBe(1);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(at);
    expect(rows[0].props[title]).toBe("일기 " + date);
    expect(rows[0].pageTitle).toBe("일기 " + date);
    expect(rows[0].props[id]).toBe(1);
    const page = (await ctx.call("GET", "/api/page/" + encodeURIComponent(rows[0].page))).data;
    expect((page.blocks || page.page?.blocks).map((b: any) => b.text)).toEqual(["감사 1", "감사 2"]);

    expect((await tick(ctx, at + 2000)).created).toEqual([]);
    expect((await rowsOf(ctx, base)).length).toBe(1);

    const later = at + 24 * HOUR + 3 * 24 * HOUR + 5 * 60000;
    const caught = await tick(ctx, later);
    expect(caught.created.length).toBe(1);
    expect(caught.created[0].occurrence).toBe(at + 4 * 24 * HOUR);
    expect(caught.next).toBe(at + 5 * 24 * HOUR);
    rows = await rowsOf(ctx, base);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.props[id]).sort()).toEqual([1, 2]);
  });
}

test("(d) a failure inside the batch after the row insert rolls everything back; the next tick makes that occurrence once", async () => {
  const ctx = setup();
  const { base, tpl } = await diary(ctx);
  const at = tpl.recurrence.next_run;
  const plain = ctx.env.DB;
  ctx.env.DB = { ...plain, prepare: plain.prepare, batch: async (list: any[]) => plain.batch([...list.slice(0, 3), { run: async () => { throw new Error("injected"); } }, ...list.slice(3)]) };
  await expect(tick(ctx, at + 1000)).rejects.toThrow("injected");
  ctx.env.DB = plain;
  expect((await rowsOf(ctx, base)).length).toBe(0);
  expect((await ctx.call("GET", base)).data.templates[0].recurrence.next_run).toBe(at);
  expect(ctx.sqlite.query("SELECT count(*) AS n FROM pages WHERE kind = 'db_row'").get()).toEqual({ n: 0 });
  expect((await tick(ctx, at + 2000)).created.length).toBe(1);
  expect((await rowsOf(ctx, base)).length).toBe(1);
});

test("(d2) two overlapping ticks for the same occurrence leave one row", async () => {
  const ctx = setup();
  const { base, tpl } = await diary(ctx);
  const at = tpl.recurrence.next_run;
  // 두 실행이 같은 템플릿을 읽은 뒤에야 batch 를 보낸다(첫 batch 가 끝나기 전에 둘째가 같은 회차를 계산).
  const plain = ctx.env.DB;
  let parked: (() => void)[] = [];
  const gate = () => new Promise<void>((go) => { parked.push(go); if (parked.length === 2) { parked.forEach((fn) => fn()); parked = []; } });
  let line: Promise<unknown> = Promise.resolve();
  ctx.env.DB = { ...plain, prepare: plain.prepare, batch: async (list: any[]) => {
    if (list.some((s: any) => s && s.__sql && /db_template_runs/.test(s.__sql))) await gate();
    const run = line.then(() => plain.batch(list)); line = run.catch(() => undefined); return run;
  } };
  const tag = plain.prepare;
  ctx.env.DB.prepare = (sql: string) => { const s = tag(sql); const wrap = (st: any): any => ({ ...st, __sql: sql, bind: (...p: unknown[]) => wrap(st.bind(...p)) }); return wrap(s); };
  const [a, b] = await Promise.all([tick(ctx, at + 1000), tick(ctx, at + 1000)]);
  ctx.env.DB = plain;
  expect(a.created.length + b.created.length).toBe(2);
  expect((await rowsOf(ctx, base)).length).toBe(1);
  expect(ctx.sqlite.query("SELECT count(*) AS n FROM db_template_runs").get()).toEqual({ n: 1 });
});

test("templates without a repeat and turned-off repeats never make rows", async () => {
  const ctx = setup();
  const { base, tpl } = await diary(ctx);
  await ctx.call("PATCH", base + "/templates/" + encodeURIComponent(tpl.id), { recurrence: null });
  const out = await tick(ctx, tpl.recurrence.next_run + 10 * 24 * HOUR);
  expect(out).toEqual({ created: [], next: null });
  expect((await rowsOf(ctx, base)).length).toBe(0);
});
