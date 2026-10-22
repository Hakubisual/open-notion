// Outgoing webhooks (#113): signature, secret storage, SSRF checks, which writes count, and the debounce / retry /
// auto-disable flow through migration 030 in a real Postgres (PGlite), with the Supabase REST calls and the receiver mocked.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newSink, trackDb } from "../gate/live";
import {
  WEBHOOK_CONFIG, checkTarget, checkUrl, collectWrite, forgetPresence, isBlockedIp, newSecret, openSecret, queueWebhooks, sealSecret,
  signatureHeader, verifySignature, watchWrites, webhookApi, webhookTick, type Hints, type WebhookEnv,
} from "../gate/webhooks";

const SUPA = "https://supa.test";
const USER = "aaaaaaaa-1111-4111-8111-111111111111";
const WS = "a".repeat(32);
const armed: number[] = [];
const env: WebhookEnv = {
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service", SITE_URL: "https://acard.test", WEBHOOK_SECRET_KEY: "key-for-tests",
  WORKSPACE: { idFromName: (n: string) => n, get: () => ({ armWebhooks: async (at: number) => { armed.push(at); }, hit: async () => true }) },
};

let lite: PGlite;
const realFetch = globalThis.fetch;
const received: { url: string; headers: Record<string, string>; body: string; redirect?: string }[] = [];
let receiverStatus = 200;
const dns: Record<string, string[]> = { "hooks.example.org": ["93.184.216.34"], "evil.example.org": ["10.0.0.5"], "v6.example.org": ["fd00::1"] };
const rows = async (sql: string, params: unknown[] = []) => (await lite.query(sql, params)).rows as any[];

const CALLS: Record<string, (a: any) => [string, unknown[]]> = {
  webhook_enqueue: (a) => ["SELECT public.webhook_enqueue($1, $2::jsonb, $3::jsonb, $4::jsonb) AS r", [a.p_ws, JSON.stringify(a.p_items), JSON.stringify(a.p_actor), JSON.stringify(a.p_config)]],
  webhook_claim: (a) => ["SELECT public.webhook_claim($1, $2) AS r", [a.p_limit, a.p_lease_ms]],
  webhook_result: (a) => ["SELECT public.webhook_result($1, $2, $3, $4, $5, $6::jsonb) AS r", [a.p_id, a.p_ok, a.p_status, a.p_error, a.p_ms, JSON.stringify(a.p_config)]],
  webhook_next: () => ["SELECT public.webhook_next() AS r", []],
  webhook_prune: (a) => ["SELECT public.webhook_prune($1) AS r", [a.p_days]],
  webhook_create: (a) => ["SELECT public.webhook_create($1, $2, $3, $4, $5, $6, $7, $8) AS r", [a.p_ws, a.p_user, a.p_url, a.p_description, a.p_events, a.p_secret_enc, a.p_secret_hint, a.p_limit]],
  webhook_list: (a) => ["SELECT public.webhook_list($1) AS r", [a.p_ws]],
  webhook_update: (a) => ["SELECT public.webhook_update($1, $2, $3::jsonb) AS r", [a.p_ws, a.p_id, JSON.stringify(a.p_patch)]],
  webhook_delete: (a) => ["SELECT public.webhook_delete($1, $2) AS r", [a.p_ws, a.p_id]],
  webhook_target: (a) => ["SELECT public.webhook_target($1, $2) AS r", [a.p_ws, a.p_id]],
  webhook_log: (a) => ["SELECT public.webhook_log($1, $2, $3) AS r", [a.p_ws, a.p_id, a.p_limit]],
  webhook_record: (a) => ["SELECT public.webhook_record($1, $2, $3, $4, $5, $6, $7) AS r", [a.p_ws, a.p_id, a.p_type, a.p_ok, a.p_status, a.p_error, a.p_ms]],
};

