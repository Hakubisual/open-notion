// Acard local mode (Windows build). Runs the same core worker as the hosted site (.build/acard-core.js, made by build.ts)
// inside Bun. The workspace store, media KV and static assets are local shims with the same contracts as the
// Cloudflare bindings (workers/acard-workspace WorkspaceStore, KV, ASSETS). Only scripts/build-windows.ts imports this
// file, so the cloud build never includes it.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join, normalize, resolve as resolvePath, sep } from "node:path";
import core, { acardHost } from "../.build/acard-core.js";
import { workspaceEnv } from "../gate/tenancy";
import { isLang, type Lang } from "../gate/i18n";
import { licenseRoute } from "./edition";

const LOCAL_WS = "00000000000000000000000000000001";
const CLOUD_ONLY = "This feature needs the hosted service and is not available on a self-hosted server.";

// host: listen address (default 127.0.0.1). allowedHosts: extra Host names (LAN IP, DNS name) or "*".
// password: when set, every page needs a login (/__local/login). Required whenever host is not loopback.
// lang: UI language for app pages (en / ko / zh). Unset keeps the Korean source copy.
export type LocalOptions = { dataDir: string; appDir: string; port: number; host?: string; allowedHosts?: string[]; password?: string; lang?: string };

function clean(params: unknown[] = []) {
  return params.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v)) as any[];
}

// Same behaviour as WorkspaceStore (workers/acard-workspace/index.js) minus the cloud write quota.
function workspaceStore(db: Database) {
  const run = (sql: string, params: unknown[], mode: string) => {
    const rows = db.query(sql).all(...clean(params));
    if (mode === "all") return { results: rows, success: true, meta: {} };
    if (mode === "first") return rows[0] ?? null;
    const changes = Number((db.query("SELECT changes() AS c").get() as { c: number }).c);
    return { results: rows, success: true, meta: { changes } };
  };
  const hits = new Map<string, { window: number; n: number }>();
  return {
    exec: async (sql: string, params: unknown[], mode: string) => run(sql, params, mode),
    batch: async (list: { sql: string; params: unknown[] }[]) => db.transaction(() => list.map((item) => run(item.sql, item.params, "run")))(),
    // Several statements in one call (gate/tenancy.ts d1Adapter); each reports its own result like WorkspaceStore.pipe.
    pipe: async (items: { sql?: string; params?: unknown[]; mode?: string; batch?: { sql: string; params: unknown[] }[] }[]) => items.map((item) => {
      try {
        const value = item.batch
          ? db.transaction(() => item.batch!.map((s) => run(s.sql, s.params, "run")))()
          : run(item.sql!, item.params ?? [], item.mode ?? "run");
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
    stats: async () => ({ pages: Number((db.query("SELECT count(*) AS n FROM pages").get() as any)?.n ?? 0) }),
    wipe: async () => ({ ok: false }),
    hit: async (key: string, limit: number, period: number) => {
      const window = Math.floor(Date.now() / (period * 1000));
      const entry = hits.get(key);
      if (!entry || entry.window !== window) hits.set(key, { window, n: 1 });
      else entry.n += 1;
      return (hits.get(key)?.n ?? 0) <= limit;
    },
  };
}

// Workers KV subset the app uses (get with type, getWithMetadata, put with metadata/expirationTtl, delete, list).
function sqliteKv(db: Database) {
  db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, metadata TEXT, expires INTEGER)");
  const live = (row: any) => row && (!row.expires || row.expires > Date.now()) ? row : null;
  const decode = (bytes: Uint8Array, type: string) => {
    if (type === "arrayBuffer") return bytes.slice().buffer;
    if (type === "stream") return new Blob([bytes.slice()]).stream();
    const text = new TextDecoder().decode(bytes);
    return type === "json" ? JSON.parse(text) : text;
  };
  const typeOf = (options: any) => (typeof options === "string" ? options : options?.type) ?? "text";
  const read = (key: string) => live(db.query("SELECT value, metadata, expires FROM kv WHERE key = ?").get(key));
  return {
    async get(key: string, options?: any) {
      const row = read(key);
      return row ? decode(row.value, typeOf(options)) : null;
    },
    async getWithMetadata(key: string, options?: any) {
      const row = read(key);
      return row ? { value: decode(row.value, typeOf(options)), metadata: row.metadata ? JSON.parse(row.metadata) : null } : { value: null, metadata: null };
    },
    async put(key: string, value: any, options?: any) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value)
        : value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer())
        : new Uint8Array(value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      const expires = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : options?.expiration ? options.expiration * 1000 : null;
      db.query("INSERT OR REPLACE INTO kv (key, value, metadata, expires) VALUES (?, ?, ?, ?)").run(key, bytes, options?.metadata ? JSON.stringify(options.metadata) : null, expires);
    },
    async delete(key: string) { db.query("DELETE FROM kv WHERE key = ?").run(key); },
    async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
      const prefix = options.prefix ?? "";
      const limit = Math.min(options.limit ?? 1000, 1000);
      const after = options.cursor ?? "";
      const rows = db.query("SELECT key FROM kv WHERE key >= ? AND key < ? AND key > ? AND (expires IS NULL OR expires > ?) ORDER BY key LIMIT ?")
        .all(prefix, prefix + "\uffff", after, Date.now(), limit + 1) as { key: string }[];
      const page = rows.slice(0, limit);
      const more = rows.length > limit;
      return { keys: page.map((r) => ({ name: r.key })), list_complete: !more, ...(more ? { cursor: page[page.length - 1].key } : {}) };
    },
  };
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", txt: "text/plain; charset=utf-8", woff2: "font/woff2", tgz: "application/gzip",
};

