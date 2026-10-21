-- notion-parity-5: two-way relation links (C2), the per-pair lock row and per-database settings (C12 sub-items). Additive and idempotent.
-- Down: DROP TABLE acard.db_relation_links; DROP TABLE acard.db_relation_locks; ALTER TABLE acard.databases DROP COLUMN config;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS db_relation_links (prop_id TEXT NOT NULL, src_row TEXT NOT NULL, dst_row TEXT NOT NULL, ord bigint NOT NULL DEFAULT 0, PRIMARY KEY (prop_id, src_row, dst_row));
CREATE INDEX IF NOT EXISTS db_relation_links_dst ON db_relation_links(dst_row);
ALTER TABLE db_relation_links ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON db_relation_links TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.db_relation_links; CREATE POLICY acard_app_all ON acard.db_relation_links TO acard_app USING (true) WITH CHECK (true);
CREATE TABLE IF NOT EXISTS db_relation_locks (pair_key TEXT PRIMARY KEY, version bigint NOT NULL DEFAULT 0);
ALTER TABLE db_relation_locks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON db_relation_locks TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.db_relation_locks; CREATE POLICY acard_app_all ON acard.db_relation_locks TO acard_app USING (true) WITH CHECK (true);
ALTER TABLE databases ADD COLUMN IF NOT EXISTS config TEXT;
