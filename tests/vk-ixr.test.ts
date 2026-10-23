import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const ixrIds = ["ix-tooltip", "ix-hovercard", "ix-stepper", "ix-countup"];
const ixrRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const ixrCount = (html: string, cls: string) => (html.match(new RegExp('class="' + cls + '[ "]', "g")) || []).length;

describe("interactive reveals", () => {
  test("samples and all presets render with typed schema and localized catalog metadata", () => {
    for (const id of ixrIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("interactive");
      expect(c.schema.required.length).toBeGreaterThan(0);
      for (const field of c.schema.required) expect(c.defaults[field]).toBeDefined();
      expect(c.slash.label).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      for (const preset of ["report", "friendly", "paper", "showcase"]) {
        expect(c.presets[preset]).toBeDefined();
        const html = ixrRender(id, { ...c.sample, preset });
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).not.toContain("ui-fallback");
      }
    }
  });

  test("empty data, malformed JSON and wrong field types stay calm", () => {
    for (const id of ixrIds) for (const data of [{}, "{ broken", { text: {}, terms: [], name: [], steps: [null, [], 3], numbers: [null, {}, { value: "3" }] }]) {
      const html = ixrRender(id, data);
      expect(html).toContain('data-ui="' + id + '"');
      expect(html).not.toContain("ui-fallback");
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });

  test("tooltips use unique description targets and deduplicate print definitions", () => {
    const data = { text: "[[용어]] [[용어]] [[missing]] [[toString]]", terms: { 용어: "정의" } };
    const html = ixrRender("ix-tooltip", data);
    const ids = [...html.matchAll(/role="tooltip" id="([^"]+)"/g)].map(m => m[1]);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain('aria-describedby="' + id + '"');
    expect(ixrCount(html, "ui-ixr-term")).toBe(2);
    expect(html.match(/<li>/g)?.length).toBe(1);
    expect(html).not.toContain("[object");
    const second = ixrRender("ix-tooltip", data);
    for (const id of ids) expect(second).not.toContain(id);
  });

  test("hovercard rejects executable, protocol-relative and backslash links", () => {
    for (const link of ["javascript:alert(1)", "//evil.test", "/\\evil.test", "https:\\evil.test", "data:text/html,test", "https://safe.test\n/evil"]) {
      expect(ixrRender("ix-hovercard", { name: "이름", link })).not.toContain("href=");
    }
    for (const link of ["https://example.com/profile", "/profile", "#profile"]) expect(ixrRender("ix-hovercard", { name: "이름", link })).toContain('href="' + link + '"');
  });

  test("radio selection clamps and floors a zero-based index without coupling instances", () => {
    const steps = Array.from({ length: 4 }, (_, i) => ({ title: "단계 " + i, text: "설명 " + i, done: i === 0 }));
    for (const [current, selected] of [[-9, 0], [1.8, 1], [99, 3], [null, 0], ["2", 0]] as const) {
      const html = ixrRender("ix-stepper", { steps, current });
      expect((html.match(/ checked>/g) || []).length).toBe(1);
      expect(html).toContain('-' + selected + '-panel" checked>');
      expect(ixrCount(html, "ui-ixr-panel")).toBe(4);
      expect(html).toContain("--ixr-columns:4");
    }
    const first = ixrRender("ix-stepper", { steps }), second = ixrRender("ix-stepper", { steps });
    expect(first.match(/name="([^"]+)"/)![1]).not.toBe(second.match(/name="([^"]+)"/)![1]);
    const many = ixrRender("ix-stepper", { steps: Array(20).fill({ title: "단계" }), current: 30 });
    expect(ixrCount(many, "ui-ixr-panel")).toBe(12);
    expect(many).toContain("--ixr-columns:6");
  });

  test("counter targets stay in CSS integer range and exact final values remain HTML", () => {
    const html = ixrRender("ix-countup", { numbers: [{ value: 12480, prefix: "₩", suffix: "원" }, { value: -12.75, delta: "-3%" }, { value: 0 }, { value: 1e20 }, { value: null }, { value: "7" }] });
    expect(ixrCount(html, "ui-ixr-metric")).toBe(4);
    expect(html).toContain('class="ui-ixr-final">₩12,480원</span>');
    expect(html).toContain('class="ui-ixr-final">-12.75</span>');
    expect(html).toContain("--ixr-target:-13");
    expect(html).toContain("--ixr-target:0");
    expect(ixrCount(html, "ui-ixr-counter")).toBe(3);
    expect(html).toContain("is-down");
    expect(html).toContain("--ixr-columns:3");
    const many = ixrRender("ix-countup", { numbers: Array(20).fill({ value: 1 }) });
    expect(ixrCount(many, "ui-ixr-metric")).toBe(8);
  });

  test("all text fields are escaped, including definitions, affixes and labels", () => {
    const evil = '<script>alert(1)</script>"><img onerror=alert(1)>';
    const htmls = [
      ixrRender("ix-tooltip", { title: evil, subtitle: evil, text: evil + "[[" + evil + "]]", terms: { [evil]: evil } }),
      ixrRender("ix-hovercard", { name: evil, role: evil, avatar: evil, bio: evil, link: evil }),
      ixrRender("ix-stepper", { title: evil, steps: [{ title: evil, text: evil }] }),
      ixrRender("ix-countup", { numbers: [{ value: 12, label: evil, prefix: evil, suffix: evil, delta: evil }] }),
    ];
    for (const html of htmls) { expect(html).not.toMatch(/<script|<img/); expect(html).not.toContain("ui-fallback"); }
  });

  test("token-only CSS provides container, keyboard, reduced-motion and print behavior", () => {
    for (const id of ixrIds) {
      const css = getComponent(id)!.css;
      expect(css).toContain("container-type:inline-size");
      expect(css).toContain("@container");
      expect(css).toContain("@media print");
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius:\s*[0-9.]+px|font-size:\s*[0-9.]+px/);
    }
    expect(getComponent("ix-tooltip")!.css).toContain(":focus-visible .ui-ixr-bubble");
    expect(getComponent("ix-hovercard")!.css).toContain(":focus-within .ui-ixr-bio");
    expect(getComponent("ix-stepper")!.css).toContain(":checked + .ui-ixr-step + .ui-ixr-panel");
    expect(getComponent("ix-countup")!.css).toContain("@property --ixr-counter");
    expect(getComponent("ix-countup")!.css).toContain("@media (prefers-reduced-motion:no-preference)");
  });
});
