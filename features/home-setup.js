(() => {
  const PRESETS = ["board", "blog", "notes", "progress"];
  const STATUS = [{ id: "todo", name: "할 일", color: "gray" }, { id: "doing", name: "진행 중", color: "purple" }, { id: "done", name: "완료", color: "green" }];
  const PRIORITY = [{ id: "high", name: "높음", color: "red" }, { id: "mid", name: "보통", color: "blue" }, { id: "low", name: "낮음", color: "gray" }];
  const POST_STATE = [{ id: "draft", name: "초안", color: "gray" }, { id: "published", name: "발행", color: "green" }];
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  const STARTERS = {
    board: () => ({
      title: "작업 보드", icon: "",
      properties: [
        { id: "title", name: "이름", type: "title" },
        { id: "status", name: "상태", type: "status", config: { options: STATUS } },
        { id: "priority", name: "우선순위", type: "select", config: { options: PRIORITY } },
        { id: "due", name: "마감일", type: "date" },
        { id: "tag", name: "태그", type: "multi_select", config: { options: [{ id: "design", name: "디자인", color: "pink" }, { id: "dev", name: "개발", color: "blue" }, { id: "plan", name: "기획", color: "yellow" }] } },
      ],
      board: true,
      rows: [
        ["홈 화면 구성하기", "todo", "high", 2, ["design"]],
        ["블로그 글 작성", "todo", "mid", 5, ["plan"]],
        ["에이전트 기능 기획", "todo", "low", 9, ["plan"]],
        ["작업 보드 개선", "doing", "high", 1, ["dev"]],
        ["디자인 시스템 정리", "doing", "mid", 4, ["design"]],
        ["프로젝트 버그 수정", "done", "low", -2, ["dev"]],
        ["테스트 케이스 작성", "done", "mid", -4, ["dev"]],
      ].map(([title, status, priority, due, tag]) => ({ title, props: { status, priority, due: { start: day(due), end: null }, tag } })),
    }),
    blog: () => ({
      title: "블로그", icon: "",
      properties: [
        { id: "title", name: "제목", type: "title" },
        { id: "state", name: "상태", type: "select", config: { options: POST_STATE } },
        { id: "date", name: "날짜", type: "date" },
      ],
      rows: [["Acard 소개글 작성하기", 0], ["개발 일지 #1", -2], ["프로젝트 회고", -4]]
        .map(([title, d]) => ({ title, props: { state: "draft", date: { start: day(d), end: null } } })),
    }),
    notes: () => ({ title: "작업 노트", note: "# 작업 노트\n\n자주 여는 메모를 여기에 모아 두세요. 왼쪽 목록의 즐겨찾기에도 고정돼 있어요.\n\n- [ ] 오늘 할 일 적기\n- [ ] 참고 링크 모으기" }),
  };

  async function uniqueSlug(db, title) {
    let slug = slugify(title);
    while (await db.prepare("SELECT 1 FROM pages WHERE slug = ? UNION ALL SELECT 1 FROM databases WHERE slug = ? UNION ALL SELECT 1 FROM editor_trash WHERE page = ?").bind(slug, slug, slug).first()) {
      slug = slugify(title) + "-" + Math.random().toString(36).slice(2, 6);
    }
    return slug;
  }

  async function buildStarter(db, key) {
    const spec = STARTERS[key]();
    const slug = await uniqueSlug(db, spec.title);
    const now = Date.now();
    const top = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM pages WHERE parent IS NULL").first();
    const ord = Number(top && top.m ? top.m : 0) + 10;
    if (spec.note) {
      await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, NULL, ?, 'note', ?, 'editor', NULL)").bind(slug, spec.title, ord, now).run();
      await saveBlocks(db, slug, normaliseBlocks(markdownToBlocks(spec.note)));
      await db.prepare("INSERT INTO editor_page_settings (page, favorite) VALUES (?, 1) ON CONFLICT (page) DO UPDATE SET favorite = 1").bind(slug).run();
      return { slug, title: spec.title };
    }
    await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, NULL, ?, 'db', ?, 'editor', NULL)").bind(slug, spec.title, ord, now).run();
    await saveBlocks(db, slug, normaliseBlocks([]));
    const made = await createDatabase(db, { slug, title: spec.title, properties: spec.properties });
    const id = made.id;
    if (spec.board) {
      await db.prepare("INSERT INTO db_views (id, database_id, name, type, config, ord) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(scopedId(id, dbId("v")), id, "보드", "board", JSON.stringify({ filter: null, sorts: [], group_by: scopedId(id, "status"), visible: null, widths: {}, calculations: {} }), -10).run();
    }
    const statements = [];
    spec.rows.forEach((row, index) => {
      const rowSlug = slug + "-" + (index + 1) + "-" + Math.random().toString(36).slice(2, 6);
      const props = {};
      for (const [k, v] of Object.entries(row.props)) {
        const scoped = scopedId(id, k);
        props[scoped] = Array.isArray(v) ? v.map((o) => o) : v;
      }
      statements.push(db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'db_row', ?, 'editor', NULL)").bind(rowSlug, row.title, slug, (index + 1) * 10, now - index * 3600000));
      statements.push(db.prepare("INSERT INTO blocks (page, id, ord, type, text, checked, indent, meta) VALUES (?, 'b1', 0, 'paragraph', '', 0, 0, NULL)").bind(rowSlug));
      statements.push(db.prepare("INSERT INTO db_rows (id, database_id, page, props, ord, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(scopedId(id, "r" + (index + 1)), id, rowSlug, JSON.stringify(props), (index + 1) * 10, now, now));
    });
    await db.batch(statements);
    return { slug: made.slug, title: spec.title };
  }

  async function ensureStarter(db, key) {
    const stateKey = "starter:" + key;
    const receipt = JSON.stringify({ claim: crypto.randomUUID() });
    await db.prepare("INSERT OR IGNORE INTO feature_templates_state (key, value) VALUES (?, ?)").bind(stateKey, receipt).run();
    const stored = await db.prepare("SELECT value FROM feature_templates_state WHERE key = ?").bind(stateKey).first();
    if (!stored || stored.value !== receipt) return { key, created: false };
    try {
      const made = await buildStarter(db, key);
      await db.prepare("UPDATE feature_templates_state SET value = ? WHERE key = ?").bind(JSON.stringify(made), stateKey).run();
      return { key, created: true, slug: made.slug };
    } catch (error) {
      await db.prepare("DELETE FROM feature_templates_state WHERE key = ? AND value = ?").bind(stateKey, receipt).run();
      throw error;
    }
  }

  function optionOf(prop, value) {
    const options = (prop && prop.config && prop.config.options) || [];
    return options.find((o) => o.id === value) || null;
  }

  async function databaseSummary(db, slug) {
    const found = slug ? await readDatabase(db, slug) : null;
    if (!found) return null;
    const by = (type, name) => found.properties.find((p) => p.type === type && (!name || p.name === name)) || found.properties.find((p) => p.type === type);
    const status = by("status") || by("select");
    const priority = found.properties.find((p) => p.type === "select" && p !== status);
    const date = by("date");
    const tags = by("multi_select");
    const rows = found.rows.map((row) => {
      const st = status ? optionOf(status, row.props[status.id]) : null;
      const pr = priority ? optionOf(priority, row.props[priority.id]) : null;
      const due = date && row.props[date.id] ? row.props[date.id].start : null;
      return { title: row.pageTitle || "", page: row.page, status: st && st.id, statusName: st && st.name, priority: pr && pr.name, priorityColor: pr && pr.color, date: due, tags: tags ? (row.props[tags.id] || []).map((id) => (optionOf(tags, id) || {}).name).filter(Boolean) : [], updated: row.updated };
    });
    return { slug, title: found.database.title, columns: status ? status.config.options.map((o) => ({ id: o.id, name: o.name, color: o.color })) : [], rows };
  }

  registerFeature({
    api: async ({ path, method, request, db, helpers }) => {
      if (path === "/api/home/starter") {
        if (method !== "POST") return helpers.json({ error: "POST로 보내 주세요." }, 405);
        const body = await request.json().catch(() => ({}));
        const presets = Array.isArray(body && body.presets) ? [...new Set(body.presets)].filter((p) => STARTERS[p]) : [];
        const results = [];
        for (const key of presets) results.push(await ensureStarter(db, key));
        return helpers.json({ ok: true, results });
      }
      if (path === "/api/home/summary" && method === "GET") {
        const states = await db.prepare("SELECT key, value FROM feature_templates_state WHERE key LIKE 'starter:%'").all();
        const starters = {};
        for (const row of states.results || []) {
          try { const v = JSON.parse(row.value); if (v.slug) starters[row.key.slice(8)] = v.slug; } catch {}
        }
        const tree = await readTree(db);
        const live = new Set(tree.map((p) => p.slug));
        const recent = tree.filter((p) => p.slug !== "index").sort((a, b) => Number(b.updated) - Number(a.updated)).slice(0, 6).map((p) => ({ slug: p.slug, title: p.title, updated: Number(p.updated), kind: p.kind }));
        const pinned = tree.filter((p) => Number(p.favorite) === 1).slice(0, 8).map((p) => ({ slug: p.slug, title: p.title, kind: p.kind }));
        let sessions = [];
        try {
          const rows = await db.prepare("SELECT id, title, agent, status, events, updated FROM journal_sessions ORDER BY updated DESC LIMIT 4").all();
          sessions = (rows.results || []).map((r) => ({ id: r.id, title: r.title, agent: r.agent, status: r.status, events: Number(r.events), updated: Number(r.updated) }));
        } catch {}
        return helpers.json({
          board: live.has(starters.board) ? await databaseSummary(db, starters.board) : null,
          blog: live.has(starters.blog) ? await databaseSummary(db, starters.blog) : null,
          notes: live.has(starters.notes) ? { slug: starters.notes } : null,
          recent, pinned, sessions,
        });
      }
      return null;
    }
  });
})();
