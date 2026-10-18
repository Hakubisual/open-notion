// 보안 계약: GATE_PASSWORD 와 GATE_SECRET 가 Pages 프로젝트의 production 과 preview 양쪽에
// 설정돼 있어야 하고, 하나라도 없으면 정적 파일을 전혀 내주지 않는다(fail closed).
// 게이트를 통과한 쿠키 하나가 곧 API 인가다. 새 인증 경로를 만들지 않는다.

const COOKIE_NAME = "dn_auth";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
const DB_BINDING = "DB";

const ACARD_FEATURES = { api: [], agentApi: [], afterSave: [], beforeRowWrite: [], schema: [], services: {}, publicRoutes: [], authenticatedRoutes: [], agentOps: Object.create(null) };

function registerFeature(def) {
  for (const hook of ["api", "agentApi", "afterSave", "beforeRowWrite", "schema", "publicRoutes", "authenticatedRoutes"]) {
    if (def[hook]) ACARD_FEATURES[hook].push(...[].concat(def[hook]));
  }
  const { mcpTools, ...services } = def.services || {};
  Object.assign(ACARD_FEATURES.services, services);
  if (mcpTools) (ACARD_FEATURES.services.mcpTools ||= []).push(...mcpTools);
  Object.assign(ACARD_FEATURES.agentOps, def.agentOps);
}

function featureContext(request, env, db, url) {
  return {
    request, env, db, url, path: url.pathname, method: request.method.toUpperCase(),
    helpers: { json, readPage, readTree, saveBlocks, normaliseBlocks, slugify, resolveSlug, markdownToBlocks, blocksToMarkdown, readDatabase, escapeHtml },
  };
}

function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function sign(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function hasValidTicket(request, secret) {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return false;
  const dot = raw.indexOf(".");
  if (dot < 1) return false;
  const expires = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!/^\d+$/.test(expires)) return false;
  if (Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  return constantTimeEqual(signature, await sign(secret, expires));
}

function safeNext(value) {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

// 홈은 notes/home.md 이고 슬러그는 index 다. 오너가 /home/ 이나 /edit/home/ 을 쳐도 열리게 맞춰 준다.
function resolveSlug(slug) {
  return slug === "home" ? "index" : slug;
}

//__EQUATION_HTML__

//__BLOCK_HTML__
//__DB_MODEL__
//__DB_FORMULA__
//__DB_HTML__
//__EDITOR_PAGES__
//__AGENT_API__

//__MARKDOWN_BLOCKS__

//__NOTION_IMPORT__

//__NOTION_EXPORT__

function loginPage(message, next) {
  return [
    "<!doctype html>",
    '<html lang="ko"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="robots" content="noindex, nofollow">',
    "<title>__SITE_NAME__</title>",
    '<meta name="application-name" content="__SITE_NAME__">',
    '<meta property="og:site_name" content="__SITE_NAME__">',
    '<link rel="icon" href="__GATE_LOGO__" type="image/svg+xml">',
    "<style>",
    ":root{color-scheme:light dark;--bg:#f8f8fa;--surface:#ffffff;--fg:#26252c;--dim:#6c6a76;--line:#ececf0;--accent:#7b68ee;--on:#fff;--field:#f6f6f8}",
    "body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--fg);",
    'font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;',
    "font-size:var(--fs-17,17px);line-height:1.9;word-break:keep-all}",
    "main{box-sizing:border-box;width:min(92vw,420px);padding:36px;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 32px rgba(30,28,50,.08)}",
    "h1{font-size:var(--fs-28,28px);letter-spacing:-.04em;margin:0 0 12px}",
    "p{color:var(--dim);font-size:var(--fs-15,15px);margin:0 0 24px}",
    "form{display:flex;flex-direction:column;gap:10px}",
    "input{height:48px;padding:0 15px;font:inherit;font-size:var(--fs-16,16px);color:var(--fg);background:var(--field);",
    "border:1px solid var(--line);border-radius:10px}",
    "input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}",
    "button{height:48px;font:inherit;font-size:var(--fs-16,16px);font-weight:600;color:var(--on);background:var(--accent);",
    "border:0;border-radius:10px;cursor:pointer}",
    ".msg{color:var(--accent);font-size:var(--fs-14,14px);margin:0 0 10px}",
    "@media (prefers-color-scheme:dark){:root{--bg:#1b1b20;--surface:#212127;--fg:#ecebf2;--dim:#a3a1ad;--line:#31313a;--accent:#a597ff;--on:#16131f;--field:#26262d}}",
    "</style></head><body><main>",
    '<img src="__GATE_LOGO__" alt="" width="56" height="56">',
    "<h1>__SITE_NAME__</h1>",
    "<p>오너 전용 노트예요. 비밀번호를 넣어 주세요.</p>",
    message ? '<p class="msg">' + escapeHtml(message) + "</p>" : "",
    '<form method="POST" action="/__gate">',
    '<input type="hidden" name="next" value="' + escapeHtml(next) + '">',
    '<input type="password" name="pw" placeholder="비밀번호" autocomplete="current-password" autofocus required>',
    "<button type=\"submit\">들어가기</button>",
    "</form></main></body></html>",
  ].join("\n");
}

function challenge(message, next, status) {
  return new Response(loginPage(message, next), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-dori-gate": "1",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "page";
}

const schemaReady = new Map();

async function ensureSchema(db) {
  const key = (db && db.acardKey) || "d1";
  if (schemaReady.has(key)) return schemaReady.get(key);
  const ready = createSchema(db);
  schemaReady.set(key, ready);
  try { await ready; } catch (error) { schemaReady.delete(key); throw error; }
}

// The bundle entry (gate/agent-entry.ts) authenticates the person and hands over an env scoped to one workspace.
// Only env objects it registered here skip the password gate; a plain Pages env never does.
const TRUSTED_ENVS = new WeakSet();
const isMember = (env) => TRUSTED_ENVS.has(env) && env.ACARD_SESSION === "member";
const isGuest = (env) => TRUSTED_ENVS.has(env) && env.ACARD_SESSION === "guest";
// A guest's view DB (features/share.js) carries the set of pages the resolver lets it read.
const visibleOnly = (db, rows, key = "slug") => (db && db.acardVisible ? rows.filter((row) => db.acardVisible.has(String(row[key]))) : rows);

async function createSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, parent TEXT, ord INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'note', updated INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'editor', hash TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS blocks (page TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', checked INTEGER NOT NULL DEFAULT 0, indent INTEGER NOT NULL DEFAULT 0, meta TEXT, PRIMARY KEY (page, id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS links (src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst))"),
    db.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS blocks_page_ord ON blocks(page, ord)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pages_parent_ord ON pages(parent, ord)"),
    db.prepare("CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, page TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS link_cache (url TEXT PRIMARY KEY, title TEXT, description TEXT, image TEXT, site TEXT, created INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS media_page ON media(page)"),
    db.prepare("CREATE TABLE IF NOT EXISTS databases (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', parent TEXT, ord INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS db_properties (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'text', config TEXT, ord INTEGER NOT NULL DEFAULT 0, width INTEGER, hidden INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS db_rows (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, page TEXT, props TEXT, ord INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS db_views (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'table', config TEXT, ord INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS db_templates (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', props TEXT, blocks TEXT, ord INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE INDEX IF NOT EXISTS db_properties_database_ord ON db_properties(database_id, ord)"),
    db.prepare("CREATE INDEX IF NOT EXISTS db_rows_database_ord ON db_rows(database_id, ord)"),
    db.prepare("CREATE INDEX IF NOT EXISTS db_views_database_ord ON db_views(database_id, ord)"),
    db.prepare("CREATE INDEX IF NOT EXISTS db_templates_database_ord ON db_templates(database_id, ord)"),
    db.prepare("CREATE INDEX IF NOT EXISTS databases_slug ON databases(slug)"),
  ]);
  await ensureEditorSchema(db);
  for (const schema of ACARD_FEATURES.schema) await schema(db);
}

const IMPORT_MAX_BYTES = 30 * 1024 * 1024;
const IMPORT_MAX_PAGES = 400;

async function importZip(request, db) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > IMPORT_MAX_BYTES) return json({ error: "압축 파일이 너무 커요. 30MB 아래로 나눠 주세요." }, 413);
  const buffer = await request.arrayBuffer().catch(() => null);
  if (!buffer || buffer.byteLength === 0) return json({ error: "압축 파일이 비어 있어요." }, 400);
  if (buffer.byteLength > IMPORT_MAX_BYTES) return json({ error: "압축 파일이 너무 커요. 30MB 아래로 나눠 주세요." }, 413);

  let result;
  try {
    result = await notionImportZip(new Uint8Array(buffer));
  } catch (error) {
    return json({ error: "압축을 읽지 못했어요: " + String(error && error.message ? error.message : error) }, 400);
  }
  if (!result.pages.length) {
    return json({ error: "가져올 페이지를 찾지 못했어요. 노션에서 'Markdown & CSV'로 내보낸 zip 인지 확인해 주세요.", skipped: result.skipped.slice(0, 40), warnings: result.warnings }, 400);
  }

  const pages = result.pages.slice(0, IMPORT_MAX_PAGES);
  const dropped = result.pages.length - pages.length;
  const taken = new Set();
  const rows = await db.prepare("SELECT slug FROM pages").all();
  for (const row of rows.results ?? []) taken.add(String(row.slug));

  const created = [];
  const remap = new Map();
  let ord = Number((await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM pages WHERE parent IS NULL").first())?.m ?? 0);
  const now = Date.now();

  for (const page of pages) {
    let slug = page.slug || "page";
    while (taken.has(slug)) slug = slug.replace(/-\d+$/, "") + "-" + Math.random().toString(36).slice(2, 6);
    taken.add(slug);
    remap.set(page.slug, slug);
    const parent = page.parent ? remap.get(page.parent) ?? null : null;
    ord += 10;
    const title = String(page.title ?? slug).slice(0, 200) || slug;
    await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, ?, ?, 'editor', NULL)")
      .bind(slug, title, parent, ord, page.kind === "db" ? "db" : "note", now).run();
    await saveBlocks(db, slug, normaliseBlocks(page.blocks));
    if (page.kind === "db") {
      // 노션-db 레인이 도입한 databases/db_properties/db_rows 구조에도 등록해야 읽기 화면의 새 렌더러가 표를 그린다.
      // 기존 database 블록(meta.rows)도 남겨 둔다 — 구버전 렌더러와 마크다운 내보내기가 그걸 본다.
      const dbBlock = (page.blocks || []).find((block) => block.type === "database");
      const columns = dbBlock && dbBlock.meta && Array.isArray(dbBlock.meta.columns) ? dbBlock.meta.columns : [];
      const rows = dbBlock && dbBlock.meta && Array.isArray(dbBlock.meta.rows) ? dbBlock.meta.rows : [];
      const createdDb = await createDatabase(db, { title, slug, parent });
      if (createdDb.slug !== slug) {
        await db.prepare("UPDATE pages SET slug = ? WHERE slug = ?").bind(createdDb.slug, slug).run();
        slug = createdDb.slug;
      }
      if (columns.length) {
        const properties = [{ id: "title", name: columns[0], type: "text" }].concat(
          columns.slice(1).map((name, index) => ({ id: "p" + index, name, type: "text" }))
        );
        await saveProperties(db, createdDb.id, properties);
        // saveProperties 가 속성 id 에 데이터베이스 id 를 붙이므로, 행의 props 도 같은 scoped 키로 적는다.
        const propKeys = properties.map((prop) => scopedId(createdDb.id, prop.id));
        const rowStatements = [];
        rows.forEach((row, index) => {
          const props = {};
          columns.forEach((name, columnIndex) => {
            props[propKeys[columnIndex]] = String((row && row[name]) ?? "");
          });
          rowStatements.push(db.prepare("INSERT INTO db_rows (id, database_id, page, props, ord, created, updated) VALUES (?, ?, NULL, ?, ?, ?, ?)")
            .bind(scopedId(createdDb.id, dbId("r")), createdDb.id, JSON.stringify(props), index * 10, now, now));
        });
        if (rowStatements.length) await db.batch(rowStatements);
      }
      created.push({ slug, title, parent, kind: "db", blocks: page.blocks.length, dbSlug: slug });
      continue;
    }
    created.push({ slug, title, parent, kind: page.kind, blocks: page.blocks.length });
  }

  const warnings = result.warnings.slice(0, 20);
  if (dropped > 0) warnings.push("페이지 " + dropped + "개는 한 번에 400개까지만 가져올 수 있어 건너뛰었어요.");
  return json({ ok: true, imported: created.length, pages: created, skipped: result.skipped.slice(0, 40), warnings });
}

function exportFilename(slug, ext) {
  return 'attachment; filename="' + slug.replace(/[^\w.-]+/g, "_").slice(0, 60) + "." + ext + '"';
}

