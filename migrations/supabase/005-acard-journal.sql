-- acard-mcp-journal: agent work journal (sessions, events, memory, daily digests). Additive and idempotent.
SET search_path = acard;
CREATE TABLE IF NOT EXISTS journal_sessions (id TEXT PRIMARY KEY, client TEXT NOT NULL, agent TEXT NOT NULL, page TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', summary TEXT, outcome TEXT, auto bigint NOT NULL DEFAULT 0, events bigint NOT NULL DEFAULT 0, created bigint NOT NULL, updated bigint NOT NULL, ended bigint);
CREATE INDEX IF NOT EXISTS journal_sessions_client ON journal_sessions(client, updated);
CREATE TABLE IF NOT EXISTS journal_events (id TEXT PRIMARY KEY, session TEXT NOT NULL, client TEXT NOT NULL, seq bigint NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, data TEXT, auto bigint NOT NULL DEFAULT 0, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS journal_events_session ON journal_events(session, seq);
CREATE INDEX IF NOT EXISTS journal_events_client ON journal_events(client, created);
CREATE TABLE IF NOT EXISTS agent_memory (id TEXT PRIMARY KEY, client TEXT NOT NULL, agent TEXT NOT NULL, key TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'general', text TEXT NOT NULL, version bigint NOT NULL, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS agent_memory_agent ON agent_memory(agent, key, version);
CREATE TABLE IF NOT EXISTS journal_digests (day TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL, created bigint NOT NULL);
ALTER TABLE journal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_digests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_sessions, journal_events, agent_memory, journal_digests TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.journal_sessions; CREATE POLICY acard_app_all ON acard.journal_sessions TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.journal_events; CREATE POLICY acard_app_all ON acard.journal_events TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.agent_memory; CREATE POLICY acard_app_all ON acard.agent_memory TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.journal_digests; CREATE POLICY acard_app_all ON acard.journal_digests TO acard_app USING (true) WITH CHECK (true);
