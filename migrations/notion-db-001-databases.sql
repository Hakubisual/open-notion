-- notion-db 레인: 데이터베이스(표·보드·갤러리·목록·캘린더·타임라인) 표.
-- 규칙: additive / idempotent 만. 기존 표와 데이터는 건드리지 않는다.
-- 워커의 ensureSchema() 도 같은 문장을 들고 있다(첫 요청 때 스스로 만든다).

CREATE TABLE IF NOT EXISTS databases (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  parent TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS db_properties (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  config TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS db_rows (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  page TEXT,
  props TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS db_views (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'table',
  config TEXT,
  ord INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS db_templates (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  props TEXT,
  blocks TEXT,
  ord INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS db_properties_database_ord ON db_properties(database_id, ord);
CREATE INDEX IF NOT EXISTS db_rows_database_ord ON db_rows(database_id, ord);
CREATE INDEX IF NOT EXISTS db_views_database_ord ON db_views(database_id, ord);
CREATE INDEX IF NOT EXISTS db_templates_database_ord ON db_templates(database_id, ord);
CREATE INDEX IF NOT EXISTS databases_slug ON databases(slug);
