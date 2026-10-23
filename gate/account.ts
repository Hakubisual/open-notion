import {
  ACCESS_COOKIE, OWNER_WS, clearSessionCookies, readCookies, readSession, sessionCookies, setCookie,
  wipeWorkspace, workspaceIdFor, oauthUserId, type Session, type TenancyEnv,
} from "./tenancy";
import { isLang, langCookie } from "./i18n";

export type AccountEnv = TenancyEnv & {
  readonly OUTBOX?: { get(key: string): Promise<string | null>; put(key: string, value: string, options?: unknown): Promise<void>; delete?(key: string): Promise<void>; list(options: { prefix: string }): Promise<{ keys: { name: string }[] }> };
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly SEND_EMAIL_HOOK_SECRET?: string;
  readonly ACARD_GUIDE?: string;
  readonly DEV_OUTBOX_TOKEN?: string;
  readonly SITE_URL?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
};

const VERIFIER = "acard_pkce";
const NEXT = "acard_next";
const GAUTH = "acard_gauth";
// A backslash or control character turns "/\evil.test" into "//evil.test" in browsers.
const safeNext = (value: string | null | undefined) => (value && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : "/");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Where a new account lands after the email link: the invite screen, or (acard-next-10 #4) back to the OAuth consent the
// local app opened, so a local-edition user without an invite code finishes connecting. Anything else goes home.
export const signupNext = (value: unknown): string | null => {
  const next = typeof value === "string" ? value : "";
  if (next === "/beta") return next;
  if (next.length <= 2000 && /^\/oauth\/authorize\?[^#\s\\]*$/.test(next)) return next;
  return null;
};
const PROFILE_COLS = "id,display_name,avatar_url,handle,use_case,onboarded_at,lang,home_layout";
const USE_CASES = ["notes", "blog", "team", "ai_log"];
const HOME_WIDGETS = ["board", "progress", "blog", "notes"];
const HANDLE_MSG: Record<string, string> = {
  invalid: "영문 소문자, 숫자, 하이픈(-)으로 3~30자로 써 주세요.",
  reserved: "예약된 주소라 쓸 수 없어요.",
  taken: "이미 다른 사람이 쓰고 있어요.",
};

export type Profile = { id: string; display_name: string; avatar_url: string | null; handle: string; use_case: string | null; onboarded_at: string | null; lang?: string | null; home_layout?: { widgets: string[] } | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const err = (status: number, code: string, message: string) => json({ error: code, message }, status);

export function withCookies(res: Response, list: string[]): Response {
  if (!list.length || res.status === 101) return res;
  const out = new Response(res.body, res);
  if (list.some(value => value.startsWith(ACCESS_COOKIE + "="))) out.headers.set("clear-site-data", '"cache"');
  for (const value of list) out.headers.append("set-cookie", value);
  return out;
}

export const redirect = (to: string, list: string[] = []) => {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  if (list.some(value => value.startsWith(ACCESS_COOKIE + "="))) headers.set("clear-site-data", '"cache"');
  for (const value of list) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
};

const siteUrl = (env: AccountEnv, request: Request) => env.SITE_URL || new URL(request.url).origin;

async function gotrue(env: AccountEnv, path: string, init: { method?: string; body?: unknown; token?: string; admin?: boolean } = {}) {
  const key = (init.admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY) ?? "";
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { apikey: key, authorization: `Bearer ${init.token ?? key}`, "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function rest(env: AccountEnv, token: string, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { apikey: env.SUPABASE_ANON_KEY ?? "", authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.prefer ? { prefer: init.prefer } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// "This user finished onboarding" (gate/agent-entry.ts routeLoggedIn), kept in OUTBOX KV for a day like beta-access:. A profile
// write cannot undo onboarded_at (the PATCH below drops it once set) and a lang change rides on the acard_lang cookie set in the
// same response, so the only write that makes the key wrong is deleting the account.
export const onboardedKey = (uid: string) => `profile-onboarded:${uid}`;

export async function loadProfile(env: AccountEnv, session: Session): Promise<Profile | null> {
  const r = await rest(env, session.token, `/profiles?id=eq.${session.user.sub}&select=${PROFILE_COLS}`);
  if (!r.ok || !Array.isArray(r.data)) throw new Error(`profile lookup ${r.status}`);
  return r.data[0] ?? null;
}

// notes.example.com/<word> paths the site itself answers (gate/_worker.js, gate/agent-entry.ts) can never be someone's address.
const APP_WORDS = new Set(["home", "edit", "print", "import", "guide", "gallery", "compare", "connect", "agents", "oauth", "mcp", "sse", "releases", "reset", "forgot", "index"]);

async function handleStatus(env: AccountEnv, token: string, h: string): Promise<string> {
  if (APP_WORDS.has(h.trim().toLowerCase())) return "reserved";
  const r = await rest(env, token, "/rpc/handle_status", { body: { h } });
  if (!r.ok || typeof r.data !== "string") throw new Error(`handle_status ${r.status}`);
  return r.data;
}

async function suggestHandle(env: AccountEnv, session: Session): Promise<string> {
  const local = String(session.user.email ?? "").split("@")[0].toLowerCase();
  let base = local.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-?\d+$/, "").slice(0, 24);
  if (base.length < 3) base = `user-${session.user.sub.slice(0, 6)}`;
  for (const cand of [base, ...[2, 3, 4, 5].map((n) => `${base}${n}`), `${base}-${session.user.sub.slice(0, 4)}`]) {
    if ((await handleStatus(env, session.token, cand)) === "ok") return cand;
  }
  return "";
}

const googleAvatar = (meta: Record<string, unknown> | undefined): string | null => {
  const value = meta?.avatar_url ?? meta?.picture;
  return typeof value === "string" && value.startsWith("https://") ? value : null;
};

const gotrueCode = (d: any): string => String(d?.error_code ?? d?.code ?? d?.error ?? "unknown");

async function readCreds(request: Request): Promise<{ email: string; password: string; next: string } | Response> {
  let body: any;
  try { body = await request.json(); } catch { return err(400, "bad_json", "요청 형식이 올바르지 않아요."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json", "요청 형식이 올바르지 않아요.");
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!EMAIL_RE.test(email) || email.length > 254) return err(400, "bad_email", "이메일 주소를 확인해 주세요.");
  if (password.length < 8 || password.length > 128) return err(400, "weak_password", "비밀번호는 8자 이상이어야 해요.");
  return { email, password, next: signupNext(body?.next) ?? "/" };
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Google sign-in runs from our own domain (acard-google-domain) so Google's account screen names notes.example.com, not the
// Supabase project host. Google allows one fixed redirect URI, so the state names the host the login started on, signed
// with a key derived from the client secret; the callback hands the single-use Google code back to that host, where
// the PKCE verifier and nonce cookies live. GoTrue then makes the session from the id_token (same Google identity).
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const googleCallback = (env: AccountEnv, request: Request) => `${siteUrl(env, request)}/api/auth/google/callback`;
const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const stateKey = (secret: string) =>
  crypto.subtle.importKey("raw", new TextEncoder().encode("acard-google-state:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signGoogleState(secret: string, state: { h: string; i: string; x: number }): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(state)));
  return body + "." + b64url(await crypto.subtle.sign("HMAC", await stateKey(secret), new TextEncoder().encode(body)));
}

async function readGoogleState(secret: string, raw: string | null): Promise<{ h: string; i: string } | null> {
  const [body, mac, extra] = (raw ?? "").split(".");
  if (!body || !mac || extra !== undefined) return null;
  try {
    const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    if (!(await crypto.subtle.verify("HMAC", await stateKey(secret), unb64(mac), new TextEncoder().encode(body)))) return null;
    const state = JSON.parse(new TextDecoder().decode(unb64(body)));
    if (typeof state?.h !== "string" || !/^https?:\/\/[^/?#\s]+$/.test(state.h) || typeof state.i !== "string" || !state.i) return null;
    if (typeof state.x !== "number" || state.x < Date.now()) return null;
    return { h: state.h, i: state.i };
  } catch { return null; }
}

async function verifyHook(request: Request, body: string, secret: string): Promise<boolean> {
  const id = request.headers.get("webhook-id");
  const ts = request.headers.get("webhook-timestamp");
  const sigs = request.headers.get("webhook-signature");
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const raw = Uint8Array.from(atob(secret.replace(/^v1,whsec_/, "")), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return sigs.split(" ").some((s) => s.split(",")[1] === expected);
}

async function limited(request: Request, env: AccountEnv, bucket: string): Promise<Response | null> {
  if (!env.WORKSPACE) return null;
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const limiter = env.WORKSPACE.get(env.WORKSPACE.idFromName("rate-limit"));
  const ok = await limiter.hit(`${bucket}:${ip}`, 10, 60);
  return ok ? null : err(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
}

export const ACCOUNT_API = /^\/api\/(?:auth\/|hooks\/send-email$|dev\/outbox$|me$|profile$|handle$|account\/delete$)/;

export async function accountApi(request: Request, env: AccountEnv, url: URL, oauthCleanup?: (userId: string) => Promise<number>): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return err(503, "not_configured", "준비 중이에요.");
  const path = url.pathname;
  const post = request.method === "POST";
  if (post && !path.startsWith("/api/hooks/")) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return err(403, "bad_origin", "forbidden");
  }

  if (path === "/api/hooks/send-email" && post) {
    const body = await request.text();
    if (!env.SEND_EMAIL_HOOK_SECRET || !(await verifyHook(request, body, env.SEND_EMAIL_HOOK_SECRET))) return err(401, "bad_signature", "invalid signature");
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { return err(400, "bad_json", "요청 형식이 올바르지 않아요."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.user || typeof parsed.user !== "object" || Array.isArray(parsed.user) || !parsed.email_data || typeof parsed.email_data !== "object" || Array.isArray(parsed.email_data)) return err(400, "bad_json", "요청 형식이 올바르지 않아요.");
    const { user, email_data } = parsed;
    const site = siteUrl(env, request);
    const back = typeof email_data.redirect_to === "string" && email_data.redirect_to.startsWith(site + "/") ? signupNext(email_data.redirect_to.slice(site.length)) : null;
    const next = back ? "&next=" + encodeURIComponent(back) : "";
    const link = `${siteUrl(env, request)}/api/auth/confirm?token_hash=${encodeURIComponent(email_data.token_hash)}&type=${encodeURIComponent(email_data.email_action_type)}${next}`;
    const entry = { to: user.email, type: email_data.email_action_type, link, at: new Date().toISOString() };
    await env.OUTBOX?.put(`mail:${user.email}:${Date.now()}`, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 });
    return json({});
  }

  if (path === "/api/dev/outbox" && request.method === "GET") {
    if (!env.DEV_OUTBOX_TOKEN || !env.OUTBOX || request.headers.get("authorization") !== `Bearer ${env.DEV_OUTBOX_TOKEN}`) return err(404, "not_found", "not found");
    const to = (url.searchParams.get("to") ?? "").toLowerCase();
    const list = await env.OUTBOX.list({ prefix: `mail:${to}` });
    const mails = await Promise.all(list.keys.map(async (k) => JSON.parse((await env.OUTBOX!.get(k.name)) ?? "null")));
    return json({ mails: mails.filter(Boolean).sort((a, b) => a.at.localeCompare(b.at)) });
  }

  if (path === "/api/auth/signup" && post) {
    const lim = await limited(request, env, "signup"); if (lim) return lim;
    const c = await readCreds(request); if (c instanceof Response) return c;
    const destination = c.next !== "/" ? `?redirect_to=${encodeURIComponent(siteUrl(env, request) + c.next)}` : "";
    const r = await gotrue(env, "/signup" + destination, { body: { email: c.email, password: c.password } });
    if (!r.ok) {
      const code = gotrueCode(r.data);
      if (code === "weak_password") return err(400, code, "더 강한 비밀번호를 써 주세요.");
      if (code === "over_email_send_rate_limit" || r.status === 429) return err(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
      return err(400, code, "가입하지 못했어요. 입력을 확인해 주세요.");
    }
    return json({ ok: true, next: "verify" });
  }

  if (path === "/api/auth/login" && post) {
    const lim = await limited(request, env, "login"); if (lim) return lim;
    const c = await readCreds(request); if (c instanceof Response) return c;
    const r = await gotrue(env, "/token?grant_type=password", { body: { email: c.email, password: c.password } });
    if (!r.ok) {
      const code = gotrueCode(r.data);
      if (code === "email_not_confirmed") return err(403, code, "메일함에서 인증 링크를 먼저 눌러 주세요.");
      if (r.status === 429) return err(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
      return err(401, "invalid_credentials", "이메일 또는 비밀번호가 맞지 않아요.");
    }
    return withCookies(json({ ok: true, next: "/" }), sessionCookies(r.data));
  }

  if (path === "/api/auth/logout" && post) {
    const jar = readCookies(request);
    if (jar[ACCESS_COOKIE]) await gotrue(env, "/logout?scope=local", { body: {}, token: jar[ACCESS_COOKIE] });
    return withCookies(json({ ok: true }), clearSessionCookies());
  }

  if (path === "/api/auth/forgot" && post) {
    const lim = await limited(request, env, "forgot"); if (lim) return lim;
    let body: any; try { body = await request.json(); } catch { return err(400, "bad_json", "요청 형식이 올바르지 않아요."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json", "요청 형식이 올바르지 않아요.");
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return err(400, "bad_email", "이메일 주소를 확인해 주세요.");
    const r = await gotrue(env, "/recover", { body: { email } });
    if (r.status === 429) return err(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
    return json({ ok: true });
  }

  if (path === "/api/auth/confirm" && request.method === "GET") {
    const token_hash = url.searchParams.get("token_hash") ?? "";
    const type = url.searchParams.get("type") ?? "";
    const r = await gotrue(env, "/verify", { body: { type: type === "signup" ? "email" : type, token_hash } });
    if (!r.ok) return redirect("/login?e=link");
    return redirect(type === "recovery" ? "/reset" : signupNext(url.searchParams.get("next")) ?? "/", sessionCookies(r.data));
  }

  if (path === "/api/auth/reset" && post) {
    const me = await readSession(request, env);
    if (!me) return err(401, "no_session", "링크가 만료됐어요. 다시 요청해 주세요.");
    let body: any; try { body = await request.json(); } catch { return err(400, "bad_json", "요청 형식이 올바르지 않아요."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json", "요청 형식이 올바르지 않아요.");
    const password = String(body?.password ?? "");
    if (password.length < 8 || password.length > 128) return err(400, "weak_password", "비밀번호는 8자 이상이어야 해요.");
    const r = await gotrue(env, "/user", { method: "PUT", body: { password }, token: me.token });
    if (!r.ok) return err(400, gotrueCode(r.data), "비밀번호를 바꾸지 못했어요.");
    await gotrue(env, "/logout?scope=global", { body: {}, token: me.token });
    return withCookies(json({ ok: true }), clearSessionCookies());
  }

  if (path === "/api/auth/google" && request.method === "GET") {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
      const state = await signGoogleState(env.GOOGLE_CLIENT_SECRET, { h: url.origin, i: id, x: Date.now() + 600_000 });
      const q = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, redirect_uri: googleCallback(env, request), response_type: "code", scope: "openid email profile",
        state, nonce: await sha256Hex(nonce), code_challenge: challenge, code_challenge_method: "S256",
      });
      return redirect(`${GOOGLE_AUTHORIZE}?${q}`, [setCookie(GAUTH, `${id}.${verifier}.${nonce}`, 600), setCookie(NEXT, safeNext(url.searchParams.get("next")), 600)]);
    }
    const q = new URLSearchParams({ provider: "google", redirect_to: `${siteUrl(env, request)}/api/auth/callback`, code_challenge: challenge, code_challenge_method: "s256" });
    return redirect(`${env.SUPABASE_URL}/auth/v1/authorize?${q}`, [setCookie(VERIFIER, verifier, 600), setCookie(NEXT, safeNext(url.searchParams.get("next")), 600)]);
  }

  if (path === "/api/auth/google/callback" && request.method === "GET") {
    const fail = redirect("/login?e=oauth", [setCookie(GAUTH, "", 0), setCookie(NEXT, "", 0)]);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail;
    const state = await readGoogleState(env.GOOGLE_CLIENT_SECRET, url.searchParams.get("state"));
    if (!state) return fail;
    if (state.h !== url.origin) return redirect(state.h + path + url.search);
    const jar = readCookies(request);
    const [id, verifier, nonce] = (jar[GAUTH] ?? "").split(".");
    const code = url.searchParams.get("code");
    if (!code || !verifier || !nonce || id !== state.i) return fail;
    const tokens: any = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: googleCallback(env, request), grant_type: "authorization_code", code_verifier: verifier }),
    }).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    if (typeof tokens?.id_token !== "string") return fail;
    const r = await gotrue(env, "/token?grant_type=id_token", { body: { provider: "google", id_token: tokens.id_token, nonce } });
    if (!r.ok) return fail;
    return redirect(safeNext(jar[NEXT]), [...sessionCookies(r.data), setCookie(GAUTH, "", 0), setCookie(NEXT, "", 0)]);
  }

  if (path === "/api/auth/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const verifier = readCookies(request)[VERIFIER];
    if (!code || !verifier) return redirect("/login?e=oauth");
    const r = await gotrue(env, "/token?grant_type=pkce", { body: { auth_code: code, code_verifier: verifier } });
    if (!r.ok) return redirect("/login?e=oauth");
    return redirect(safeNext(readCookies(request)[NEXT]), [...sessionCookies(r.data), setCookie(VERIFIER, "", 0), setCookie(NEXT, "", 0)]);
  }

  const me = await readSession(request, env);
  if (!me) return withCookies(err(401, "no_session", "로그인이 필요해요."), clearSessionCookies());

  if (path === "/api/me" && request.method === "GET") {
    const ws = workspaceIdFor(me.user.sub, env);
    return withCookies(json({ id: me.user.sub, email: me.user.email, workspace: ws === OWNER_WS ? "owner" : "personal" }), me.set);
  }

  if (path === "/api/profile" && request.method === "GET") {
    try {
      const profile = await loadProfile(env, me);
      const meta = me.user.user_metadata ?? {};
      const suggest = profile ? null : {
        display_name: String(meta.full_name ?? meta.name ?? String(me.user.email ?? "").split("@")[0]).slice(0, 40),
        avatar_url: googleAvatar(meta),
        handle: await suggestHandle(env, me),
      };
      return withCookies(json({ email: me.user.email, profile, suggest }), me.set);
    } catch {
      return withCookies(err(502, "profile_unavailable", "프로필을 불러오지 못했어요."), me.set);
    }
  }

  if (path === "/api/handle" && request.method === "GET") {
    try {
      const status = await handleStatus(env, me.token, url.searchParams.get("h") ?? "");
      return withCookies(json({ status, message: HANDLE_MSG[status] ?? "사용할 수 있어요" }), me.set);
    } catch {
      return err(502, "handle_unavailable", "주소를 확인하지 못했어요.");
    }
  }

  if (path === "/api/profile" && post) {
    let body: any; try { body = await request.json(); } catch { return err(400, "bad_json", "요청 형식이 올바르지 않아요."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json", "요청 형식이 올바르지 않아요.");
    const patch: Record<string, unknown> = {};
    if (body.display_name !== undefined) {
      const name = String(body.display_name).trim();
      if (name.length < 1 || name.length > 40) return err(400, "bad_name", "이름은 1~40자로 써 주세요.");
      patch.display_name = name;
    }
    if (body.handle !== undefined) {
      const handle = String(body.handle).trim().toLowerCase();
      let status: string;
      try { status = await handleStatus(env, me.token, handle); } catch { return err(502, "handle_unavailable", "주소를 확인하지 못했어요."); }
      if (status !== "ok") return err(400, `handle_${status}`, HANDLE_MSG[status]);
      patch.handle = handle;
    }
    if (body.use_case !== undefined) {
      if (body.use_case !== null && !USE_CASES.includes(body.use_case)) return err(400, "bad_use_case", "선택을 확인해 주세요.");
      patch.use_case = body.use_case;
    }
    if (body.lang !== undefined) {
      if (body.lang !== null && !isLang(body.lang)) return err(400, "bad_lang", "선택을 확인해 주세요.");
      patch.lang = body.lang;
    }
    if (body.home_layout !== undefined) {
      const widgets = body.home_layout === null ? null : body.home_layout?.widgets;
      if (widgets !== null && (!Array.isArray(widgets) || widgets.length > HOME_WIDGETS.length || new Set(widgets).size !== widgets.length || widgets.some((w: unknown) => !HOME_WIDGETS.includes(w as string)))) return err(400, "bad_home_layout", "선택을 확인해 주세요.");
      patch.home_layout = widgets === null ? null : { widgets };
    }
    if (body.finish === true) patch.onboarded_at = new Date().toISOString();
    let existing: Profile | null;
    try { existing = await loadProfile(env, me); } catch { return err(502, "profile_unavailable", "프로필을 불러오지 못했어요."); }
    let r;
    if (existing) {
      if (existing.onboarded_at) delete patch.onboarded_at;
      r = await rest(env, me.token, `/profiles?id=eq.${me.user.sub}&select=${PROFILE_COLS}`, { method: "PATCH", body: patch, prefer: "return=representation" });
    } else {
      if (!patch.display_name || !patch.handle) return err(400, "incomplete", "이름과 공개 주소를 먼저 정해 주세요.");
      r = await rest(env, me.token, `/profiles?select=${PROFILE_COLS}`, { body: { id: me.user.sub, avatar_url: googleAvatar(me.user.user_metadata), ...patch }, prefer: "return=representation" });
    }
    if (!r.ok) {
      if (r.data?.code === "23505") return err(400, "handle_taken", HANDLE_MSG.taken);
      if (r.data?.code === "23514") return err(400, "handle_invalid", HANDLE_MSG.invalid);
      return err(502, "save_failed", "저장하지 못했어요. 다시 시도해 주세요.");
    }
    // 시작 가이드 (#140) only for a profile's first onboarding finish; features/welcome-guide.js turns this mark into its state.
    if (patch.onboarded_at && env.ACARD_GUIDE === "on" && env.OUTBOX) {
      const ws = workspaceIdFor(me.user.sub, env);
      if (ws !== OWNER_WS) await env.OUTBOX.put("guide-new:" + ws, "1", { expirationTtl: 60 * 60 * 24 * 30 }).catch(() => undefined);
    }
    return withCookies(json({ ok: true, profile: r.data[0] }), isLang(body.lang) ? [...me.set, langCookie(body.lang)] : me.set);
  }

  if (path === "/api/account/delete" && post) {
    const ws = workspaceIdFor(me.user.sub, env);
    if (ws === OWNER_WS) return err(403, "owner_account", "오너 계정은 여기서 지울 수 없어요.");
    const wiped = await wipeWorkspace(env, ws);
    const grants = oauthCleanup ? await oauthCleanup(oauthUserId(ws)) : 0;
    const r = await gotrue(env, `/admin/users/${me.user.sub}`, { method: "DELETE", admin: true });
    if (!r.ok) return err(500, "delete_failed", "계정을 삭제하지 못했어요.");
    await env.OUTBOX?.delete?.(onboardedKey(me.user.sub)).catch(() => undefined);
    return withCookies(json({ ok: true, wiped: { media: wiped.media, grants } }), clearSessionCookies());
  }

  return err(404, "not_found", "not found");
}

