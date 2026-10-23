-- acard-share: sharing rules, guest invites and sessions, access requests. Additive only.
-- Existing public links (share_links) are copied into share_rules as publish rules so old /p/<token> URLs keep resolving.
CREATE TABLE IF NOT EXISTS share_links (token_hash TEXT PRIMARY KEY, page TEXT NOT NULL, created INTEGER, revoked INTEGER NULL, noindex INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS share_rules (id TEXT PRIMARY KEY, page TEXT NOT NULL, principal TEXT NOT NULL, role TEXT NOT NULL, expires INTEGER, created INTEGER NOT NULL, revoked INTEGER, token_hash TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS share_rules_page ON share_rules(page, revoked);
CREATE INDEX IF NOT EXISTS share_rules_principal ON share_rules(principal, revoked);
CREATE TABLE IF NOT EXISTS share_pages (page TEXT PRIMARY KEY, inherit INTEGER NOT NULL DEFAULT 1, allow_export INTEGER NOT NULL DEFAULT 0, allow_index INTEGER NOT NULL DEFAULT 0, publish_subpages INTEGER NOT NULL DEFAULT 0, site_title TEXT, theme TEXT);
CREATE TABLE IF NOT EXISTS share_invites (id_hash TEXT PRIMARY KEY, rule TEXT NOT NULL, email TEXT NOT NULL, code_hash TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, used INTEGER);
CREATE INDEX IF NOT EXISTS share_invites_rule ON share_invites(rule);
CREATE TABLE IF NOT EXISTS share_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, links TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER);
CREATE TABLE IF NOT EXISTS share_requests (id TEXT PRIMARY KEY, page TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, note TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open');
CREATE INDEX IF NOT EXISTS share_requests_page ON share_requests(page, status);
CREATE TABLE IF NOT EXISTS share_rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
INSERT OR IGNORE INTO share_rules (id, page, principal, role, expires, created, revoked, token_hash) SELECT 'pl-' || token_hash, page, 'publish', 'read', NULL, COALESCE(created, 0), NULL, token_hash FROM share_links WHERE revoked IS NULL;
