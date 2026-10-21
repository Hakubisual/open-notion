// A static file whose URL carries this deployment's content hash (?v=<hash>, filled in by build.ts) never changes, so the browser
// may keep it for a year without asking again. Any other ?v= (an old or a future hash, ?v=0, extra params) keeps the Pages default
// revalidation, so a copy fetched mid-deploy can never be pinned under a hash it does not match.
export const IMMUTABLE = "public, max-age=31536000, immutable";

export function cacheVersioned(request: Request, response: Response, versions: Record<string, string> | undefined): Response {
  if (!versions || (request.method !== "GET" && request.method !== "HEAD")) return response;
  if (response.status !== 200 && response.status !== 304) return response;
  const url = new URL(request.url);
  const hash = versions[url.pathname.slice(1)];
  if (!hash || url.search !== "?v=" + hash) return response;
  const out = new Response(response.body, response);
  out.headers.set("cache-control", IMMUTABLE);
  return out;
}

// ?sw=off on any page: a small page of its own (no app scripts, no account data) removes every service worker and cache of this
// site, then opens the page again from the network. Saves waiting in IndexedDB/localStorage are kept.
export function serviceWorkerOff(request: Request): Response | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.searchParams.get("sw") !== "off") return null;
  url.searchParams.delete("sw");
  const next = JSON.stringify(url.pathname + url.search).replace(/</g, "\\u003c");
  const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acard</title><p>저장된 화면을 지우고 다시 여는 중이에요…</p><script>'
    + "var w=navigator.serviceWorker,c=window.caches,j=[w&&w.getRegistrations().then(function(l){return Promise.all(l.map(function(r){return r.unregister()}))}),c&&c.keys().then(function(k){return Promise.all(k.map(function(n){return c.delete(n)}))})];"
    + "Promise.race([Promise.all(j),new Promise(function(r){setTimeout(r,2000)})]).catch(function(){}).then(function(){location.replace(" + next + ")})"
    + "</script></html>";
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}
