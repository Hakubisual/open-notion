import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// The 템플릿으로 시작 button shows only while a note is empty. These runs drive assets/features/templates.js with a stub
// editor and DOM: the button must come back whenever the user empties the page by typing, on a one-block page and on a
// multi-block page alike, while a page with content leaves it hidden.
type Block = { type: string; text: string };
function harness(blocks: Block[]) {
  const listeners: Record<string, Function[]> = {};
  const textNodes = blocks.map(b => ({ nodeType: 1, textContent: b.text, closest(sel: string) { return sel === ".text" ? this : null; } }));
  const empty: any = { hidden: false };
  const blocksEl: any = { addEventListener(name: string, fn: Function) { (listeners[name] ||= []).push(fn); }, before() {} };
  const observers: Function[] = [];
  class MO { fn: Function; constructor(fn: Function) { this.fn = fn; observers.push(fn); } observe() {} }
  const editor = { state: { kind: "note", blocks }, on(name: string, fn: Function) { if (name === "ready") fn(); }, lazy() { return Promise.resolve({ open() {} }); }, setSave() {} };
  const document: any = {
    createElement() { return { ...empty, className: "", set textContent(v: string) {}, onclick: null, type: "" }; },
    getElementById(id: string) { return id === "blocks" ? blocksEl : { addEventListener() {}, querySelector() { return null; }, hidden: true }; },
    addEventListener() {},
  };
  // createElement returns the one button object so the test can read hidden
  document.createElement = () => empty;
  const window: any = { AcardEditor: editor, location: { search: "" }, URLSearchParams: URLSearchParams, MutationObserver: MO };
  vm.runInNewContext(readFileSync("assets/features/templates.js", "utf8"), { window, document, location: window.location, MutationObserver: MO, URLSearchParams });
  const type = (i: number, text: string) => { blocks[i].text = text; textNodes[i].textContent = text; for (const fn of listeners.input || []) fn({ target: textNodes[i] }); };
  return { empty, type };
}

test("emptying the only paragraph by typing shows the template button again", () => {
  const h = harness([{ type: "paragraph", text: "" }]);
  expect(h.empty.hidden).toBe(false);
  h.type(0, "a"); expect(h.empty.hidden).toBe(true);
  h.type(0, ""); expect(h.empty.hidden).toBe(false);
});

test("emptying the last filled paragraph of a two-paragraph note shows the template button again", () => {
  const h = harness([{ type: "paragraph", text: "" }, { type: "paragraph", text: "" }]);
  expect(h.empty.hidden).toBe(false);
  h.type(1, "a"); expect(h.empty.hidden).toBe(true);
  h.type(1, ""); expect(h.empty.hidden).toBe(false);
});

test("a note that still has text keeps the button hidden after an edit elsewhere", () => {
  const h = harness([{ type: "paragraph", text: "kept" }, { type: "paragraph", text: "" }]);
  expect(h.empty.hidden).toBe(true);
  h.type(1, "b"); h.type(1, ""); expect(h.empty.hidden).toBe(true);
});
