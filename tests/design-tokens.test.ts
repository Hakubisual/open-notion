import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// ds10: colors live in assets/tokens.css. Every other source may only lose hard-coded colors (#hex, rgb()/rgba() with
// numbers), never gain them: a file at or under its count in tests/fixtures/color-ratchet.json passes, a new file must
// have none. Lower the fixture when a file is cleaned up (the test says so).
const SOURCES = ["assets/**/*.css","assets/**/*.js","features/*.js","editor-next/*.css","editor-next/*.js","block-html.js","editor-pages.js","db-html.js","visual-html.js","equation-html.js","component-registry.js","components/*.js"];
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g;
const exempt = (file: string) => file === "assets/tokens.css" || /^assets\/(fonts|_site|img)\//.test(file);

async function counts() {
  const out: Record<string, number> = {};
  for (const pattern of SOURCES) {
    for await (const found of new Bun.Glob(pattern).scan(ROOT)) {
      const file = found.replaceAll("\\", "/");
      if (exempt(file)) continue;
      const n = ((await readFile(join(ROOT, file), "utf8")).match(COLOR) || []).length;
      if (n) out[file] = n;
    }
  }
  return out;
}

test("no source gains hard-coded colors; new UI uses tokens.css variables", async () => {
  const limit = JSON.parse(await readFile(join(ROOT, "tests/fixtures/color-ratchet.json"), "utf8")) as Record<string, number>;
  const grew = Object.entries(await counts()).filter(([file, n]) => n > (limit[file] ?? 0)).map(([file, n]) => file + ": " + n + " colors (allowed " + (limit[file] ?? 0) + ")");
  expect(grew).toEqual([]);
});

test("the ratchet only goes down: a cleaned file lowers its fixture entry", async () => {
  const limit = JSON.parse(await readFile(join(ROOT, "tests/fixtures/color-ratchet.json"), "utf8")) as Record<string, number>;
  const now = await counts();
  const stale = Object.entries(limit).filter(([file, n]) => (now[file] ?? 0) < n).map(([file, n]) => file + ": fixture " + n + ", now " + (now[file] ?? 0) + " - lower tests/fixtures/color-ratchet.json");
  expect(stale).toEqual([]);
});

test("semantic tokens are defined once in tokens.css and every var(--color-*/--control-*/--focus-*) used exists", async () => {
  const tokens = await readFile(join(ROOT, "assets/tokens.css"), "utf8");
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const name of ["--color-text", "--color-surface", "--color-border", "--color-accent", "--color-info-bg", "--color-danger-fg", "--radius-pill", "--shadow-md", "--focus-ring", "--control-h-md"]) expect(defined.has(name)).toBe(true);
  const missing = new Set<string>();
  for (const pattern of SOURCES) for await (const found of new Bun.Glob(pattern).scan(ROOT)) {
    for (const m of (await readFile(join(ROOT, found), "utf8")).matchAll(/var\((--(?:color|control|focus)-[a-z0-9-]+)/g)) if (!defined.has(m[1])) missing.add(m[1]);
  }
  expect([...missing]).toEqual([]);
});
