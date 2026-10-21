-- acard-persona-qa organize mode (#6, owner choice 2026-10-19): agent memo notes become drafts the user confirms. Additive and idempotent.
-- Down: DROP TABLE acard.memo_drafts, acard.memo_apply_batches, acard.organize_settings;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS memo_drafts (id TEXT PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, client TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'pending', batch TEXT, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS memo_drafts_project ON memo_drafts(project, state);
CREATE TABLE IF NOT EXISTS memo_apply_batches (id TEXT PRIMARY KEY, project TEXT NOT NULL, page TEXT NOT NULL, before_blocks TEXT NOT NULL, page_updated bigint NOT NULL, hashes TEXT NOT NULL, undone bigint NOT NULL DEFAULT 0, created bigint NOT NULL);
CREATE TABLE IF NOT EXISTS organize_settings (id bigint PRIMARY KEY, json TEXT NOT NULL, updated bigint NOT NULL DEFAULT 0);
ALTER TABLE memo_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memo_apply_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE organize_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON memo_drafts, memo_apply_batches, organize_settings TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.memo_drafts; CREATE POLICY acard_app_all ON acard.memo_drafts TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.memo_apply_batches; CREATE POLICY acard_app_all ON acard.memo_apply_batches TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.organize_settings; CREATE POLICY acard_app_all ON acard.organize_settings TO acard_app USING (true) WITH CHECK (true);
