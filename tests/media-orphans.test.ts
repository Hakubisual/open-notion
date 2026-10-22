import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { ORPHAN_MIN_AGE_MS, orphanCandidates, scanWorkspace } from "../gate/media-orphans";

function d1(sqlite: Database) {
  const st = (sql: string, params: unknown[] = []): any => ({
    bind: (...next: unknown[]) => st(sql, next),
    all: async () => ({ results: sqlite.query(sql).all(...(params as any[])) }),
  });
  return { prepare: (sql: string) => st(sql) };
}

const NOW = Date.UTC(2026, 9, 22);
const OLD = NOW - ORPHAN_MIN_AGE_MS - 1000;
const id = (n: number) => n.toString(16).padStart(16, "a");

function workspace() {
  const s = new Database(":memory:");
  s.exec(`CREATE TABLE pages (slug TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE blocks (page TEXT, id TEXT, text TEXT, meta TEXT);
    CREATE TABLE editor_trash (page TEXT);
    CREATE TABLE editor_history (page TEXT, blocks TEXT);
    CREATE TABLE page_settings (page TEXT, value TEXT);
    CREATE TABLE share_pages (page TEXT, site_title TEXT);
    CREATE TABLE db_rows (id TEXT, props TEXT);
    CREATE TABLE db_templates (id TEXT, blocks TEXT);
    CREATE TABLE editor_comments (id TEXT, text TEXT);
    CREATE TABLE journal_events (id TEXT, text TEXT, data TEXT);
    CREATE TABLE media (id TEXT PRIMARY KEY, page TEXT, name TEXT, mime TEXT, bytes INTEGER, created INTEGER);`);
  return s;
}

test("every table counts as a reference (body, meta, trash, history, settings, rows, templates, comments, journal) and only unreferenced old files with no page are candidates", async () => {
  const s = workspace();
  s.exec(`INSERT INTO pages VALUES ('live','Live'),('binned','Binned')`);
  s.exec(`INSERT INTO editor_trash VALUES ('binned')`);
  const refs: [string, string][] = [
    ["blocks", `INSERT INTO blocks VALUES ('live','b1','![x](/media/${id(1)})',NULL)`],
    ["meta", `INSERT INTO blocks VALUES ('live','b2','', '{"src":"/media/${id(2)}"}')`],
    ["history", `INSERT INTO editor_history VALUES ('live','[{"text":"/media/${id(3)}"}]')`],
    ["settings", `INSERT INTO page_settings VALUES ('live','{"cover":"/media/${id(4)}"}')`],
    ["db_rows", `INSERT INTO db_rows VALUES ('r','{"files":["/media/${id(5)}"]}')`],
    ["templates", `INSERT INTO db_templates VALUES ('t','[{"meta":{"src":"/media/${id(6)}"}}]')`],
    ["comments", `INSERT INTO editor_comments VALUES ('c','see /media/${id(7)}')`],
    ["journal", `INSERT INTO journal_events VALUES ('j','', '{"images":["/media/${id(8)}"]}')`],
  ];
  for (const [, sql] of refs) s.exec(sql);
  for (let n = 1; n <= 8; n++) s.query("INSERT INTO media VALUES (?, NULL, 'a', 'image/png', 10, ?)").run(id(n), OLD);
  s.query("INSERT INTO media VALUES (?, NULL, 'a', 'image/png', 100, ?)").run(id(20), OLD);
  s.query("INSERT INTO media VALUES (?, NULL, 'a', 'image/png', 100, ?)").run(id(21), NOW - 1000);
  s.query("INSERT INTO media VALUES (?, 'live', 'a', 'image/png', 100, ?)").run(id(22), OLD);
  s.query("INSERT INTO media VALUES (?, 'binned', 'a', 'image/png', 100, ?)").run(id(23), OLD);
  s.query("INSERT INTO media VALUES (?, 'gone-page', 'a', 'image/png', 50, ?)").run(id(24), OLD);
  s.query("INSERT INTO media VALUES (?, NULL, 'a', 'image/png', 100, ?)").run(id(25), OLD);
  const scan = { ws: "w1", ...(await scanWorkspace(d1(s) as any, false)) };
  expect(scan.failed).toEqual([]);
  const keyFor = (ws: string, m: string) => "ws/" + ws + "/media/" + m;
  const inR2 = new Set([1, 2, 3, 4, 5, 6, 7, 8, 20, 21, 22, 23, 24].map((n) => keyFor("w1", id(n))));
  const out = orphanCandidates([scan], inR2, keyFor, NOW);
  expect(out.candidates.map((c) => c.id).sort()).toEqual([id(20), id(24)]);
  expect(out.bytes).toBe(150);
  expect(out.kept).toEqual({ referenced: 8, young: 1, onLivePage: 2, notInR2: 1, scanFailed: 0 });
});

test("a table with more rows than one read page is read to the end", async () => {
  const s = workspace();
  for (let i = 0; i < 95; i++) s.query("INSERT INTO editor_history VALUES ('p', ?)").run(i === 94 ? '[{"text":"/media/' + id(40) + '"}]' : "[]");
  s.query("INSERT INTO media VALUES (?, NULL, 'a', 'image/png', 10, ?)").run(id(40), OLD);
  const scan = { ws: "w", ...(await scanWorkspace(d1(s) as any, false)) };
  expect(scan.tables).toContain("editor_history:95");
  expect(orphanCandidates([scan], new Set(["w/" + id(40)]), (ws, m) => ws + "/" + m, NOW).candidates).toEqual([]);
});

test("an id mentioned in another workspace keeps the file; a workspace whose scan failed keeps all of its files", async () => {
  const a = workspace(), b = workspace();
  a.query("INSERT INTO media VALUES (?, NULL, 'a', 'image/png', 10, ?)").run(id(30), OLD);
  b.exec(`INSERT INTO pages VALUES ('p','P')`);
  b.exec(`INSERT INTO blocks VALUES ('p','x','![](/media/${id(30)})',NULL)`);
  const keyFor = (ws: string, m: string) => ws + "/" + m;
  const scans = [{ ws: "a", ...(await scanWorkspace(d1(a) as any, false)) }, { ws: "b", ...(await scanWorkspace(d1(b) as any, false)) }];
  expect(orphanCandidates(scans, new Set(["a/" + id(30)]), keyFor, NOW).candidates).toEqual([]);
  const lone = [{ ws: "a", ...(await scanWorkspace(d1(a) as any, false)) }];
  expect(orphanCandidates(lone, new Set(["a/" + id(30)]), keyFor, NOW).candidates.map((c) => c.id)).toEqual([id(30)]);
  lone[0].failed = ["blocks: busy"];
  expect(orphanCandidates(lone, new Set(["a/" + id(30)]), keyFor, NOW)).toMatchObject({ candidates: [], kept: { scanFailed: 1 } });
});
