import { beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pgD1 } from "../gate/pg-d1";
import { cookie, setup } from "./db-harness";

const ROOT = join(import.meta.dir, "..");
let lite: PGlite;
let h: any;
const strip = (sql: string) => sql.replace(/REVOKE[^;]*;/g, "").replace(/GRANT[^;]*;/g, "").replace(/DROP POLICY[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, "");

beforeAll(async () => {
  lite = new PGlite();
  for (const f of ["001-acard-schema.sql", "004-acard-agent.sql", "005-acard-journal.sql", "006-acard-folders.sql", "019-acard-page-view.sql", "034-acard-imports.sql"]) await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase", f), "utf8")));
  await lite.exec(strip(readFileSync(join(ROOT, "migrations/supabase/002-acard-search.sql"), "utf8")).replace(/CREATE EXTENSION[^;]*;/, "").replace(/CREATE INDEX IF NOT EXISTS page_fts_trgm[^;]*;/, ""));
  await lite.exec("SET search_path = acard");
  const query = (db: any) => async (text: string, params: unknown[]) => { const r = await db.query(text, params); return { rows: r.rows, count: r.affectedRows ?? r.rows.length }; };
  h = setup();
  h.env.DB = pgD1({ query: query(lite), transaction: (fn: any) => lite.transaction((tx: any) => fn(query(tx))) });
});

async function post(path: string, body: unknown, raw?: BodyInit, type = "application/json") {
  const res = await h.worker.fetch(new Request("https://notes.test" + path, { method: "POST", headers: { cookie: await cookie(), "content-type": type }, body: raw ?? JSON.stringify(body) }), h.env);
  return { status: res.status, data: await res.json().catch(() => null) as any };
}
const n = async (table: string) => Number((await lite.query<any>("SELECT COUNT(*)::int AS n FROM acard." + table)).rows[0].n);

test("the owner workspace (Postgres) runs an import batch end to end and the markdown import too (#128)", async () => {
  const plan = { format: "notion-md", name: "pg", sources: [{ key: "A.md", source: "notion:pa", kind: "page", title: "Alpha" }, { key: "A/B.md", source: "notion:pb", kind: "page", title: "Beta" }, { key: "A/T.csv", source: "notion:pt", kind: "db", title: "T" }, { key: "A/T/R.md", source: "notion:pr", kind: "row", title: "R" }] };
  const created = await post("/api/import/batches", plan);
  expect(created.status).toBe(200);
  const map = created.data.map;
  const chunk = await post("/api/import/batches/" + created.data.id + "/chunk", {
    map,
    pages: [
      { key: "A.md", title: "Alpha", parent: null, kind: "note", tags: ["x"], blocks: [{ id: "a", type: "paragraph", text: "to Beta", meta: { richText: [{ text: "to Beta", href: "imp-page:A/B.md" }] } }] },
      { key: "A/B.md", title: "Beta", parent: "A.md", kind: "note", blocks: [{ id: "b", type: "to_do", text: "t", checked: true }] },
      { key: "A/T/R.md", title: "R", parent: "A/T.csv", kind: "db_row", blocks: [] },
    ],
    databases: [{ key: "A/T.csv", title: "T", parent: "A.md", properties: [{ id: "title", name: "Name", type: "title" }, { id: "p1", name: "N", type: "number" }] }],
    rows: [{ database: "A/T.csv", page: "A/T/R.md", index: 1, values: { title: "R", p1: 3 } }],
  });
  expect(chunk.status).toBe(200);
  const finish = await post("/api/import/batches/" + created.data.id + "/finish", {});
  expect(finish.status).toBe(200);
  expect(await n("page_imports")).toBe(4);
  expect((await lite.query<any>("SELECT parent FROM acard.pages WHERE slug = $1", [map["A/B.md"].slug])).rows[0].parent).toBe(map["A.md"].slug);
  expect(await n("editor_trash")).toBe(0);
  const form = new FormData();
  form.append("file", new File(["# Md page\n\nhi"], "md-page.md"));
  const md = await h.worker.fetch(new Request("https://notes.test/api/import/md", { method: "POST", headers: { cookie: await cookie() }, body: form }), h.env);
  expect(md.status).toBe(200);
});

test("an import that fails half way on Postgres leaves no page behind", async () => {
  const before = await n("pages");
  const plan = { format: "markdown", name: "fail", sources: [{ key: "x.md", source: "md:x", kind: "page", title: "Gamma" }, { key: "y.md", source: "md:y", kind: "page", title: "Delta" }] };
  const created = await post("/api/import/batches", plan);
  const bad = await post("/api/import/batches/" + created.data.id + "/chunk", { map: created.data.map, pages: [{ key: "x.md", title: "Gamma", parent: null, kind: "note", blocks: [{ id: "dup", type: "paragraph", text: "1" }, { id: "dup", type: "paragraph", text: "2" }] }] }).catch((e) => ({ status: 500, data: String(e) }));
  expect(bad.status).toBeGreaterThanOrEqual(400);
  expect(await n("pages")).toBe(before);
  const aborted = await post("/api/import/batches/" + created.data.id + "/abort", {});
  expect(aborted.status).toBe(200);
  expect(await n("pages")).toBe(before);
});

