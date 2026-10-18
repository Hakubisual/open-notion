// Single place that decides which data a request may touch.
// Owner workspace = the original D1 + KV + build assets. Any other signed-in account gets an env whose
// DB is its own Durable Object SQLite and whose MEDIA keys are prefixed, so app code cannot reach owner data.

export const OWNER_WS = "owner";

type Kv = {
  get(key: string, options?: unknown): Promise<unknown>;
  getWithMetadata(key: string, options?: unknown): Promise<{ value: unknown; metadata: unknown }>;
  put(key: string, value: unknown, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
};
type StoreStub = {
  exec(sql: string, params: unknown[], mode: string): Promise<any>;
  batch(list: { sql: string; params: unknown[] }[]): Promise<any[]>;
  wipe(): Promise<unknown>;
  stats(): Promise<Record<string, number>>;
  hit(key: string, limit: number, period: number): Promise<boolean>;
};
type StoreNamespace = { idFromName(name: string): unknown; get(id: unknown): StoreStub };
type Assets = { fetch(request: Request): Promise<Response> };

export type TenancyEnv = {
  readonly DB?: unknown;
  readonly MEDIA?: Kv;
  readonly ASSETS: Assets;
  readonly WORKSPACE?: StoreNamespace;
  readonly OWNER_USER_ID?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly ACARD_LIVE_TRACK?: <T>(ws: string, db: T) => T;
};

export function workspaceIdFor(userId: string, env: TenancyEnv): string {
  if (env.OWNER_USER_ID && userId === env.OWNER_USER_ID) return OWNER_WS;
  const hex = userId.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("bad user id");
  return hex;
}

export function storeFor(env: TenancyEnv, ws: string): StoreStub {
  if (!env.WORKSPACE) throw new Error("workspace store is not bound");
  if (ws === OWNER_WS || !/^[0-9a-f]{32}$/.test(ws)) throw new Error("not a member workspace");
  return env.WORKSPACE.get(env.WORKSPACE.idFromName("ws:" + ws));
}

export function d1Adapter(stub: StoreStub, key: string) {
  const statement = (sql: string, params: unknown[] = []): any => ({
    sql,
    params,
    bind: (...next: unknown[]) => statement(sql, next),
    run: () => stub.exec(sql, params, "run"),
    all: () => stub.exec(sql, params, "all"),
    first: async (column?: string) => {
      const row = await stub.exec(sql, params, "first");
      return column ? (row ? row[column] ?? null : null) : row;
    },
  });
  return {
    acardKey: key,
    prepare: (sql: string) => statement(sql),
    batch: (list: { sql: string; params: unknown[] }[]) => stub.batch(list.map((item) => ({ sql: item.sql, params: item.params }))),
  };
}

export function prefixedKv(kv: Kv, prefix: string): Kv {
  return {
    get: (key, options) => kv.get(prefix + key, options),
    getWithMetadata: (key, options) => kv.getWithMetadata(prefix + key, options),
    put: (key, value, options) => kv.put(prefix + key, value, options),
    delete: (key) => kv.delete(prefix + key),
    list: async (options = {}) => {
      const result = await kv.list({ ...options, prefix: prefix + (options.prefix ?? "") });
      return { ...result, keys: result.keys.map((entry) => ({ ...entry, name: entry.name.slice(prefix.length) })) };
    },
  };
}

// Build output also contains the owner's notes (page HTML, seeds, search index, covers, avatars).
// Other workspaces only get the app shell files.
const MEMBER_ASSET = /^\/(?:[\w.-]+\.(?:css|js|svg|png|ico|webmanifest)|templates-seed\.json|editor\.html|agents\.html|acard-cli\.tgz|lazy\/[\w.-]+\.(?:css|js)|_site\/[\w.-]+)$/;
const OWNER_ONLY_ROOT = new Set(["/notes-seed.json", "/db-seed.json", "/search-index.json", "/index.html", "/404.html"]);

export function memberAssetAllowed(pathname: string): boolean {
  return !OWNER_ONLY_ROOT.has(pathname) && MEMBER_ASSET.test(pathname);
}

export function memberAssets(assets: Assets): Assets {
  return {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (!memberAssetAllowed(path)) return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
      return assets.fetch(request);
    },
  };
}

export function mediaPrefix(ws: string): string {
  return "ws/" + ws + "/";
}

export function workspaceEnv<E extends TenancyEnv>(env: E, ws: string): E {
  if (ws === OWNER_WS) return { ...env, ACARD_SESSION: "owner", ACARD_WORKSPACE: OWNER_WS };
  return {
    ...env,
    DB: env.ACARD_LIVE_TRACK ? env.ACARD_LIVE_TRACK(ws, d1Adapter(storeFor(env, ws), "ws:" + ws)) : d1Adapter(storeFor(env, ws), "ws:" + ws),
    MEDIA: env.MEDIA ? prefixedKv(env.MEDIA, mediaPrefix(ws)) : undefined,
    ASSETS: memberAssets(env.ASSETS),
    ACARD_SESSION: "member",
    ACARD_WORKSPACE: ws,
    ACARD_SHARE_PREFIX: "/p/m" + ws + "/",
  };
}

