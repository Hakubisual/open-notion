-- acard-persona-migrate (#128): tables the Worker creates only on SQLite stores (features/home-setup.js page_imports,
-- features/first-run.js first_run) never existed on Postgres, because gate/pg-d1.ts turns CREATE statements into no-ops.
-- On the owner workspace /api/import and /api/import/md therefore failed with "relation page_imports does not exist"
-- after the page row was written. This adds them, plus the import batch tables of the new importer (features/import.js):
-- import_batches = one upload (status, report), import_items = every page / media / database the batch made, keyed by
-- the source path so a second upload of the same export can be recognised and a batch can be undone or aborted.
-- Server-only like every acard table: RLS on, only acard_app (the Worker) reaches them. No trigger, no function; idempotent.
-- Down: DROP TABLE acard.import_items, acard.import_batches, acard.first_run, acard.page_imports;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS page_imports (page TEXT PRIMARY KEY, kind TEXT NOT NULL, created bigint NOT NULL);
CREATE TABLE IF NOT EXISTS first_run (id bigint PRIMARY KEY, state TEXT NOT NULL, connected_at bigint, client TEXT, project TEXT, project_slug TEXT, tasks_slug TEXT, pages TEXT, consent TEXT, updated bigint NOT NULL);
CREATE TABLE IF NOT EXISTS import_batches (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, created bigint NOT NULL, updated bigint NOT NULL, report TEXT);
CREATE TABLE IF NOT EXISTS import_items (batch TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (batch, source, kind));
CREATE INDEX IF NOT EXISTS import_items_source ON import_items(source);
CREATE INDEX IF NOT EXISTS import_items_ref ON import_items(ref);
ALTER TABLE page_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE first_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON page_imports, first_run, import_batches, import_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON page_imports, first_run, import_batches, import_items TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.page_imports;
-- reason: acard_app is the Worker's own server-only login role and needs every row of this table (same as every other acard
-- table, migration 003); the policy is TO acard_app only, never anon/authenticated/PUBLIC.
CREATE POLICY acard_app_all ON acard.page_imports TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.first_run;
-- reason: acard_app is the Worker's own server-only login role and needs every row of this table (same as every other acard
-- table, migration 003); the policy is TO acard_app only, never anon/authenticated/PUBLIC.
CREATE POLICY acard_app_all ON acard.first_run TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.import_batches;
-- reason: acard_app is the Worker's own server-only login role and needs every row of this table (same as every other acard
-- table, migration 003); the policy is TO acard_app only, never anon/authenticated/PUBLIC.
CREATE POLICY acard_app_all ON acard.import_batches TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.import_items;
-- reason: acard_app is the Worker's own server-only login role and needs every row of this table (same as every other acard
-- table, migration 003); the policy is TO acard_app only, never anon/authenticated/PUBLIC.
CREATE POLICY acard_app_all ON acard.import_items TO acard_app USING (true) WITH CHECK (true);
