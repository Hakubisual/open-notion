import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleWorkerSource } from "./assemble-worker";

// Items 5-7 (acard-perf-smooth w1-server): the bundled entry with a fake Supabase (fetch) and a fake OUTBOX KV, so the
// test counts the profile REST calls and KV reads a member home load makes.
class FakeDurableObject { ctx: any; env: any; constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; } }
class FakeWorkerEntrypoint { ctx: any; env: any; constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; } }
mock.module("cloudflare:workers", () => ({ DurableObject: FakeDurableObject, WorkerEntrypoint: FakeWorkerEntrypoint }));

const SUPABASE = "https://supa.test";
const OWNER_UID = "00000000-0000-4000-8000-000000000001";
const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";
const UID_C = "33333333-3333-4333-8333-333333333333";
const UID_NEW = "44444444-4444-4444-8444-444444444444";

function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []): any => ({
    sql, params, bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...(params as any[])) }),
    first: async () => sqlite.query(sql).get(...(params as any[])) ?? null,
  });
  return { prepare: (sql: string) => statement(sql), batch: async (list: any[]) => { const out = []; for (const item of list) out.push(await item.run()); return out; } };
}
function sqlStorage(sqlite: Database) {
  return {
    sql: { exec: (sql: string, ...params: unknown[]) => { const rows = sqlite.query(sql).all(...(params as any[])) as any[]; return { toArray: () => rows, one: () => rows[0] }; }, get databaseSize() { return 0; } },
    transactionSync: (fn: () => unknown) => sqlite.transaction(fn)(),
    deleteAll: async () => {}, get: async () => undefined, put: async () => {}, setAlarm: async () => {}, deleteAlarm: async () => {},
  };
}
function memoryKv() {
  const map = new Map<string, string>();
  const log: string[] = [];
  return {
    map, log,
    get: async (key: string) => { log.push("get " + key); return map.get(key) ?? null; },
    getWithMetadata: async (key: string) => ({ value: map.get(key) ?? null, metadata: null }),
    put: async (key: string, value: string) => { log.push("put " + key); map.set(key, value); },
    delete: async (key: string) => { log.push("delete " + key); map.delete(key); },
    list: async (options: { prefix?: string } = {}) => ({ keys: [...map.keys()].filter((k) => k.startsWith(options.prefix ?? "")).map((name) => ({ name })), list_complete: true }),
  };
}

let worker: any;
let env: any;
let keyPair: CryptoKeyPair;
let dir: string;
const realFetch = globalThis.fetch;
const profiles = new Map<string, { onboarded_at: string | null; lang: string | null }>();
const betaRows = new Set<string>();
const handles = new Map<string, string>();
const calls: string[] = [];
const b64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
async function jwt(sub: string) {
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: "k1", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ sub, email: sub.slice(0, 4) + "@test.dev", exp: Math.floor(Date.now() / 1000) + 600, iss: SUPABASE + "/auth/v1", aud: "authenticated", role: "authenticated" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}
async function get(path: string, uid: string, extraCookie = "") {
  const headers: Record<string, string> = { accept: "text/html,application/json", cookie: "acard_at=" + (await jwt(uid)) + (extraCookie ? "; " + extraCookie : "") };
  return worker.fetch(new Request("https://notes.example.com" + path, { headers, redirect: "manual" }), env, { waitUntil() {} }) as Promise<Response>;
}
const LANDING = readFileSync(join(import.meta.dir, "..", "assets", "_site", "index.html"), "utf8");
const restCalls = () => calls.filter((c) => c.startsWith("/rest/v1/profiles"));
const betaCalls = () => calls.filter((c) => c.startsWith("/rest/v1/beta_access"));

