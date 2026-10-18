-- acard-auto-notes (#6): projects, always-on memo, auto-notes settings, backfill log. Additive and idempotent.
-- Down: DROP TABLE acard.projects, acard.memo_items, acard.auto_notes_settings, acard.project_backfill; ALTER TABLE acard.journal_sessions DROP COLUMN project;
SET search_path = acard;
ALTER TABLE journal_sessions ADD COLUMN IF NOT EXISTS project TEXT;
CREATE INDEX IF NOT EXISTS journal_sessions_project ON journal_sessions(project, updated);
CREATE TABLE IF NOT EXISTS projects (key TEXT PRIMARY KEY, name TEXT NOT NULL, page TEXT NOT NULL, memo_page TEXT NOT NULL, journal_page TEXT NOT NULL, muted bigint NOT NULL DEFAULT 0, memos bigint NOT NULL DEFAULT 0, last bigint NOT NULL DEFAULT 0, created bigint NOT NULL);
CREATE TABLE IF NOT EXISTS memo_items (id TEXT PRIMARY KEY, project TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, client TEXT NOT NULL DEFAULT '', created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS memo_items_hash ON memo_items(project, hash);
CREATE TABLE IF NOT EXISTS auto_notes_settings (id bigint PRIMARY KEY, enabled bigint NOT NULL DEFAULT 1, scope TEXT NOT NULL DEFAULT 'memo+journal', updated bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS project_backfill (id TEXT PRIMARY KEY, batch TEXT NOT NULL, session TEXT NOT NULL, page TEXT NOT NULL, prev_parent TEXT, project TEXT NOT NULL, undone bigint NOT NULL DEFAULT 0, created bigint NOT NULL);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE memo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_notes_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_backfill ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, memo_items, auto_notes_settings, project_backfill TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.projects; CREATE POLICY acard_app_all ON acard.projects TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.memo_items; CREATE POLICY acard_app_all ON acard.memo_items TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.auto_notes_settings; CREATE POLICY acard_app_all ON acard.auto_notes_settings TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.project_backfill; CREATE POLICY acard_app_all ON acard.project_backfill TO acard_app USING (true) WITH CHECK (true);
