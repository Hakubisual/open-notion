// Projects + always-on memo (issue #6). A project is detected on the user's machine (git remote name or folder name)
// by the Claude Code / Codex hook or passed by an MCP agent. Each project owns a top page with two children:
// "메모" (short distilled notes appended after every turn, dated sections, deduped) and "작업 기록" (journal sessions).
// Settings: auto memo on/off, scope (memo only / memo + journal), per-project mute. Old journal sessions can be
// backfilled into projects (dry run first, then apply; every apply is undoable by batch).
(() => {
  const SCHEMA = [
    "CREATE TABLE IF NOT EXISTS projects (key TEXT PRIMARY KEY, name TEXT NOT NULL, page TEXT NOT NULL, memo_page TEXT NOT NULL, journal_page TEXT NOT NULL, muted INTEGER NOT NULL DEFAULT 0, memos INTEGER NOT NULL DEFAULT 0, last INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS memo_items (id TEXT PRIMARY KEY, project TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, client TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS memo_items_hash ON memo_items(project, hash)",
    "CREATE TABLE IF NOT EXISTS auto_notes_settings (id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, scope TEXT NOT NULL DEFAULT 'memo+journal', updated INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS project_backfill (id TEXT PRIMARY KEY, batch TEXT NOT NULL, session TEXT NOT NULL, page TEXT NOT NULL, prev_parent TEXT, project TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)",
  ];
  const KINDS = { decision: "결정", fact: "알게 된 것", todo: "할 일", files: "파일", summary: "요약" };
  const SCOPES = ["memo", "memo+journal"];
  const LIMITS = { items: 12, text: 400, files: 12, perHour: 400, blocks: 1800 };
  const HOUR = 3600 * 1000;
  const KST = 9 * HOUR;
  const day = (t) => new Date(t + KST).toISOString().slice(0, 10);
  const hm = (t) => new Date(t + KST).toISOString().slice(11, 16);
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const clip = (s, n) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  let seqId = 0;
  const rid = (p) => p + Date.now().toString(36) + (seqId++ % 46656).toString(36).padStart(3, "0") + Math.random().toString(36).slice(2, 6);
  const ready = new WeakSet();
  async function schema(db) {
    if (ready.has(db)) return;
    for (const sql of SCHEMA) await db.prepare(sql).run();
    if (ACARD_FEATURES.services.journalSchema) await ACARD_FEATURES.services.journalSchema(db);
    ready.add(db);
  }
  const redactOf = (helpers) => (helpers.services && helpers.services.journalRedact) || ACARD_FEATURES.services.journalRedact || ((t) => String(t));

  // Project key: lower-case slug of the repo/folder name, so "Acard" and "acard" are one project.
  function keyOf(helpers, name) {
    const k = helpers.slugify(clip(name, 60)).slice(0, 40);
    if (!k || k === "page") throw fail("project 이름이 필요해요.");
    return k;
  }

  async function settings(db) {
    await schema(db);
    const row = await db.prepare("SELECT enabled, scope, updated FROM auto_notes_settings WHERE id = 1").first();
    return { enabled: row ? Number(row.enabled) === 1 : true, scope: row && SCOPES.includes(row.scope) ? row.scope : "memo+journal" };
  }
  async function saveSettings(db, patch) {
    const cur = await settings(db);
    const next = { enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled, scope: SCOPES.includes(patch.scope) ? patch.scope : cur.scope };
    await db.prepare("INSERT INTO auto_notes_settings (id, enabled, scope, updated) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, scope = excluded.scope, updated = excluded.updated")
      .bind(next.enabled ? 1 : 0, next.scope, Date.now()).run();
    return next;
  }

  async function makePage(db, helpers, slug, title, parent, blocks) {
    if (await db.prepare("SELECT slug FROM pages WHERE slug = ?").bind(slug).first()) return slug;
    const max = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM pages WHERE parent IS ?").bind(parent).first();
    await db.prepare("INSERT OR IGNORE INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'note', ?, 'editor', NULL)")
      .bind(slug, title, parent, Number(max?.m ?? 0) + 10, Date.now()).run();
    await helpers.saveBlocks(db, slug, helpers.normaliseBlocks(blocks));
    return slug;
  }
  const live = async (db, slug) => Boolean(slug && await db.prepare("SELECT slug FROM pages WHERE slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = ?)").bind(slug, slug).first());

  // Finds or creates the project and its pages. Reuses the first-run project page or a top page tagged 프로젝트:<name>.
  async function ensureProject(db, helpers, name, topPage) {
    await schema(db);
    name = clip(name, 60);
    const key = keyOf(helpers, name);
    let row = await db.prepare("SELECT * FROM projects WHERE key = ?").bind(key).first();
    if (row && await live(db, row.page) && await live(db, row.memo_page) && await live(db, row.journal_page)) return row;
    const tag = "프로젝트:" + clip(name, 30);
    let page = topPage && await live(db, topPage) ? topPage : null;
    if (!page && row && await live(db, row.page)) page = row.page;
    if (!page) {
      const tagged = await db.prepare("SELECT p.slug FROM page_tags t JOIN pages p ON p.slug = t.page WHERE t.tag = ? AND p.parent IS NULL AND NOT EXISTS (SELECT 1 FROM editor_trash x WHERE x.page = p.slug) ORDER BY p.updated LIMIT 1").bind(tag).first().catch(() => null);
      if (tagged) page = tagged.slug;
    }
    if (!page) {
      page = await makePage(db, helpers, "pj-" + key, name, null, [{ type: "paragraph", text: name + " 프로젝트 공간이에요. Claude Code·Codex 가 대화마다 남긴 메모와 작업 기록이 여기 모여요." }]);
      if (helpers.services && helpers.services.folderTags) await helpers.services.folderTags(db, page, [tag]).catch(() => null);
    }
    const memo = row && await live(db, row.memo_page) ? row.memo_page : await makePage(db, helpers, "pj-" + key + "-memo", "메모", page, [
      { type: "callout", text: "에이전트가 대화가 끝날 때마다 결정, 알게 된 것, 할 일, 건드린 파일을 짧게 남기는 메모예요. 원문 대화는 '작업 기록'에 있어요.", meta: { tone: "info" } },
    ]);
    const journal = row && await live(db, row.journal_page) ? row.journal_page : await makePage(db, helpers, "pj-" + key + "-journal", "작업 기록", page, [
      { type: "journal", text: "", meta: { project: key } },
    ]);
    const at = Date.now();
    await db.prepare("INSERT INTO projects (key, name, page, memo_page, journal_page, muted, memos, last, created) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?) ON CONFLICT (key) DO UPDATE SET page = excluded.page, memo_page = excluded.memo_page, journal_page = excluded.journal_page")
      .bind(key, name, page, memo, journal, at, at).run();
    return await db.prepare("SELECT * FROM projects WHERE key = ?").bind(key).first();
  }

  const norm = (t) => String(t).toLowerCase().replace(/[`*_~"'.,!?·:;()\[\]-]/g, "").replace(/\s+/g, " ").trim();
  function hashOf(kind, text) {
    let h = 2166136261;
    for (const ch of kind + "|" + norm(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }
  const md = (t) => String(t).replace(/[`*]/g, "");

  async function appendMemo(db, helpers, project, items, client, env) {
    const redact = redactOf(helpers);
    const at = Date.now(), today = day(at);
    const fresh = [];
    for (const item of items) {
      const text = clip(redact(item.text, env), LIMITS.text);
      if (!text) continue;
      const hash = hashOf(item.kind, text);
      if (fresh.some((f) => f.hash === hash)) continue;
      if (await db.prepare("SELECT id FROM memo_items WHERE project = ? AND hash = ?").bind(project.key, hash).first()) continue;
      fresh.push({ kind: item.kind, text, hash });
    }
    if (!fresh.length) return { added: 0, page: project.memo_page };
    let page = project.memo_page;
    let found = await helpers.readPage(db, page);
    if (found && found.blocks.length > LIMITS.blocks) {
      // Roll over before the 2000-block page cap: the old page keeps its notes and becomes "메모 ~ <date>".
      await db.prepare("UPDATE pages SET title = ? WHERE slug = ?").bind("메모 ~ " + today, page).run();
      page = await makePage(db, helpers, "pj-" + project.key + "-memo-" + at.toString(36), "메모", project.page, []);
      await db.prepare("UPDATE projects SET memo_page = ? WHERE key = ?").bind(page, project.key).run();
      found = await helpers.readPage(db, page);
    }
    const blocks = found ? found.blocks.slice() : [];
    const lastHeading = [...blocks].reverse().find((b) => b.type === "heading2");
    const lines = [];
    if (!lastHeading || lastHeading.text !== today) lines.push("## " + today, "");
    lines.push("**" + hm(at) + "** · " + md(clip(client, 40)));
    for (const f of fresh) lines.push("- **" + KINDS[f.kind] + "** " + (f.kind === "files" ? f.text.split(/,\s*/).map((p) => "`" + p.replace(/`/g, "") + "`").join(", ") : md(f.text)));
    const added = helpers.normaliseBlocks(helpers.markdownToBlocks(lines.join("\n")));
    await helpers.saveBlocks(db, page, helpers.normaliseBlocks(blocks.concat(added)));
    await db.prepare("UPDATE pages SET updated = ? WHERE slug = ?").bind(at, page).run();
    await db.batch([
      ...fresh.map((f) => db.prepare("INSERT INTO memo_items (id, project, day, kind, text, hash, client, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(rid("mi"), project.key, today, f.kind, f.text, f.hash, clip(client, 40), at)),
      db.prepare("UPDATE projects SET memos = memos + ?, last = ? WHERE key = ?").bind(fresh.length, at, project.key),
    ]);
    return { added: fresh.length, page };
  }

  function itemsOf(input) {
    const out = [];
    for (const raw of Array.isArray(input.items) ? input.items.slice(0, LIMITS.items) : []) {
      const kind = raw && Object.hasOwn(KINDS, raw.kind) ? raw.kind : "summary";
      const text = String(raw && raw.text || "").trim();
      if (text) out.push({ kind, text });
    }
    const files = (Array.isArray(input.files) ? input.files : []).map((f) => clip(f, 120)).filter(Boolean).slice(0, LIMITS.files);
    if (files.length) out.push({ kind: "files", text: [...new Set(files)].join(", ") });
    return out;
  }

  // One call per finished turn from the hook (or an MCP agent). Returns the settings so the hook knows whether to journal.
  async function memoAdd(db, principal, helpers, input) {
    await schema(db);
    const env = helpers.env || {};
    const conf = await settings(db);
    const name = clip(input.project, 60);
    if (!name) throw fail("project 가 필요해요 (git 저장소나 폴더 이름).");
    const key = keyOf(helpers, name);
    const existing = await db.prepare("SELECT * FROM projects WHERE key = ?").bind(key).first();
    if (existing && Number(existing.muted) === 1) return { ok: true, added: 0, skipped: "muted", muted: true, enabled: conf.enabled, scope: conf.scope, project: key };
    if (!conf.enabled) return { ok: true, added: 0, skipped: "off", muted: false, enabled: false, scope: conf.scope, project: key };
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM memo_items WHERE created > ?").bind(Date.now() - HOUR).first();
    if (Number(recent?.n ?? 0) >= LIMITS.perHour) throw fail("메모가 너무 많아요. 잠시 뒤에 다시 보내 주세요.", 429);
    const project = await ensureProject(db, helpers, name);
    const items = itemsOf(input);
    const client = clip(input.client || principal.name || "agent", 40);
    const done = items.length ? await appendMemo(db, helpers, project, items, client, env) : { added: 0, page: project.memo_page };
    return { ok: true, added: done.added, muted: false, enabled: true, scope: conf.scope, project: key, page: done.page, url: "/" + encodeURIComponent(done.page) + "/" };
  }

  async function listProjects(db) {
    await schema(db);
    const rows = await db.prepare("SELECT p.key, p.name, p.page, p.memo_page, p.journal_page, p.muted, p.memos, p.last, (SELECT COUNT(*) FROM journal_sessions s WHERE s.project = p.key) AS sessions, (SELECT MAX(s.updated) FROM journal_sessions s WHERE s.project = p.key) AS jlast FROM projects p WHERE EXISTS (SELECT 1 FROM pages x WHERE x.slug = p.page) ORDER BY p.last DESC LIMIT 100").all();
    return (rows.results ?? []).map((r) => ({ key: r.key, name: r.name, page: r.page, memoPage: r.memo_page, journalPage: r.journal_page, muted: Number(r.muted) === 1, memos: Number(r.memos), sessions: Number(r.sessions), last: Math.max(Number(r.last), Number(r.jlast || 0)) })).sort((a, b) => b.last - a.last);
  }

  // Backfill: old sessions without a project get one from their 프로젝트: tag or the "(name)" the hook put in the goal.
  async function backfillPlan(db) {
    const rows = await db.prepare("SELECT s.id, s.page, s.title, s.goal, (SELECT t.tag FROM page_tags t WHERE t.page = s.page AND t.tag LIKE '프로젝트:%' LIMIT 1) AS tag FROM journal_sessions s WHERE s.project IS NULL ORDER BY s.created").all();
    const plan = [], skipped = [];
    for (const r of rows.results ?? []) {
      const fromTag = r.tag ? String(r.tag).slice("프로젝트:".length) : "";
      const fromGoal = (/자동 기록 \(([^()]+)\)\s*$/.exec(String(r.goal || "")) || [])[1] || "";
      const name = clip(fromTag || fromGoal, 60);
      if (name) plan.push({ session: r.id, page: r.page, title: r.title, project: name, source: fromTag ? "tag" : "goal" });
      else skipped.push({ session: r.id, title: r.title });
    }
    return { plan, skipped };
  }
  async function backfillApply(db, helpers) {
    const { plan, skipped } = await backfillPlan(db);
    const batch = rid("bf"), at = Date.now();
    const projects = new Map();
    for (const item of plan) {
      const p = projects.get(item.project) || await ensureProject(db, helpers, item.project);
      projects.set(item.project, p);
      const cur = await db.prepare("SELECT parent FROM pages WHERE slug = ?").bind(item.page).first();
      await db.batch([
        db.prepare("INSERT INTO project_backfill (id, batch, session, page, prev_parent, project, undone, created) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").bind(rid("bi"), batch, item.session, item.page, cur ? cur.parent : null, p.key, at),
        db.prepare("UPDATE journal_sessions SET project = ? WHERE id = ?").bind(p.key, item.session),
        ...(cur ? [db.prepare("UPDATE pages SET parent = ? WHERE slug = ?").bind(p.journal_page, item.page)] : []),
      ]);
    }
    return { batch, moved: plan.length, projects: [...projects.values()].map((p) => p.key), skipped: skipped.length };
  }
  async function backfillUndo(db, batch) {
    const rows = (await db.prepare("SELECT * FROM project_backfill WHERE batch = ? AND undone = 0").bind(String(batch || "")).all()).results ?? [];
    if (!rows.length) throw fail("되돌릴 정리 기록이 없어요.", 404);
    const statements = [];
    for (const r of rows) {
      statements.push(db.prepare("UPDATE journal_sessions SET project = NULL WHERE id = ?").bind(r.session));
      statements.push(db.prepare("UPDATE pages SET parent = ? WHERE slug = ?").bind(r.prev_parent, r.page));
    }
    statements.push(db.prepare("UPDATE project_backfill SET undone = 1 WHERE batch = ?").bind(String(batch)));
    await db.batch(statements);
    return { ok: true, restored: rows.length };
  }

  async function api({ path, method, request, env, db, helpers }) {
    if (path !== "/api/projects" && !path.startsWith("/api/projects/")) return null;
    if (env.ACARD_SESSION === "guest" || env.ACARD_GUEST_TOKEN !== undefined) return helpers.json({ error: "멤버만 볼 수 있어요." }, 401);
    await schema(db);
    const json = helpers.json;
    const body = method === "GET" ? {} : await request.json().catch(() => ({}));
    const h = { ...helpers, services: ACARD_FEATURES.services, env };
    try {
      if (path === "/api/projects" && method === "GET") return json({ projects: await listProjects(db), settings: await settings(db) });
      if (path === "/api/projects/settings" && (method === "PUT" || method === "POST")) return json({ settings: await saveSettings(db, body || {}) });
      if (path === "/api/projects/backfill" && method === "POST") {
        if (body && body.undo) return json(await backfillUndo(db, body.undo));
        if (body && body.apply === true) return json(await backfillApply(db, h));
        const dry = await backfillPlan(db);
        return json({ dryRun: true, count: dry.plan.length, plan: dry.plan.slice(0, 200), skipped: dry.skipped.length, projects: [...new Set(dry.plan.map((p) => p.project))] });
      }
      const one = /^\/api\/projects\/([^/]+)$/.exec(path);
      if (one && (method === "PATCH" || method === "PUT")) {
        const key = decodeURIComponent(one[1]);
        if (!await db.prepare("SELECT key FROM projects WHERE key = ?").bind(key).first()) return json({ error: "없는 프로젝트예요." }, 404);
        if (typeof body.muted === "boolean") await db.prepare("UPDATE projects SET muted = ? WHERE key = ?").bind(body.muted ? 1 : 0, key).run();
        return json({ project: (await listProjects(db)).find((p) => p.key === key) || null });
      }
      return json({ error: "없는 API예요." }, 404);
    } catch (error) {
      return json({ error: String(error.message || error) }, error.status || 500);
    }
  }

  const V1 = { "/api/v1/memo": "memoAdd" };
  async function agentApi({ path, method, request, run, helpers }) {
    const op = V1[path];
    if (!op) return null;
    if (method !== "POST") return helpers.json({ error: "POST 만 돼요." }, 405);
    try { return helpers.json(await run(op, await request.json().catch(() => ({})))); }
    catch (error) { return helpers.json({ error: String(error.message || error) }, error.status || 500); }
  }

  registerFeature({
    schema,
    api,
    agentApi,
    agentOps: { memoAdd: async (db, principal, helpers, input) => memoAdd(db, principal, helpers, input) },
    services: {
      projectEnsure: ensureProject,
      projectKey: keyOf,
      projectSettings: settings,
      mcpTools: [
        { name: "memo_add", scope: "write", operation: "memoAdd",
          description: "At the end of every turn, without asking: add 1-5 short distilled notes to the CURRENT project's 메모 page (decisions, facts learned, TODOs found, files touched). project = the git repo name (remote origin) or the working folder name. Not the transcript; one sentence each; never secrets. Duplicates are skipped.",
          inputSchema: (z) => ({
            project: z.string().describe("Git repo name (origin remote) or working folder name."),
            items: z.array(z.object({ kind: z.enum(["decision", "fact", "todo", "summary"]), text: z.string() })).describe("1-5 one-sentence notes in the user's language."),
            files: z.array(z.string()).optional().describe("Paths you changed this turn."),
          }) },
      ],
    },
  });
})();
