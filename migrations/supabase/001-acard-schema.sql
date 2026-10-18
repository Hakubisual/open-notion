CREATE SCHEMA IF NOT EXISTS acard;
REVOKE ALL ON SCHEMA acard FROM anon, authenticated, public;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, parent TEXT, ord bigint NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'note', updated bigint NOT NULL, source TEXT NOT NULL DEFAULT 'editor', hash TEXT);
CREATE TABLE IF NOT EXISTS blocks (page TEXT NOT NULL, id TEXT NOT NULL, ord bigint NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', checked bigint NOT NULL DEFAULT 0, indent bigint NOT NULL DEFAULT 0, meta TEXT, PRIMARY KEY (page, id));
CREATE TABLE IF NOT EXISTS links (src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS blocks_page_ord ON blocks(page, ord);
CREATE INDEX IF NOT EXISTS pages_parent_ord ON pages(parent, ord);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, page TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, bytes bigint NOT NULL, created bigint NOT NULL);
CREATE TABLE IF NOT EXISTS link_cache (url TEXT PRIMARY KEY, title TEXT, description TEXT, image TEXT, site TEXT, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS media_page ON media(page);
CREATE TABLE IF NOT EXISTS databases (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  parent TEXT,
  ord bigint NOT NULL DEFAULT 0,
  created bigint NOT NULL DEFAULT 0,
  updated bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS db_properties (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  config TEXT,
  ord bigint NOT NULL DEFAULT 0,
  width bigint,
  hidden bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS db_rows (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  page TEXT,
  props TEXT,
  ord bigint NOT NULL DEFAULT 0,
  created bigint NOT NULL DEFAULT 0,
  updated bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS db_views (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'table',
  config TEXT,
  ord bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS db_templates (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  props TEXT,
  blocks TEXT,
  ord bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS db_properties_database_ord ON db_properties(database_id, ord);
CREATE INDEX IF NOT EXISTS db_rows_database_ord ON db_rows(database_id, ord);
CREATE INDEX IF NOT EXISTS db_views_database_ord ON db_views(database_id, ord);
CREATE INDEX IF NOT EXISTS db_templates_database_ord ON db_templates(database_id, ord);
CREATE INDEX IF NOT EXISTS databases_slug ON databases(slug);
CREATE TABLE IF NOT EXISTS editor_page_settings (page TEXT PRIMARY KEY, icon TEXT, cover TEXT, width TEXT NOT NULL DEFAULT 'default', font TEXT NOT NULL DEFAULT 'default', favorite bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS editor_comments (id TEXT PRIMARY KEY, page TEXT NOT NULL, block_id TEXT, text TEXT NOT NULL, resolved bigint NOT NULL DEFAULT 0, created bigint NOT NULL, updated bigint NOT NULL);
CREATE INDEX IF NOT EXISTS editor_comments_page ON editor_comments(page, created);
CREATE TABLE IF NOT EXISTS editor_history (rowid bigserial, id TEXT PRIMARY KEY, page TEXT NOT NULL, title TEXT NOT NULL, created bigint NOT NULL, snapshot TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS editor_history_page ON editor_history(page, created);
CREATE TABLE IF NOT EXISTS editor_trash (page TEXT PRIMARY KEY, deleted bigint NOT NULL, permanent bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS editor_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, created bigint NOT NULL, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL DEFAULT 'read', created bigint NOT NULL, last_used bigint, revoked bigint);
CREATE TABLE IF NOT EXISTS agent_activity (id TEXT PRIMARY KEY, page TEXT NOT NULL, agent TEXT NOT NULL, via TEXT NOT NULL, action TEXT NOT NULL, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS agent_activity_page ON agent_activity(page, created);
CREATE TABLE IF NOT EXISTS page_tags (page TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (page, tag));
CREATE TABLE IF NOT EXISTS agent_grants (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, scopes TEXT NOT NULL, created bigint NOT NULL, revoked bigint);
CREATE TABLE IF NOT EXISTS feature_templates_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS share_links (token_hash TEXT PRIMARY KEY, page TEXT NOT NULL, created bigint, revoked bigint NULL, noindex bigint NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS share_links_page ON share_links(page, revoked);
CREATE TABLE IF NOT EXISTS db_rules (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, config TEXT NOT NULL, enabled bigint NOT NULL DEFAULT 1, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS db_rules_database ON db_rules(database_id, created, id);
CREATE TABLE IF NOT EXISTS db_forms (id TEXT PRIMARY KEY, database_id TEXT NOT NULL UNIQUE, config TEXT NOT NULL, created bigint NOT NULL, updated bigint NOT NULL);
CREATE TABLE IF NOT EXISTS share_rules (id TEXT PRIMARY KEY, page TEXT NOT NULL, principal TEXT NOT NULL, role TEXT NOT NULL, expires bigint, created bigint NOT NULL, revoked bigint, token_hash TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS share_rules_page ON share_rules(page, revoked);
CREATE INDEX IF NOT EXISTS share_rules_principal ON share_rules(principal, revoked);
CREATE TABLE IF NOT EXISTS share_pages (page TEXT PRIMARY KEY, inherit bigint NOT NULL DEFAULT 1, allow_export bigint NOT NULL DEFAULT 0, allow_index bigint NOT NULL DEFAULT 0, publish_subpages bigint NOT NULL DEFAULT 0, site_title TEXT);
CREATE TABLE IF NOT EXISTS share_invites (id_hash TEXT PRIMARY KEY, rule TEXT NOT NULL, email TEXT NOT NULL, code_hash TEXT NOT NULL, created bigint NOT NULL, expires bigint NOT NULL, tries bigint NOT NULL DEFAULT 0, used bigint);
CREATE INDEX IF NOT EXISTS share_invites_rule ON share_invites(rule);
CREATE TABLE IF NOT EXISTS share_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, links TEXT NOT NULL DEFAULT '[]', created bigint NOT NULL, expires bigint NOT NULL, revoked bigint);
CREATE TABLE IF NOT EXISTS share_requests (id TEXT PRIMARY KEY, page TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, note TEXT, created bigint NOT NULL, status TEXT NOT NULL DEFAULT 'open');
CREATE INDEX IF NOT EXISTS share_requests_page ON share_requests(page, status);
CREATE TABLE IF NOT EXISTS share_rate (key TEXT PRIMARY KEY, count bigint NOT NULL, reset bigint NOT NULL);
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE databases ENABLE ROW LEVEL SECURITY;
ALTER TABLE db_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE db_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE db_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE db_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_page_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_trash ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_templates_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE db_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE db_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA acard FROM anon, authenticated, public;
