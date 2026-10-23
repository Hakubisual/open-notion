-- acard-human-edit: a page's AI mark default (edit | lock | ref | smart, assets/ai-marks.js) and Notion's small text.
-- 'edit' and 0 keep every existing page exactly as before. The D1/SQLite stores get the same columns from
-- editor-pages.js (ensureEditorSchema, ALTER TABLE ... ADD COLUMN, an existing column is ignored).
-- Additive and idempotent; no policy, grant, function or trigger changes (editor_page_settings keeps its 001 RLS).
-- Down: ALTER TABLE acard.editor_page_settings DROP COLUMN ai, DROP COLUMN small;
SET search_path = acard;
ALTER TABLE editor_page_settings ADD COLUMN IF NOT EXISTS ai TEXT NOT NULL DEFAULT 'edit';
ALTER TABLE editor_page_settings ADD COLUMN IF NOT EXISTS small bigint NOT NULL DEFAULT 0;