// 마크다운 파일 한 장을 페이지로 만든다. 이름은 파일명(확장자 제거)이고 본문은 markdownToBlocks 로 바꾼다.
async function importMarkdown(request, db) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2 * 1024 * 1024) return json({ error: "파일이 너무 커요. 2MB 아래로 나눠 주세요." }, 413);
  const form = await request.formData().catch(() => null);
  const files = [];
  if (form) {
    for (const value of form.values()) if (value && typeof value === "object" && typeof value.arrayBuffer === "function") files.push(value);
  }
  if (!files.length) return json({ error: "마크다운 파일을 골라 주세요." }, 400);

  const taken = new Set();
  const rows = await db.prepare("SELECT slug FROM pages").all();
  for (const row of rows.results ?? []) taken.add(String(row.slug));
  const created = [];
  const warnings = [];
  const now = Date.now();
  let ord = Number((await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM pages WHERE parent IS NULL").first())?.m ?? 0);

  for (const file of files.slice(0, 40)) {
    const text = await file.text();
    const baseName = String(file.name || "").replace(/\.(md|markdown|txt)$/i, "").trim() || "가져온 노트";
    let slug = slugify(baseName);
    while (taken.has(slug)) slug = slug.replace(/-\d+$/, "") + "-" + Math.random().toString(36).slice(2, 6);
    taken.add(slug);
    ord += 10;
    const title = baseName.slice(0, 200);
    await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, NULL, ?, 'note', ?, 'editor', NULL)")
      .bind(slug, title, ord, now).run();
    await saveBlocks(db, slug, normaliseBlocks(markdownToBlocks(text)));
    created.push({ slug, title, parent: null, kind: "note", blocks: 1 });
  }
  if (files.length > 40) warnings.push("한 번에 40개까지만 가져올 수 있어 나머지는 건너뛰었어요.");
  return json({ ok: true, imported: created.length, pages: created, skipped: [], warnings });
}
async function exportPage(db, url) {
  const format = (url.searchParams.get("format") ?? "md").toLowerCase();
  const scope = url.searchParams.get("scope") ?? "page";

  if (scope === "all" || format === "zip") {
    const rows = await db.prepare("SELECT slug, title FROM pages ORDER BY ord, title").all();
    const list = [];
    for (const row of rows.results ?? []) {
      const found = await readPage(db, String(row.slug));
      if (found) list.push({ slug: found.page.slug, title: found.page.title, blocks: found.blocks });
    }
    if (ACARD_FEATURES.services.folderExportMeta) {
      const meta = await ACARD_FEATURES.services.folderExportMeta(db);
      for (const item of list) Object.assign(item, { folder: meta.pathOf(item.slug), tags: meta.tagsOf(item.slug) });
    }
    if (!list.length) return json({ error: "내보낼 페이지가 없어요." }, 404);
    const zip = workspaceToZip(list);
    return new Response(zip, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": exportFilename("acard", "zip"),
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  const slug = (url.searchParams.get("slug") ?? "").trim() || "index";
  const found = await readPage(db, slug);
  if (!found) return json({ error: "없는 페이지예요." }, 404);
  const title = String(found.page.title ?? slug);

  if (format === "html") {
    return new Response(pageToHtml({ title, blocks: found.blocks }), {
      headers: { "content-type": "text/html; charset=utf-8", "content-disposition": exportFilename(slug, "html"), "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
    });
  }
  if (format !== "md" && format !== "markdown") return json({ error: "format 은 md, html, zip 중 하나여야 해요." }, 400);
  return new Response(notionBlocksToMarkdown(title, found.blocks), {
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": exportFilename(slug, "md"), "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}

async function readTree(db) {
  const rows = await db.prepare("SELECT p.slug, p.title, p.parent, p.ord, p.kind, p.updated, p.source, s.icon, s.favorite FROM pages p LEFT JOIN editor_page_settings s ON s.page=p.slug WHERE p.kind != 'db_row' AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page=p.slug) ORDER BY p.ord, p.title").all();
  return visibleOnly(db, rows.results ?? []).map((row) => (db.acardVisible && row.parent && !db.acardVisible.has(String(row.parent)) ? { ...row, parent: null } : row));
}

async function readPage(db, slug) {
  if (await db.prepare("SELECT page FROM editor_trash WHERE page = ?").bind(slug).first()) return null;
  const page = await db.prepare("SELECT slug, title, parent, ord, kind, updated, source FROM pages WHERE slug = ?").bind(slug).first();
  if (!page) return null;
  const rows = await db.prepare("SELECT id, type, text, checked, indent, meta FROM blocks WHERE page = ? ORDER BY ord").bind(slug).all();
  const blocks = (rows.results ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    text: row.text,
    checked: row.checked === 1,
    indent: row.indent,
    ...(row.meta ? { meta: cleanMeta(row.type, parseJson(row.meta, null)) } : {}),
  }));
  return { page, blocks, ...(await readEditorPageMeta(db, slug)) };
}

function normaliseBlocks(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 2000).map((raw, index) => {
    const block = raw && typeof raw === "object" ? raw : {};
    return {
      id: typeof block.id === "string" && block.id ? block.id.slice(0, 60) : "b" + index.toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      type: typeof block.type === "string" ? block.type.slice(0, 24) : "paragraph",
      text: typeof block.text === "string" ? block.text.slice(0, 20000) : "",
      checked: block.checked === true,
      indent: Number.isFinite(block.indent) ? Math.max(0, Math.min(6, Math.trunc(block.indent))) : 0,
      meta: block.meta && typeof block.meta === "object" ? { ...cleanMeta(typeof block.type === "string" ? block.type.slice(0, 24) : "paragraph", block.meta), ...(Array.isArray(block.meta.richText) ? { richText: globalThis.EditorModel.richText(block.meta.richText, block.text) } : {}) } : null,
    };
  });
}

function linksOf(blocks) {
  const found = new Set();
  for (const block of blocks) for (const run of Array.isArray(block.meta?.richText) ? block.meta.richText : []) {
    if (run.mention?.type === "page") found.add(run.mention.slug);
    else if (typeof run.href === "string" && /^\/[^/]+\/$/.test(run.href)) found.add(decodeURIComponent(run.href.slice(1, -1)));
  }
  const text = blocks.map((block) => block.text).join("\n");
  for (const match of text.matchAll(/\[\[([^\]\s]+)\]\]/g)) found.add(match[1]);
  for (const match of text.matchAll(/\]\(\/([^)\s#?]+?)\/?\)/g)) {
    const slug = match[1];
    if (slug && !slug.includes("/")) found.add(slug);
  }
  return [...found];
}

async function saveBlocks(db, slug, blocks) {
  await db.batch(blockStatements(db, slug, blocks));
  if (!ACARD_FEATURES.afterSave.length) return;
  try {
    const page = await db.prepare("SELECT * FROM pages WHERE slug = ?").bind(slug).first();
    for (const hook of ACARD_FEATURES.afterSave) {
      try { await hook(db, slug, blocks, page); }
      catch (error) { console.error("Feature afterSave failed", error); }
    }
  } catch (error) { console.error("Feature afterSave failed", error); }
}

function blockStatements(db, slug, blocks) {
  const statements = [db.prepare("DELETE FROM blocks WHERE page = ?").bind(slug)];
  blocks.forEach((block, index) => {
    statements.push(
      db.prepare("INSERT INTO blocks (page, id, ord, type, text, checked, indent, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(slug, block.id, index, block.type, block.text, block.checked ? 1 : 0, block.indent, block.meta ? JSON.stringify(block.meta) : null)
    );
  });
  statements.push(db.prepare("DELETE FROM links WHERE src = ?").bind(slug));
  for (const dst of linksOf(blocks)) statements.push(db.prepare("INSERT OR IGNORE INTO links (src, dst) VALUES (?, ?)").bind(slug, dst));
  return statements;
}


// ---------- 데이터베이스 ----------

function dbId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function shortHash(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// 속성·행·뷰·템플릿 id 는 전역 PK 라서 데이터베이스 id 를 접두사로 붙여 DB 간 충돌을 막는다.
function scopedId(databaseId, local) {
  const prefix = databaseId + "_";
  const text = String(local || "");
  if (text.startsWith(prefix) && text.length <= 40) return text;
  const joined = prefix + text;
  return joined.length <= 40 ? joined : (prefix + shortHash(text) + text.slice(0, Math.max(0, 40 - prefix.length - 8))).slice(0, 40);
}

// db_ref 의 meta.html 은 서버가 렌더해 넣는 값이다. 클라이언트가 보낸 html 은 신뢰하지 않는다.
function cleanMeta(type, meta) {
  if (!meta || typeof meta !== "object") return meta || null;
  if (type !== "db_ref") return meta;
  const out = Object.assign({}, meta);
  delete out.html;
  return out;
}

function parseJson(text, fallback) {
  if (typeof text !== "string" || !text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

async function readDatabase(db, slug, depth = 0) {
  const database = await db.prepare("SELECT id, slug, title, icon, parent, ord, created, updated FROM databases WHERE slug = ?").bind(slug).first();
  if (!database) return null;
  return await readDatabaseById(db, database, depth);
}

async function readProperties(db, databaseId) {
  const propRows = await db.prepare("SELECT id, name, type, config, ord, width, hidden FROM db_properties WHERE database_id = ? ORDER BY ord, name").bind(databaseId).all();
  return (propRows.results ?? []).map((row, index) => normaliseProperty({
    id: row.id,
    name: row.name,
    type: row.type,
    config: parseJson(row.config, {}),
    ord: row.ord,
    width: row.width,
    hidden: row.hidden === 1,
  }, index));
}

async function readRows(db, databaseId, properties) {
  const rowRows = await db.prepare("SELECT r.id, r.page, r.props, r.ord, r.created, r.updated, p.title AS page_title FROM db_rows r LEFT JOIN pages p ON p.slug = r.page WHERE r.database_id = ? ORDER BY r.ord, r.created").bind(databaseId).all();
  return (rowRows.results ?? []).map((row, index) => {
    const parsed = normaliseRow({ id: row.id, page: row.page, props: parseJson(row.props, {}), ord: row.ord, created: row.created, updated: row.updated }, properties, index);
    parsed.icon = "";
    parsed.pageTitle = row.page_title === null || row.page_title === undefined ? null : row.page_title;
    return parsed;
  });
}

async function readDatabaseById(db, database, depth) {
  const properties = await readProperties(db, database.id);
  const rows = await readRows(db, database.id, properties);
  const viewRows = await db.prepare("SELECT id, name, type, config, ord FROM db_views WHERE database_id = ? ORDER BY ord, name").bind(database.id).all();
  const views = (viewRows.results ?? []).map((row, index) => normaliseView({ id: row.id, name: row.name, type: row.type, config: parseJson(row.config, {}), ord: row.ord }, index));
  const templateRows = await db.prepare("SELECT id, name, icon, props, blocks, ord FROM db_templates WHERE database_id = ? ORDER BY ord, name").bind(database.id).all();
  const templates = (templateRows.results ?? []).map((row, index) => normaliseTemplate({
    id: row.id,
    name: row.name,
    icon: row.icon,
    props: parseJson(row.props, {}),
    blocks: parseJson(row.blocks, []),
    ord: row.ord,
  }, index));
  if (!views.length) views.push(normaliseView({ id: "v" + database.id, name: "표", type: "table", ord: 0 }, 0));
  await resolveComputed(db, properties, rows, depth || 0);
  return { database, properties, rows, views, templates };
}

function rowValuesMap(properties, row) {
  const out = {};
  const computed = row.computed || {};
  properties.forEach((prop) => {
    out[prop.id] = prop.type === "title" ? (row.pageTitle || "") : (computed[prop.id] !== undefined ? computed[prop.id] : row.props[prop.id]);
  });
  return out;
}

const COMPUTED_TYPES = ["formula", "rollup", "created_time", "updated_time"];

// 롤업 대상 데이터베이스만 읽는다. 관계 속성만 있고 롤업이 쓰지 않는 데이터베이스는 읽지 않는다.
// 대상 속성이 계산 속성일 때만 한 단계 더 계산한다.
async function readRollupTarget(db, slug, targetKey, depth) {
  const database = await db.prepare("SELECT id FROM databases WHERE slug = ?").bind(slug).first();
  if (!database) return null;
  const properties = await readProperties(db, database.id);
  const rows = await readRows(db, database.id, properties);
  const targetProp = findProp(properties, targetKey);
  if (targetProp && COMPUTED_TYPES.indexOf(targetProp.type) >= 0) await resolveComputed(db, properties, rows, depth + 1);
  return { properties, rows };
}

async function resolveComputed(db, properties, rows, depth) {
  rows.forEach((row) => { row.computed = {}; });
  if (depth > 3) return;

  const rollups = properties.filter((prop) => prop.type === "rollup");
  const targets = new Map();
  const cache = new Map();
  for (const prop of rollups) {
    const slug = rollupRelationSlug(properties, prop);
    if (!slug) continue;
    const key = slug + "\n" + prop.config.target_property;
    if (!cache.has(key)) cache.set(key, await readRollupTarget(db, slug, prop.config.target_property, depth));
    targets.set(prop.id, cache.get(key));
  }

  rows.forEach((row) => {
    properties.forEach((prop) => {
      if (prop.type === "created_time") row.computed[prop.id] = row.created;
      if (prop.type === "updated_time") row.computed[prop.id] = row.updated;
      if (prop.type === "rollup") {
        const target = targets.get(prop.id) || null;
        const relationProp = findProp(properties, prop.config.relation_property);
        const ids = relationProp && Array.isArray(row.props[relationProp.id]) ? row.props[relationProp.id] : [];
        const related = target
          ? target.rows.filter((entry) => ids.indexOf(entry.id) >= 0).map((entry) => ({
            get: (key) => {
              const found = findProp(target.properties, key);
              if (!found) return null;
              if (found.type === "title") return entry.pageTitle;
              if (entry.computed && entry.computed[found.id] !== undefined) return entry.computed[found.id];
              return entry.props[found.id];
            },
            typeOf: (key) => {
              const found = findProp(target.properties, key);
              return found ? found.type : "text";
            },
          }))
          : [];
        row.computed[prop.id] = rollupValue({ function: prop.config.function, target_property: prop.config.target_property }, {
          related,
          targetType: rollupTargetType(target, prop.config.target_property),
        });
      }
    });
  });

  // 수식은 다른 수식·롤업을 참조할 수 있으므로 값이 안정될 때까지 반복한다(순환은 횟수로 끊는다).
  const formulas = properties.filter((prop) => prop.type === "formula");
  if (!formulas.length) return;
  rows.forEach((row) => {
    const scope = rowValuesMap(properties, row);
    const ctx = {
      get: (key) => {
        const found = findProp(properties, key);
        return found ? scope[found.id] : null;
      },
      has: (key) => !!findProp(properties, key),
      typeOf: (key) => {
        const found = findProp(properties, key);
        return found ? found.type : "text";
      },
      now: Date.now(),
    };
    for (let pass = 0; pass <= formulas.length; pass += 1) {
      let changed = false;
      for (const prop of formulas) {
        const value = evaluateFormula(prop.config.expression, ctx);
        if (JSON.stringify(value) !== JSON.stringify(scope[prop.id])) changed = true;
        scope[prop.id] = value;
        row.computed[prop.id] = value;
      }
      if (!changed) break;
    }
  });
}

function findProp(properties, key) {
  if (!key) return null;
  return properties.find((prop) => prop.id === key || prop.name === key) || null;
}

function rollupRelationSlug(properties, prop) {
  const relationProp = findProp(properties, prop.config.relation_property);
  return relationProp && relationProp.type === "relation" ? relationProp.config.database : "";
}

function rollupTargetType(target, key) {
  if (!target) return "text";
  const found = findProp(target.properties, key);
  return found ? found.type : "text";
}

function validBoardProgress(database, properties, props) {
  if (database.slug !== "board") return true;
  const progress = properties.find((prop) => prop.type === "number" && prop.name === "진행률");
  if (!progress) return true;
  const value = Object.prototype.hasOwnProperty.call(props, progress.id) ? props[progress.id] : props[progress.name];
  if (value === undefined || value === null || value === "") return true;
  const number = normaliseCellValue(progress, value);
  return number !== null && number >= 0 && number <= 100;
}

async function saveRowProps(db, rowId, props, properties, database) {
  const existing = await db.prepare("SELECT props FROM db_rows WHERE id = ?").bind(rowId).first();
  const before = parseJson(existing && existing.props, {});
  const normalised = { ...before };
  properties.forEach((prop) => {
    const incoming = Object.prototype.hasOwnProperty.call(props, prop.id) ? props[prop.id]
      : (Object.prototype.hasOwnProperty.call(props, prop.name) ? props[prop.name] : undefined);
    if (incoming !== undefined) normalised[prop.id] = normaliseCellValue(prop, incoming);
  });
  for (const hook of ACARD_FEATURES.beforeRowWrite) await hook({ db, database, properties, before, props: normalised });
  await db.prepare("UPDATE db_rows SET props = ?, updated = ? WHERE id = ?").bind(JSON.stringify(normalised), Date.now(), rowId).run();
  return normalised;
}

async function syncRowPageTitle(db, rowId, title) {
  const row = await db.prepare("SELECT page FROM db_rows WHERE id = ?").bind(rowId).first();
  if (!row || !row.page) return;
  await db.prepare("UPDATE pages SET title = ?, updated = ? WHERE slug = ?").bind(String(title || "제목 없음").slice(0, 200), Date.now(), row.page).run();
}

async function createDatabase(db, input) {
  const title = String((input && input.title) || "새 데이터베이스").trim().slice(0, 200) || "새 데이터베이스";
  let slug = slugify(input && input.slug ? input.slug : title);
  const taken = await db.prepare("SELECT slug FROM databases WHERE slug = ?").bind(slug).first();
  if (taken) slug = slug + "-" + Math.random().toString(36).slice(2, 6);
  const parent = input && input.parent ? String(input.parent) : null;
  const maxRow = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM databases WHERE parent IS ?").bind(parent).first();
  const now = Date.now();
  const id = dbId("d");
  await db.prepare("INSERT INTO databases (id, slug, title, icon, parent, ord, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, slug, title, String((input && input.icon) || "").slice(0, 8), parent, Number(maxRow && maxRow.m ? maxRow.m : 0) + 10, now, now).run();
  const seedProperties = Array.isArray(input && input.properties) && input.properties.length
    ? input.properties
    : [
      { id: "title", name: "이름", type: "title" },
      { id: "status", name: "상태", type: "status" },
    ];
  await saveProperties(db, id, seedProperties);
  await db.prepare("INSERT INTO db_views (id, database_id, name, type, config, ord) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(scopedId(id, dbId("v")), id, "표", "table", JSON.stringify({ filter: null, sorts: [], group_by: null, visible: null, widths: {}, calculations: {} }), 0).run();
  return { id, slug, title, parent };
}

async function saveProperties(db, databaseId, list) {
  const normalised = list.map((raw, index) => normaliseProperty(raw, index));
  const idMap = new Map();
  normalised.forEach((prop) => idMap.set(prop.id, scopedId(databaseId, prop.id)));
  const statements = [db.prepare("DELETE FROM db_properties WHERE database_id = ?").bind(databaseId)];
  normalised.forEach((prop) => {
    const config = Object.assign({}, prop.config);
    if (prop.type === "rollup" && idMap.has(config.relation_property)) config.relation_property = idMap.get(config.relation_property);
    statements.push(db.prepare("INSERT INTO db_properties (id, database_id, name, type, config, ord, width, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(idMap.get(prop.id), databaseId, prop.name, prop.type, JSON.stringify(config), prop.ord, prop.width, prop.hidden ? 1 : 0));
  });
  await db.batch(statements);
}

async function syncPageTitleToRow(db, slug, title) {
  const clean = String(title || "").slice(0, 200);
  const row = await db.prepare("SELECT id, database_id, props FROM db_rows WHERE page = ?").bind(slug).first();
  if (row) {
    const titleProp = await db.prepare("SELECT id FROM db_properties WHERE database_id = ? AND type = 'title' ORDER BY ord LIMIT 1").bind(row.database_id).first();
    if (titleProp) {
      const props = parseJson(row.props, {});
      props[titleProp.id] = clean;
      await db.prepare("UPDATE db_rows SET props = ?, updated = ? WHERE id = ?").bind(JSON.stringify(props), Date.now(), row.id).run();
    }
  }
  await db.prepare("UPDATE databases SET title = ?, updated = ? WHERE slug = ?").bind(clean || "제목 없음", Date.now(), slug).run();
}

async function createRowPage(db, database, title, blocks) {
  let slug = slugify(title || "행");
  const taken = await db.prepare("SELECT slug FROM pages WHERE slug = ?").bind(slug).first();
  if (taken) slug = slug + "-" + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'db_row', ?, 'editor', NULL)")
    .bind(slug, String(title || "제목 없음").slice(0, 200), database.slug, now % 100000, now).run();
  await saveBlocks(db, slug, normaliseBlocks(blocks && blocks.length ? blocks : [{ id: "b1", type: "paragraph", text: "", checked: false, indent: 0, meta: null }]));
  return slug;
}

async function readRowPage(db, databaseId, rowId) {
  const row = await db.prepare("SELECT id, page, props FROM db_rows WHERE id = ? AND database_id = ?").bind(rowId, databaseId).first();
  return row || null;
}

async function renderDatabaseHtml(db, slug, view) {
  const found = await readDatabase(db, slug);
  if (!found) return null;
  const titles = {};
  found.rows.forEach((row) => { titles[row.id] = row.pageTitle || ""; });
  return databaseHtml(found.properties, found.rows.map((row) => ({ id: row.id, page: row.page, values: rowValuesMap(found.properties, row) })), found.views, { now: Date.now(), rowTitles: titles, slug, viewId: found.views.find((v) => v.id === view || v.type === view)?.id });
}

// 시드는 빌드가 만든 notes-seed.json 이다. 도리(마크다운)가 정본인 페이지는 시드가 이기고,
// 오너가 브라우저에서 고친 페이지(source='editor')는 시드가 건드리지 않는다.
async function syncSeed(db, env, request) {
  const asset = await env.ASSETS.fetch(new Request(new URL("/notes-seed.json", request.url)));
  if (!asset.ok) return { imported: 0, updated: 0, skipped: 0 };
  const stamp = seedTag(asset) || String(Date.now());
  let seed;
  try {
    seed = JSON.parse(await asset.text());
  } catch {
    return { imported: 0, updated: 0, skipped: 0 };
  }
  const pages = Array.isArray(seed.pages) ? seed.pages : [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (const page of pages) {
    if (!page || typeof page.slug !== "string") continue;
    if (await db.prepare("SELECT page FROM editor_trash WHERE page = ?").bind(page.slug).first()) { skipped += 1; continue; }
    const existing = await db.prepare("SELECT slug, source, hash FROM pages WHERE slug = ?").bind(page.slug).first();
    if (existing && existing.source === "editor") {
      skipped += 1;
      continue;
    }
    if (existing && existing.hash === page.hash) {
      skipped += 1;
      continue;
    }
    const blocks = normaliseBlocks(page.blocks);
    await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, parent = excluded.parent, ord = excluded.ord, kind = excluded.kind, updated = excluded.updated, source = 'markdown', hash = excluded.hash")
      .bind(page.slug, String(page.title ?? page.slug), page.parent ?? null, Number(page.ord ?? 0), String(page.kind ?? "note"), Number(page.updated ?? Date.now()), String(page.hash ?? "")).run();
    await saveBlocks(db, page.slug, blocks);
    if (existing) updated += 1;
    else imported += 1;
  }
  await db.prepare("INSERT INTO meta (key, value) VALUES ('seed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(stamp).run();
  return { imported, updated, skipped, stamp };
}

function remapKeys(object, map) {
  const out = {};
  Object.keys(object && typeof object === "object" ? object : {}).forEach((key) => { out[map.has(key) ? map.get(key) : key] = object[key]; });
  return out;
}

function remapFilter(filter, map) {
  if (Array.isArray(filter)) return filter.map((entry) => remapFilter(entry, map));
  if (!filter || typeof filter !== "object") return filter;
  const out = Object.assign({}, filter);
  if (Array.isArray(out.and)) out.and = out.and.map((entry) => remapFilter(entry, map));
  if (Array.isArray(out.or)) out.or = out.or.map((entry) => remapFilter(entry, map));
  if (typeof out.property === "string" && map.has(out.property)) out.property = map.get(out.property);
  return out;
}

function remapViewConfig(config, map) {
  const source = config && typeof config === "object" ? config : {};
  const pick = (key) => (typeof key === "string" && map.has(key) ? map.get(key) : key);
  return Object.assign({}, source, {
    filter: remapFilter(source.filter, map),
    sorts: Array.isArray(source.sorts) ? source.sorts.map((sort) => (sort && typeof sort === "object" ? Object.assign({}, sort, { property: pick(sort.property) }) : sort)) : [],
    group_by: source.group_by ? pick(source.group_by) : null,
    visible: Array.isArray(source.visible) ? source.visible.map(pick) : null,
    widths: remapKeys(source.widths, map),
    calculations: remapKeys(source.calculations, map),
  });
}

// 데이터베이스 시드(/db-seed.json). 슬러그가 이미 있는 데이터베이스는 건드리지 않고, 없는 것만
// 한 번의 배치(트랜잭션)로 넣는다. id 는 슬러그에서 결정적으로 만들어 다시 실행해도 같다.
async function syncDbSeed(db, env, request) {
  const result = { imported: 0, rows: 0, skipped: 0 };
  let asset;
  try {
    asset = await env.ASSETS.fetch(new Request(new URL("/db-seed.json", request.url)));
  } catch {
    return result;
  }
  if (!asset || !asset.ok) return result;
  let seed;
  try {
    seed = JSON.parse(await asset.text());
  } catch {
    return result;
  }
  const entries = (Array.isArray(seed && seed.databases) ? seed.databases : []).filter((entry) => entry && typeof entry.slug === "string" && entry.slug && Array.isArray(entry.properties));

  const idBySlug = new Map();
  const missing = [];
  for (const entry of entries) {
    const existing = await db.prepare("SELECT id FROM databases WHERE slug = ?").bind(entry.slug).first();
    if (existing) {
      idBySlug.set(entry.slug, existing.id);
      result.skipped += 1;
      continue;
    }
    const clash = await db.prepare("SELECT kind FROM pages WHERE slug = ?").bind(entry.slug).first();
    if (clash && clash.kind !== "db") {
      result.skipped += 1;
      continue;
    }
    idBySlug.set(entry.slug, "s" + shortHash(entry.slug));
    missing.push(entry);
  }
  if (!missing.length) return result;

  // 1차: 모든 속성·행 id 를 먼저 정한다(관계가 아직 안 만들어진 다른 DB 를 가리킬 수 있다).
  const propMaps = new Map();
  const rowMaps = new Map();
  for (const entry of missing) {
    const databaseId = idBySlug.get(entry.slug);
    const propMap = new Map();
    entry.properties.forEach((prop) => { if (prop && typeof prop.id === "string") propMap.set(prop.id, scopedId(databaseId, prop.id)); });
    propMaps.set(entry.slug, propMap);
    const rowMap = new Map();
    (Array.isArray(entry.rows) ? entry.rows : []).forEach((row) => { if (row && typeof row.id === "string") rowMap.set(row.id, scopedId(databaseId, row.id)); });
    rowMaps.set(entry.slug, rowMap);
  }
  const seedBySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  const takenSlugs = new Set();
  const maxOrd = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM databases WHERE parent IS NULL").first();
  let dbOrd = Number(maxOrd && maxOrd.m ? maxOrd.m : 0);
  const now = Date.now();
  const statements = [];

  // 2차: 실제 삽입 문장을 만든다.
  for (const entry of missing) {
    const databaseId = idBySlug.get(entry.slug);
    const propMap = propMaps.get(entry.slug);
    const title = String(entry.title || entry.slug).slice(0, 200);
    dbOrd += 10;
    statements.push(db.prepare("INSERT OR IGNORE INTO databases (id, slug, title, icon, parent, ord, created, updated) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)")
      .bind(databaseId, entry.slug, title, String(entry.icon || "").slice(0, 8), dbOrd, now, now));
    statements.push(db.prepare("INSERT OR IGNORE INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, NULL, ?, 'db', ?, 'editor', NULL)")
      .bind(entry.slug, title, dbOrd, now));

    const properties = entry.properties.map((raw, index) => {
      const prop = normaliseProperty(raw, index);
      prop.id = propMap.get(raw && raw.id) || scopedId(databaseId, prop.id);
      const config = Object.assign({}, prop.config);
      if (prop.type === "rollup") {
        if (propMap.has(config.relation_property)) config.relation_property = propMap.get(config.relation_property);
        const rawConfig = raw.config && typeof raw.config === "object" ? raw.config : {};
        const relationRaw = entry.properties.find((item) => item && (item.id === rawConfig.relation_property || item.name === rawConfig.relation_property));
        const targetSlug = relationRaw && relationRaw.config ? relationRaw.config.database : "";
        const targetSeed = seedBySlug.get(targetSlug);
        if (targetSeed) {
          const targetRaw = targetSeed.properties.find((item) => item && (item.id === rawConfig.target_property || item.name === rawConfig.target_property));
          const targetMap = propMaps.get(targetSlug);
          if (targetRaw) config.target_property = targetMap && targetMap.has(targetRaw.id) ? targetMap.get(targetRaw.id) : targetRaw.name;
        }
      }
      prop.config = config;
      return prop;
    });
    properties.forEach((prop) => {
      statements.push(db.prepare("INSERT OR IGNORE INTO db_properties (id, database_id, name, type, config, ord, width, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(prop.id, databaseId, prop.name, prop.type, JSON.stringify(prop.config), prop.ord, prop.width, prop.hidden ? 1 : 0));
    });
    const titleProp = properties.find((prop) => prop.type === "title");

    (Array.isArray(entry.rows) ? entry.rows : []).forEach((raw, index) => {
      if (!raw || typeof raw.id !== "string") return;
      const rowId = rowMaps.get(entry.slug).get(raw.id);
      const incoming = raw.props && typeof raw.props === "object" ? raw.props : {};
      const props = {};
      properties.forEach((prop, propIndex) => {
        const seedId = entry.properties[propIndex] && entry.properties[propIndex].id;
        let value = Object.prototype.hasOwnProperty.call(incoming, seedId) ? incoming[seedId] : incoming[prop.name];
        if (value === undefined) {
          props[prop.id] = emptyValue(prop);
          return;
        }
        if (prop.type === "relation") {
          const targetRows = rowMaps.get(prop.config.database);
          const targetDbId = idBySlug.get(prop.config.database);
          const list = Array.isArray(value) ? value : value ? [value] : [];
          value = list.map((id) => String(id)).map((id) => (targetRows && targetRows.has(id) ? targetRows.get(id) : (targetDbId ? scopedId(targetDbId, id) : id)));
        }
        props[prop.id] = normaliseCellValue(prop, value);
      });
      const rowTitle = String(titleProp ? props[titleProp.id] : "") || "제목 없음";
      let pageSlug = slugify(rowTitle);
      if (takenSlugs.has(pageSlug)) pageSlug = pageSlug + "-" + shortHash(rowId);
      takenSlugs.add(pageSlug);
      statements.push(db.prepare("INSERT OR IGNORE INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'db_row', ?, 'editor', NULL)")
        .bind(pageSlug, rowTitle.slice(0, 200), entry.slug, (index + 1) * 10, now));
      const rowBlocks = normaliseBlocks(Array.isArray(raw.blocks) && raw.blocks.length ? raw.blocks : [{ id: "b1", type: "paragraph", text: "", checked: false, indent: 0, meta: null }]);
      blockStatements(db, pageSlug, rowBlocks).forEach((statement) => statements.push(statement));
      statements.push(db.prepare("INSERT OR IGNORE INTO db_rows (id, database_id, page, props, ord, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(rowId, databaseId, pageSlug, JSON.stringify(props), (index + 1) * 10, now, now));
      result.rows += 1;
    });

    (Array.isArray(entry.views) ? entry.views : []).forEach((raw, index) => {
      const view = normaliseView(Object.assign({}, raw, { id: scopedId(databaseId, raw && raw.id ? raw.id : "v" + index), config: remapViewConfig(raw && raw.config, propMap) }), index);
      statements.push(db.prepare("INSERT OR IGNORE INTO db_views (id, database_id, name, type, config, ord) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(view.id, databaseId, view.name, view.type, JSON.stringify(view.config), (index + 1) * 10));
    });
    if (!Array.isArray(entry.views) || !entry.views.length) {
      statements.push(db.prepare("INSERT OR IGNORE INTO db_views (id, database_id, name, type, config, ord) VALUES (?, ?, '표', 'table', ?, 0)")
        .bind(scopedId(databaseId, "table"), databaseId, JSON.stringify({ filter: null, sorts: [], group_by: null, visible: null, widths: {}, calculations: {} })));
    }

    (Array.isArray(entry.templates) ? entry.templates : []).forEach((raw, index) => {
      const template = normaliseTemplate(Object.assign({}, raw, { id: scopedId(databaseId, raw && raw.id ? raw.id : "t" + index), props: remapKeys(raw && raw.props, propMap) }), index);
      statements.push(db.prepare("INSERT OR IGNORE INTO db_templates (id, database_id, name, icon, props, blocks, ord) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(template.id, databaseId, template.name, template.icon, JSON.stringify(template.props), JSON.stringify(template.blocks), (index + 1) * 10));
    });
    result.imported += 1;
  }
  await db.batch(statements);
  return result;
}

async function seedStamp(db) {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'seed'").first();
  return row ? String(row.value) : "";
}

// 도리가 마크다운을 다시 배포했는지 확인한다. 새 빌드일 때만 시드를 읽어 반영한다.
async function ensureMemberHome(db) {
  const claim = "home-" + crypto.randomUUID();
  // 멤버 홈은 항상 있어야 한다. 휴지통에 들어간 홈은 꺼내서 / 가 404 가 되지 않게 한다.
  await db.batch([
    db.prepare("DELETE FROM editor_trash WHERE page = 'index'"),
    db.prepare("INSERT OR IGNORE INTO pages (slug, title, parent, ord, kind, updated, source, hash) SELECT 'index', 'Home', NULL, 0, 'note', ?, 'editor', ? WHERE NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = 'index')").bind(Date.now(), claim),
    db.prepare("INSERT INTO blocks (page, id, ord, type, text, checked, indent, meta) SELECT 'index', 'b1', 0, 'paragraph', '', 0, 0, NULL WHERE EXISTS (SELECT 1 FROM pages WHERE slug = 'index' AND hash = ?)").bind(claim),
    db.prepare("UPDATE pages SET hash = NULL WHERE slug = 'index' AND hash = ?").bind(claim),
  ]);
}

// HEAD can answer W/"x" while GET answers "x" for the same file; compare the bare tag so an unchanged seed never looks new.
function seedTag(response) {
  return String(response.headers.get("etag") ?? response.headers.get("last-modified") ?? "").replace(/^W\//, "").replace(/"/g, "");
}

// Seed tags this isolate already saw applied; the seed only changes with a new deploy (a new isolate), so a match
// needs no DB round trip on every API call.
const seedSeen = new Set();
async function syncIfStale(db, env, request) {
  if (isMember(env) || isGuest(env)) return null;
  const head = await env.ASSETS.fetch(new Request(new URL("/notes-seed.json", request.url), { method: "HEAD" }));
  const etag = head.ok ? seedTag(head) : "";
  const seenKey = ((db && db.acardKey) || "d1") + ":" + etag;
  if (etag && seedSeen.has(seenKey)) return null;
  if (etag && (await seedStamp(db)).replace(/^W\//, "").replace(/"/g, "") === etag) { seedSeen.add(seenKey); return null; }
  // Only the request that moves the claim to this tag rewrites the seed; concurrent requests skip instead of
  // deleting and re-inserting the same blocks at the same time (blocks_pkey / page_fts_pkey collisions).
  const claim = await db.prepare("INSERT INTO meta (key, value) VALUES ('seed-claim', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <> excluded.value").bind(etag || String(Date.now())).run();
  if (!(claim && claim.meta && claim.meta.changes)) return null;
  try { return await syncSeed(db, env, request); }
  catch (error) { await db.prepare("DELETE FROM meta WHERE key = 'seed-claim'").run().catch(() => {}); throw error; }
}

async function pageExtras(db, page, blocks, view) {
  const extras = { crumbs: "", dbHtml: "", scripts: "" };
  const linked = [];
  for (const block of blocks) {
    if (block.type === "db_ref" && block.meta && block.meta.database) linked.push(block);
  }
  for (const block of linked) {
    if (db.acardVisible && !db.acardVisible.has(String(block.meta.database))) { block.meta = Object.assign({}, block.meta, { html: "" }); continue; }
    const html = await renderDatabaseHtml(db, String(block.meta.database));
    block.meta = Object.assign({}, block.meta, { html: html || "" });
  }
  // 홈은 시안처럼 인트로 아래에 프로젝트 현황 표("주요 작업 목록")를 그대로 띄운다.
  if (page.slug === "index" && (!db.acardVisible || db.acardVisible.has("board"))) {
    const board = await renderDatabaseHtml(db, "board");
    if (board) {
      extras.homeTasks = '<div class="home-tasks">' + board + "</div>";
      extras.scripts = '<script src="/db-model.js"></script><script src="/db-views.js"></script><script src="/db.js"></script>';
    }
  }
  if (page.kind === "db") {
    extras.dbHtml = (await renderDatabaseHtml(db, page.slug, view)) || '<p class="dbempty">아직 표가 없어요.</p>';
    extras.scripts = '<script src="/db-model.js"></script><script src="/db-views.js"></script><script src="/db.js"></script>';
  }
  if (page.kind === "db_row") {
    const row = await db.prepare("SELECT id, database_id FROM db_rows WHERE page = ?").bind(page.slug).first();
    if (row) {
      const database = await db.prepare("SELECT id, slug, title, icon, parent, ord, created, updated FROM databases WHERE id = ?").bind(row.database_id).first();
      if (database) {
        const found = await readDatabaseById(db, database, 0);
        const mine = found.rows.filter((entry) => entry.id === row.id);
        const titles = {};
        found.rows.forEach((entry) => { titles[entry.id] = entry.pageTitle || ""; });
        const table = databaseTableHtml(found.properties, mine.map((entry) => ({ id: entry.id, page: entry.page, values: rowValuesMap(found.properties, entry) })), { config: {} }, { now: Date.now(), rowTitles: titles, slug: database.slug });
        extras.crumbs = '<nav class="dbbreadcrumb"><a href="/' + encodeURIComponent(database.slug) + '/">' + escapeHtml(database.title) + "</a></nav>";
        extras.dbHtml = '<div class="dbprops" data-db="' + escapeHtml(database.slug) + '" data-row="' + escapeHtml(row.id) + '">' + table + '</div><div class="blocks">' + renderBlocks(blocks) + "</div>";
        extras.scripts = '<script src="/db-model.js"></script><script src="/db-views.js"></script><script src="/db.js"></script>';
      }
    }
  }
  return extras;
}

function pageShell(page, blocks, pages, extras, settings = {}) {
  const extra = extras || {};
  const ctx = { page: page, pages: pages ?? [] };
  const tagRow = page.ws === "guest" || page.slug === "index" ? "" : '<div class="fd-headtags" id="fd-headtags"></div>';
  const heading = "<h1>" + escapeHtml(page.title) + "</h1>" + tagRow + bylineHtml(page);
  let top = heading;
  let body;
  if (extra.dbHtml) {
    body = extra.dbHtml;
    if (page.kind === "db" && page.slug === "board") {
      const intro = introSplit(blocks)[0];
      const introHtml = intro.length ? '<div class="blocks">' + renderBlocks(intro, ctx) + "</div>" : "";
      const side = sideImageHtml(Object.assign({}, page, settings.side_image ? { side_image: settings.side_image } : {}));
      top = side ? '<div class="page-top"><div class="page-top-main">' + heading + introHtml + "</div>" + side + "</div>" : heading + introHtml;
    }
  }
  else {
    const split = introSplit(blocks);
    const side = sideImageHtml(Object.assign({}, page, { side_image: settings.side_image || page.side_image }));
    if (side) top = '<div class="page-top"><div class="page-top-main">' + heading + (split[0].length ? '<div class="blocks">' + renderBlocks(split[0], ctx) + "</div>" : "") + "</div>" + side + "</div>";
    body = '<div class="blocks">' + renderBlocks(side ? split[1] : blocks, ctx) + "</div>";
  }
  const mainClass = [settings.width === "full" ? "full-width" : "", page.kind === "db" ? "wide" : ""].filter(Boolean).join(" ");
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="application-name" content="__SITE_NAME__">',
    '<meta property="og:site_name" content="__SITE_NAME__">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<meta property="og:image" content="/og.png">',
    "<title>" + escapeHtml(page.title) + " · __SITE_NAME__</title>",
    '<link rel="preload" href="/fonts/pretendard-core.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="stylesheet" href="/style.css">',
    '<link rel="stylesheet" href="/editor.css">',
    '<link rel="stylesheet" href="/db.css">',
    '<link rel="stylesheet" href="/acard-shell.css"><link rel="stylesheet" href="/acard-page.css"><link rel="stylesheet" href="/acard-body.css"><link rel="stylesheet" href="/acard-table.css"><link rel="stylesheet" href="/acard-mobile.css">',
    //__READER_FEATURE_CSS__
    "</head>",
    '<body class="reader">',
    '<a class="skip" href="#main">본문으로</a>',
    mobileBarHtml("__SITE_NAME__"),
    '<div class="shell">',
    '<nav class="sidebar" id="sidebar" aria-label="문서 목록">' + sideNavHtml(pages ?? [], page.slug, "__SITE_NAME__") + sideFootHtml() + "</nav>",
    '<main id="main" class="' + mainClass + '" data-font="' + escapeHtml(settings.font || "default") + '">',
    '<div id="results" class="results" hidden></div>',
    '<article id="article">',
    extra.crumbs ? extra.crumbs : "",
    pageHeadHtml(page, settings, pageActionsHtml(page.slug, moreMenu(page.slug))),
    top,
    page.slug === "index" && page.ws !== "member" && page.ws !== "guest" ? (extra.homeTasks || "") + overviewHtml(blocks) : body,
    "</article>",
    page.ws === "guest" ? '<footer class="foot">공유받은 페이지 · ' + escapeHtml(page.guest || "") + ' <form method="POST" action="/s/' + escapeHtml(page.guestWs || "o") + '/logout" style="display:inline"><button type="submit">나가기</button></form></footer>' : page.ws === "member" ? '<footer class="foot">비공개 노트 · 나만 볼 수 있어요</footer>' : '<footer class="foot">비공개 노트 · 오너 전용</footer>',
    "</main>",
    "</div>",
    thumbBarHtml(page.slug),
    paletteHtml(),
    shortcutsHtml(),
    sidePanelHtml(),
    '<script src="/app.js"></script>',
    extra.scripts ? extra.scripts : "",
    page.ws === "guest" ? LIVE_TAG : FOLDERS_TAG,
    page.slug === "index" && page.ws !== "guest" ? HOME_TAG : "",
    //__READER_FEATURE_JS__
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------- 미디어 ----------
// POST /api/upload, GET /media/<id>, DELETE /api/media/<id>, GET /api/link-preview — 모두 게이트 쿠키 검사 뒤에서만 돈다.

const MEDIA_BINDING = "MEDIA";
const MEDIA_MAX_BYTES = 4 * 1024 * 1024;
const MEDIA_ID = /^[0-9a-f]{16}$/;
const LINK_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_MAX_BYTES = 512 * 1024;

function mediaId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function baseMime(type) {
  return String(type ?? "").split(";")[0].trim().toLowerCase();
}

export function isAllowedMime(type) {
  const mime = baseMime(type);
  return /^(image|video|audio)\/[a-z0-9.+-]+$/.test(mime) || mime === "application/pdf" || mime === "text/plain";
}

export function sanitizeName(name) {
  const clean = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
    .trim()
    .slice(0, 200);
  return clean || "file";
}

// SVG 는 같은 오리진에서 inline 으로 열리면 스크립트가 돈다. 그래서 image/* 여도 내려받게 한다.
export function pickDisposition(mime, name) {
  const type = baseMime(mime);
  const inline = /^(image|video|audio)\//.test(type) && type !== "image/svg+xml";
  const encoded = encodeURIComponent(sanitizeName(name)).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + encoded;
}

// 링크 미리보기는 서버가 대신 남의 주소를 여는 것이라 내부망으로 새지 않게 막는다.
export function isBlockedHost(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host.startsWith("[") || host.includes(":")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (/^[\d.]+$/.test(host) || /^0x/i.test(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  return false;
}

export function previewTarget(raw) {
  let target;
  try {
    target = new URL(String(raw ?? ""));
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (isBlockedHost(target.hostname)) return null;
  return target;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, key) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const named = /\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const which = named ? (named[1] ?? named[2] ?? named[3] ?? "").toLowerCase() : "";
    if (which !== key) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    if (content) return decodeEntities(content[1] ?? content[2] ?? content[3] ?? "");
  }
  return "";
}

export function parsePreview(html, pageUrl) {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  let image = metaContent(html, "og:image");
  if (image) {
    try {
      image = new URL(image, pageUrl).href;
    } catch {
      image = "";
    }
  }
  return {
    title: (metaContent(html, "og:title") || (titleTag ? decodeEntities(titleTag[1]) : "")).slice(0, 300),
    description: (metaContent(html, "og:description") || metaContent(html, "description")).slice(0, 1000),
    image: image.slice(0, 2000),
    site: metaContent(html, "og:site_name").slice(0, 200),
  };
}

async function readLimited(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const merged = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, merged.length - offset);
    merged.set(part, offset);
    offset += part.length;
    if (offset >= merged.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

async function linkPreview(db, raw) {
  const target = previewTarget(raw);
  if (!target) return json({ ok: false, url: String(raw ?? ""), error: "http 나 https 주소만 미리볼 수 있어요." }, 400);
  const key = target.href;
  const cached = await db.prepare("SELECT title, description, image, site, created FROM link_cache WHERE url = ?").bind(key).first().catch(() => null);
  if (cached && Date.now() - Number(cached.created) < LINK_CACHE_MS) {
    return json({ ok: true, url: key, title: cached.title ?? "", description: cached.description ?? "", image: cached.image ?? "", site: cached.site ?? "" });
  }
  try {
    const response = await fetch(key, {
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error("status " + response.status);
    const type = response.headers.get("content-type") ?? "";
    const html = /html|xml/i.test(type) || !type ? await readLimited(response, LINK_MAX_BYTES) : "";
    const preview = parsePreview(html, response.url || key);
    if (!preview.site) preview.site = target.hostname;
    await db.prepare("INSERT OR REPLACE INTO link_cache (url, title, description, image, site, created) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(key, preview.title, preview.description, preview.image, preview.site, Date.now()).run().catch(() => {});
    return json({ ok: true, url: key, ...preview });
  } catch {
    return json({ ok: false, url: key, error: "미리보기를 가져올 수 없었어요." });
  }
}

// Agent uploads: images only (png/jpeg/webp/gif; never SVG, which can carry script), same 4 MB cap and KV layout as /api/upload.
const AGENT_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
function isSvg(bytes) {
  const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 1024))).replace(/^\uFEFF/, "").trimStart();
  return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
}
function sniffImage(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
async function storeAgentImage(env, db, page, name, declared, bytes, source) {
  const store = env[MEDIA_BINDING];
  if (!store) throw new AgentError("미디어 저장소가 연결되지 않았어요.", 503);
  if (!bytes || !bytes.byteLength) throw new AgentError("올릴 파일이 없어요.");
  if (bytes.byteLength > MEDIA_MAX_BYTES) throw new AgentError("파일이 너무 커요. 최대 4MB 까지 올릴 수 있어요.", 413);
  const mime = sniffImage(bytes) || (isSvg(bytes) ? "image/svg+xml" : null);
  if (!mime || !AGENT_IMAGE_MIMES.has(mime) || (declared && baseMime(declared) !== mime)) throw new AgentError("png, jpeg, webp, gif, svg 이미지만 올릴 수 있어요.", 415);
  if (mime === "image/svg+xml") bytes = new TextEncoder().encode(ACARD_FEATURES.services.sanitizeSvg(new TextDecoder().decode(bytes))).buffer;
  const id = mediaId();
  const clean = sanitizeName(name || "image");
  await store.put("media/" + id, bytes, { metadata: { mime, name: clean, size: bytes.byteLength, ...(source ? { source: String(source).slice(0, 500) } : {}) } });
  await db.prepare("INSERT INTO media (id, page, name, mime, bytes, created) VALUES (?, ?, ?, ?, ?, ?)").bind(id, page || null, clean, mime, bytes.byteLength, Date.now()).run();
  return { ok: true, id, url: "/media/" + id, mime, name: clean, size: bytes.byteLength, markdown: "![" + clean.replace(/[\]\n]/g, " ") + "](/media/" + id + ")" };
}

async function uploadMedia(request, env, db) {
  const store = env[MEDIA_BINDING];
  if (!store) return json({ error: "미디어 저장소가 연결되지 않았어요." }, 503);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MEDIA_MAX_BYTES + 64 * 1024) return json({ error: "파일이 너무 커요. 최대 4MB 까지 올릴 수 있어요." }, 413);
  const form = await request.formData().catch(() => null);
  const file = form ? form.get("file") : null;
  if (!file || typeof file === "string" || !file.size) return json({ error: "올릴 파일이 없어요." }, 400);
  if (file.size > MEDIA_MAX_BYTES) return json({ error: "파일이 너무 커요. 최대 4MB 까지 올릴 수 있어요." }, 413);
  const mime = baseMime(file.type);
  if (!isAllowedMime(mime)) return json({ error: "이미지, 영상, 소리, PDF, 텍스트 파일만 올릴 수 있어요." }, 415);
  const id = mediaId();
  const name = sanitizeName(file.name);
  const page = form.get("page") ? String(form.get("page")).slice(0, 120) : null;
  let bytes = await file.arrayBuffer();
  if (mime === "image/svg+xml") bytes = new TextEncoder().encode(ACARD_FEATURES.services.sanitizeSvg(new TextDecoder().decode(bytes))).buffer;
  await store.put("media/" + id, bytes, { metadata: { mime, name, size: bytes.byteLength } });
  await db.prepare("INSERT INTO media (id, page, name, mime, bytes, created) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, page, name, mime, bytes.byteLength, Date.now()).run();
  return json({ ok: true, id, url: "/media/" + id, mime, name, size: bytes.byteLength });
}

async function serveMedia(env, id) {
  const store = env[MEDIA_BINDING];
  if (!store) return json({ error: "미디어 저장소가 연결되지 않았어요." }, 503);
  if (!MEDIA_ID.test(id)) return json({ error: "없는 파일이에요." }, 404);
  const db = env[DB_BINDING];
  if (db && await db.prepare("SELECT 1 AS t FROM media m JOIN editor_trash t ON t.page = m.page WHERE m.id = ?").bind(id).first().catch(() => null)) return json({ error: "휴지통에 있는 페이지의 파일이에요." }, 404);
  const found = await store.getWithMetadata("media/" + id, { type: "arrayBuffer", cacheTtl: 86400 });
  if (!found || found.value === null) return json({ error: "없는 파일이에요." }, 404);
  const meta = found.metadata ?? {};
  const mime = meta.mime || "application/octet-stream";
  return new Response(found.value, {
    headers: {
      "content-type": mime,
      "cache-control": "private, max-age=86400",
      "content-disposition": pickDisposition(mime, meta.name || id),
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}

function paletteHtml() {
  return [
    '<div class="overlay" id="palette" hidden role="dialog" aria-modal="true" aria-label="빠른 검색">',
    '<div class="sheet">',
    '<input id="palette-q" type="search" placeholder="노트 제목·본문 검색…" aria-label="빠른 검색" autocomplete="off">',
    '<div id="palette-list" class="palette-list" role="listbox"></div>',
    '<div class="palette-hint">↑↓ 고르기 · Enter 열기 · Esc 닫기</div>',
    "</div>",
    "</div>",
  ].join("");
}

function shortcutsHtml() {
  return [
    '<div class="overlay" id="shortcuts" hidden role="dialog" aria-modal="true" aria-label="키보드 단축키">',
    '<div class="sheet">',
    "<h2>키보드 단축키</h2>",
    '<dl class="keys">',
    "<dt>/ · K</dt><dd>빠른 검색 (입력 중 제외)</dd><dt>N · Q · ?</dt><dd>새 페이지 · 빠른 메모 · 도움말 (입력 중 제외)</dd><dt>G → H / T</dt><dd>홈 / 휴지통 (입력 중 제외)</dd><dt>Ctrl/Cmd + Enter</dt><dd>빠른 메모 저장</dd>",
    "<dt>Ctrl/Cmd + K</dt><dd>빠른 검색</dd>",
    "<dt>Ctrl/Cmd + /</dt><dd>이 단축키 목록</dd>",
    "<dt>Ctrl/Cmd + B</dt><dd>사이드바 접기·펴기</dd>",
    "<dt>Esc</dt><dd>열려 있는 창 닫기</dd>",
    "<dt>/</dt><dd>편집기에서 블록 종류 메뉴</dd>",
    "<dt>Tab / Shift+Tab</dt><dd>편집기에서 들여쓰기·내어쓰기</dd>",
    "<dt>Ctrl/Cmd + B/I/U/E</dt><dd>편집기에서 굵게·기울임·밑줄·코드</dd>",
    "</dl>",
    '<button type="button" class="close" id="shortcuts-close" aria-label="닫기">닫기</button>',
    "</div>",
    "</div>",
  ].join("");
}

// 읽기 화면 상단의 더보기 메뉴. 내보내기·인쇄·단축키를 한 곳에 모은다.
function moreMenu(slug) {
  const q = encodeURIComponent(slug);
  return [
    '<div class="menuwrap">',
    '<button class="icon" id="more" aria-label="더보기" aria-expanded="false" title="더보기">⋯</button>',
    '<div class="menu" id="more-menu" hidden>',
    '<a href="/print/' + q + '/" target="_blank" rel="noopener">인쇄 · PDF로 저장</a>',
    '<a href="/api/export?slug=' + q + '&format=md" download="' + escapeHtml(slug) + '.md">마크다운으로 내보내기</a>',
    '<a href="/api/export?slug=' + q + '&format=html" download="' + escapeHtml(slug) + '.html">HTML로 내보내기</a>',
    '<a href="/api/export?scope=all&format=zip" download="acard.zip">전체 노트 내보내기 (zip)</a>',
    '<button type="button" class="menuitem" id="shortcuts-open">키보드 단축키</button>',
    '<button type="button" class="menuitem" id="quick-note-open">빠른 메모</button>',
    "</div>",
    "</div>",
  ].join("");
}

// 인쇄·PDF용 화면. 화면용 CSS 를 쓰지 않고 인쇄에 맞춘 최소 스타일만 쓴다.
function printShell(page, blocks) {
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="color-scheme" content="light">',
    "<title>" + escapeHtml(page.title) + " · __SITE_NAME__</title>",
    "<style>",
    ':root{color-scheme:light}',
    'body{margin:0;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Segoe UI",Roboto,sans-serif;font-size:11.5pt;line-height:1.75;word-break:keep-all}',
    ".sheet{max-width:780px;margin:0 auto;padding:32px 26px 60px}",
    "h1{font-size:22pt;line-height:1.3;margin:0 0 6px;letter-spacing:-.03em}",
    ".meta{color:#666;font-size:9.5pt;margin:0 0 22px;padding-bottom:10px;border-bottom:1px solid #ddd}",
    "h2{font-size:15pt;margin:22px 0 6px}h3{font-size:12.5pt;margin:16px 0 4px}h4{font-size:11.5pt;margin:14px 0 4px}",
    "p{margin:0 0 10px}ul,ol{padding-left:22px;margin:0 0 12px}li{margin:3px 0}",
    "blockquote{margin:12px 0;padding:2px 14px;border-left:2px solid #bbb;color:#444}",
    "pre{background:#f4f4f4;padding:10px 12px;border-radius:6px;overflow-x:auto;white-space:pre-wrap}",
    "code{background:#f1f1f1;padding:0 4px;border-radius:4px}",
    "pre code{background:none;padding:0}",
    "table{border-collapse:collapse;width:100%;margin:12px 0;font-size:10pt}",
    "th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}th{background:#f6f6f6}",
    ".todo{display:flex;gap:7px;margin:0 0 6px}.todo .box{width:13px;height:13px;margin-top:4px;border:1.2px solid #999;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:9pt}",
    ".todo.on span:last-child{color:#777;text-decoration:line-through}",
    ".callout{margin:12px 0;padding:9px 13px;border-radius:8px;background:#f6f2ea;border-left:3px solid #9a6a2f}",
    ".toggle{margin:6px 0}",
    ".toggle summary{font-weight:600}",
    "hr{border:0;border-top:1px solid #ccc;margin:18px 0}",
    ".backlinks{margin-top:26px;padding-top:10px;border-top:1px solid #ddd;font-size:9.5pt;color:#666}",
    ".bar{position:sticky;top:0;display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:8px 12px;background:#fff;border-bottom:1px solid #eee}",
    ".bar a,.bar button{font:inherit;font-size:10pt;color:#333;background:#f4f4f4;border:1px solid #ddd;border-radius:999px;padding:5px 12px;cursor:pointer;text-decoration:none}",
    "@page{margin:16mm}",
    "@media print{.bar{display:none}.sheet{padding:0;max-width:none}a{color:inherit;text-decoration:none}.toggle[open] summary{list-style:none}.toggle:not([open])>*:not(summary){display:block}}",
    "</style>",
    "</head>",
    "<body>",
    '<div class="bar"><button type="button" id="do-print">인쇄 · PDF로 저장</button><a href="/' + (page.slug === "index" ? "" : encodeURIComponent(page.slug) + "/") + '">읽기 화면으로</a></div>',
    '<main class="sheet">',
    "<h1>" + escapeHtml(page.title) + "</h1>",
    '<p class="meta">__SITE_NAME__ · ' + escapeHtml(page.slug) + "</p>",
    renderBlocks(blocks),
    "</main>",
    "<script>document.getElementById('do-print').addEventListener('click',function(){window.print()});</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------- 라우팅 ----------

const API = "/api";

//__FEATURES__

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const password = env.GATE_PASSWORD;
    const secret = env.GATE_SECRET;
    const trusted = TRUSTED_ENVS.has(env);

    if (!trusted && (!password || !secret)) {
      return new Response("준비 중이에요.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-dori-gate": "1" },
      });
    }

    if (url.pathname === "/__gate") {
      if (request.method !== "POST") return challenge("", "/", 405);
      const form = await request.formData().catch(() => null);
      const next = safeNext(form ? String(form.get("next") ?? "/") : "/");
      const given = form ? String(form.get("pw") ?? "") : "";
      if (!constantTimeEqual(given, password)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return challenge("비밀번호가 달라요.", next, 401);
      }
      const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
      const ticket = expires + "." + (await sign(secret, String(expires)));
      return new Response(null, {
        status: 303,
        headers: {
          Location: next,
          "cache-control": "no-store",
          "Set-Cookie": COOKIE_NAME + "=" + ticket + "; Path=/; Max-Age=" + MAX_AGE_SECONDS + "; HttpOnly; Secure; SameSite=Lax",
        },
      });
    }

    if (url.pathname === "/__logout") {
      if (request.method !== "POST") return challenge("", "/", 405);
      return new Response(null, { status: 303, headers: { Location: "/", "cache-control": "no-store", "Set-Cookie": COOKIE_NAME + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
    }

    if (url.pathname === AGENT_API || url.pathname.startsWith(AGENT_API + "/")) {
      return await serveAgentApi(request, env, url);
    }

    const changing = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
    const given = request.headers.get("origin");
    if (changing && given && given !== url.origin && (url.pathname.startsWith(API + "/") || url.pathname.startsWith("/s/") || url.pathname.startsWith("/form/"))) {
      return json({ error: "다른 사이트에서 온 요청은 받지 않아요." }, 403);
    }

    // Guests (verified invited emails) never reach the routes below directly: the share resolver checks the route
    // table first and continues with a view env whose DB only reveals the pages it may read.
    if (trusted && env.ACARD_GUEST_TOKEN !== undefined) {
      if (!ACARD_FEATURES.services.guestFetch) return json({ error: "권한이 없어요." }, 401);
      return await ACARD_FEATURES.services.guestFetch(request, env, url, (inner, view) => this.fetch(inner, view));
    }

    if ((url.pathname.startsWith("/p/") || url.pathname.startsWith("/s/")) && ACARD_FEATURES.publicRoutes.length) {
      const db = env[DB_BINDING];
      if (db) await ensureSchema(db);
      const ctx = featureContext(request, env, db, url);
      for (const hook of ACARD_FEATURES.publicRoutes) {
        const response = await hook(ctx);
        if (response !== null) return response;
      }
    }

    // Service-worker update requests can omit the gate cookie. This generated
    // script contains policy and asset hashes only, never note data.
    if (url.pathname === "/sw.js" && request.method === "GET") {
      const asset = await env.ASSETS.fetch(request);
      return new Response(asset.body, { status: asset.status, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" } });
    }

    if (!trusted && !(await hasValidTicket(request, secret))) {
      return challenge("", safeNext(url.pathname + url.search), 401);
    }

    const db = env[DB_BINDING];
    const isApi = url.pathname === API || url.pathname.startsWith(API + "/");
    const isEditor = url.pathname === "/edit" || url.pathname.startsWith("/edit/");

    if ((isApi || isEditor) && !db) {
      return json({ error: "저장소가 연결되지 않았어요." }, 503);
    }

    if (isApi) {
      try {
        await ensureSchema(db);
        await syncIfStale(db, env, request);
        return await handleApi(request, env, db, url);
      } catch (error) {
        return json({ error: String(error && error.message ? error.message : error) }, 500);
      }
    }

    for (const hook of ACARD_FEATURES.authenticatedRoutes) {
      const response = await hook(featureContext(request, env, db, url));
      if (response !== null) return response;
    }

    const printMatch = /^\/print\/(.+?)\/?$/.exec(url.pathname);
    if (printMatch && db) {
      await ensureSchema(db);
      const slug = decodeURIComponent(printMatch[1]);
      const found = await readPage(db, slug);
      if (!found) return new Response("없는 페이지예요.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
      return new Response(printShell(found.page, found.blocks), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
      });
    }

    if (isEditor) {
      await ensureSchema(db);
      const asset = await env.ASSETS.fetch(new Request(new URL("/editor.html", request.url)));
      if (!asset.ok) return new Response("에디터를 찾을 수 없어요.", { status: 500 });
      if (!isGuest(env)) return new Response((await asset.text()).replace("</body>", FOLDERS_TAG + "</body>"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
      return new Response((await asset.text()).replace("</body>", LIVE_TAG + "</body>"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
    }

    const mediaMatch = /^\/media\/([^/]+)\/?$/.exec(url.pathname);
    if (mediaMatch || url.pathname === "/media" || url.pathname.startsWith("/media/")) {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "없는 API예요." }, 405);
      return await serveMedia(env, mediaMatch ? mediaMatch[1] : "");
    }

    const asset = await env.ASSETS.fetch(request);

    const pageMatch = /^\/([^/]+)\/?$/.exec(url.pathname) || (url.pathname === "/" ? ["/", "index"] : null);
    const isHtml = asset.ok && /^text\/html/.test(asset.headers.get("content-type") ?? "");
    if (db && pageMatch && (asset.status === 404 || isHtml)) {
      try {
        await ensureSchema(db);
        const slug = resolveSlug(decodeURIComponent(pageMatch[1]));
        if (isMember(env) && slug === "index") await ensureMemberHome(db);
        const welcome = slug === "index" && isHtml && ACARD_FEATURES.services.homeWelcome ? await ACARD_FEATURES.services.homeWelcome(db) : "";
        if (welcome) return new Response((await asset.text()).replace('<article id="article">', '<article id="article">' + welcome).replace("</body>", (isGuest(env) ? "" : FOLDERS_TAG + (isMember(env) ? HOME_TAG : "")) + "</body>"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
        if (await db.prepare("SELECT page FROM editor_trash WHERE page = ?").bind(slug).first()) return new Response("없는 페이지예요.", { status: 404 });
        const row = await db.prepare("SELECT source, kind FROM pages WHERE slug = ?").bind(slug).first();
        const appearance = await readEditorPageMeta(db, slug);
        const liveDatabase = row && slug === "board" && row.kind === "db" && await db.prepare("SELECT id FROM databases WHERE slug = ?").bind(slug).first();
        if (row && (slug === "board" && row.kind === "db" && !isGuest(env) ? liveDatabase : (isGuest(env) || row.source === "editor" || appearance.settings.icon || appearance.settings.cover || appearance.settings.font !== "default" || appearance.settings.width !== "default"))) {
          const found = await readPage(db, slug);
          if (found) {
            if (isMember(env)) found.page.ws = "member";
            if (isGuest(env)) Object.assign(found.page, { ws: "guest", guest: env.ACARD_GUEST_EMAIL, guestWs: env.ACARD_WORKSPACE && env.ACARD_WORKSPACE !== "owner" ? env.ACARD_WORKSPACE : "o" });
            const extras = await pageExtras(db, found.page, found.blocks, url.searchParams.get("view"));
            const agent = await latestAgentAuthor(db, found.page);
            if (agent) found.page.agent = agent;
            return new Response(pageShell(found.page, found.blocks, await readTree(db), extras, found.settings), {
              headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
            });
          }
        }
      } catch {
        return asset;
      }
      if (isHtml && !isGuest(env)) return new Response((await asset.text()).replace("</body>", FOLDERS_TAG + "</body>"), { status: asset.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
    }
    return asset;
  },
};

const AGENT_API = "/api/v1";
const HOME_TAG = '<link rel="stylesheet" href="/lazy/ui-kit-css.css?v=__UI_KIT_CSS__"><link rel="stylesheet" href="/lazy/ui-home-css.css?v=__HOME_CSS__"><script src="/lazy/ui-home-js.js?v=__HOME_JS__" defer></script>';
const LIVE_TAG = '<script src="/lazy/live.js?v=__LIVE_JS__" defer></script>';
const FOLDERS_TAG = '<link rel="stylesheet" href="/lazy/folders.css?v=__FOLDERS_CSS__"><script src="/lazy/folders.js?v=__FOLDERS_JS__" defer></script><link rel="stylesheet" href="/lazy/projects.css?v=__PROJECTS_CSS__"><script src="/lazy/projects.js?v=__PROJECTS_JS__" defer></script>' + LIVE_TAG;

// Per-page agent rules (features/share.js) only narrow the token's scopes. A token narrowed to nothing on the page
// it names gets 403, never a widened scope.
async function narrowAgent(db, principal, slug) {
  const service = ACARD_FEATURES.services.agentScopes;
  if (!service || !slug) return principal;
  const scopes = await service(db, principal, slug);
  if (!scopes.length) throw new AgentError("이 페이지에는 이 에이전트의 권한이 없어요.", 403);
  return scopes.length === principal.scopes.length ? principal : { ...principal, scopes };
}

// 에이전트가 마지막으로 쓴 뒤 사람이 다시 고쳤다면(페이지 updated 가 더 늦으면) 사람 표시를 그대로 둔다.
async function latestAgentAuthor(db, page) {
  try {
    await ensureAgentSchema(db);
    const row = await db.prepare("SELECT agent, created FROM agent_activity WHERE page = ? ORDER BY created DESC LIMIT 1").bind(page.slug).first();
    return row && Number(row.created) >= Number(page.updated) ? String(row.agent) : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function agentHelpers(env) {
  return {
    json, slugify, resolveSlug, readTree, readPage, normaliseBlocks, saveBlocks, captureEditorVersion, syncPageTitleToRow,
    markdownToBlocks, blocksToMarkdown, readDatabase, dbRowRequest, services: ACARD_FEATURES.services,
    ingestImages: (db, page, blocks) => ingestImages(env, db, page, blocks),
  };
}

async function ingestImages(env, db, page, blocks) {
  if (!env || !env[MEDIA_BINDING] || !ACARD_FEATURES.services.ingestImages) return [];
  return ACARD_FEATURES.services.ingestImages(db, page, blocks, (p, name, mime, bytes, source) => storeAgentImage(env, db, p, name, mime, bytes, source));
}

// 기존 데이터베이스 행 API 를 그대로 불러 검증·제목 동기화 규칙을 한 곳에만 둔다.
async function dbRowRequest(db, slug, method, row, body) {
  const target = new URL("https://acard.internal" + API + "/db/" + encodeURIComponent(slug) + "/rows" + (row ? "/" + encodeURIComponent(row) : ""));
  const response = await handleApi(new Request(target, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {}, db, target, false);
  const data = await response.json();
  if (!response.ok) throw new AgentError(data && data.error ? data.error : "데이터베이스를 고치지 못했어요.", response.status);
  return data;
}

function agentChallenge(request) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({ error: "에이전트 토큰이 필요해요. Acard 설정 > 에이전트 연결에서 만들 수 있어요." }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "www-authenticate": 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource"',
    },
  });
}

async function serveAgentApi(request, env, url, givenPrincipal) {
  const db = env[DB_BINDING];
  if (!db) return json({ error: "저장소가 연결되지 않았어요." }, 503);
  try {
    await ensureSchema(db);
    await ensureAgentSchema(db);
    const found = givenPrincipal || await principalFromToken(db, bearerToken(request));
    if (!found) return agentChallenge(request);
    const target = /^\/api\/v1\/(?:pages|databases)\/([^/]+)/.exec(url.pathname);
    let targetSlug = null;
    if (target) { try { targetSlug = resolveSlug(decodeURIComponent(target[1])); } catch { targetSlug = null; } }
    const principal = await narrowAgent(db, found, targetSlug);
    await syncIfStale(db, env, request);
    for (const hook of ACARD_FEATURES.agentApi) {
      const response = await hook({ ...featureContext(request, env, db, url), principal, storeImage: (page, name, mime, bytes, source) => storeAgentImage(env, db, page, name, mime, bytes, source),
        run: (operation, input) => acardHost.run(env, principal, operation, input) });
      if (response instanceof Response) return response;
    }
    return await handleAgentV1(request, db, url.pathname.slice(AGENT_API.length) || "/", principal, agentHelpers(env));
  } catch (error) {
    if (error instanceof AgentError) return json({ error: error.message }, error.status);
    return json({ error: String(error && error.message ? error.message : error) }, 500);
  }
}

// 번들 입구(gate/agent-entry.ts)가 쓰는 작은 접점. 인증은 입구가 끝낸 뒤에만 불린다.
export const acardHost = {
  get mcpTools() { return ACARD_FEATURES.services.mcpTools || []; },
  async prepare(env) {
    const db = env[DB_BINDING];
    if (!db) throw new AgentError("저장소가 연결되지 않았어요.", 503);
    await ensureSchema(db);
    await ensureAgentSchema(db);
    return db;
  },
  async principalFromToken(env, token) {
    return principalFromToken(await this.prepare(env), token);
  },
  async run(env, given, operation, input) {
    const db = await this.prepare(env);
    const value = input && (input.slug ?? input.page ?? input.database ?? input.parent);
    let slug = null;
    if (typeof value === "string" && value) { try { slug = resolveSlug(value); } catch { slug = null; } }
    const principal = await narrowAgent(db, given, slug);
    const core = Object.hasOwn(agentOps, operation);
    const op = core ? agentOps[operation] : ACARD_FEATURES.agentOps[operation];
    if (typeof op !== "function") throw new AgentError("없는 동작이에요.", 404);
    if (!core) {
      const tools = this.mcpTools.filter((tool) => tool.operation === operation);
      const scope = !tools.length || tools.some((tool) => tool.scope === "write") ? "write" : "read";
      if (!principal.scopes.includes(scope)) throw new AgentError("이 동작에 필요한 권한이 없어요.", 403);
    }
    return await op(db, principal, { ...agentHelpers(env), env, storeImage: (page, name, mime, bytes) => storeAgentImage(env, db, page, name, mime, bytes) }, input || {});
  },
  serveV1(request, env, principal) {
    return serveAgentApi(request, env, new URL(request.url), principal);
  },
  async agentStep(env, session) {
    const db = await this.prepare(env);
    if (!ACARD_FEATURES.services.agentStep) return { status: 404, done: true };
    return await ACARD_FEATURES.services.agentStep(env, db, session);
  },
  async hasHumanTicket(request, env) {
    return Boolean(env.GATE_SECRET) && await hasValidTicket(request, env.GATE_SECRET);
  },
  trust(env) {
    TRUSTED_ENVS.add(env);
    return env;
  },
  async tokenAdmin(env) {
    const db = await this.prepare(env);
    return {
      list: () => listAgentTokens(db),
      create: (input) => createAgentToken(db, input),
      revoke: (id) => revokeAgentToken(db, id),
      recordGrant: (grant) => recordAgentGrant(db, grant),
      listGrants: () => listAgentGrants(db),
      markGrantRevoked: (id) => markAgentGrantRevoked(db, id),
      grantRevoked: (id) => agentGrantRevoked(db, id),
    };
  },
  isAgentError(error) {
    return error instanceof AgentError;
  },
  challenge: (message, next, status) => challenge(message, next, status),
  escapeHtml: (text) => escapeHtml(text),
};

async function handleApi(request, env, db, url, dispatchFeatures = true) {
  const path = url.pathname.slice(API.length) || "/";
  const method = request.method.toUpperCase();
  if (dispatchFeatures && ACARD_FEATURES.api.length) {
    const ctx = featureContext(request, env, db, url);
    for (const hook of ACARD_FEATURES.api) {
      const response = await hook(ctx);
      if (response !== null) return response;
    }
  }
  // 휴지통 비우기 (#12): every page still in the trash goes through the same permanent delete (media, sharing included).
  if (path === "/editor/trash/empty" && method === "POST") {
    await ensureEditorSchema(db);
    const rows = await db.prepare("SELECT page FROM editor_trash WHERE permanent = 0").all();
    let deleted = 0;
    for (const row of rows.results ?? []) {
      if (!(await db.prepare("SELECT page FROM editor_trash WHERE page = ? AND permanent = 0").bind(row.page).first())) continue;
      const target = new URL(API + "/page/" + encodeURIComponent(row.page) + "/permanent", url);
      const res = await handleApi(new Request(target, { method: "DELETE" }), env, db, target, dispatchFeatures);
      if (res.ok) deleted += 1;
    }
    return json({ ok: true, deleted });
  }
  const permanent = method === "DELETE" && /^\/page\/([^/]+)\/permanent\/?$/.exec(path);
  // #13: a folder trashed with its contents takes them along when it is deleted for good.
  let group = [];
  if (permanent && ACARD_FEATURES.services.trashGroup) { try { group = await ACARD_FEATURES.services.trashGroup(db, resolveSlug(decodeURIComponent(permanent[1]))); } catch {} }
  const lifecycle = await handleEditorApi(request, db, url, { json, readPage, saveBlocks, normaliseBlocks, slugify });
  if (lifecycle && permanent && lifecycle.ok && env[MEDIA_BINDING]) {
    let slug = null;
    try { slug = resolveSlug(decodeURIComponent(permanent[1])); } catch {}
    const rows = slug ? await db.prepare("SELECT id FROM media WHERE page = ?").bind(slug).all() : { results: [] };
    for (const row of rows.results ?? []) await env[MEDIA_BINDING].delete("media/" + row.id).catch(() => {});
    if (slug) await db.prepare("DELETE FROM media WHERE page = ?").bind(slug).run();
  }
  if (lifecycle && permanent && lifecycle.ok) for (const member of group) {
    const target = new URL(API + "/page/" + encodeURIComponent(member) + "/permanent", url);
    await handleApi(new Request(target, { method: "DELETE" }), env, db, target, dispatchFeatures);
  }
  if (lifecycle) return lifecycle;

  if (path === "/sync" && method === "POST") {
    if (isMember(env)) return json({ imported: 0, updated: 0, skipped: 0, databases: { imported: 0, rows: 0, skipped: 0 } });
    const notes = await syncSeed(db, env, request);
    return json(Object.assign({}, notes, { databases: await syncDbSeed(db, env, request) }));
  }

  if (path === "/upload" && method === "POST") {
    return await uploadMedia(request, env, db);
  }

  const mediaDelete = /^\/media\/([^/]+)\/?$/.exec(path);
  if (mediaDelete && method === "DELETE") {
    const store = env[MEDIA_BINDING];
    if (!store) return json({ error: "미디어 저장소가 연결되지 않았어요." }, 503);
    const id = mediaDelete[1];
    if (MEDIA_ID.test(id)) {
      await store.delete("media/" + id);
      await db.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
    }
    return json({ ok: true });
  }

  const attachments = /^\/page\/([^/]+)\/attachments\/?$/.exec(path);
  if (attachments && method === "GET") {
    let slug;
    try { slug = resolveSlug(decodeURIComponent(attachments[1])); } catch { return json({ error: "주소를 읽지 못했어요." }, 400); }
    const rows = await db.prepare("SELECT id, name, mime, bytes, created FROM media WHERE page = ? ORDER BY created DESC LIMIT 500").bind(slug).all();
    return json({ attachments: (rows.results ?? []).map((r) => ({ ...r, url: "/media/" + r.id })) });
  }

  if (path === "/media/import" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const src = String(body.url || "");
    if (!/^https?:\/\//i.test(src)) return json({ error: "http(s) 이미지 주소가 필요해요." }, 400);
    const probe = [{ type: "image", text: "", meta: { src } }];
    const page = body.page ? String(body.page).slice(0, 120) : null;
    const warnings = await ingestImages(env, db, page, probe);
    if (!/^\/media\//.test(probe[0].meta.src)) return json({ error: warnings[0] ? warnings[0].error : "이미지를 가져오지 못했어요." }, 422);
    return json({ ok: true, url: probe[0].meta.src });
  }

  if (path === "/link-preview" && method === "GET") {
    return await linkPreview(db, url.searchParams.get("url"));
  }

  // 노션 "Markdown & CSV" 내보내기 zip 을 그대로 받아 페이지와 데이터베이스로 만든다.
  if (path === "/import" && method === "POST") {
    return await importZip(request, db);
  }

  // 마크다운 파일 한 장(또는 여러 장)을 페이지로 만든다. 노션 zip 이 아닌 일반 마크다운도 받는다.
  if (path === "/import/md" && method === "POST") {
    return await importMarkdown(request, db);
  }

  // 페이지 하나 또는 워크스페이스 전체를 마크다운·HTML·zip 으로 내보낸다.
  if (path === "/export" && method === "GET") {
    return await exportPage(db, url);
  }

  if (path === "/tree" && method === "GET") {
    return json({ pages: await readTree(db) });
  }

  if (path === "/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json({ results: [] });
    if (ACARD_FEATURES.services.search) return json({ results: visibleOnly(db, await ACARD_FEATURES.services.search(db, q, db.acardVisible ? 400 : 40)).slice(0, 40) });
    const like = "%" + q.replace(/[%_]/g, "") + "%";
    const rows = await db
      .prepare("SELECT p.slug, p.title, (SELECT text FROM blocks b WHERE b.page = p.slug AND b.text LIKE ? LIMIT 1) AS hit FROM pages p WHERE NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page=p.slug) AND (p.title LIKE ? OR EXISTS (SELECT 1 FROM blocks b WHERE b.page = p.slug AND b.text LIKE ?)) ORDER BY p.ord LIMIT 40")
      .bind(like, like, like)
      .all();
    return json({ results: visibleOnly(db, rows.results ?? []) });
  }

  if (path === "/backlinks" && method === "GET") {
    const slug = url.searchParams.get("slug") ?? "";
    const rows = await db.prepare("SELECT l.src AS slug, p.title FROM links l JOIN pages p ON p.slug = l.src WHERE l.dst = ? AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page=p.slug) ORDER BY l.src").bind(slug).all();
    return json({ backlinks: visibleOnly(db, rows.results ?? []) });
  }

  if (path === "/pages" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const title = String(body.title ?? "").trim() || "새 페이지";
    const parent = body.parent ? String(body.parent) : null;
    const kind = body.kind === "db" ? "db" : "note";
    let slug = slugify(body.slug ?? title);
    const taken = await db.prepare("SELECT slug FROM pages WHERE slug = ? UNION ALL SELECT page AS slug FROM editor_trash WHERE page = ?").bind(slug, slug).first();
    if (taken) slug = slug + "-" + Math.random().toString(36).slice(2, 6);
    const maxRow = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM pages WHERE parent IS ?").bind(parent).first();
    const ord = Number(maxRow?.m ?? 0) + 10;
    const now = Date.now();
    await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, ?, ?, 'editor', NULL)")
      .bind(slug, title, parent, ord, kind, now).run();
    const initial = kind === "db"
      ? []
      : [{ id: "b1", type: "paragraph", text: "", checked: false, indent: 0, meta: null }];
    await saveBlocks(db, slug, normaliseBlocks(initial));
    if (kind === "db") {
      await createDatabase(db, {
        slug,
        title,
        parent,
        icon: typeof body.icon === "string" ? body.icon : "",
        properties: Array.isArray(body.properties) && body.properties.length ? body.properties : undefined,
      });
    }
    return json({ slug, title, parent, kind, ord, updated: now });
  }

  const pageMatch = /^\/page\/(.+)$/.exec(path);
  if (pageMatch) {
    const slug = resolveSlug(decodeURIComponent(pageMatch[1]));

    if (method === "GET") {
      const found = await readPage(db, slug);
      if (!found) return json({ error: "없는 페이지예요." }, 404);
      const backlinks = await db.prepare("SELECT l.src AS slug, p.title FROM links l JOIN pages p ON p.slug = l.src WHERE l.dst = ? AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page=p.slug) ORDER BY l.src").bind(slug).all();
      const payload = { page: found.page, blocks: found.blocks, settings: found.settings, backlinks: visibleOnly(db, backlinks.results ?? []) };
      if (db.acardRoles) payload.access = db.acardRoles.get(slug) || "none";
      if (found.page.kind === "db") {
        const database = await db.prepare("SELECT id, slug, title, icon, parent, ord, created, updated FROM databases WHERE slug = ?").bind(slug).first();
        if (database) {
          const dbFound = await readDatabaseById(db, database, 0);
          payload.database = dbFound;
        }
      }
      if (found.page.kind === "db_row") {
        const row = await db.prepare("SELECT id, database_id FROM db_rows WHERE page = ?").bind(slug).first();
        if (row) {
          const database = await db.prepare("SELECT id, slug, title, icon, parent, ord, created, updated FROM databases WHERE id = ?").bind(row.database_id).first();
          if (database && (!db.acardVisible || db.acardVisible.has(String(database.slug)))) {
            const dbFound = await readDatabaseById(db, database, 0);
            payload.database = dbFound;
            payload.dbRow = row.id;
          }
        }
      }
      return json(payload);
    }

    if (method === "PUT") {
      if (await db.prepare("SELECT page FROM editor_trash WHERE page = ?").bind(slug).first()) return json({ error: "휴지통에 있는 페이지예요." }, 404);
      const existing = await db.prepare("SELECT slug FROM pages WHERE slug = ?").bind(slug).first();
      if (!existing) return json({ error: "없는 페이지예요." }, 404);
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.blocks)) return json({ error: "블록 목록이 필요해요." }, 400);
      const blocks = normaliseBlocks(body.blocks);
      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
      const now = Date.now();
      await captureEditorVersion(db, slug);
      await db.prepare("UPDATE pages SET updated = ?, source = 'editor', hash = NULL" + (title ? ", title = ?" : "") + " WHERE slug = ?")
        .bind(...(title ? [now, title, slug] : [now, slug])).run();
      await saveBlocks(db, slug, blocks);
      if (title) await syncPageTitleToRow(db, slug, title);
      return json({ ok: true, updated: now, blocks: blocks.length });
    }

    if (method === "DELETE") {
      const trashUrl = new URL("/api/page/" + encodeURIComponent(slug) + "/trash", url);
      return handleEditorApi(new Request(trashUrl, { method: "POST" }), db, trashUrl, { json, slugify });
    }

    const action = /^\/page\/(.+?)\/(rename|move)$/.exec(path);
    if (action && method === "POST") {
      const target = resolveSlug(decodeURIComponent(action[1]));
      if (!(await readPage(db, target))) return json({ error: "없는 페이지예요." }, 404);
      const body = await request.json().catch(() => ({}));
      if (action[2] === "rename") {
        const title = String(body.title ?? "").trim();
        if (!title) return json({ error: "제목이 비었어요." }, 400);
        await captureEditorVersion(db, target);
        await db.prepare("UPDATE pages SET title = ?, updated = ?, source = 'editor' WHERE slug = ?").bind(title.slice(0, 200), Date.now(), target).run();
        await syncPageTitleToRow(db, target, title);
        return json({ ok: true });
      }
      const parent = body.parent ? String(body.parent) : null;
      if (parent === target) return json({ error: "자기 아래로는 옮길 수 없어요." }, 400);
      for (let up = parent, seen = new Set(); up; ) {
        if (up === target || seen.has(up)) return json({ error: "자기 하위 페이지 안으로는 옮길 수 없어요." }, 400);
        seen.add(up);
        up = (await db.prepare("SELECT parent FROM pages WHERE slug = ?").bind(up).first())?.parent ?? null;
      }
      if (ACARD_FEATURES.services.shareMoveCheck) {
        const warning = await ACARD_FEATURES.services.shareMoveCheck(db, target, parent, body.confirmShare === true);
        if (warning) return warning;
      }
      const ord = Number.isFinite(body.ord) ? Math.trunc(body.ord) : Date.now() % 100000;
      await captureEditorVersion(db, target);
      await db.prepare("UPDATE pages SET parent = ?, ord = ?, updated = ?, source = 'editor' WHERE slug = ?").bind(parent, ord, Date.now(), target).run();
      return json({ ok: true });
    }
  }

  if (path === "/db" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const created = await createDatabase(db, body);
    if (body.page) {
      const maxRow = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM pages WHERE parent IS ?").bind(body.parent ? String(body.parent) : null).first();
      const now = Date.now();
      await db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'db', ?, 'editor', NULL) ON CONFLICT(slug) DO NOTHING")
        .bind(created.slug, created.title, created.parent, Number(maxRow && maxRow.m ? maxRow.m : 0) + 10, now).run();
    }
    return json(created);
  }

  if (path === "/db/list" && method === "GET") {
    const rows = await db.prepare("SELECT slug, title, icon FROM databases ORDER BY title").all();
    return json({ databases: visibleOnly(db, rows.results ?? []) });
  }

  const dbMatch = /^\/db\/([^/]+)(?:\/.*)?$/.exec(path);
  if (dbMatch) {
    const slug = decodeURIComponent(dbMatch[1]);
    const database = await db.prepare("SELECT id, slug, title, icon, parent, ord, created, updated FROM databases WHERE slug = ?").bind(slug).first();
    if (!database) return json({ error: "없는 데이터베이스예요." }, 404);

    if (method === "GET" && path === "/db/" + dbMatch[1]) {
      const found = await readDatabaseById(db, database, 0);
      return json({
        database: found.database,
        properties: found.properties,
        rows: found.rows.map((row) => ({ id: row.id, ord: row.ord, page: row.page, pageTitle: row.pageTitle, props: row.props, computed: row.computed || {}, created: row.created, updated: row.updated })),
        views: found.views,
        templates: found.templates,
      });
    }

    if (method === "PATCH" && path === "/db/" + dbMatch[1]) {
      const body = await request.json().catch(() => ({}));
      const fields = [];
      const binds = [];
      if (typeof body.title === "string") { fields.push("title = ?"); binds.push(body.title.trim().slice(0, 200) || "제목 없음"); }
      if (typeof body.icon === "string") { fields.push("icon = ?"); binds.push(body.icon.slice(0, 8)); }
      if (body.parent !== undefined) { fields.push("parent = ?"); binds.push(body.parent ? String(body.parent) : null); }
      if (!fields.length) return json({ error: "바꿀 것이 없어요." }, 400);
      fields.push("updated = ?");
      binds.push(Date.now(), database.id);
      await db.prepare("UPDATE databases SET " + fields.join(", ") + " WHERE id = ?").bind(...binds).run();
      if (typeof body.title === "string") await db.prepare("UPDATE pages SET title = ?, updated = ? WHERE slug = ? AND kind = 'db'").bind(body.title.trim().slice(0, 200) || "제목 없음", Date.now(), database.slug).run();
      return json({ ok: true });
    }

    if (method === "DELETE" && path === "/db/" + dbMatch[1]) {
      await db.batch([
        db.prepare("DELETE FROM blocks WHERE page IN (SELECT page FROM db_rows WHERE database_id = ? AND page IS NOT NULL)").bind(database.id),
        db.prepare("DELETE FROM links WHERE src IN (SELECT page FROM db_rows WHERE database_id = ? AND page IS NOT NULL)").bind(database.id),
        db.prepare("DELETE FROM pages WHERE kind = 'db_row' AND slug IN (SELECT page FROM db_rows WHERE database_id = ? AND page IS NOT NULL)").bind(database.id),
        db.prepare("DELETE FROM db_rows WHERE database_id = ?").bind(database.id),
        db.prepare("DELETE FROM db_properties WHERE database_id = ?").bind(database.id),
        db.prepare("DELETE FROM db_views WHERE database_id = ?").bind(database.id),
        db.prepare("DELETE FROM db_templates WHERE database_id = ?").bind(database.id),
        db.prepare("DELETE FROM databases WHERE id = ?").bind(database.id),
      ]);
      return json({ ok: true });
    }

    const rest = path.slice(("/db/" + dbMatch[1]).length);
    const sub = /^\/(properties|rows|views|templates)(?:\/([^/]+))?$/.exec(rest);
    if (!sub) return json({ error: "없는 API예요." }, 404);
    const kind = sub[1];
    const target = sub[2] ? decodeURIComponent(sub[2]) : null;
    const ordering = target === "order" && method === "POST";
    const body = method === "GET" ? {} : await request.json().catch(() => ({}));

    if (kind === "properties") {
      const propRows = await db.prepare("SELECT id, name, type, config, ord, width, hidden FROM db_properties WHERE database_id = ? ORDER BY ord, name").bind(database.id).all();
      const properties = (propRows.results ?? []).map((row, index) => normaliseProperty({
        id: row.id, name: row.name, type: row.type, config: parseJson(row.config, {}), ord: row.ord, width: row.width, hidden: row.hidden === 1,
      }, index));

      if (!target && method === "POST") {
        const prop = normaliseProperty(Object.assign({}, body, { id: scopedId(database.id, typeof body.id === "string" && body.id ? body.id : dbId("p")) }), properties.length);
        prop.ord = Number.isFinite(body.ord) ? Math.trunc(body.ord) : (properties.length ? Math.max(...properties.map((entry) => entry.ord)) + 10 : 10);
        if (await db.prepare("SELECT 1 AS x FROM db_properties WHERE id = ?").bind(prop.id).first()) prop.id = scopedId(database.id, dbId("p"));
        await db.prepare("INSERT INTO db_properties (id, database_id, name, type, config, ord, width, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(prop.id, database.id, prop.name, prop.type, JSON.stringify(prop.config), prop.ord, prop.width, prop.hidden ? 1 : 0).run();
        return json({ property: prop });
      }

      if (target && method === "PATCH") {
        const current = properties.find((entry) => entry.id === target);
        if (!current) return json({ error: "없는 속성이에요." }, 404);
        const next = normaliseProperty({
          id: current.id,
          name: typeof body.name === "string" ? body.name : current.name,
          type: typeof body.type === "string" ? body.type : current.type,
          config: body.config !== undefined ? body.config : current.config,
          ord: Number.isFinite(body.ord) ? body.ord : current.ord,
          width: Number.isFinite(body.width) ? body.width : current.width,
          hidden: body.hidden !== undefined ? body.hidden === true : current.hidden,
        }, 0);
        await db.prepare("UPDATE db_properties SET name = ?, type = ?, config = ?, ord = ?, width = ?, hidden = ? WHERE id = ?")
          .bind(next.name, next.type, JSON.stringify(next.config), next.ord, next.width, next.hidden ? 1 : 0, current.id).run();
        if (next.type !== current.type) {
          const rows = await db.prepare("SELECT id, props FROM db_rows WHERE database_id = ?").bind(database.id).all();
          const list = properties.map((entry) => (entry.id === current.id ? next : entry));
          const statements = [];
          for (const row of rows.results ?? []) {
            const parsed = normaliseRow({ id: row.id, props: parseJson(row.props, {}) }, list, 0);
            statements.push(db.prepare("UPDATE db_rows SET props = ?, updated = ? WHERE id = ?").bind(JSON.stringify(parsed.props), Date.now(), row.id));
          }
          if (statements.length) await db.batch(statements);
        }
        return json({ property: next });
      }

      if (target && method === "DELETE") {
        if (properties.length <= 1) return json({ error: "마지막 속성은 지울 수 없어요." }, 400);
        await db.prepare("DELETE FROM db_properties WHERE id = ? AND database_id = ?").bind(target, database.id).run();
        return json({ ok: true });
      }

      if (ordering) {
        const order = Array.isArray(body.order) ? body.order : [];
        const statements = order.map((id, index) => db.prepare("UPDATE db_properties SET ord = ? WHERE id = ? AND database_id = ?").bind((index + 1) * 10, String(id), database.id));
        if (statements.length) await db.batch(statements);
        return json({ ok: true });
      }
      return json({ error: "없는 API예요." }, 404);
    }

    if (kind === "rows") {
      if (!target && method === "POST") {
        const props = body.props && typeof body.props === "object" ? body.props : {};
        let template = null;
        if (body.template) {
          const found = await db.prepare("SELECT id, name, icon, props, blocks FROM db_templates WHERE id = ? AND database_id = ?").bind(String(body.template), database.id).first();
          if (found) template = { props: parseJson(found.props, {}), blocks: parseJson(found.blocks, []), name: found.name };
        }
        const merged = Object.assign({}, template ? template.props : {}, props);
        const propRows = await db.prepare("SELECT id, name, type, config, ord, width, hidden FROM db_properties WHERE database_id = ? ORDER BY ord, name").bind(database.id).all();
        const properties = (propRows.results ?? []).map((row, index) => normaliseProperty({ id: row.id, name: row.name, type: row.type, config: parseJson(row.config, {}), ord: row.ord, width: row.width, hidden: row.hidden === 1 }, index));
        if (!validBoardProgress(database, properties, merged)) return json({ error: "진행률은 0부터 100까지의 숫자로 입력해 주세요." }, 400);
        const titleProp = properties.find((prop) => prop.type === "title");
        const maxRow = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM db_rows WHERE database_id = ?").bind(database.id).first();
        const now = Date.now();
        const id = scopedId(database.id, dbId("r"));
        const normalised = {};
        properties.forEach((prop) => {
          const incoming = merged[prop.id] !== undefined ? merged[prop.id] : merged[prop.name];
          normalised[prop.id] = incoming === undefined ? emptyValue(prop) : normaliseCellValue(prop, incoming);
        });
        for (const hook of ACARD_FEATURES.beforeRowWrite) await hook({ db, database, properties, before: null, props: normalised });
        const title = titleProp ? String(normalised[titleProp.id] || "") : "";
        const pageSlug = await createRowPage(db, database, title || "새 행", template ? template.blocks : []);
        await db.prepare("INSERT INTO db_rows (id, database_id, page, props, ord, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, database.id, pageSlug, JSON.stringify(normalised), Number(maxRow && maxRow.m ? maxRow.m : 0) + 10, now, now).run();
        return json({ row: { id, page: pageSlug, ord: Number(maxRow && maxRow.m ? maxRow.m : 0) + 10, props: normalised, created: now, updated: now } });
      }

      if (target && method === "PATCH") {
        const row = await db.prepare("SELECT id, page, props FROM db_rows WHERE id = ? AND database_id = ?").bind(target, database.id).first();
        if (!row) return json({ error: "없는 행이에요." }, 404);
        if (body.props && typeof body.props === "object") {
          const propRows = await db.prepare("SELECT id, name, type, config, ord, width, hidden FROM db_properties WHERE database_id = ? ORDER BY ord, name").bind(database.id).all();
          const properties = (propRows.results ?? []).map((entry, index) => normaliseProperty({ id: entry.id, name: entry.name, type: entry.type, config: parseJson(entry.config, {}), ord: entry.ord, width: entry.width, hidden: entry.hidden === 1 }, index));
          if (!validBoardProgress(database, properties, body.props)) return json({ error: "진행률은 0부터 100까지의 숫자로 입력해 주세요." }, 400);
          const merged = await saveRowProps(db, target, body.props, properties, database);
          const titleProp = properties.find((prop) => prop.type === "title");
          const touchesTitle = titleProp && (Object.prototype.hasOwnProperty.call(body.props, titleProp.id) || Object.prototype.hasOwnProperty.call(body.props, titleProp.name) || merged[titleProp.id] !== parseJson(row.props, {})[titleProp.id]);
          if (touchesTitle) await syncRowPageTitle(db, target, merged[titleProp.id]);
        }
        if (Number.isFinite(body.ord)) await db.prepare("UPDATE db_rows SET ord = ? WHERE id = ?").bind(Math.trunc(body.ord), target).run();
        return json({ ok: true });
      }

      if (target && method === "DELETE") {
        const row = await db.prepare("SELECT page FROM db_rows WHERE id = ? AND database_id = ?").bind(target, database.id).first();
        const statements = [db.prepare("DELETE FROM db_rows WHERE id = ? AND database_id = ?").bind(target, database.id)];
        if (row && row.page) {
          statements.push(db.prepare("DELETE FROM blocks WHERE page = ?").bind(row.page));
          statements.push(db.prepare("DELETE FROM links WHERE src = ? OR dst = ?").bind(row.page, row.page));
          statements.push(db.prepare("DELETE FROM pages WHERE slug = ? AND kind = 'db_row'").bind(row.page));
        }
        await db.batch(statements);
        return json({ ok: true });
      }
      return json({ error: "없는 API예요." }, 404);
    }

    if (kind === "views") {
      if (!target && method === "POST") {
        const view = normaliseView(Object.assign({}, body, { id: scopedId(database.id, typeof body.id === "string" && body.id ? body.id : dbId("v")) }), 0);
        if (await db.prepare("SELECT 1 AS x FROM db_views WHERE id = ?").bind(view.id).first()) view.id = scopedId(database.id, dbId("v"));
        const maxRow = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM db_views WHERE database_id = ?").bind(database.id).first();
        view.ord = Number(maxRow && maxRow.m ? maxRow.m : 0) + 10;
        await db.prepare("INSERT INTO db_views (id, database_id, name, type, config, ord) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(view.id, database.id, view.name, view.type, JSON.stringify(view.config), view.ord).run();
        return json({ view });
      }
      if (target && method === "PATCH") {
        const current = await db.prepare("SELECT id, name, type, config, ord FROM db_views WHERE id = ? AND database_id = ?").bind(target, database.id).first();
        if (!current) return json({ error: "없는 뷰예요." }, 404);
        const next = normaliseView({
          id: current.id,
          name: typeof body.name === "string" ? body.name : current.name,
          type: typeof body.type === "string" ? body.type : current.type,
          config: body.config !== undefined ? body.config : parseJson(current.config, {}),
          ord: Number.isFinite(body.ord) ? body.ord : current.ord,
        }, 0);
        await db.prepare("UPDATE db_views SET name = ?, type = ?, config = ?, ord = ? WHERE id = ?")
          .bind(next.name, next.type, JSON.stringify(next.config), next.ord, current.id).run();
        return json({ view: next });
      }
      if (target && method === "DELETE") {
        const count = await db.prepare("SELECT COUNT(*) AS c FROM db_views WHERE database_id = ?").bind(database.id).first();
        if (count && Number(count.c) <= 1) return json({ error: "마지막 뷰는 지울 수 없어요." }, 400);
        await db.prepare("DELETE FROM db_views WHERE id = ? AND database_id = ?").bind(target, database.id).run();
        return json({ ok: true });
      }
      return json({ error: "없는 API예요." }, 404);
    }

    if (kind === "templates") {
      if (!target && method === "POST") {
        const template = normaliseTemplate(Object.assign({}, body, { id: scopedId(database.id, typeof body.id === "string" && body.id ? body.id : dbId("t")) }), 0);
        if (await db.prepare("SELECT 1 AS x FROM db_templates WHERE id = ?").bind(template.id).first()) template.id = scopedId(database.id, dbId("t"));
        const maxRow = await db.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM db_templates WHERE database_id = ?").bind(database.id).first();
        template.ord = Number(maxRow && maxRow.m ? maxRow.m : 0) + 10;
        await db.prepare("INSERT INTO db_templates (id, database_id, name, icon, props, blocks, ord) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(template.id, database.id, template.name, template.icon, JSON.stringify(template.props), JSON.stringify(template.blocks), template.ord).run();
        return json({ template });
      }
      if (target && method === "DELETE") {
        await db.prepare("DELETE FROM db_templates WHERE id = ? AND database_id = ?").bind(target, database.id).run();
        return json({ ok: true });
      }
      return json({ error: "없는 API예요." }, 404);
    }
  }

  return json({ error: "없는 API예요." }, 404);
}
