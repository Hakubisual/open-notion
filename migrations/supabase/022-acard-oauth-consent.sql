-- acard-oauth-browser follow-up: one row per answered agent-connection consent, so two approves sent together cannot
-- both mint a code (Workers KV has no atomic compare-and-delete). id = SHA-256 of the consent handle; done = the
-- redirect sealed with a key only the handle holder can derive (never a plaintext code). Rows older than 10 minutes
-- are deleted by the app on each claim. Additive and idempotent.
-- Down: DROP TABLE acard.oauth_consent_claims;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS oauth_consent_claims (id TEXT PRIMARY KEY, done TEXT, created bigint NOT NULL);
ALTER TABLE oauth_consent_claims ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_consent_claims TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.oauth_consent_claims; CREATE POLICY acard_app_all ON acard.oauth_consent_claims TO acard_app USING (true) WITH CHECK (true);
