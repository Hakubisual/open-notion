import { expect, test, beforeAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pgD1, translate } from "../gate/pg-d1";
import { setup } from "./db-harness";

const ROOT = join(import.meta.dir, "..");
let lite: PGlite;

beforeAll(async () => {
  lite = new PGlite();
  const schema = readFileSync(join(ROOT, "migrations/supabase/001-acard-schema.sql"), "utf8").replace(/REVOKE[^;]*;/g, "");
  const search = readFileSync(join(ROOT, "migrations/supabase/002-acard-search.sql"), "utf8")
    .replace(/CREATE EXTENSION[^;]*;/, "").replace(/REVOKE[^;]*;/g, "").replace(/CREATE INDEX IF NOT EXISTS page_fts_trgm[^;]*;/, "");
  await lite.exec(schema);
  await lite.exec(search);
  await lite.exec("SET search_path = acard");
});

function worker() {
  const query = (db: { query: PGlite["query"] }) => async (text: string, params: unknown[]) => {
    const r = await db.query<Record<string, unknown>>(text, params);
    return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
  };
  const ctx = setup();
  ctx.env.DB = pgD1({ query: query(lite), transaction: fn => lite.transaction(tx => fn(query(tx))) });
  return ctx;
}

test("SQLite-only syntax becomes Postgres syntax", () => {
  expect(translate("SELECT a FROM t WHERE p IS ? AND x LIKE ?")).toBe("SELECT a FROM t WHERE p IS NOT DISTINCT FROM $1 AND x ILIKE $2");
  expect(translate("INSERT OR IGNORE INTO page_tags (page, tag) VALUES (?, ?)")).toBe("INSERT INTO page_tags (page, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING");
  expect(translate("INSERT OR REPLACE INTO link_cache (url, title) VALUES (?, ?)")).toBe("INSERT INTO link_cache (url, title) VALUES ($1, $2) ON CONFLICT (url) DO UPDATE SET title = excluded.title");
  expect(translate("SELECT 'a?b' AS x, ? AS deletedAt")).toBe("SELECT 'a?b' AS x, $1 AS \"deletedAt\"");
  expect(translate("UPDATE pages SET updated = MAX(updated + 1, ?)")).toBe("UPDATE pages SET updated = GREATEST(updated + 1, $1)");
  expect(translate("CREATE TABLE IF NOT EXISTS x (a TEXT)")).toBeNull();
});

test("pages save, read back, search in Korean and English, and roll back a failed batch on Postgres", async () => {
  const ctx = worker();
  const created = await ctx.call("POST", "/api/pages", { title: "이전 시험" });
  expect([created.status, created.data]).toEqual([200, expect.anything()]);
  const slug = encodeURIComponent(created.data.slug);
  const saved = await ctx.call("PUT", "/api/page/" + slug, { title: "이전 시험", blocks: [{ id: "b1", type: "paragraph", text: "수파베이스 이전 문장" }, { id: "b2", type: "paragraph", text: "English migration line" }] });
  expect(saved.status).toBe(200);
  const read = await ctx.call("GET", "/api/page/" + slug);
  expect(read.data.blocks.map((b: { id: string }) => b.id)).toEqual(["b1", "b2"]);
  expect((await ctx.call("GET", "/api/search?q=" + encodeURIComponent("베이스"))).data.results.map((r: { slug: string }) => r.slug)).toEqual([created.data.slug]);
  expect((await ctx.call("GET", "/api/search?q=migration")).data.results).toHaveLength(1);
  await expect(ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE pages SET title = ? WHERE slug = ?").bind("바뀜", created.data.slug),
    ctx.env.DB.prepare("INSERT INTO pages (slug) VALUES (?)").bind("x"),
  ])).rejects.toThrow();
  expect((await ctx.call("GET", "/api/page/" + slug)).data.page.title).toBe("이전 시험");
});
