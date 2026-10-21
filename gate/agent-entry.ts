import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  authorizationErrorRedirect,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAcardMcpServer, OperationFailure, type AgentOperation, type AgentPrincipal } from "../agents/mcp-tools";
import core, { acardHost, type CoreEnv } from "./acard-core.js";
import { withDataBackend, type DataEnv } from "./pg-driver";
import { agentsMd, connectClients, llmsTxt, openapiSpec } from "../agent-docs.js";
import {
  MEMBER_SHARE, OWNER_WS, clearSessionCookies, memberAssets, memberToken, oauthUserId, parseToken, readCookies, readSession,
  setCookie, workspaceEnv, workspaceFromOauthUser, workspaceIdFor, type Session, type TenancyEnv,
} from "./tenancy";
import { ACCOUNT_API, accountApi, loadProfile, redirect, withCookies, type AccountEnv } from "./account";
import { BETA_API, betaApi, betaClosed, hasBetaAccess, injectAppBeta, isBetaAdmin, rewriteLanding, type BetaEnv } from "./hosted-access";
import { ADMIN_PATH, adminRoute, isSuspended, myUsage, type AdminEnv } from "./hosted-console";
import { connect as liveConnect, newSink, publish as livePublish, trackDb, type LiveNamespace, type Sink } from "./live";
import { injectAppLang, isLang, langCookie, langSwitch, localizeJson, pickLang, pickUserLang, translateHtml, type Lang } from "./i18n";
import { cacheVersioned, serviceWorkerOff } from "./static-cache";
import { migrateMediaPage, r2Usage, withR2Media, type R2Like } from "./media-store";

const VERSION = "1.0.0";
const SCOPES = ["read", "write"] as const;

type DurableStub = { fetch(input: string, init?: RequestInit): Promise<Response> };
type DurableNamespace = { idFromName(name: string): unknown; get(id: unknown): DurableStub };

type Env = CoreEnv & TenancyEnv & AccountEnv & BetaEnv & {
  readonly OAUTH_KV?: unknown;
  readonly SSE_RELAY?: DurableNamespace;
  readonly LIVE?: LiveNamespace;
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly LEGACY_MODE?: string;
  readonly FORWARD_SECRET?: string;
  readonly AGENT_TICK_SECRET?: string;
  readonly RECURRING_TICK_SECRET?: string;
  readonly ACARD_IDENTITY?: (value: string | null, guest?: boolean) => void;
  readonly MEDIA_R2?: R2Like;
  readonly MEDIA_MIGRATE_SECRET?: string;
};

type GrantProps = { readonly agent: string };
type Principal = AgentPrincipal & { readonly key: string; readonly env: Env; readonly ws: string; readonly tokenId?: string; readonly agentRules?: boolean };

function scoped(env: Env, ws: string): Env {
  return acardHost.trust(workspaceEnv(env, ws));
}

// Guests prove an invited email once (features/share.js) and get acard_guest=<ws>.<token>. Their env never carries
// owner build HTML, and core sends every request through the share resolver because ACARD_GUEST_TOKEN is set.
const GUEST_COOKIE = /^(o|[0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;
function guestEnv(env: Env, request: Request): Env | null {
  const match = GUEST_COOKIE.exec(readCookies(request).acard_guest ?? "");
  if (!match) return null;
  const ws = match[1] === "o" ? OWNER_WS : match[1];
  if (ws !== OWNER_WS && !env.WORKSPACE) return null;
  const base = workspaceEnv(env, ws);
  return acardHost.trust({ ...base, ASSETS: memberAssets(env.ASSETS), ACARD_GUEST_TOKEN: match[2] } as Env);
}
const SHARE_PATH = /^\/s\/(o|[0-9a-f]{32})(\/.*)$/;

const servers = new Map<string, OAuthAuthorizationServer<Env>>();

function authorizationServer(origin: string): OAuthAuthorizationServer<Env> {
  const cached = servers.get(origin);
  if (cached) return cached;
  const server = new OAuthAuthorizationServer<Env>({
    issuer: origin,
    resources: [origin + "/mcp", origin + "/api/v1"],
    defaultResource: origin + "/mcp",
    authorizeEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: [...SCOPES, "offline_access"],
  });
  servers.set(origin, server);
  return server;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function textResponse(body: string, type: string): Response {
  return new Response(body, { headers: { "content-type": type + "; charset=utf-8", "cache-control": "no-store" } });
}

function resourceFor(path: string, origin: string): string | null {
  if (path === "/mcp" || path.startsWith("/mcp/") || path === "/sse" || path.startsWith("/sse/")) return origin + "/mcp";
  if (path.startsWith("/api/v1/")) return origin + "/api/v1";
  return null;
}

function challenge(origin: string, resource: string): Response {
  const metadata = origin + "/.well-known/oauth-protected-resource" + new URL(resource).pathname;
  return jsonResponse(
    { error: "에이전트 토큰이 필요해요. Acard 설정 > 에이전트 연결에서 만들거나 OAuth 로 로그인하세요." },
    401,
    { "www-authenticate": 'Bearer resource_metadata="' + metadata + '", scope="read write"' },
  );
}

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  return match ? match[1] : null;
}

function grantedScopes(scope: readonly string[]): string[] {
  const scopes = SCOPES.filter((name) => scope.includes(name));
  return scopes.includes("write") && !scopes.includes("read") ? ["read", ...scopes] : scopes;
}

function keyFor(ws: string, key: string): string {
  return ws === OWNER_WS ? key : "ws-" + ws + ":" + key;
}

async function authenticate(request: Request, env: Env, origin: string, resource: string): Promise<Principal | null> {
  const raw = bearer(request);
  if (!raw) return null;
  if (raw.startsWith("acard_")) {
    const { ws, token } = parseToken(raw);
    if (ws !== OWNER_WS && !env.WORKSPACE) return null;
    const wsEnv = ws === OWNER_WS ? env : scoped(env, ws);
    const found = await acardHost.principalFromToken(wsEnv, token);
    return found ? { name: found.name, via: "token", scopes: found.scopes, key: keyFor(ws, "token:" + found.tokenId), tokenId: found.tokenId, agentRules: found.agentRules, env: wsEnv, ws } : null;
  }
  if (!env.OAUTH_KV) return null;
  const server = authorizationServer(origin);
  const sibling = resource.endsWith("/mcp") ? origin + "/api/v1" : origin + "/mcp";
  const validated = (await server.validateToken<GrantProps>(resource, raw, env)) ?? (await server.validateToken<GrantProps>(sibling, raw, env));
  if (!validated) return null;
  const ws = workspaceFromOauthUser(validated.userId ?? raw.split(":")[0]);
  if (!ws || (ws !== OWNER_WS && !env.WORKSPACE)) return null;
  const wsEnv = ws === OWNER_WS ? env : scoped(env, ws);
  const grantId = raw.split(":")[1];
  if (grantId && (await (await acardHost.tokenAdmin(wsEnv)).grantRevoked(grantId))) return null;
  return { name: validated.props.agent, via: "oauth", scopes: grantedScopes(validated.scope), key: keyFor(ws, "oauth:" + validated.clientId), env: wsEnv, ws };
}

function runner(principal: Principal) {
  return async (operation: AgentOperation, input: Record<string, unknown>) => {
    try {
      return await acardHost.run(principal.env, principal, operation, input);
    } catch (error) {
      if (acardHost.isAgentError(error)) throw new OperationFailure(error.message, error.status);
      throw error;
    }
  };
}

async function mcpResponse(request: Request, principal: Principal, parsedBody?: unknown): Promise<Response> {
  const server = createAcardMcpServer(runner(principal), VERSION, acardHost.mcpTools);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request, parsedBody === undefined ? undefined : { parsedBody });
}

function checkOrigin(request: Request, origin: string): Response | null {
  const given = request.headers.get("origin");
  if (given && given !== origin) return jsonResponse({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null }, 403);
  return null;
}

async function serveSse(request: Request, env: Env, url: URL, principal: Principal): Promise<Response> {
  const relay = env.SSE_RELAY;
  if (!relay) return jsonResponse({ error: "SSE 연결이 아직 준비되지 않았어요. /mcp 를 쓰세요." }, 503);
  if (url.pathname === "/sse" && request.method === "GET") {
    const session = crypto.randomUUID();
    const stub = relay.get(relay.idFromName(session));
    const endpoint = "/sse/message?sessionId=" + session;
    return stub.fetch("https://relay/open?owner=" + encodeURIComponent(principal.key) + "&endpoint=" + encodeURIComponent(endpoint));
  }
  if (url.pathname === "/sse/message" && request.method === "POST") {
    const session = url.searchParams.get("sessionId") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(session)) return jsonResponse({ error: "sessionId 가 맞지 않아요." }, 400);
    const stub = relay.get(relay.idFromName(session));
    const { owner } = (await (await stub.fetch("https://relay/owner")).json()) as { owner: string | null };
    if (!owner) return jsonResponse({ error: "없는 세션이에요. /sse 로 다시 연결하세요." }, 404);
    if (owner !== principal.key) return jsonResponse({ error: "다른 에이전트의 세션이에요." }, 403);
    const message = await request.json();
    const inner = new Request(url.origin + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(message),
    });
    const reply = await mcpResponse(inner, principal, message);
    if (reply.status === 202) return new Response(null, { status: 202 });
    const text = await reply.text();
    if (!text) return new Response(null, { status: 202 });
    const sent = await stub.fetch("https://relay/send", { method: "POST", body: text });
    if (sent.status === 410) return jsonResponse({ error: "SSE 연결이 끊겼어요. /sse 로 다시 연결하세요." }, 410);
    return new Response(null, { status: 202 });
  }
  return jsonResponse({ error: "지원하지 않는 방법이에요." }, 405);
}

