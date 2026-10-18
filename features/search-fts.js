(() => {
  const schema = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(slug UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')",
    "CREATE VIRTUAL TABLE IF NOT EXISTS page_fts_ko USING fts5(slug UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')",
    "CREATE TABLE IF NOT EXISTS page_fts_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS page_fts_dirty (slug TEXT PRIMARY KEY)",
    "DROP TRIGGER IF EXISTS page_fts_pages_insert",
    "CREATE TRIGGER IF NOT EXISTS page_fts_v2_pages_insert AFTER INSERT ON pages BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.slug WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.slug); END",
    "DROP TRIGGER IF EXISTS page_fts_pages_update",
    "CREATE TRIGGER IF NOT EXISTS page_fts_v2_pages_update AFTER UPDATE ON pages BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.slug WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.slug); END",
    "DROP TRIGGER IF EXISTS page_fts_pages_delete",
    "CREATE TRIGGER IF NOT EXISTS page_fts_v2_pages_delete AFTER DELETE ON pages BEGIN INSERT INTO page_fts_dirty (slug) SELECT old.slug WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = old.slug); END",
    "DROP TRIGGER IF EXISTS page_fts_blocks_insert",
    "CREATE TRIGGER IF NOT EXISTS page_fts_v2_blocks_insert AFTER INSERT ON blocks BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.page); END",
    "DROP TRIGGER IF EXISTS page_fts_blocks_update",
    "CREATE TRIGGER IF NOT EXISTS page_fts_v2_blocks_update AFTER UPDATE ON blocks BEGIN INSERT INTO page_fts_dirty (slug) SELECT new.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = new.page); END",
    "DROP TRIGGER IF EXISTS page_fts_blocks_delete",
    "CREATE TRIGGER IF NOT EXISTS page_fts_v2_blocks_delete AFTER DELETE ON blocks BEGIN INSERT INTO page_fts_dirty (slug) SELECT old.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = old.page); END",
    "CREATE TRIGGER IF NOT EXISTS page_fts_trash_insert AFTER INSERT ON editor_trash BEGIN DELETE FROM page_fts WHERE slug = new.page; DELETE FROM page_fts_ko WHERE slug = new.page; DELETE FROM page_fts_dirty WHERE slug = new.page; END",
    "DROP TRIGGER IF EXISTS page_fts_trash_delete",
    "CREATE TRIGGER IF NOT EXISTS page_fts_v2_trash_delete AFTER DELETE ON editor_trash BEGIN INSERT INTO page_fts_dirty (slug) SELECT old.page WHERE NOT EXISTS (SELECT 1 FROM page_fts_dirty WHERE slug = old.page); END",
  ];

  // unicode61 treats a Hangul word as one token; trigram MATCH cannot find
  // two-syllable queries at all. Phrase matching syllables handles both short
  // and infix Korean searches without scanning bodies. A boundary token keeps
  // phrases from accidentally joining separate words or blocks.
  const koreanText = text => String(text).normalize("NFC").replace(/[\uac00-\ud7a3]+/g, word => " acardboundary " + [...word].join(" ") + " acardboundary ");

  async function reindex(db, slug) {
    // Clear before reading: any later direct mutation leaves a durable dirty
    // entry for the next search, including mutations that bypass saveBlocks.
    await db.prepare("DELETE FROM page_fts_dirty WHERE slug = ?").bind(slug).run();
    const page = await db.prepare("SELECT p.slug, p.title, COALESCE((SELECT group_concat(text, char(10)) FROM (SELECT text FROM blocks WHERE page = p.slug ORDER BY ord)), '') AS body FROM pages p WHERE p.slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug)").bind(slug).first();
    const statements = [
      db.prepare("DELETE FROM page_fts WHERE slug = ?").bind(slug),
      db.prepare("DELETE FROM page_fts_ko WHERE slug = ?").bind(slug),
    ];
    if (page) {
      statements.push(db.prepare("INSERT INTO page_fts (slug, title, body) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = ?)").bind(slug, page.title, page.body, slug));
      statements.push(db.prepare("INSERT INTO page_fts_ko (slug, title, body) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = ?)").bind(slug, koreanText(page.title), koreanText(page.body), slug));
    }
    await db.batch(statements);
  }

  async function search(db, input, limit) {
    const q = input.trim().normalize("NFC");
    const terms = q.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
    if (!terms.length) return [];
    const state = await db.prepare("SELECT value FROM page_fts_state WHERE key = 'version'").first();
    const populated = await db.prepare("SELECT rowid FROM page_fts LIMIT 1").first();
    if (state?.value !== "1" || !populated) {
      await db.batch([
        db.prepare("DELETE FROM page_fts"),
        db.prepare("DELETE FROM page_fts_ko"),
        db.prepare("INSERT OR IGNORE INTO page_fts_dirty (slug) SELECT slug FROM pages"),
      ]);
    }
    // Bulk reindex: a few round trips per 50 pages instead of ~5 per page. A 100+ page backlog
    // (bulk copies, imports) made the first search take ~15-20 s on Durable Object and Hyperdrive backends.
    const dirty = (await db.prepare("SELECT slug FROM page_fts_dirty").all()).results ?? [];
    for (let i = 0; i < dirty.length; i += 50) {
      const slugs = dirty.slice(i, i + 50).map(row => String(row.slug));
      const marks = slugs.map(() => "?").join(", ");
      // Clear before reading, as reindex() does, so later writes leave a fresh dirty mark.
      await db.prepare(`DELETE FROM page_fts_dirty WHERE slug IN (${marks})`).bind(...slugs).run();
      const pages = (await db.prepare(`SELECT p.slug, p.title, COALESCE((SELECT group_concat(text, char(10)) FROM (SELECT text FROM blocks WHERE page = p.slug ORDER BY ord) ordered), '') AS body FROM pages p WHERE p.slug IN (${marks}) AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug)`).bind(...slugs).all()).results ?? [];
      const statements = [
        db.prepare(`DELETE FROM page_fts WHERE slug IN (${marks})`).bind(...slugs),
        db.prepare(`DELETE FROM page_fts_ko WHERE slug IN (${marks})`).bind(...slugs),
      ];
      for (const page of pages) {
        statements.push(db.prepare("INSERT INTO page_fts (slug, title, body) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = ?)").bind(page.slug, page.title, page.body, page.slug));
        statements.push(db.prepare("INSERT INTO page_fts_ko (slug, title, body) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = ?)").bind(page.slug, koreanText(page.title), koreanText(page.body), page.slug));
      }
      await db.batch(statements);
    }
    await db.prepare("INSERT INTO page_fts_state (key, value) VALUES ('version', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();

    if (db.dialect === "pg") {
      const where = terms.map(() => "(f.title || ' ' || f.body) ILIKE ?").join(" AND ");
      const like = terms.map(term => "%" + term.replace(/[\\%_]/g, c => "\\" + c) + "%");
      const rows = await db.prepare(`SELECT p.slug, p.title, p.parent, p.updated, p.kind,
        substr(f.body, GREATEST(1, strpos(lower(f.body), lower(?)) - 45), 180) AS hit
        FROM page_fts f JOIN pages p ON p.slug = f.slug
        WHERE ${where} AND p.kind != 'db_row'
          AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug)
        ORDER BY (CASE WHEN f.title ILIKE ? THEN 0 ELSE 1 END), p.slug LIMIT ?`)
        .bind(terms[0], ...like, like[0], limit).all();
      return (rows.results ?? []).map(row => ({ ...row, hit: String(row.hit ?? "").slice(0, 180) }));
    }
    const korean = /[\uac00-\ud7a3]/.test(q);
    const table = korean ? "page_fts_ko" : "page_fts";
    const match = terms.map(term => {
      const text = korean ? term.replace(/[\uac00-\ud7a3]+/g, word => [...word].join(" ")) : term;
      return '"' + text + '"' + (/[\uac00-\ud7a3]/.test(term) ? "" : "*");
    }).join(" AND ");
    const rows = await db.prepare(`SELECT p.slug, p.title, p.parent, p.updated, p.kind,
      ${korean ? "substr(original.body, max(1, instr(original.body, ?) - 45), 180)" : "snippet(page_fts, 2, '', '', '...', 24)"} AS hit
      FROM ${table} JOIN pages p ON p.slug = ${table}.slug
      ${korean ? "JOIN page_fts original ON original.slug = p.slug" : ""}
      WHERE ${table} MATCH ? AND p.kind != 'db_row'
        AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug)
      ORDER BY bm25(${table}, 0, 10, 1), p.slug LIMIT ?`)
      .bind(...(korean ? [terms.find(term => /[\uac00-\ud7a3]/.test(term))] : []), match, limit).all();
    return (rows.results ?? []).map(row => ({ ...row, hit: String(row.hit ?? "").slice(0, 180) }));
  }

  registerFeature({
    schema: async db => { await db.batch(schema.map(sql => db.prepare(sql))); },
    afterSave: async (db, slug) => { await reindex(db, slug); },
    services: { search },
  });
})();
