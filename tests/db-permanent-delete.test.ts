import { afterEach, expect, test } from "bun:test";
import { setup } from "./db-harness";

const stores: ReturnType<typeof setup>[] = [];
afterEach(() => { for (const h of stores.splice(0)) h.sqlite.close(); });

async function fixture() {
  const h = setup();
  stores.push(h);
  const make = async (title: string, parent: string | null = null) => (await h.call("POST", "/api/pages", { title, parent })).data.slug as string;
  const folder = await make("folder");
  const page = (await h.call("POST", "/api/pages", { title: "Delete me", parent: folder, kind: "db" })).data;
  const database = (await h.call("GET", "/api/db/" + page.slug)).data.database;
  const other = (await h.call("POST", "/api/db", { title: "Keep me" })).data;
  const target = (await h.call("POST", "/api/db/" + other.slug + "/rows", { props: {} })).data.row;
  const relation = (await h.call("POST", "/api/db/" + database.slug + "/properties", {
    name: "Related", type: "relation", config: { database: other.slug, synced: true },
  })).data;
  const row = (await h.call("POST", "/api/db/" + database.slug + "/rows", { props: { [relation.property.id]: [target.id] } })).data.row;
  const template = (await h.call("POST", "/api/db/" + database.slug + "/templates", { name: "Repeat", props: {}, blocks: [] })).data.template;
  const counter = (await h.call("POST", "/api/db/" + database.slug + "/properties", { name: "ID", type: "unique_id" })).data.property;
  h.sqlite.query("INSERT INTO db_template_runs (template_id, occurrence, row_id, created) VALUES (?, 1, ?, 1)").run(template.id, row.id);
  h.sqlite.query("INSERT INTO db_forms (id, database_id, config, created, updated) VALUES ('form-delete', ?, '{}', 1, 1)").run(database.id);
  h.sqlite.query("INSERT INTO db_rules (id, database_id, config, created) VALUES ('rule-delete', ?, '{}', 1)").run(database.id);
  for (const page of [database.slug, row.page]) {
    await h.call("PUT", "/api/page/" + page + "/settings", { favorite: true });
    await h.call("POST", "/api/page/" + page + "/comments", { text: "Delete discussion" });
    h.sqlite.query("INSERT INTO share_rules (id, page, principal, role, created) VALUES (?, ?, 'email:guest@example.com', 'read', 1)").run("share-" + page, page);
    h.sqlite.query("INSERT INTO share_requests (id, page, email, role, created) VALUES (?, ?, 'guest@example.com', 'read', 1)").run("request-" + page, page);
    h.sqlite.query("INSERT INTO share_pages (page) VALUES (?)").run(page);
    h.sqlite.query("INSERT INTO media (id, page, name, mime, bytes, created) VALUES (?, ?, 'picture', 'image/png', 10, 1)").run("image-" + page, page);
  }
  h.sqlite.query("INSERT INTO links (src, dst) VALUES (?, ?)").run(target.page, row.page);
  const deletedMedia: string[] = [];
  h.env.MEDIA = { delete: async (key: string) => { deletedMedia.push(key); } };
  return { h, make, folder, database, other, target, relation, row, template, counter, deletedMedia };
}

test("permanent database deletion removes every owned table and row page without purging unrelated orphans (#91)", async () => {
  const { h, database, other, target, relation, row, template, counter, deletedMedia } = await fixture();
  // Ownership is db_rows.page, not the page's current tree position.
  h.sqlite.query("UPDATE pages SET parent = NULL WHERE slug = ?").run(row.page);
  h.sqlite.exec("INSERT INTO databases (id, slug) VALUES ('old-orphan', 'old-orphan'); INSERT INTO db_rows (id, database_id, props) VALUES ('orphan-row', 'old-orphan', '{}')");
  expect((await h.call("POST", "/api/page/" + database.slug + "/trash")).status).toBe(200);
  expect((await h.call("DELETE", "/api/page/" + database.slug + "/permanent")).status).toBe(200);
  expect((await h.call("GET", "/api/db/" + database.slug)).status).toBe(404);
  for (const table of ["db_rows", "db_properties", "db_views", "db_templates", "db_rules", "db_forms"]) {
    expect(h.sqlite.query(`SELECT COUNT(*) AS n FROM ${table} WHERE database_id = ?`).get(database.id)).toEqual({ n: 0 });
  }
  expect(h.sqlite.query("SELECT id FROM databases WHERE id = ?").get(database.id)).toBeNull();
  expect(h.sqlite.query("SELECT * FROM db_counters WHERE property_id = ?").get(counter.id)).toBeNull();
  expect(h.sqlite.query("SELECT * FROM db_template_runs WHERE template_id = ?").get(template.id)).toBeNull();
  expect(h.sqlite.query("SELECT * FROM db_relation_links").all()).toEqual([]);
  expect(h.sqlite.query("SELECT * FROM db_relation_locks").all()).toEqual([]);
  for (const page of [database.slug, row.page]) {
    expect(h.sqlite.query("SELECT slug FROM pages WHERE slug = ?").get(page)).toBeNull();
    expect((await h.call("GET", "/api/page/" + page)).status).toBe(404);
    expect(h.sqlite.query("SELECT permanent FROM editor_trash WHERE page = ?").get(page)).toEqual({ permanent: 1 });
    for (const table of ["blocks", "editor_page_settings", "editor_comments", "editor_history", "share_rules", "share_requests", "share_pages", "media"]) {
      expect(h.sqlite.query(`SELECT COUNT(*) AS n FROM ${table} WHERE page = ?`).get(page)).toEqual({ n: 0 });
    }
    expect(deletedMedia).toContain("media/image-" + page);
  }
  expect(h.sqlite.query("SELECT * FROM links WHERE src = ? OR dst = ?").all(row.page, row.page)).toEqual([]);
  const kept = (await h.call("GET", "/api/db/" + other.slug)).data;
  expect(kept.rows.find((r: any) => r.id === target.id).props[relation.pair.id]).toEqual([]);
  expect(kept.properties.find((p: any) => p.id === relation.pair.id).config).toMatchObject({ synced: false, pair: "" });
  expect(h.sqlite.query("SELECT id FROM databases WHERE id = 'old-orphan'").get()).toEqual({ id: "old-orphan" });
  expect(h.sqlite.query("SELECT id FROM db_rows WHERE id = 'orphan-row'").get()).toEqual({ id: "orphan-row" });
});

