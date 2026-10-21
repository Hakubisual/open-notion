-- acard-parts-core (#38): workspace-registered parts (code from an HTML block + data schema), shared by link or marked public. Additive and idempotent.
-- Down: DROP TABLE acard.parts;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS parts (id TEXT PRIMARY KEY, name TEXT NOT NULL, version bigint NOT NULL DEFAULT 1, code TEXT NOT NULL, schema TEXT NOT NULL DEFAULT '{}', sample TEXT NOT NULL DEFAULT '{}', owner TEXT NOT NULL DEFAULT '', shared bigint NOT NULL DEFAULT 0, public bigint NOT NULL DEFAULT 0, token_hash TEXT NULL, source TEXT NOT NULL DEFAULT '', created bigint NOT NULL DEFAULT 0, updated bigint NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS parts_token ON parts(token_hash);
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON parts TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.parts; CREATE POLICY acard_app_all ON acard.parts TO acard_app USING (true) WITH CHECK (true);
