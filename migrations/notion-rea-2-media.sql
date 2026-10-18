-- notion-rea-2: 미디어 업로드와 링크 미리보기. 워커의 ensureSchema 와 같은 문장이라 여러 번 돌려도 된다.
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, page TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS link_cache (url TEXT PRIMARY KEY, title TEXT, description TEXT, image TEXT, site TEXT, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS media_page ON media(page);
