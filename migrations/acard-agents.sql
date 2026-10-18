-- Additive and idempotent; the worker also runs these at startup (ensureAgentSchema in agent-api.js).
CREATE TABLE IF NOT EXISTS agent_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL DEFAULT 'read', created INTEGER NOT NULL, last_used INTEGER, revoked INTEGER);
CREATE TABLE IF NOT EXISTS agent_activity (id TEXT PRIMARY KEY, page TEXT NOT NULL, agent TEXT NOT NULL, via TEXT NOT NULL, action TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS agent_activity_page ON agent_activity(page, created);
CREATE TABLE IF NOT EXISTS page_tags (page TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (page, tag));
CREATE TABLE IF NOT EXISTS agent_grants (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, scopes TEXT NOT NULL, created INTEGER NOT NULL, revoked INTEGER);
