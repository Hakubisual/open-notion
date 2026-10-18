import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleWorkerSource } from "./assemble-worker";

class FakeDurableObject {
  ctx: any;
  env: any;
  constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; }
}
class FakeWorkerEntrypoint { ctx: any; env: any; constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; } }
mock.module("cloudflare:workers", () => ({ DurableObject: FakeDurableObject, WorkerEntrypoint: FakeWorkerEntrypoint }));

const SUPABASE = "https://supa.test";
const OWNER_UID = "00000000-0000-4000-8000-000000000001";
const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";
const hex = (uid: string) => uid.replace(/-/g, "");

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
    batch: async (list: any[]) => {
      sqlite.exec("BEGIN");
      try { const out = []; for (const item of list) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

function sqlStorage(sqlite: Database) {
  return {
    sql: {
      exec: (sql: string, ...params: unknown[]) => {
        const rows = sqlite.query(sql).all(...(params as any[])) as any[];
        return { toArray: () => rows, one: () => rows[0] };
      },
      get databaseSize() { return 0; },
    },
    transactionSync: (fn: () => unknown) => sqlite.transaction(fn)(),
    deleteAll: async () => {
      const tables = sqlite.query("SELECT name, type FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%'").all() as any[];
      for (const t of tables.filter((x) => x.type === "trigger")) sqlite.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
      for (const t of tables.filter((x) => x.type === "table")) { try { sqlite.exec(`DROP TABLE IF EXISTS "${t.name}"`); } catch { continue; } }
    },
  };
}

function memoryKv() {
  const map = new Map<string, { value: unknown; metadata: unknown }>();
  return {
    map,
    get: async (key: string) => map.get(key)?.value ?? null,
    getWithMetadata: async (key: string) => map.get(key) ?? { value: null, metadata: null },
    put: async (key: string, value: unknown, options?: any) => { map.set(key, { value, metadata: options?.metadata ?? null }); },
    delete: async (key: string) => { map.delete(key); },
    list: async (options: { prefix?: string } = {}) => ({ keys: [...map.keys()].filter((k) => k.startsWith(options.prefix ?? "")).map((name) => ({ name })), list_complete: true }),
  };
}

let worker: any;
let env: any;
let owner: Database;
let stores: Map<string, any>;
let keyPair: CryptoKeyPair;
let dir: string;
const realFetch = globalThis.fetch;

const b64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

async function jwt(sub: string, { exp = Math.floor(Date.now() / 1000) + 600, key = keyPair.privateKey, iss = SUPABASE + "/auth/v1" } = {}) {
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: "k1", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ sub, email: sub.slice(0, 4) + "@test.dev", exp, iss, aud: "authenticated", role: "authenticated" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}

async function call(method: string, path: string, opts: { cookie?: string; bearer?: string; body?: unknown; host?: string } = {}) {
  const headers: Record<string, string> = { accept: "text/html,application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = "Bearer " + opts.bearer;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res: Response = await worker.fetch(new Request("https://" + (opts.host ?? "notes.example.com") + path, { method, headers, redirect: "manual", body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env, {});
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text, headers: res.headers };
}

const as = async (uid: string) => "acard_at=" + (await jwt(uid));

beforeAll(async () => {
  dir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "acard-tenancy-"));
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
    if (url.startsWith(SUPABASE)) return Response.json({}, { status: 401 });
    return realFetch(input, init);
  }) as typeof fetch;

  owner = new Database(":memory:");
  stores = new Map();
  const assets: Record<string, string> = {
    "/_site/index.html": "<html>LANDING notes.example.com</html>",
    "/_site/login.html": "<html>LOGIN</html>",
    "/_site/settings.html": "<html>SETTINGS</html>",
    "/notes-seed.json": JSON.stringify({ pages: [{ slug: "owner-secret", title: "Owner Secret", parent: null, ord: 1, kind: "note", updated: 1, hash: "h1", blocks: [{ id: "b1", type: "paragraph", text: "zebra owner confidential", indent: 0 }] }] }),
    "/search-index.json": "[{\"t\":\"Owner Secret\"}]",
    "/owner-secret/index.html": "<html>OWNER STATIC zebra</html>",
    "/editor.html": "<html>EDITOR</html>",
    "/style.css": "body{}",
  };
  env = {
    DB: d1(owner),
    MEDIA: memoryKv(),
    OAUTH_KV: undefined,
    GATE_PASSWORD: "pw", GATE_SECRET: "secret",
    OWNER_USER_ID: OWNER_UID,
    SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: "anon",
    ASSETS: { fetch: async (request: Request) => {
      const raw = new URL(request.url).pathname;
      const path = raw.endsWith("/") && raw !== "/" ? raw + "index.html" : raw;
      const body = assets[path];
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { headers: { "content-type": path.endsWith(".html") ? "text/html; charset=utf-8" : "application/json", etag: "e1" } });
    } },
    WORKSPACE: {
      idFromName: (name: string) => name,
      get: (id: string) => {
        if (!stores.has(id)) stores.set(id, new WorkspaceStore({ storage: sqlStorage(new Database(":memory:")) }, {}));
        return stores.get(id);
      },
    },
  };
  await env.MEDIA.put("media/aaaaaaaaaaaaaaaa", new Uint8Array([1, 2, 3]).buffer, { metadata: { mime: "image/png", name: "o.png" } });
  const ownerTree = await call("GET", "/api/tree", { cookie: await as(OWNER_UID) });
  expect(ownerTree.status).toBe(200);
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

