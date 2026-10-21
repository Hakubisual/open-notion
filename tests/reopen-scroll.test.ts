import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");
const block = /\/\/ Reading position \(#40\)[\s\S]*?\n\}\)\(\);/.exec(source)?.[0] ?? "";

type Opts = { path?: string; hash?: string; type?: string; referrer?: string; reader?: boolean; store?: Record<string, string> };
function open(o: Opts = {}) {
  const store = o.store ?? {};
  const win: Record<string, ((ev?: unknown) => void)[]> = {};
  const doc: Record<string, ((ev?: unknown) => void)[]> = {};
  const scrolls: number[] = [];
  const env = {
    localStorage: new Proxy(store, { set: (t, k: string, v) => { t[k] = String(v); return true; } }),
    location: { pathname: o.path ?? "/long/", hash: o.hash ?? "", origin: "https://notes.example.com" },
    performance: { getEntriesByType: () => [{ type: o.type ?? "navigate" }] },
    document: {
      querySelector: () => ({ content: "reader-test" }),
      referrer: o.referrer ?? "", hidden: false,
      body: { classList: { contains: (c: string) => c === "reader" && o.reader !== false } },
      addEventListener: (n: string, f: () => void) => { (doc[n] ??= []).push(f); },
    },
    scrollY: 0,
    scrollTo: (o: { top: number; behavior: string }) => { expect(o.behavior).toBe("instant"); scrolls.push(o.top); env.scrollY = o.top; },
    addEventListener: (n: string, f: () => void) => { (win[n] ??= []).push(f); },
  };
  new Function("env", "with (env) {" + block + "}")(env);
  return {
    store, scrolls,
    scroll(y: number) { env.scrollY = y; },
    close() { (win.pagehide ?? []).forEach((f) => f()); },
    hide() { env.document.hidden = true; (doc.visibilitychange ?? []).forEach((f) => f()); },
  };
}

test("a reader page closed and opened again comes back where it was left (#40)", () => {
  expect(block).not.toBe("");
  const first = open();
  first.scroll(3069);
  first.close();
  const again = open({ store: first.store });
  expect(again.scrolls).toEqual([3069]);
});

test("switching away saves too, so a window killed in the background still comes back", () => {
  const first = open();
  first.scroll(1200);
  first.hide();
  expect(open({ store: first.store }).scrolls).toEqual([1200]);
});

test("each page keeps its own position and a page read to the top forgets it", () => {
  const a = open({ path: "/a/" }); a.scroll(500); a.close();
  const b = open({ path: "/b/", store: a.store }); b.scroll(900); b.close();
  expect(open({ path: "/a/", store: b.store }).scrolls).toEqual([500]);
  const top = open({ path: "/b/", store: b.store }); top.scroll(0); top.close();
  expect(open({ path: "/b/", store: top.store }).scrolls).toEqual([]);
});

test("links inside Acard, #anchors, reload, back/forward and the editor keep their own position", () => {
  const first = open(); first.scroll(800); first.close();
  const s = first.store;
  expect(open({ store: s, referrer: "https://notes.example.com/other/" }).scrolls).toEqual([]);
  expect(open({ store: s, hash: "#block-h3" }).scrolls).toEqual([]);
  expect(open({ store: s, type: "reload" }).scrolls).toEqual([]);
  expect(open({ store: s, type: "back_forward" }).scrolls).toEqual([]);
  expect(open({ store: s, reader: false }).scrolls).toEqual([]);
  expect(open({ store: s, referrer: "https://discord.com/" }).scrolls).toEqual([800]);
});

test("only the last 50 pages are kept and a broken entry is ignored", () => {
  let store: Record<string, string> = { "acard-pos:reader-test": "{not json" };
  expect(open({ store }).scrolls).toEqual([]);
  for (let i = 0; i < 55; i++) { const p = open({ path: `/p${i}/`, store }); p.scroll(100 + i); p.close(); store = p.store; }
  const kept = JSON.parse(store["acard-pos:reader-test"]);
  expect(Object.keys(kept)).toHaveLength(50);
  expect(kept["/p0/"]).toBeUndefined();
  expect(kept["/p54/"]).toBe(154);
});