// Cloudflare Pages asset rules the app relies on: /x serves x.html, /dir/ serves dir/index.html, unknown -> 404.
function folderAssets(appDir: string) {
  // join() returns native separators, so the root must be normalized too or "C:/app/dist" rejects every file.
  const root = resolvePath(appDir);
  const resolve = async (pathname: string) => {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, "");
    const base = join(root, rel);
    if (base !== root && !base.startsWith(root + sep)) return null;
    for (const candidate of [base, base + ".html", join(base, "index.html")]) {
      const file = Bun.file(candidate);
      if (await file.exists() && !(candidate.endsWith(sep))) return file;
    }
    return null;
  };
  return {
    async fetch(request: Request) {
      const file = await resolve(new URL(request.url).pathname).catch(() => null);
      if (!file) return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
      const ext = (file.name ?? "").split(".").pop()!.toLowerCase();
      const body = request.method === "HEAD" ? null : file;
      return new Response(body, { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", etag: '"' + file.size + "-" + file.lastModified + '"' } });
    },
  };
}

export function localEnv({ dataDir, appDir }: LocalOptions) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "acard.sqlite"), { create: true });
  db.run("PRAGMA journal_mode = WAL");
  const kvDb = new Database(join(dataDir, "media.sqlite"), { create: true });
  kvDb.run("PRAGMA journal_mode = WAL");
  const store = workspaceStore(db);
  const base = {
    ASSETS: folderAssets(appDir),
    MEDIA: sqliteKv(kvDb),
    WORKSPACE: { idFromName: (name: string) => name, get: () => store },
    AI: { run: async () => { throw new Error(CLOUD_ONLY); } },
    ACARD_LOCAL: "1",
  };
  const env = acardHost.trust(workspaceEnv(base as any, LOCAL_WS));
  return { env, assets: base.ASSETS, close: () => { db.close(); kvDb.close(); } };
}

