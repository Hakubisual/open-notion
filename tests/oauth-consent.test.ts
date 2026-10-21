// The agent OAuth consent step (acard-oauth-browser): the person approving must not need the browser cookie set when the
// consent page was shown (a different browser, an expired cookie or a re-sent form used to get "This authorization was
// not started in this browser; start again"), while replays, expiry, other accounts and cross-site posts stay refused.
import { Database } from "bun:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { pgD1 } from "../gate/pg-d1";
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleWorkerSource } from "./assemble-worker";

class FakeDurableObject { ctx: any; env: any; constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; } }
class FakeWorkerEntrypoint { ctx: any; env: any; constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; } }
mock.module("cloudflare:workers", () => ({ DurableObject: FakeDurableObject, WorkerEntrypoint: FakeWorkerEntrypoint }));

const SUPABASE = "https://supa.test";
const OWNER_UID = "00000000-0000-4000-8000-000000000001";
const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://notes.example.com";
const REDIRECT = "http://127.0.0.1:53682/callback";

function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []): any => ({
    sql, params,
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...(params as any[])) }),
    first: async () => sqlite.query(sql).get(...(params as any[])) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => { const out = []; for (const item of list) out.push(await item.run()); return out; },
  };
}

function sqlStorage(sqlite: Database) {
  return {
    sql: {
      exec: (sql: string, ...params: unknown[]) => { const rows = sqlite.query(sql).all(...(params as any[])) as any[]; return { toArray: () => rows, one: () => rows[0] }; },
      get databaseSize() { return 0; },
    },
    transactionSync: (fn: () => unknown) => sqlite.transaction(fn)(),
    deleteAll: async () => {},
  };
}

// Like Workers KV: expirationTtl against the (mockable) clock, and a read answers with the value as it was when the read
// was sent, after a network round trip, so two requests can both read a record before either one writes it back.
const kvRoundTrip = () => new Promise((resolve) => setTimeout(resolve, 2));
function memoryKv() {
  const map = new Map<string, { value: unknown; metadata: unknown; until: number }>();
  const live = (key: string) => { const hit = map.get(key); if (hit && hit.until <= Date.now()) { map.delete(key); return undefined; } return hit; };
  return {
    map,
    get: async (key: string, options?: any) => { const v = live(key)?.value ?? null; await kvRoundTrip(); return v !== null && (options === "json" || options?.type === "json") ? JSON.parse(String(v)) : v; },
    getWithMetadata: async (key: string) => live(key) ?? { value: null, metadata: null },
    put: async (key: string, value: unknown, options?: any) => { map.set(key, { value, metadata: options?.metadata ?? null, until: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : Infinity }); },
    delete: async (key: string) => { map.delete(key); },
    list: async (options: { prefix?: string } = {}) => ({ keys: [...map.keys()].filter((k) => k.startsWith(options.prefix ?? "") && live(k)).map((name) => ({ name })), list_complete: true }),
  };
}

let worker: any;
let env: any;
let keyPair: CryptoKeyPair;
let dir: string;
const realFetch = globalThis.fetch;
const b64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

async function jwt(sub: string) {
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: "k1", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ sub, email: sub.slice(0, 4) + "@test.dev", exp: Math.floor(Date.now() / 1000) + 3600, iss: SUPABASE + "/auth/v1", aud: "authenticated", role: "authenticated" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(head + "." + body));
  return "acard_at=" + head + "." + body + "." + b64url(sig);
}

const send = (request: Request) => worker.fetch(request, env, {}) as Promise<Response>;

let clientId = "";
const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
async function authorizeQuery(state = "st-" + Math.random().toString(36).slice(2)) {
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return "?" + new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: "read write", state, code_challenge: challenge, code_challenge_method: "S256", resource: ORIGIN + "/mcp" });
}

