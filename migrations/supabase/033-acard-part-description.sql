-- #38 stage 2: a registered part carries a one-line description (part gallery, '/' menu, MCP list_parts).
-- '' = no description. The Worker trims it to 200 characters. The D1/SQLite stores get the same column from
-- features/parts.js (schema hook, ALTER TABLE ... ADD COLUMN, an existing column is ignored).
-- Additive and idempotent; no policy, grant, function or trigger changes (parts keeps its 017 RLS and policy).
-- Down: ALTER TABLE acard.parts DROP COLUMN description;
SET search_path = acard;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
