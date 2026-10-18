import { expect, test } from "bun:test";
import { createOfflineWorker, route, shouldCache } from "../offline-sw.js";
import { assembleWorkerSource } from "./assemble-worker";

const origin = "https://notes.test";
const req = (path: string, method = "GET") => new Request(origin + path, { method });
const html = (text = "private") => new Response('<main id="main">' + text + '</main>', { headers: { "content-type": "text/html" } });

test("anonymous update can fetch only the generated worker script, not private routes", async () => {
  const worker = new Function(assembleWorkerSource())();
  const env = { GATE_PASSWORD: "fixture-pw", GATE_SECRET: "fixture-secret", ASSETS: { fetch: async () => new Response("/* generated worker */") } };
  const response = await worker.fetch(req("/sw.js"), env);
  expect(response.status).toBe(200);
  expect(response.headers.get("service-worker-allowed")).toBe("/");
  expect(response.headers.get("cache-control")).toBe("no-cache");
  for (const path of ["/one/", "/api/page/one", "/api/tree", "/notes-seed.json", "/app.js", "/edit/one", "/sw.js/extra"]) {
    expect((await worker.fetch(req(path), env)).status).toBe(401);
  }
  expect((await worker.fetch(req("/sw.js", "POST"), env)).status).toBe(401);
});

// Cache API semantics used by the worker: cloned responses, absolute keys,
// named-cache deletion and independently surviving cache handles.
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
  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) { cache = new MemoryCache(); this.stores.set(name, cache); }
    return cache;
  }
  async keys() { return [...this.stores.keys()]; }
  async has(name: string) { return this.stores.has(name); }
  async delete(name: string) { return this.stores.delete(name); }
}
function fixture() {
  const caches = new MemoryCaches();
  let network: (request: Request) => Promise<Response> = async () => html();
  const errors: unknown[] = [];
  const sw = createOfflineWorker({ caches, origin, fetch: (request: Request) => network(request), report: (error: unknown) => errors.push(error) }, { version: "test", shell: ["/app.js?v=abc"] });
  return { caches, sw, errors, network(fn: typeof network) { network = fn; }, offline() { network = async () => { throw new TypeError("offline"); }; } };
}

test("cache fake preserves clone and deletion semantics", async () => {
  const caches = new MemoryCaches();
  const cache = await caches.open("test");
  await cache.put(req("/one/"), html());
  expect(await (await cache.match(req("/one/")))?.text()).toContain("private");
  expect(await (await cache.match(req("/one/")))?.text()).toContain("private");
  await caches.delete("test");
  expect(await caches.keys()).toEqual([]);
  expect(await (await caches.open("test")).keys()).toEqual([]);
});

test("only page HTML, page API, tree and exact shell URLs are cacheable", () => {
  for (const path of ["/", "/one/", "/api/page/one", "/api/tree"]) {
    expect(route(req(path), origin)).not.toBeNull();
    expect(shouldCache(req(path), html(), origin)).toBe(true);
  }
  for (const path of ["/__gate", "/__logout", "/api/agents", "/api/agents/x", "/mcp", "/mcp/", "/sse", "/oauth/login", "/oauth/", "/p/token", "/p/", "/api/search", "/edit/one", "/edit/", "/print/one/", "/notes-seed.json"]) {
    expect(route(req(path), origin)).toBeNull();
    expect(shouldCache(req(path), html(), origin)).toBe(false);
  }
  expect(shouldCache(req("/app.js?v=abc"), html(), origin, ["/app.js?v=abc"])).toBe(true);
  expect(shouldCache(req("/app.js?v=other"), html(), origin, ["/app.js?v=abc"])).toBe(false);
  expect(shouldCache(new Request("https://other.test/one/"), html(), origin)).toBe(false);
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) expect(shouldCache(req("/one/", method), html(), origin)).toBe(false);
  for (const status of [201, 204, 301, 401, 403, 404, 500]) expect(shouldCache(req("/one/"), new Response(null, { status }), origin)).toBe(false);
});

test("install precaches exact versioned shell assets only", async () => {
  const f = fixture();
  await f.sw.install();
  f.offline();
  expect((await f.sw.handle(req("/app.js?v=abc"))).status).toBe(200);
  expect((await f.sw.handle(req("/unknown/"))).status).toBe(503);
  expect(await f.caches.keys()).toEqual(["acard-shell-test"]);
});

test("failed install never stores an unauthorized shell response", async () => {
  const f = fixture();
  f.network(async () => new Response("denied", { status: 401 }));
  await expect(f.sw.install()).rejects.toThrow("Shell precache failed");
  expect(await f.caches.keys()).toEqual([]);
});

