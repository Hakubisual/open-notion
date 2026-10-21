// #45: the sidebar menu stays when a tree read or a fold save fails (database busy, #44) and keeps its fold state and
// scroll across page moves and reloads. Runs the shipped lazy/folders.js in headless Chrome on a local origin (so
// localStorage is real); the stubbed /api answers or fails per load.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const css = ["assets/tokens.css", "assets/style.css", "assets/features/lazy/folders.css"].map((f) => { try { return read(f); } catch { return ""; } }).join("\n");
const script = read("assets/features/lazy/folders.js");
const page = (p: string, parent: string | null, ord: number) => ({ slug: p, title: "페이지 " + p, parent, ord, kind: "note", tags: [] });
const PAGES = [page("a", null, 10), page("b", null, 20), page("b1", "b", 10), ...Array.from({ length: 40 }, (_, i) => page("z" + i, null, 100 + i))];

// tree=ok|fail and prefs=ok|fail come from the address of each load; the stub server keeps the last saved prefs.
let serverPrefs: any = { open: ["b"], collapsed: [], closed: [], v: 1 };
let savedOnServer = () => {};
const html = (q: URLSearchParams) => `<!doctype html><html><head><meta name="acard-id" content="sidebar-test"><meta charset="utf-8"><style>${css} body{margin:0} #sidebar{width:260px;height:400px;overflow:auto}</style></head>
<body class="reader"><aside id="sidebar" class="sidebar"><div class="side-ws"><a class="server-row" href="/x/">서버 목록</a></div></aside><main></main>
<script>window.__puts = 0; var real = window.fetch; window.fetch = function (url, opt) {
  url = String(url); opt = opt || {};
  if (url.indexOf("/api/folders/tree") === 0 && ${JSON.stringify(q.get("tree"))} === "fail") return Promise.resolve(new Response('{"error":"(EMAXCONNSESSION) max clients reached"}', { status: 500, headers: { "content-type": "application/json" } }));
  if (url.indexOf("/api/folders/prefs") === 0) { window.__puts++; document.dispatchEvent(new Event("fixture:put")); if (${JSON.stringify(q.get("prefs"))} === "fail") return Promise.resolve(new Response('{"error":"busy"}', { status: 500 })); }
  return real(url, opt);
};</script><script>${script}</script></body></html>`;

let server: ReturnType<typeof Bun.serve>;
let view: Bun.WebView;
const js = (expr: string) => view.evaluate(expr);
const until = (expr: string) => js(`new Promise((resolve, reject) => {
  const done = () => { if (${expr}) { observer.disconnect(); clearTimeout(timer); resolve(true); } };
  const observer = new MutationObserver(done);
  const timer = setTimeout(() => { observer.disconnect(); reject(Error("sidebar state not reached")); }, 5000);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  done();
})`);
const rows = () => js(`[...document.querySelectorAll('.fd-row')].map(r => r.dataset.slug).slice(0, 4).join(',')`);
const isOpen = (slug: string) => js(`!!document.querySelector('.fd-row[data-slug="${slug}"].open')`);

async function open(path: string, query: string) {
  await view.navigate(server.url.origin + path + "?" + query);
}

beforeAll(async () => {
  server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/folders/tree") return Response.json({ pages: PAGES, tags: [], prefs: serverPrefs });
    if (url.pathname === "/api/folders/prefs") { const body = await req.json(); if ((serverPrefs.v || 0) <= (body.v || 0)) serverPrefs = body; savedOnServer(); return Response.json({ ok: true }); }
    if (url.pathname.startsWith("/api/")) return Response.json({});
    return new Response(html(url.searchParams), { headers: { "content-type": "text/html; charset=utf-8" } });
  } });
  view = new Bun.WebView({ width: 1440, height: 844 });
}, 30000);
afterAll(async () => { await view?.close(); server?.stop(true); });

test("a failed tree read keeps the last menu, and a fold whose save failed stays folded after moving and reloading", async () => {
  await open("/b1/", "tree=ok&prefs=ok");
  expect(await until(`!!document.querySelector('.fd-row[data-slug="b1"]')`)).toBe(true);
  expect(await isOpen("b")).toBe(true);

  // Fold b while the database is busy: the save is refused.
  await open("/a/", "tree=ok&prefs=fail");
  expect(await until(`!!document.querySelector('.fd-row[data-slug="b"].open')`)).toBe(true);
  await js(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("fold save not sent")), 5000);
    document.addEventListener("fixture:put", () => { clearTimeout(timer); resolve(true); }, { once: true });
    document.querySelector('.fd-row[data-slug="b"] .fd-tw').click();
  })`);
  expect(await isOpen("b")).toBe(false);
  expect(await js(`window.__puts > 0`)).toBe(true);
  await js(`document.getElementById('sidebar').scrollTop = 200`);

  // Next page while the tree read fails: the menu is still the page tree, with b folded.
  await open("/a/", "tree=fail&prefs=fail");
  expect(await until(`!!document.querySelector('.fd-row[data-slug="a"]')`)).toBe(true);
  expect(await rows()).toBe("a,b,z0,z1");
  expect(await js(`!!document.querySelector('.server-row') && !!document.querySelector('.server-row').offsetParent`)).toBe(false);
  expect(await isOpen("b")).toBe(false);
  expect(await js(`document.getElementById('sidebar').scrollTop`)).toBe(200);

  // Reload with everything answering again: the server still has the old fold (its save failed), the newer local one wins
  // and is saved again.
  let timeout: ReturnType<typeof setTimeout>;
  const saved = new Promise<void>((done, reject) => { timeout = setTimeout(() => reject(Error("fold not persisted")), 5000); savedOnServer = () => { clearTimeout(timeout); done(); }; });
  await open("/a/", "tree=ok&prefs=ok");
  await saved;
  expect(serverPrefs.closed).toContain("b");
  expect(await isOpen("b")).toBe(false);
}, 60000);