function protectedResourceMetadata(origin: string, resource: string): Response {
  return jsonResponse({
    resource,
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Acard",
  });
}

function consentPage(env: Env, details: { clientName: string; redirectHost: string; redirectIsLoopback: boolean; scope: string[] }, handle: string, restart: string): string {
  const esc = acardHost.escapeHtml;
  const scopeLabel = (scope: string) => (scope === "write" ? "노트 쓰기·고치기" : scope === "read" ? "노트 읽기" : scope);
  const boxes = details.scope
    .filter((scope) => scope !== "offline_access")
    .map((scope) => '<label class="row"><input type="checkbox" name="scope" value="' + esc(scope) + '" checked> ' + esc(scopeLabel(scope)) + "</label>")
    .join("");
  const keep = details.scope.includes("offline_access") ? '<input type="hidden" name="scope" value="offline_access">' : "";
  return [
    "<!doctype html>",
    '<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow"><title>에이전트 연결 허락 · Acard</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/agents.css"></head>',
    '<body class="consent"><main class="consent-card">',
    "<h1>" + esc(details.clientName) + " 이(가) 노트에 연결하려고 해요</h1>",
    "<p>이 앱은 스스로 이름을 등록했어요. 이름만으로는 진짜인지 알 수 없어요. 방금 직접 연결을 시작한 게 맞을 때만 허락하세요.</p>",
    "<p>허락하면 열쇠가 <strong>" + esc(details.redirectHost) + "</strong> 로 가요.</p>",
    details.redirectIsLoopback ? "<p><strong>이 컴퓨터 안의 프로그램으로 가는 연결이에요.</strong> 내가 방금 실행한 프로그램일 때만 허락하세요.</p>" : "",
    '<form method="post" action="/oauth/authorize" onsubmit="if(this.dataset.sent)return false;this.dataset.sent=1">',
    '<input type="hidden" name="handle" value="' + esc(handle) + '">',
    '<input type="hidden" name="restart" value="' + esc(restart) + '">',
    "<fieldset><legend>허락할 일</legend>" + boxes + "</fieldset>" + keep,
    '<p class="actions"><button name="decision" value="approve">허락하기</button> <button name="decision" value="deny" class="secondary">거절하기</button></p>',
    "</form></main></body></html>",
  ].join("\n");
}

type Human = { ws: string; env: Env; set: string[]; session: Session | null };

// Who is at the keyboard: a signed-in notes.example.com account (any workspace) or, during the move, the owner's password ticket.
async function humanFor(request: Request, env: Env): Promise<Human | null> {
  const session = await readSession(request, env).catch(() => null);
  env.ACARD_IDENTITY?.(null);
  if (session) {
    if (await isSuspended(env as unknown as AdminEnv, session.user.sub)) return null;
    const ws = workspaceIdFor(session.user.sub, env);
    if (ws !== OWNER_WS && !env.WORKSPACE) return null;
    env.ACARD_IDENTITY?.(session.user.sub + ":" + ws);
    const email = typeof session.user.email === "string" ? session.user.email.toLowerCase() : "";
    return { ws, env: acardHost.trust({ ...workspaceEnv(env, ws), ...(email ? { ACARD_USER_EMAIL: email } : {}) } as Env), set: session.set, session };
  }
  return null;
}

