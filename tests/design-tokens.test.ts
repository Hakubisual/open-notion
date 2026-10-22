import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// ds10: colors live in assets/tokens.css. Every other source may only lose hard-coded colors (#hex, rgb()/rgba() with
// numbers), never gain them: a file at or under its count in tests/fixtures/color-ratchet.json passes, a new file must
// have none. Lower the fixture when a file is cleaned up (the test says so).
const SOURCES = ["assets/**/*.css","assets/**/*.js","features/*.js","editor-next/*.css","editor-next/*.js","block-html.js","editor-pages.js","db-html.js","visual-html.js","equation-html.js","component-registry.js","components/*.js"];
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g;
// tokens-report.css is the token file of the research report page style, loaded only on those pages (first-screen budget).
const exempt = (file: string) => file === "assets/tokens.css" || file === "assets/tokens-report.css" || /^assets\/(fonts|_site|img)\//.test(file);

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

// Same ratchet for shape: a border radius written in raw px (use --radius-*) and a box-shadow that is not none or a
// --shadow-*/var() list (elevation literals belong in tokens.css). Counts live in tests/fixtures/shape-ratchet.json.
const RADIUS_PX = /border(?:-[a-z]+)*-radius\s*:\s*[^;}"'`]*\d+px/g;
const SHADOW = /box-shadow\s*:\s*([^;}"'`]*)/g;
const shadowLiteral = (value: string) => !/^\s*(none|inherit|initial|unset|var\(--[a-z0-9-]+\)(\s*,\s*var\(--[a-z0-9-]+\))*)\s*(!important)?\s*$/.test(value);

async function shapeCounts() {
  const out: { radius: Record<string, number>; shadow: Record<string, number> } = { radius: {}, shadow: {} };
  for (const pattern of SOURCES) {
    for await (const found of new Bun.Glob(pattern).scan(ROOT)) {
      const file = found.replaceAll("\\", "/");
      if (exempt(file)) continue;
      const text = await readFile(join(ROOT, file), "utf8");
      const radius = (text.match(RADIUS_PX) || []).length;
      const shadow = [...text.matchAll(SHADOW)].filter((m) => shadowLiteral(m[1])).length;
      if (radius) out.radius[file] = radius;
      if (shadow) out.shadow[file] = shadow;
    }
  }
  return out;
}

test("no source gains raw px radii or box-shadow literals, and a cleaned file lowers tests/fixtures/shape-ratchet.json", async () => {
  const limit = JSON.parse(await readFile(join(ROOT, "tests/fixtures/shape-ratchet.json"), "utf8")) as Record<"radius" | "shadow", Record<string, number>>;
  const now = await shapeCounts();
  const report: string[] = [];
  for (const kind of ["radius", "shadow"] as const) {
    for (const [file, n] of Object.entries(now[kind])) if (n > (limit[kind][file] ?? 0)) report.push(kind + " " + file + ": " + n + " (allowed " + (limit[kind][file] ?? 0) + ")");
    for (const [file, n] of Object.entries(limit[kind])) if ((now[kind][file] ?? 0) < n) report.push(kind + " " + file + ": fixture " + n + ", now " + (now[kind][file] ?? 0) + " - lower tests/fixtures/shape-ratchet.json");
  }
  expect(report).toEqual([]);
});

test("the shape lint catches what it should and passes tokens", () => {
  expect("a{border-radius:12px}b{border-top-left-radius: 0 6px}c{border-radius:var(--radius-md)}d{border-radius:50%}".match(RADIUS_PX)?.length).toBe(2);
  expect(["0 2px 8px rgba(0,0,0,.1)", "inset 0 -2px var(--accent)", "var(--shadow-md), 0 0 0 1px var(--line)"].every(shadowLiteral)).toBe(true);
  expect(["none", "var(--shadow-menu)", "var(--shadow-sm), var(--focus-ring)", "none !important"].some(shadowLiteral)).toBe(false);
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