// DNS-rebinding and cross-site protection: only this PC's loopback names (plus configured LAN names), and same-origin writes.
export function guard(request: Request, port: number, extraHosts: string[] = []): Response | null {
  const allowed = new Set(["127.0.0.1:" + port, "localhost:" + port]);
  for (const name of extraHosts) allowed.add((name.includes(":") ? name : name + ":" + port).toLowerCase());
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (extraHosts.includes("*") && host) allowed.add(host);
  if (!allowed.has(host)) return new Response("Address not allowed.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = request.headers.get("origin");
    if (origin && !allowed.has(origin.replace(/^https?:\/\//, "").toLowerCase())) {
      return new Response(JSON.stringify({ error: "Requests from other sites are not accepted." }), { status: 403, headers: { "content-type": "application/json; charset=utf-8" } });
    }
  }
  return null;
}

// Cloud-only surfaces (accounts, Google login, OAuth/MCP, agent runner) live in gate/agent-entry.ts, which local mode
// does not load. Their paths answer with one clear message instead of a broken page.
const CLOUD_PATHS = /^\/(?:login|signup|forgot|reset|onboarding|oauth\/|mcp|sse|api\/account|api\/agents|settings\/agents|\.well-known\/)/;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const SESSION_COOKIE = "acard_session";
const SESSION_DAYS = 30;

// Password login for LAN mode. The cookie is "<expiry>.<hmac(secret, expiry)>"; the secret lives in the data folder,
// so changing the password or deleting session-secret signs everyone out.
export function passwordGate(dataDir: string, password: string) {
  const file = join(dataDir, "session-secret");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"));
  const secret = readFileSync(file, "utf8").trim() + "\0" + password;
  const sign = (expiry: string) => createHmac("sha256", secret).update(expiry).digest("hex");
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const valid = (request: Request) => {
    const raw = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(SESSION_COOKIE + "="));
    const [expiry, mac] = (raw?.slice(SESSION_COOKIE.length + 1) ?? "").split(".");
    return !!expiry && !!mac && Number(expiry) > Date.now() && same(mac, sign(expiry));
  };
  const secure = (request: Request) => new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const page = (error = "", next = "/") => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>'
    + '<style>body{font-family:system-ui,sans-serif;background:#f6f6f4;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 12px #0001;width:min(340px,86vw)}h1{font-size:20px;margin:0 0 16px}input{width:100%;box-sizing:border-box;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px}button{margin-top:14px;width:100%;padding:10px;font-size:15px;border:0;border-radius:8px;background:#222;color:#fff;cursor:pointer}p{color:#b00020;font-size:14px}</style>'
    + '<form method="post" action="/__local/login"><h1>Sign in to your notes</h1>' + (error ? "<p>" + error + "</p>" : "")
    + '<input type="hidden" name="next" value="' + next.replace(/["<>&]/g, "") + '"><input type="password" name="password" placeholder="Server password" autofocus required><button>Sign in</button></form>',
    { status: error ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
  return async function gate(request: Request, url: URL): Promise<Response | null> {
    if (url.pathname === "/__local/health") return null;
    if (url.pathname === "/__local/login") {
      if (request.method !== "POST") return page("", url.searchParams.get("next") || "/");
      const form = await request.formData().catch(() => null);
      const given = String(form?.get("password") ?? "");
      const next = String(form?.get("next") ?? "/");
      const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      if (!same(createHmac("sha256", "pw").update(given).digest("hex"), createHmac("sha256", "pw").update(password).digest("hex"))) return page("Wrong password.", target);
      const expiry = String(Date.now() + SESSION_DAYS * 86400_000);
      const cookie = SESSION_COOKIE + "=" + expiry + "." + sign(expiry) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86400 + (secure(request) ? "; Secure" : "");
      return new Response(null, { status: 303, headers: { location: target, "set-cookie": cookie } });
    }
    if (url.pathname === "/__local/logout") {
      return new Response(null, { status: 303, headers: { location: "/__local/login", "set-cookie": SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" } });
    }
    if (valid(request)) return null;
    const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
    return wantsHtml
      ? new Response(null, { status: 303, headers: { location: "/__local/login?next=" + encodeURIComponent(url.pathname + url.search) } })
      : new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
  };
}

const HTML_LANG: Record<Lang, string> = { en: "en", ko: "ko", zh: "zh-CN" };

// Same result as gate/i18n.ts injectAppLang (html lang + the app dictionary loader), done on the buffered page:
// a streamed HTMLRewriter body is cut off when Bun.serve sends it.
export async function withLang(response: Response, lang: Lang): Promise<Response> {
  if (lang === "ko" || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const html = (await response.text())
    .replace(/<html\b([^>]*?)\blang="[^"]*"/i, '<html$1lang="' + HTML_LANG[lang] + '"')
    .replace(/<head([^>]*)>/i, '<head$1><script>window.ACARD_LANG=' + JSON.stringify(lang) + '</script><script src="/i18n-app.js"></script>');
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-language", HTML_LANG[lang]);
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export function startServer(options: LocalOptions) {
  const host = options.host || "127.0.0.1";
  if (!LOOPBACK.has(host) && !options.password) throw new Error("Listening on " + host + " needs a password (ACARD_PASSWORD).");
  const { env, assets, close } = localEnv(options);
  const gate = options.password ? passwordGate(options.dataDir, options.password) : null;
  const lang: Lang | null = isLang(options.lang) ? options.lang : null;
  const server = Bun.serve({
    hostname: host,
    port: options.port,
    idleTimeout: 120,
    async fetch(request) {
      const blocked = guard(request, options.port, options.allowedHosts);
      if (blocked) return blocked;
      const url = new URL(request.url);
      const locked = gate ? await gate(request, url) : null;
      if (locked) return locked;
      if (CLOUD_PATHS.test(url.pathname)) {
        const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
        return wantsHtml
          ? new Response('<!doctype html><meta charset="utf-8"><title>Not available</title><body style="font-family:sans-serif;padding:40px"><h1>Hosted-only feature</h1><p>' + CLOUD_ONLY + '</p><p><a href="/">Back to my pages</a></p>', { status: 404, headers: { "content-type": "text/html; charset=utf-8" } })
          : new Response(JSON.stringify({ error: CLOUD_ONLY }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
      }
      if (url.pathname === "/__local/health") return new Response("acard-local ok");
      if (url.pathname.startsWith("/__local/license")) return licenseRoute(request, options.dataDir);
      // The hosted entry serves the app dictionaries; local mode skips that entry, so answer them here.
      if (/^\/i18n\/app-(?:en|zh)\.json$/.test(url.pathname)) return assets.fetch(request);
      try {
        const response = await core.fetch(request, env);
        return lang ? await withLang(response, lang) : response;
      } catch (error) {
        console.error("acard local request failed", error);
        return new Response("Something went wrong.", { status: 500 });
      }
    },
  });
  return { server, close: () => { server.stop(true); close(); } };
}
