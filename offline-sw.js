// Native CacheStorage policy. Kept outside client bundles and emitted as /sw.js.
export function route(request, origin) {
  const url = new URL(request.url);
  if (url.origin !== origin || request.method !== "GET") return null;
  const path = url.pathname;
  if (/^\/(?:__gate|__logout|api\/agents|mcp|sse|oauth|p(?:\/|$))/.test(path)) return null;
  if (path === "/api/tree" || path === "/api/folders/tree") return { kind: "tree", key: origin + path };
  const api = /^\/api\/page\/([^/]+)$/.exec(path);
  if (api) return { kind: "page", slug: api[1], key: origin + path };
  if (path === "/") return { kind: "html", slug: "index", key: origin + "/" };
  const page = /^\/([^/.]+)\/$/.exec(path);
  if (page && !/^(api|edit|print|media|agents)$/.test(page[1])) {
    return { kind: "html", slug: page[1], key: origin + path };
  }
  return null;
}

export function shouldCache(request, response, origin, shell = []) {
  if (request.method !== "GET" || response.status !== 200 || response.redirected) return false;
  const url = new URL(request.url);
  return url.origin === origin && (!!route(request, origin) || shell.includes(url.pathname + url.search));
}

const message = "오프라인이에요. 저장해 둔 페이지만 볼 수 있어요.";
function missing(request) {
  const html = request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
  return new Response(html
    ? '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>오프라인 · Acard</title><style>html{color-scheme:light dark}body{margin:0;font:16px/1.85 system-ui,sans-serif;background:light-dark(#fff,#191e26);color:light-dark(#202733,#edf2f9)}main{max-width:480px;margin:20vh auto;padding:24px}h1{font-size:28px;line-height:1.25}p{color:light-dark(#606c7c,#a4afbf)}</style><main><h1>오프라인이에요.</h1><p>저장해 둔 페이지만 볼 수 있어요.</p></main></html>'
    : JSON.stringify({ error: message }), {
    status: 503, headers: { "content-type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function cachedResponse(response, kind) {
  const headers = new Headers(response.headers);
  headers.set("x-acard-offline", "1");
  headers.set("cache-control", "no-store");
  if (kind !== "html") return new Response(response.body, { headers });
  headers.delete("content-length");
  headers.delete("content-encoding");
  const banner = '<aside id="acard-offline" role="status" style="padding:12px 16px;margin:0 0 16px;border-radius:12px;background:var(--mint,var(--bg-soft));color:var(--fg);font:14px/1.5 system-ui,sans-serif">오프라인 · 저장된 페이지예요</aside>';
  const html = (await response.text()).replace(/(<main\b[^>]*>)/i, "$1" + banner);
  return new Response(html, { headers });
}

export function createOfflineWorker(platform, config) {
  const { caches, origin } = platform;
  const shellName = "acard-shell-" + config.version;
  const pagesName = "acard-pages-" + config.version;
  const orderName = "acard-lru-" + config.version;
  const orderKey = origin + "/__offline_lru";
  let generation = 0, blocked = false, pending = Promise.resolve();
  // CacheStorage read/modify/write is not atomic. Serialize mutations and fence
  // network responses started before logout/401 so they cannot refill the cache.
  function serial(work) {
    const result = pending.then(work);
    pending = result.catch(error => platform.report(error));
    return result;
  }
  function wipe() {
    generation++;
    blocked = true;
    return serial(async () => {
      for (const name of await caches.keys()) await caches.delete(name);
    });
  }
  async function touch(cache, info) {
    if (!info.slug) return;
    const meta = await caches.open(orderName);
    const stored = await meta.match(orderKey);
    const order = stored ? await stored.json() : [];
    const next = order.filter(slug => slug !== info.slug).concat(info.slug);
    const expired = next.splice(0, Math.max(0, next.length - 50));
    for (const key of await cache.keys()) {
      if (expired.includes(route(key, origin)?.slug)) await cache.delete(key);
    }
    await meta.put(orderKey, new Response(JSON.stringify(next)));
  }
  const tell = message => { try { platform.notify?.(message); } catch (error) { platform.report(error); } };
  // Stale-while-revalidate: a cached page or tree answers at once, the network refresh runs behind it and the
  // page hears "acard-fresh" only when the body actually changed. Logout/401 fences it like the network-first path.
  async function revalidate(request, info, cached, epoch) {
    tell({ type: "acard-sync", on: true, url: request.url });
    try {
      const response = await platform.fetch(request);
      if (response.status === 401) { await wipe(); tell({ type: "acard-auth" }); return; }
      if (!shouldCache(request, response, origin, config.shell)) {
        if (info.kind === "html") tell({ type: "acard-fresh", kind: info.kind, url: request.url });
        return;
      }
      const body = await response.clone().text();
      if (blocked || epoch !== generation) return;
      await serial(async () => {
        if (blocked || epoch !== generation) return;
        const cache = await caches.open(pagesName);
        await cache.put(info.key, response);
        await touch(cache, info);
      });
      if (body !== cached) tell({ type: "acard-fresh", kind: info.kind, url: request.url });
    } catch { /* offline: the cached copy stays */ }
    finally { tell({ type: "acard-sync", on: false, url: request.url }); }
  }
  async function handle(request, waitUntil) {
    const url = new URL(request.url);
    if (url.origin !== origin) return platform.fetch(request);
    if (/^\/api\/auth\//.test(url.pathname) && request.method === "POST") {
      // Sign-in or account switch: nothing cached for the previous account may be shown to the next one.
      const response = await platform.fetch(request);
      if (response.ok || response.status === 303) { await wipe(); blocked = false; }
      return response;
    }
    if (url.pathname === "/__logout") {
      await wipe();
      try { return await platform.fetch(request); } catch { return missing(request); }
    }
    if (url.pathname === "/__gate") {
      const response = await platform.fetch(request);
      if (request.method === "POST" && (response.ok || response.status === 303 || response.type === "opaqueredirect")) blocked = false;
      return response;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      // A write makes cached reader HTML and the tree stale (titles, sidebar); drop them before the next read so a
      // reload after the write never shows the old copy. Page JSON is network-first and keeps its offline copy.
      const response = await platform.fetch(request);
      // Telemetry posts (Cloudflare RUM, beta events) fire on every load and change no content.
      const contentWrite = /^\/(?:api|edit)\//.test(url.pathname) && !/^\/api\/(?:beta|agent)\//.test(url.pathname);
      // A refresh started before this write would put the old tree back (folder fold lost on reload, #14): fence it.
      if (response.ok && contentWrite) generation++;
      if (response.ok && contentWrite && (await caches.has(pagesName))) {
        await serial(async () => {
          const cache = await caches.open(pagesName);
          for (const key of await cache.keys()) if (route(key, origin)?.kind !== "page") await cache.delete(key);
        });
      }
      return response;
    }
    const info = route(request, origin);
    const shell = request.method === "GET" && config.shell.includes(url.pathname + url.search);
    const epoch = generation;
    // Page JSON feeds the editor's base version, so it stays network-first; only reader HTML and the tree are served stale.
    if (info && info.kind !== "page" && waitUntil && !blocked && !url.search && request.method === "GET" && (await caches.has(pagesName))) {
      const hit = await (await caches.open(pagesName)).match(info.key);
      if (hit) {
        const text = await hit.clone().text();
        waitUntil(revalidate(request, info, text, epoch));
        const headers = new Headers(hit.headers);
        headers.set("x-acard-swr", "1");
        return new Response(hit.body, { status: 200, headers });
      }
    }
    let response;
    try { response = await platform.fetch(request); }
    catch {
      if ((!info && !shell) || blocked) return missing(request);
      return serial(async () => {
        if (blocked || epoch !== generation) return missing(request);
        const name = shell ? shellName : pagesName;
        // Do not recreate empty caches after logout.
        if (!(await caches.has(name))) return missing(request);
        const cache = await caches.open(name);
        const cached = await cache.match(info ? info.key : request);
        if (!cached) return missing(request);
        if (info) await touch(cache, info);
        return cachedResponse(cached, info?.kind);
      });
    }
    // Manifest/icon requests may deliberately omit credentials. Their 401 says
    // nothing about the signed-in session; private page/API requests do not.
    if (response.status === 401 && (info || shell || url.pathname.startsWith("/api/") || request.mode === "navigate")) {
      await wipe();
      return response;
    }
    if (!blocked && epoch === generation && shouldCache(request, response, origin, config.shell)) {
      const copy = response.clone();
      await serial(async () => {
        if (blocked || epoch !== generation) return;
        const cache = await caches.open(shell ? shellName : pagesName);
        await cache.put(info ? info.key : request, copy);
        if (info) await touch(cache, info);
      });
    }
    return response;
  }
  return {
    handle, wipe,
    async install() {
      // Fetch all shell assets first; a failed/unauthenticated install is never
      // partially committed. HTML and private API data are not precached.
      const entries = await Promise.all(config.shell.map(async path => {
        const request = new Request(origin + path, { cache: "reload", credentials: "same-origin" });
        const response = await platform.fetch(request);
        if (!shouldCache(request, response, origin, config.shell)) throw new Error("Shell precache failed: " + path);
        return [request, response];
      }));
      await serial(async () => {
        if (blocked) return;
        const cache = await caches.open(shellName);
        for (const [request, response] of entries) await cache.put(request, response);
      });
    },
    async activate() {
      for (const name of await caches.keys()) {
        if (/^acard-(shell|pages|lru)-/.test(name) && ![shellName, pagesName, orderName].includes(name)) await caches.delete(name);
      }
    },
  };
}
