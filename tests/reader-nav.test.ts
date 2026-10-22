import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");
const navigationCode = readFileSync(new URL("../assets/features/lazy/reader-navigation.js", import.meta.url), "utf8");
const primitiveSource = navigationCode.slice(0, navigationCode.indexOf("// One reader document"));
const navigationSource = navigationCode.slice(navigationCode.indexOf("// One reader document"));
function primitives() {
  const window: any = {};
  runInNewContext(primitiveSource, { window, URL, Map, Set });
  return window.AcardNavigation;
}

test("reader link eligibility excludes document routes, other origins, downloads and modified clicks", () => {
  const { eligible } = primitives(), base = "https://notes.example.com/one/";
  for (const href of ["/two/", "/", "/home/", "/two/?view=board", "/two/#heading"]) expect(eligible(href, base)).toBe(true);
  for (const href of ["/edit/two/", "/p/token/", "/s/token/", "/api/", "/settings/", "/import", "/import/", "/login/", "/__logout/", "https://other.dev/two/", "mailto:a@b.com", "#heading", "/two.js"]) expect(eligible(href, base)).toBe(false);
  for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) expect(eligible("/two/", base, event)).toBe(false);
  expect(eligible("/two/", base, {}, { target: "_blank" })).toBe(false);
  expect(eligible("/two/", base, {}, { download: true })).toBe(false);
});

test("LRU retains at most twenty pages and promotes reads and replacements", () => {
  const cache = primitives().lru(20);
  for (let i = 0; i < 20; i++) cache.set(i, { title: String(i) });
  expect(cache.get(0).title).toBe("0");
  cache.set(20, { title: "20" });
  expect(cache.get(1)).toBeUndefined();
  cache.set(2, { title: "new" }); cache.set(21, {});
  expect(cache.get(3)).toBeUndefined();
  expect(cache.get(2).title).toBe("new");
  cache.clear(); expect(cache.get(0)).toBeUndefined();
});

test("asset diff compares exact versioned URLs and ignores order or duplicate references", () => {
  const { missingAssets } = primitives();
  expect(missingAssets(["/app.js?v=a", "/style.css"], ["/style.css", "/app.js?v=a", "/style.css"])).toEqual([]);
  expect(missingAssets(["/app.js?v=a"], ["/app.js?v=b", "/db.js", "/db.js"])).toEqual(["/app.js?v=b", "/db.js"]);
});

test("identity and auth failure boundary never treats missing identity as the same member", () => {
  const { mustReload, storageKey } = primitives();
  for (const status of [401, 403, 404]) expect(mustReload(status, "a", "a")).toBe(true);
  expect(mustReload(200, "a", "b")).toBe(true);
  expect(mustReload(200, "a", "")).toBe(true);
  expect(mustReload(200, "a", "a")).toBe(false);
  expect(storageKey("recent", "a")).toBe("recent:a");
  expect(storageKey("recent", "b")).not.toBe(storageKey("recent", "a"));
  expect(storageKey("recent", "")).toBeNull();
});

test("folder persistence never reads another identity or writes without an identity", () => {
  const folders = readFileSync(new URL("../assets/features/lazy/folders.js", import.meta.url), "utf8");
  const local = folders.slice(folders.indexOf("  function local("), folders.indexOf("  var due, put"));
  const store = new Map<string, string>();
  const localStorage = { getItem: (key: string) => store.get(key) || null, setItem: (key: string, value: string) => store.set(key, value) };
  const scoped = (identity: string) => runInNewContext(local + "\nlocal;", { identity, localStorage });
  scoped("member-a")("acard-tree-cache", { pages: [{ title: "private A" }] });
  expect(scoped("member-a")("acard-tree-cache").pages[0].title).toBe("private A");
  expect(scoped("member-b")("acard-tree-cache")).toBeNull();
  scoped("")("acard-tree-cache", { pages: [{ title: "anonymous" }] });
  expect([...store.keys()]).toEqual(["acard-tree-cache:member-a"]);
});