describe("one site, many workspaces", () => {
  test("logged out: landing at /, account pages served, app API refused", async () => {
    const home = await call("GET", "/");
    expect(home.status).toBe(200);
    expect(home.text).toContain("LANDING");
    expect((await call("GET", "/login")).text).toContain("LOGIN");
    expect((await call("GET", "/api/tree")).status).toBe(401);
    expect((await call("GET", "/owner-secret/")).status).toBe(303);
  });

  test("owner signs in with Google session and sees the existing workspace", async () => {
    const cookie = await as(OWNER_UID);
    const tree = await call("GET", "/api/tree", { cookie });
    expect(tree.data.pages.map((p: any) => p.slug)).toContain("owner-secret");
    const page = await call("GET", "/owner-secret/", { cookie });
    expect(page.status).toBe(200);
    expect(page.text).toContain("zebra");
  });

  test("a new account gets an empty workspace with the same app and can create a page that persists", async () => {
    const cookie = await as(UID_A);
    const tree = await call("GET", "/api/tree", { cookie });
    expect(tree.status).toBe(200);
    expect(tree.data.pages).toEqual([]);
    const home = await call("GET", "/", { cookie });
    expect(home.status).toBe(200);
    expect(home.text).toContain('class="shell"');
    expect(home.text).not.toContain("Owner Secret");
    const created = await call("POST", "/api/pages", { cookie, body: { title: "A의 첫 페이지" } });
    expect(created.status).toBe(200);
    const again = await call("GET", "/api/tree", { cookie: await as(UID_A) });
    expect(again.data.pages.map((p: any) => p.title)).toEqual(expect.arrayContaining(["Home", "A의 첫 페이지"]));
    expect(owner.query("SELECT count(*) AS n FROM pages WHERE title = 'A의 첫 페이지'").get()).toEqual({ n: 0 });
  });

  test("a member cannot reach owner pages, search, static seeds, media or share creation", async () => {
    const cookie = await as(UID_A);
    expect((await call("GET", "/api/page/owner-secret", { cookie })).status).toBe(404);
    expect((await call("GET", "/owner-secret/", { cookie })).status).toBe(404);
    const search = await call("GET", "/api/search?q=zebra", { cookie });
    expect(JSON.stringify(search.data)).not.toContain("owner-secret");
    for (const path of ["/notes-seed.json", "/search-index.json", "/db-seed.json"]) expect((await call("GET", path, { cookie })).status).toBe(404);
    expect((await call("GET", "/media/aaaaaaaaaaaaaaaa", { cookie })).status).toBe(404);
    expect((await call("POST", "/api/page/owner-secret/share", { cookie })).status).toBe(404);
    expect((await call("GET", "/api/db/list", { cookie })).data.databases ?? []).toEqual([]);
  });

  test("workspace tokens only open their own store; owner tokens keep working", async () => {
    const cookieA = await as(UID_A);
    const made = await call("POST", "/api/agents/tokens", { cookie: cookieA, body: { name: "A bot", scopes: ["read", "write"] } });
    expect(made.status).toBe(201);
    expect(made.data.token).toStartWith("acard_m" + hex(UID_A) + "_");
    const list = await call("GET", "/api/v1/pages", { bearer: made.data.token });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.data)).not.toContain("owner-secret");
    expect((await call("GET", "/api/v1/pages/owner-secret", { bearer: made.data.token })).status).toBe(404);
    const forged = made.data.token.replace(hex(UID_A), hex(UID_B));
    expect((await call("GET", "/api/v1/pages", { bearer: forged })).status).toBe(401);

    const ownerMade = await call("POST", "/api/agents/tokens", { cookie: await as(OWNER_UID), body: { name: "devlog", scopes: ["read", "write"] } });
    expect(ownerMade.data.token).toStartWith("acard_");
    // Owner tokens are acard_ + random base64url, so ~1 in 64 start with "m"; a member token is acard_m<32 hex>_.
    expect(ownerMade.data.token).not.toMatch(/^acard_m[0-9a-f]{32}_/);
    const ownerList = await call("GET", "/api/v1/pages", { bearer: ownerMade.data.token });
    expect(JSON.stringify(ownerList.data)).toContain("owner-secret");
    const appended = await call("POST", "/api/v1/pages", { bearer: ownerMade.data.token, body: { title: "개발 일지 테스트", markdown: "hello" } });
    expect([200, 201]).toContain(appended.status);
  });

  test("two members never see each other", async () => {
    await call("POST", "/api/pages", { cookie: await as(UID_B), body: { title: "B only" } });
    const a = await call("GET", "/api/tree", { cookie: await as(UID_A) });
    expect(a.data.pages.map((p: any) => p.title)).not.toContain("B only");
  });

  test("a forged or expired session is treated as logged out", async () => {
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    expect((await call("GET", "/api/tree", { cookie: "acard_at=" + (await jwt(OWNER_UID, { key: other.privateKey })) })).status).toBe(401);
    expect((await call("GET", "/api/tree", { cookie: "acard_at=" + (await jwt(OWNER_UID, { exp: 10 })) })).status).toBe(401);
    expect((await call("GET", "/api/tree", { cookie: "acard_at=" + (await jwt(OWNER_UID, { iss: "https://evil.test/auth/v1" })) })).status).toBe(401);
  });

  test("old hosts redirect people to notes.example.com but keep agent paths answering during the move", async () => {
    const page = await call("GET", "/board/?x=1", { host: "old.notes.example.com" });
    expect(page.status).toBe(301);
    expect(page.headers.get("location")).toBe("https://notes.example.com/board/?x=1");
    expect((await call("GET", "/", { host: "legacy.notes.example.com" })).headers.get("location")).toBe("https://notes.example.com/");
    expect((await call("GET", "/api/v1/pages", { host: "old.notes.example.com" })).status).toBe(401);
    env.LEGACY_MODE = "redirect-all";
    try { expect((await call("GET", "/api/v1/pages", { host: "old.notes.example.com" })).status).toBe(301); }
    finally { delete env.LEGACY_MODE; }
  });

  test("the old owner password ticket no longer opens anything on the site", async () => {
    const ticketTime = String(Math.floor(Date.now() / 1000) + 3600);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ticketTime)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const cookie = "dn_auth=" + ticketTime + "." + mac;
    expect((await call("GET", "/api/tree", { cookie })).status).toBe(401);
    expect((await call("GET", "/api/agents/tokens", { cookie })).status).toBe(401);
    expect((await call("POST", "/__gate")).status).toBe(303);
  });

  test("only a request carrying the forward secret is treated as notes.example.com", async () => {
    env.FORWARD_SECRET = "fwd-secret";
    try {
      const google = (secret: string) => worker.fetch(new Request("https://dori-notes.pages.dev/api/auth/google", { headers: { "x-acard-forward": secret, "x-acard-host": "notes.example.com" }, redirect: "manual" }), env, {});
      const viaWorker = await worker.fetch(new Request("https://dori-notes.pages.dev/login", { headers: { "x-acard-forward": "fwd-secret", "x-acard-host": "notes.example.com", accept: "text/html" } }), env, {});
      expect(viaWorker.status).toBe(200);
      const trusted = decodeURIComponent((await google("fwd-secret")).headers.get("location") ?? "");
      expect(trusted).toContain("redirect_to=https://notes.example.com/api/auth/callback");
      const forged = decodeURIComponent((await google("wrong")).headers.get("location") ?? "");
      expect(forged).toContain("redirect_to=https://dori-notes.pages.dev/api/auth/callback");
    } finally { delete env.FORWARD_SECRET; }
  });

  test("deleting a member account wipes its store and media but refuses the owner", async () => {
    const ws = hex(UID_B);
    await env.MEDIA.put("ws/" + ws + "/media/bbbbbbbbbbbbbbbb", new Uint8Array([9]).buffer, {});
    const before = await stores.get("ws:" + ws).stats();
    expect(before.pages).toBeGreaterThan(0);
    const del = await call("POST", "/api/account/delete", { cookie: await as(UID_B) });
    expect(del.status).toBe(500);
    expect((await stores.get("ws:" + ws).stats()).pages).toBe(0);
    expect([...env.MEDIA.map.keys()].some((k: string) => k.startsWith("ws/" + ws))).toBe(false);
    expect((await call("POST", "/api/account/delete", { cookie: await as(OWNER_UID) })).status).toBe(403);
    expect(owner.query("SELECT count(*) AS n FROM pages WHERE slug = 'owner-secret'").get()).toEqual({ n: 1 });
  });
});
