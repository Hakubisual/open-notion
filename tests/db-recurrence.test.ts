import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pgD1 } from "../gate/pg-d1";
import { setup } from "./db-harness";
import { nextRun, normaliseRecurrence, normaliseTemplate } from "../db-model.js";

const ROOT = join(import.meta.dir, "..");
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

test("nextRun: daily midnight in Seoul, month day 31 falls back to the last day, weekly Monday/Thursday", () => {
  expect(iso(nextRun({ freq: "day", hour: 0, minute: 0, tz: "Asia/Seoul" }, Date.parse("2026-10-20T15:30:00Z")))).toBe("2026-10-21T15:00:00.000Z");
  expect(iso(nextRun({ freq: "month", monthday: 31, hour: 0, tz: "Asia/Seoul" }, Date.parse("2026-10-31T00:00:00Z")))).toBe("2026-11-29T15:00:00.000Z");
  const weekly = { freq: "week", weekdays: [1, 4], hour: 9, tz: "Asia/Seoul" };
  expect(iso(nextRun(weekly, Date.parse("2026-10-20T00:00:00Z")))).toBe("2026-10-22T00:00:00.000Z");
  expect(iso(nextRun(weekly, Date.parse("2026-10-22T01:00:00Z")))).toBe("2026-10-26T00:00:00.000Z");
  // 뉴욕 서머타임이 끝나는 날에도 벽시계 07:00 을 지킨다.
  expect(iso(nextRun({ freq: "day", hour: 7, tz: "America/New_York" }, Date.parse("2026-11-01T05:00:00Z")))).toBe("2026-11-01T12:00:00.000Z");
  // 이틀마다: 저장한 날 기준.
  const anchor = Date.parse("2026-10-20T00:00:00Z");
  expect(iso(nextRun({ freq: "day", interval: 2, hour: 12, tz: "UTC", anchor }, Date.parse("2026-10-20T13:00:00Z")))).toBe("2026-10-22T12:00:00.000Z");
});

test("recurrence is normalised: unknown frequency means none, a bad time zone becomes Asia/Seoul, ranges clamp", () => {
  expect(normaliseRecurrence({ freq: "hourly" })).toBeNull();
  expect(normaliseRecurrence(null)).toBeNull();
  const rec = normaliseRecurrence({ freq: "week", weekdays: [9, 3, 3], hour: 30, minute: -1, tz: "Mars/Base", interval: 99 })!;
  expect([rec.tz, rec.weekdays, rec.hour, rec.minute, rec.interval]).toEqual(["Asia/Seoul", [3], 0, 0, 1]);
  expect(normaliseTemplate({ id: "t", name: "x" }, 0).recurrence).toBeNull();
});

async function pgCtx() {
  const lite = new PGlite();
  const strip = (sql: string) => sql.replace(/REVOKE[^;]*;/g, "").replace(/GRANT[^;]*;/g, "").replace(/DROP POLICY[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, "");
  for (const file of ["001-acard-schema.sql", "021-acard-db-recurrence.sql", "023-acard-db-relations.sql"]) await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase", file), "utf8")));
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

for (const backend of ["sqlite", "postgres"] as const) {
  test("a template's repeat setting saves, reads back with its next run, and turns off (" + backend + ")", async () => {
    const ctx = backend === "sqlite" ? setup() : await pgCtx();
    const db = (await ctx.call("POST", "/api/db", { title: "일기 " + backend })).data;
    const base = "/api/db/" + encodeURIComponent(db.slug);
    const made = (await ctx.call("POST", base + "/templates", { name: "오늘", props: {}, blocks: [] })).data.template;
    expect(made.recurrence).toBeNull();
    const before = Date.now();
    const saved = await ctx.call("PATCH", base + "/templates/" + encodeURIComponent(made.id), { recurrence: { freq: "day", hour: 7, minute: 0, tz: "Asia/Seoul" } });
    expect(saved.status).toBe(200);
    const rec = saved.data.template.recurrence;
    expect(rec.next_run).toBe(nextRun(rec, rec.anchor));
    expect(rec.next_run).toBeGreaterThan(before);
    expect(new Date(rec.next_run).getUTCHours()).toBe(22);
    const read = (await ctx.call("GET", base)).data.templates.find((t: any) => t.id === made.id);
    expect(read.recurrence).toEqual(rec);
    expect(read.name).toBe("오늘");
    const off = await ctx.call("PATCH", base + "/templates/" + encodeURIComponent(made.id), { recurrence: null });
    expect(off.data.template.recurrence).toBeNull();
    expect((await ctx.call("GET", base)).data.templates.find((t: any) => t.id === made.id).recurrence).toBeNull();
    expect((await ctx.call("PATCH", base + "/templates/nope", { recurrence: null })).status).toBe(404);
  });
}
