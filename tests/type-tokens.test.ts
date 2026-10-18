import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Landing and auth pages (assets/_site) migrate after acard-beta-launch; every other surface uses var(--fs-*).
const TOKEN_FILES = new Set(["assets/tokens.css", "assets/_site/type.css"]);
const RAW = /font-size\s*:\s*(?:clamp\([^)]*?)?[0-9.]+px|font\s*:\s*(?:(?:italic|normal|bold|[1-9]00)\s+)*[0-9.]+px/g;
const SOURCES = ["assets/**/*.css", "assets/**/*.js", "assets/**/*.html", "features/*.js", "editor-next/*.css", "editor-next/*.js", "block-html.js", "editor-pages.js", "db-html.js", "visual-html.js", "equation-html.js", "gate/_worker.js"];

test("font sizes come from the type scale tokens, not raw px", async () => {
  const offenders: string[] = [];
  for (const pattern of SOURCES) {
    for await (const found of new Bun.Glob(pattern).scan(ROOT)) {
      const file = found.replaceAll("\\", "/");
      if (TOKEN_FILES.has(file) || file.startsWith("assets/fonts/")) continue;
      for (const match of (await readFile(join(ROOT, file), "utf8")).matchAll(RAW)) offenders.push(file + ": " + match[0]);
    }
  }
  expect(offenders).toEqual([]);
});

test("every --fs token used is defined in tokens.css", async () => {
  const tokens = await readFile(join(ROOT, "assets/tokens.css"), "utf8");
  const defined = new Set([...tokens.matchAll(/(--fs-[0-9]+)\s*:/g)].map((m) => m[1]));
  const missing = new Set<string>();
  for (const pattern of SOURCES) {
    for await (const found of new Bun.Glob(pattern).scan(ROOT)) {
      for (const m of (await readFile(join(ROOT, found), "utf8")).matchAll(/var\((--fs-[0-9]+)/g)) if (!defined.has(m[1])) missing.add(m[1]);
    }
  }
  expect([...missing]).toEqual([]);
});
