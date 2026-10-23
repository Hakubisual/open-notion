import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { componentCss, getComponent, renderComponentBlock } from "../component-registry.js";

const bldIds = ["block-checklist", "block-code", "block-math", "block-references", "block-swatches", "block-toc"];
const bldRender = (id: string, data: unknown) => renderComponentBlock({ type: "component", meta: { ui: id }, text: typeof data === "string" ? data : JSON.stringify(data) });
const bldCount = (html: string, cls: string) => (html.match(new RegExp('class="' + cls + '[ "]', 'g')) || []).length;

describe("block data displays", () => {
  test("all registrations have typed schemas, Korean samples and aliases, and render every preset", () => {
    for (const id of bldIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("block");
      expect(c.description.length).toBeGreaterThan(30);
      expect(c.schema.required.length).toBeGreaterThan(0);
      for (const field of c.schema.required) expect(c.defaults[field]).toBeDefined();
      for (const prop of Object.values(c.schema.properties) as any[]) expect(prop.type).toBeDefined();
      expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      for (const preset of ["report", "friendly", "paper", "showcase"]) {
        expect(c.presets[preset]).toBeDefined();
        const html = bldRender(id, { ...c.sample, preset });
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).toContain('data-preset="' + preset + '"');
        expect(html).not.toContain("ui-fallback");
      }
    }
  });

  test("empty, malformed and wrong-shaped data never throw", () => {
    for (const id of bldIds) for (const data of [{}, "{broken", "[]", { items: [null, false, []], colors: [null], references: [false], lines: {}, code: {}, tex: [] }]) {
      const html = bldRender(id, data);
      expect(html).toContain('data-ui="' + id + '"');
      expect(html).not.toContain("ui-fallback");
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });

  test("progress counts valid text rows and only boolean true, with bounded percentages", () => {
    const html = bldRender("block-checklist", { items: [{ text: "a", done: true }, { text: "b", done: "true" }, { text: "c", done: false }, { done: true }, null] });
    expect(html).toContain('1/3');
    expect(html).toContain('aria-valuemax="3" aria-valuenow="1"');
    expect(html).toContain('width:33.33%');
    expect(bldCount(html, "bld-item")).toBe(3);
    expect(bldRender("block-checklist", { items: [{ text: "a", done: true }], preset: "paper" })).toContain('☑');
    expect(bldRender("block-checklist", { items: [{ text: "a" }], preset: "paper" })).toContain('☐');
    expect(bldRender("block-checklist", { items: Array.from({ length: 130 }, () => ({ text: "a", done: true })) })).toContain('120/120');
    expect(html).not.toMatch(/<input|<button/);
  });

  test("code keeps indentation, empty lines, CRLF and trailing newline with exact highlighted line indices", () => {
    const html = bldRender("block-code", { code: "  a\r\n\r\nb\n", highlight: [2, 2, 0, -1, 2.5, "3", 100], filename: "a.txt" });
    expect(bldCount(html, "bld-line")).toBe(4);
    expect(html).toContain('class="bld-line">  a</span>');
    expect(html).toContain('class="bld-line is-highlight"></span>');
    expect((html.match(/is-highlight/g) || []).length).toBe(1);
    expect(html).toContain('tabindex="0" role="region"');
    expect(html).not.toContain('<button');
    const css = getComponent("block-code")!.css;
    expect(css).toContain('counter-increment:bld-line');
    expect(css).toContain('overflow-x:auto');
    expect(css).toContain('@media print');
  });

  test("equation source accepts derivation lines, defaults its number, and falls back to tex", () => {
    const html = bldRender("block-math", { tex: "ignored", lines: ["x = 1", null, "x + 1 = 2"], number: 0, note: "설명" });
    expect(bldCount(html, "bld-texline")).toBe(2);
    expect(html).toContain('(0)</span>');
    expect(html).not.toContain('ignored');
    expect(bldRender("block-math", { tex: "x = 1", lines: [] })).toContain('(1)</span>');
  });

  test("references distinguish APA and IEEE and only link HTTP(S) URLs", () => {
    const references = [{ authors: "Kim, M.", year: 2024, title: "연구", venue: "학회", url: "https://example.test/p?q=1&n=2" }, { title: "차단", url: "javascript:alert(1)" }];
    const apa = bldRender("block-references", { references });
    expect(apa).toContain('class="bld-refs is-apa"');
    expect(apa).toContain('Kim, M. (2024).');
    expect(apa).toContain('href="https://example.test/p?q=1&amp;n=2"');
    expect(apa).not.toContain('javascript:');
    expect(bldRender("block-references", { references, style: "ieee" })).toContain('<ol class="bld-refs is-ieee">');
  });

  test("swatches accept only CSS hex lengths after the required regex and isolate the custom property", () => {
    const html = bldRender("block-swatches", { colors: ["#abc", "#abcd", "#AAbbCC", "#11223344", "#abcde", "#abcdefg", "red", '#abc;display:none', 'url(x)', '#abc\n'].map((hex) => ({ name: "색", hex })) });
    expect(bldCount(html, "bld-swatch")).toBe(10);
    expect((html.match(/style="--sw:/g) || []).length).toBe(4);
    expect(html).toContain('style="--sw:#11223344"');
    expect(html).not.toContain('display:none');
    expect(html).not.toContain('url(x)');
  });

  test("outline resets child counters and promotes skipped levels without zero ancestors", () => {
    const html = bldRender("block-toc", { items: [3, 3, 3, 1, 3, 1].map((level, i) => ({ level, title: "절 " + i, page: i })) });
    const numbers = [...html.matchAll(/class="bld-tocnum">([^<]+)/g)].map((m) => m[1]);
    expect(numbers).toEqual(["1.", "1.1.", "1.1.1.", "2.", "2.1.", "3."]);
    expect(html).toContain('class="bld-page">0</span>');
    expect(html).not.toMatch(/<a |href=|id="toc/);
  });

  test("all string fields are escaped, and CSS is token-based and container-responsive", () => {
    const evil = '<script>alert(1)</script>\"><img src=x onerror=alert(1)>';
    const poison = (value: any): any => typeof value === "string" ? evil : Array.isArray(value) ? value.map(poison) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, poison(v)])) : value;
    for (const id of bldIds) {
      const c = getComponent(id)!;
      const html = bldRender(id, poison(c.sample));
      expect(html).not.toMatch(/<script|<img|<[a-z]+(\s+[a-z:-]+(="[^"]*")?)*\s+on[a-z]+=/i);
      expect(html).not.toContain('ui-fallback');
      expect(c.css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius:\s*\d+px/);
      expect(c.css).toContain('container-type:inline-size');
      expect(c.css).toContain('@container');
      expect(componentCss([id])).toContain(c.css);
    }
  });
});