test("network first updates content and offline HTML carries a status banner", async () => {
  const f = fixture();
  await f.sw.handle(req("/one/"));
  f.network(async () => html("new revision"));
  await f.sw.handle(req("/one/"));
  f.offline();
  const response = await f.sw.handle(req("/one/"));
  expect(response.status).toBe(200);
  expect(response.headers.get("x-acard-offline")).toBe("1");
  const body = await response.text();
  expect(body).toContain("new revision");
  expect(body).toContain('id="acard-offline"');
});

test("API cache fallback preserves JSON and tree does not consume page slots", async () => {
  const f = fixture();
  f.network(async () => Response.json({ page: { title: "saved" } }));
  await f.sw.handle(req("/api/page/one"));
  await f.sw.handle(req("/api/tree"));
  f.offline();
  expect(await (await f.sw.handle(req("/api/page/one"))).json()).toEqual({ page: { title: "saved" } });
  expect((await f.sw.handle(req("/api/tree"))).status).toBe(200);
  expect(await (await (await f.caches.open("acard-lru-test")).match(origin + "/__offline_lru"))?.json()).toEqual(["one"]);
});

test("LRU retains fifty page groups and evicts HTML and API together", async () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) {
    await f.sw.handle(req("/p" + i + "/"));
    await f.sw.handle(req("/api/page/p" + i));
  }
  f.offline();
  await f.sw.handle(req("/p0/"));
  f.network(async () => html());
  await f.sw.handle(req("/p50/"));
  f.offline();
  expect((await f.sw.handle(req("/p0/"))).status).toBe(200);
  expect((await f.sw.handle(req("/p1/"))).status).toBe(503);
  expect((await f.sw.handle(req("/api/page/p1"))).status).toBe(503);
  expect((await f.sw.handle(req("/p50/"))).status).toBe(200);
});

test("HTTP errors never become cached successes", async () => {
  for (const status of [401, 403, 404, 500]) {
    const f = fixture();
    await f.sw.handle(req("/one/"));
    f.network(async () => new Response("denied", { status }));
    const response = await f.sw.handle(req("/one/"));
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("denied");
  }
});

test("401 evicts all private caches and cannot fall back after restart", async () => {
  const f = fixture();
  await f.sw.handle(req("/one/"));
  await f.sw.handle(req("/api/page/two"));
  f.network(async () => new Response("expired", { status: 401 }));
  expect((await f.sw.handle(req("/one/"))).status).toBe(401);
  f.offline();
  expect((await f.sw.handle(req("/api/page/two"))).status).toBe(503);
  expect(await f.caches.keys()).toEqual([]);
});

test("credentialless manifest failure does not expire an authenticated page cache", async () => {
  const f = fixture();
  await f.sw.handle(req("/one/"));
  f.network(async () => new Response("no cookie", { status: 401 }));
  await f.sw.handle(new Request(origin + "/manifest.webmanifest", { credentials: "omit" }));
  f.offline();
  expect((await f.sw.handle(req("/one/"))).status).toBe(200);
});

test("logout wipes every cache even when the network is offline", async () => {
  const f = fixture();
  await f.sw.install();
  await f.sw.handle(req("/one/"));
  await (await f.caches.open("other-feature")).put(req("/two/"), html());
  f.offline();
  await f.sw.handle(req("/__logout", "POST"));
  expect((await f.sw.handle(req("/one/"))).status).toBe(503);
  expect(await f.caches.keys()).toEqual([]);
});

test("in-flight successes cannot resurrect caches after logout", async () => {
  const f = fixture();
  const response = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  f.network(async request => {
    if (new URL(request.url).pathname === "/__logout") return new Response(null, { status: 303 });
    started.resolve();
    return response.promise;
  });
  const pending = f.sw.handle(req("/one/"));
  await started.promise;
  await f.sw.handle(req("/__logout", "POST"));
  response.resolve(html());
  await pending;
  expect(await f.caches.keys()).toEqual([]);
});

test("new login can cache pages again without restoring prior private content", async () => {
  const f = fixture();
  await f.sw.handle(req("/old/"));
  await f.sw.handle(req("/__logout", "POST"));
  await f.sw.handle(req("/__gate", "POST"));
  await f.sw.handle(req("/new/"));
  f.offline();
  expect((await f.sw.handle(req("/old/"))).status).toBe(503);
  expect((await f.sw.handle(req("/new/"))).status).toBe(200);
});

test("navigation login opaque redirect re-enables caching after logout", async () => {
  const f = fixture();
  await f.sw.handle(req("/__logout", "POST"));
  const redirect = new Response(null, { status: 303 });
  Object.defineProperties(redirect, { status: { value: 0 }, type: { value: "opaqueredirect" } });
  f.network(async () => redirect);
  await f.sw.handle(req("/__gate", "POST"));
  f.network(async () => html());
  await f.sw.handle(req("/new/"));
  f.offline();
  expect((await f.sw.handle(req("/new/"))).status).toBe(200);
});
