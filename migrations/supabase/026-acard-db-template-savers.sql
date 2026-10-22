-- #86: who last saved each row template's values (owner, or guest session + email + the pages it could edit then) and why a
-- template stopped (blocked). The recurring tick and row-from-template check links with that saver's permission.
-- Additive and idempotent. Down: DROP TABLE acard.db_template_savers;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS db_template_savers (template_id TEXT PRIMARY KEY, kind TEXT NOT NULL, session TEXT, email TEXT, roles TEXT, saved bigint NOT NULL, blocked TEXT, blocked_at bigint);
ALTER TABLE db_template_savers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON db_template_savers TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.db_template_savers; CREATE POLICY acard_app_all ON acard.db_template_savers TO acard_app USING (true) WITH CHECK (true);