// The consent step keeps its pending authorization on the server, keyed by the SHA-256 of a 256-bit handle that only the
// consent page carries, and bound to the signed-in Acard user who saw the page. It no longer needs the browser cookie the
// library's beginConsent/approveConsent pair sets: that cookie was lost when it outlived its 10 minutes, when a second
// submit followed the first (the first clears it), or when the page was opened in a browser that drops it, and the person
// got "This authorization was not started in this browser; start again" (acard-oauth-browser). CSRF stays closed: a
// cross-site POST is refused by Origin/Sec-Fetch-Site and carries no SameSite=Lax session anyway, the handle cannot be
// read cross-origin, a handle approved by any user other than the one it was shown to is refused, and each handle is
// single use and expires after 10 minutes. The client, redirect_uri, PKCE and resource stay inside the stored request
// that parseAuthRequest() validated; the form only picks the decision and narrows the scopes.
//
// Single use cannot rest on Workers KV (eventually consistent, no compare-and-delete): two approves sent together both
// read the pending record and each minted a code. The answer is therefore claimed with one INSERT on the primary key of
// oauth_consent_claims in the owner database (Postgres in production, D1/SQLite elsewhere), which exactly one request
// wins. Both the KV record and the claim's remembered redirect are sealed with AES-GCM under a key derived from the
// handle, so neither store holds an authorization code or the request in plaintext.
const CONSENT_TTL_SECONDS = 600;
// A repeated approve of the same handle by the same person within this window gets the same redirect again instead of an
// error page that would hide the first answer (double click, or the browser re-sending the form).
const CONSENT_DONE_TTL_SECONDS = 60;
type PendingConsent = { request: AuthRequest; user: string; exp: number };
type ConsentKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};
type ConsentStmt = { bind(...values: unknown[]): ConsentStmt; run(): Promise<{ meta?: { changes?: number } }>; first(): Promise<Record<string, unknown> | null> };
type ConsentDb = { prepare(sql: string): ConsentStmt };

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
const b64u = (bytes: Uint8Array) => { let raw = ""; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function consentId(handle: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("acard-consent:" + handle)));
}

async function consentSealKey(handle: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("acard-consent-seal:" + handle));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(handle: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await consentSealKey(handle), new TextEncoder().encode(JSON.stringify(value)));
  return b64u(iv) + "." + b64u(new Uint8Array(sealed));
}

