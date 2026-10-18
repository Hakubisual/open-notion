import { expect, test, beforeAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pgD1 } from "../gate/pg-d1";
import { setup } from "./db-harness";

const ROOT = join(import.meta.dir, "..");
let lite: PGlite;
beforeAll(async () => {
  lite = new PGlite();
  const strip = (sql: string) => sql.replace(/REVOKE[^;]*;/g, "").replace(/GRANT[^;]*;/g, "").replace(/DROP POLICY[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, "");
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/001-acard-schema.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/002-acard-search.sql"), "utf8")).replace(/CREATE EXTENSION[^;]*;/, "").replace(/CREATE INDEX IF NOT EXISTS page_fts_trgm[^;]*;/, ""));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/004-acard-agent.sql"), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/005-acard-journal.sql"), "utf8")));
  await lite.exec("SET search_path = acard; INSERT INTO pages (slug, title, parent, ord, kind, updated) VALUES ('old1', 'b', NULL, 5, 'note', 1), ('old2', 'a', NULL, 5, 'note', 1)");
  const sql = strip(readFileSync(join(ROOT, "migrations/supabase/006-acard-folders.sql"), "utf8"));
  await lite.exec(sql);
  await lite.exec(sql);
  await lite.exec("SET search_path = acard");
});

test("006 backfills sibling order and folders work on the Postgres backend", async () => {
  const backfilled = await lite.query<{ slug: string; ord: number }>("SELECT slug, ord FROM pages WHERE slug LIKE 'old%' ORDER BY ord");
  expect(backfilled.rows.map((r) => [r.slug, Number(r.ord)])).toEqual([["old2", 10], ["old1", 20]]);
  const query = (db: { query: PGlite["query"] }) => async (text: string, params: unknown[]) => {
    const r = await db.query<Record<string, unknown>>(text, params);
    return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
  };
  const h = setup() as ReturnType<typeof setup> & { worker: any };
  h.env.DB = pgD1({ query: query(lite), transaction: fn => lite.transaction(tx => fn(query(tx))) });
  for (const t of ["p", "q"]) await h.call("POST", "/api/pages", { title: t });
  const moved = await h.call("POST", "/api/page/q/move", { parent: "p" });
  expect(moved.status).toBe(200);
  expect((await h.call("POST", "/api/page/p/move", { parent: "q" })).status).toBe(400);
  await h.call("PUT", "/api/page/q/tags", { tags: ["업무"] });
  const tree = (await h.call("GET", "/api/folders/tree")).data;
  expect(tree.pages.find((x: any) => x.slug === "q")).toMatchObject({ parent: "p", tags: ["업무"] });
  expect(tree.tags.find((t: any) => t.name === "업무").count).toBe(1);
  await h.call("POST", "/api/folders/undo", { batch: moved.data.batch });
  expect((await h.call("GET", "/api/folders/tree")).data.pages.find((x: any) => x.slug === "q").parent).toBe(null);
  const bulk = await h.call("POST", "/api/folders/bulk", { action: "trash", slugs: ["p", "q"] });
  expect(bulk.status).toBe(200);
  expect((await h.call("POST", "/api/page/q/restore")).status).toBe(200);
  await h.call("PUT", "/api/folders/prefs", { open: ["p"], collapsed: ["journal"] });
  expect((await h.call("GET", "/api/folders/tree")).data.prefs).toEqual({ v: 0, open: ["p"], collapsed: ["journal"], closed: [] });
});
