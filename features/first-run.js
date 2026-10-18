// First run: a new account connects its own agent (MCP), the agent looks at the user's project folder on the user's
// machine, asks the user in its own chat, and only after a yes sends overview / docs index / task list pages here.
// Acard never reads the user's disk; it only stores what the agent writes after consent. One row per workspace
// (= per user), so reconnecting with a new OAuth grant does not restart the flow.
(() => {
  const STATES = ["not_started", "waiting_connect", "connected", "project_set", "dismissed"];
  const SCHEMA = [
    "CREATE TABLE IF NOT EXISTS first_run (id INTEGER PRIMARY KEY, state TEXT NOT NULL, connected_at INTEGER, client TEXT, project TEXT, project_slug TEXT, tasks_slug TEXT, pages TEXT, consent TEXT, updated INTEGER NOT NULL)",
  ];
  const LIMITS = { name: 60, summary: 2000, markdown: 60000, docs: 80, tasks: 100, files: 200, text: 300, answer: 500 };
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const clip = (s, n) => { const t = String(s == null ? "" : s).trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  const ready = new WeakSet();
  async function schema(db) {
    if (ready.has(db)) return;
    for (const sql of SCHEMA) await db.prepare(sql).run();
    ready.add(db);
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

  const GUIDE = [
    "This user just connected Acard. Do this now, before anything else, without waiting for more instructions:",
    "1. Look at the CURRENT project folder on the user's machine yourself (README, docs/, notes, TODO / plan / roadmap files, open issues you can see, the last ~20 lines of git log). Acard cannot see their disk; do not upload anything yet.",
    "2. In your own chat, ask the user exactly: \"Acard에 이 프로젝트 문서들을 정리해서 올릴까요?\" and say in one line what you would create (project overview, docs index, task list from the open TODOs you found).",
    "3. Only if the user clearly says yes, call acard_setup_project with consent: true and user_answer = the user's reply quoted word for word. If they say no or do not answer, do not send project content.",
    "4. After setup, continue your normal work and keep the journal (journal_log / journal_end) in the returned session.",
  ].join("\n");
  const SESSION_START = "At the start of this session: read the task list below first and pick up from it. At the end, update that page (check finished items with update_page, append new ones with append_to_page) and journal what is next.";

  async function firstRun(db, principal, helpers) {
    const cur = await load(db);
    if (cur.state === "project_set" && cur.tasksSlug) {
      const found = await helpers.readPage(db, cur.tasksSlug);
      return {
        state: cur.state, project: cur.project, project_page: cur.projectSlug, task_list_page: cur.tasksSlug,
        instructions: SESSION_START,
        open_tasks: await openTasks(db, cur.tasksSlug, 50),
        task_list_markdown: found ? helpers.blocksToMarkdown(found.blocks) : "",
      };
    }
    return { state: cur.state, instructions: GUIDE, setup_tool: "acard_setup_project", question: "Acard에 이 프로젝트 문서들을 정리해서 올릴까요?" };
  }

  async function createPage(db, helpers, title, parent, markdown, tags) {
    let slug = helpers.slugify(title) || "page";
    if (await db.prepare("SELECT slug FROM pages WHERE slug = ? UNION ALL SELECT page AS slug FROM editor_trash WHERE page = ?").bind(slug, slug).first()) slug = slug + "-" + Math.random().toString(36).slice(2, 6);
    const max = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM pages WHERE parent IS ?").bind(parent).first();
    await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'note', ?, 'editor', NULL)").bind(slug, title, parent, Number(max?.m ?? 0) + 10, Date.now()).run();
    await helpers.saveBlocks(db, slug, helpers.normaliseBlocks(helpers.markdownToBlocks(markdown)));
    if (tags.length && helpers.services.folderTags) await helpers.services.folderTags(db, slug, tags);
    return { slug, title, url: "/" + encodeURIComponent(slug) + "/" };
  }
  const line = (s) => clip(s, LIMITS.text).replace(/\s+/g, " ");

  async function setupProject(db, principal, helpers, input) {
    if (input.consent !== true) throw fail("사용자가 동의해야 올릴 수 있어요. 먼저 채팅에서 물어보고, 그렇다고 하면 consent: true 와 그 답을 user_answer 로 보내세요.", 403);
    const answer = clip(input.user_answer, LIMITS.answer);
    if (!answer) throw fail("user_answer 에 사용자의 답을 그대로 넣어 주세요.");
    const name = clip(input.project_name, LIMITS.name);
    if (!name) throw fail("project_name 이 필요해요.");
    const cur = await load(db);
    if (cur.state === "project_set" && cur.project === name && cur.projectSlug && (await helpers.readPage(db, cur.projectSlug))) {
      return { ok: true, already: true, project_page: cur.projectSlug, task_list_page: cur.tasksSlug, pages: cur.pages };
    }
    const redact = helpers.services.journalRedact || ((t) => t);
    const summary = redact(clip(input.summary, LIMITS.summary));
    const docs = (Array.isArray(input.docs) ? input.docs : []).slice(0, LIMITS.docs);
    const tasks = (Array.isArray(input.tasks) ? input.tasks : []).slice(0, LIMITS.tasks);
    const files = (Array.isArray(input.files_found) ? input.files_found : []).slice(0, LIMITS.files).map((f) => line(f)).filter(Boolean);
    const overview = redact(String(input.overview_markdown || "").slice(0, LIMITS.markdown));
    const tag = "프로젝트:" + clip(name, 30);
    const at = new Date().toISOString().slice(0, 10);

    const top = await createPage(db, helpers, name, null, [
      summary || name + " 프로젝트를 에이전트가 정리한 공간이에요.",
      "",
      "> [!info] " + principal.name + " 이(가) 사용자 동의를 받고 " + at + "에 만들었어요. 사용자 답: \"" + answer.replace(/"/g, "'") + "\"",
    ].join("\n"), [tag]);
    const pages = [];
    pages.push({ ...(await createPage(db, helpers, "프로젝트 개요", top.slug, overview || summary || "개요", [tag])), kind: "overview" });
    const docsMd = docs.length
      ? docs.map((d) => "- **" + line(d && d.title || d && d.path || "문서") + "**" + (d && d.path ? " `" + line(d.path) + "`" : "") + (d && d.summary ? " - " + line(d.summary) : "")).join("\n")
      : "아직 찾은 문서가 없어요.";
    pages.push({ ...(await createPage(db, helpers, "문서 목록", top.slug, docsMd + (files.length ? "\n\n## 살펴본 파일\n\n" + files.map((f) => "- `" + f + "`").join("\n") : ""), [tag])), kind: "docs" });
    const taskMd = tasks.length
      ? tasks.map((t) => "- [" + (t && t.done ? "x" : " ") + "] " + line(typeof t === "string" ? t : t && t.text) + (t && t.source ? " (" + line(t.source) + ")" : "")).join("\n")
      : "- [ ] 다음 할 일을 적어 주세요";
    const taskPage = { ...(await createPage(db, helpers, "할 일", top.slug, "에이전트가 세션마다 먼저 읽고, 끝날 때 고쳐 두는 목록이에요.\n\n" + taskMd, [tag])), kind: "tasks" };
    pages.push(taskPage);

    let journal = null;
    const start = ACARD_FEATURES.agentOps.journalStart;
    if (start) journal = await start(db, principal, helpers, { title: name + " 정리", goal: "프로젝트 문서를 Acard에 정리하고 할 일 목록을 만든다", project: name }).catch(() => null);
    await save(db, { state: "project_set", project: name, projectSlug: top.slug, tasksSlug: taskPage.slug, pages: [{ slug: top.slug, title: name, kind: "project" }, ...pages.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind }))], consent: JSON.stringify({ answer, agent: principal.name, at: Date.now() }), connectedAt: cur.connectedAt ?? Date.now(), client: cur.client ?? principal.name });
    return { ok: true, project_page: top.slug, task_list_page: taskPage.slug, pages: [top, ...pages], journal_session: journal && journal.session, next: "Tell the user the pages are ready (link " + top.url + ") and keep journaling in journal_session." };
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
      acardFirstRun: async (db, principal, helpers) => firstRun(db, principal, helpers),
      acardSetupProject: async (db, principal, helpers, input) => setupProject(db, principal, helpers, input),
    },
    services: {
      firstRunState: load,
      firstRunTasks: openTasks,
      mcpTools: [
        { name: "acard_first_run", scope: "read", operation: "acardFirstRun",
          description: "Call at the START of every session. Takes no project data. For a newly connected user it returns what to do first (scan the local project yourself, ask the user, then acard_setup_project only if they agree). For a set-up project it returns the user's open task list to read before you work.",
          inputSchema: () => ({}) },
        { name: "acard_setup_project", scope: "write", operation: "acardSetupProject",
          description: "Create the project's pages in Acard: a top page named after the project (tag 프로젝트:<name>) with overview, docs index and task list children, and start a journal session. ONLY after the user said yes in your chat: consent must be true and user_answer must quote their reply. Never call it without asking.",
          inputSchema: (z) => ({
            consent: z.boolean().describe("true only if the user agreed in your chat."),
            user_answer: z.string().describe("The user's reply, quoted word for word."),
            project_name: z.string(),
            summary: z.string().describe("2-4 sentences: what the project is, in the user's language."),
            overview_markdown: z.string().optional().describe("Project overview page body (markdown): purpose, stack, how to run, structure."),
            docs: z.array(z.object({ title: z.string(), path: z.string().optional(), summary: z.string().optional() })).optional().describe("Docs index entries for the documents you found."),
            tasks: z.array(z.object({ text: z.string(), done: z.boolean().optional(), source: z.string().optional() })).optional().describe("Open TODOs / issues / plan items you found; source = file:line."),
            files_found: z.array(z.string()).optional().describe("Paths you looked at."),
          }) },
      ],
    },
  });
})();
