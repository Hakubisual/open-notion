-- acard-project-folders: a page shown as a folder or an article (person's choice), and the reversible move of
-- agent-written long bodies of pages with sub-pages into a '개요' sub-page. Additive and idempotent.
-- Down: DROP TABLE acard.page_view, acard.page_view_moves;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS page_view (page TEXT PRIMARY KEY, mode TEXT NOT NULL, description TEXT, set_by TEXT NOT NULL DEFAULT 'person', updated bigint NOT NULL);
CREATE TABLE IF NOT EXISTS page_view_moves (id TEXT PRIMARY KEY, batch TEXT NOT NULL, page TEXT NOT NULL, child TEXT NOT NULL, blocks TEXT NOT NULL, created bigint NOT NULL, undone bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS page_view_moves_batch ON page_view_moves(batch);
ALTER TABLE page_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_view_moves ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON page_view, page_view_moves TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.page_view; CREATE POLICY acard_app_all ON acard.page_view TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.page_view_moves; CREATE POLICY acard_app_all ON acard.page_view_moves TO acard_app USING (true) WITH CHECK (true);