async function unseal<T>(handle: string, text: string | null | undefined): Promise<T | null> {
  if (!text) return null;
  try {
    const [iv, body] = text.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await consentSealKey(handle), unb64u(body));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

function newConsentHandle(): string {
  return b64u(crypto.getRandomValues(new Uint8Array(32)));
}

// Production Postgres gets this table from migrations/supabase/022-acard-oauth-consent.sql (runtime DDL is a no-op
// there); D1/SQLite creates it here.
const CONSENT_CLAIMS_DDL = "CREATE TABLE IF NOT EXISTS oauth_consent_claims (id TEXT PRIMARY KEY, done TEXT, created INTEGER NOT NULL)";
let consentClaimsReady = false;

// true for exactly one caller per id, however many arrive at once.
async function claimConsent(db: ConsentDb, id: string, now: number): Promise<boolean> {
  if (!consentClaimsReady) { await db.prepare(CONSENT_CLAIMS_DDL).run(); consentClaimsReady = true; }
  await db.prepare("DELETE FROM oauth_consent_claims WHERE created < ?").bind(now - CONSENT_TTL_SECONDS * 1000).run();
  const won = await db.prepare("INSERT OR IGNORE INTO oauth_consent_claims (id, done, created) VALUES (?, NULL, ?)").bind(id, now).run();
  return (won.meta?.changes ?? 0) === 1;
}

// Browsers send Origin on every form POST and Sec-Fetch-Site with it; the consent page also asks for a same-origin
// Referer. A POST is taken only when one of them says it came from this site: a cross-site or opaque Origin, a
// cross-site Sec-Fetch-Site, or no signal at all is refused, so leaving the headers out is no way around the check.
type PostSource = "same_origin" | "cross_site" | "unverified";
function postSource(request: Request, origin: string): PostSource {
  const given = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (given !== null && given !== origin) return "cross_site";
  if (site !== null && site !== "same-origin") return "cross_site";
  if (given === origin || site === "same-origin") return "same_origin";
  const referer = request.headers.get("referer");
  if (referer && referer.startsWith(origin + "/oauth/authorize")) return "same_origin";
  return "unverified";
}

type ConsentProblem = "expired" | "other_user" | "cross_site" | "unverified" | "invalid";
const CONSENT_TEXT: Record<Lang, { title: string; restart: string; app: string } & Record<ConsentProblem, string>> = {
  ko: {
    title: "연결을 다시 시작해 주세요",
    expired: "이 연결 요청은 시간이 지났거나(10분) 이미 처리됐어요.",
    other_user: "이 연결 요청은 다른 Acard 계정으로 시작됐어요. 연결할 계정으로 로그인한 채 다시 시작해 주세요.",
    cross_site: "다른 사이트에서 보낸 요청이라 막았어요.",
    unverified: "이 요청이 Acard 화면에서 왔는지 브라우저가 알려 주지 않아 막았어요. 다시 시작을 눌러 주세요.",
    invalid: "연결 요청을 확인하지 못했어요.",
    restart: "다시 시작",
    app: "버튼이 안 되면 에이전트 앱(Claude Code 등)에서 Acard 연결을 한 번 더 눌러 주세요.",
  },
  en: {
    title: "Please start the connection again",
    expired: "This connection request has expired (10 minutes) or was already handled.",
    other_user: "This connection request was started with a different Acard account. Sign in with the account to connect and start again.",
    cross_site: "This request came from another site, so it was blocked.",
    unverified: "Your browser didn't say this request came from the Acard page, so it was blocked. Press Start again.",
    invalid: "We couldn't verify this connection request.",
    restart: "Start again",
    app: "If the button doesn't work, connect Acard again from your agent app (Claude Code, etc.).",
  },
  zh: {
    title: "请重新开始连接",
    expired: "此连接请求已过期（10 分钟）或已处理。",
    other_user: "此连接请求是用另一个 Acard 账号开始的。请用要连接的账号登录后重新开始。",
    cross_site: "此请求来自其他网站，已被阻止。",
    unverified: "浏览器未说明此请求来自 Acard 页面，已被阻止。请点击重新开始。",
    invalid: "无法验证此连接请求。",
    restart: "重新开始",
    app: "如果按钮无效，请在代理应用（Claude Code 等）中再次连接 Acard。",
  },
};

// restart is the query of the GET that opened the consent page; it only ever leads back to /oauth/authorize, which
// validates it again from scratch.
function consentProblemPage(request: Request, problem: ConsentProblem, restart: string | null, detail?: string): Response {
  const lang = pickUserLang(request);
  const text = CONSENT_TEXT[lang];
  const esc = acardHost.escapeHtml;
  const query = restart && /^\?[^#\s]*$/.test(restart) && new URLSearchParams(restart).get("client_id") ? restart : null;
  const html = [
    "<!doctype html>",
    '<html lang="' + (lang === "zh" ? "zh-CN" : lang) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow"><title>' + esc(text.title) + ' · Acard</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/agents.css"></head>',
    '<body class="consent"><main class="consent-card" data-problem="' + problem + '">',
    "<h1>" + esc(text.title) + "</h1>",
    "<p>" + esc(text[problem]) + "</p>",
    detail ? '<p class="muted"><small>' + esc(detail) + "</small></p>" : "",
    query
      ? '<form method="get" action="/oauth/authorize" class="actions">' +
        [...new URLSearchParams(query)].map(([k, v]) => '<input type="hidden" name="' + esc(k) + '" value="' + esc(v) + '">').join("") +
        "<button>" + esc(text.restart) + "</button></form>"
      : "",
    "<p>" + esc(text.app) + "</p>",
    "</main></body></html>",
  ].join("\n");
  return new Response(html, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" },
  });
}

async function authorize(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.OAUTH_KV) return jsonResponse({ error: "OAuth 가 아직 준비되지 않았어요." }, 503);
  const human = await humanFor(request, env);
  if (!human) return redirect("/login?next=" + encodeURIComponent(url.pathname + url.search));
  if (betaClosed(env) && human.session && !(await hasBetaAccess(env, human.session))) return redirect("/beta");
  const oauth = authorizationServer(url.origin).getOAuthApi(env);
  const kv = env.OAUTH_KV as ConsentKv;
  const user = oauthUserId(human.ws);
  let restart: string | null = request.method === "GET" ? url.search : null;
  try {
    if (request.method === "GET") {
      const parsed = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(parsed);
      const handle = newConsentHandle();
      const pending: PendingConsent = { request: parsed, user, exp: Date.now() + CONSENT_TTL_SECONDS * 1000 };
      await kv.put("acard-consent:" + (await consentId(handle)), await seal(handle, pending), { expirationTtl: CONSENT_TTL_SECONDS });
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "frame-ancestors 'none'",
        "x-frame-options": "DENY",
        "referrer-policy": "same-origin",
      });
      return withCookies(new Response(consentPage(env, details, handle, url.search), { headers }), human.set);
    }
    if (request.method === "POST") {
      const source = postSource(request, url.origin);
      if (source === "cross_site") return consentProblemPage(request, "cross_site", null);
      const form = await request.formData();
      restart = String(form.get("restart") ?? "") || null;
      if (source === "unverified") return consentProblemPage(request, "unverified", restart);
      const handle = String(form.get("handle") ?? "");
      if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) return consentProblemPage(request, "invalid", restart);
      const id = await consentId(handle);
      const pending = await unseal<PendingConsent>(handle, await kv.get("acard-consent:" + id));
      const db = (env as unknown as { DB: ConsentDb }).DB;
      const now = Date.now();
      // Already answered: the same person re-sending approve within a minute gets the same redirect back, anyone else or
      // anything later gets the restart page.
      const answered = async () => {
        const row = await db.prepare("SELECT done, created FROM oauth_consent_claims WHERE id = ?").bind(id).first().catch(() => null);
        const done = row && Number(row.created) > now - CONSENT_DONE_TTL_SECONDS * 1000 ? await unseal<{ user: string; redirectTo: string }>(handle, row.done as string | null) : null;
        if (done && done.user === user && form.get("decision") === "approve") return new Response(null, { status: 302, headers: { location: done.redirectTo, "cache-control": "no-store" } });
        return consentProblemPage(request, "expired", restart);
      };
      if (!pending || pending.exp <= now) return answered();
      if (pending.user !== user) return consentProblemPage(request, "other_user", restart);
      if (!(await claimConsent(db, id, now))) return answered();
      await kv.delete("acard-consent:" + id);
      if (form.get("decision") !== "approve") {
        return new Response(null, { status: 302, headers: { location: authorizationErrorRedirect(pending.request, "access_denied"), "cache-control": "no-store" } });
      }
      const chosen = form.getAll("scope").map(String);
      const scope = grantedScopes(chosen).concat(chosen.includes("offline_access") && pending.request.scope.includes("offline_access") ? ["offline_access"] : []);
      const approved: AuthRequest = { ...pending.request, scope };
      const client = await oauth.lookupClient(approved.clientId);
      const agent = (client?.clientName || approved.clientId).slice(0, 60);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved,
        userId: user,
        metadata: { agent },
        scope: approved.scope,
        props: { agent } satisfies GrantProps,
      });
      await db.prepare("UPDATE oauth_consent_claims SET done = ? WHERE id = ?").bind(await seal(handle, { user, redirectTo }), id).run();
      const grantId = new URL(redirectTo).searchParams.get("code")?.split(":")[1];
      if (grantId) await (await acardHost.tokenAdmin(human.env)).recordGrant({ id: grantId, clientName: agent, scopes: approved.scope });
      return new Response(null, { status: 302, headers: { location: redirectTo, "cache-control": "no-store" } });
    }
    return jsonResponse({ error: "지원하지 않는 방법이에요." }, 405);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const detail = error instanceof AuthorizationError ? error.description : "client metadata";
      return consentProblemPage(request, "invalid", null, detail);
    }
    throw error;
  }
}

async function agentAdmin(request: Request, env: Env, url: URL, human: Human): Promise<Response> {
  const path = url.pathname.slice("/api/agents".length);
  const method = request.method.toUpperCase();
  if (path === "/connect" && method === "GET") {
    return jsonResponse({
      endpoints: {
        mcp: url.origin + "/mcp",
        sse: url.origin + "/sse",
        openapi: url.origin + "/api/v1/openapi.json",
        llms: url.origin + "/llms.txt",
        agentsMd: url.origin + "/AGENTS.md",
        cliPackage: url.origin + "/acard-cli.tgz",
      },
      clients: connectClients(url.origin),
    });
  }
  const admin = await acardHost.tokenAdmin(human.env);
  if (path === "/tokens" && method === "GET") return jsonResponse({ tokens: await admin.list() });
  if (path === "/tokens" && method === "POST") {
    try {
      const created = await admin.create(await request.json());
      const shown = human.ws === OWNER_WS ? created.token : memberToken(human.ws, created.token);
      return jsonResponse({ ...created, token: shown }, 201);
    } catch (error) {
      if (acardHost.isAgentError(error)) return jsonResponse({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return jsonResponse({ error: "JSON 본문을 읽지 못했어요." }, 400);
      throw error;
    }
  }
  const tokenMatch = /^\/tokens\/([^/]+)$/.exec(path);
  if (tokenMatch && method === "DELETE") {
    return (await admin.revoke(decodeURIComponent(tokenMatch[1]))) ? jsonResponse({ ok: true }) : jsonResponse({ error: "없거나 이미 끊은 토큰이에요." }, 404);
  }
  if (path === "/grants" && method === "GET") return jsonResponse({ grants: await admin.listGrants() });
  const grantMatch = /^\/grants\/([^/]+)$/.exec(path);
  if (grantMatch && method === "DELETE") {
    if (!env.OAUTH_KV) return jsonResponse({ error: "OAuth 가 아직 준비되지 않았어요." }, 503);
    const grantId = decodeURIComponent(grantMatch[1]);
    await authorizationServer(url.origin).getOAuthApi(env).revokeGrant(grantId, oauthUserId(human.ws));
    await admin.markGrantRevoked(grantId);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "없는 API예요." }, 404);
}

async function revokeAllGrants(env: Env, origin: string, userId: string): Promise<number> {
  if (!env.OAUTH_KV) return 0;
  const api = authorizationServer(origin).getOAuthApi(env);
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await api.listUserGrants(userId, cursor ? { cursor } : undefined);
    for (const grant of page.items) { await api.revokeGrant(grant.id, userId); removed += 1; }
    cursor = page.cursor;
  } while (cursor);
  return removed;
}

