import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { pgD1, type PgDriver } from "../gate/pg-d1";
import { setup } from "./db-harness";

// Real overlapping transactions on PostgreSQL: session 1 stops right after its pair lock and session 2 starts the same
// pair's batch; pg_locks shows session 2 waiting until session 1 commits. Needs a server: ACARD_PG_TEST_URL=postgres://...
const URL = process.env.ACARD_PG_TEST_URL;
if (!URL) console.log("pg-concurrency: ACARD_PG_TEST_URL is not set, skipping the real PostgreSQL overlap tests");

const ROOT = join(import.meta.dir, "..");
const SCHEMA = "np5_pg_" + Date.now().toString(36);
const LOCK = /^\s*UPDATE db_relation_locks SET version/i;
const ACARD_SCHEMA_FILES = ["001-acard-schema.sql", "002-acard-search.sql", "004-acard-agent.sql", "005-acard-journal.sql", "006-acard-folders.sql", "007-acard-chat-agent.sql", "013-acard-projects.sql", "015-acard-organize.sql", "017-acard-parts.sql", "018-acard-part-themes.sql", "019-acard-page-view.sql", "021-acard-db-recurrence.sql", "023-acard-db-relations.sql"];

type Gate = { armed: boolean; reached: Promise<void>; released: Promise<void>; hit: () => void; release: () => void };
function gate(): Gate {
  const g = { armed: false } as Gate;
  g.reached = new Promise<void>((done) => { g.hit = done; });
  g.released = new Promise<void>((done) => { g.release = done; });
  return g;
}

let admin: ReturnType<typeof postgres>;
const sessions: ReturnType<typeof postgres>[] = [];

function session(g?: Gate) {
  const sql = postgres(URL!, { max: 1, prepare: false, onnotice: () => {}, connection: { search_path: SCHEMA } });
  sessions.push(sql);
  const run = (s: any) => async (text: string, params: unknown[]) => {
    const r = await s.unsafe(text, params as any[]);
    if (g && g.armed && LOCK.test(text)) { g.armed = false; g.hit(); await g.released; }
    return { rows: [...r], count: r.count ?? r.length };
  };
  const driver: PgDriver = { query: run(sql), transaction: (fn) => sql.begin((tx) => fn(run(tx))) as any };
  const pid = async () => Number((await sql`select pg_backend_pid() as p`)[0].p);
  return { driver, pid };
}

function worker(driver: PgDriver) {
  const ctx = setup();
  ctx.env.DB = pgD1(driver);
  const call = ctx.call;
  ctx.call = async (method: string, path: string, body?: unknown) => {
    const r = await call(method, path, body);
    if (method === "POST" && r.status !== 200) throw new Error(method + " " + path + " -> " + r.status + " " + JSON.stringify(r.data));
    return r;
  };
  return ctx;
}

async function waitingOn(pid: number) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await admin`select count(*)::int as n from pg_locks where pid = ${pid} and not granted`;
    if (r[0].n > 0) return true;
  }
  return false;
}