test("reading position uses the current identity and does not persist anonymous paths", () => {
  const block = source.match(/\/\/ Reading position \(#40\)[\s\S]*?\n\}\)\(\);/)![0];
  const store: Record<string, string> = {}, scrolls: number[] = [];
  function open(id: string) {
    const listeners: Record<string, Function> = {};
    runInNewContext(block, {
      document: { querySelector: () => id ? { content: id } : null, body: { classList: { contains: () => true } }, referrer: "", addEventListener() {} },
      location: { pathname: "/private/", hash: "", origin: "https://notes.example.com" }, localStorage: store,
      performance: { getEntriesByType: () => [{ type: "navigate" }] }, scrollY: 420,
      scrollTo: ({ top }: any) => scrolls.push(top), addEventListener: (name: string, fn: Function) => { listeners[name] = fn; },
    });
    return listeners;
  }
  open("a").pagehide(); expect(store["acard-pos:a"]).toBe('{"/private/":420}');
  open("b"); expect(scrolls).toEqual([]);
  open("a"); expect(scrolls).toEqual([420]);
  open(""); expect(Object.keys(store)).toEqual(["acard-pos:a"]);
});

function events() {
  const listeners = new Map<string, Function[]>();
  return {
    addEventListener(name: string, fn: Function) { listeners.set(name, [...listeners.get(name) || [], fn]); },
    dispatchEvent(e: any) { for (const fn of listeners.get(e.type) || []) fn(e); },
    fire(type: string, extra: any = {}) { this.dispatchEvent({ type, ...extra }); },
  };
}
class CustomEventMock { constructor(public type: string, public options: any = {}) {} get detail() { return this.options.detail; } }

function navigation(identity = "member-a", loadedAssets: string[] = []) {
  const win = events(), docEvents = events(), location = new URL("https://notes.example.com/one/");
  const assigned: string[] = [], requests: { url: string; options: any }[] = [], pending: { resolve: Function; reject: Function }[] = [];
  const scrolls: number[] = [], initScripts: string[] = [], side = { style: {}, marker: "same sidebar" };
  const scripts: any[] = [];
  const scriptEvents = events();
  const nav = primitives();
  let main: any, focused = 0, selection = false;
  const node = (text: string): any => ({ text, style: {}, dataset: {}, cloneNode: () => node(text), querySelector: () => null, querySelectorAll: () => [], replaceWith(next: any) { main = next; }, focus() { focused++; document.activeElement = this; }, appendChild(el: any) { initScripts.push(el.textContent); } });
  main = node("one");
  function parsed(name: string, id = identity, assetList: string[] = []) {
    return {
      body: { classList: { contains: () => true } }, title: name,
      getElementById: () => node(name),
      querySelector: () => ({ content: id }),
      querySelectorAll: (selector: string) => selector.includes("script[src]") ? assetList.map(url => ({ getAttribute: () => url })) : [],
    };
  }
  const document: any = {
    ...docEvents, body: { classList: { contains: () => true, toggle() {} } }, documentElement: { style: {} }, title: "one", activeElement: null,
    querySelector: (s: string) => s.includes("acard-id") ? { content: identity } : null,
    querySelectorAll: (s: string) => s === "#main,#sidebar" ? [main, side] : s.includes("script[src]") ? loadedAssets.map(url => ({ getAttribute: () => url })) : [],
    getElementById: (id: string) => id === "main" ? main : null,
    createElement: () => ({ remove() {} }),
    head: { appendChild(script: any) { scripts.push(script); loadedAssets.push(script.src); scriptEvents.fire("script", { script }); } },
  };
  const history: any = { state: null, pushes: [], replaceState(state: any) { this.state = state; }, pushState(state: any, _: string, url: string) { this.state = state; this.pushes.push(url); location.href = url; } };
  const window: any = { ...win, AcardNavigation: nav, AcardReader: { slug: "one", on(_: string, fn: Function) { fn(); } }, scrollY: 0, scrollTo({ top }: any) { this.scrollY = top; scrolls.push(top); }, getSelection: () => ({ isCollapsed: !selection }) };
  (location as any).assign = (url: string) => assigned.push(url);
  const docs = new Map<string, any>();
  runInNewContext(navigationSource, {
    window, document, location, history, navigator: { serviceWorker: events() }, URL, Map, Set, Promise, Date, CustomEvent: CustomEventMock,
    DOMParser: class { parseFromString(text: string) { return docs.get(text); } },
    fetch(url: string, options: any) { requests.push({ url, options }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  });
  return {
    window, document, history, location, assigned, requests, pending, scrolls, side, scripts,
    nextScript() { return new Promise<any>(resolve => { scriptEvents.addEventListener("script", (event: any) => resolve(event.script)); }); },
    get main() { return main; }, get focused() { return focused; },
    select(value: boolean) { selection = value; },
    respond(index: number, name: string, options: { status?: number; id?: string; assets?: string[] } = {}) {
      const id = options.id ?? identity, status = options.status ?? 200;
      docs.set(name, parsed(name, id, options.assets));
      pending[index].resolve({ status, ok: status === 200, redirected: false, headers: new Headers({ "x-acard-id": id }), text: async () => name });
    },
  };
}

test("click navigation reuses in-flight prefetch, preserves sidebar, initializes page, title, slug, focus and scroll", async () => {
  const f = navigation();
  f.window.AcardReader.prefetch("/two/");
  const navigating = f.window.AcardReader.navigate("/two/");
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].options.headers["x-acard-nav"]).toBe("1");
  f.respond(0, "two"); await navigating;
  expect(f.main.text).toBe("two"); expect(f.document.title).toBe("two");
  expect(f.window.AcardReader.slug).toBe("two"); expect(f.focused).toBe(1);
  expect(f.scrolls).toEqual([0]); expect(f.side.marker).toBe("same sidebar");
  expect(f.history.pushes).toHaveLength(1);
});

test("prefetch fan-out remains capped at eight and guests never prefetch", () => {
  const f = navigation();
  for (let i = 0; i < 12; i++) f.window.AcardReader.prefetch(`/p${i}/`);
  expect(f.requests).toHaveLength(8);
  const guest = navigation("g-guest"); guest.window.AcardReader.prefetch("/two/"); expect(guest.requests).toHaveLength(0);
});

test("history restores cached content synchronously, restores scroll, then revalidates", async () => {
  const f = navigation();
  const go = f.window.AcardReader.navigate("/two/"); f.respond(0, "two"); await go;
  f.location.href = "https://notes.example.com/one/";
  const back = f.window.AcardReader.navigate(f.location.href, { pop: true, y: 320 });
  expect(f.main.text).toBe("one"); expect(f.scrolls.at(-1)).toBe(320);
  expect(f.requests[1].options.cache).toBe("no-store");
  f.respond(1, "one updated"); await back;
  expect(f.main.text).toBe("one updated"); expect(f.scrolls.at(-1)).toBe(320);
  expect(f.document.activeElement).toBe(f.main);
  expect(f.history.pushes).toHaveLength(1);
});

test("401, 403, 404, identity mismatch and missing assets leave via full navigation and hide private content", async () => {
  for (const options of [{ status: 401 }, { status: 403 }, { status: 404 }, { id: "member-b" }, { assets: ["/new.js"] }]) {
    const f = navigation(), go = f.window.AcardReader.navigate("/two/");
    f.respond(0, "two", options); await go;
    expect(f.assigned).toEqual(["https://notes.example.com/two/"]);
    expect(f.main.text).toBe("one"); expect(f.main.style.visibility).toBe("hidden");
    expect((f.side.style as any).visibility).toBe("hidden");
  }
});

test("first database navigation paints the server page and loads only missing database scripts in order", async () => {
  const f = navigation();
  let mounted!: () => void;
  const ready = new Promise<void>(resolve => { mounted = resolve; });
  const assets = ["/db-model.js?v=a", "/db-views.js?v=b", "/db.js?v=c"];
  let next = f.nextScript();
  const go = f.window.AcardReader.navigate("/database/");
  f.respond(0, "database rows", { assets });
  await go;
  expect(f.main.text).toBe("database rows");
  expect(f.main.style.visibility).toBeUndefined();
  expect(f.assigned).toEqual([]);
  for (const [index, url] of assets.entries()) {
    const script = await next;
    expect(script.src).toBe("https://notes.example.com" + url);
    expect(f.scripts).toHaveLength(index + 1);
    next = f.nextScript();
    if (index === 2) f.window.DoriDB = { mountAll: mounted };
    script.onload();
  }
  await ready;
  expect(f.requests).toHaveLength(1);
  expect(f.assigned).toEqual([]);
  const revisit = f.window.AcardReader.navigate("/another-database/");
  f.respond(1, "other rows", { assets }); await revisit;
  expect(f.main.text).toBe("other rows");
  expect(f.scripts).toHaveLength(3);
});

test("database script upgrades, other origins and load failures retain full-navigation fallback", async () => {
  for (const [loaded, wanted] of [["/db.js?v=old", "/db.js?v=new"], ["", "https://other.dev/db.js"]]) {
    const f = navigation("member-a", loaded ? ["https://notes.example.com" + loaded] : []);
    const go = f.window.AcardReader.navigate("/database/");
    f.respond(0, "database", { assets: [wanted] }); await go;
    expect(f.assigned).toEqual(["https://notes.example.com/database/"]);
    expect(f.scripts).toHaveLength(0);
  }
  const f = navigation();
  const next = f.nextScript();
  let redirected!: () => void;
  const redirect = new Promise<void>(resolve => { redirected = resolve; });
  (f.location as any).assign = (url: string) => { f.assigned.push(url); redirected(); };
  const go = f.window.AcardReader.navigate("/database/");
  f.respond(0, "database", { assets: ["/db.js"] }); await go;
  (await next).onerror(); await redirect;
  expect(f.assigned).toEqual(["https://notes.example.com/database/"]);
});

test("fresh refresh preserves scroll and does not replace a selection", async () => {
  const f = navigation(); f.select(true); await f.window.AcardReader.refresh();
  expect(f.requests).toHaveLength(0);
  f.select(false); f.window.scrollY = 480;
  const refresh = f.window.AcardReader.refresh(); f.respond(0, "new"); await refresh;
  expect(f.main.text).toBe("new"); expect(f.scrolls.at(-1)).toBe(480); expect(f.focused).toBe(0);
});

test("a superseded response cannot replace or redirect the current page", async () => {
  const f = navigation(), first = f.window.AcardReader.navigate("/two/"), second = f.window.AcardReader.navigate("/three/");
  f.respond(1, "three"); await second;
  f.respond(0, "two", { status: 403 }); await first;
  expect(f.main.text).toBe("three"); expect(f.assigned).toEqual([]);
});

test("persisted page is hidden until fresh authorization even with selection and keeps its sidebar", async () => {
  const f = navigation(); f.select(true); f.window.fire("pagehide", { persisted: true });
  expect(f.document.documentElement.style.visibility).toBe("hidden");
  let fresh!: () => void;
  const signal = new Promise<void>(resolve => { fresh = resolve; });
  f.document.addEventListener("acard:page-fresh", fresh);
  f.window.fire("pageshow", { persisted: true }); f.respond(0, "one restored");
  await signal;
  expect(f.main.text).toBe("one restored"); expect(f.side.marker).toBe("same sidebar");
});

test("live lifecycle closes socket/channel/timers on pagehide, resumes exactly once, and tracks new slug", () => {
  const window: any = events(), document: any = { ...events(), hidden: false, querySelector: () => ({ content: "member-a" }) };
  const sockets: any[] = [], channels: any[] = [], intervals = new Set(), timers = new Set();
  class Socket {
    onmessage: any; onclose: any; onerror: any; closed = false; readyState = 1;
    constructor(public url: string) { sockets.push(this); }
    close() { this.closed = true; this.onclose?.(); }
    send() {}
  }
  class Channel { onmessage: any; closed = false; constructor(public name: string) { channels.push(this); } close() { this.closed = true; } postMessage() {} }
  window.WebSocket = Socket; window.BroadcastChannel = Channel;
  runInNewContext(readFileSync(new URL("../assets/features/lazy/live.js", import.meta.url), "utf8"), {
    window, document, location: new URL("https://notes.example.com/one/"), WebSocket: Socket, BroadcastChannel: Channel,
    sessionStorage: { getItem: () => null, setItem() {} }, CustomEvent: CustomEventMock,
    setInterval: (fn: Function) => { intervals.add(fn); return fn; }, clearInterval: (fn: Function) => intervals.delete(fn),
    setTimeout: (fn: Function) => { timers.add(fn); return fn; }, clearTimeout: (fn: Function) => timers.delete(fn),
  });
  expect(sockets).toHaveLength(1); expect(channels[0].name).toBe("acard-live:member-a");
  window.fire("pageshow"); expect(sockets).toHaveLength(1); expect(intervals.size).toBe(1);
  document.fire("acard:navigated", { detail: { slug: "two" } });
  expect(sockets[0].closed).toBe(true); expect(sockets).toHaveLength(2);
  document.fire("acard:navigated", { detail: { slug: "two" } }); expect(sockets).toHaveLength(2);
  window.fire("pagehide", { persisted: true });
  expect(sockets[1].closed).toBe(true); expect(channels[0].closed).toBe(true); expect(intervals.size).toBe(0); expect(timers.size).toBe(0);
  window.fire("online"); expect(sockets).toHaveLength(2);
  window.fire("pageshow", { persisted: true });
  expect(sockets).toHaveLength(3); expect(channels).toHaveLength(2); expect(intervals.size).toBe(1);
});
