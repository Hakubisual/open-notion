-- acard-parts-core (#38): part themes, the look (CSS variables for light/dark) a part takes; registered and shared like parts. Additive and idempotent.
-- Down: DROP TABLE acard.part_themes;
SET search_path = acard;
CREATE TABLE IF NOT EXISTS part_themes (id TEXT PRIMARY KEY, name TEXT NOT NULL, light TEXT NULL, dark TEXT NULL, owner TEXT NOT NULL DEFAULT '', shared bigint NOT NULL DEFAULT 0, public bigint NOT NULL DEFAULT 0, created bigint NOT NULL DEFAULT 0, updated bigint NOT NULL DEFAULT 0);
ALTER TABLE part_themes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON part_themes TO acard_app;
DROP POLICY IF EXISTS acard_app_all ON acard.part_themes; CREATE POLICY acard_app_all ON acard.part_themes TO acard_app USING (true) WITH CHECK (true);
