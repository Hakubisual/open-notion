-- acard-folders: tags with colors, folder activity log (undo), sibling order backfill. Additive and idempotent.
SET search_path = acard;
CREATE TABLE IF NOT EXISTS tags (name TEXT PRIMARY KEY, color TEXT NOT NULL DEFAULT 'gray', created bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS page_tags_tag ON page_tags(tag);
CREATE TABLE IF NOT EXISTS folder_activity (id TEXT PRIMARY KEY, batch TEXT NOT NULL, created bigint NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, undone bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS folder_activity_batch ON folder_activity(batch);
CREATE INDEX IF NOT EXISTS folder_activity_created ON folder_activity(created);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_activity ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON tags, folder_activity TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.tags; CREATE POLICY acard_app_all ON acard.tags TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.folder_activity; CREATE POLICY acard_app_all ON acard.folder_activity TO acard_app USING (true) WITH CHECK (true);
-- Backup the order once, then renumber siblings 10, 20, ... in the order the sidebar already shows (ord, title).
CREATE TABLE IF NOT EXISTS pages_ord_backup_006 AS SELECT slug, parent, ord FROM pages;
UPDATE pages p SET ord = r.n * 10 FROM (SELECT slug, row_number() OVER (PARTITION BY parent ORDER BY ord, title) AS n FROM pages) r WHERE r.slug = p.slug;
INSERT INTO tags (name, color, created) SELECT DISTINCT tag, 'gray', 0 FROM page_tags ON CONFLICT DO NOTHING;
