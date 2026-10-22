import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../assets/ui/home.js", import.meta.url), "utf8");
const renderSource = source.slice(source.indexOf("  function checklistHtml("), source.indexOf("  async function render("));
const render = (checklist: any, collapsed = "0") => runInNewContext(renderSource + "\nchecklistHtml(checklist)", {
  checklist, icon: () => "", esc: (s: string) => s.replaceAll("&", "&amp;"), href: (s: string) => "/" + encodeURIComponent(s) + "/",
  localStorage: { getItem: () => collapsed },
});

test("home checklist renders four direct targets with actual progress and remembers collapse", () => {
  const html = render({ page: true, agent: false, import: false, share: false, shareSlug: "my page" });
  expect(html.match(/data-step=/g)).toHaveLength(4);
  expect(html).toContain('aria-valuenow="1"');
  expect(html).toContain('style="width:25%"');
  expect(html).toMatch(/href="\/edit\/page-[a-z0-9]+\/\?new&amp;create"/);
  expect(html).toContain('href="/settings/agents/"');
  expect(html).toContain('href="/import"');
  expect(html).toContain('href="/my%20page/?share=1"');
  expect(html).toContain('aria-expanded="true"');
  expect(render({}, "1")).toContain('id="home-checklist-body" hidden');
  expect(render({ page: true, agent: true, import: true, share: true })).toContain('id="home-checklist-body" hidden');
});

test("the checklist share target opens the existing dialog once on arrival", () => {
  const code = readFileSync(new URL("../assets/features/lazy/reader-enhancements.js", import.meta.url), "utf8");
  const start = code.indexOf("  function openSharedPage()");
  const end = code.indexOf("})();", start);
  const location = { href: "https://notes.test/newest/?share=1" };
  const events: Record<string, Function> = {};
  let opened = 0;
  runInNewContext(code.slice(start, end), {
    URL, location, history: { state: {}, replaceState: (_: any, __: string, href: string) => { location.href = href; } },
    document: { getElementById: () => ({ click: () => { opened++; } }), addEventListener: (name: string, fn: Function) => { events[name] = fn; } },
  });
  expect(opened).toBe(1);
  events["acard:page-fresh"]();
  expect(opened).toBe(1);
  expect(location.href).toBe("https://notes.test/newest/");
});
