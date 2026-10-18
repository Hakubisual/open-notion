import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
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
import { injectAppLang, isLang, langCookie, langSwitch, localizeJson, pickLang, translateHtml } from "./i18n";

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
};

type GrantProps = { readonly agent: string };
type Principal = AgentPrincipal & { readonly key: string; readonly env: Env; readonly ws: string };

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
    return found ? { name: found.name, via: "token", scopes: found.scopes, key: keyFor(ws, "token:" + found.tokenId), env: wsEnv, ws } : null;
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

function consentPage(env: Env, details: { clientName: string; redirectHost: string; redirectIsLoopback: boolean; scope: string[] }, handle: string): string {
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
    '<form method="post" action="/oauth/authorize">',
    '<input type="hidden" name="handle" value="' + esc(handle) + '">',
    "<fieldset><legend>허락할 일</legend>" + boxes + "</fieldset>" + keep,
    '<p class="actions"><button name="decision" value="approve">허락하기</button> <button name="decision" value="deny" class="secondary">거절하기</button></p>',
    "</form></main></body></html>",
  ].join("\n");
}

type Human = { ws: string; env: Env; set: string[]; session: Session | null };

// Who is at the keyboard: a signed-in notes.example.com account (any workspace) or, during the move, the owner's password ticket.
async function humanFor(request: Request, env: Env): Promise<Human | null> {
  const session = await readSession(request, env).catch(() => null);
  if (session) {
    if (await isSuspended(env as unknown as AdminEnv, session.user.sub)) return null;
    const ws = workspaceIdFor(session.user.sub, env);
    if (ws !== OWNER_WS && !env.WORKSPACE) return null;
    return { ws, env: scoped(env, ws), set: session.set, session };
  }
  return null;
}

