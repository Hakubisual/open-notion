import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock, componentCss } from "../component-registry.js";

const bltIds = ["block-quote", "block-figure", "block-abstract", "block-footnotes", "block-author"];
const bltRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const bltCount = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;

describe("visual kit text blocks", () => {
  test("catalog metadata, samples, defaults and all four presets are usable", () => {
    for (const id of bltIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("block");
      expect(c.schema.required.length).toBeGreaterThan(0);
      for (const key of c.schema.required) expect(c.defaults[key]).toBeDefined();
      expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
      expect(c.description).toMatch(/[a-z]{3}/);
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      for (const preset of ["report", "friendly", "paper", "showcase"]) {
        expect(c.presets[preset]).toBeDefined();
        const html = bltRender(id, { ...c.sample, preset });
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).toContain('data-preset="' + preset + '"');
        expect(html).not.toContain("ui-fallback");
      }
      for (const data of [{}, "{ broken", "null", "[]", { text: {}, notes: [null, 4], keywords: {}, links: [null] }]) {
        expect(bltRender(id, data)).not.toContain("ui-fallback");
      }
      expect(bltRender(id, "{ broken")).toContain('data-ui-invalid="1"');
    }
  });

  test("figure uses the report counter without owning or resetting it", () => {
    expect(getComponent("block-figure")!.schema.required).toContain("alt");
    expect(bltRender("block-figure", { figure: true, alt: "산" })).toContain("vk-numbered");
    expect(bltRender("block-figure", { preset: "paper", alt: "산" })).toContain("vk-numbered");
    expect(bltRender("block-figure", { preset: "paper", figure: false })).not.toContain("vk-numbered");
    const css = getComponent("block-figure")!.css;
    expect(css).not.toContain("counter-increment:rp-fig");
    expect(css).not.toContain("counter-reset");
    expect(css).toContain(".rp .ui-block-figure .vk-numbered .vk-fignum::before{content:none}");
  });

  test("local image paths are validated after decoding and normalization", () => {
    for (const image of ["/media/photo.webp", "/kit/scenes/lake.svg?size=2&v=1", "/media/한글.png"]) {
      const html = bltRender("block-figure", { image, alt: '산과 "호수"' });
      expect(html).toContain("<img src=");
      expect(html).toContain('alt="산과 &quot;호수&quot;"');
    }
    for (const image of ["https://other.test/a.png", "//other.test/a.png", "/else/a.png", "/media/../private.png", "/media/%2e%2e/private.png", "/media/%2e%2e%2fprivate.png", "/media/%252e%252e/private.png", "/media/a\\b.png", "/media/%5cb.png", "/kit/", "/media/%zz"]) {
      const html = bltRender("block-figure", { image, alt: "대체 설명" });
      expect(html).not.toContain("<img");
      expect(html).toContain('class="blt-placeholder" role="img" aria-label="대체 설명"');
    }
    expect(bltRender("block-figure", { emoji: "🏞️", alt: "풍경" })).toContain('class="blt-art" role="img" aria-label="풍경"');
    expect(bltRender("block-author", { avatar: "/media/avatar.png" })).not.toContain("<img");
    expect(bltRender("block-author", { avatar: "/kit/avatar.png" })).toContain('<img src="/kit/avatar.png" alt=""');
    expect(bltRender("block-author", { avatar: "👩🏻‍💻" })).toContain("👩🏻‍💻");
  });

  test("author links require HTTPS and a label", () => {
    const html = bltRender("block-author", { links: [
      { label: "홈", href: "https://example.com/?x=1&y=2" }, { label: "대문자", href: "HTTPS://example.org" },
      ...["javascript:alert(1)", "http://example.com", "//example.com", "/local", "https://", "https://bad host.test", "https://a\\b.test"].map((href) => ({ label: "제외", href })),
      { label: "", href: "https://example.com" },
    ] });
    expect(bltCount(html, /<a href=/g)).toBe(2);
    expect(html).toContain('href="https://example.com/?x=1&amp;y=2"');
    expect(html).not.toContain("javascript:");
  });

  test("paragraphs and keyword limits preserve separate semantic blocks", () => {
    const a = bltRender("block-abstract", { text: "첫 문단\n\n둘째 문단", keywords: ["하나", null, {}, "둘"] });
    expect(bltCount(a, /<p>/g)).toBe(2);
    expect(bltCount(a, /<li>/g)).toBe(2);
    const b = bltRender("block-abstract", { text: ["첫", null, {}, "둘"], keywords: Array.from({ length: 30 }, (_, i) => "k" + i) });
    expect(bltCount(b, /<p>/g)).toBe(2);
    expect(bltCount(b, /<li>/g)).toBe(12);
  });

  test("footnote fragment ids are stable, unique within the list, and validated", () => {
    const html = bltRender("block-footnotes", { notes: [
      { id: "study_1-a", text: "**강조**" }, { id: "study_1-a", text: "중복" },
      { id: "2", text: "둘" }, { id: "bad id", text: "제외" }, { id: "", text: "제외" }, null,
    ] });
    expect(bltCount(html, /<li /g)).toBe(2);
    expect(html).toContain('id="fn-study_1-a" tabindex="-1"><b>강조</b>');
    expect(html).toContain('id="fn-2"');
    expect(html).not.toContain("중복");
    expect(bltCount(bltRender("block-footnotes", { notes: Array.from({ length: 120 }, (_, i) => ({ id: String(i), text: "note" })) }), /<li /g)).toBe(100);
  });

  test("every text field escapes markup, including nested strings and attributes", () => {
    const evil = '\"><img src=x onerror=alert(1)><script>x</script>';
    const cases = [
      ["block-quote", { text: evil, author: evil, role: evil, source: evil }],
      ["block-figure", { image: evil, emoji: evil, alt: evil, caption: evil, credit: evil }],
      ["block-abstract", { title: evil, text: [evil], keywords: [evil] }],
      ["block-footnotes", { notes: [{ id: evil, text: evil }, { id: "ok", text: evil }] }],
      ["block-author", { name: evil, role: evil, avatar: evil, bio: evil, tag: evil, links: [{ label: evil, href: 'https://example.com/"x' }] }],
    ] as const;
    for (const [id, data] of cases) {
      const html = bltRender(id, data);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;");
      expect(html).not.toContain("ui-fallback");
    }
  });

  test("responsive layout has bounded tracks, fluid art, tokens and print rules", () => {
    for (const id of bltIds) {
      const css = getComponent(id)!.css;
      expect(componentCss([id])).toContain(css);
      expect(css).toContain("container-type:inline-size");
      expect(css).toContain("overflow-wrap:anywhere");
      expect(css).toContain("@container (max-width:399px)");
      expect(css).toContain("@media print");
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius:\s*\d+px|font-size:\s*\d+px/);
    }
    expect(getComponent("block-author")!.css).toContain("48px minmax(0,1fr)");
    expect(getComponent("block-figure")!.css).toContain("aspect-ratio:16/9");
    expect(getComponent("block-quote")!.css).toContain("[data-preset=paper] .blt-mark{display:none}");
  });
});