const TRANSLATED_SITE = new Set(["index", "login", "signup", "forgot", "reset", "beta", "onboarding"]);
const LEGAL = new Set(["terms", "privacy"]);

async function sitePage(request: Request, env: Env, name: string, extra: string[] = [], lang: Lang = pickLang(request)): Promise<Response> {
  const file = LEGAL.has(name) && lang !== "ko" ? name + "." + lang : name;
  const asset = await env.ASSETS.fetch(new Request(new URL("/_site/" + file + ".html", request.url)));
  if (!asset.ok) return new Response("화면을 찾지 못했어요.", { status: 500 });
  const res = new Response(asset.body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", vary: "Cookie" } });
  const page = name === "index" ? rewriteLanding(res, env) : res;
  return withCookies(TRANSLATED_SITE.has(name) ? translateHtml(page, lang) : LEGAL.has(name) ? page : injectAppLang(page, lang), extra);
}

async function settingsPage(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(new URL("/agents.html", request.url)));
  if (!asset.ok) return new Response("설정 화면을 찾지 못했어요.", { status: 500 });
  return new Response(asset.body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

const PUBLIC_SITE: Record<string, string> = { "/login": "login", "/signup": "signup", "/forgot": "forgot", "/reset": "reset", "/terms": "terms", "/privacy": "privacy" };
const AGENT_PATH = /^\/(?:api\/v1(?:\/|$)|mcp(?:\/|$)|sse(?:\/|$)|oauth\/|\.well-known\/|llms\.txt$|AGENTS\.md$|acard-cli\.tgz$)/;
const SITE_HOST = "notes.example.com";
const LEGACY_HOSTS = new Set(["old.notes.example.com", "legacy.notes.example.com", "www.notes.example.com"]);

async function routeLoggedIn(request: Request, env: Env, url: URL, ctx: unknown, human: Human): Promise<Response> {
  const path = url.pathname;
  if (path === "/app" || path === "/app/" || path === "/app.html") return withCookies(redirect("/" + url.search), human.set);
  if (path === "/onboarding" || path === "/onboarding/" || path === "/settings" || path === "/settings/") {
    return sitePage(request, env, path.startsWith("/onboarding") ? "onboarding" : "settings", human.set, human.session ? pickUserLang(request) : pickLang(request));
  }
  if (path.replace(/\/$/, "") === "/reset") return sitePage(request, env, "reset", human.set);
  if (PUBLIC_SITE[path.replace(/\/$/, "")]) return withCookies(redirect("/"), human.set);
  if (human.session && (path === "/" || path === "/index.html") && request.method === "GET") {
    const profile = await loadProfile(env, human.session).catch(() => undefined);
    if (profile === null || (profile && !profile.onboarded_at)) return withCookies(redirect("/onboarding"), human.set);
    if (profile && isLang(profile.lang) && !/(?:^|;\s*)acard_lang=/.test(request.headers.get("cookie") ?? "")) {
      return withCookies(redirect("/" + url.search), [...human.set, langCookie(profile.lang)]);
    }
  }
  const response = await core.fetch(request, human.env, ctx);
  return withCookies(injectAppLang(human.session ? injectAppBeta(response) : response, human.session ? pickUserLang(request) : pickLang(request)), human.set);
}

async function agentTick(request: Request, env: Env): Promise<Response> {
  const given = request.headers.get("x-agent-tick") ?? "";
  if (!env.AGENT_TICK_SECRET || !sameSecret(given, env.AGENT_TICK_SECRET)) return jsonResponse({ error: "not found" }, 404);
  const body = (await request.json().catch(() => ({}))) as { session?: unknown; ws?: unknown };
  const session = typeof body.session === "string" ? body.session : "";
  const ws = typeof body.ws === "string" ? body.ws : OWNER_WS;
  if (!/^s[a-z0-9]{6,30}$/.test(session) || (ws !== OWNER_WS && !/^[0-9a-f]{32}$/.test(ws))) return jsonResponse({ error: "bad request" }, 400);
  if (ws !== OWNER_WS && !env.WORKSPACE) return jsonResponse({ error: "not found" }, 404);
  const result = await acardHost.agentStep(scoped(env, ws), session);
  return jsonResponse(result);
}

// Repeating row templates (notion-parity C5): the acard-workspace Worker calls this from a member workspace's alarm
// ({ws:<hex>}) or from its 15-minute cron ({ws:"owner"}). Same shape as agentTick: secret header or 404, ws checked,
// and the store is fixed to that workspace by scoped(), so one call can never touch another workspace.
async function recurringTick(request: Request, env: Env): Promise<Response> {
  const given = request.headers.get("x-recurring-tick") ?? "";
  if (!env.RECURRING_TICK_SECRET || !sameSecret(given, env.RECURRING_TICK_SECRET)) return jsonResponse({ error: "not found" }, 404);
  const body = (await request.json().catch(() => ({}))) as { ws?: unknown; now?: unknown };
  const ws = typeof body.ws === "string" ? body.ws : "";
  if (ws !== OWNER_WS && !/^[0-9a-f]{32}$/.test(ws)) return jsonResponse({ error: "bad request" }, 400);
  if (ws !== OWNER_WS && !env.WORKSPACE) return jsonResponse({ error: "not found" }, 404);
  const now = typeof body.now === "number" && Number.isFinite(body.now) ? body.now : Date.now();
  return jsonResponse(await acardHost.recurringTick(scoped(env, ws), now));
}

// KV -> R2 move of media originals (2026-10-20), driven page by page by scripts/media-to-r2.ts. Secret header or 404.
// {seed:true} sets the global usage ledger to the bytes actually in R2.
async function mediaMigrate(request: Request, env: Env & { MEDIA?: any }): Promise<Response> {
  const given = request.headers.get("x-media-migrate") ?? "";
  if (!env.MEDIA_MIGRATE_SECRET || !sameSecret(given, env.MEDIA_MIGRATE_SECRET)) return jsonResponse({ error: "not found" }, 404);
  const kv = env.MEDIA?.kv, r2 = env.MEDIA_R2;
  if (!kv || !r2) return jsonResponse({ error: "MEDIA and MEDIA_R2 are both needed" }, 503);
  const body = (await request.json().catch(() => ({}))) as { cursor?: unknown; limit?: unknown; seed?: unknown };
  if (body.seed === true) {
    const usage = await r2Usage(r2);
    const ledger = (env.WORKSPACE as any)?.get((env.WORKSPACE as any).idFromName("global:media"));
    const row = ledger ? await ledger.mediaSetUsage(usage.bytes) : null;
    return jsonResponse({ ...usage, ledger: row });
  }
  const limit = typeof body.limit === "number" && body.limit > 0 && body.limit <= 100 ? body.limit : 40;
  return jsonResponse(await migrateMediaPage(kv, r2, typeof body.cursor === "string" ? body.cursor : undefined, limit));
}

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// notes.example.com is served by the acard-site Worker, which forwards every request here with a shared secret.
// Only then is the public host restored, so origins, cookies, redirects and OAuth issuer all read notes.example.com.
function unforward(request: Request, env: Env): Request {
  const given = request.headers.get("x-acard-forward");
  if (!given) return request;
  const headers = new Headers(request.headers);
  headers.delete("x-acard-forward");
  const host = headers.get("x-acard-host");
  headers.delete("x-acard-host");
  const client = headers.get("x-acard-client-ip");
  headers.delete("x-acard-client-ip");
  if (!env.FORWARD_SECRET || !sameSecret(given, env.FORWARD_SECRET) || host !== SITE_HOST) return new Request(request, { headers });
  if (client) headers.set("cf-connecting-ip", client);
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
  return new Request("https://" + SITE_HOST + url.pathname + url.search, { method: request.method, headers, body, redirect: "manual", ...(body ? { duplex: "half" } : {}) } as RequestInit);
}

const entry = {
  async fetch(incoming: Request, env: Env, ctx: unknown): Promise<Response> {
    const request = unforward(incoming, env);
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;

    if (LEGACY_HOSTS.has(url.hostname) && env.LEGACY_MODE !== "serve") {
      const target = "https://" + SITE_HOST + path + url.search;
      if (url.hostname === "www.notes.example.com" || env.LEGACY_MODE === "redirect-all" || !AGENT_PATH.test(path)) return Response.redirect(target, 301);
    }
    if (!env.GATE_PASSWORD || !env.GATE_SECRET) return core.fetch(request, env, ctx);
    const switched = langSwitch(request, url);
    if (switched) return switched;

    if (request.method === "GET") {
      if (path === "/api/v1/openapi.json") return jsonResponse(openapiSpec(origin));
      if (path === "/llms.txt") return textResponse(llmsTxt(origin), "text/plain");
      if (path === "/AGENTS.md") return textResponse(agentsMd(origin), "text/markdown");
      if (path === "/acard-cli.tgz") return env.ASSETS.fetch(request);
      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") return protectedResourceMetadata(origin, origin + "/mcp");
      if (path === "/.well-known/oauth-protected-resource/api/v1") return protectedResourceMetadata(origin, origin + "/api/v1");
      if (path.startsWith("/_site/") || path.startsWith("/fonts/") || /^\/i18n\/app-(?:en|zh)\.json$/.test(path)) return env.ASSETS.fetch(request);
      if (/^\/(?:wordmark(?:-symbol|-mono)?|logo(?:-small|-16|-square|-square-dark)?|favicon|icon-maskable)\.svg$/.test(path) || /^\/(?:logo-square(?:-dark)?|og-square|icon-maskable-(?:192|512))\.png$/.test(path)) return env.ASSETS.fetch(request);
      if (path === "/gallery" || path === "/gallery/") return env.ASSETS.fetch(new Request(origin + "/gallery.html"));
      if (path === "/gallery.css") return env.ASSETS.fetch(request);
    }

    if (path === "/oauth/authorize") return authorize(request, env, url);
    if (path === "/oauth/token" || path === "/oauth/register" || path.startsWith("/.well-known/oauth-authorization-server")) {
      if (!env.OAUTH_KV) return jsonResponse({ error: "OAuth 가 아직 준비되지 않았어요." }, 503);
      return authorizationServer(origin).fetch(request, env, ctx as ExecutionContext);
    }

    const bearerSave = request.method === "PUT" && /^\/api\/page\//.test(path) && Boolean(bearer(request));
    const resource = resourceFor(path, origin) || (bearerSave ? origin + "/api/v1" : null);
    if (resource) {
      const blocked = path.startsWith("/api/v1/") ? null : checkOrigin(request, origin);
      if (blocked) return blocked;
      const principal = await authenticate(request, env, origin, resource);
      if (!principal) return challenge(origin, resource);
      const user = principal.ws === OWNER_WS ? env.OWNER_USER_ID : principal.ws.replace(/^(........)(....)(....)(....)(............)$/, "$1-$2-$3-$4-$5");
      if (user) env.ACARD_IDENTITY?.(user + ":" + principal.ws);
      if (bearerSave) {
        if (!principal.scopes.includes("write")) return jsonResponse({ error: "write_required" }, 403);
        const narrowed = acardHost.trust({ ...scoped(env, principal.ws), ACARD_SAVE_PRINCIPAL: principal });
        return core.fetch(request, narrowed, ctx);
      }
      if (path === "/mcp" && request.method === "GET") {
        return new Response(null, { status: 405, headers: { allow: "POST, DELETE", "cache-control": "no-store" } });
      }
      if (path === "/mcp") return mcpResponse(request, principal);
      if (path.startsWith("/sse")) return serveSse(request, env, url, principal);
      return acardHost.serveV1(request, principal.env, principal);
    }

    if (ACCOUNT_API.test(path)) {
      await humanFor(request, env);
      return localizeJson(await accountApi(request, env, url, (userId) => revokeAllGrants(env, origin, userId)), pickLang(request));
    }

    const memberShare = MEMBER_SHARE.exec(path);
    if (memberShare) {
      if (!env.WORKSPACE) return new Response("없는 페이지예요.", { status: 404 });
      const inner = new Request(origin + "/p" + memberShare[2], { method: request.method, headers: request.headers });
      return core.fetch(inner, scoped(env, memberShare[1]), ctx);
    }
    if (path.startsWith("/p/")) return core.fetch(request, scoped(env, OWNER_WS), ctx);
    const shareRoute = SHARE_PATH.exec(path);
    if (shareRoute) {
      const ws = shareRoute[1] === "o" ? OWNER_WS : shareRoute[1];
      if (ws !== OWNER_WS && !env.WORKSPACE) return new Response("없는 페이지예요.", { status: 404 });
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
      const inner = new Request(origin + "/s" + shareRoute[2] + url.search, { method: request.method, headers: request.headers, body, ...(body ? { duplex: "half" } : {}) } as RequestInit);
      return core.fetch(inner, scoped(env, ws), ctx);
    }

    if (path === "/__agent/tick" && request.method === "POST") return agentTick(request, env);
    if (path === "/__recurring/tick" && request.method === "POST") return recurringTick(request, env);
    if (path === "/__media/migrate" && request.method === "POST") return mediaMigrate(request, env);

    const human = await humanFor(request, env);
    if (ADMIN_PATH.test(path)) {
      const response = await adminRoute(request, env as unknown as AdminEnv, url, human?.session ?? null, {
        revokeGrants: (userId) => revokeAllGrants(env, origin, oauthUserId(workspaceIdFor(userId, env))),
        revokeTokens: async (ws) => {
          const admin = await acardHost.tokenAdmin(scoped(env, ws));
          let n = 0;
          for (const t of await admin.list()) if (!t.revoked && (await admin.revoke(t.id))) n += 1;
          return n;
        },
      });
      return withCookies(response, human?.set ?? []);
    }
    if (path === "/api/me/ai-usage" && request.method === "GET") {
      if (!human?.session) return jsonResponse({ error: "로그인이 필요해요." }, 401);
      return withCookies(await myUsage(env as unknown as AdminEnv, human.session), human.set);
    }
    if (BETA_API.test(path)) return withCookies(await localizeJson(await betaApi(request, env, url, human?.session ?? null), human?.session ? pickUserLang(request) : pickLang(request)), human?.set ?? []);
    const bare = path.replace(/\/$/, "");
    if (bare === "/beta") {
      if (human?.session && (!betaClosed(env) || (await hasBetaAccess(env, human.session)))) return withCookies(redirect("/"), human.set);
      return sitePage(request, env, "beta", human?.set ?? []);
    }
    if (bare === "/admin/beta") {
      if (!human) return redirect("/login?next=/admin/beta");
      if (!(await isBetaAdmin(env, human.session))) return new Response("관리자만 볼 수 있어요.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
      return sitePage(request, env, "admin-beta", human.set);
    }
    if (human?.session && betaClosed(env) && !PUBLIC_SITE[bare] && path !== "/__logout" && path !== "/sw.js" && !/^\/[\w.-]+\.(?:css|js|svg|png|ico|webmanifest)$/.test(path) && !(await hasBetaAccess(env, human.session))) {
      const html = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
      if (html) return withCookies(redirect("/beta"), human.set);
      return withCookies(await localizeJson(jsonResponse({ error: "beta_required", message: "초대 코드를 넣어 주세요." }, 403), pickUserLang(request)), human.set);
    }
    // The old /connect page is merged into 설정 > 에이전트 연결 (owner pick, 2026-10-20); old links land there.
    if (path === "/connect" || path === "/connect/") return new Response(null, { status: 301, headers: { location: "/settings/agents/" + url.search, "cache-control": "no-store" } });
    if (path === "/api/agents" || path.startsWith("/api/agents/") || path === "/settings/agents" || path === "/settings/agents/") {
      if (!human && path.startsWith("/settings/")) return redirect("/login?next=/settings/agents/");
      if (!human) return jsonResponse({ error: "로그인이 필요해요." }, 401);
      if (path.startsWith("/settings/")) return withCookies(injectAppLang(await settingsPage(request, env), human.session ? pickUserLang(request) : pickLang(request)), human.set);
      return withCookies(await agentAdmin(request, env, url, human), human.set);
    }

    if (path === "/__logout" && request.method === "POST") {
      const jar = readCookies(request);
      const headers = new Headers({ location: "/", "cache-control": "no-store" });
      for (const value of [...clearSessionCookies(), setCookie("dn_auth", "", 0), setCookie("acard_guest", "", 0)]) headers.append("set-cookie", value);
      if (jar.acard_at && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
        await fetch(env.SUPABASE_URL + "/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, authorization: "Bearer " + jar.acard_at } }).catch(() => null);
      }
      return new Response(null, { status: 303, headers });
    }
    if (path === "/__gate") return redirect("/login");

    // An open guest session (a verified invite) wins over a signed-in account so invited Acard users can read what was
    // shared with them; POST /s/<ws>/logout returns them to their own workspace.
    const guest = guestEnv(env, request);
    if (path === "/api/live" && request.method === "GET") {
      if (!env.LIVE) return jsonResponse({ error: "live feed is not bound" }, 503);
      if (guest) {
        const tree = await core.fetch(new Request(origin + "/api/tree", { headers: request.headers }), guest, ctx);
        if (!tree.ok) return jsonResponse({ error: "권한이 없어요." }, 401);
        const pages = ((await tree.json()) as { pages?: { slug: string }[] }).pages ?? [];
        const ws = (guest as Env & { ACARD_WORKSPACE?: string }).ACARD_WORKSPACE ?? OWNER_WS;
        return liveConnect(env.LIVE, ws, request, pages.map((p) => String(p.slug)));
      }
      if (!human) return jsonResponse({ error: "로그인이 필요해요." }, 401);
      if (betaClosed(env) && human.session && !(await hasBetaAccess(env, human.session))) return jsonResponse({ error: "beta_required" }, 403);
      return liveConnect(env.LIVE, human.ws, request, null);
    }
    if (guest) {
      const response = await core.fetch(request, guest, ctx);
      env.ACARD_IDENTITY?.(response.status === 401 || response.status === 403 ? null : GUEST_COOKIE.exec(readCookies(request).acard_guest ?? "")![2], true);
      return response;
    }
    if (human) return routeLoggedIn(request, env, url, ctx, human);

    const page = PUBLIC_SITE[path.replace(/\/$/, "")];
    if (page) return sitePage(request, env, page);
    if ((path === "/" || path === "/index.html") && request.method === "GET") return sitePage(request, env, "index");
    if (path === "/sw.js") return core.fetch(request, env, ctx);
    if (/^\/[\w.-]+\.(?:css|js|svg|png|ico|webmanifest)$/.test(path) || path.startsWith("/img/") || path.startsWith("/lazy/")) return env.ASSETS.fetch(request);
    if (request.method === "GET" && !path.startsWith("/api/") && (request.headers.get("accept") ?? "").includes("text/html")) return redirect("/login?next=" + encodeURIComponent(path + url.search));
    return jsonResponse({ error: "로그인이 필요해요." }, 401);
  },
};

// #44/#57: the pooler out of connections, or Hyperdrive dropping a pooled socket - both pass on their own.
const DB_TRANSIENT = /EMAXCONN|max clients reached|too many clients|remaining connection slots|Network connection lost|CONNECTION_CLOSED|CONNECTION_ENDED|connection terminated/i;
const isDbTransient = (error: unknown) => (error as { code?: string } | null)?.code === "53300" || DB_TRANSIENT.test(String((error as Error | null)?.message ?? error));

const BUSY_HTML = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>잠시만요 · Acard</title><link rel="stylesheet" href="/style.css"></head><body><main id="main" class="missing busy" data-retry="1" role="status"><h1>잠시 연결이 몰렸어요, 다시 시도 중…</h1><p>페이지는 그대로 있어요. 곧 다시 불러올게요.</p><p><button type="button" onclick="location.reload()">지금 다시 시도</button></p></main><script>setTimeout(function(){location.reload()},3000)</script></body></html>';
function busyResponse(request: Request): Response {
  const html = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  return new Response(html ? BUSY_HTML : JSON.stringify({ error: "잠시 연결이 몰렸어요. 곧 다시 시도해 주세요.", retry: true }), {
    status: 503,
    headers: { "content-type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "2", "x-robots-tag": "noindex, nofollow" },
  });
}

async function identityResponse(response: Response, value: string | null, guest = false): Promise<Response> {
  if (!value || response.status === 101) return response;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const id = (guest ? "g-" : "") + Array.from(new Uint8Array(digest).slice(0, 8), byte => byte.toString(16).padStart(2, "0")).join("");
  const headers = new Headers(response.headers);
  headers.set("x-acard-id", id);
  // The service worker cannot read the HttpOnly session; this readable copy of the (non-secret) identity hash lets it
  // refuse a cached page when the session changed by any route it did not see (acard-speed-2 cache-safety Q1).
  // A response that signs out (clears acard_at / acard_id) keeps that clearing as the last word.
  if (!/(?:^|,\s*)acard_(?:at|id)=;/.test(headers.get("set-cookie") ?? "")) headers.append("set-cookie", `acard_id=${id}; Path=/; Secure; SameSite=Lax; Max-Age=2592000`);
  if (!/^text\/html\b/i.test(headers.get("content-type") ?? "")) return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  headers.delete("content-length");
  if (/\bpublic\b/i.test(headers.get("cache-control") ?? "")) headers.set("cache-control", "private, no-store");
  const html = (await response.text()).replace(/<head\b[^>]*>/i, head => head + '<meta name="acard-id" content="' + id + '">');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(incoming: Request, raw: Env, ctx: unknown): Promise<Response> {
    const off = serviceWorkerOff(incoming);
    if (off) return off;
    const backend = withDataBackend(withR2Media(raw) as Env & DataEnv);
    const keep = (ctx as { waitUntil?(p: Promise<unknown>): void } | undefined)?.waitUntil?.bind(ctx);
    let response: Response | null = null;
    const started = Date.now();
    const sinks: Sink[] = [];
    let identity: string | null = null;
    let guestIdentity = false;
    let identityResolved = false;
    const identify = (value: string | null, guest = false) => { identity = value; guestIdentity = guest; identityResolved = true; };
    const ownerSink = newSink(OWNER_WS);
    sinks.push(ownerSink);
    const liveTrack = <T,>(ws: string, db: T): T => { const sink = newSink(ws); sinks.push(sink); return trackDb(db, sink); };
    try {
      const tracked = { ...(backend.env as Env), DB: trackDb((backend.env as Env & { DB?: unknown }).DB, ownerSink), ACARD_LIVE_TRACK: liveTrack, ACARD_IDENTITY: identify } as Env;
      const waitEnv = keep ? { ...tracked, ACARD_WAIT: keep } : tracked;
      response = await entry.fetch(incoming, waitEnv as Env, ctx);
      const path = new URL(incoming.url).pathname;
      const cookies = response.headers.get("set-cookie") ?? "";
      const sessionCookie = /(?:^|,\s*)acard_at=([^;]+)/.exec(cookies)?.[1];
      const guestCookie = /(?:^|,\s*)acard_guest=([^;]+)/.exec(cookies)?.[1];
      if (!path.startsWith("/p/") && sessionCookie) {
        const headers = new Headers(incoming.headers);
        headers.set("cookie", "acard_at=" + sessionCookie);
        await humanFor(new Request(incoming.url, { headers }), tracked);
      } else if (guestCookie && GUEST_COOKIE.test(guestCookie)) identify(GUEST_COOKIE.exec(guestCookie)![2], true);
      else if (!identityResolved && !path.startsWith("/p/") && !path.startsWith("/s/") && !readCookies(incoming).acard_guest && response.status < 400 && (/^text\/html\b/i.test(response.headers.get("content-type") ?? "") || path.startsWith("/api/"))) await humanFor(incoming, tracked);
      response = await identityResponse(response, identity, guestIdentity);
    } catch (error) {
      console.error("acard request failed", (raw as Env & DataEnv).DATA_BACKEND ?? "d1", error instanceof Error ? error.stack ?? error.message : String(error));
      keep?.(backend.done().catch(() => undefined));
      // #44: a busy database pooler that escaped a handler must not become Cloudflare error 1101; the person sees the
      // retrying page and an app/agent call gets 503 + Retry-After.
      if (isDbTransient(error)) return busyResponse(incoming);
      throw error;
    }
    const src = incoming.headers.get("x-acard-client") ?? "";
    // Reads can self-heal rows (member home, seed stamps); publishing those would make every open tab re-read and loop.
    const reads = incoming.method === "GET" || incoming.method === "HEAD";
    const notify = () => (reads ? Promise.resolve() : livePublish((raw as Env).LIVE, sinks, /^[\w-]{1,40}$/.test(src) ? src : ""));
    if (response.status === 101) { keep?.(backend.done().catch(() => undefined)); return response; }
    // A streamed reply (agent chat) keeps using the database after the Response is returned, so the connection
    // closes only when its body ends.
    if (response.body && (response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
      const { readable, writable } = new TransformStream();
      const piped = response.body.pipeTo(writable).catch(() => undefined).then(() => notify()).then(() => backend.done().catch(() => undefined));
      keep?.(piped);
      return new Response(readable, response);
    }
    keep?.(notify().then(() => backend.done().catch(() => undefined)));
    response = cacheVersioned(incoming, response, (globalThis as { ACARD_STATIC_VERSIONS?: Record<string, string> }).ACARD_STATIC_VERSIONS);
    if (new URL(incoming.url).pathname.startsWith("/api/") || /^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
      const t = backend.timing;
      const timed = new Response(response.body, response);
      timed.headers.append("server-timing", `total;dur=${Date.now() - started}, ` + (sinks.length > 1 ? 'db;desc="workspace query timing unavailable"' : `db;dur=${t.ms};desc="${t.n} queries", dbfirst;dur=${t.first}`));
      return timed;
    }
    return response;
  },
};
