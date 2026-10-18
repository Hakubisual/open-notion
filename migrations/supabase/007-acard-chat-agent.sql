-- acard-chat-agent: per-request chat latency and undo data for chat suggestions. Additive and idempotent.
SET search_path = acard;
CREATE TABLE IF NOT EXISTS agent_latency (id TEXT PRIMARY KEY, model TEXT NOT NULL, pre bigint NOT NULL, ttft bigint, total bigint NOT NULL, hedged bigint NOT NULL DEFAULT 0, ok bigint NOT NULL DEFAULT 1, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS agent_latency_created ON agent_latency(created);
CREATE TABLE IF NOT EXISTS agent_undo (suggestion TEXT PRIMARY KEY, data TEXT NOT NULL, confirm TEXT, created bigint NOT NULL);
ALTER TABLE agent_latency ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_undo ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_latency, agent_undo TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.agent_latency; CREATE POLICY acard_app_all ON acard.agent_latency TO acard_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acard_app_all ON acard.agent_undo; CREATE POLICY acard_app_all ON acard.agent_undo TO acard_app USING (true) WITH CHECK (true);
