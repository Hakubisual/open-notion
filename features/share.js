// Sharing and permissions. Route table: research/share/routes.md. Every decision goes through share-model.js.
(() => {
  const SCHEMA = [
    "CREATE TABLE IF NOT EXISTS share_links (token_hash TEXT PRIMARY KEY, page TEXT NOT NULL, created INTEGER, revoked INTEGER NULL, noindex INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS share_rules (id TEXT PRIMARY KEY, page TEXT NOT NULL, principal TEXT NOT NULL, role TEXT NOT NULL, expires INTEGER, created INTEGER NOT NULL, revoked INTEGER, token_hash TEXT UNIQUE)",
    "CREATE INDEX IF NOT EXISTS share_rules_page ON share_rules(page, revoked)",
    "CREATE INDEX IF NOT EXISTS share_rules_principal ON share_rules(principal, revoked)",
    "CREATE TABLE IF NOT EXISTS share_pages (page TEXT PRIMARY KEY, inherit INTEGER NOT NULL DEFAULT 1, allow_export INTEGER NOT NULL DEFAULT 0, allow_index INTEGER NOT NULL DEFAULT 0, publish_subpages INTEGER NOT NULL DEFAULT 0, site_title TEXT)",
    "CREATE TABLE IF NOT EXISTS share_invites (id_hash TEXT PRIMARY KEY, rule TEXT NOT NULL, email TEXT NOT NULL, code_hash TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, used INTEGER)",
    "CREATE INDEX IF NOT EXISTS share_invites_rule ON share_invites(rule)",
    "CREATE TABLE IF NOT EXISTS share_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, links TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER)",
    "CREATE TABLE IF NOT EXISTS share_requests (id TEXT PRIMARY KEY, page TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, note TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open')",
    "CREATE INDEX IF NOT EXISTS share_requests_page ON share_requests(page, status)",
    "CREATE TABLE IF NOT EXISTS share_rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL)",
    // Existing public links become 게시 rules; old /p/<token> URLs keep resolving. Idempotent, never revives a revoked rule.
    "INSERT OR IGNORE INTO share_rules (id, page, principal, role, expires, created, revoked, token_hash) SELECT 'pl-' || token_hash, page, 'publish', 'read', NULL, COALESCE(created, 0), NULL, token_hash FROM share_links WHERE revoked IS NULL",
  ];
  const INVITE_MS = 15 * 60 * 1000;
  const SV_BASE_CSS = "html{scrollbar-width:thin;scrollbar-color:transparent transparent}html:hover{scrollbar-color:color-mix(in srgb,var(--fg) 26%,transparent) transparent}" +
    "body.sv{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-body);font-size:var(--fs-16);line-height:1.8}.sv-tt{position:fixed;opacity:0;pointer-events:none;width:1px;height:1px}" +
    ".sv-bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:14px;height:52px;padding:0 20px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}" +
    ".sv-path{display:flex;align-items:center;gap:8px;min-width:0;font-size:var(--fs-14)}.sv-crumb{display:inline-flex;align-items:center;gap:8px;min-width:0;color:var(--fg);text-decoration:none}.sv-crumb span:last-child,.sv-here{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".sv-ico{display:inline-grid;place-items:center;width:22px;height:22px;flex:0 0 22px}.sv-ico img,.sv-ico svg{width:20px;height:20px;border-radius:5px}.sv-sep{color:var(--fg-dim)}.sv-here{color:var(--fg-dim)}.sv-grow{flex:1}" +
    ".sv-made{display:inline-flex;align-items:flex-end;gap:1px;color:var(--fg);font-size:var(--fs-13);line-height:1;text-decoration:none;white-space:nowrap}.sv-wm{display:block;height:22px;aspect-ratio:171.36/109.63;overflow:visible;color:currentColor}.sv-made span{display:block;line-height:1;margin-bottom:-0.12em}.sv-made:hover{text-decoration:underline}" +
    ".sv-theme{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:8px;color:var(--fg-dim);cursor:pointer}.sv-theme:hover{background:var(--bg-soft);color:var(--fg)}.sv-tt:focus-visible~.sv-bar .sv-theme{outline:2px solid var(--accent)}" +
    ".sv-notice{max-width:460px;margin:14vh auto 0;padding:0 24px;text-align:center}.sv-code{margin:0;color:var(--accent);font-weight:700;font-size:var(--fs-14);letter-spacing:.08em}.sv-notice h1{margin:8px 0 10px;font-size:var(--fs-28);letter-spacing:-.02em}.sv-notice p{color:var(--fg-dim)}" +
    ".sv-btn{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:999px;background:var(--accent);color:var(--on-accent);text-decoration:none;font-weight:600;font-size:var(--fs-14)}";
  const SV_PAGE_CSS = ".sv-cover .pagecover{position:relative;height:220px;margin:0;overflow:hidden;background:var(--cover);background-size:cover}.sv-cover .pagecover.img img{width:100%;height:100%;object-fit:cover}" +
    ".sv-cover .g1{background-image:var(--grad-1)}.sv-cover .g2{background-image:var(--grad-2)}.sv-cover .g3{background-image:var(--grad-3)}.sv-cover .g4{background-image:var(--grad-4)}.sv-cover .g5{background-image:var(--grad-5)}.sv-cover .g6{background-image:var(--grad-6)}" +
    ".sv-cover .brandcover img{position:absolute;right:9%;top:30px;width:150px;height:150px;opacity:.35}" +
    ".sv-wrap{display:grid;grid-template-columns:minmax(0,760px);justify-content:center;gap:56px;padding:0 24px 72px}.sv-wrap.has-toc{grid-template-columns:minmax(0,760px) 240px}" +
    ".sv-main{min-width:0}.sv-icon{display:grid;place-items:center;width:92px;height:92px;margin:-46px 0 18px;border-radius:22px;background:var(--surface);border:1px solid var(--line);box-shadow:0 8px 24px rgba(30,28,50,.08);position:relative}.sv-icon img{width:56px;height:56px}.sv-icon .emoji{font-size:var(--fs-44)}" +
    ".sv-title{margin:0 0 6px;font-size:var(--fs-44);line-height:1.2;letter-spacing:-.03em;font-weight:800}.sv-meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 32px;color:var(--fg-dim);font-size:var(--fs-14)}" +
    ".sv-toc{position:sticky;top:76px;align-self:start;margin-top:28px;max-height:calc(100dvh - 96px);overflow:auto;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--surface);font-size:var(--fs-14)}" +
    ".sv-toc summary{cursor:pointer;font-weight:700;font-size:var(--fs-16);list-style:none;display:flex;justify-content:space-between}.sv-toc summary::after{content:'\\2303';color:var(--fg-dim)}.sv-toc details:not([open]) summary::after{content:'\\2304'}" +
    ".sv-toc ol{list-style:none;margin:10px 0 0;padding:0}.sv-toc li a{display:flex;gap:10px;align-items:center;padding:7px 8px;border-radius:8px;color:var(--fg);text-decoration:none;line-height:1.4}.sv-toc li a:hover{background:var(--accent-soft);color:var(--accent-strong)}" +
    ".sv-toc .n{flex:0 0 22px;height:22px;display:grid;place-items:center;border-radius:6px;background:var(--bg-soft);color:var(--fg-dim);font-size:var(--fs-12)}.sv-toc .l3 a{padding-left:20px}.sv-toc .l4 a{padding-left:32px}" +
    ".sv-subs{margin-top:48px;padding-top:28px;border-top:1px solid var(--line)}.sv-subs h2{margin:0 0 14px;font-size:var(--fs-21)}.sv-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}" +
    ".sv-card{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--fg);text-decoration:none;transition:border-color .15s,box-shadow .15s}.sv-card:hover{border-color:var(--accent);box-shadow:0 6px 18px rgba(30,28,50,.08)}" +
    ".sv-cico{flex:0 0 40px;height:40px;display:grid;place-items:center;border-radius:10px;background:var(--accent-soft);color:var(--accent)}.sv-cico img,.sv-cico svg{width:22px;height:22px}.sv-ct{display:flex;flex-direction:column;gap:3px;min-width:0}.sv-ct b{font-size:var(--fs-15)}.sv-ct small{color:var(--fg-dim);font-size:var(--fs-13);line-height:1.5}" +
    ".sv-foot{display:flex;justify-content:center;padding:28px 0 40px;border-top:1px solid var(--line)}.sv-foot a{display:inline-flex;gap:8px;align-items:center;color:var(--fg-dim);font-size:var(--fs-13);text-decoration:none}" +
    ".sv-main [id]{scroll-margin-top:72px}.sv-toc-narrow{display:none}html{scroll-padding-top:72px}@media (max-width:1099px){.sv-toc-narrow{display:block}.sv-toc-wide{display:none}.sv-wrap.has-toc{grid-template-columns:minmax(0,760px)}.sv-toc{position:static;max-height:none;margin:0 0 8px}}" +
    "@media (max-width:640px){.sv-bar{padding:0 12px;gap:8px}.sv-made span{display:none}.sv-cover .pagecover{height:140px}.sv-cover .brandcover img{width:90px;height:90px;top:20px}.sv-wrap{padding:0 18px 56px}.sv-icon{width:72px;height:72px;margin-top:-36px}.sv-title{font-size:var(--fs-32)}}" +
    "@media print{.sv-bar,.sv-toc,.sv-foot,.sv-tt{display:none!important}.sv-cover .pagecover{height:120px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sv-wrap{display:block;padding:0}.sv-card{break-inside:avoid}a{color:inherit}}";
  const SESSION_S = 30 * 24 * 60 * 60;
  const MAX_TRIES = 5;
  const COOKIE = "acard_guest";
  const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,24}$/;
  const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

  const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
  const sha = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const code6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const wsTag = env => (!env.ACARD_WORKSPACE || env.ACARD_WORKSPACE === "owner" ? "o" : env.ACARD_WORKSPACE);
  const sharePrefix = env => env.ACARD_SHARE_PREFIX || "/p/";
  const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...noStore, "content-type": "application/json; charset=utf-8", ...extra } });
  const page401 = (message, extra = {}, request = "") => new Response(shell("권한이 없어요", "<h1>권한이 없어요</h1><p>" + escapeHtml(message) + "</p>" + (request ? '<p><a href="' + escapeHtml(request) + '">권한 요청하기</a></p>' : "")), { status: 401, headers: { ...noStore, "content-type": "text/html; charset=utf-8", ...extra } });

  async function hmacToken(env, label) {
    if (!env.GATE_SECRET) throw new Error("share secret is not configured");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GATE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(label))));
  }
  // Link and publish URLs are derived from the server secret and a random 128-bit rule id, so the owner can copy them
  // again later while the database keeps only their SHA-256.
  const ruleToken = (env, rule) => hmacToken(env, "share-url:" + (env.ACARD_WORKSPACE || "owner") + ":" + rule);

  function shell(title, body) {
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>' + escapeHtml(title) + " · Acard</title>" +
      "<style>body{margin:0;font:var(--fs-16,16px)/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;background:linear-gradient(160deg,#eefbfd,#f6f2ff);color:#24223a;min-height:100vh;display:grid;place-items:center}" +
      "main{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid #e6e3f2;border-radius:18px;padding:28px;box-shadow:0 18px 50px rgba(60,50,120,.12)}h1{font-size:var(--fs-21,21px);margin:0 0 10px}p{color:#5d5a75}" +
      "label{display:block;font-size:var(--fs-14,14px);margin:14px 0 6px}input,select,textarea{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #d9d5ea;border-radius:10px;font:inherit}" +
      "button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:10px;background:#3aa9c4;color:#fff;font:inherit;font-weight:600;cursor:pointer}.err{color:#b23c52}</style></head><body><main>" + body + "</main></body></html>";
  }

  async function hit(db, key, limit, periodMs) {
    const now = Date.now();
    const row = await db.prepare("SELECT count, reset FROM share_rate WHERE key = ?").bind(key).first();
    if (!row || Number(row.reset) <= now) {
      await db.prepare("INSERT INTO share_rate (key, count, reset) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, reset = excluded.reset").bind(key, now + periodMs).run();
      return true;
    }
    if (Number(row.count) >= limit) return false;
    await db.prepare("UPDATE share_rate SET count = count + 1 WHERE key = ?").bind(key).run();
    return true;
  }

  async function loadModel(db) {
    const [pages, settings, rules] = await Promise.all([
      db.prepare("SELECT slug, parent FROM pages p WHERE NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug)").all(),
      db.prepare("SELECT page, inherit, publish_subpages FROM share_pages").all(),
      db.prepare("SELECT id, page, principal, role, expires FROM share_rules WHERE revoked IS NULL").all(),
    ]);
    const parents = new Map();
    for (const row of pages.results ?? []) parents.set(String(row.slug), row.parent === null || row.parent === undefined ? null : String(row.parent));
    const inherit = new Map(), subpages = new Map();
    for (const row of settings.results ?? []) { inherit.set(String(row.page), Number(row.inherit) !== 0); subpages.set(String(row.page), Number(row.publish_subpages) === 1); }
    return { parents, inherit, subpages, rules: (rules.results ?? []).map(rule => ({ ...rule, expires: rule.expires === null ? null : Number(rule.expires) })), now: Date.now() };
  }

  async function pageFlag(db, model, slug, column) {
    const chain = shareChain(model, slug);
    if (!chain.length) return false;
    const rows = await db.prepare("SELECT page, " + column + " AS value FROM share_pages WHERE page IN (" + chain.map(() => "?").join(",") + ")").bind(...chain).all();
    return (rows.results ?? []).some(row => Number(row.value) === 1);
  }

  async function readSession(db, token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = await db.prepare("SELECT token_hash, email, links FROM share_sessions WHERE token_hash = ? AND revoked IS NULL AND expires > ?").bind(await sha(token), Date.now()).first();
    if (!row) return null;
    let links = [];
    try { links = JSON.parse(row.links); } catch { links = []; }
    return { id: row.token_hash, email: String(row.email), links: new Set(Array.isArray(links) ? links.map(String) : []) };
  }

  // The view database hides every page this caller cannot read from tree, search, backlinks and embeds in core.
  function viewDb(db, visible, roles) {
    return { prepare: sql => db.prepare(sql), batch: list => db.batch(list), acardKey: db.acardKey, acardVisible: visible, acardRoles: roles };
  }

  const clearCookie = COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  const STATIC = /^\/(?:[\w.-]+\.(?:css|js|svg|png|ico|webmanifest)|img\/[\w./-]+|lazy\/[\w.-]+\.(?:css|js)|templates-seed\.json)$/;
  const P = "^\\/api\\/page\\/([^/]+)";
  // need: read | comment | edit | full | export | move | any (signed-in guest) | list | asset | media | home | create
  const GUEST_ROUTES = [
    ["GET|HEAD", STATIC, "asset"],
    ["GET|HEAD", /^\/sw\.js$/, "asset"],
    ["GET|HEAD", /^\/(?:index\.html)?$/, "home"],
    ["GET|HEAD", /^\/edit\/([^/]+)\/?$/, "edit"],
    ["GET|HEAD", /^\/print\/(.+?)\/?$/, "export"],
    ["GET|HEAD", /^\/media\/([0-9a-f]{16})\/?$/, "media"],
    ["GET", /^\/api\/(?:tree|search|db\/list)$/, "list"],
    ["GET", /^\/api\/backlinks$/, "read", url => url.searchParams.get("slug")],
    ["POST", /^\/api\/pages$/, "create"],
    ["GET", new RegExp(P + "$"), "read"],
    ["PUT", new RegExp(P + "$"), "edit"],
    ["DELETE", new RegExp(P + "$"), "delete"],
    ["POST", new RegExp(P + "\\/rename$"), "edit"],
    ["POST", new RegExp(P + "\\/move$"), "move"],
    ["PATCH", new RegExp(P + "\\/blocks$"), "edit"],
    ["GET", new RegExp(P + "\\/settings$"), "read"],
    ["PUT", new RegExp(P + "\\/settings$"), "edit"],
    ["GET", new RegExp(P + "\\/comments$"), "read"],
    ["POST", new RegExp(P + "\\/comments$"), "comment"],
    ["PATCH|DELETE", new RegExp(P + "\\/comments\\/[^/]+$"), "edit"],
    ["GET", new RegExp(P + "\\/history$"), "edit"],
    ["POST", new RegExp(P + "\\/history\\/[^/]+\\/restore$"), "edit"],
    ["GET", new RegExp(P + "\\/access$"), "read"],
    ["POST", new RegExp(P + "\\/access\\/request$"), "any"],
    ["GET|POST|PUT|PATCH|DELETE", new RegExp(P + "\\/(?:access|share)(?:\\/.*)?$"), "full"],
    ["GET", /^\/api\/db\/([^/]+)$/, "read"],
    ["PATCH", /^\/api\/db\/([^/]+)$/, "edit"],
    ["DELETE", /^\/api\/db\/([^/]+)$/, "delete"],
    ["POST|PATCH|DELETE", /^\/api\/db\/([^/]+)\/(?:rows|properties|views|templates)(?:\/[^/]+)?$/, "edit"],
    ["GET", /^\/api\/export$/, "export", url => url.searchParams.get("slug")],
    ["GET|HEAD", /^\/([^/]+)\/?$/, "read"],
  ];

  function matchGuestRoute(method, path, url) {
    for (const [methods, pattern, need, pick] of GUEST_ROUTES) {
      if (!methods.split("|").includes(method)) continue;
      const match = pattern.exec(path);
      if (!match) continue;
      let slug = pick ? pick(url) : match[1];
      if (slug !== undefined && slug !== null) {
        try { slug = resolveSlug(decodeURIComponent(slug)); } catch { return { need: "deny" }; }
      }
      return { need, slug };
    }
    return { need: "deny" };
  }

  async function mediaReadable(db, id, visible) {
    const owner = await db.prepare("SELECT page FROM media WHERE id = ?").bind(id).first();
    if (owner && owner.page && visible.has(String(owner.page))) return true;
    const rows = await db.prepare("SELECT DISTINCT page FROM blocks WHERE meta LIKE ?").bind("%/media/" + id + "%").all();
    return (rows.results ?? []).some(row => visible.has(String(row.page)));
  }

  function rootOf(model, slug, email) {
    for (const page of shareChain(model, slug)) {
      if (model.rules.some(rule => rule.page === page && rule.principal === "email:" + email && ruleActive(rule, model.now))) return page;
    }
    return null;
  }

  async function guestFetch(request, env, url, next) {
    const db = env.DB;
    if (!db) return reply({ error: "저장소가 연결되지 않았어요." }, 503);
    await ensureSchema(db);
    const session = await readSession(db, env.ACARD_GUEST_TOKEN);
    if (!session) return url.pathname.startsWith("/api/") ? reply({ error: "공유 세션이 끝났어요. 초대 링크를 다시 열어 주세요." }, 401, { "set-cookie": clearCookie }) : page401("공유 세션이 끝났어요. 초대 링크를 다시 열어 주세요.", { "set-cookie": clearCookie });
    const method = request.method.toUpperCase();
    const path = url.pathname;
    const model = await loadModel(db);
    const who = { kind: "guest", email: session.email, links: session.links };
    const roles = new Map();
    for (const slug of model.parents.keys()) { const role = shareRole(model, slug, who); if (role !== "none") roles.set(slug, role); }
    const visible = new Set(roles.keys());
    const roleOf = slug => roles.get(slug) || "none";
    const route = matchGuestRoute(method, path, url);
    const denied = message => path.startsWith("/api/") ? reply({ error: message || "이 페이지에 대한 권한이 없어요." }, 401) : page401(message || "이 페이지를 볼 권한이 없어요. 공유한 사람에게 권한을 요청해 주세요.", {}, route.slug && method === "GET" ? "/s/" + wsTag(env) + "/r/" + encodeURIComponent(route.slug) : "");
    const view = acardHost.trust({ ...env, ACARD_GUEST_TOKEN: undefined, ACARD_SESSION: "guest", ACARD_GUEST_EMAIL: session.email, ACARD_GUEST_SESSION: session.id, DB: viewDb(db, visible, roles) });
    const pass = () => next(request, view);
    switch (route.need) {
      case "asset": return pass();
      case "list": return pass();
      case "home": {
        const roots = [...visible].filter(slug => !visible.has(model.parents.get(slug)));
        if (roots.length) return new Response(null, { status: 302, headers: { ...noStore, location: "/" + encodeURIComponent(roots[0]) + "/" } });
        return page401("아직 공유받은 페이지가 없어요.");
      }
      case "media": return (await mediaReadable(db, path.split("/")[2], visible)) ? pass() : denied();
      case "any": return pass();
      case "create": {
        const body = await request.clone().json().catch(() => ({}));
        const parent = body && body.parent ? String(body.parent) : null;
        return parent && shareAtLeast(roleOf(parent), "edit") ? pass() : denied("공유받은 페이지 안에만 새 페이지를 만들 수 있어요.");
      }
      case "move": {
        const body = await request.clone().json().catch(() => ({}));
        const parent = body && body.parent ? String(body.parent) : null;
        return roleOf(route.slug) === "full" && parent && roleOf(parent) === "full" ? pass() : denied("전체 허용 권한이 있는 페이지 사이에서만 옮길 수 있어요.");
      }
      case "delete":
        return roleOf(route.slug) === "full" && rootOf(model, route.slug, session.email) !== route.slug ? pass() : denied("공유된 맨 위 페이지는 지울 수 없어요.");
      case "export": {
        if (!shareAtLeast(roleOf(route.slug), "read")) return denied();
        if (path === "/api/export" && (url.searchParams.get("scope") === "all" || url.searchParams.get("format") === "zip")) return denied("전체 내보내기는 할 수 없어요.");
        return (await pageFlag(db, model, route.slug, "allow_export")) ? pass() : denied("이 페이지는 내보내기가 꺼져 있어요.");
      }
      case "edit":
        if (path.startsWith("/edit/") && shareAtLeast(roleOf(route.slug), "read") && !shareAtLeast(roleOf(route.slug), "edit")) {
          return new Response(null, { status: 302, headers: { ...noStore, location: "/" + encodeURIComponent(route.slug) + "/" } });
        }
        return shareAtLeast(roleOf(route.slug), "edit") ? pass() : denied();
      case "read": case "comment": case "full":
        return shareAtLeast(roleOf(route.slug), route.need) ? pass() : denied();
      default: return denied();
    }
  }

  async function createInvite(db, env, rule, email) {
    const id = randomToken();
    const code = code6();
    const now = Date.now();
    await db.prepare("UPDATE share_invites SET used = ? WHERE rule = ? AND used IS NULL").bind(now, rule).run();
    await db.prepare("INSERT INTO share_invites (id_hash, rule, email, code_hash, created, expires) VALUES (?, ?, ?, ?, ?, ?)").bind(await sha(id), rule, email, await sha(id + ":" + code), now, now + INVITE_MS).run();
    return { url: "/s/" + wsTag(env) + "/i/" + id, code, expires: now + INVITE_MS };
  }

  async function agentTokens(db) {
    try {
      const rows = await db.prepare("SELECT id, name, scopes FROM agent_tokens WHERE revoked IS NULL ORDER BY created DESC").all();
      return (rows.results ?? []).map(row => ({ id: String(row.id), name: String(row.name), scopes: String(row.scopes).split(" ").filter(Boolean) }));
    } catch { return []; }
  }

  function ruleView(rule, slug) {
    const email = rule.principal.startsWith("email:") ? rule.principal.slice(6) : null;
    return { id: rule.id, kind: email ? "email" : rule.principal, email, role: rule.role, expires: rule.expires, page: rule.page, inherited: rule.page !== slug };
  }

  async function accessState(db, env, slug, callerRole) {
    const model = await loadModel(db);
    if (callerRole !== "full") return { page: slug, role: callerRole };
    const chain = shareChain(model, slug);
    const settings = await db.prepare("SELECT * FROM share_pages WHERE page = ?").bind(slug).first();
    const own = model.rules.filter(rule => rule.page === slug);
    const linkRule = model.rules.find(rule => rule.principal === "link" && chain.includes(rule.page));
    const publishRules = own.filter(rule => rule.principal === "publish");
    const derived = publishRules.find(rule => !rule.id.startsWith("pl-"));
    const requests = await db.prepare("SELECT id, email, role, note, created FROM share_requests WHERE page = ? AND status = 'open' ORDER BY created").bind(slug).all();
    const tokens = await agentTokens(db);
    const parent = model.parents.get(slug);
    return {
      page: slug,
      role: "full",
      inherit: !settings || Number(settings.inherit) !== 0,
      parent: parent && model.parents.has(parent) ? parent : null,
      people: describeAccess(model, slug).filter(rule => rule.principal.startsWith("email:")).map(rule => ruleView(rule, slug)),
      link: linkRule ? { ...ruleView(linkRule, slug), url: sharePrefix(env) + await ruleToken(env, linkRule.id) } : null,
      settings: { allowExport: Number(settings?.allow_export) === 1, allowIndex: Number(settings?.allow_index) === 1, publishSubpages: Number(settings?.publish_subpages) === 1, siteTitle: settings?.site_title || "" },
      publish: publishRules.length ? { url: derived ? sharePrefix(env) + await ruleToken(env, derived.id) : null, legacy: publishRules.filter(rule => rule.id.startsWith("pl-")).length } : null,
      requests: requests.results ?? [],
      agents: tokens.map(token => {
        const near = chain.map(page => model.rules.find(rule => rule.page === page && rule.principal === "agent:token:" + token.id)).find(Boolean);
        return { ...token, level: near ? near.role : "inherit", inherited: Boolean(near && near.page !== slug), effective: agentScopes(model, slug, "token:" + token.id, token.scopes) };
      }),
      mailer: false,
    };
  }

  async function upsertEmailRule(db, slug, email, role) {
    const existing = await db.prepare("SELECT id FROM share_rules WHERE page = ? AND principal = ? AND revoked IS NULL").bind(slug, "email:" + email).first();
    if (existing) {
      await db.prepare("UPDATE share_rules SET role = ? WHERE id = ?").bind(role, existing.id).run();
      return String(existing.id);
    }
    const id = randomId();
    await db.prepare("INSERT INTO share_rules (id, page, principal, role, expires, created) VALUES (?, ?, ?, ?, NULL, ?)").bind(id, slug, "email:" + email, role, Date.now()).run();
    return id;
  }

  const bodyOf = request => request.json().then(body => (body && typeof body === "object" && !Array.isArray(body) ? body : {})).catch(() => ({}));
  const expiresOf = value => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) && Number(value) > 0 ? Math.trunc(Number(value)) : undefined);

  // A permanently deleted page frees its slug; its sharing must not carry over to a new page with the same slug.
  async function forgetDeletedPage({ path, method, db }) {
    const match = /^\/api\/page\/([^/]+)\/permanent\/?$/.exec(path);
    if (!match || method !== "DELETE") return null;
    let slug;
    try { slug = resolveSlug(decodeURIComponent(match[1])); } catch { return null; }
    if (!(await db.prepare("SELECT page FROM editor_trash WHERE page = ?").bind(slug).first())) return null;
    await db.batch([
      db.prepare("DELETE FROM share_rules WHERE page = ? AND principal != 'publish'").bind(slug),
      db.prepare("UPDATE share_rules SET revoked = ? WHERE page = ? AND principal = 'publish' AND revoked IS NULL").bind(Date.now(), slug),
      db.prepare("DELETE FROM share_requests WHERE page = ?").bind(slug),
      db.prepare("DELETE FROM share_pages WHERE page = ?").bind(slug),
    ]);
    return null;
  }

  async function accessApi({ path, method, request, db, env }) {
    const match = /^\/api\/page\/([^/]+)\/access(?:\/(.*))?$/.exec(path);
    if (!match) return forgetDeletedPage({ path, method, db });
    let slug;
    try { slug = resolveSlug(decodeURIComponent(match[1])); } catch { return reply({ error: "주소를 읽지 못했어요." }, 400); }
    const exists = await db.prepare("SELECT slug FROM pages WHERE slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = pages.slug)").bind(slug).first();
    if (!exists) return reply({ error: "없는 페이지예요." }, 404);
    const callerRole = db.acardRoles ? db.acardRoles.get(slug) || "none" : "full";
    const rest = match[2] || "";
    if (!rest && method === "GET") return reply(await accessState(db, env, slug, callerRole));
    if (rest === "request" && method === "POST") {
      const email = env.ACARD_GUEST_EMAIL;
      if (!email) return reply({ error: "이메일을 확인한 게스트만 요청할 수 있어요." }, 401);
      const body = await bodyOf(request);
      const role = body.role === "edit" ? "edit" : "read";
      if (!(await hit(db, "request:" + email, 10, 60 * 60 * 1000))) return reply({ error: "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요." }, 429);
      await db.prepare("INSERT INTO share_requests (id, page, email, role, note, created) VALUES (?, ?, ?, ?, ?, ?)").bind(randomId(), slug, email, role, String(body.note || "").slice(0, 300), Date.now()).run();
      return reply({ ok: true }, 201);
    }
    if (callerRole !== "full") return reply({ error: "전체 허용 권한이 있어야 공유 설정을 바꿀 수 있어요." }, 401);
    const body = method === "GET" || method === "DELETE" ? {} : await bodyOf(request);

    if (!rest && method === "POST") {
      const emails = String(body.email || "").split(/[\s,]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
      const role = GUEST_ROLES.includes(body.role) ? body.role : "read";
      if (!emails.length || emails.length > 20 || emails.some(email => !EMAIL.test(email))) return reply({ error: "이메일 주소를 확인해 주세요." }, 400);
      const invites = [];
      for (const email of emails) {
        const rule = await upsertEmailRule(db, slug, email, role);
        invites.push({ email, rule, role, ...(await createInvite(db, env, rule, email)) });
      }
      return reply({ invites, mailer: false }, 201);
    }
    const ruleMatch = /^rules\/([0-9a-z-]+)(\/code)?$/.exec(rest);
    if (ruleMatch) {
      const rule = await db.prepare("SELECT id, page, principal, role FROM share_rules WHERE id = ? AND page = ? AND revoked IS NULL").bind(ruleMatch[1], slug).first();
      if (!rule) return reply({ error: "이 페이지의 규칙이 아니에요. 상속된 규칙은 상위 페이지에서 바꿔 주세요." }, 404);
      if (ruleMatch[2] && method === "POST") {
        if (!String(rule.principal).startsWith("email:")) return reply({ error: "이메일 초대에만 코드가 있어요." }, 400);
        return reply(await createInvite(db, env, rule.id, String(rule.principal).slice(6)), 201);
      }
      if (method === "PATCH") {
        const role = GUEST_ROLES.includes(body.role) ? body.role : null;
        const expires = expiresOf(body.expires);
        if (!role && expires === undefined) return reply({ error: "바꿀 것이 없어요." }, 400);
        if (role) await db.prepare("UPDATE share_rules SET role = ? WHERE id = ?").bind(role, rule.id).run();
        if (expires !== undefined && "expires" in body) await db.prepare("UPDATE share_rules SET expires = ? WHERE id = ?").bind(expires, rule.id).run();
        return reply({ ok: true });
      }
      if (method === "DELETE") {
        await db.batch([
          db.prepare("UPDATE share_rules SET revoked = ? WHERE id = ?").bind(Date.now(), rule.id),
          db.prepare("UPDATE share_invites SET used = ? WHERE rule = ? AND used IS NULL").bind(Date.now(), rule.id),
        ]);
        return reply({ ok: true });
      }
    }
    if (rest === "general" && method === "PUT") {
      const current = await db.prepare("SELECT id FROM share_rules WHERE page = ? AND principal = 'link' AND revoked IS NULL").bind(slug).first();
      if (body.mode === "invited") {
        if (current) await db.prepare("UPDATE share_rules SET revoked = ? WHERE id = ?").bind(Date.now(), current.id).run();
        return reply({ ok: true, link: null });
      }
      if (body.mode !== "link") return reply({ error: "일반 사용 권한을 골라 주세요." }, 400);
      const role = ["read", "comment", "edit"].includes(body.role) ? body.role : "read";
      const expires = expiresOf(body.expires);
      if (expires === undefined) return reply({ error: "만료 날짜를 확인해 주세요." }, 400);
      let id = current && String(current.id);
      if (id) await db.prepare("UPDATE share_rules SET role = ?, expires = ? WHERE id = ?").bind(role, expires, id).run();
      else {
        id = randomId();
        const token = await ruleToken(env, id);
        await db.prepare("INSERT INTO share_rules (id, page, principal, role, expires, created, token_hash) VALUES (?, ?, 'link', ?, ?, ?, ?)").bind(id, slug, role, expires, Date.now(), await sha(token)).run();
      }
      return reply({ ok: true, link: { id, role, expires, url: sharePrefix(env) + await ruleToken(env, id) } });
    }
    if (rest === "settings" && method === "PUT") {
      const current = await db.prepare("SELECT * FROM share_pages WHERE page = ?").bind(slug).first() || { inherit: 1, allow_export: 0, allow_index: 0, publish_subpages: 0, site_title: null };
      const flag = (name, key) => (typeof body[key] === "boolean" ? (body[key] ? 1 : 0) : Number(current[name]) || 0);
      const next = {
        inherit: typeof body.inherit === "boolean" ? (body.inherit ? 1 : 0) : Number(current.inherit) === 0 ? 0 : 1,
        allow_export: flag("allow_export", "allowExport"), allow_index: flag("allow_index", "allowIndex"), publish_subpages: flag("publish_subpages", "publishSubpages"),
        site_title: typeof body.siteTitle === "string" ? body.siteTitle.trim().slice(0, 120) || null : current.site_title,
      };
      await db.prepare("INSERT INTO share_pages (page, inherit, allow_export, allow_index, publish_subpages, site_title) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(page) DO UPDATE SET inherit = excluded.inherit, allow_export = excluded.allow_export, allow_index = excluded.allow_index, publish_subpages = excluded.publish_subpages, site_title = excluded.site_title")
        .bind(slug, next.inherit, next.allow_export, next.allow_index, next.publish_subpages, next.site_title).run();
      return reply({ ok: true });
    }
    if (rest === "publish" && method === "POST") {
      const current = await db.prepare("SELECT id FROM share_rules WHERE page = ? AND principal = 'publish' AND revoked IS NULL AND id NOT LIKE 'pl-%'").bind(slug).first();
      let id = current && String(current.id);
      if (!id) {
        id = randomId();
        await db.prepare("INSERT INTO share_rules (id, page, principal, role, expires, created, token_hash) VALUES (?, ?, 'publish', 'read', NULL, ?, ?)").bind(id, slug, Date.now(), await sha(await ruleToken(env, id))).run();
      }
      return reply({ ok: true, url: sharePrefix(env) + await ruleToken(env, id) }, 201);
    }
    if (rest === "publish" && method === "DELETE") {
      const now = Date.now();
      await db.batch([
        db.prepare("UPDATE share_rules SET revoked = ? WHERE page = ? AND principal = 'publish' AND revoked IS NULL").bind(now, slug),
        db.prepare("UPDATE share_links SET revoked = ? WHERE page = ? AND revoked IS NULL").bind(now, slug),
      ]);
      return reply({ ok: true });
    }
    const requestMatch = /^requests\/([0-9a-f]{32})$/.exec(rest);
    if (requestMatch && method === "POST") {
      const found = await db.prepare("SELECT id, email, role FROM share_requests WHERE id = ? AND page = ? AND status = 'open'").bind(requestMatch[1], slug).first();
      if (!found) return reply({ error: "없거나 이미 처리한 요청이에요." }, 404);
      if (body.decision === "deny") {
        await db.prepare("UPDATE share_requests SET status = 'denied' WHERE id = ?").bind(found.id).run();
        return reply({ ok: true });
      }
      if (body.decision !== "approve") return reply({ error: "승인 또는 거절을 골라 주세요." }, 400);
      const role = GUEST_ROLES.includes(body.role) ? body.role : found.role;
      const email = String(found.email);
      const model = await loadModel(db);
      const already = shareAtLeast(shareRole(model, slug, { kind: "guest", email, links: new Set() }), "read");
      const rule = await upsertEmailRule(db, slug, email, role);
      await db.prepare("UPDATE share_requests SET status = 'approved' WHERE id = ?").bind(found.id).run();
      return reply({ ok: true, rule, invite: already ? null : { email, ...(await createInvite(db, env, rule, email)) } });
    }
    if (rest === "agents" && method === "PUT") {
      const token = String(body.token || "");
      const known = (await agentTokens(db)).find(entry => entry.id === token);
      if (!known) return reply({ error: "없는 에이전트 토큰이에요." }, 404);
      const principal = "agent:token:" + token;
      await db.prepare("UPDATE share_rules SET revoked = ? WHERE page = ? AND principal = ? AND revoked IS NULL").bind(Date.now(), slug, principal).run();
      if (body.level !== "inherit") {
        if (!AGENT_LEVELS.includes(body.level)) return reply({ error: "에이전트 권한을 골라 주세요." }, 400);
        await db.prepare("INSERT INTO share_rules (id, page, principal, role, expires, created) VALUES (?, ?, ?, ?, NULL, ?)").bind(randomId(), slug, principal, body.level, Date.now()).run();
      }
      return reply({ ok: true });
    }
    return reply({ error: "없는 API예요." }, 404);
  }

  function inviteForm(action, message, values = {}) {
    return shell("공유 초대", '<h1>공유된 페이지 열기</h1><p>초대받은 이메일과 받은 6자리 코드를 넣어 주세요. 코드는 15분 동안만 쓸 수 있어요.</p>' +
      (message ? '<p class="err" role="alert">' + escapeHtml(message) + "</p>" : "") +
      '<form method="post" action="' + escapeHtml(action) + '"><label for="email">이메일</label><input id="email" name="email" type="email" autocomplete="email" required value="' + escapeHtml(values.email || "") + '">' +
      '<label for="code">코드</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>' +
      '<button type="submit">확인하고 열기</button></form>');
  }

  function html(body, status = 200, extra = {}) {
    return new Response(body, { status, headers: { ...noStore, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "referrer-policy": "same-origin", ...extra } });
  }

  async function shareRoutes({ path, method, request, db, env }) {
    if (!path.startsWith("/s/")) return null;
    if (!db) return html(shell("공유", "<h1>준비 중이에요</h1>"), 503);
    const invite = /^\/s\/i\/([A-Za-z0-9_-]{43})$/.exec(path);
    if (invite) {
      const action = "/s/" + wsTag(env) + "/i/" + invite[1];
      if (method === "GET" || method === "HEAD") return html(inviteForm(action, ""));
      if (method !== "POST") return new Response(null, { status: 405, headers: { ...noStore, allow: "GET, POST" } });
      const form = await request.formData().catch(() => null);
      const email = String(form?.get("email") || "").trim().toLowerCase();
      const code = String(form?.get("code") || "").trim();
      const ip = request.headers.get("cf-connecting-ip") || "local";
      if (!(await hit(db, "verify:" + ip, 20, INVITE_MS))) return html(inviteForm(action, "시도가 너무 많아요. 15분 뒤에 다시 해 주세요.", { email }), 429);
      const idHash = await sha(invite[1]);
      const row = await db.prepare("SELECT i.id_hash, i.rule, i.email, i.code_hash, i.expires, i.tries, i.used, r.page FROM share_invites i JOIN share_rules r ON r.id = i.rule AND r.revoked IS NULL WHERE i.id_hash = ?").bind(idHash).first();
      if (!row || row.used !== null || Number(row.expires) <= Date.now() || Number(row.tries) >= MAX_TRIES) return html(inviteForm(action, "코드가 끝났거나 맞지 않아요. 공유한 사람에게 새 코드를 받아 주세요.", { email }), 401);
      await db.prepare("UPDATE share_invites SET tries = tries + 1 WHERE id_hash = ?").bind(idHash).run();
      if (email !== String(row.email) || !constantTimeEqual(await sha(invite[1] + ":" + code), String(row.code_hash))) return html(inviteForm(action, "이메일이나 코드가 맞지 않아요.", { email }), 401);
      const token = randomToken();
      const now = Date.now();
      await db.batch([
        db.prepare("UPDATE share_invites SET used = ? WHERE id_hash = ?").bind(now, idHash),
        db.prepare("INSERT INTO share_sessions (token_hash, email, links, created, expires) VALUES (?, ?, '[]', ?, ?)").bind(await sha(token), email, now, now + SESSION_S * 1000),
      ]);
      return new Response(null, { status: 303, headers: { ...noStore, location: "/" + encodeURIComponent(String(row.page)) + "/", "set-cookie": COOKIE + "=" + wsTag(env) + "." + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + SESSION_S } });
    }
    const ask = /^\/s\/r\/([^/]+)$/.exec(path);
    if (ask) {
      let slug;
      try { slug = resolveSlug(decodeURIComponent(ask[1])); } catch { return html(shell("공유", "<h1>없는 페이지예요</h1>"), 404); }
      const action = "/s/" + wsTag(env) + "/r/" + encodeURIComponent(slug);
      const form = (message = "") => shell("권한 요청", "<h1>이 페이지 권한 요청</h1><p>공유한 사람에게 요청을 보내요. 승인되면 이 이메일로 열 수 있는 초대 링크와 코드를 받아요.</p>" +
        (message ? '<p class="err" role="alert">' + escapeHtml(message) + "</p>" : "") +
        '<form method="post" action="' + escapeHtml(action) + '"><label for="email">내 이메일</label><input id="email" name="email" type="email" autocomplete="email" required>' +
        '<label for="role">원하는 권한</label><select id="role" name="role"><option value="read">읽기 허용</option><option value="edit">편집 허용</option></select>' +
        '<label for="note">한마디 (선택)</label><textarea id="note" name="note" rows="3" maxlength="300"></textarea><button type="submit">요청 보내기</button></form>');
      if (method === "GET" || method === "HEAD") return html(form());
      if (method !== "POST") return new Response(null, { status: 405, headers: { ...noStore, allow: "GET, POST" } });
      const data = await request.formData().catch(() => null);
      const email = String(data?.get("email") || "").trim().toLowerCase();
      if (!EMAIL.test(email)) return html(form("이메일 주소를 확인해 주세요."), 400);
      const ip = request.headers.get("cf-connecting-ip") || "local";
      if (!(await hit(db, "ask:" + ip, 10, 60 * 60 * 1000))) return html(form("요청이 너무 많아요. 잠시 뒤에 다시 해 주세요."), 429);
      const live = await db.prepare("SELECT slug FROM pages WHERE slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = pages.slug)").bind(slug).first();
      const open = live && await db.prepare("SELECT id FROM share_requests WHERE page = ? AND email = ? AND status = 'open'").bind(slug, email).first();
      if (live && !open) await db.prepare("INSERT INTO share_requests (id, page, email, role, note, created) VALUES (?, ?, ?, ?, ?, ?)").bind(randomId(), slug, email, data.get("role") === "edit" ? "edit" : "read", String(data.get("note") || "").slice(0, 300), Date.now()).run();
      // Same answer whether or not the page exists, so the form never confirms a private slug.
      return html(shell("권한 요청", "<h1>요청을 보냈어요</h1><p>공유한 사람이 승인하면 초대 링크와 코드를 받을 수 있어요.</p>"));
    }
    if (path === "/s/logout" && method === "POST") {
      return new Response(null, { status: 303, headers: { ...noStore, location: "/", "set-cookie": clearCookie } });
    }
    return html(shell("공유", "<h1>없는 페이지예요</h1>"), 404);
  }

  const PUBLIC_HEADERS = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  const SV_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const SV_MOON = SV_ICON + '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>';
  const svPage = (title, inner, extraHead = "") => '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>' + title + '</title>' + extraHead + '</head><body class="sv">' +
    '<input type="checkbox" id="sv-tt" class="sv-tt" aria-label="테마 바꾸기">' + inner + "</body></html>";
  const SV_NOTICE_VARS = ":root{--bg:#fff;--bg-soft:#f6f6f8;--fg:#26252c;--fg-dim:#5f5d69;--line:#ececf0;--accent:#6450dc;--on-accent:#fff;--font-body:'Pretendard Variable',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;--fs-12:12px;--fs-13:13px;--fs-14:14px;--fs-16:16px;--fs-28:28px}" +
    "@media (prefers-color-scheme:dark){:root{--bg:#1b1b20;--bg-soft:#26262d;--fg:#ecebf2;--fg-dim:#a3a1ad;--line:#31313a;--accent:#a597ff;--on-accent:#16131f}}";
  const svNotice = (status, heading, text) => '<style>' + SV_NOTICE_VARS + SV_BASE_CSS + '</style>' +
    '<header class="sv-bar"><a class="sv-crumb" href="/"><img src="/logo.svg" alt="" width="22" height="22"><b>Acard</b></a><span class="sv-grow"></span><label for="sv-tt" class="sv-theme" title="테마 바꾸기">' + SV_MOON + '</label></header>' +
    '<main class="sv-notice"><p class="sv-code">' + status + '</p><h1>' + heading + '</h1><p>' + text + '</p><a class="sv-btn" href="/">Acard 둘러보기</a></main>';
  const noticeResponse = (method, status, heading, text) => new Response(method === "HEAD" ? null : svPage(heading + " · Acard", svNotice(status, heading, text), '<meta name="robots" content="noindex, nofollow">'), { status, headers: { ...PUBLIC_HEADERS, "x-robots-tag": "noindex, nofollow", "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
  const missing = method => noticeResponse(method, 404, "없는 페이지예요", "주소가 바뀌었거나, 공유한 사람이 이 페이지를 더 이상 공개하지 않아요.");
  const closed = method => noticeResponse(method, 401, "볼 수 있는 권한이 없어요", "이 공유 링크는 꺼졌거나 만료됐어요. 공유한 사람에게 새 링크를 받아 주세요.");

  function referencedMedia(blocks) {
    const ids = new Set();
    for (const block of blocks) {
      const value = block.type === "image" ? block.meta?.src : ["video", "audio", "file"].includes(block.type) ? block.meta?.url : null;
      const match = typeof value === "string" && /^\/media\/([0-9a-f]{16})$/.exec(value);
      if (match) ids.add(match[1]);
    }
    return ids;
  }

  async function publicPage({ path, method, db, env, request }) {
    if (!path.startsWith("/p/")) return null;
    if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, headers: { ...PUBLIC_HEADERS, "x-robots-tag": "noindex, nofollow", allow: "GET, HEAD" } });
    // A canonical unpadded base64url encoding of 32 bytes has 43 characters.
    const match = /^\/p\/([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])(?:\/media\/([0-9a-f]{16})|\/([^/]+)\/?)?$/.exec(path);
    if (!match || !db) return missing(method);
    const rule = await db.prepare("SELECT id, page, principal, role, expires, revoked FROM share_rules WHERE token_hash = ? AND principal IN ('link', 'publish')").bind(await sha(match[1])).first();
    if (!rule) return missing(method);
    const now = Date.now();
    if (rule.revoked !== null || (rule.expires !== null && Number(rule.expires) <= now)) return rule.principal === "link" ? closed(method) : missing(method);
    const model = await loadModel(db);
    const token = { ...rule, expires: rule.expires === null ? null : Number(rule.expires) };
    let slug = String(rule.page);
    if (match[3]) { try { slug = resolveSlug(decodeURIComponent(match[3])); } catch { return missing(method); } }
    if (shareRole(model, slug, { kind: "token", rule: token }) === "none") return missing(method);
    const guestCookie = /(?:^|;\s*)acard_guest=(o|[0-9a-f]{32})\.([A-Za-z0-9_-]{43})/.exec(request.headers.get("cookie") || "");
    if (rule.principal === "link" && rule.role !== "read" && guestCookie && guestCookie[1] === wsTag(env) && !match[2]) {
      const session = await readSession(db, guestCookie[2]);
      if (session) {
        session.links.add(String(rule.id));
        await db.prepare("UPDATE share_sessions SET links = ? WHERE token_hash = ?").bind(JSON.stringify([...session.links]), session.id).run();
        return new Response(null, { status: 303, headers: { ...noStore, location: "/" + encodeURIComponent(slug) + "/" } });
      }
    }
    const found = await readPage(db, slug);
    if (!found) return missing(method);
    const base = sharePrefix(env) + match[1];
    const ids = referencedMedia(found.blocks);
    const coverMedia = /^\/media\/([0-9a-f]{16})$/.exec(String(found.settings?.cover || "").trim());
    if (coverMedia) ids.add(coverMedia[1]);
    const settings = await db.prepare("SELECT allow_index, site_title FROM share_pages WHERE page = ?").bind(String(rule.page)).first();
    const indexable = rule.principal === "publish" && Number(settings?.allow_index) === 1 && !String(rule.id).startsWith("pl-");
    const robots = indexable ? "index, follow" : "noindex, nofollow";
    if (match[2]) {
      if (!ids.has(match[2])) return missing(method);
      const media = await serveMedia(env, match[2]);
      if (!media.ok) return missing(method);
      const safeHeaders = new Headers(media.headers);
      for (const [name, value] of Object.entries(PUBLIC_HEADERS)) safeHeaders.set(name, value);
      safeHeaders.set("x-robots-tag", "noindex, nofollow");
      safeHeaders.set("content-security-policy", "default-src 'none'; sandbox");
      safeHeaders.delete("set-cookie");
      return new Response(method === "HEAD" ? null : media.body, { headers: safeHeaders });
    }
    const contentHeaders = { ...PUBLIC_HEADERS, "x-robots-tag": robots, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
    if (method === "HEAD") return new Response(null, { headers: contentHeaders });
    const reachable = slugValue => shareRole(model, slugValue, { kind: "token", rule: token }) !== "none";
    const children = [...model.parents].filter(([child, parent]) => parent === slug && reachable(child)).map(([child]) => child);
    const titles = children.length ? await db.prepare("SELECT slug, title FROM pages WHERE slug IN (" + children.map(() => "?").join(",") + ") AND kind != 'db_row' ORDER BY ord, title").bind(...children).all() : { results: [] };
    // Never ask pageShell, database expansion, tree, comments or backlinks for data.
    const blocks = found.blocks.filter(block => !["breadcrumb", "db_ref", "embed"].includes(block.type));
    const content = new HTMLRewriter().on("*", {
      element(element) {
        if (element.tagName === "iframe" && element.getAttribute("sandbox") === "allow-scripts" && element.hasAttribute("srcdoc") && !element.hasAttribute("src")) return;
        if (["iframe", "script", "style", "link", "object", "embed"].includes(element.tagName)) { element.remove(); return; }
        for (const name of ["src", "href"]) {
          const value = element.getAttribute(name);
          if (value === null) continue;
          const media = /^\/media\/([0-9a-f]{16})$/.exec(value);
          const local = /^\/([^/?#]+)\/?$/.exec(value);
          let target = null;
          if (local) { try { target = resolveSlug(decodeURIComponent(local[1])); } catch { target = null; } }
          if (media && ids.has(media[1])) element.setAttribute(name, base + "/media/" + media[1]);
          else if (name === "href" && value.startsWith("#")) continue;
          else if (name === "href" && element.tagName === "a" && target && target !== String(rule.page) && reachable(target)) element.setAttribute(name, base + "/" + encodeURIComponent(target) + "/");
          else if (name === "href" && element.tagName === "a" && target === String(rule.page)) element.setAttribute(name, base);
          else if (element.tagName === "a") element.removeAndKeepContent();
          else element.remove();
        }
        element.removeAttribute("data-page");
      },
    }).transform(new Response(renderBlocks(blocks)));
    // Inline existing reader styles: private static asset routes remain cookie-gated.
    const styles = await Promise.all(["tokens.css", "style.css"].map(async name => {
      const asset = await env.ASSETS.fetch(new Request(new URL("/" + name, request.url)));
      return asset.ok ? (await asset.text()).replace(/@import\s+[^;]+;/g, "") : "";
    }));
    const lightVars = [...styles[0].matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/g)].map(m => m[1]).join(";");
    styles[0] = styles[0].replace(/html\[data-theme="dark"\]/g, 'html[data-theme="dark"], html:has(#sv-tt:checked):not(#sv-none)') + "@media (prefers-color-scheme: dark){html:has(#sv-tt:checked):not(#sv-none){color-scheme:light;" + lightVars + "}}";
    const siteTitle = settings?.site_title ? String(settings.site_title) : "";
    const rootRow = slug !== String(rule.page) ? await db.prepare("SELECT title FROM pages WHERE slug = ?").bind(String(rule.page)).first() : null;
    const subRows = titles.results ?? [];
    const subMeta = new Map();
    if (subRows.length) {
      const marks = subRows.map(() => "?").join(",");
      const icons = await db.prepare("SELECT page, icon FROM editor_page_settings WHERE page IN (" + marks + ")").bind(...subRows.map(row => String(row.slug))).all().catch(() => ({ results: [] }));
      const firsts = await db.prepare("SELECT page, text FROM blocks WHERE page IN (" + marks + ") AND type = 'paragraph' AND trim(text) != '' ORDER BY page, ord").bind(...subRows.map(row => String(row.slug))).all();
      for (const row of icons.results ?? []) subMeta.set(String(row.page), { icon: row.icon });
      for (const row of firsts.results ?? []) { const m = subMeta.get(String(row.page)) || {}; if (!m.text) m.text = String(row.text); subMeta.set(String(row.page), m); }
    }
    const pageSettings = found.settings || {};
    const bodyHtml = await content.text();
    const headings = [...bodyHtml.matchAll(/<h([234]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map(m => ({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, "").trim() })).filter(h => h.text);
    const firstText = (found.blocks.find(block => block.type === "paragraph" && String(block.text || "").trim()) || {}).text || "";
    const description = String(firstText).replace(/\s+/g, " ").trim().slice(0, 160) || (siteTitle || "Acard") + "에서 공유한 페이지예요.";
    const origin = new URL(request.url).origin;
    const pageUrl = origin + base + (slug !== String(rule.page) ? "/" + encodeURIComponent(slug) + "/" : "");
    let cover = coverHtml(found.page, pageSettings);
    if (coverMedia) cover = cover.replace("/media/" + coverMedia[1], base + "/media/" + coverMedia[1]);
    else if (/^https?:/.test(String(pageSettings.cover || "").trim())) cover = coverHtml(found.page, { ...pageSettings, cover: "" });
    const updated = found.page.updated ? new Date(Number(found.page.updated)).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }) + "에 수정됨" : "";
    const stamp = rule.principal === "link" ? "공유 링크 · 읽기 전용" : siteTitle ? escapeHtml(siteTitle) : "공개 페이지 · 읽기 전용";
    const crumb = '<a class="sv-crumb" href="' + base + '"><span class="sv-ico">' + pageIconHtml(rootRow ? { slug: String(rule.page) } : found.page, rootRow ? {} : pageSettings, 20) + '</span><span>' + escapeHtml(String(rootRow ? rootRow.title : found.page.title)) + "</span></a>" +
      (rootRow ? '<span class="sv-sep">/</span><span class="sv-here">' + escapeHtml(found.page.title) + "</span>" : "");
    const toc = headings.length >= 2 ? '<aside class="sv-toc" aria-label="목차"><details open><summary>목차</summary><ol>' + headings.map((h, i) => '<li class="l' + h.level + '"><a href="#' + escapeHtml(h.id) + '"><span class="n">' + (i + 1) + "</span>" + escapeHtml(h.text) + "</a></li>").join("") + "</ol></details></aside>" : "";
    const cards = subRows.length ? '<section class="sv-subs" aria-label="하위 페이지"><h2>하위 페이지</h2><div class="sv-cards">' + subRows.map(row => {
      const meta = subMeta.get(String(row.slug)) || {};
      return '<a class="sv-card" href="' + base + "/" + encodeURIComponent(String(row.slug)) + '/"><span class="sv-cico">' + pageIconHtml({ slug: String(row.slug), ws: "member" }, { icon: meta.icon || "" }, 24) + '</span><span class="sv-ct"><b>' + escapeHtml(String(row.title)) + "</b>" + (meta.text ? "<small>" + escapeHtml(String(meta.text).replace(/\s+/g, " ").slice(0, 70)) + "</small>" : "") + "</span></a>";
    }).join("") + "</div></section>" : "";
    const title = escapeHtml(found.page.title) + (siteTitle ? " · " + escapeHtml(siteTitle) : "");
    const og = '<meta name="robots" content="' + (indexable ? "index" : "noindex") + '"><meta name="description" content="' + escapeHtml(description) + '">' +
      '<meta property="og:type" content="article"><meta property="og:site_name" content="' + escapeHtml(siteTitle || "Acard") + '"><meta property="og:title" content="' + escapeHtml(found.page.title) + '"><meta property="og:description" content="' + escapeHtml(description) + '">' +
      '<meta property="og:url" content="' + escapeHtml(pageUrl) + '"><meta property="og:image" content="' + origin + '/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="ko_KR">' +
      '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + escapeHtml(found.page.title) + '"><meta name="twitter:description" content="' + escapeHtml(description) + '"><meta name="twitter:image" content="' + origin + '/og.png">' +
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>' + styles.join("\n") + "\n" + VISUAL_CSS + "\n" + SV_BASE_CSS + SV_PAGE_CSS + "</style>";
    const html = svPage(title,
      '<header class="sv-bar"><nav class="sv-path" aria-label="위치">' + crumb + '</nav><span class="sv-grow"></span><a class="sv-made" href="/" aria-label="Acard로 만들었어요"><svg class="wordmark sv-wm" viewBox="-1.00 -15.63 171.36 109.63" role="img" aria-label="Acard" focusable="false"><use href="/wordmark-symbol.svg#w"/></svg><span>로 만들었어요</span></a><label for="sv-tt" class="sv-theme" title="테마 바꾸기">' + SV_MOON + "</label></header>" +
      '<div class="sv-cover">' + cover + "</div>" +
      '<div class="sv-wrap' + (toc ? " has-toc" : "") + '"><main class="sv-main"><article><div class="sv-icon" aria-hidden="true">' + pageIconHtml(found.page, pageSettings, 88) + "</div>" +
      '<h1 class="sv-title">' + escapeHtml(found.page.title) + '</h1><p class="sv-meta"><span>' + stamp + "</span>" + (updated ? "<span>" + updated + "</span>" : "") + "</p>" +
      '<div class="sv-toc-narrow">' + toc + '</div><div class="blocks">' + bodyHtml + "</div>" + cards + "</article></main>" + toc.replace('class="sv-toc"', 'class="sv-toc sv-toc-wide"') + "</div>" +
      '<footer class="sv-foot"><a href="/"><img src="/logo.svg" alt="" width="16" height="16">Acard로 만들었어요</a></footer>', og);
    return new Response(html, { headers: contentHeaders });
  }

  function agentKey(principal) {
    if (principal.key) return String(principal.key).replace(/^ws-[0-9a-f]{32}:/, "");
    if (principal.tokenId) return "token:" + principal.tokenId;
    return "name:" + principal.name;
  }

  async function hasAgentRules(db, key) {
    return Boolean(await db.prepare("SELECT 1 AS x FROM share_rules WHERE principal = ? AND revoked IS NULL LIMIT 1").bind("agent:" + key).first());
  }

  registerFeature({
    schema: async db => { await db.batch(SCHEMA.map(sql => db.prepare(sql))); },
    api: accessApi,
    publicRoutes: [publicPage, shareRoutes],
    services: {
      guestFetch,
      async agentScopes(db, principal, slug) {
        const key = agentKey(principal);
        if (!slug || !(await hasAgentRules(db, key))) return principal.scopes;
        return agentScopes(await loadModel(db), slug, key, principal.scopes);
      },
      async agentReadable(db, principal, slugs) {
        const key = agentKey(principal);
        if (!(await hasAgentRules(db, key))) return null;
        const model = await loadModel(db);
        return new Set(slugs.filter(slug => agentScopes(model, slug, key, principal.scopes).includes("read")));
      },
      async shareMoveCheck(db, slug, parent, confirmed) {
        if (confirmed) return null;
        const model = await loadModel(db);
        if (!model.parents.has(slug) || (parent && !model.parents.has(parent))) return null;
        return moveWidensSharing(model, slug, parent) ? json({ error: "이 페이지가 공유됩니다. 옮기면 새 상위 페이지를 공유받은 사람도 이 페이지를 볼 수 있어요.", needsConfirm: true }, 409) : null;
      },
    },
  });
})();
