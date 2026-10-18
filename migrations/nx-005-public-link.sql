CREATE TABLE IF NOT EXISTS share_links (token_hash TEXT PRIMARY KEY, page TEXT NOT NULL, created INTEGER, revoked INTEGER NULL, noindex INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS share_links_page ON share_links(page, revoked);
