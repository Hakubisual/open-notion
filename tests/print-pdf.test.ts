import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("the reader more menu offers PDF로 저장 as a menu button", () => {
  const worker = read("gate/_worker.js");
  const start = worker.indexOf("function moreMenu(");
  const html = runInNewContext(worker.slice(start, worker.indexOf("\n}", start) + 2) + "\nmoreMenu('a b', null)", { escapeHtml: (s: string) => s });
  expect(html).toContain('<button type="button" class="menuitem" id="print-pdf">PDF로 저장</button>');
});

test("clicking PDF로 저장 closes the menu and opens the print dialog", () => {
  const code = read("assets/features/lazy/reader-enhancements.js");
  const clicks: Function[] = [];
  let printed = 0;
  const menu = { hidden: false };
  runInNewContext(code, {
    window: { print: () => { printed++; } }, location: { href: "https://notes.test/a/" }, URL, history: {},
    document: {
      getElementById: (id: string) => (id === "more-menu" ? menu : null), querySelector: () => null, querySelectorAll: () => [],
      addEventListener: (name: string, fn: Function) => { if (name === "click") clicks.push(fn); },
    },
  });
  for (const fn of clicks) fn({ target: { closest: (sel: string) => (sel === "#print-pdf" ? {} : null) }, preventDefault: () => {} });
  expect(printed).toBe(1);
  expect(menu.hidden).toBe(true);
});

test("print hides app chrome so only the page head and body remain", () => {
  const css = read("assets/acard-shell.css");
  const rule = css.slice(css.indexOf("@media print"), css.indexOf("\n", css.indexOf("@media print")));
  for (const sel of [".sidebar", ".mbar", ".thumbbar", ".page-actions", ".menu", ".fbt", ".fbp", ".agent-fab", ".reader-toc-toggle", ".foot"]) expect(rule).toContain(sel);
  expect(rule).not.toContain(".page-head");
});
