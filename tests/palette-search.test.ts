import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/editor.js", import.meta.url), "utf8");
const start = source.indexOf("  var palette = document.getElementById(\"palette\");");
const end = source.indexOf("  if (palette) palette.addEventListener(\"mousedown\"");
const block = source.slice(start, end);

function deferred() {
  let resolve!: (v: any) => void;
  const promise = new Promise<any>((r) => { resolve = r; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function setup() {
  const requests: { q: string; done: ReturnType<typeof deferred> }[] = [];
  const timers: (() => void)[] = [];
  const handlers: Record<string, (ev: any) => void> = {};
  const list: any = { innerHTML: "", ariaBusy: null, addEventListener() {} };
  const input: any = { value: "", focus() {}, addEventListener(name: string, fn: any) { handlers[name] = fn; } };
  const palette: any = { hidden: true, addEventListener() {} };
  const els: Record<string, any> = { palette, "palette-q": input, "palette-list": list };
  const location = { href: "" };
  const document = { getElementById: (id: string) => els[id] || null };
  const localStorage = { getItem: () => JSON.stringify([{ slug: "index", title: "홈" }]) };
  const fetch = (url: string) => {
    const done = deferred();
    requests.push({ q: decodeURIComponent(url.split("q=")[1]), done });
    return done.promise.then((results) => ({ ok: true, json: () => Promise.resolve({ results }) }));
  };
  const setTimeout = (fn: () => void) => { timers.push(fn); return timers.length; };
  const clearTimeout = () => {};
  const run = new Function("document", "net", "location", "localStorage", "setTimeout", "clearTimeout", block + "return { openPalette: openPalette };");
  const api = run(document, fetch, location, localStorage, setTimeout, clearTimeout);
  api.openPalette();
  const type = (q: string) => { input.value = q; handlers.input({}); };
  const key = (k: string) => handlers.keydown({ key: k, preventDefault() {} });
  const fire = () => timers.splice(0).forEach((fn) => fn());
  return { requests, list, location, type, key, fire };
}

test("a late answer for an older query is dropped", async () => {
  const f = setup();
  f.type("바나나"); f.fire();
  f.type("사과"); f.fire();
  f.requests[1].done.resolve([{ slug: "apple", title: "사과" }]);
  await flush();
  f.requests[0].done.resolve([{ slug: "banana", title: "바나나" }]);
  await flush();
  expect(f.list.innerHTML).toContain("/edit/apple/");
  expect(f.list.innerHTML).not.toContain("banana");
});

test("while the newest query is pending the old list is gone and marked busy", async () => {
  const f = setup();
  f.type("바나나"); f.fire();
  f.requests[0].done.resolve([{ slug: "banana", title: "바나나" }]);
  await flush();
  expect(f.list.innerHTML).toContain("banana");
  f.type("사과");
  expect(f.list.innerHTML).not.toContain("banana");
  expect(f.list.ariaBusy).toBe(true);
});

test("Enter while pending opens the newest result once it arrives, never the old one", async () => {
  const f = setup();
  f.type("바나나"); f.fire();
  f.requests[0].done.resolve([{ slug: "banana", title: "바나나" }]);
  await flush();
  f.type("사과");
  f.key("Enter");
  expect(f.location.href).toBe("");
  f.fire();
  f.requests[1].done.resolve([{ slug: "apple", title: "사과" }]);
  await flush();
  expect(f.location.href).toBe("/edit/apple/");
});

test("Escape after a pending Enter cancels the jump", async () => {
  const f = setup();
  f.type("사과");
  f.key("Enter");
  f.fire();
  f.key("Escape");
  f.requests[0].done.resolve([{ slug: "apple", title: "사과" }]);
  await flush();
  expect(f.location.href).toBe("");
});
