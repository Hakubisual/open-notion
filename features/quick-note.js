(() => {
  const inboxKey = "quick-note:inbox";
  const title = "빠른 메모";
  const maxText = 10000;
  const maxBody = 65536;

  registerFeature({
    api: async ({ request, path, method, db, helpers }) => {
      if (path !== "/api/quick-note") return null;
      if (method !== "POST") return helpers.json({ error: "POST로 보내 주세요." }, 405);

      let body;
      try {
        const reader = request.body?.getReader();
        if (!reader) return helpers.json({ error: "메모 내용이 필요해요." }, 400);
        const decoder = new TextDecoder();
        let raw = "", bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBody) {
            await reader.cancel();
            return helpers.json({ error: "요청이 너무 커요." }, 413);
          }
          raw += decoder.decode(value, { stream: true });
        }
        body = JSON.parse(raw + decoder.decode());
      } catch {
        return helpers.json({ error: "올바른 JSON을 보내 주세요." }, 400);
      }
      if (!body || Array.isArray(body) || typeof body !== "object"
        || typeof body.clientId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.clientId)
        || typeof body.text !== "string" || !body.text.trim()) {
        return helpers.json({ error: "clientId와 메모 내용을 확인해 주세요." }, 400);
      }
      if (body.text.length > maxText) return helpers.json({ error: "메모는 10000자까지 쓸 수 있어요." }, 413);
      const text = body.text.trim();
      const receiptKey = "quick-note:request:" + body.clientId;
      const reply = receipt => receipt.text === text
        ? helpers.json({ slug: receipt.slug, blockId: receipt.blockId, created: receipt.created, clientId: body.clientId })
        : helpers.json({ error: "같은 clientId에 다른 메모를 보낼 수 없어요." }, 409);
      const previous = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(receiptKey).first();
      if (previous) return reply(JSON.parse(previous.value));

      const now = Date.now();
      // A durable pointer chooses one inbox across worker isolates. Adopt an
      // existing visible note by title, otherwise create a collision-free slug.
      await db.batch([
        db.prepare("DELETE FROM meta WHERE key = ? AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.slug = meta.value AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug))").bind(inboxKey),
        db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, COALESCE((SELECT p.slug FROM pages p WHERE p.title = ? AND p.kind = 'note' AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug) ORDER BY p.ord, p.slug LIMIT 1), ?))")
          .bind(inboxKey, title, "quick-note-" + crypto.randomUUID()),
        db.prepare("INSERT OR IGNORE INTO pages (slug, title, parent, ord, kind, updated, source, hash) SELECT value, ?, NULL, (SELECT COALESCE(MAX(ord), 0) + 10 FROM pages WHERE parent IS NULL), 'note', ?, 'editor', NULL FROM meta WHERE key = ?")
          .bind(title, now, inboxKey),
      ]);
      const inbox = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(inboxKey).first();
      const slug = inbox.value;
      const block = { id: "q-" + crypto.randomUUID(), type: "paragraph", text: new Date(now).toISOString() + "\n" + text, checked: false, indent: 0, meta: null };
      const receipt = { slug, blockId: block.id, created: now, text };
      const blocks = [block];
      const append = [
        db.prepare("INSERT INTO blocks (page, id, ord, type, text, checked, indent, meta) SELECT ?, ?, COALESCE((SELECT MAX(ord) + 1 FROM blocks WHERE page = ?), 0), 'paragraph', ?, 0, 0, NULL WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = ?)")
          .bind(slug, block.id, slug, block.text, receiptKey),
        ...linksOf(blocks).map(dst => db.prepare("INSERT OR IGNORE INTO links (src, dst) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = ?)").bind(slug, dst, receiptKey)),
        db.prepare("UPDATE pages SET updated = MAX(updated + 1, ?), source = 'editor', hash = NULL WHERE slug = ? AND NOT EXISTS (SELECT 1 FROM meta WHERE key = ?)").bind(now, slug, receiptKey),
        db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").bind(receiptKey, JSON.stringify(receipt)),
      ];
      // saveBlocks normally replaces a full snapshot. Replace ONLY its first
      // batch with an atomic append, then pass through all afterSave operations.
      // The receipt predicate and MAX(ord) run inside the same D1 transaction:
      // independent isolates cannot lose appends or duplicate a clientId.
      // Reload committed blocks before hooks run so hooks receive the full page.
      let pending = true;
      await helpers.saveBlocks({
        prepare: sql => db.prepare(sql),
        batch: async statements => {
          if (!pending) return db.batch(statements);
          pending = false;
          const result = await db.batch(append);
          const rows = await db.prepare("SELECT id, type, text, checked, indent, meta FROM blocks WHERE page = ? ORDER BY ord").bind(slug).all();
          blocks.splice(0, blocks.length, ...(rows.results ?? []).map(row => ({
            ...row, checked: row.checked === 1, meta: row.meta ? JSON.parse(row.meta) : null,
          })));
          return result;
        },
      }, slug, blocks);
      const saved = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(receiptKey).first();
      return reply(JSON.parse(saved.value));
    },
  });
})();
