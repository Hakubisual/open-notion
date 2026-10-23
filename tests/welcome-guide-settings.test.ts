import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SITE = join(import.meta.dir, "..", "assets", "_site");

test("settings has a start guide section that starts hidden, with restart and hide buttons", () => {
  const html = readFileSync(join(SITE, "settings.html"), "utf8");
  const section = html.match(/<section [^>]*id="guide"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
  expect(section).toMatch(/<section [^>]*id="guide"[^>]*\shidden[\s>]/);
  expect(section).toContain('id="guide-restart"');
  expect(section).toMatch(/id="guide-hide"[^>]*\shidden/);
  expect(section).toContain('role="status"');
  expect(html.indexOf('id="home"')).toBeLessThan(html.indexOf('id="guide"'));
});

test("settings.js posts restart and hide to /api/guide", () => {
  const js = readFileSync(join(SITE, "settings.js"), "utf8");
  expect(js).toMatch(/fetch\("\/api\/guide", \{ method: "POST"/);
  expect(js).toMatch(/postGuide\("restart"\)[^\n]*location\.assign\(/);
  expect(js).toContain('postGuide("hide")');
});