export const MEMBER_SHARE = /^\/p\/m([0-9a-f]{32})(\/[A-Za-z0-9_-]{43}(?:\/media\/[0-9a-f]{16}|\/[^/]+\/?)?)$/;

export async function wipeWorkspace(env: TenancyEnv, ws: string): Promise<{ media: number }> {
  if (ws === OWNER_WS) throw new Error("refusing to wipe the owner workspace");
  await storeFor(env, ws).wipe();
  let media = 0;
  if (env.MEDIA) {
    let cursor: string | undefined;
    do {
      const page = await env.MEDIA.list({ prefix: mediaPrefix(ws), cursor });
      for (const key of page.keys) { await env.MEDIA.delete(key.name); media += 1; }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  return { media };
}

const MEMBER_TOKEN = /^acard_m([0-9a-f]{32})_([A-Za-z0-9_-]{20,})$/;

export function memberToken(ws: string, raw: string): string {
  if (!raw.startsWith("acard_")) throw new Error("unexpected token shape");
  return "acard_m" + ws + "_" + raw.slice("acard_".length);
}

export function parseToken(raw: string): { ws: string; token: string } {
  const match = MEMBER_TOKEN.exec(raw);
  return match ? { ws: match[1], token: "acard_" + match[2] } : { ws: OWNER_WS, token: raw };
}

export function oauthUserId(ws: string): string {
  return ws === OWNER_WS ? "owner" : "ws-" + ws;
}

export function workspaceFromOauthUser(userId: string | undefined): string | null {
  if (userId === "owner") return OWNER_WS;
  const match = /^ws-([0-9a-f]{32})$/.exec(userId ?? "");
  return match ? match[1] : null;
}

const jwksCache = new Map<string, { at: number; keys: Map<string, CryptoKey> }>();

function b64urlBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

async function jwks(supabaseUrl: string, force = false): Promise<Map<string, CryptoKey>> {
  const cached = jwksCache.get(supabaseUrl);
  if (cached && !force && Date.now() - cached.at < 10 * 60 * 1000) return cached.keys;
  const res = await fetch(supabaseUrl + "/auth/v1/.well-known/jwks.json");
  if (!res.ok) throw new Error("jwks " + res.status);
  const body = (await res.json()) as { keys: (JsonWebKey & { kid: string; alg?: string })[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    if (jwk.kty !== "EC" || jwk.crv !== "P-256") continue;
    keys.set(jwk.kid, await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  jwksCache.set(supabaseUrl, { at: Date.now(), keys });
  return keys;
}

export type JwtUser = { sub: string; email?: string; exp: number; user_metadata?: Record<string, unknown> };

export async function verifyJwt(token: string, supabaseUrl: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<JwtUser | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let payload: { sub?: string; email?: string; exp?: number; iss?: string; aud?: string | string[]; role?: string; user_metadata?: Record<string, unknown> };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== "ES256" || !header.kid) return null;
  let keys = await jwks(supabaseUrl);
  if (!keys.has(header.kid)) keys = await jwks(supabaseUrl, true);
  const key = keys.get(header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== supabaseUrl + "/auth/v1" || !aud.includes("authenticated") || payload.role !== "authenticated") return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds || typeof payload.sub !== "string") return null;
  return { sub: payload.sub, email: payload.email, exp: payload.exp, user_metadata: payload.user_metadata ?? {} };
}

export const ACCESS_COOKIE = "acard_at";
export const REFRESH_COOKIE = "acard_rt";

export function readCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) {
      try { out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim()); } catch { continue; }
    }
  }
  return out;
}

export const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function sessionCookies(session: { access_token: string; refresh_token: string; expires_in: number }): string[] {
  return [setCookie(ACCESS_COOKIE, session.access_token, session.expires_in), setCookie(REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 30)];
}

export const clearSessionCookies = () => [setCookie(ACCESS_COOKIE, "", 0), setCookie(REFRESH_COOKIE, "", 0)];

export type Session = { user: JwtUser; token: string; set: string[] };

export async function readSession(request: Request, env: TenancyEnv): Promise<Session | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const jar = readCookies(request);
  if (jar[ACCESS_COOKIE]) {
    const user = await verifyJwt(jar[ACCESS_COOKIE], env.SUPABASE_URL).catch(() => null);
    if (user) return { user, token: jar[ACCESS_COOKIE], set: [] };
  }
  if (jar[REFRESH_COOKIE]) {
    const res = await fetch(env.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: jar[REFRESH_COOKIE] }),
    });
    if (res.ok) {
      const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
      const user = await verifyJwt(data.access_token, env.SUPABASE_URL).catch(() => null);
      if (user) return { user, token: data.access_token, set: sessionCookies(data) };
    }
  }
  return null;
}
