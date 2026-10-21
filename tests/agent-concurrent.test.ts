import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { inline, pgD1 } from "../gate/pg-d1";
import { assembleWorkerSource } from "./assemble-worker";

// acard-db-load: several agents writing one page at once. Every statement yields before it runs, so concurrent
// requests interleave statement by statement the way they do against Postgres; a batch is one transaction.
const WORKER_SOURCE = assembleWorkerSource();
const turn = () => new Promise<void>((next) => setImmediate(next));
function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []) => ({
    sql, params,
    bind: (...next: unknown[]) => statement(sql, next),
    execute: () => ({ success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }),
    run: async () => { await turn(); return { success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }; },
    all: async () => { await turn(); return { results: sqlite.query(sql).all(...(params as any[])) }; },
    first: async () => { await turn(); return sqlite.query(sql).get(...(params as any[])) ?? null; },
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => { await turn(); return sqlite.transaction(() => list.map((item) => item.execute()))(); },
  };
}

let sqlite: Database;
let worker: { fetch(request: Request, env: any): Promise<Response> };
let env: any;
const call = async (method: string, path: string, token: string, body?: unknown) => {
  const response = await worker.fetch(new Request("https://notes.test" + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await response.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
};
const texts = (slug: string) => (sqlite.query("SELECT text FROM blocks WHERE page = ? ORDER BY ord").all(slug) as { text: string }[]).map((row) => row.text);

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const db = d1(sqlite);
  worker = new Function(WORKER_SOURCE)();
  env = { DB: db, GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  await worker.fetch(new Request("https://notes.test/api/v1/me"), env);
  await ensureAgentSchema(db);
});

test("concurrent agent PUTs on one page all succeed and the page ends as exactly one of them, whole", async () => {
  const writers = await Promise.all(Array.from({ length: 6 }, (_, i) => createAgentToken(env.DB, { name: "agent " + i, scopes: ["read", "write"] }).then((t) => t.token)));
  const slug = (await call("POST", "/api/v1/pages", writers[0], { markdown: "---\ntitle: Shared\n---\nfirst\n" })).data.slug;
  sqlite.query("UPDATE pages SET updated = updated - 60000 WHERE slug = ?").run(slug);
  sqlite.query("UPDATE agent_activity SET created = created - 60000 WHERE page = ?").run(slug);
  const versions = writers.map((_, i) => ["v" + i + " one", "v" + i + " two", "v" + i + " three"]);
  const results = await Promise.all(writers.map((token, i) => call("PUT", "/api/v1/pages/" + slug, token, { markdown: versions[i].join("\n\n") + "\n" })));
  expect(results.map((r) => r.status)).toEqual(writers.map(() => 200));
  const final = texts(slug);
  expect(versions.some((v) => JSON.stringify(v) === JSON.stringify(final))).toBe(true);
  expect((sqlite.query("SELECT count(*) AS n FROM agent_activity WHERE page = ? AND action = 'update'").get(slug) as { n: number }).n).toBe(writers.length);
  const next = await call("PUT", "/api/v1/pages/" + slug, writers[0], { markdown: "after all\n" });
  expect([next.status, texts(slug)]).toEqual([200, ["after all"]]);
});

test("concurrent PUTs from one read version: one wins, the rest get 409, and nothing is lost or mixed", async () => {
  const writer = (await createAgentToken(env.DB, { name: "agent", scopes: ["read", "write"] })).token;
  const slug = (await call("POST", "/api/v1/pages", writer, { markdown: "---\ntitle: Shared\n---\nbase\n" })).data.slug;
  const read = (await call("GET", "/api/v1/pages/" + slug, writer)).data.updated;
  const results = await Promise.all([0, 1, 2, 3].map((i) => call("PUT", "/api/v1/pages/" + slug, writer, { markdown: "w" + i + " a\n\nw" + i + " b\n", expectedUpdated: read })));
  const won = results.map((r, i) => (r.status === 200 ? i : -1)).filter((i) => i >= 0);
  expect(won).toHaveLength(1);
  expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  expect(texts(slug)).toEqual(["w" + won[0] + " a", "w" + won[0] + " b"]);
});

test("values written into Postgres statements as literals come back byte for byte, and the block script is all or nothing", async () => {
  const lite = new PGlite();
  const strip = (sql: string) => sql.replace(/REVOKE[^;]*;/g, "");
  await lite.exec(strip(readFileSync(join(import.meta.dir, "../migrations/supabase/001-acard-schema.sql"), "utf8")));
  await lite.exec("SET search_path = acard");
  const query = (q: { query: PGlite["query"] }) => async (text: string, params: unknown[]) => {
    const r = await q.query<Record<string, unknown>>(text, params);
    return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
  };
  const scripts: string[] = [];
  const db = pgD1({ query: query(lite), transaction: (fn) => lite.transaction((tx) => fn(query(tx))), script: async (text) => { scripts.push(text); await lite.exec(text); } });
  const hostile = ["it's", "back\\slash\\'", "E'x'", "'); DROP TABLE blocks; --", "$1 $2 ?", "한글 🙂", "line\nbreak", ""];
  await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'note', ?, 'editor', NULL)").bind("p'1", hostile[0], null, 0, 1).run();
  const insert = (id: string, ord: number, text: string) => db.prepare("INSERT INTO blocks (page, id, ord, type, text, checked, indent, meta) VALUES (?, ?, ?, 'paragraph', ?, 0, 0, ?)").bind("p'1", id, ord, text, null);
  await db.script(hostile.map((text, i) => insert("b" + i, i, text)));
  expect(scripts).toHaveLength(1);
  const back = await db.prepare("SELECT text FROM blocks WHERE page = ? ORDER BY ord").bind("p'1").all();
  expect(back.results.map((r: { text: string }) => r.text)).toEqual(hostile);
  expect((await db.prepare("SELECT title FROM pages WHERE slug = ?").bind("p'1").first()).title).toBe(hostile[0]);
  // A duplicate key in the middle leaves the earlier statements of the same script unapplied.
  await expect(db.script([db.prepare("DELETE FROM blocks WHERE page = ?").bind("p'1"), insert("x", 0, "x"), insert("x", 1, "dup")])).rejects.toThrow();
  expect((await db.prepare("SELECT count(*) AS n FROM blocks WHERE page = ?").bind("p'1").first()).n).toBe(hostile.length);
  expect(inline("SELECT $1, '$1'", ["a"])).toBe("SELECT E'a', '$1'");
  expect(inline("SELECT $1", [new Uint8Array(1)])).toBeNull();
  await lite.close();
});
