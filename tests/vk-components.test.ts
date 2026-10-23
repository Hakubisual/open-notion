import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { listComponents, renderComponentBlock, componentCss, familyCss, getComponent, UI_PRESETS } from "../component-registry.js";
import "../components/index.js";

// Visual kit: every component outside the ds10 basic family gets the same checks, so a family file added later is
// covered by registering its components (design/visual-kit/SPEC.md).
const ROOT = join(import.meta.dir, "..");
const KIT = listComponents().filter((c) => c.family !== "basic");
const render = (id: string, text: string) => renderComponentBlock({ type: "component", text, meta: { ui: id } });
const EVIL = '<script>alert(1)</script>"><img src=x onerror=alert(1)>';
const poison = (v: any): any => typeof v === "string" ? EVIL + v : Array.isArray(v) ? v.map(poison) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, poison(x)])) : v;

test("the visual kit registers components outside the basic family", () => {
  expect(KIT.length).toBeGreaterThanOrEqual(5);
});

describe.each(KIT.map((c) => [c.id, c] as const))("%s", (id, c) => {
  test("has a family file, schema, Korean sample, slash entry, description and all four presets", () => {
    expect(c.schema && typeof c.schema).toBe("object");
    expect(c.slash.label).toMatch(/[가-힣]/);
    expect(c.slash.aliases).toMatch(/[a-z]/);
    expect(c.description.length).toBeGreaterThan(30);
    expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
    expect(Object.keys(c.presets).sort()).toEqual([...UI_PRESETS].sort());
  });

  test("the sample renders without fallback, and every preset renders", () => {
    const html = render(id, JSON.stringify(c.sample));
    expect(html).toContain('data-ui="' + id + '"');
    expect(html).not.toContain("ui-fallback");
    expect(html).not.toContain("data-ui-invalid");
    for (const p of UI_PRESETS) expect(render(id, JSON.stringify({ ...c.sample, preset: p }))).toContain('data-preset="' + p + '"');
  });

  test("empty, {} , wrong types and malformed JSON never throw or fall back", () => {
    for (const text of ["", "{}", "{ nope", "[1,2]", '{"labels":"x","series":5,"items":{"a":1},"values":"1,2","title":7}']) {
      const html = render(id, text);
      expect(html).toContain('data-ui="' + id + '"');
      expect(html).not.toContain('class="ui-fallback"');
    }
  });

  test("text from data never becomes markup", () => {
    const html = render(id, JSON.stringify(poison(c.sample)));
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).not.toMatch(/<[a-z]+(\s+[a-z:-]+(="[^"]*")?)*\s+on[a-z]+=/i);
  });

  test("charts and diagrams are labelled for screen readers", () => {
    const html = render(id, JSON.stringify(c.sample));
    if (c.family === "chart" || c.family === "diagram") expect(html).toMatch(/role="img"[^>]*aria-label(ledby)?="[^"]+"/);
  });

  test("css uses tokens only and stays inside its own selectors", () => {
    const css = (c.css || "") + familyCss(c.family);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|border-radius:\s*\d+px|font-size:\s*[0-9.]+px/);
    for (const rule of css.replace(/@property\s+--[a-z0-9-]+\s*\{[^}]*\}/g, "").replace(/@[a-z-]+[^{]*\{/g, "").split("}")) {
      const sel = rule.split("{")[0].trim();
      if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
      for (const part of sel.split(",")) expect(part.trim()).toMatch(/(\.ui|\.vk|\[data-preset|\.rp |\.col)/);
    }
  });
});

test("every visual-kit component lives in a components/<family>-*.js file the build can split into its chunk", () => {
  const prefix: Record<string, string> = { chart: "chart", diagram: "diagram", interactive: "ix", block: "block", asset: "asset" };
  const files = readdirSync(join(ROOT, "components"));
  for (const c of KIT) {
    const owner = files.filter((f) => f.endsWith(".js")).find((f) => readFileSync(join(ROOT, "components", f), "utf8").includes('id: "' + c.id + '"'));
    expect(owner, c.id).toBeTruthy();
    expect(owner!.replace(/^_/, "").startsWith(prefix[c.family] + "-"), c.id + " in " + owner).toBe(true);
  }
});

test("componentCss for one kit component carries its family rules once and no other family's", () => {
  const first = KIT.find((c) => familyCss(c.family))!;
  const css = componentCss([first.id]);
  expect(css.split(familyCss(first.family)).length - 1).toBe(1);
  expect(getComponent(first.id)!.family).toBe(first.family);
});
