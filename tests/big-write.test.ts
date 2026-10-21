import { Database } from "bun:sqlite";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { pgD1 } from "../gate/pg-d1";
import { assembleWorkerSource } from "./assemble-worker";

// acard-write-timeout: an agent writing a long document (40-200 KB, ~850-4000 blocks) timed out because every block was
// its own INSERT round trip (~140 ms on Postgres through Hyperdrive), a retry made a second page, and a write that died
// midway left an empty page behind.
const ROOT = join(import.meta.dir, "..");
const WORKER_SOURCE = assembleWorkerSource();

function longMarkdown(sections: number) {
  const out: string[] = [];
  for (let i = 0; i < sections; i++) {
    out.push("## 섹션 " + i, "", "문단 " + i + " 내용이에요.", "", "- 항목 " + i, "- [ ] 할 일 " + i, "", "| a | b |", "| --- | --- |", "| " + i + " | x |", "", "```ts", "const v" + i + " = " + i + ";", "```", "");
  }
  return out.join("\n");
}

let lite: PGlite;
beforeAll(async () => {
  lite = new PGlite();
  const strip = (sql: string) => sql.replace(/REVOKE[^;]*;/g, "").replace(/GRANT[^;]*;/g, "").replace(/DROP POLICY[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, "");
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/001-acard-schema.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/002-acard-search.sql"), "utf8")).replace(/CREATE EXTENSION[^;]*;/, "").replace(/CREATE INDEX IF NOT EXISTS page_fts_trgm[^;]*;/, ""));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/004-acard-agent.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/006-acard-folders.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/019-acard-page-view.sql"), "utf8")));
  await lite.exec("SET search_path = acard");
});

type Backend = { db: any; statements: () => number; count: (sql: string, ...params: unknown[]) => Promise<number> };