async function openConsent(cookie: string) {
  const res = await send(new Request(ORIGIN + "/oauth/authorize" + (await authorizeQuery()), { headers: { cookie, accept: "text/html" }, redirect: "manual" }));
  const html = await res.text();
  expect(res.status).toBe(200);
  return {
    res,
    handle: /name="handle" value="([^"]+)"/.exec(html)![1],
    restart: /name="restart" value="([^"]+)"/.exec(html)![1].replace(/&amp;/g, "&"),
  };
}

function approve(cookie: string, form: { handle: string; restart?: string }, headers: Record<string, string> = { origin: ORIGIN, "sec-fetch-site": "same-origin" }, decision = "approve") {
  const body = new URLSearchParams([["handle", form.handle], ["restart", form.restart ?? ""], ["decision", decision], ["scope", "read"], ["scope", "write"]]);
  return send(new Request(ORIGIN + "/oauth/authorize", { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded", ...headers }, body, redirect: "manual" }));
}

beforeAll(async () => {
  dir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "acard-oauth-consent-"));
  const core = join(dir, "acard-core.js");
  await writeFile(core, "const __mod = (function () {\n" + assembleWorkerSource() + "\n})();\nexport default __mod;\nexport const acardHost = __mod.acardHost;\n");
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", "gate", "agent-entry.ts")],
    format: "esm", target: "browser", conditions: ["workerd", "worker", "browser"], external: ["cloudflare:workers"],
    plugins: [{ name: "core", setup(build) { build.onResolve({ filter: /[\\/]acard-core\.js$/ }, () => ({ path: core })); } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const out = join(dir, "worker.mjs");
  await writeFile(out, await built.outputs[0].text());
  worker = (await import(out)).default;
  const { WorkspaceStore } = await import("../workers/acard-workspace/index.js");

  keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === SUPABASE + "/auth/v1/.well-known/jwks.json") return Response.json({ keys: [{ ...jwk, kid: "k1", alg: "ES256" }] });
    if (url.startsWith(SUPABASE + "/rest/v1/profiles")) return Response.json([{ id: "x", display_name: "t", avatar_url: null, handle: "t", use_case: null, onboarded_at: "2026-10-16T00:00:00Z" }]);
    if (url.startsWith(SUPABASE)) return Response.json([], { status: 200 });
    return realFetch(input, init);
  }) as typeof fetch;

  const stores = new Map<string, any>();
  env = {
    DB: d1(new Database(":memory:")),
    MEDIA: memoryKv(),
    OAUTH_KV: memoryKv(),
    GATE_PASSWORD: "pw", GATE_SECRET: "secret",
    OWNER_USER_ID: OWNER_UID,
    SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: "anon",
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    WORKSPACE: {
      idFromName: (name: string) => name,
      get: (id: string) => {
        if (!stores.has(id)) stores.set(id, new WorkspaceStore({ storage: sqlStorage(new Database(":memory:")) }, {}));
        return stores.get(id);
      },
    },
  };
  const reg = await send(new Request(ORIGIN + "/oauth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  }));
  expect(reg.status).toBe(201);
  clientId = ((await reg.json()) as { client_id: string }).client_id;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  setSystemTime();
  await rm(dir, { recursive: true, force: true });
});

describe("agent OAuth consent without the consent-page cookie", () => {
  test("approving from a browser that never got the consent cookie completes, and the code becomes a working MCP token", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    expect(consent.res.headers.get("x-frame-options")).toBe("DENY");
    // Only the Acard session goes back: no __Host-oauth-consent-* cookie, as in another browser/profile or after it expired.
    const res = await approve(cookie, consent);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    const code = location.searchParams.get("code")!;
    expect(code).toBeTruthy();
    expect(location.searchParams.get("iss")).toBe(ORIGIN);

    const token = await send(new Request(ORIGIN + "/oauth/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: ORIGIN + "/mcp" }),
    }));
    expect(token.status).toBe(200);
    const access = ((await token.json()) as { access_token: string }).access_token;
    const mcp = await send(new Request(ORIGIN + "/mcp", {
      method: "POST", headers: { authorization: "Bearer " + access, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
    expect(mcp.status).toBe(200);
    expect(JSON.stringify(await mcp.json())).toContain("tools");
  });

  test("two approves of one consent page sent at the same time yield one code, never two", async () => {
    const cookie = await jwt(UID_A);
    for (let round = 0; round < 5; round++) {
      const consent = await openConsent(cookie);
      const answers = await Promise.all([approve(cookie, consent), approve(cookie, consent), approve(cookie, consent)]);
      const codes = new Set(answers.filter((r) => r.status === 302).map((r) => new URL(r.headers.get("location")!).searchParams.get("code")).filter(Boolean));
      expect(codes.size).toBe(1);
      for (const r of answers) expect([302, 400]).toContain(r.status);
    }
  });

  test("a re-sent approve gets the same redirect, never a second code; deny after approve is refused", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    const first = await approve(cookie, consent);
    const again = await approve(cookie, consent);
    expect(first.status).toBe(302);
    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toBe(first.headers.get("location"));
    const deny = await approve(cookie, consent, undefined, "deny");
    expect(deny.status).toBe(400);
  });

  test("a replayed handle after its short answer window is refused with the Korean restart page", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    expect((await approve(cookie, consent)).status).toBe(302);
    setSystemTime(new Date(Date.now() + 61_000));
    try {
      const replay = await approve(cookie + "; acard_lang=ko", consent);
      expect(replay.status).toBe(400);
      const html = await replay.text();
      expect(html).toContain('data-problem="expired"');
      expect(html).toContain('<html lang="ko"');
      expect(html).toContain("다시 시작");
      expect(html).toContain('<form method="get" action="/oauth/authorize"');
      expect(html).toContain('<input type="hidden" name="client_id" value="' + clientId + '">');
      expect(html).toContain("<button>다시 시작</button>");
      expect(html).not.toContain("not started in this browser");
    } finally { setSystemTime(); }
  });

  test("a consent page older than 10 minutes is refused", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    setSystemTime(new Date(Date.now() + 601_000));
    try {
      const late = await approve(cookie, consent);
      expect(late.status).toBe(400);
      expect(await late.text()).toContain('data-problem="expired"');
    } finally { setSystemTime(); }
  });

  test("another signed-in account cannot approve a consent page shown to someone else", async () => {
    const consent = await openConsent(await jwt(UID_A));
    const res = await approve(await jwt(UID_B), consent);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('data-problem="other_user"');
    expect((await approve(await jwt(UID_A), consent)).status).toBe(302);
  });

  test("two approves at the same time yield one code on the Postgres store too (migration 022)", async () => {
    const lite = new PGlite();
    await lite.exec(readFileSync(join(import.meta.dir, "..", "migrations/supabase/022-acard-oauth-consent.sql"), "utf8").replace(/SET search_path = acard;/, "CREATE SCHEMA acard; SET search_path = acard;").replace(/GRANT[^;]*;/g, "").replace(/DROP POLICY[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, ""));
    const query = (q: { query: PGlite["query"] }) => async (text: string, params: unknown[]) => {
      const r = await q.query<Record<string, unknown>>(text, params);
      return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
    };
    const sqlite = env.DB;
    env.DB = pgD1({ query: query(lite), transaction: (fn) => lite.transaction((tx) => fn(query(tx))) });
    try {
      const cookie = await jwt(UID_A);
      for (let round = 0; round < 3; round++) {
        const consent = await openConsent(cookie);
        const answers = await Promise.all([approve(cookie, consent), approve(cookie, consent), approve(cookie, consent)]);
        const codes = new Set(answers.filter((r) => r.status === 302).map((r) => new URL(r.headers.get("location")!).searchParams.get("code")).filter(Boolean));
        expect(codes.size).toBe(1);
      }
      const rows = (await lite.query<{ done: string }>("SELECT done FROM acard.oauth_consent_claims")).rows;
      expect(rows.length).toBe(3);
      for (const row of rows) expect(row.done).not.toContain("code=");
    } finally {
      env.DB = sqlite;
      await lite.close();
    }
  });

  test("a POST with neither Origin nor Sec-Fetch-Site is refused unless its Referer is the consent page", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    expect(consent.res.headers.get("referrer-policy")).toBe("same-origin");
    for (const headers of [{}, { referer: "https://evil.example/oauth/authorize" }, { referer: ORIGIN + "/settings/agents/" }] as Record<string, string>[]) {
      const res = await approve(cookie, consent, headers);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain('data-problem="unverified"');
      expect(html).toContain("<button>");
    }
    const viaReferer = await approve(cookie, consent, { referer: ORIGIN + "/oauth/authorize" + consent.restart });
    expect(viaReferer.status).toBe(302);
    expect(new URL(viaReferer.headers.get("location")!).searchParams.get("code")).toBeTruthy();
    const lone = await openConsent(cookie);
    expect((await approve(cookie, lone, { "sec-fetch-site": "same-origin" })).status).toBe(302);
    const originOnly = await openConsent(cookie);
    expect((await approve(cookie, originOnly, { origin: ORIGIN })).status).toBe(302);
    const mixed = await openConsent(cookie);
    expect((await approve(cookie, mixed, { origin: ORIGIN, "sec-fetch-site": "cross-site" })).status).toBe(400);
  });

  test("no authorization code is kept in plaintext for the re-send window", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    const res = await approve(cookie, consent);
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const secret = code.split(":")[2];
    const everyKvValue = [...env.OAUTH_KV.map.values()].map((v: any) => String(v.value));
    const claimRows = (await env.DB.prepare("SELECT done FROM oauth_consent_claims").all()).results.map((row: any) => String(row.done));
    expect(claimRows.length).toBeGreaterThan(0);
    for (const stored of [...everyKvValue, ...claimRows]) expect(stored).not.toContain(secret);
    for (const done of claimRows) expect(done).not.toContain(REDIRECT);
    expect((await approve(cookie, consent)).headers.get("location")).toBe(res.headers.get("location"));
  });

  test("exchanging a code a second time is refused and kills the tokens the first exchange issued", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    const code = new URL((await approve(cookie, consent)).headers.get("location")!).searchParams.get("code")!;
    const exchange = () => send(new Request(ORIGIN + "/oauth/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: ORIGIN + "/mcp" }),
    }));
    const first = await exchange();
    expect(first.status).toBe(200);
    const access = ((await first.json()) as { access_token: string }).access_token;
    const me = () => send(new Request(ORIGIN + "/api/v1/me", { headers: { authorization: "Bearer " + access } }));
    expect((await me()).status).toBe(200);
    const second = await exchange();
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: string }).error).toBe("invalid_grant");
    expect((await me()).status).toBe(401);
  });

  test("cross-site posts are refused before the form is read", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    const attempts: Record<string, string>[] = [{ origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of attempts) {
      const res = await approve(cookie, consent, headers);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('data-problem="cross_site"');
    }
    expect((await approve(cookie, consent)).status).toBe(302);
  });

  test("an unknown or malformed handle is refused; signed out goes to login and back", async () => {
    const cookie = await jwt(UID_A);
    expect((await approve(cookie, { handle: "x".repeat(43) })).status).toBe(400);
    expect((await approve(cookie, { handle: "<script>" })).status).toBe(400);
    const out = await send(new Request(ORIGIN + "/oauth/authorize" + (await authorizeQuery()), { redirect: "manual" }));
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toStartWith("/login?next=%2Foauth%2Fauthorize%3F");
  });

  test("deny sends access_denied with the client's state to the registered redirect", async () => {
    const cookie = await jwt(UID_A);
    const consent = await openConsent(cookie);
    const res = await approve(cookie, consent, undefined, "deny");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toStartWith("st-");
  });
});
