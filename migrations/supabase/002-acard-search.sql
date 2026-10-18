SET search_path = acard;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS page_fts_state (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS page_fts_dirty (slug text PRIMARY KEY);
ALTER TABLE page_fts_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_fts_dirty ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS page_fts (rowid bigserial, slug text PRIMARY KEY, title text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS page_fts_ko (rowid bigserial, slug text PRIMARY KEY, title text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '');
ALTER TABLE page_fts ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_fts_ko ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION acard.fts_mark_dirty() RETURNS trigger LANGUAGE plpgsql SET search_path = acard AS $$
DECLARE s text;
BEGIN
  IF TG_TABLE_NAME = 'pages' THEN s := COALESCE(NEW.slug, OLD.slug);
  ELSE s := COALESCE(NEW.page, OLD.page);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'pages' THEN s := OLD.slug; ELSE s := OLD.page; END IF;
  END IF;
  INSERT INTO page_fts_dirty (slug) VALUES (s) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION acard.fts_trash_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = acard AS $$
BEGIN
  DELETE FROM page_fts WHERE slug = NEW.page;
  DELETE FROM page_fts_ko WHERE slug = NEW.page;
  DELETE FROM page_fts_dirty WHERE slug = NEW.page;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fts_pages ON pages;
CREATE TRIGGER fts_pages AFTER INSERT OR UPDATE OR DELETE ON pages FOR EACH ROW EXECUTE FUNCTION acard.fts_mark_dirty();
DROP TRIGGER IF EXISTS fts_blocks ON blocks;
CREATE TRIGGER fts_blocks AFTER INSERT OR UPDATE OR DELETE ON blocks FOR EACH ROW EXECUTE FUNCTION acard.fts_mark_dirty();
DROP TRIGGER IF EXISTS fts_trash_ins ON editor_trash;
CREATE TRIGGER fts_trash_ins AFTER INSERT ON editor_trash FOR EACH ROW EXECUTE FUNCTION acard.fts_trash_insert();
DROP TRIGGER IF EXISTS fts_trash_del ON editor_trash;
CREATE TRIGGER fts_trash_del AFTER DELETE ON editor_trash FOR EACH ROW EXECUTE FUNCTION acard.fts_mark_dirty();
REVOKE ALL ON ALL TABLES IN SCHEMA acard FROM anon, authenticated, public;
CREATE INDEX IF NOT EXISTS page_fts_trgm ON page_fts USING gin ((title || ' ' || body) extensions.gin_trgm_ops);