describe.skipIf(!URL)("pg concurrency: two-way relation batches on a real PostgreSQL", () => {
  beforeAll(async () => {
    admin = postgres(URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe("CREATE SCHEMA " + SCHEMA);
    for (const file of ACARD_SCHEMA_FILES) {
      const text = readFileSync(join(ROOT, "migrations/supabase", file), "utf8")
        .replace(/CREATE SCHEMA IF NOT EXISTS acard;/g, "")
        .replace(/search_path = acard\b/g, "search_path = " + SCHEMA)
        .replace(/\bacard\./g, SCHEMA + ".")
        .replace(/CREATE EXTENSION[^;]*;/g, "").replace(/CREATE INDEX IF NOT EXISTS page_fts_trgm[^;]*;/g, "")
        .replace(/REVOKE[^;]*;|GRANT[^;]*;|ALTER TABLE \w+ ENABLE ROW LEVEL SECURITY;|DROP POLICY[^;]*;|CREATE POLICY[^;]*;/g, "");
      await admin.unsafe(text);
    }
  });
  afterAll(async () => {
    for (const s of sessions) await s.end({ timeout: 1 });
    if (admin) { await admin.unsafe("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE"); await admin.end({ timeout: 1 }); }
  });

  async function overlap(first: (ctx: any) => Promise<any>, second: (ctx: any) => Promise<any>) {
    const g = gate();
    const one = session(g), two = session();
    const c1 = worker(one.driver), c2 = worker(two.driver);
    g.armed = true;
    const p1 = first(c1);
    await g.reached;
    const pid2 = await two.pid();
    const p2 = second(c2);
    const waited = await waitingOn(pid2);
    g.release();
    return { waited, results: await Promise.all([p1, p2]) };
  }

  test("(i) A1->B and A2->B at once: B's value holds both", async () => {
    const ctx = worker(session().driver);
    const a = (await ctx.call("POST", "/api/db", { title: "여행 i" })).data, b = (await ctx.call("POST", "/api/db", { title: "일정 i" })).data;
    const rel = (await ctx.call("POST", "/api/db/" + a.slug + "/properties", { name: "일정", type: "relation", config: { database: b.slug, synced: true } })).data;
    const b1 = (await ctx.call("POST", "/api/db/" + b.slug + "/rows", { props: {} })).data.row;
    const a1 = (await ctx.call("POST", "/api/db/" + a.slug + "/rows", { props: {} })).data.row;
    const a2 = (await ctx.call("POST", "/api/db/" + a.slug + "/rows", { props: {} })).data.row;
    const { waited, results } = await overlap(
      (c) => c.call("PATCH", "/api/db/" + a.slug + "/rows/" + a1.id, { props: { [rel.property.id]: [b1.id] } }),
      (c) => c.call("PATCH", "/api/db/" + a.slug + "/rows/" + a2.id, { props: { [rel.property.id]: [b1.id] } }),
    );
    expect(waited).toBe(true);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const value = (await ctx.call("GET", "/api/db/" + b.slug)).data.rows.find((r: any) => r.id === b1.id).props[rel.pair.id];
    expect(value.sort()).toEqual([a1.id, a2.id].sort());
  });

  async function tree() {
    const ctx = worker(session().driver);
    const d = (await ctx.call("POST", "/api/db", { title: "할 일 " + Math.random().toString(36).slice(2, 6) })).data;
    const made = (await ctx.call("POST", "/api/db/" + d.slug + "/properties", { name: "상위 항목", type: "relation", config: { database: d.slug, synced: true, limit: 1 }, pairName: "하위 항목" })).data;
    const row = async () => (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: {} })).data.row;
    const read = async (id: string) => (await ctx.call("GET", "/api/db/" + d.slug)).data.rows.find((r: any) => r.id === id);
    return { ctx, d, P: made.property.id as string, C: made.pair.id as string, row, read };
  }

  test("(ii) child C given to P and to Q at once: exactly one parent, the other's list has no C", async () => {
    const t = await tree();
    const p = await t.row(), q = await t.row(), c = await t.row();
    const { waited, results } = await overlap(
      (x) => x.call("PATCH", "/api/db/" + t.d.slug + "/rows/" + p.id, { props: { [t.C]: [c.id] } }),
      (x) => x.call("PATCH", "/api/db/" + t.d.slug + "/rows/" + q.id, { props: { [t.C]: [c.id] } }),
    );
    expect(waited).toBe(true);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const parents = (await t.read(c.id)).props[t.P];
    expect(parents).toEqual([q.id]);
    expect((await t.read(p.id)).props[t.C]).toEqual([]);
    expect((await t.read(q.id)).props[t.C]).toEqual([c.id]);
  });

  test("(iii) A under B and B under A at once: one succeeds, the other is refused as a loop", async () => {
    const t = await tree();
    const a = await t.row(), b = await t.row();
    const { waited, results } = await overlap(
      (x) => x.call("PATCH", "/api/db/" + t.d.slug + "/rows/" + a.id, { props: { [t.P]: [b.id] } }),
      (x) => x.call("PATCH", "/api/db/" + t.d.slug + "/rows/" + b.id, { props: { [t.P]: [a.id] } }),
    );
    expect(waited).toBe(true);
    expect(results.map((r) => r.status)).toEqual([200, 400]);
    expect((await t.read(a.id)).props[t.P]).toEqual([b.id]);
    expect((await t.read(b.id)).props[t.P]).toEqual([]);
  });
});
