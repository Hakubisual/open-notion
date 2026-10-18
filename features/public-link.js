(() => {
  const schema = [
    "CREATE TABLE IF NOT EXISTS share_links (token_hash TEXT PRIMARY KEY, page TEXT NOT NULL, created INTEGER, revoked INTEGER NULL, noindex INTEGER NOT NULL DEFAULT 1)",
    "CREATE INDEX IF NOT EXISTS share_links_page ON share_links(page, revoked)",
  ];
  const headers = {
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  const hash = async token => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
  const missing = method => new Response(method === "HEAD" ? null : "없는 페이지예요.", { status: 404, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });

  async function owner({ path, method, db, env, helpers }) {
    const match = /^\/api\/page\/([^/]+)\/share(?:\/([^/]+))?$/.exec(path);
    if (!match) return null;
    let slug;
    try { slug = helpers.resolveSlug(decodeURIComponent(match[1])); }
    catch { return missing(method); }
    const page = await db.prepare("SELECT slug FROM pages WHERE slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = pages.slug)").bind(slug).first();
    if (!page) return missing(method);
    if (!match[2] && method === "POST") {
      const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const id = await hash(token);
      const created = Date.now();
      await db.batch([
        db.prepare("INSERT INTO share_links (token_hash, page, created) VALUES (?, ?, ?)").bind(id, slug, created),
        db.prepare("INSERT INTO share_rules (id, page, principal, role, expires, created, token_hash) VALUES (?, ?, 'publish', 'read', NULL, ?, ?)").bind("pl-" + id, slug, created, id),
      ]);
      return reply({ id, created, last4: id.slice(-4), url: (env.ACARD_SHARE_PREFIX || "/p/") + token }, 201);
    }
    if (!match[2] && method === "GET") {
      // The display suffix identifies the hash, never a recoverable part of the secret.
      const rows = await db.prepare("SELECT token_hash AS id, created, substr(token_hash, -4) AS last4 FROM share_links WHERE page = ? AND revoked IS NULL ORDER BY created DESC, token_hash").bind(slug).all();
      return reply({ links: rows.results ?? [] });
    }
    if (match[2] && method === "DELETE") {
      if (!/^[0-9a-f]{64}$/.test(match[2])) return missing(method);
      const now = Date.now();
      const result = await db.prepare("UPDATE share_links SET revoked = ? WHERE token_hash = ? AND page = ? AND revoked IS NULL").bind(now, match[2], slug).run();
      await db.prepare("UPDATE share_rules SET revoked = ? WHERE id = ? AND page = ? AND revoked IS NULL").bind(now, "pl-" + match[2], slug).run();
      return Number(result.meta?.changes) ? reply({ ok: true }) : missing(method);
    }
    return new Response(null, { status: 405, headers: { ...headers, allow: match[2] ? "DELETE" : "GET, POST" } });
  }

  // The /p/ renderer lives in features/share.js with the rest of the resolver.
  registerFeature({ schema: async db => { await db.batch(schema.map(sql => db.prepare(sql))); }, api: owner });
})();
