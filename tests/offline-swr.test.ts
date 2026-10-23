import { expect, test } from "bun:test";
import { createOfflineWorker } from "../offline-sw.js";

const origin = "https://notes.test";
const id = "aaaaaaaaaaaaaaaa";
const req = (path: string, method = "GET") => new Request(origin + path, { method });

class MemoryCache {
  entries = new Map<string, Response>();
  key(input: Request | string) { return typeof input === "string" ? input : input.url; }
  async put(input: Request | string, response: Response) { this.entries.set(this.key(input), response.clone()); }
  async match(input: Request | string) { return this.entries.get(this.key(input))?.clone(); }
  async delete(input: Request | string) { return this.entries.delete(this.key(input)); }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
}
class MemoryCaches {
  stores = new Map<string, MemoryCache>();
  async open(name: string) { let c = this.stores.get(name); if (!c) { c = new MemoryCache(); this.stores.set(name, c); } return c; }
  async keys() { return [...this.stores.keys()]; }
  async has(name: string) { return this.stores.has(name); }
  async delete(name: string) { return this.stores.delete(name); }
}

function fixture() {
  let body = "v1";
  let status = 200;
  const messages: any[] = [];
  const pending: Promise<unknown>[] = [];
  const sw = createOfflineWorker({
    caches: new MemoryCaches(), origin, report: () => {}, notify: (m: unknown) => messages.push(m),
    fetch: async () => new Response(body, { status, headers: { "content-type": "text/html", "x-acard-id": id, etag: '"' + body + '"' } }),
  }, { version: "t", shell: [] });
  const handle = (r: Request) => sw.handle(r, (p: Promise<unknown>) => pending.push(p));
  const settle = () => Promise.all(pending.splice(0));
  return { handle, settle, messages, set(b: string, s = 200) { body = b; status = s; } };
}

test("member reader HTML is SWR and announces the changed network body with its etag", async () => {
  const f = fixture();
  expect((await f.handle(req("/one/"))).headers.get("x-acard-swr")).toBe("miss");
  await f.settle();
  f.set("v2");
  const r = await f.handle(req("/one/"));
  expect(r.headers.get("x-acard-swr")).toBe("hit");
  expect(await r.text()).toBe("v1");
  await f.settle();
  expect(f.messages.filter(m => m.type === "acard-fresh")).toEqual([{ type: "acard-fresh", kind: "html", url: origin + "/one/", etag: '"v2"' }]);
  expect(await (await f.handle(req("/one/"))).text()).toBe("v2");
  await f.settle();
  expect(f.messages.filter(m => m.type === "acard-fresh")).toHaveLength(1);
});

test("a cached tree answers from cache and the refresh announces only a changed body", async () => {
  const f = fixture();
  expect(await (await f.handle(req("/api/tree"))).text()).toBe("v1");
  await f.settle();
  const again = await f.handle(req("/api/tree"));
  expect(again.headers.get("x-acard-swr")).toBe("hit");
  await f.settle();
  expect(f.messages.some(m => m.type === "acard-fresh")).toBe(false);
  f.set("v2");
  expect(await (await f.handle(req("/api/tree"))).text()).toBe("v1");
  await f.settle();
  expect(f.messages.filter(m => m.type === "acard-fresh")).toEqual([{ type: "acard-fresh", kind: "tree", url: origin + "/api/tree", etag: '"v2"' }]);
  expect(await (await f.handle(req("/api/tree"))).text()).toBe("v2");
});

test("page JSON (the editor's base version) is never served stale", async () => {
  const f = fixture();
  await f.handle(req("/api/page/one"));
  f.set("newer");
  const r = await f.handle(req("/api/page/one"));
  expect(r.headers.get("x-acard-swr")).toBeNull();
  expect(await r.text()).toBe("newer");
});

test("a write drops the cached tree so the next read is fresh", async () => {
  const f = fixture();
  await f.handle(req("/api/folders/tree"));
  f.set("after-move");
  await f.handle(req("/api/page/one/move", "POST"));
  const r = await f.handle(req("/api/folders/tree"));
  expect(r.headers.get("x-acard-swr")).toBeNull();
  expect(await r.text()).toBe("after-move");
});

test("telemetry posts on every load keep the cache", async () => {
  const f = fixture();
  await f.handle(req("/api/tree"));
  await f.settle();
  await f.handle(req("/cdn-cgi/rum", "POST"));
  await f.handle(req("/api/beta/event", "POST"));
  expect((await f.handle(req("/api/tree"))).headers.get("x-acard-swr")).toBe("hit");
});

test("a plugin saving its own storage keeps the cache; installing or switching a plugin drops it (issue 144)", async () => {
  const f = fixture();
  await f.handle(req("/api/tree"));
  await f.settle();
  await f.handle(req("/api/plugins/qa-counter/storage", "PUT"));
  expect((await f.handle(req("/api/tree"))).headers.get("x-acard-swr")).toBe("hit");
  await f.handle(req("/api/plugins/qa-counter", "PATCH"));
  expect((await f.handle(req("/api/tree"))).headers.get("x-acard-swr")).toBeNull();
});

