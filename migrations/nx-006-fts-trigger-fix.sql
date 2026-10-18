-- A conflict policy on an outer UPSERT overrides trigger-level OR IGNORE, so dirty marks use NOT EXISTS instead.
DROP TRIGGER IF EXISTS page_fts_pages_insert;
DROP TRIGGER IF EXISTS page_fts_pages_update;
DROP TRIGGER IF EXISTS page_fts_pages_delete;
DROP TRIGGER IF EXISTS page_fts_blocks_insert;
DROP TRIGGER IF EXISTS page_fts_blocks_update;
DROP TRIGGER IF EXISTS page_fts_blocks_delete;
DROP TRIGGER IF EXISTS page_fts_trash_delete;
CREATE TRIGGER IF NOT EXISTS page_fts_v2_pages_insert AFTER INSERT ON pages BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.slug WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.slug); END;
CREATE TRIGGER IF NOT EXISTS page_fts_v2_pages_update AFTER UPDATE ON pages BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.slug WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.slug); END;
CREATE TRIGGER IF NOT EXISTS page_fts_v2_pages_delete AFTER DELETE ON pages BEGIN INSERT INTO page_fts_dirty (slug) SELECT old.slug WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = old.slug); END;
CREATE TRIGGER IF NOT EXISTS page_fts_v2_blocks_insert AFTER INSERT ON blocks BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.page); END;
CREATE TRIGGER IF NOT EXISTS page_fts_v2_blocks_update AFTER UPDATE ON blocks BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.page); END;
CREATE TRIGGER IF NOT EXISTS page_fts_v2_blocks_delete AFTER DELETE ON blocks BEGIN INSERT INTO page_fts_dirty (slug) SELECT old.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = old.page); END;
CREATE TRIGGER IF NOT EXISTS page_fts_v2_trash_delete AFTER DELETE ON editor_trash BEGIN INSERT INTO page_fts_dirty (slug) SELECT old.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = old.page); END;
