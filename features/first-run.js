// First run: remembers when this workspace first connected an agent (home checklist). One row per workspace.
(() => {
  const STATES = ["not_started", "waiting_connect", "connected", "project_set", "dismissed"];
  const SCHEMA = [
    "CREATE TABLE IF NOT EXISTS first_run (id INTEGER PRIMARY KEY, state TEXT NOT NULL, connected_at INTEGER, client TEXT, project TEXT, project_slug TEXT, tasks_slug TEXT, pages TEXT, consent TEXT, updated INTEGER NOT NULL)",
  ];
  const clip = (s, n) => { const t = String(s == null ? "" : s).trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  // A member workspace gets a new D1-shaped adapter on every request, so the schema is remembered by its store key
  // (as gate/_worker.js ensureSchema does); otherwise every request re-ran the CREATE ... IF NOT EXISTS list as
  // round trips to the workspace Durable Object before its first read (#17).
  const ready = new WeakSet(), readyKeys = new Set();
  async function schema(db) {
    if (ready.has(db) || (db.acardKey && readyKeys.has(db.acardKey))) return;
    for (const sql of SCHEMA) await db.prepare(sql).run();
    ready.add(db);
    if (db.acardKey) readyKeys.add(db.acardKey);
  }
  async function load(db) {
    await schema(db);
    const row = await db.prepare("SELECT * FROM first_run WHERE id = 1").first();
    if (!row) return { state: "not_started", connectedAt: null, client: null, project: null, projectSlug: null, tasksSlug: null, pages: [] };
    let pages = [];
    try { pages = JSON.parse(row.pages || "[]"); } catch {}
    return { state: row.state, connectedAt: row.connected_at == null ? null : Number(row.connected_at), client: row.client, project: row.project, projectSlug: row.project_slug, tasksSlug: row.tasks_slug, pages };
  }
  async function save(db, patch) {
    const cur = await load(db);
    const next = { ...cur, ...patch };
    await db.prepare("INSERT INTO first_run (id, state, connected_at, client, project, project_slug, tasks_slug, pages, consent, updated) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state, connected_at = excluded.connected_at, client = excluded.client, project = excluded.project, project_slug = excluded.project_slug, tasks_slug = excluded.tasks_slug, pages = excluded.pages, consent = COALESCE(excluded.consent, first_run.consent), updated = excluded.updated")
      .bind(next.state, next.connectedAt, next.client, next.project, next.projectSlug, next.tasksSlug, JSON.stringify(next.pages || []), patch.consent ?? null, Date.now()).run();
    return next;
  }

  async function openTasks(db, slug, limit = 8) {
    if (!slug) return [];
    const rows = await db.prepare("SELECT text FROM blocks WHERE page = ? AND type = 'to_do' AND checked = 0 ORDER BY ord LIMIT ?").bind(slug, limit).all();
    return (rows.results || []).map((r) => String(r.text || "")).filter(Boolean);
  }

  async function markConnected(db, principal) {
    const cur = await load(db);
    if (cur.connectedAt) return { ok: true, first: false };
    await save(db, { connectedAt: Date.now(), client: clip(principal.name, 60), state: cur.state === "project_set" || cur.state === "dismissed" ? cur.state : "connected" });
    return { ok: true, first: true };
  }

  async function api({ path, method, request, env, db, helpers }) {
    if (path !== "/api/first-run") return null;
    if (env.ACARD_SESSION === "guest" || env.ACARD_GUEST_TOKEN !== undefined) return helpers.json({ error: "멤버만 볼 수 있어요." }, 401);
    if (method === "GET") {
      const cur = await load(db);
      const live = [];
      for (const p of cur.pages) if (await db.prepare("SELECT slug FROM pages WHERE slug = ?").bind(p.slug).first()) live.push(p);
      return helpers.json({ ...cur, pages: live, tasks: await openTasks(db, cur.tasksSlug) });
    }
    if (method === "POST") {
      const body = await request.json().catch(() => ({}));
      const want = body && body.state;
      if (want !== "waiting_connect" && want !== "dismissed") return helpers.json({ error: "state 는 waiting_connect 또는 dismissed 예요." }, 400);
      const cur = await load(db);
      if (want === "waiting_connect" && cur.state !== "not_started" && cur.state !== "dismissed") return helpers.json(cur);
      if (want === "dismissed" && cur.state === "project_set") return helpers.json(cur);
      return helpers.json(await save(db, { state: want }));
    }
    return helpers.json({ error: "GET 이나 POST 로 보내 주세요." }, 405);
  }

  registerFeature({
    schema,
    api,
    agentOps: {
      firstRunMark: async (db, principal) => markConnected(db, principal),
    },
    services: {
      firstRunState: load,
      firstRunTasks: openTasks,
    },
  });
})();
