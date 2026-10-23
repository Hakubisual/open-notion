import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as blocks from "../block-html.js";
import * as model from "../db-model.js";
import { dbBootTag } from "../db-html.js";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const shared = { ...blocks, ...model };
const databaseHtml = new Function(...Object.keys(shared), source("db-html.js").replace(/^export /gm, "") + "\nreturn databaseHtml;")(...Object.values(shared));
const clientModel = source("db-model.js").replace(/^export /gm, "") + "\nwindow.DoriDBModel = {" + Object.keys(model).join(",") + "};";
const client = source("assets/db.js");
const views = source("assets/db-views.js");
const payload = {
  database: { id: "db1", slug: "tasks", title: "Tasks" },
  properties: [
    { id: "t", name: "Title", type: "title", config: {}, ord: 0 },
    { id: "s", name: "Status", type: "status", config: { options: [{ id: "open", name: "Open", color: "blue" }] }, ord: 1 },
    { id: "f", name: "Formula", type: "formula", config: {}, ord: 2 },
    { id: "r", name: "Relation", type: "relation", config: { database: "people" }, ord: 3 },
  ],
  rows: [
    { id: "r1", page: "alpha", pageTitle: "Alpha", props: { s: "open", r: ["person1"] }, computed: { f: 42 } },
    { id: "r2", page: "beta", pageTitle: "Filtered out", props: { s: "open", r: [] }, computed: { f: 0 } },
  ],
  views: ["table", "board"].map((type) => ({ id: type, name: type, type, config: { group_by: type === "board" ? "s" : null, filter: { property: "f", operator: "is", value: "42" }, sorts: [] } })),
  templates: [{ id: "template1", name: "Template" }],
};
const related = { database: { id: "db2", slug: "people", title: "People" }, properties: [], rows: [{ id: "person1", pageTitle: "Related person" }], views: [], templates: [] };
function reader(data = payload) {
  return databaseHtml(data.properties, data.rows.map((r) => ({ ...r, values: { t: r.pageTitle, ...r.props, ...r.computed } })), data.views, { slug: "tasks" }).replace('class="dbbrowser"', 'id="db-root" class="dbbrowser"');
}
let browser: Bun.WebView;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: () => new Response('<!doctype html><html><body class="reader"><main></main></body></html>', { headers: { "content-type": "text/html" } }) });
  browser = new Bun.WebView();
  await browser.navigate(server.url.href);
  await browser.evaluate("(() => {\n" + clientModel + "\n" + views + "\n" + client + "\n})()");
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

async function load(mode: string, view = "table", boot?: string, initial?: unknown) {
  const markup = reader() + (boot ?? (mode === "boot" ? dbBootTag("tasks", payload) : ""));
  return browser.evaluate(`(async () => {
    history.replaceState(null, '', '/tasks/?view=${view}');
    document.querySelector('main').innerHTML = ${JSON.stringify(markup)};
    window.calls = [];
    window.fetch = async (url) => { calls.push(url); return {ok:true,json:async()=>structuredClone(url === '/api/db/people' ? ${JSON.stringify(related)} : ${JSON.stringify(payload)})}; };
    await DoriDB.load('tasks', {initial:${JSON.stringify(initial ?? null)}});
    return { html:document.getElementById('db-root').innerHTML, calls, state:DoriDB.state() };
  })()`) as Promise<{ html: string; calls: string[]; state: { database: typeof payload.database; viewId: string; templates: typeof payload.templates; relationTitles: Record<string, string> } }>;
}