test("permanent folder deletion includes nested databases and their rows but preserves restored descendants (#91)", async () => {
  const { h, make, folder, database, row, other } = await fixture();
  const restored = await make("restored", database.slug);
  const child = await make("child", row.page);
  expect((await h.call("POST", "/api/page/" + folder + "/trash")).status).toBe(200);
  expect((await h.call("POST", "/api/page/" + restored + "/restore")).status).toBe(200);
  expect((await h.call("DELETE", "/api/page/" + folder + "/permanent")).status).toBe(200);
  expect((await h.call("GET", "/api/db/" + database.slug)).status).toBe(404);
  for (const page of [folder, database.slug, row.page, child]) {
    expect(h.sqlite.query("SELECT slug FROM pages WHERE slug = ?").get(page)).toBeNull();
    expect(h.sqlite.query("SELECT permanent FROM editor_trash WHERE page = ?").get(page)).toEqual({ permanent: 1 });
  }
  expect((await h.call("GET", "/api/page/" + restored)).status).toBe(200);
  expect((await h.call("GET", "/api/db/" + other.slug)).status).toBe(200);
});

test("failed permanent database descendant deletion rolls back the whole trash group and related cleanup (#91)", async () => {
  const { h, folder, database, row, deletedMedia } = await fixture();
  await h.call("POST", "/api/page/" + folder + "/trash");
  const tables = ["pages", "blocks", "links", "editor_trash", "editor_history", "editor_page_settings", "editor_comments", "databases", "db_rows", "db_properties", "db_views", "db_templates", "db_rules", "db_forms", "db_counters", "db_template_runs", "db_relation_links", "db_relation_locks", "share_rules", "share_requests", "share_pages", "media"];
  const snapshot = () => tables.map(table => h.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before = snapshot();
  h.sqlite.exec("CREATE TRIGGER reject_row_page_delete BEFORE DELETE ON pages WHEN OLD.kind = 'db_row' BEGIN SELECT RAISE(ABORT, 'injected permanent delete failure'); END");
  const response = await h.call("DELETE", "/api/page/" + folder + "/permanent");
  expect(response.status).toBe(500);
  expect(response.data.error).toContain("injected permanent delete failure");
  expect(snapshot()).toEqual(before);
  expect(deletedMedia).toEqual([]);
  expect(h.sqlite.query("SELECT slug FROM pages WHERE slug IN (?, ?, ?)").all(folder, database.slug, row.page)).toHaveLength(3);
});

test("permanent database deletion requires trash and empty trash uses the same cleanup (#91)", async () => {
  const { h, database, row, other } = await fixture();
  expect((await h.call("DELETE", "/api/page/" + database.slug + "/permanent")).status).toBe(409);
  expect((await h.call("GET", "/api/db/" + database.slug)).data.rows).toHaveLength(1);
  await h.call("POST", "/api/page/" + database.slug + "/trash");
  expect((await h.call("POST", "/api/editor/trash/empty")).status).toBe(200);
  expect((await h.call("GET", "/api/db/" + database.slug)).status).toBe(404);
  expect(h.sqlite.query("SELECT slug FROM pages WHERE slug = ?").get(row.page)).toBeNull();
  expect((await h.call("GET", "/api/db/" + other.slug)).status).toBe(200);
});

test("permanent row page deletion removes its row and reciprocal links while keeping both databases (#91)", async () => {
  const { h, database, other, row, target, relation } = await fixture();
  await h.call("POST", "/api/page/" + row.page + "/trash");
  expect((await h.call("DELETE", "/api/page/" + row.page + "/permanent")).status).toBe(200);
  expect((await h.call("GET", "/api/db/" + database.slug)).data.rows).toEqual([]);
  const kept = (await h.call("GET", "/api/db/" + other.slug)).data;
  expect(kept.rows.find((r: any) => r.id === target.id).props[relation.pair.id]).toEqual([]);
  expect(kept.properties.find((p: any) => p.id === relation.pair.id).config.synced).toBe(true);
  expect(h.sqlite.query("SELECT * FROM db_relation_links").all()).toEqual([]);
  expect(h.sqlite.query("SELECT * FROM db_template_runs WHERE row_id = ?").get(row.id)).toBeNull();
});
