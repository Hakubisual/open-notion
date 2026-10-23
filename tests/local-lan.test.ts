// LAN mode of the local server: extra Host names pass the DNS-rebinding guard, and the password gate keeps every
// human page behind a signed session cookie; agents use a separate bearer token.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guard, localEnv, passwordGate, sameOrigin, type LocalOptions } from "../local/server";

const req = (url: string, init: RequestInit & { host?: string } = {}) =>
  new Request(url, { ...init, headers: { host: init.host ?? new URL(url).host, ...(init.headers as Record<string, string>) } });

async function localServer(options: Partial<LocalOptions> = {}) {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  const dataDir = mkdtempSync(join(tmpdir(), "lan-api-"));
  // The core caches schema readiness by workspace id; each real sidecar owns one workspace for its whole process.
  const child = Bun.spawn(["bun", join(import.meta.dir, "..", "local", "main.ts")], {
    env: { ...process.env, ACARD_DATA_DIR: dataDir, ACARD_APP_DIR: join(import.meta.dir, "..", "dist"), ACARD_PORT: String(port),
      ACARD_HOST: "127.0.0.1", ACARD_ALLOWED_HOSTS: "", ACARD_CLOUD_URL: "", ACARD_PASSWORD: options.password ?? "",
      ACARD_LOCAL_API: options.localApi ? "1" : "0", ACARD_AGENT_TOKEN: options.agentToken ?? "" },
    stdin: "pipe", stdout: "pipe", stderr: "inherit",
  });
  const reader = child.stdout.getReader();
  const limit = setTimeout(() => child.kill(), 10_000);
  try {
    for (let seen = ""; !seen.includes("READY");) {
      const { value, done } = await reader.read();
      if (done) throw new Error("local server exited before READY: " + seen);
      seen += new TextDecoder().decode(value);
    }
  } catch (error) {
    child.kill();
    await child.exited;
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  } finally { clearTimeout(limit); reader.releaseLock(); }
  const base = "http://127.0.0.1:" + port;
  return {
    base, port,
    call: (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: "manual", ...init }),
    close: async () => { child.stdin.end(); child.kill(); await child.exited; rmSync(dataDir, { recursive: true, force: true }); },
  };
}

