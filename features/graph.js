(() => {
  const MAX_NODES = 2000;

  async function graphData(db, around, depth) {
    const pages = await db.prepare("SELECT p.slug, p.title, p.kind FROM pages p WHERE p.kind != 'db_row' AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug) ORDER BY p.updated DESC").all();
    const rows = visibleOnly(db, pages.results ?? []);
    const known = new Set(rows.map(row => String(row.slug)));
    if (around !== null && !known.has(around)) return null;
    const links = await db.prepare("SELECT src, dst FROM links WHERE src != dst").all();
    let edges = (links.results ?? []).map(row => [String(row.src), String(row.dst)]).filter(([src, dst]) => known.has(src) && known.has(dst));
    let keep = known;
    if (around !== null) {
      const next = new Map();
      for (const [src, dst] of edges) {
        if (!next.has(src)) next.set(src, []);
        if (!next.has(dst)) next.set(dst, []);
        next.get(src).push(dst);
        next.get(dst).push(src);
      }
      keep = new Set([around]);
      let frontier = [around];
      for (let step = 0; step < depth; step++) {
        const found = [];
        for (const slug of frontier) for (const near of next.get(slug) || []) if (!keep.has(near)) { keep.add(near); found.push(near); }
        frontier = found;
      }
    }
    const chosen = rows.filter(row => keep.has(String(row.slug)));
    if (around !== null) chosen.sort((a, b) => (String(b.slug) === around) - (String(a.slug) === around));
    const nodes = chosen.slice(0, MAX_NODES).map(row => ({ slug: String(row.slug), title: String(row.title), kind: String(row.kind), links: 0 }));
    const bySlug = new Map(nodes.map(node => [node.slug, node]));
    edges = edges.filter(([src, dst]) => bySlug.has(src) && bySlug.has(dst));
    for (const [src, dst] of edges) { bySlug.get(src).links++; bySlug.get(dst).links++; }
    return { nodes, edges };
  }

  function graphHtml() {
    const versions = globalThis.ACARD_STATIC_VERSIONS || {};
    const asset = ext => "/lazy/graph." + ext + (versions["lazy/graph." + ext] ? "?v=" + versions["lazy/graph." + ext] : "");
    return [
      '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light dark">',
      '<title>그래프 보기 · Acard</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">',
      '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/editor.css">',
      '<link rel="stylesheet" href="/acard-shell.css"><link rel="stylesheet" href="/acard-mobile.css">',
      '<link rel="stylesheet" href="' + asset("css") + '"></head><body class="reader">',
      '<a class="skip" href="#main">본문으로</a>',
      mobileBarHtml("Acard"),
      '<div class="shell"><nav class="sidebar" id="sidebar" aria-label="문서 목록">',
      sideNavHtml([], "graph", "Acard").replace('<div class="side-ws">', PJ_SIDE_PH + '<div class="side-ws">'),
      sideFootHtml(),
      '</nav><main id="main" class="graph-main"><div id="results" class="results" hidden></div>',
      '<section id="graph-page" aria-labelledby="graph-title">',
      '<header class="graph-heading"><h1 id="graph-title">그래프 보기</h1>',
      '<div class="graph-tools"><input id="graph-q" type="search" placeholder="제목 찾기" aria-label="제목 찾기" autocomplete="off">',
      '<label><input type="checkbox" id="graph-around"> 이 페이지 주변만</label>',
      '<label><input type="checkbox" id="graph-depth"> 2단계까지</label></div></header>',
      '<p id="graph-status" class="graph-status" role="status" aria-live="polite"></p>',
      '<canvas id="graph-canvas" class="graph-canvas" aria-label="페이지 연결 그래프"></canvas>',
      '</section></main></div>',
      thumbBarHtml("graph"), paletteHtml(), shortcutsHtml(), sidePanelHtml(),
      '<script src="/app.js"></script>', FOLDERS_TAG,
      '<script src="' + asset("js") + '"></script></body></html>',
    ].join("\n");
  }

  registerFeature({
    api: async ({ path, method, env, db, url, helpers }) => {
      if (path !== "/api/graph") return null;
      if (isGuest(env)) return helpers.json({ error: "권한이 없어요." }, 403);
      if (method !== "GET") return helpers.json({ error: "method_not_allowed" }, 405);
      const raw = url.searchParams.get("around");
      const around = raw ? resolveSlug(raw) : null;
      const depth = url.searchParams.get("depth") === "2" ? 2 : 1;
      const data = await graphData(db, around, depth);
      return data ? helpers.json(data) : helpers.json({ error: "없는 페이지예요." }, 404);
    },
    authenticatedRoutes: async ({ path, method, env }) => {
      if (path !== "/graph" && path !== "/graph/") return null;
      if (isGuest(env)) return new Response("권한이 없어요.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      return new Response(method === "HEAD" ? null : graphHtml(), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
      });
    },
  });
})();
