import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { thumbBarHtml, pageActionsHtml } from "../block-html.js";

test("mobile bar creates a fresh page in one tap and keeps editing in the header", () => {
  for (const slug of ["index", "my-note"]) {
    const html = thumbBarHtml(slug);
    expect(html).toContain("data-new-page");
    expect(html.match(/<(a|button)\b/g)).toHaveLength(4);
    expect(html).not.toContain('/edit/' + slug);
  }
  const source = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");
  const start = source.indexOf("  var thumbNew =");
  const code = source.slice(start, source.indexOf("  function mountPageActions()", start));
  const location = { href: "" };
  let click: Function = () => {};
  let random = 0.123456789;
  runInNewContext(code, { location, Math: { random: () => (random += 0.1) }, document: { querySelector: () => ({ addEventListener: (_: string, fn: Function) => { click = fn; } }) } });
  click();
  expect(location.href).toMatch(/^\/edit\/page-[a-z0-9]{6}\/\?new&create$/);
  const first = location.href;
  click();
  expect(location.href).not.toBe(first);
  expect(pageActionsHtml("my-note")).toContain('/edit/my-note/');
});
