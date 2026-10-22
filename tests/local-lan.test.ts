// LAN mode of the local server: extra Host names pass the DNS-rebinding guard, and the password gate keeps every
// page and API behind a signed session cookie.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guard, localEnv, passwordGate } from "../local/server";

const req = (url: string, init: RequestInit & { host?: string } = {}) =>
  new Request(url, { ...init, headers: { host: init.host ?? new URL(url).host, ...(init.headers as Record<string, string>) } });

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