test("local API opt-in serves loopback identity and discovery documents", async () => {
  const local = await localServer({ localApi: true });
  try {
    const me = await local.call("/api/v1/me");
    expect(me.status).toBe(200);
    const identity = await me.json() as { agent: string; via: string; scopes: string[] };
    expect(["로컬 에이전트", "Local agent"]).toContain(identity.agent);
    expect(identity).toMatchObject({ via: "token", scopes: ["read", "write"] });
    const spec = await local.call("/api/v1/openapi.json");
    expect(spec.status).toBe(200);
    expect(spec.headers.get("content-type")).toContain("application/json");
    expect((await spec.json() as { openapi: string }).openapi).toBe("3.1.0");
    for (const [path, type] of [["/AGENTS.md", "text/markdown"], ["/llms.txt", "text/plain"]]) {
      const response = await local.call(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(type);
      expect(await response.text()).toContain(local.base + "/mcp");
    }
  } finally { await local.close(); }
}, 30_000);

test("local API stays off by default in the private server", async () => {
  const local = await localServer();
  try { expect((await local.call("/api/v1/me")).status).toBe(401); }
  finally { await local.close(); }
}, 30_000);

test("LAN agent tokens and human cookies unlock only their own surfaces", async () => {
  const agentToken = "a-local-agent-token-with-32-chars!";
  const password = "correct horse";
  const local = await localServer({ password, agentToken, localApi: true });
  try {
    expect((await local.call("/api/v1/pages", { headers: { authorization: "Bearer " + agentToken } })).status).toBe(200);
    for (const authorization of [undefined, "Bearer wrong", "Bearer " + password, agentToken, "Bearer", "Bearer ", "Bearer " + "x".repeat(8192)]) {
      const response = await local.call("/api/v1/pages", { headers: authorization === undefined ? {} : { authorization } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid agent token" });
    }
    const login = await local.call("/__local/login", { method: "POST", body: new URLSearchParams({ password, next: "/edit/home/" }) });
    expect(login.status).toBe(303);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    expect((await local.call("/mcp", { method: "POST", headers: { cookie } })).status).toBe(401);
    expect((await local.call("/api/v1/me", { headers: { cookie } })).status).toBe(401);
    const page = await local.call("/edit/home/", { headers: { authorization: "Bearer " + agentToken, accept: "text/html" } });
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe("/__local/login?next=%2Fedit%2Fhome%2F");
    expect((await local.call("/edit/home/", { headers: { cookie, accept: "text/html" } })).status).toBe(200);
  } finally { await local.close(); }
  const disabled = await localServer({ password, localApi: true });
  try {
    const response = await disabled.call("/api/v1/me");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "agent access is off: set ACARD_AGENT_TOKEN on the server" });
  } finally { await disabled.close(); }
}, 30_000);

test("tokenless agent reads and writes reject cross-site origins", async () => {
  const local = await localServer({ localApi: true });
  try {
    for (const [path, method] of [["/api/v1/pages", "POST"], ["/api/v1/me", "GET"], ["/api/v1/me", "HEAD"], ["/AGENTS.md", "GET"], ["/llms.txt", "GET"], ["/mcp", "POST"]]) {
      expect((await local.call(path, { method, headers: { origin: "http://evil.example" } })).status).toBe(403);
    }
    expect((await local.call("/api/v1/me", { headers: { origin: local.base } })).status).toBe(200);
    for (const origin of ["null", "", "http://evil.example", local.base + ".evil.example"]) {
      expect(sameOrigin(req(local.base, { headers: { origin } }), local.port)).toBe(false);
    }
    expect(sameOrigin(req(local.base), local.port)).toBe(true);
    expect(sameOrigin(req(local.base, { headers: { origin: "http://notes.lan:" + local.port } }), local.port, ["notes.lan"])).toBe(true);
    expect(sameOrigin(req(local.base, { headers: { origin: "http://evil.example" } }), local.port, ["*"])).toBe(false);
  } finally { await local.close(); }
}, 30_000);

test("local agent API rejects DNS rebinding even with a valid bearer", async () => {
  const agentToken = "a-local-agent-token-with-32-chars!";
  const local = await localServer({ localApi: true, agentToken });
  try {
    expect((await local.call("/api/v1/me", { headers: { host: "evil.example:" + local.port } })).status).toBe(403);
    expect((await local.call("/api/v1/me", { headers: { host: "evil.example:" + local.port, authorization: "Bearer " + agentToken } })).status).toBe(403);
  } finally { await local.close(); }
}, 30_000);

test("guard allows configured LAN names and rejects others", () => {
  expect(guard(req("http://127.0.0.1:47811/"), 47811)).toBeNull();
  expect(guard(req("http://192.168.0.10:47811/"), 47811)?.status).toBe(403);
  expect(guard(req("http://192.168.0.10:47811/"), 47811, ["192.168.0.10"])).toBeNull();
  expect(guard(req("http://notes.lan:47811/"), 47811, ["192.168.0.10"])?.status).toBe(403);
  expect(guard(req("http://anything:47811/"), 47811, ["*"])).toBeNull();
  const crossSite = req("http://192.168.0.10:47811/api/pages", { method: "POST", headers: { origin: "http://evil.example" } });
  expect(guard(crossSite, 47811, ["192.168.0.10"])?.status).toBe(403);
  const sameSite = req("http://192.168.0.10:47811/api/pages", { method: "POST", headers: { origin: "http://192.168.0.10:47811" } });
  expect(guard(sameSite, 47811, ["192.168.0.10"])).toBeNull();
});

// The local workspace store stands in for WorkspaceStore, so it must answer every call gate/tenancy.ts makes (pipe()
// since 44b4cfe: the first page request crashed the local server with "stub.pipe is not a function").
test("local workspace store answers statements, batches and failures through the tenancy adapter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lan-store-"));
  const local = localEnv({ dataDir: dir, appDir: dir, port: 47811 });
  try {
    const db = (local.env as any).DB;
    await db.prepare("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)").run();
    const [one, two] = await Promise.all([db.prepare("INSERT INTO t (v) VALUES (?)").bind("a").run(), db.prepare("INSERT INTO t (v) VALUES (?)").bind("b").run()]);
    expect([one.meta.changes, two.meta.changes]).toEqual([1, 1]);
    await db.batch([db.prepare("INSERT INTO t (v) VALUES (?)").bind("c")]);
    expect(await db.prepare("SELECT count(*) AS n FROM t").first()).toEqual({ n: 3 });
    await expect(db.prepare("SELECT * FROM missing").all()).rejects.toThrow(/missing/);
  } finally {
    local.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("password gate: login sets a cookie that unlocks pages, wrong password and forged cookies do not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lan-gate-"));
  try {
    const gate = passwordGate(dir, "correct horse");
    const base = "http://192.168.0.10:47811";
    const page = await gate(req(base + "/edit/home/", { headers: { accept: "text/html" } }), new URL(base + "/edit/home/"));
    expect(page?.status).toBe(303);
    expect(page?.headers.get("location")).toBe("/__local/login?next=%2Fedit%2Fhome%2F");
    const api = await gate(req(base + "/api/tree"), new URL(base + "/api/tree"));
    expect(api?.status).toBe(401);
    expect(await gate(req(base + "/__local/health"), new URL(base + "/__local/health"))).toBeNull();
    // Brand files load before sign-in (the sign-in page shows them); anything else stays locked.
    expect(await gate(req(base + "/wordmark.svg"), new URL(base + "/wordmark.svg"))).toBeNull();
    expect(await gate(req(base + "/favicon.svg"), new URL(base + "/favicon.svg"))).toBeNull();
    expect((await gate(req(base + "/wordmark.svg", { method: "POST" }), new URL(base + "/wordmark.svg")))?.status).toBe(401);
    expect((await gate(req(base + "/og.png"), new URL(base + "/og.png")))?.status).toBe(401);
    const signIn = await gate(req(base + "/__local/login"), new URL(base + "/__local/login"));
    const signInHtml = await signIn!.text();
    expect(signInHtml).toContain("<title>Sign in - Acard</title>");
    expect(signInHtml).toContain('src="/wordmark.svg"');

    const login = (password: string, next = "/edit/home/") => gate(req(base + "/__local/login", { method: "POST", body: new URLSearchParams({ password, next }) }), new URL(base + "/__local/login"));
    expect((await login("wrong"))?.status).toBe(401);
    const ok = await login("correct horse");
    expect(ok?.status).toBe(303);
    expect(ok?.headers.get("location")).toBe("/edit/home/");
    const cookie = (ok?.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^acard_session=\d+\.[0-9a-f]{64}$/);
    expect(await gate(req(base + "/api/tree", { headers: { cookie } }), new URL(base + "/api/tree"))).toBeNull();

    const forged = cookie.replace(/\.[0-9a-f]{4}/, ".0000");
    expect((await gate(req(base + "/api/tree", { headers: { cookie: forged } }), new URL(base + "/api/tree")))?.status).toBe(401);
    const offsite = await login("correct horse", "//evil.example/");
    expect(offsite?.headers.get("location")).toBe("/");
    // A new password invalidates old sessions.
    const other = passwordGate(dir, "new password");
    expect((await other(req(base + "/api/tree", { headers: { cookie } }), new URL(base + "/api/tree")))?.status).toBe(401);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