test("a 401 during refresh wipes the cache and tells the page", async () => {
  const f = fixture();
  await f.handle(req("/api/tree"));
  await f.settle();
  f.set("expired", 401);
  await f.handle(req("/api/tree"));
  await f.settle();
  expect(f.messages.some(m => m.type === "acard-auth")).toBe(true);
  f.set("other account");
  expect(await (await f.handle(req("/api/tree"))).text()).toBe("other account");
});

test("signing in as someone else clears the previous account's cache", async () => {
  const f = fixture();
  await f.handle(req("/one/"));
  f.set("second user");
  await f.handle(req("/api/auth/login", "POST"));
  const r = await f.handle(req("/one/"));
  expect(r.headers.get("x-acard-swr")).toBe("miss");
  expect(await r.text()).toBe("second user");
});

test("a tree refresh that started before a write does not put the old tree back (#14)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let body = "old", slow = false;
  const pending: Promise<unknown>[] = [];
  const sw = createOfflineWorker({
    caches: new MemoryCaches(), origin, report: () => {}, notify: () => {},
    fetch: async (r: Request) => { const b = body; if (slow && r.method === "GET") await gate; return new Response(b, { status: 200, headers: { "x-acard-id": id } }); },
  }, { version: "t", shell: [] });
  const handle = (r: Request) => sw.handle(r, (p: Promise<unknown>) => pending.push(p));
  await handle(req("/api/folders/tree"));
  await Promise.all(pending.splice(0));
  slow = true;
  await handle(req("/api/folders/tree"));
  body = "new";
  await handle(req("/api/folders/prefs", "PUT"));
  release();
  await Promise.all(pending.splice(0));
  slow = false;
  expect(await (await handle(req("/api/folders/tree"))).text()).toBe("new");
});

// The editor posts /api/sync on every open; for members it imports nothing and must keep the reader cache warm.
function syncFixture() {
  const caches = new MemoryCaches();
  let sync: unknown = { imported: 0, updated: 0, skipped: 0, databases: { imported: 0, rows: 0, skipped: 0 } };
  let body = "v1";
  const pending: Promise<unknown>[] = [];
  const sw = createOfflineWorker({
    caches, origin, report: () => {}, notify: () => {},
    fetch: async (r: Request) => new URL(r.url).pathname === "/api/sync"
      ? new Response(typeof sync === "string" ? sync : JSON.stringify(sync), { status: 200, headers: { "content-type": "application/json", "x-acard-id": id } })
      : new Response(body, { status: 200, headers: { "content-type": "text/html", "x-acard-id": id } }),
  }, { version: "t", shell: [] });
  const handle = (r: Request) => sw.handle(r, (p: Promise<unknown>) => pending.push(p));
  const settle = () => Promise.all(pending.splice(0));
  const warm = async () => { await handle(req("/api/tree")); await handle(req("/one/")); await settle(); };
  const state = async () => ({ tree: (await handle(req("/api/tree"))).headers.get("x-acard-swr"), html: (await handle(req("/one/"))).headers.get("x-acard-swr") });
  return { caches, handle, settle, warm, state, sync(v: unknown) { sync = v; }, set(b: string) { body = b; } };
}

test("a member /api/sync that imported nothing keeps the cached tree and reader HTML", async () => {
  const f = syncFixture();
  await f.warm();
  const r = await f.handle(req("/api/sync", "POST"));
  expect(await r.json()).toEqual({ imported: 0, updated: 0, skipped: 0, databases: { imported: 0, rows: 0, skipped: 0 } });
  expect(await f.state()).toEqual({ tree: "hit", html: "hit" });
});

test("an /api/sync that imported or updated something drops the cached tree and reader HTML", async () => {
  for (const result of [
    { imported: 2, updated: 0, skipped: 0, databases: { imported: 0, rows: 0, skipped: 0 } },
    { imported: 0, updated: 1, skipped: 0, databases: { imported: 0, rows: 0, skipped: 0 } },
    { imported: 0, updated: 0, skipped: 0, databases: { imported: 1, rows: 0, skipped: 0 } },
    { imported: 0, updated: 0, skipped: 0, databases: { imported: 0, rows: 3, skipped: 0 } },
    "not json",
    { ok: true },
  ]) {
    const f = syncFixture();
    await f.warm();
    f.sync(result);
    f.set("after-sync");
    const r = await f.handle(req("/api/sync", "POST"));
    expect(await r.text()).toBe(typeof result === "string" ? result : JSON.stringify(result));
    expect(await f.state()).toEqual({ tree: null, html: "miss" });
    expect(await (await f.handle(req("/one/"))).text()).toBe("after-sync");
  }
});

test("the reader's ?acard-revalidate refresh is never stored, so revalidation cannot grow the pages cache", async () => {
  const f = syncFixture();
  await f.warm();
  const r = await f.handle(new Request(origin + "/one/?acard-revalidate=1760000000000", { headers: { "x-acard-nav": "1" }, cache: "no-store" }));
  expect(r.status).toBe(200);
  expect(r.headers.get("x-acard-swr")).toBeNull();
  await f.settle();
  const keys = (await (await f.caches.open("acard-pages-t-" + id)).keys()).map(k => k.url);
  expect(keys.some(k => k.includes("acard-revalidate"))).toBe(false);
  expect(keys).toContain(origin + "/one/");
  expect((await f.handle(req("/one/"))).headers.get("x-acard-swr")).toBe("hit");
});
