import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const ixmIds = ["ix-compare", "ix-slider", "ix-scroll-reveal", "ix-sortable"];
const ixmRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const ixmCount = (html: string, cls: string) => (html.match(new RegExp('class="' + cls + '[ "]', 'g')) || []).length;

describe("interactive media components", () => {
  test("all components provide schemas, Korean samples, aliases and four presets", () => {
    for (const id of ixmIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("interactive");
      expect(c.schema.required.length).toBeGreaterThan(0);
      for (const field of c.schema.required) expect(c.defaults[field]).toBeDefined();
      expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      for (const preset of ["report", "friendly", "paper", "showcase"]) {
        expect(c.presets[preset]).toBeDefined();
        const html = ixmRender(id, { ...c.sample, preset });
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).not.toContain("ui-fallback");
      }
    }
  });

  test("empty and malformed values never throw or create script controls", () => {
    for (const id of ixmIds) for (const data of [{}, "{ bad", "null", "[]", { before: [], after: 9, cards: [null, [], false], items: [null, [], false], marks: {}, value: {}, min: [], max: null }]) {
      const html = ixmRender(id, data);
      expect(html).toContain('data-ui="' + id + '"');
      expect(html).not.toMatch(/ui-fallback|<script|<input|draggable=/);
    }
    expect(ixmCount(ixmRender("ix-scroll-reveal", {}), "ixm-card")).toBe(0);
    expect(ixmCount(ixmRender("ix-sortable", {}), "ixm-item")).toBe(0);
  });

  test("comparison accepts only unambiguous media and kit paths", () => {
    for (const image of ["/media/photo.webp", "/kit/landscape/view-1.png"]) {
      expect(ixmRender("ix-compare", { before: { image, label: "전" } })).toContain('src="' + image + '"');
    }
    for (const image of ["https://example.test/x.png", "//example.test/x.png", "data:image/svg+xml,x", "/media/../secret", "/media/./x", "/media/%2e%2e/x", "/media/x%2fy", "/media/", "/media//x", "/media/x?redirect=evil", "/media/\\evil", '/media/x" onerror="x']) {
      expect(ixmRender("ix-compare", { before: { image }, after: { image } })).not.toContain("<img");
    }
    const html = ixmRender("ix-compare", { before: { label: "first" }, after: { label: "second" } });
    expect(ixmCount(html, "ixm-pane")).toBe(2);
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    expect(html).toContain('tabindex="0" role="region" aria-label=');
  });

  test("every string field escapes markup and colors cannot inject CSS", () => {
    const evil = '<script>alert(1)</script>\"><img onerror=alert(1)>';
    const common = { title: evil, subtitle: evil, caption: evil };
    const htmls = [
      ixmRender("ix-compare", { ...common, before: { label: evil, text: evil, color: evil, image: evil }, after: { label: evil, text: evil, alt: evil, image: "/kit/safe.png" } }),
      ixmRender("ix-slider", { ...common, label: evil, value: evil, min: evil, max: evil, marks: [evil] }),
      ixmRender("ix-scroll-reveal", { ...common, cards: [{ icon: evil, title: evil, text: evil }] }),
      ixmRender("ix-sortable", { ...common, items: [{ label: evil, note: evil }] }),
    ];
    for (const html of htmls) {
      expect(html).not.toMatch(/<script|<img onerror|" onerror="|NaN|Infinity/);
      expect(html).toContain("&lt;script&gt;");
    }
    expect(htmls[0]).toContain('alt="&lt;script&gt;');
    expect(htmls[0]).toContain("ixm-tone-neutral");
  });

  test("meter positions use the normalized domain and clamp values", () => {
    for (const [data, min, max, value, percent] of [
      [{ min: -20, max: 80, value: 5 }, -20, 80, 5, 25],
      [{ min: 80, max: -20, value: 130 }, -20, 80, 80, 100],
      [{ min: 10, max: 10, value: -20 }, 0, 100, 0, 0],
      [{ min: "-10", max: "10", value: "0" }, -10, 10, 0, 50],
      [{ min: -1e308, max: 1e308, value: 0 }, -1e308, 1e308, 0, 50],
      [{ min: 0, max: 5e-324, value: 5e-324 }, 0, 5e-324, 5e-324, 100],
    ] as const) {
      const html = ixmRender("ix-slider", data);
      expect(html).toContain('role="meter"');
      expect(html).toContain('aria-valuemin="' + min + '"');
      expect(html).toContain('aria-valuemax="' + max + '"');
      expect(html).toContain('aria-valuenow="' + value + '"');
      const actual = Number(html.match(/--ixm-value:([\d.e+-]+)%/)![1]);
      expect(actual).toBeCloseTo(percent, 8);
    }
  });

  test("dense marks are deduplicated and limited without overlap", () => {
    const html = ixmRender("ix-slider", { min: 0, max: 100, value: 30, marks: [0, 1, 2, 2, 3, 40, 41, 80, 99, 100, 200, null, "invalid"] });
    expect(ixmCount(html, "ixm-mark")).toBe(4);
    expect(html).toContain('<ul class="ixm-values"');
    expect((html.match(/<li>2<\/li>/g) || []).length).toBe(1);
    expect(html).not.toContain("<li>200</li>");
    expect(html).not.toMatch(/NaN|Infinity/);
    const positions = [...html.matchAll(/--ixm-mark:([\d.]+)%/g)].map((m) => Number(m[1]));
    for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(19);
    const huge = ixmRender("ix-slider", { min: 100000, max: 200000, value: 150000 });
    expect(ixmCount(huge, "ixm-mark")).toBe(0);
    expect(huge).toContain('<li>100000</li>');
  });

  test("reveal and sortable preserve valid data order and cap lists", () => {
    expect(ixmCount(ixmRender("ix-scroll-reveal", { cards: Array.from({ length: 30 }, (_, i) => ({ title: "card " + i })) }), "ixm-card")).toBe(12);
    expect(ixmCount(ixmRender("ix-sortable", { items: Array.from({ length: 30 }, (_, i) => ({ label: "item " + i })) }), "ixm-item")).toBe(24);
    const html = ixmRender("ix-sortable", { items: [null, { label: "alpha", note: "note" }, false, { label: "beta" }, { label: "gamma" }] });
    expect(html).toContain('<ol class="ixm-list" role="list">');
    expect(ixmCount(html, "ixm-item")).toBe(3);
    expect((html.match(/ixm-lifted/g) || []).length).toBe(1);
    expect(html.indexOf("alpha")).toBeLessThan(html.indexOf("beta"));
    expect(html.indexOf("beta")).toBeLessThan(html.indexOf("gamma"));
    expect(html).not.toMatch(/role="button"|tabindex|draggable|<button/);
  });

  test("CSS guards motion, preserves print content and uses tokens", () => {
    for (const id of ixmIds) {
      const css = getComponent(id)!.css;
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius:\s*\d+px|font-size:\s*\d+px/);
      expect(css).toContain("container-type:inline-size");
      expect(css).toContain("@media print");
    }
    const reveal = getComponent("ix-scroll-reveal")!.css;
    expect(reveal).toContain("@supports (animation-timeline:view()){@media (prefers-reduced-motion:no-preference)");
    expect(reveal).toContain("animation:none;opacity:1;transform:none");
    const compare = getComponent("ix-compare")!.css;
    expect(compare).toContain("scroll-snap-type:x mandatory");
    expect(compare).toContain("@container (max-width:519px)");
  });
});