beforeAll(async () => {
  lite = new PGlite();
  await lite.exec("CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated;");
  const sql = readFileSync(join(import.meta.dir, "..", "migrations/supabase/030-acard-webhooks.sql"), "utf8");
  await lite.exec(sql);
  await lite.exec(sql);
  await lite.query("INSERT INTO auth.users (id) VALUES ($1)", [USER]);
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.origin === "https://cloudflare-dns.com") {
      const name = url.searchParams.get("name")!, type = url.searchParams.get("type");
      const ips = (dns[name] ?? []).filter((ip) => (type === "AAAA") === ip.includes(":"));
      return Response.json({ Status: 0, Answer: ips.map((data) => ({ type: data.includes(":") ? 28 : 1, data })) });
    }
    if (url.origin === SUPA) {
      if (url.pathname === "/rest/v1/webhook_endpoints") return Response.json(await rows("SELECT id FROM public.webhook_endpoints WHERE enabled AND ws = $1 LIMIT 1", [url.searchParams.get("ws")!.slice(3)]));
      const fn = url.pathname.replace("/rest/v1/rpc/", "");
      const [sql, params] = CALLS[fn](JSON.parse(init.body));
      return Response.json((await rows(sql, params))[0].r);
    }
    if (url.hostname === "hooks.example.org") {
      received.push({ url: url.href, headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body, redirect: init.redirect });
      return new Response("ok", { status: receiverStatus });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(async () => { globalThis.fetch = realFetch; await lite.close(); });
beforeEach(async () => {
  await lite.exec("DELETE FROM public.webhook_endpoints;");
  received.length = 0; armed.length = 0; receiverStatus = 200; forgetPresence();
});

const later = (ms: number) => lite.exec(`UPDATE public.webhook_deliveries SET send_after = send_after - interval '${ms} milliseconds', next_attempt_at = next_attempt_at - interval '${ms} milliseconds'`);
const who = { ws: WS, user: USER };
const api = (method: string, path: string, body?: unknown) =>
  webhookApi(new Request("https://acard.test/api/webhooks" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env, new URL("https://acard.test/api/webhooks" + path), who);

async function endpoint(tuning: Record<string, number> = {}) {
  const res = await api("POST", "", { url: "https://hooks.example.org/in", description: "QA" });
  expect(res.status).toBe(201);
  const out = (await res.json()) as { webhook: { id: string }; secret: string };
  if (Object.keys(tuning).length) await lite.query("UPDATE public.webhook_endpoints SET tuning = $1::jsonb WHERE id = $2", [JSON.stringify(tuning), out.webhook.id]);
  return out;
}

// A page store shaped like the app's D1 adapter: run() reports how many rows changed, as both real drivers do.
function pageDb() {
  const pages = new Map<string, { title: string; parent: string | null; kind: string }>();
  const trash = new Set<string>();
  const run = (sql: string, p: any[]) => {
    if (/^INSERT INTO pages/i.test(sql)) { pages.set(p[0], { title: p[1], parent: p[2], kind: "note" }); return 1; }
    if (/^UPDATE pages SET title/i.test(sql)) { const row = pages.get(p[p.length - 1]); if (row) row.title = p[0]; return row ? 1 : 0; }
    if (/^UPDATE pages SET parent/i.test(sql)) { const row = pages.get(p[p.length - 1]); if (row) row.parent = p[0]; return row ? 1 : 0; }
    if (/^UPDATE pages SET updated = updated/i.test(sql)) return pages.has(p[0]) ? 1 : 0;
    if (/^DELETE FROM blocks|^INSERT INTO blocks/i.test(sql)) return 1;
    if (/^INSERT INTO editor_trash/i.test(sql)) { trash.add(p[0]); return 1; }
    if (/^DELETE FROM editor_trash/i.test(sql)) return trash.delete(p[0]) ? 1 : 0;
    if (/^DELETE FROM pages/i.test(sql)) { trash.delete(p[0]); return pages.delete(p[0]) ? 1 : 0; }
    return 0;
  };
  const statement = (sql: string, params: any[] = []): any => ({
    sql, params,
    bind: (...next: any[]) => statement(sql, next),
    run: async () => ({ success: true, results: [], meta: { changes: run(sql, params) } }),
    first: async () => null,
    all: async () => {
      if (/FROM pages p WHERE p\.slug IN/.test(sql)) return { results: params.filter((s) => pages.has(s)).map((s) => ({ slug: s, ...pages.get(s), trashed: trash.has(s) ? 1 : 0 })) };
      return { results: [] };
    },
  });
  return { prepare: (sql: string) => statement(sql), batch: async (list: any[]) => Promise.all(list.map((s) => s.run())) };
}

// One request: a fresh tracked db over the same store, then the after-response queue step, like gate/agent-entry.ts.
async function request(store: ReturnType<typeof pageDb>, work: (db: any) => Promise<unknown>, extra: string[] = []) {
  const sink = watchWrites(newSink(WS));
  await work(trackDb(store, sink));
  return queueWebhooks(env, [sink], { kind: "human" }, extra);
}
const save = (slug: string, text: string) => (db: any) => db.batch([
  db.prepare("UPDATE pages SET updated = updated WHERE slug = ?").bind(slug),
  db.prepare("DELETE FROM blocks WHERE page = ?").bind(slug),
  db.prepare("INSERT INTO blocks (page, id, ord, type, text, checked, indent, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(slug, "b1", 0, "paragraph", text, 0, 0, null),
]);
const create = (slug: string, title: string) => (db: any) => db.prepare("INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, 'note', ?, 'editor', NULL)").bind(slug, title, null, 10, Date.now()).run();

describe("signature", () => {
  test("header is t=<seconds>,v1=HMAC-SHA256(secret, '<t>.<body>') as the docs show for Node", async () => {
    const body = JSON.stringify({ id: "x", type: "page.updated" });
    const header = await signatureHeader("whsec_test", body, 1_792_000_000_000);
    const expected = createHmac("sha256", "whsec_test").update("1792000000." + body).digest("hex");
    expect(header).toBe("t=1792000000,v1=" + expected);
  });

  test("verify accepts the signed body and rejects a changed body, another secret or an old timestamp", async () => {
    const body = '{"a":1}', now = Date.now();
    const header = await signatureHeader("s1", body, now);
    expect(await verifySignature("s1", header, body, now)).toBe(true);
    expect(await verifySignature("s1", header, '{"a":2}', now)).toBe(false);
    expect(await verifySignature("s2", header, body, now)).toBe(false);
    expect(await verifySignature("s1", header, body, now + (WEBHOOK_CONFIG.tolerance_s + 5) * 1000)).toBe(false);
    expect(await verifySignature("s1", null, body, now)).toBe(false);
  });
});

describe("secret storage", () => {
  test("sealed form does not contain the secret, opens with the key and fails with another", async () => {
    const secret = newSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const sealed = await sealSecret(env, secret);
    expect(sealed).not.toContain(secret.slice(6));
    expect(await openSecret(env, sealed)).toBe(secret);
    await expect(openSecret({ ...env, WEBHOOK_SECRET_KEY: "other" }, sealed)).rejects.toThrow();
  });
});

describe("SSRF", () => {
  test.each([
    "http://hooks.example.org/in", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x",
    "https://2130706433/x", "https://0x7f.1/x", "https://10.0.0.1/x", "https://192.168.0.10/x", "https://172.16.5.4/x", "https://[fd00::1]/x",
    "https://[::ffff:127.0.0.1]/x", "https://[fe80::1]/x", "https://100.64.0.1/x", "https://printer.local/x", "https://db.internal/x",
    "https://hooks.example.org:8443/x", "https://user:pw@hooks.example.org/x", "https://acard.test/x", "ftp://hooks.example.org/x", "not a url",
  ])("rejects %s", (url) => {
    expect(checkUrl(url, "acard.test").ok).toBe(false);
  });

  test("accepts a public https host and keeps its path and query", () => {
    expect(checkUrl("https://hooks.example.org/in?k=1#frag", "acard.test")).toEqual({ ok: true, url: "https://hooks.example.org/in?k=1", host: "hooks.example.org", ip: false });
  });

  test("blocked address ranges", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.31.0.1", "192.168.1.1", "100.100.100.200", "224.0.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:a00:1::1", "garbage"]) expect(isBlockedIp(ip)).toBe(true);
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:93.184.216.34"]) expect(isBlockedIp(ip)).toBe(false);
  });

  test("a name that resolves to a private address is refused at send time too", async () => {
    expect((await checkTarget("https://hooks.example.org/in", "acard.test")).ok).toBe(true);
    expect((await checkTarget("https://evil.example.org/in", "acard.test")).ok).toBe(false);
    expect((await checkTarget("https://v6.example.org/in", "acard.test")).ok).toBe(false);
    expect((await checkTarget("https://nowhere.example.org/in", "acard.test")).ok).toBe(false);
  });
});

describe("which writes count", () => {
  test("page insert, block save, trash, restore and permanent delete give their hints; no-op writes and other tables do not", () => {
    const hints: Hints = new Map();
    collectWrite(hints, "INSERT INTO pages (slug, title, parent, ord, kind, updated, source, hash) VALUES (?, ?, ?, ?, ?, ?, 'editor', NULL)", ["new", "T", null, 1, "note", 1], 1);
    collectWrite(hints, "DELETE FROM blocks WHERE page = ?", ["saved"], 3);
    collectWrite(hints, "INSERT INTO editor_trash (page, deleted, permanent) VALUES (?, ?, 0)", ["binned", 1], 1);
    collectWrite(hints, "DELETE FROM editor_trash WHERE page = ? AND permanent = 0", ["back"], 1);
    collectWrite(hints, "INSERT INTO editor_trash (page, deleted, permanent) VALUES (?, ?, 1) ON CONFLICT(page) DO UPDATE SET permanent = 1", ["gone", 1], 1);
    collectWrite(hints, "INSERT OR IGNORE INTO pages (slug, title) VALUES (?, ?)", ["seeded", "x"], 0);
    collectWrite(hints, "UPDATE pages SET title = ? WHERE slug = ?", ["Secret title", "renamed"], 1);
    collectWrite(hints, "INSERT INTO agent_tokens (id) VALUES (?)", ["tok"], 1);
    collectWrite(hints, "DELETE FROM pages WHERE kind = 'db_row' AND slug IN (?, ?)", ["r1", "r2"], 2);
    expect(Object.fromEntries([...hints].map(([k, v]) => [k, [...v].sort()]))).toEqual({
      new: ["content", "created"], saved: ["content"], binned: ["trashed"], back: ["restored"], gone: ["deleted"], renamed: ["content"], r1: ["deleted"], r2: ["deleted"],
    });
  });
});

describe("delivery flow", () => {
  test("create + three quick saves make one signed delivery after the debounce", async () => {
    const { secret } = await endpoint({ debounce_ms: 2000 });
    const store = pageDb();
    await request(store, create("note-1", "Plan"));
    for (const text of ["a", "ab", "abc"]) await request(store, save("note-1", text));
    expect(armed.length).toBe(4);
    expect((await webhookTick(env)).sent).toBe(0);
    await later(2500);
    const tick = await webhookTick(env);
    expect(tick.sent).toBe(1);
    expect(received.length).toBe(1);
    const got = received[0];
    const body = JSON.parse(got.body);
    expect(body).toMatchObject({ type: "page.created", version: 1, workspace: { id: WS }, page: { slug: "note-1", title: "Plan", url: "https://acard.test/note-1/" }, actor: { kind: "human" } });
    expect(body.changes).toEqual(["page.created", "page.updated"]);
    expect(got.headers["x-acard-event"]).toBe("page.created");
    expect(got.headers["x-acard-delivery"]).toBe(body.id);
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(got.headers["x-acard-signature"])!;
    expect(v1).toBe(createHmac("sha256", secret).update(t + "." + got.body).digest("hex"));
    expect(got.body).not.toContain("abc");
  });

  test("max wait sends a page that keeps changing", async () => {
    await endpoint({ debounce_ms: 10_000, max_wait_ms: 1000 });
    const store = pageDb();
    await request(store, create("busy", "Busy"));
    await later(800);
    await request(store, save("busy", "x"));
    const due = (await rows("SELECT send_after - first_change_at AS gap FROM public.webhook_deliveries"))[0];
    expect(String(due.gap)).toMatch(/^00:00:0[01]/);
  });

  test("rename, move, trash, restore and delete after a delivery are told apart", async () => {
    await endpoint({ debounce_ms: 1 });
    const store = pageDb();
    const flush = async () => { await later(1000); await webhookTick(env); return JSON.parse(received[received.length - 1].body); };
    await request(store, create("p", "One"));
    expect((await flush()).type).toBe("page.created");
    await request(store, (db) => db.prepare("UPDATE pages SET title = ?, updated = ?, source = 'editor' WHERE slug = ?").bind("Two", 1, "p").run(), ["rename"]);
    expect(await flush()).toMatchObject({ type: "page.renamed", page: { title: "Two" } });
    await request(store, save("p", "same title, new text"));
    expect((await flush()).type).toBe("page.updated");
    await request(store, (db) => db.prepare("UPDATE pages SET parent = ?, ord = ?, updated = ?, source = 'editor' WHERE slug = ?").bind("folder", 1, 1, "p").run(), ["move"]);
    expect(await flush()).toMatchObject({ type: "page.moved", page: { parent: "folder" } });
    await request(store, (db) => db.prepare("INSERT INTO editor_trash (page, deleted, permanent) VALUES (?, ?, 0)").bind("p", 1).run());
    expect(await flush()).toMatchObject({ type: "page.trashed", page: { trashed: true } });
    await request(store, (db) => db.prepare("DELETE FROM editor_trash WHERE page = ? AND permanent = 0").bind("p").run());
    expect((await flush()).type).toBe("page.restored");
    await request(store, (db) => db.prepare("DELETE FROM pages WHERE slug = ?").bind("p").run());
    expect(await flush()).toMatchObject({ type: "page.deleted", page: { slug: "p", title: "Two", url: null } });
  });

  test("a 500 receiver is retried with growing gaps, then the endpoint turns itself off", async () => {
    const { webhook } = await endpoint({ debounce_ms: 1, backoff_base_ms: 1000, backoff_max_ms: 60_000, disable_after: 3 });
    receiverStatus = 500;
    const store = pageDb();
    await request(store, create("fails", "F"));
    const gaps: number[] = [];
    for (let i = 0; i < 3; i++) {
      await later(120_000);
      const tick = await webhookTick(env);
      expect(tick.sent).toBe(1);
      const row = (await rows("SELECT status, attempts, extract(epoch FROM next_attempt_at - updated_at) * 1000 AS gap FROM public.webhook_deliveries"))[0];
      if (row.status === "retry") gaps.push(Math.round(Number(row.gap)));
    }
    expect(gaps).toEqual([1000, 2000]);
    expect(received.length).toBe(3);
    const list = (await (await api("GET", "")).json()) as { webhooks: any[] };
    expect(list.webhooks[0]).toMatchObject({ id: webhook.id, enabled: false, disabled_reason: "failures", consecutive_failures: 3, last_status: 500 });
    await request(store, save("fails", "more"));
    expect((await rows("SELECT count(*)::int AS n FROM public.webhook_deliveries WHERE status = 'pending'"))[0].n).toBe(0);
    await api("PATCH", "/" + webhook.id, { enabled: true });
    expect(((await (await api("GET", "")).json()) as { webhooks: any[] }).webhooks[0]).toMatchObject({ enabled: true, consecutive_failures: 0, disabled_reason: null });
  });

  test("a redirect is not followed and counts as a failure", async () => {
    await endpoint({ debounce_ms: 1 });
    receiverStatus = 302;
    await request(pageDb(), create("r", "R"));
    await later(1000);
    expect((await webhookTick(env)).results[0]).toMatchObject({ status: "retry", http: 302 });
    expect(received[0].redirect).toBe("manual");
  });

  test("a workspace without endpoints queues nothing", async () => {
    expect(await request(pageDb(), create("quiet", "Q"))).toBe(0);
    expect((await rows("SELECT count(*)::int AS n FROM public.webhook_deliveries"))[0].n).toBe(0);
  });
});

describe("settings API", () => {
  test("http and internal addresses are refused; the limit holds", async () => {
    for (const url of ["http://hooks.example.org/in", "https://127.0.0.1/in", "https://evil.example.org/in"]) {
      const res = await api("POST", "", { url });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    }
    for (let i = 0; i < WEBHOOK_CONFIG.max_endpoints; i++) await endpoint();
    expect((await api("POST", "", { url: "https://hooks.example.org/in" })).status).toBe(409);
  });

  test("the secret is shown once: never in the list, the update or the log; rotate gives a new one", async () => {
    const { webhook, secret } = await endpoint();
    const listed = await (await api("GET", "")).text();
    expect(listed).not.toContain(secret);
    expect(listed).not.toContain("secret_enc");
    expect(listed).not.toContain("tuning");
    const patched = await (await api("PATCH", "/" + webhook.id, { description: "x" })).text();
    expect(patched).not.toContain(secret);
    const rotated = (await (await api("POST", "/" + webhook.id + "/rotate")).json()) as { secret: string };
    expect(rotated.secret).not.toBe(secret);
    const test = (await (await api("POST", "/" + webhook.id + "/test")).json()) as { ok: boolean; status: number };
    expect(test).toMatchObject({ ok: true, status: 200 });
    const ping = received[received.length - 1];
    expect(JSON.parse(ping.body).type).toBe("ping");
    expect(await verifySignature(rotated.secret, ping.headers["x-acard-signature"], ping.body)).toBe(true);
    const log = await (await api("GET", "/" + webhook.id + "/deliveries")).text();
    expect(log).toContain('"event":"ping"');
    expect(log).not.toContain(rotated.secret);
  });

  test("another workspace cannot see or change an endpoint", async () => {
    const { webhook } = await endpoint();
    const other = { ws: "b".repeat(32), user: USER };
    const call = (method: string, path: string, body?: unknown) => webhookApi(new Request("https://acard.test/api/webhooks" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) }), env, new URL("https://acard.test/api/webhooks" + path), other);
    expect(((await (await call("GET", "")).json()) as { webhooks: unknown[] }).webhooks).toEqual([]);
    expect((await call("PATCH", "/" + webhook.id, { enabled: false })).status).toBe(404);
    expect((await call("DELETE", "/" + webhook.id)).status).toBe(404);
    expect((await call("POST", "/" + webhook.id + "/test")).status).toBe(404);
  });

  test("a cross-site request is refused", async () => {
    const res = await webhookApi(new Request("https://acard.test/api/webhooks", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), env, new URL("https://acard.test/api/webhooks"), who);
    expect(res.status).toBe(403);
  });
});
