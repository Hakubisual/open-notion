CREATE TABLE IF NOT EXISTS db_rules (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, config TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS db_rules_database ON db_rules(database_id, created, id);
