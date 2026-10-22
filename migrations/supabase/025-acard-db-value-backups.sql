-- #86: values a property held before it was turned into a relation. They are kept here instead of becoming links.
-- Additive and idempotent. Down: DROP TABLE acard.db_value_backups;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS db_value_backups (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, prop_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, value TEXT NOT NULL, reason TEXT NOT NULL, created bigint NOT NULL);
CREATE INDEX IF NOT EXISTS db_value_backups_database ON db_value_backups(database_id, prop_id);
ALTER TABLE db_value_backups ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON db_value_backups TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.db_value_backups; CREATE POLICY acard_app_all ON acard.db_value_backups TO acard_app USING (true) WITH CHECK (true);
