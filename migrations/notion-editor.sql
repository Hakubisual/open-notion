-- Additive and idempotent; run after the worker's base pages/blocks/links schema.
CREATE TABLE IF NOT EXISTS editor_page_settings (page TEXT PRIMARY KEY, icon TEXT, cover TEXT, width TEXT NOT NULL DEFAULT 'default', font TEXT NOT NULL DEFAULT 'default', favorite INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS editor_comments (id TEXT PRIMARY KEY, page TEXT NOT NULL, block_id TEXT, text TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS editor_comments_page ON editor_comments(page, created);
CREATE TABLE IF NOT EXISTS editor_history (id TEXT PRIMARY KEY, page TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, snapshot TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS editor_history_page ON editor_history(page, created);
-- Permanent deletion retains this marker, preventing later seed sync resurrection.
CREATE TABLE IF NOT EXISTS editor_trash (page TEXT PRIMARY KEY, deleted INTEGER NOT NULL, permanent INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS editor_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL, snapshot TEXT NOT NULL);
