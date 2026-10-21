-- notion-parity-3: ID property counters (C9) and repeating row templates (C5). Additive and idempotent.
-- Down: DROP TABLE acard.db_counters; ALTER TABLE acard.db_templates DROP COLUMN recurrence; DROP TABLE acard.db_template_runs;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS db_counters (property_id TEXT PRIMARY KEY, next bigint NOT NULL DEFAULT 1);
ALTER TABLE db_counters ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON db_counters TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.db_counters; CREATE POLICY acard_app_all ON acard.db_counters TO acard_app USING (true) WITH CHECK (true);
ALTER TABLE db_templates ADD COLUMN IF NOT EXISTS recurrence TEXT;
CREATE TABLE IF NOT EXISTS db_template_runs (template_id TEXT NOT NULL, occurrence bigint NOT NULL, row_id TEXT NOT NULL, created bigint NOT NULL, PRIMARY KEY (template_id, occurrence));
ALTER TABLE db_template_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON db_template_runs TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.db_template_runs; CREATE POLICY acard_app_all ON acard.db_template_runs TO acard_app USING (true) WITH CHECK (true);
