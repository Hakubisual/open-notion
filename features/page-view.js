// Folder or article (owner pick 2026-10-20, draft A): a page with sub-pages can be shown as a folder (its sub-pages as
// cards, a one-line description, + 새 페이지) or as an article. A person decides per page (reader ⋯ menu, the folder
// view chip, 새 하위 폴더 in the sidebar); with no choice a page is a folder when it has sub-pages and at most a short
// body, so a long body is never hidden. Agents write into an article as before but never into a page set to folder:
// they add a sub-page instead. The migration moves an agent-written long body of a page with sub-pages into a first
// sub-page "개요" (backup per batch, undo puts it back); bodies with a person's edit stay where they are.
const PAGE_VIEW_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS page_view (page TEXT PRIMARY KEY, mode TEXT NOT NULL, description TEXT, set_by TEXT NOT NULL DEFAULT 'person', updated INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS page_view_moves (id TEXT PRIMARY KEY, batch TEXT NOT NULL, page TEXT NOT NULL, child TEXT NOT NULL, blocks TEXT NOT NULL, created INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS page_view_moves_batch ON page_view_moves(batch)",
];
const PAGE_VIEW_SHORT = 200;
const PAGE_VIEW_LONG = 300;
const pageViewReady = new WeakSet(), pageViewKeys = new Set();
const pageViewKnown = (db) => pageViewReady.has(db) || (db.acardKey && pageViewKeys.has(db.acardKey));
async function pageViewSchema(db) {
  if (pageViewKnown(db)) return;
  for (const sql of PAGE_VIEW_SCHEMA) await db.prepare(sql).run();
  pageViewReady.add(db);
  if (db.acardKey) pageViewKeys.add(db.acardKey);
}
async function pageViewRow(db, slug) {
  // No await once the schema is known, so this read leaves in the same round trip as the statements started with it.
  if (!pageViewKnown(db)) await pageViewSchema(db);
  return db.prepare("SELECT mode, description, set_by FROM page_view WHERE page = ?").bind(slug).first();
}
const pageViewText = (blocks) => blocks.reduce((n, b) => n + String(b.text || "").length, 0);
async function markFolder(db, slug, description, setBy) {
  await pageViewSchema(db);
  await db.prepare("INSERT INTO page_view (page, mode, description, set_by, updated) VALUES (?, 'folder', ?, ?, ?) ON CONFLICT (page) DO NOTHING")
    .bind(slug, description ? String(description).slice(0, 200) : null, setBy || "agent", Date.now()).run();
}

async function folderGuard(db, slug) {
  const row = await pageViewRow(db, slug);
  if (row && row.mode === "folder") {
    throw new AgentError("'" + slug + "' 는 사람이 폴더로 정한 페이지라 본문에 쓰지 않아요. create_page 에 parent: '" + slug + "' 를 주고 하위 페이지로 쓰세요.", 409);
  }
}

(() => {
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // escapeHtml is the worker-wide helper (block-html.js); only the null/undefined -> "" step is local.
  const esc = (s) => escapeHtml(s ?? "");
  const plain = (s) => String(s ?? "").replace(/\[!\w+\]/g, "").replace(/[*_`#>~|]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const KST = 9 * 3600 * 1000;
  const when = (t) => { const d = new Date(Number(t) + KST); return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일 " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
  const day = (t) => { const d = new Date(Number(t) + KST); return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일"; };

  async function liveChildren(db, slug) {
    const rows = await db.prepare("SELECT p.slug, p.title, p.ord, p.kind, p.updated, s.icon FROM pages p LEFT JOIN editor_page_settings s ON s.page = p.slug WHERE p.parent = ? AND p.kind != 'db_row' AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug) ORDER BY p.ord, p.title").bind(slug).all();
    let list = rows.results ?? [];
    if (db.acardVisible) list = list.filter((r) => db.acardVisible.has(String(r.slug)));
    return list;
  }
  function descriptionOf(row, blocks) {
    if (row && row.description) return String(row.description);
    if (blocks.length === 1 && pageViewText(blocks) <= PAGE_VIEW_SHORT) return plain(blocks[0].text);
    return "";
  }
  // The page_view row, the children and the caller's extra read (`also`, the page_view_moves list) do not depend on each
  // other, so they leave in one round trip; a reader with a long body only needs the children when the row says folder.
  async function resolve(db, page, blocks, reader = false, also = null) {
    const bare = blocks.length === 0 || (blocks.length === 1 && ["paragraph", "callout"].includes(blocks[0].type) && pageViewText(blocks) <= PAGE_VIEW_SHORT);
    const eager = !reader || bare;
    const [row, early, got] = await Promise.all([pageViewRow(db, page.slug), eager ? liveChildren(db, page.slug) : null, eager && also ? also() : null]);
    const [kids, extra] = reader && (row?.mode === "article" || (!row && !bare)) ? [[], null]
      : early ? [early, got] : await Promise.all([liveChildren(db, page.slug), also ? also() : null]);
    const mode = row ? row.mode : kids.length && bare ? "folder" : "article";
    return { mode, chosen: Boolean(row), row, kids, extra };
  }

  const CSS = '<style>.fv{margin:8px 0 40px}.fv-bar{display:flex;align-items:flex-start;gap:16px;justify-content:space-between;margin:4px 0 24px}.fv-mode{position:relative;display:inline-block}.fv-mode summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--line,#e3e6ec);border-radius:8px;font-size:var(--fs-13);color:var(--fg)}.fv-mode summary::-webkit-details-marker{display:none}.fv-mode summary::after{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-2px)}.fv-mode[open] .fv-pop{display:block}.fv-pop{display:none;position:absolute;z-index:20;top:calc(100% + 4px);left:0;min-width:180px;padding:6px;border-radius:10px;background:var(--surface,#fff);box-shadow:var(--shadow-menu,0 8px 24px rgba(0,0,0,.14))}.fv-pop button{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:6px;background:none;color:var(--fg);font:inherit;font-size:var(--fs-14);cursor:pointer}.fv-pop button:hover,.fv-pop button[aria-pressed=true]{background:var(--accent-soft,#efeaff)}.fv-desc{margin:10px 0 4px;color:var(--fg-dim);font-size:var(--fs-15)}.fv-meta{margin:0;color:var(--fg-dim);font-size:var(--fs-13)}.fv-new{flex:none;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;background:var(--accent-soft,#efeaff);color:var(--accent,#7c5cff);font-weight:600;font-size:var(--fs-14);text-decoration:none}.fv-new:hover{background:var(--accent,#7c5cff);color:var(--on-accent,#fff)}.fv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}.fv-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:16px 18px;border:1px solid var(--line,#e3e6ec);border-radius:12px;background:var(--surface,#fff);color:var(--fg);text-decoration:none;transition:border-color .15s,box-shadow .15s}.fv-card:hover{border-color:var(--accent,#7c5cff);box-shadow:0 4px 14px rgba(0,0,0,.06)}.fv-head{display:flex;align-items:center;gap:10px;min-width:0}.fv-ic{flex:none;width:28px;height:28px;display:grid;place-items:center;font-size:var(--fs-19);color:var(--fg-dim)}.fv-t{font-weight:700;font-size:var(--fs-16);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fv-badge{flex:none;padding:2px 8px;border-radius:6px;background:var(--accent-soft,#efeaff);color:var(--accent,#7c5cff);font-size:var(--fs-12);font-weight:600}.fv-pre{margin:0;color:var(--fg-dim);font-size:var(--fs-14);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fv-time{margin-top:auto;color:var(--fg-dim);font-size:var(--fs-12)}.fv-empty{color:var(--fg-dim)}@media (max-width:640px){.fv-bar{flex-direction:column}.fv-grid{grid-template-columns:1fr}}</style>';

  async function previews(db, slugs) {
    const out = new Map();
    if (!slugs.length) return out;
    const rows = await db.prepare("SELECT page, text FROM blocks WHERE page IN (" + slugs.map(() => "?").join(",") + ") AND type IN ('paragraph','callout','quote','heading2','heading3') AND text != '' ORDER BY page, ord").bind(...slugs).all();
    for (const r of rows.results ?? []) if (!out.has(String(r.page))) { const t = plain(r.text); if (t) out.set(String(r.page), t); }
    return out;
  }

  async function folderView(db, page, blocks, guest) {
    if (page.slug === "index" || page.kind !== "note") return null;
    const v = await resolve(db, page, blocks, true, () => db.prepare("SELECT child FROM page_view_moves WHERE page = ? AND undone = 0").bind(page.slug).all());
    if (v.mode !== "folder") return null;
    const moved = new Set((v.extra.results ?? []).map((r) => String(r.child)));
    const pre = await previews(db, v.kids.map((k) => String(k.slug)));
    const last = v.kids.reduce((m, k) => Math.max(m, Number(k.updated) || 0), Number(page.updated) || 0);
    const desc = descriptionOf(v.row, blocks);
    const hidden = blocks.length > 1 || (blocks.length === 1 && plain(blocks[0].text) !== desc);
    const cards = v.kids.map((k) => '<a class="fv-card" href="/' + encodeURIComponent(k.slug) + '/"><span class="fv-head"><span class="fv-ic" aria-hidden="true">' + (k.icon ? esc(k.icon) : "▤") + '</span><span class="fv-t">' + esc(k.title || "제목 없음") + "</span>" +
      (moved.has(String(k.slug)) ? '<span class="fv-badge">본문이 옮겨진 곳</span>' : "") + "</span>" +
      '<p class="fv-pre">' + esc(clip(pre.get(String(k.slug)) || "", 80)) + '</p><span class="fv-time">' + when(k.updated) + " 수정됨</span></a>").join("");
    const mode = guest ? "" : '<details class="fv-mode"><summary>폴더 보기</summary><div class="fv-pop" role="group" aria-label="이 페이지 보기"><button type="button" data-fv-mode="folder" aria-pressed="true">폴더로 보기</button><button type="button" data-fv-mode="article" aria-pressed="false">글로 보기</button></div></details>';
    const add = guest ? "" : '<a class="fv-new" href="/edit/page-' + rid() + '/?new&create&parent=' + encodeURIComponent(page.slug) + '">+ 새 페이지</a>';
    return CSS + '<section class="fv" data-view-mode="folder" data-fv-page="' + esc(page.slug) + '"><div class="fv-bar"><div>' + mode +
      (desc ? '<p class="fv-desc">' + esc(desc) + "</p>" : "") + '<p class="fv-meta">페이지 ' + v.kids.length + "개 · 마지막 수정 " + day(last) + (hidden ? ' · <a href="?as=article">본문 보기</a>' : "") + "</p></div>" + add + "</div>" +
      (cards ? '<div class="fv-grid">' + cards + "</div>" : '<p class="fv-empty">아직 하위 페이지가 없어요.</p>') + "</section>";
  }

  async function setView(db, slug, mode, setBy, description) {
    await pageViewSchema(db);
    if (!["folder", "article", "auto"].includes(mode)) throw fail("mode 는 folder, article, auto 중 하나예요.");
    if (!(await db.prepare("SELECT slug FROM pages WHERE slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = pages.slug)").bind(slug).first())) throw fail("없는 페이지예요.", 404);
    const before = await db.prepare("SELECT mode, description, set_by FROM page_view WHERE page = ?").bind(slug).first();
    if (mode === "auto") await db.prepare("DELETE FROM page_view WHERE page = ?").bind(slug).run();
    else await db.prepare("INSERT INTO page_view (page, mode, description, set_by, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (page) DO UPDATE SET mode = excluded.mode, description = COALESCE(excluded.description, page_view.description), set_by = excluded.set_by, updated = excluded.updated")
      .bind(slug, mode, description == null ? null : String(description).slice(0, 200), setBy, Date.now()).run();
    await db.prepare("UPDATE pages SET updated = ? WHERE slug = ?").bind(Date.now(), slug).run();
    return { ok: true, slug, mode, before: before ? before.mode : "auto" };
  }

  async function migrate(db, helpers, dry) {
    await pageViewSchema(db);
    const rows = (await db.prepare("SELECT p.slug, p.title, p.ord FROM pages p WHERE p.kind = 'note' AND p.slug != 'index' AND p.slug NOT LIKE 'agent-journal%' AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug) AND NOT EXISTS (SELECT 1 FROM page_view v WHERE v.page = p.slug) AND EXISTS (SELECT 1 FROM pages c WHERE c.parent = p.slug AND NOT EXISTS (SELECT 1 FROM editor_trash x WHERE x.page = c.slug))").all()).results ?? [];
    const batch = "pv" + rid(), moved = [], kept = [];
    for (const r of rows) {
      const slug = String(r.slug);
      const found = await helpers.readPage(db, slug);
      if (!found || pageViewText(found.blocks) <= PAGE_VIEW_LONG) continue;
      const kids = await liveChildren(db, slug);
      if (!kids.length || kids.every((k) => /^AI 원본 노트/.test(String(k.title)))) continue;
      const agent = await db.prepare("SELECT agent, created FROM agent_activity WHERE page = ? ORDER BY created DESC LIMIT 1").bind(slug).first().catch(() => null);
      const human = found.blocks.some((b) => b.meta && b.meta.human);
      const reason = !agent ? "no agent write" : human ? "person edit" : Number(found.page.updated) > Number(agent.created) + 5000 ? "changed after the last agent write" : "";
      if (reason) { kept.push({ slug, title: found.page.title, reason }); continue; }
      if (dry) { moved.push({ slug, title: found.page.title, chars: pageViewText(found.blocks) }); continue; }
      let child = slug + "-overview";
      if (await db.prepare("SELECT slug FROM pages WHERE slug = ? UNION ALL SELECT page AS slug FROM editor_trash WHERE page = ?").bind(child, child).first()) child += "-" + rid().slice(-4);
      const min = await db.prepare("SELECT COALESCE(MIN(ord), 10) AS m FROM pages WHERE parent = ?").bind(slug).first();
      const now = Date.now();
      const summary = found.blocks.find((b) => b.type === "callout" || b.type === "paragraph");
      const description = summary ? clip(plain(String(summary.text).split("\n").find((l) => plain(l)) || ""), 120) : "";
      await db.prepare("INSERT INTO page_view_moves (id, batch, page, child, blocks, created, undone) VALUES (?, ?, ?, ?, ?, ?, 0)").bind(rid(), batch, slug, child, JSON.stringify(found.blocks), now).run();
      await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, '개요', ?, ?, 'note', ?, 'editor', NULL)").bind(child, slug, Number(min?.m ?? 10) - 10, now).run();
      await helpers.saveBlocks(db, child, found.blocks);
      await db.prepare("INSERT INTO agent_activity (id, page, agent, via, action, created) VALUES (?, ?, ?, 'migration', 'create', ?)").bind(crypto.randomUUID(), child, String(agent.agent), now).run().catch(() => null);
      await helpers.saveBlocks(db, slug, []);
      await db.prepare("INSERT INTO page_view (page, mode, description, set_by, updated) VALUES (?, 'folder', ?, 'migration', ?) ON CONFLICT (page) DO UPDATE SET mode = 'folder', description = excluded.description, set_by = 'migration', updated = excluded.updated").bind(slug, description || null, now).run();
      await db.prepare("UPDATE pages SET updated = ? WHERE slug = ?").bind(now, slug).run();
      moved.push({ slug, title: found.page.title, child, chars: pageViewText(found.blocks) });
    }
    return { dry: Boolean(dry), batch: dry ? null : batch, moved, kept };
  }

  async function undo(db, helpers, batch) {
    await pageViewSchema(db);
    const rows = (await db.prepare("SELECT * FROM page_view_moves WHERE batch = ? AND undone = 0").bind(String(batch)).all()).results ?? [];
    let restored = 0;
    for (const r of rows) {
      const blocks = JSON.parse(String(r.blocks));
      await helpers.saveBlocks(db, String(r.page), blocks);
      const child = await helpers.readPage(db, String(r.child));
      const same = child && JSON.stringify(child.blocks.map((b) => [b.id, b.text])) === JSON.stringify(blocks.map((b) => [b.id, b.text]));
      if (same) {
        await db.batch([db.prepare("DELETE FROM blocks WHERE page = ?").bind(String(r.child)), db.prepare("DELETE FROM pages WHERE slug = ?").bind(String(r.child)), db.prepare("DELETE FROM agent_activity WHERE page = ? AND via = 'migration'").bind(String(r.child))]);
      } else if (child) {
        await db.prepare("INSERT OR IGNORE INTO editor_trash (page, deleted, permanent) VALUES (?, ?, 0)").bind(String(r.child), Date.now()).run();
      }
      await db.prepare("DELETE FROM page_view WHERE page = ? AND set_by = 'migration'").bind(String(r.page)).run();
      await db.prepare("UPDATE pages SET updated = ? WHERE slug = ?").bind(Date.now(), String(r.page)).run();
      await db.prepare("UPDATE page_view_moves SET undone = 1 WHERE id = ?").bind(r.id).run();
      restored += 1;
    }
    return { ok: true, batch, restored };
  }

  const VIEW = /^\/api\/page\/([^/]+)\/view$/;
  async function api(ctx) {
    const { db, path, method, request, helpers } = ctx;
    const m = VIEW.exec(path);
    if (!m && !path.startsWith("/api/page-view/")) return null;
    try {
      if (m) {
        const slug = helpers.resolveSlug(decodeURIComponent(m[1]));
        if (method === "GET") {
          const found = await helpers.readPage(db, slug);
          if (!found) return helpers.json({ error: "없는 페이지예요." }, 404);
          const v = await resolve(db, found.page, found.blocks);
          return helpers.json({ slug, mode: v.mode, chosen: v.chosen, description: v.row ? v.row.description : null, children: v.kids.length });
        }
        if (method === "PUT") {
          const body = await request.json().catch(() => ({}));
          return helpers.json(await setView(db, slug, String(body.mode || ""), "person", body.description));
        }
        return null;
      }
      if (path === "/api/page-view/migrate" && method === "POST") return helpers.json(await migrate(db, helpers, (await request.json().catch(() => ({}))).dry === true));
      if (path === "/api/page-view/undo" && method === "POST") return helpers.json(await undo(db, helpers, (await request.json().catch(() => ({}))).batch));
      return null;
    } catch (error) {
      return helpers.json({ error: String(error.message || error) }, error.status || 500);
    }
  }

  const agentOps = {
    async setPageView(db, principal, helpers, input) {
      if (!principal.scopes || !principal.scopes.includes("write")) throw new AgentError("쓰기 권한이 필요해요.", 403);
      const slug = helpers.resolveSlug(String(input.slug ?? ""));
      const row = await pageViewRow(db, slug);
      if (row && row.set_by === "person") throw new AgentError("사람이 '" + (row.mode === "folder" ? "폴더" : "글") + "'로 정한 페이지라 바꾸지 않아요.", 409);
      try { return await setView(db, slug, String(input.mode ?? ""), "agent", input.description); }
      catch (error) { throw new AgentError(error.message, error.status || 400); }
    },
    async migratePageViews(db, principal, helpers, input) {
      if (!principal.scopes || !principal.scopes.includes("write")) throw new AgentError("쓰기 권한이 필요해요.", 403);
      return input && input.undo ? undo(db, helpers, input.undo) : migrate(db, helpers, Boolean(input && input.dry));
    },
  };
  async function agentApi({ path, method, request, run, helpers }) {
    const m = /^\/api\/v1\/pages\/([^/]+)\/view$/.exec(path);
    const op = m ? "setPageView" : path === "/api/v1/page-view/migrate" ? "migratePageViews" : null;
    if (!op) return null;
    if (method !== "PUT" && method !== "POST") return helpers.json({ error: "PUT 이나 POST 만 돼요." }, 405);
    const body = await request.json().catch(() => ({}));
    try { return helpers.json(await run(op, m ? { ...body, slug: decodeURIComponent(m[1]) } : body)); }
    catch (error) { return helpers.json({ error: String(error.message || error) }, error.status || 500); }
  }

  registerFeature({
    schema: pageViewSchema,
    api,
    agentApi,
    agentOps,
    services: {
      folderView,
      mcpTools: [
        { name: "set_page_view", scope: "write", operation: "setPageView",
          description: "Show a page as a folder (its sub-pages as cards with a one-line description) or as an article. Use mode 'folder' for a page that only groups sub-pages (a project, a topic); write the long text into a sub-page instead. Pages a person set are left as they are.",
          inputSchema: (z) => ({ slug: z.string(), mode: z.enum(["folder", "article", "auto"]), description: z.string().max(200).optional() }) },
      ],
    },
  });
})();