describe("database bootstrap", () => {
  test("first reader navigation shows server rows before database scripts arrive and then hydrates without GET", async () => {
    const requested = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const data = structuredClone(payload);
    data.properties = data.properties.slice(0, 3);
    data.rows = Array.from({ length: 10 }, (_, i) => ({ ...data.rows[0], id: "row" + i, pageTitle: "Row " + i }));
    const page = (body: string, scripts = "") => '<!doctype html><html><head><meta name="acard-id" content="member-a"></head><body class="reader"><main id="main">' + body + '</main>' + scripts + '</body></html>';
    const scripts = '<script src="/db-model.js"></script><script src="/db-views.js"></script><script src="/db.js"></script>';
    const requests: string[] = [];
    const site = Bun.serve({ port: 0, async fetch(req) {
      const path = new URL(req.url).pathname;
      requests.push(path);
      if (path === "/db-model.js") { requested.resolve(); await release.promise; }
      const code = { "/db-model.js": clientModel, "/db-views.js": views, "/db.js": client }[path];
      return new Response(code ? '(function(){\n' + code + '\n})();' : page(path === "/tasks/" ? reader(data) + dbBootTag("tasks", data) : "Source", path === "/tasks/" ? scripts : ""), { headers: { "content-type": code ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "x-acard-id": "member-a" } });
    } });
    const tab = new Bun.WebView();
    try {
      await tab.navigate(site.url.href);
      await tab.evaluate('(()=>{window.errors=[];addEventListener("error",e=>errors.push([e.message,e.filename,e.lineno]));window.AcardReader={on(){}};\n' + source("assets/features/lazy/reader-navigation.js") + '\n})()');
      await tab.evaluate("AcardReader.navigate('/tasks/')");
      await requested.promise;
      expect(await tab.evaluate("({rows:[...document.querySelectorAll('.dbtable tbody tr')].filter(r=>r.getClientRects().length).length,live:!!window.DoriDB,path:location.pathname})")).toEqual({ rows: 10, live: false, path: "/tasks/" });
      await tab.evaluate(`(()=>{window.hydrated=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{observer.disconnect();reject(Error('hydration timeout '+JSON.stringify({errors,scripts:[...document.scripts].map(s=>s.src),db:!!window.DoriDB})));},3000);
        const observer=new MutationObserver(()=>{if(document.querySelector('.dbbody .dbtable')){clearTimeout(timeout);observer.disconnect();resolve(document.querySelectorAll('.dbbody tbody tr').length);}});
        observer.observe(document.getElementById('main'),{childList:true,subtree:true});
      });})()`);
      release.resolve();
      expect(await tab.evaluate("window.hydrated")).toBe(10);
      expect(requests.filter(path => path === "/tasks/")).toHaveLength(1);
      expect(requests.filter(path => path.startsWith("/api/db/"))).toEqual([]);
    } finally { release.resolve(); await tab.close(); site.stop(true); }
  }, 15000);

  test("escapes script terminators, separators, ampersands, and slug attributes without changing JSON", async () => {
    const value = '</script><script>alert(1)</script>&>\u2028\u2029';
    const body = { ...payload, rows: [{ ...payload.rows[0], pageTitle: value }] };
    const html = dbBootTag('tasks" onload="evil', body);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('data-slug="tasks&quot; onload=&quot;evil"');
    for (const escape of ["\\u003c", "\\u003e", "\\u0026", "\\u2028", "\\u2029"]) expect(html).toContain(escape);
    const parsed = await browser.evaluate(`(() => { const t = document.createElement('template'); t.innerHTML=${JSON.stringify(html)}; return {count:t.content.querySelectorAll('script').length, body:JSON.parse(t.content.firstChild.textContent)}; })()`) as { count: number; body: typeof body };
    expect(parsed.count).toBe(1);
    expect(parsed.body).toEqual(body);
  });

  for (const view of ["table", "board"]) test(view + " bootstrap matches network filters, computed values, relations, and view selection", async () => {
    const network = await load("network", view);
    const boot = await load("boot", view);
    expect(network.calls).toEqual(["/api/db/tasks", "/api/db/people"]);
    expect(boot.calls).toEqual(["/api/db/people"]);
    expect(boot.html).toBe(network.html);
    expect(boot.html).toContain("Alpha");
    expect(boot.html).not.toContain("Filtered out");
    expect(boot.html).toContain("42");
    expect(boot.html).toContain("Related person");
    expect(boot.state.viewId).toBe(view);
    expect(boot.state.templates).toEqual(payload.templates);
  });

  test("editor initial data wins over a boot tag and row panels reuse it", async () => {
    const initial = { ...payload, database: { ...payload.database, title: "Initial wins" } };
    const result = await load("boot", "table", undefined, initial);
    expect(result.calls).toEqual(["/api/db/people"]);
    expect(result.state.database.title).toBe("Initial wins");
    const row = await browser.evaluate(`(async()=>{document.querySelector('main').innerHTML='<div id="row-root"></div>';calls=[];await DoriDB.loadRow('tasks','r1','row-root',{initial:${JSON.stringify(payload)}});return {html:document.getElementById('row-root').innerHTML,calls};})()`) as { html: string; calls: string[] };
    expect(row.calls).toEqual(["/api/db/people"]);
    expect(row.html).toContain("Alpha");
    expect(row.html).toContain("42");
    expect(row.html).toContain("Related person");
  });

  test("a host's AcardEditorProvider.fetch carries the database GET; without one the browser fetch does", async () => {
    const routed = await browser.evaluate(`(async () => {
      document.querySelector('main').innerHTML = ${JSON.stringify(reader())};
      window.calls = []; window.routed = [];
      window.fetch = async (url) => { calls.push(url); return {ok:true,json:async()=>structuredClone(${JSON.stringify(payload)})}; };
      window.AcardEditorProvider = { fetch: async (url, options) => { routed.push([url, options.headers['content-type']]); return {ok:true,json:async()=>structuredClone(${JSON.stringify(payload)})}; } };
      try { await DoriDB.load('tasks', {initial:null}); } finally { delete window.AcardEditorProvider; }
      return { calls, routed };
    })()`);
    expect(routed).toEqual({ calls: [], routed: [["/api/db/tasks", "application/json"], ["/api/db/people", "application/json"]] });
    expect((await load("get")).calls).toEqual(["/api/db/tasks", "/api/db/people"]);
  });

  test("absent, malformed, wrong-slug, and incomplete boot payloads fall back to GET", async () => {
    for (const boot of ["", '<script type="application/json" class="acard-db-boot" data-slug="tasks">{</script>', dbBootTag("other", payload), dbBootTag("tasks", {}), dbBootTag("tasks", { ...payload, database: { slug: "other" } })]) {
      const result = await load("network", "table", boot, {});
      expect(result.calls).toEqual(["/api/db/tasks", "/api/db/people"]);
      expect(result.html).toContain("Alpha");
    }
  });

  test("explicit reload ignores bootstrap and replacement reader nodes mount fresh data once", async () => {
    await load("boot");
    expect(await browser.evaluate("(async()=>{calls=[];await DoriDB.reload();return calls})()")).toEqual(["/api/db/tasks", "/api/db/people"]);
    const fresh = { ...payload, rows: [{ ...payload.rows[0], pageTitle: "Fresh replacement" }] };
    const result = await browser.evaluate(`(async()=>{document.querySelector('main').innerHTML=${JSON.stringify(reader(fresh) + dbBootTag("tasks", fresh) + dbBootTag("people", related))};calls=[];await DoriDB.mountAll();await DoriDB.mountAll();return {calls,html:document.querySelector('main').innerHTML};})()`) as { html: string; calls: string[] };
    expect(result.calls).toEqual([]);
    expect(result.html).toContain("Fresh replacement");
    expect(result.html).toContain('class="relchip">Related person');
  });

  test("self relations reuse the initial rows instead of duplicating the database GET", async () => {
    const initial = structuredClone(payload);
    initial.properties[3].config.database = "db1";
    initial.rows[0].props.r = ["r1"];
    const result = await load("network", "table", "", initial);
    expect(result.calls).toEqual([]);
    expect(result.state.relationTitles.r1).toBe("Alpha");
  });

  test("a hydrated reader history snapshot can remount its database without another GET", async () => {
    await load("boot");
    const result = await browser.evaluate(`(async()=>{
      const main=document.querySelector('main'), copy=main.cloneNode(true);
      copy.querySelectorAll('[data-live]').forEach(node=>node.removeAttribute('data-live'));
      main.replaceWith(copy);calls=[];await DoriDB.mountAll();
      return {calls,html:copy.innerHTML,templates:copy.querySelectorAll('.db-reader-assets').length};
    })()`) as { calls: string[]; html: string; templates: number };
    expect(result.calls).toEqual(["/api/db/people"]);
    expect(result.html).toContain("Alpha");
    expect(result.html).toContain("Related person");
    expect(result.templates).toBe(1);
  });

  test("hydration keeps thumbnail hints for table, board, and gallery and only one eager image", async () => {
    const data = structuredClone(payload) as any;
    data.properties.push({ id: "files", name: "Images", type: "files", config: {}, ord: 4 });
    data.rows[0].props.files = [{ url: "/media/thumb", type: "image/png", iw: 800, ih: 400 }];
    for (const type of ["table", "board", "gallery"]) {
      data.views = [{ id: type, type, name: type, config: { group_by: "s", filter: { property: "f", operator: "is", value: "42" } } }];
      const markup = '<div class="blocks">' + blocks.renderBlocks([{ type: "image", text: "First", meta: { src: "/media/first", iw: 800, ih: 400 } }]) + '</div>' + reader(data) + dbBootTag("tasks", data);
      const attrs = await browser.evaluate(`(async()=>{document.querySelector('main').innerHTML=${JSON.stringify(markup)};await DoriDB.load('tasks');return [...document.querySelectorAll('main img[src^="/media/"]')].map(i=>({width:i.getAttribute('width'),height:i.getAttribute('height'),decoding:i.decoding,loading:i.loading,priority:i.getAttribute('fetchpriority'),srcset:i.srcset,sizes:i.sizes}));})()`) as Record<string, string | null>[];
      expect(attrs).toHaveLength(2);
      expect(attrs[0].loading).toBe("eager");
      expect(attrs[0].priority).toBe("high");
      expect(attrs[1]).toEqual({ width: "800", height: "400", decoding: "async", loading: "lazy", priority: null, srcset: "/media/thumb?w=400 400w, /media/thumb?w=800 800w, /media/thumb?w=1600 1600w", sizes: "(max-width: 760px) 100vw, 760px" });
    }
  });

  test("intrinsic image geometry is reserved before bytes arrive at desktop and mobile widths", async () => {
    const css = ["assets/tokens.css", "assets/style.css", "assets/acard-page.css"].map(source).join("\n").replace(/@import[^;]+;/g, "");
    for (const width of [1440, 390]) {
      const requested = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const media = Bun.serve({ port: 0, async fetch() {
        requested.resolve();
        await release.promise;
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="blue"/></svg>', { headers: { "content-type": "image/svg+xml" } });
      } });
      try {
        await browser.cdp("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
        const markup = '<style>' + css + '</style><div class="blocks">' + blocks.renderBlocks([{ type: "image", text: "Reserved", meta: { src: media.url.href, iw: 800, ih: 400 } }]) + '</div>';
        const before = await browser.evaluate(`(()=>{document.querySelector('main').innerHTML=${JSON.stringify(markup)};const r=document.querySelector('figure img').getBoundingClientRect();return {width:r.width,height:r.height,caption:document.querySelector('figcaption').getBoundingClientRect().top};})()`) as { width: number; height: number; caption: number };
        await requested.promise;
        release.resolve();
        const after = await browser.evaluate("(async()=>{await document.querySelector('figure img').decode();const r=document.querySelector('figure img').getBoundingClientRect();return {width:r.width,height:r.height,caption:document.querySelector('figcaption').getBoundingClientRect().top};})()");
        expect(before.width).toBeGreaterThan(0);
        expect(Math.abs((before.width - 2) / (before.height - 2) - 2)).toBeLessThan(0.01);
        expect(after).toEqual(before);
      } finally { release.resolve(); media.stop(true); }
    }
  });

  test("configured board and gallery previews keep geometry through bootstrap hydration", async () => {
    const data = structuredClone(payload) as any;
    data.properties.push({ id: "files", name: "Images", type: "files", config: {}, ord: 4 });
    data.rows = [data.rows[0]];
    data.rows[0].props.files = [{ url: "/media/property", type: "image/png", iw: 800, ih: 400 }];
    data.rows[0].firstImage = "/media/body";
    data.rows[0].firstImageMeta = { src: "/media/body", iw: 800, ih: 400 };
    data.rows[0].cover = "/media/cover";
    data.rows[0].pageIcon = "P";
    for (const type of ["board", "gallery"]) for (const preview of ["property", "page_content", "page_cover", "none"]) {
      data.views = [{ id: type, type, name: type, config: { group_by: "s", card: { preview, property: "files", size: "l", fit: "contain", icon: true } } }];
      const markup = reader(data) + dbBootTag("tasks", data);
      const result = await browser.evaluate(`(async()=>{document.querySelector('main').innerHTML=${JSON.stringify(markup)};await DoriDB.load('tasks');const img=document.querySelector('.dbv-cover');return {calls,icon:!!document.querySelector('.dbv-card-icon'),image:img?{src:img.getAttribute('src'),width:img.getAttribute('width'),height:img.getAttribute('height'),srcset:img.srcset,decoding:img.decoding}:null};})()`) as any;
      expect(result.icon).toBe(true);
      if (preview === "none") expect(result.image).toBeNull();
      else {
        const src = "/media/" + ({ property: "property", page_content: "body", page_cover: "cover" }[preview]);
        expect(result.image.src).toBe(src);
        expect(result.image.srcset).toContain(src + "?w=800 800w");
        expect(result.image.decoding).toBe("async");
        expect(result.image.width).toBe(preview === "page_cover" ? null : "800");
        expect(result.image.height).toBe(preview === "page_cover" ? null : "400");
        expect(markup).toContain('decoding="async"');
        expect(markup).toContain(src + '?w=800 800w');
      }
    }
  });
});