function sqliteBackend(): Backend {
  const sqlite = new Database(":memory:");
  let n = 0;
  const statement = (sql: string, params: unknown[] = []) => ({
    sql, params,
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => { n++; return { success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }; },
    all: async () => { n++; return { results: sqlite.query(sql).all(...(params as any[])) }; },
    first: async () => { n++; return sqlite.query(sql).get(...(params as any[])) ?? null; },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => {
      // D1 and workspace Durable Objects refuse more than 100 bound parameters in one statement.
      for (const item of list) if (item.params.length > 100) throw new Error("too many SQL variables: " + item.params.length);
      sqlite.exec("BEGIN");
      try { const out = []; for (const item of list) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, statements: () => n, count: async (sql, ...params) => Number(Object.values(sqlite.query(sql).get(...(params as any[])) as object)[0]) };
}

async function pgBackend(): Promise<Backend> {
  await lite.exec("TRUNCATE pages, blocks, page_view, links, agent_activity, editor_history, page_tags, editor_page_settings, page_fts, page_fts_ko, page_fts_dirty, agent_tokens");
  let n = 0;
  const query = (q: { query: PGlite["query"] }) => async (text: string, params: unknown[]) => {
    n++;
    const r = await q.query<Record<string, unknown>>(text, params);
    return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
  };
  const db = pgD1({ query: query(lite), transaction: (fn) => lite.transaction((tx) => fn(query(tx))) });
  return { db, statements: () => n, count: async (sql, ...params) => Number(Object.values((await lite.query<Record<string, unknown>>(sql.replace(/\?/g, (_, i) => "$" + (sql.slice(0, i).split("?").length)), params)).rows[0])[0]) };
}

const backends: [string, () => Promise<Backend> | Backend][] = [["sqlite (D1 / workspace store)", sqliteBackend], ["postgres", pgBackend]];

for (const [name, make] of backends) {
  let b: Backend, worker: any, env: any, token: string;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await worker.fetch(new Request("https://notes.test/api/v1" + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: r.status, data: await r.json() as any };
  };

  beforeEach(async () => {
    b = await make();
    worker = new Function(WORKER_SOURCE)();
    env = { DB: b.db, GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
    await ensureAgentSchema(b.db);
    token = (await createAgentToken(b.db, { name: "Big writer", scopes: ["read", "write"] })).token;
    await call("GET", "/me");
  });

  test(name + ": a 1500-block document is written in a few dozen statements, reads back the same and keeps its links", async () => {
    const md = longMarkdown(250) + "\n[[다른-페이지]]\n";
    const before = b.statements();
    const made = await call("POST", "/pages", { markdown: "---\ntitle: 긴 문서\n---\n" + md });
    expect(made.status).toBe(201);
    expect(made.data.blocks).toBeGreaterThan(1000);
    expect(b.statements() - before).toBeLessThan(name === "postgres" ? 40 : made.data.blocks / 8);
    expect(await b.count("SELECT COUNT(*) AS c FROM blocks WHERE page = ?", made.data.slug)).toBe(made.data.blocks);
    expect(await b.count("SELECT COUNT(*) AS c FROM links WHERE src = ?", made.data.slug)).toBe(1);
    const back = await call("GET", "/pages/" + encodeURIComponent(made.data.slug));
    const body = String(back.data.markdown).replace(/^---[\s\S]*?\n---\n/, "");
    const norm = (s: string) => s.split("\n").map((l) => l.trimEnd()).filter(Boolean).join("\n");
    expect(norm(body)).toBe(norm(md));
  });

  test(name + ": the same create sent again (Idempotency-Key or identical body) returns the first page, no second page", async () => {
    const md = "---\ntitle: 재시도\n---\n" + longMarkdown(5);
    const first = await call("POST", "/pages", { markdown: md }, { "idempotency-key": "k-1" });
    const again = await call("POST", "/pages", { markdown: md }, { "idempotency-key": "k-1" });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.data).toMatchObject({ slug: first.data.slug, duplicate: true });
    const plain1 = await call("POST", "/pages", { markdown: md + "\n끝\n" });
    const plain2 = await call("POST", "/pages", { markdown: md + "\n끝\n" });
    expect(plain2.data.slug).toBe(plain1.data.slug);
    expect(await b.count("SELECT COUNT(*) AS c FROM pages WHERE title = ?", "재시도")).toBe(2);
    const otherKey = await call("POST", "/pages", { markdown: md }, { "idempotency-key": "k-2" });
    expect(otherKey.status).toBe(201);
    expect(otherKey.data.slug).not.toBe(first.data.slug);
  });

  test(name + ": a create that fails while saving leaves no page behind, and its retry succeeds once", async () => {
    const realBatch = b.db.batch;
    b.db.batch = async (list: { sql: string }[]) => {
      if (list.some((s) => /INSERT INTO blocks/.test(s.sql))) throw new Error("Network connection lost");
      return realBatch(list);
    };
    const failed = await worker.fetch(new Request("https://notes.test/api/v1/pages", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json", "idempotency-key": "k-f" }, body: JSON.stringify({ markdown: "---\ntitle: 실패\n---\n" + longMarkdown(3) }) }), env).catch((e: Error) => e);
    b.db.batch = realBatch;
    expect(failed instanceof Error || failed.status >= 500).toBe(true);
    expect(await b.count("SELECT COUNT(*) AS c FROM pages WHERE title = ?", "실패")).toBe(0);
    const retry = await call("POST", "/pages", { markdown: "---\ntitle: 실패\n---\n" + longMarkdown(3) }, { "idempotency-key": "k-f" });
    expect(retry.status).toBe(201);
    expect(await b.count("SELECT COUNT(*) AS c FROM pages WHERE title = ?", "실패")).toBe(1);
  });

  test(name + ": a repeated append adds the text once; a repeated update is answered as done; >2000 blocks is a 413 that says how to split", async () => {
    const slug = (await call("POST", "/pages", { markdown: "---\ntitle: 로그\n---\n첫 줄\n" })).data.slug;
    const a1 = await call("POST", "/pages/" + slug + "/append", { markdown: "둘째 줄\n" }, { "idempotency-key": "a-1" });
    const a2 = await call("POST", "/pages/" + slug + "/append", { markdown: "둘째 줄\n" }, { "idempotency-key": "a-1" });
    expect([a1.status, a1.data, a2.data.duplicate]).toEqual([200, expect.objectContaining({ appended: 1 }), true]);
    expect(await b.count("SELECT COUNT(*) AS c FROM blocks WHERE page = ?", slug)).toBe(2);
    await call("POST", "/pages/" + slug + "/append", { markdown: "- 확인\n" });
    await call("POST", "/pages/" + slug + "/append", { markdown: "- 확인\n" });
    expect(await b.count("SELECT COUNT(*) AS c FROM blocks WHERE page = ?", slug)).toBe(4);
    const piece = longMarkdown(20);
    const p1 = await call("POST", "/pages/" + slug + "/append", { markdown: piece });
    const p2 = await call("POST", "/pages/" + slug + "/append", { markdown: piece });
    expect([p1.data.appended > 0, p2.data.duplicate]).toEqual([true, true]);
    const read = await call("GET", "/pages/" + slug);
    const u1 = await call("PUT", "/pages/" + slug, { markdown: "새 내용\n", expectedUpdated: read.data.updated });
    const u2 = await call("PUT", "/pages/" + slug, { markdown: "새 내용\n", expectedUpdated: read.data.updated });
    expect([u1.status, u2.status, u2.data.unchanged]).toEqual([200, 200, true]);
    const huge = await call("POST", "/pages", { markdown: "---\ntitle: 너무 긴 문서\n---\n" + longMarkdown(350) });
    expect(huge.status).toBe(413);
    expect(huge.data.error).toContain("하위 페이지");
    expect(await b.count("SELECT COUNT(*) AS c FROM pages WHERE title = ?", "너무 긴 문서")).toBe(0);
  });
}
