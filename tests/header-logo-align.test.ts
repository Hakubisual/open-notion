import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Header logo row (#65): the wordmark's painted shape must sit on the centre line of its svg box, which the header
// centres with the menu button (align-items: center). <use href="/wordmark-symbol.svg#w"> draws the symbol from user
// (0,0); a symbol viewBox starting at (x, y) shifts every path by (-x, -y) inside the wrapper, which the old symbol did
// (-15.63 units = 5.1px down at the 36px header height).
const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

function inkY(body: string) {
  let top = Infinity, bottom = -Infinity;
  for (const m of body.matchAll(/<path d="([^"]+)"/g)) {
    expect(m[1]).toMatch(/^[MLQHVZ0-9.\s,-]+$/);
    for (const [, cmd, args] of m[1].matchAll(/([MLQHVZ])([^MLQHVZ]*)/g)) {
      const nums = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
      const ys = cmd === "V" ? nums : cmd === "H" || cmd === "Z" ? [] : nums.filter((_, i) => i % 2 === 1);
      for (const y of ys) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
  }
  return { top, bottom };
}

test("header wordmark is vertically centred in its box (fixes #65)", () => {
  const wrapper = /class=\\?"wordmark\\?" viewBox=\\?"([^"\\]+)\\?"[^>]*><use href=\\?"\/wordmark-symbol\.svg#w/.exec(read("block-html.js"));
  expect(wrapper).not.toBeNull();
  const [, wy, , wh] = wrapper![1].split(" ").map(Number);
  const symbol = read("assets/wordmark-symbol.svg");
  const sv = /<symbol id="w"[^>]*?viewBox="([^"]+)"/.exec(symbol);
  const shiftY = sv ? -Number(sv[1].split(" ")[1]) : 0;
  const { top, bottom } = inkY(symbol);
  const height = Number(/\.brand svg\.wordmark \{[^}]*height: (\d+)px/.exec(read("assets/style.css"))![1]);
  const px = height / wh;
  const inkCentre = ((top + bottom) / 2 + shiftY - wy) * px;
  expect(Math.abs(inkCentre - height / 2)).toBeLessThanOrEqual(1);
});

test("every page that draws the symbol uses the same wrapper box", () => {
  const box = /class=\\?"wordmark\\?" viewBox=\\?"([^"\\]+)/.exec(read("block-html.js"))![1];
  for (const f of ["assets/editor.html", "assets/agents.html", "features/share.js"]) {
    for (const m of read(f).matchAll(/viewBox=\\?"([^"\\]+)\\?"[^>]*><use href=\\?"\/wordmark-symbol\.svg#w/g)) expect(f + " " + m[1]).toBe(f + " " + box);
  }
});