async function authorize(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.OAUTH_KV) return jsonResponse({ error: "OAuth 가 아직 준비되지 않았어요." }, 503);
  const human = await humanFor(request, env);
  if (!human) return redirect("/login?next=" + encodeURIComponent(url.pathname + url.search));
  if (betaClosed(env) && human.session && !(await hasBetaAccess(env, human.session))) return redirect("/beta");
  const oauth = authorizationServer(url.origin).getOAuthApi(env);
  try {
    if (request.method === "GET") {
      const parsed = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(parsed);
      const consent = await oauth.beginConsent(parsed);
      consent.headers.set("content-type", "text/html; charset=utf-8");
      consent.headers.set("cache-control", "no-store");
      return withCookies(new Response(consentPage(env, details, consent.handle), { headers: consent.headers }), human.set);
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        denied.headers.set("location", denied.redirectTo);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const chosen = form.getAll("scope").map(String);
      const scope = grantedScopes(chosen).concat(chosen.includes("offline_access") ? ["offline_access"] : []);
      const approved = await oauth.approveConsent(request, handle, { scope });
      const client = await oauth.lookupClient(approved.request.clientId);
      const agent = (client?.clientName || approved.request.clientId).slice(0, 60);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request as AuthRequest,
        userId: oauthUserId(human.ws),
        metadata: { agent },
        scope: approved.request.scope,
        props: { agent } satisfies GrantProps,
      });
      const grantId = new URL(redirectTo).searchParams.get("code")?.split(":")[1];
      if (grantId) await (await acardHost.tokenAdmin(human.env)).recordGrant({ id: grantId, clientName: agent, scopes: approved.request.scope });
      approved.headers.set("location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return jsonResponse({ error: "지원하지 않는 방법이에요." }, 405);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : "이 앱 정보를 확인하지 못했어요.";
      return new Response(acardHost.escapeHtml(message), { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
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

async function sitePage(request: Request, env: Env, name: string, extra: string[] = []): Promise<Response> {
  const lang = pickLang(request);
  const file = LEGAL.has(name) && lang !== "ko" ? name + "." + lang : name;
  const asset = await env.ASSETS.fetch(new Request(new URL("/_site/" + file + ".html", request.url)));
  if (!asset.ok) return new Response("화면을 찾지 못했어요.", { status: 500 });
  const res = new Response(asset.body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", vary: "Cookie, CF-IPCountry" } });
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
export const SITE_HOST = "notes.example.com";
const LEGACY_HOSTS = new Set(["old.notes.example.com", "legacy.notes.example.com", "www.notes.example.com"]);

async function routeLoggedIn(request: Request, env: Env, url: URL, ctx: unknown, human: Human): Promise<Response> {
  const path = url.pathname;
  if (path === "/app" || path === "/app/" || path === "/app.html") return withCookies(redirect("/" + url.search), human.set);
  if (path === "/onboarding" || path === "/onboarding/" || path === "/settings" || path === "/settings/") {
    return sitePage(request, env, path.startsWith("/onboarding") ? "onboarding" : "settings", human.set);
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
  return withCookies(injectAppLang(betaClosed(env) ? injectAppBeta(response) : response, pickLang(request)), human.set);
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

    const resource = resourceFor(path, origin);
    if (resource) {
      const blocked = path.startsWith("/api/v1/") ? null : checkOrigin(request, origin);
      if (blocked) return blocked;
      const principal = await authenticate(request, env, origin, resource);
      if (!principal) return challenge(origin, resource);
      if (path === "/mcp" && request.method === "GET") {
        return new Response(null, { status: 405, headers: { allow: "POST, DELETE", "cache-control": "no-store" } });
      }
      if (path === "/mcp") return mcpResponse(request, principal);
      if (path.startsWith("/sse")) return serveSse(request, env, url, principal);
      return acardHost.serveV1(request, principal.env, principal);
    }

    if (ACCOUNT_API.test(path)) return localizeJson(await accountApi(request, env, url, (userId) => revokeAllGrants(env, origin, userId)), pickLang(request));

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
    if (BETA_API.test(path)) return withCookies(await localizeJson(await betaApi(request, env, url, human?.session ?? null), pickLang(request)), human?.set ?? []);
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
      return withCookies(await localizeJson(jsonResponse({ error: "beta_required", message: "초대 코드를 넣어 주세요." }, 403), pickLang(request)), human.set);
    }
    if (path === "/connect" || path === "/connect/") {
      if (!human) return redirect("/login?next=/connect");
      const asset = await env.ASSETS.fetch(new Request(origin + "/connect.html"));
      return withCookies(injectAppLang(new Response(asset.body, { status: asset.ok ? 200 : 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } }), pickLang(request)), human.set);
    }
    if (path === "/api/agents" || path.startsWith("/api/agents/") || path === "/settings/agents" || path === "/settings/agents/") {
      if (!human) return jsonResponse({ error: "로그인이 필요해요." }, 401);
      if (path.startsWith("/settings/")) return withCookies(injectAppLang(await settingsPage(request, env), pickLang(request)), human.set);
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
    if (guest) return core.fetch(request, guest, ctx);
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

export default {
  async fetch(incoming: Request, raw: Env, ctx: unknown): Promise<Response> {
    const backend = withDataBackend(raw as Env & DataEnv);
    const keep = (ctx as { waitUntil?(p: Promise<unknown>): void } | undefined)?.waitUntil?.bind(ctx);
    let response: Response | null = null;
    const started = Date.now();
    const sinks: Sink[] = [];
    const ownerSink = newSink(OWNER_WS);
    sinks.push(ownerSink);
    const liveTrack = <T,>(ws: string, db: T): T => { const sink = newSink(ws); sinks.push(sink); return trackDb(db, sink); };
    try {
      const tracked = { ...(backend.env as Env), DB: trackDb((backend.env as Env & { DB?: unknown }).DB, ownerSink), ACARD_LIVE_TRACK: liveTrack } as Env;
      const waitEnv = keep ? { ...tracked, ACARD_WAIT: keep } : tracked;
      response = await entry.fetch(incoming, waitEnv as Env, ctx);
    } catch (error) {
      console.error("acard request failed", (raw as Env & DataEnv).DATA_BACKEND ?? "d1", error instanceof Error ? error.stack ?? error.message : String(error));
      keep?.(backend.done().catch(() => undefined));
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
    if (new URL(incoming.url).pathname.startsWith("/api/")) {
      const t = backend.timing;
      const timed = new Response(response.body, response);
      timed.headers.set("server-timing", `total;dur=${Date.now() - started}, db;dur=${t.ms};desc="${t.n} queries", dbfirst;dur=${t.first}`);
      return timed;
    }
    return response;
  },
};
