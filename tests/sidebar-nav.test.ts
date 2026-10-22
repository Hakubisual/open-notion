// Issue 101: sidebar quick nav (ref-1) and header actions. The nav reuses the existing data-act handlers, keeps every id the
// app script and QA scripts look up, and the selected/hit-area rules come from tokens.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pageActionsHtml, sideNavHtml } from "../block-html.js";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const PAGES = [{ slug: "a", title: "A" }, { slug: "b", title: "B", parent: "a" }];

test("quick nav lists home and the four sidebar actions under the search field", () => {
  const html = sideNavHtml(PAGES, "b", "Acard");
  const nav = /<div class="side-nav">([\s\S]*?)<\/div>/.exec(html)![1];
  expect([...nav.matchAll(/data-act="(\w+)"/g)].map((m) => m[1])).toEqual(["all", "recent", "favorites", "trash"]);
  expect(nav).toContain('<a href="/">');
  expect(html.indexOf('id="palette-open"')).toBeLessThan(html.indexOf('class="side-nav"'));
  expect(html.indexOf('class="side-nav"')).toBeLessThan(html.indexOf('class="side-ws"'));
  const app = read("assets/app.js");
  for (const act of ["all", "recent", "favorites", "trash"]) expect(app).toContain('act === "' + act + '"');
});

test("home is marked current only on the home page", () => {
  expect(sideNavHtml(PAGES, "index", "Acard")).toContain('<a href="/" class="on" aria-current="page">');
  expect(sideNavHtml(PAGES, "b", "Acard")).not.toContain('<a href="/" class="on"');
  expect(sideNavHtml(PAGES, "b", "Acard")).toContain('href="/b/" class="on" aria-current="page"');
});

test("existing sidebar ids, menu items and aria stay in place", () => {
  const html = sideNavHtml(PAGES, "a", "Acard");
  for (const id of ["side-more", "side-menu", "collapse", "palette-open", "side-tree"]) expect(html).toContain('id="' + id + '"');
  const menu = /<ul class="side-menu"[\s\S]*?<\/ul>/.exec(html)![0];
  expect([...menu.matchAll(/data-act="(\w+)"/g)].map((m) => m[1])).toEqual(["all", "recent", "trash", "suggest"]);
  expect(html).toContain('aria-controls="side-menu"');
  expect(html).toContain('data-act="new"');
});

test("header actions keep their ids and share one 36px control height", () => {
  const html = pageActionsHtml("x", "");
  for (const id of ["share", "fav", "editlink"]) expect(html).toContain('id="' + id + '"');
  const shell = read("assets/acard-shell.css");
  expect(shell).toMatch(/\.reader \.page-actions :is\(\.icon, \.pa-share\) \{[^}]*height: var\(--control-h-md\)/);
  expect(shell).toMatch(/\.reader \.page-actions \.icon \{[^}]*width: var\(--control-h-md\)/);
});

test("nav rows, tree selection and foot buttons use token sizes and the accent pill", () => {
  const shell = read("assets/acard-shell.css");
  expect(shell).toMatch(/\.side-nav :is\(a, button\), \.side-root > \.row > a, \.side-new \{[^}]*height: var\(--control-h-md\)/);
  expect(shell).toMatch(/\.side-nav a\.on, \.reader \.tree a\.on \{[^}]*background: var\(--color-accent-soft\)/);
  expect(shell).toMatch(/\.side-foot \.icon \{[^}]*height: var\(--control-h-md\)/);
  const folders = read("assets/features/lazy/folders.css");
  expect(folders).toMatch(/\.fd-row\.on \{[^}]*background: var\(--color-accent-soft\)/);
});
