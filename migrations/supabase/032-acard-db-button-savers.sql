-- #107: who last saved each button's actions (owner, or guest session + email + the pages it could edit then). Pressing a
-- button a guest saved runs with no more than that guest's permission (gate/_worker.js buttonPressDb); a guest that can no
-- longer be resolved stops the button. button = prop:<property id> | block:<page slug>:<block id>.
-- Only the Worker (role acard_app) reads or writes it; anon/authenticated have no grant (the acard schema is not exposed).
-- Additive and idempotent. No triggers. Rollback: migrations/supabase/rollback/032-acard-db-button-savers.down.sql
SET search_path = acard;
CREATE TABLE IF NOT EXISTS db_button_savers (button TEXT PRIMARY KEY, kind TEXT NOT NULL, session TEXT, email TEXT, roles TEXT, saved bigint NOT NULL);
ALTER TABLE db_button_savers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON db_button_savers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON db_button_savers TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.db_button_savers;
-- reason: acard_app is the Worker's own server-only login role and needs every row of this table (same as every other acard
-- table, migration 003); the policy is TO acard_app only, never anon/authenticated/PUBLIC.
CREATE POLICY acard_app_all ON acard.db_button_savers TO acard_app USING (true) WITH CHECK (true);