beforeAll(async () => {
  dir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "acard-auth-caches-"));
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
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.href === SUPABASE + "/auth/v1/.well-known/jwks.json") return Response.json({ keys: [{ ...jwk, kid: "k1", alg: "ES256" }] });
    if (url.origin === SUPABASE) {
      calls.push(url.pathname + url.search);
      if (url.pathname === "/rest/v1/profiles" && url.searchParams.has("handle")) {
        const owner = handles.get((url.searchParams.get("handle") ?? "").replace(/^eq\./, ""));
        return Response.json(owner ? [{ id: owner }] : []);
      }
      if (url.pathname === "/rest/v1/profiles") {
        const uid = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
        const row = profiles.get(uid);
        return Response.json(row ? [{ id: uid, display_name: "t", avatar_url: null, handle: "t", use_case: null, ...row }] : []);
      }
      if (url.pathname === "/rest/v1/beta_access") {
        const uid = (url.searchParams.get("user_id") ?? "").replace(/^eq\./, "");
        return Response.json(betaRows.has(uid) ? [{ user_id: uid }] : []);
      }
      return Response.json([], { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const stores = new Map<string, any>();
  env = {
    DB: d1(new Database(":memory:")), MEDIA: memoryKv(), OUTBOX: memoryKv(),
    GATE_PASSWORD: "pw", GATE_SECRET: "secret", OWNER_USER_ID: OWNER_UID,
    SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
    ASSETS: { fetch: async (request: Request) => {
      const p = new URL(request.url).pathname;
      if (p === "/_site/onboarding.html") return new Response("<html>ONBOARDING</html>", { headers: { "content-type": "text/html" } });
      if (p === "/_site/index.html") return new Response(LANDING, { headers: { "content-type": "text/html" } });
      if (p === "/editor.html") return new Response("<html><head></head><body>EDITOR</body></html>", { headers: { "content-type": "text/html" } });
      return new Response("Not Found", { status: 404 });
    } },
    WORKSPACE: { idFromName: (name: string) => name, get: (id: string) => { if (!stores.has(id)) stores.set(id, new WorkspaceStore({ storage: sqlStorage(new Database(":memory:")) }, {})); return stores.get(id); } },
  };
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

describe("profile check on the member home (item 5)", () => {
  test("an onboarded member with the lang cookie pays the profile REST call once per day, then only a KV read", async () => {
    profiles.set(UID_A, { onboarded_at: "2026-10-16T00:00:00Z", lang: "ko" });
    calls.length = 0;
    const first = await get("/home/", UID_A, "acard_lang=ko");
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('class="shell"');
    expect(restCalls()).toHaveLength(1);
    expect(env.OUTBOX.map.get("profile-onboarded:" + UID_A)).toBe("1");
    calls.length = 0;
    env.OUTBOX.log.length = 0;
    const second = await get("/home/", UID_A, "acard_lang=ko");
    expect(second.status).toBe(200);
    expect(restCalls()).toHaveLength(0);
    expect(env.OUTBOX.log).toContain("get profile-onboarded:" + UID_A);
    // Other home-less routes never asked for the profile before and still do not.
    calls.length = 0;
    expect((await get("/api/tree", UID_A, "acard_lang=ko")).status).toBe(200);
    expect(restCalls()).toHaveLength(0);
  });

  test("without the acard_lang cookie the profile is still read so the language redirect keeps working", async () => {
    profiles.set(UID_B, { onboarded_at: "2026-10-16T00:00:00Z", lang: "en" });
    calls.length = 0;
    const first = await get("/home/", UID_B);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("/home/");
    expect(first.headers.get("set-cookie")).toContain("acard_lang=en");
    expect(restCalls()).toHaveLength(1);
    // The redirect response does not remember the user (it returned before the onboarded check completed the path), so
    // the next cookie-less load reads the profile again - exactly the old behaviour.
    calls.length = 0;
    const again = await get("/home/", UID_B);
    expect(again.status).toBe(303);
    expect(restCalls()).toHaveLength(1);
    // With the cookie: one more REST call to remember, then none.
    calls.length = 0;
    expect((await get("/home/", UID_B, "acard_lang=en")).status).toBe(200);
    expect(restCalls()).toHaveLength(1);
    calls.length = 0;
    expect((await get("/home/", UID_B, "acard_lang=en")).status).toBe(200);
    expect(restCalls()).toHaveLength(0);
    // A remembered user who later drops the cookie is read again (the lang redirect depends on the profile).
    calls.length = 0;
    expect((await get("/home/", UID_B)).status).toBe(303);
    expect(restCalls()).toHaveLength(1);
  });

  test("a brand-new or not-yet-onboarded member is sent to onboarding on every home load and is never remembered", async () => {
    calls.length = 0;
    const missing = await get("/home/", UID_NEW, "acard_lang=ko");
    expect(missing.status).toBe(303);
    expect(missing.headers.get("location")).toBe("/onboarding");
    expect(env.OUTBOX.map.has("profile-onboarded:" + UID_NEW)).toBe(false);
    profiles.set(UID_NEW, { onboarded_at: null, lang: null });
    const pending = await get("/home/", UID_NEW, "acard_lang=ko");
    expect(pending.status).toBe(303);
    expect(pending.headers.get("location")).toBe("/onboarding");
    expect(env.OUTBOX.map.has("profile-onboarded:" + UID_NEW)).toBe(false);
    expect(restCalls()).toHaveLength(2);
    // Finishing onboarding makes the next load a 200 and remembers it.
    profiles.set(UID_NEW, { onboarded_at: "2026-10-23T00:00:00Z", lang: null });
    calls.length = 0;
    expect((await get("/home/", UID_NEW, "acard_lang=ko")).status).toBe(200);
    expect(restCalls()).toHaveLength(1);
    expect(env.OUTBOX.map.get("profile-onboarded:" + UID_NEW)).toBe("1");
  });

  test("deleting the account drops the remembered key", async () => {
    const { accountApi } = await import("../gate/account");
    env.OUTBOX.map.set("profile-onboarded:" + UID_C, "1");
    const url = new URL("https://notes.example.com/api/account/delete");
    const request = new Request(url, { method: "POST", headers: { cookie: "acard_at=" + (await jwt(UID_C)) } });
    const response = await accountApi(request, env, url);
    // The fake GoTrue admin DELETE answers 200 (empty JSON), so the delete goes through.
    expect(response.status).toBe(200);
    expect(env.OUTBOX.map.has("profile-onboarded:" + UID_C)).toBe(false);
  });
});

describe("early hints on app HTML (item 8)", () => {
  test("member reader and editor HTML carry the Link header; JSON and redirects do not", async () => {
    (globalThis as any).ACARD_STATIC_VERSIONS = { "style.css": "s1", "fonts/pretendard-core.woff2": "f1" };
    try {
      const expected = "</style.css?v=s1>; rel=preload; as=style, </fonts/pretendard-core.woff2?v=f1>; rel=preload; as=font; crossorigin";
      expect((await get("/home/", UID_A, "acard_lang=ko")).headers.get("link")).toBe(expected);
      const editor = await get("/edit/some-page", UID_A, "acard_lang=ko");
      expect([editor.status, editor.headers.get("link")]).toEqual([200, expected]);
      expect((await get("/api/tree", UID_A, "acard_lang=ko")).headers.get("link")).toBeNull();
      expect((await get("/home/", UID_B)).headers.get("link")).toBeNull();
    } finally { delete (globalThis as any).ACARD_STATIC_VERSIONS; }
  });
});

describe("Server-Timing auth stage (item 7)", () => {
  test("HTML and API responses for a member report an auth stage and the member store's pipe count", async () => {
    for (const path of ["/home/", "/api/tree"]) {
      const response = await get(path, UID_A, "acard_lang=ko");
      expect(response.status).toBe(200);
      const timing = response.headers.get("server-timing") ?? "";
      expect(timing).toMatch(/\bauth;dur=\d+/);
      expect(timing).toMatch(/\bdb;dur=\d+;desc="\d+ pipes"/);
      expect(timing).not.toContain("timing unavailable");
    }
  });
});

describe("home first (acard-home-first)", () => {
  const anon = (path: string) => worker.fetch(new Request("https://notes.example.com" + path, { headers: { accept: "text/html" }, redirect: "manual" }), env, { waitUntil() {} }) as Promise<Response>;
  test("a signed-in visitor gets the landing at / with 내 홈으로 and 내 보드로 가기 to /home/, never the waitlist", async () => {
    env.BETA_MODE = "closed";
    try {
      profiles.set(UID_A, { onboarded_at: "2026-10-16T00:00:00Z", lang: "ko" });
      betaRows.delete(UID_A);
      calls.length = 0;
      const home = await get("/", UID_A, "acard_lang=ko");
      expect(home.status).toBe(200);
      const html = await home.text();
      expect(html).not.toContain('class="shell"');
      expect(html).toContain('data-session="1"');
      expect(html.match(/data-my-home="header"/g)).toHaveLength(2);
      expect(html).toContain("내 홈으로");
      expect(html).toContain("내 보드로 가기");
      expect(html).not.toContain('id="waitlist"');
      expect(html).not.toContain('href="/signup"');
      expect(html).not.toContain('href="#waitlist"');
      expect(html).not.toContain('class="login-link"');
      expect([...html.matchAll(/data-my-home="[a-z]+"[^>]*>|href="([^"]+)"[^>]*data-my-home/g)].length).toBeGreaterThan(0);
      for (const m of html.matchAll(/<a\b[^>]*data-my-home[^>]*>/g)) expect(m[0]).toContain('href="/home/"');
      // No beta lookup and no profile lookup decide the landing: the session alone does.
      expect(betaCalls()).toHaveLength(0);
      expect(restCalls()).toHaveLength(0);
      const out = await anon("/");
      const guestHtml = await out.text();
      expect(guestHtml).toContain('id="waitlist"');
      expect(guestHtml).not.toContain("data-my-home");
    } finally { delete env.BETA_MODE; }
  });

  test("/home/ is the workspace home with the onboarding gate; /app goes there", async () => {
    const fresh = "55555555-5555-4555-8555-555555555555";
    profiles.set(fresh, { onboarded_at: null, lang: null });
    const pending = await get("/home/", fresh, "acard_lang=ko");
    expect([pending.status, pending.headers.get("location")]).toEqual([303, "/onboarding"]);
    // The landing itself never sends a not-yet-onboarded member away: home first, then 내 홈으로 -> onboarding.
    expect((await get("/", fresh, "acard_lang=ko")).status).toBe(200);
    const app = await get("/app", UID_A, "acard_lang=ko");
    expect([app.status, app.headers.get("location")]).toEqual([303, "/home/"]);
    const shell = await get("/home/", UID_A, "acard_lang=ko");
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('class="shell"');
  });

  test("notes.example.com/<handle>: own page wins, own handle opens /home/, another handle shows a notice that leaks nothing", async () => {
    handles.set("handle-owner-a", UID_A);
    handles.set("handle-other-b", UID_B);
    try {
      const own = await get("/handle-owner-a/", UID_A, "acard_lang=ko");
      expect([own.status, own.headers.get("location")]).toEqual([303, "/home/"]);
      const other = await get("/handle-other-b", UID_A, "acard_lang=ko");
      expect(other.status).toBe(200);
      expect(other.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      const notice = await other.text();
      expect(notice).toContain('data-handle-notice="1"');
      expect(notice).toContain("notes.example.com/handle-other-b");
      expect(notice).not.toContain("class=\"shell\"");
      const unknown = await get("/no-such-handle", UID_A, "acard_lang=ko");
      expect(unknown.status).toBe(404);
      const out = await anon("/handle-other-b/");
      expect(out.status).toBe(200);
      expect(await out.text()).toContain('href="/login?next=%2Fhandle-other-b%2F"');
      const outUnknown = await anon("/no-such-handle/");
      expect([outUnknown.status, outUnknown.headers.get("location")]).toEqual([303, "/login?next=%2Fno-such-handle%2F"]);
      // A page whose slug equals the handle is the workspace's own page, read before any handle lookup.
      const made = await worker.fetch(new Request("https://notes.example.com/api/pages", { method: "POST", headers: { origin: "https://notes.example.com", "content-type": "application/json", cookie: "acard_at=" + (await jwt(UID_A)) + "; acard_lang=ko" }, body: JSON.stringify({ title: "handle-other-b", parent: null }) }), env, { waitUntil() {} });
      expect(((await made.json()) as { slug: string }).slug).toBe("handle-other-b");
      calls.length = 0;
      const page = await get("/handle-other-b/", UID_A, "acard_lang=ko");
      expect(page.status).toBe(200);
      expect(await page.text()).not.toContain('data-handle-notice');
      expect(calls.filter((c) => c.includes("handle="))).toHaveLength(0);
    } finally { handles.clear(); }
  });
});

