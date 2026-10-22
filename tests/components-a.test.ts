import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock, componentCss } from "../component-registry.js";

// ds10 #96: callout-box, card-grid, stat-row, badges.
const IDS = ["callout-box", "card-grid", "stat-row", "badges"];
const render = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const count = (html: string, cls: string) => (html.match(new RegExp('class="' + cls + '[ "]', "g")) || []).length;

describe("components A (#96)", () => {
  test("each is registered with schema.required, defaults, a Korean sample and Korean+English slash aliases", () => {
    for (const id of IDS) {
      const c = getComponent(id)!;
      expect(c).toBeTruthy();
      expect(Array.isArray(c.schema.required) && c.schema.required.length > 0).toBe(true);
      for (const field of c.schema.required) expect(c.defaults[field]).toBeDefined();
      expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
      expect(c.slash.ico).toBeTruthy();
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
    }
  });

  test("samples render the expected parts", () => {
    const callout = render("callout-box", getComponent("callout-box")!.sample);
    expect(callout).toContain('class="ui-callout is-info"');
    expect(callout).toContain('<strong class="ui-callout-title">정보</strong>');
    expect(callout).toContain("<b>굵게</b>");
    const cards = render("card-grid", getComponent("card-grid")!.sample);
    expect(count(cards, "ui-cards-item")).toBe(3);
    expect(cards).toContain('<a class="ui-cards-item" href="/new">');
    expect(cards).toContain("--cg-cols:3");
    const stats = render("stat-row", getComponent("stat-row")!.sample);
    expect(count(stats, "ui-statrow-item")).toBe(3);
    expect(stats).toContain('<span class="ui-statrow-delta up">+12%</span>');
    expect(stats).toContain('<span class="ui-statrow-delta down">-3%</span>');
    expect(stats).toContain("--sr-n:3");
    const badges = render("badges", getComponent("badges")!.sample);
    expect(count(badges, "ui-badges-item")).toBe(6);
    expect(badges).toContain('<li class="ui-badges-item is-success">완료</li>');
  });

  test("missing or malformed fields fall back to defaults", () => {
    const callout = render("callout-box", {});
    expect(callout).toContain("is-info");
    expect(callout).toContain(getComponent("callout-box")!.defaults.text);
    expect(callout).not.toContain("ui-callout-title");
    expect(count(render("card-grid", {}), "ui-cards-item")).toBe(1);
    expect(render("card-grid", { columns: 9, items: [{}] })).toContain("--cg-cols:3");
    expect(render("card-grid", { items: [{}] })).toContain("제목 없음");
    expect(count(render("stat-row", {}), "ui-statrow-item")).toBe(2);
    expect(render("stat-row", { items: [{}, "x", null] })).toMatch(/--sr-n:1.*ui-statrow-label">지표<.*ui-statrow-value">—</);
    expect(count(render("badges", {}), "ui-badges-item")).toBe(1);
    expect(render("badges", { items: [{ tone: "info" }, { text: "" }] })).toBe('<div class="ui ui-badges" data-ui="badges"><ul class="ui-badges"></ul></div>');
    for (const id of IDS) expect(render(id, "{ broken")).toContain('data-ui-invalid="1"');
  });

  test("data never injects HTML or unsafe links", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const htmls = [
      render("callout-box", { title: evil, text: evil, icon: '"><x' }),
      render("card-grid", { items: [{ icon: evil, title: evil, text: evil, href: "javascript:alert(1)" }, { title: "a", href: "//evil.test" }, { title: "b", href: '/ok"x' }] }),
      render("stat-row", { items: [{ label: evil, value: evil, delta: evil, note: evil }] }),
      render("badges", { items: [{ text: evil, tone: '"><script>' }] }),
    ];
    for (const html of htmls) { expect(html).not.toContain("<img"); expect(html).not.toContain("<script"); expect(html).not.toContain("<x"); }
    expect(htmls[1]).not.toContain("javascript:");
    expect(htmls[1]).not.toContain('href="//evil');
    expect(htmls[1]).toContain('href="/ok&quot;x"');
  });

  test("an unknown tone draws the fallback tone", () => {
    expect(render("callout-box", { tone: "purple", text: "t" })).toContain('class="ui-callout is-info"');
    expect(render("badges", { items: [{ text: "a", tone: "rainbow" }] })).toContain('class="ui-badges-item is-neutral"');
    for (const tone of ["info", "success", "warning", "danger", "neutral"]) expect(render("callout-box", { tone, text: "t" })).toContain("is-" + tone);
  });

  test("long lists are truncated", () => {
    const many = (n: number, make: (i: number) => object) => Array.from({ length: n }, (_, i) => make(i));
    expect(count(render("card-grid", { items: many(30, (i) => ({ title: "c" + i })) }), "ui-cards-item")).toBe(12);
    const stats = render("stat-row", { items: many(9, (i) => ({ label: "l" + i, value: i })) });
    expect(count(stats, "ui-statrow-item")).toBe(4);
    expect(stats).toContain("--sr-n:4");
    expect(count(render("badges", { items: many(50, (i) => ({ text: "b" + i })) }), "ui-badges-item")).toBe(24);
    expect(render("badges", { items: [{ text: "가".repeat(100) }] })).toContain(">" + "가".repeat(40) + "</li>");
  });

  test("css uses only tokens and stacks in narrow boxes", () => {
    const css = componentCss();
    for (const id of IDS) {
      const own = getComponent(id)!.css as string;
      expect(css).toContain(own);
      expect(own).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|font-size:\s*[0-9.]+px/);
    }
    // #105: both follow their own box (container queries), not the screen.
    expect(getComponent("stat-row")!.css).toContain(".ui-stat-row{container-type:inline-size}");
    expect(getComponent("card-grid")!.css).toContain("@container (max-width:419px){.ui-cards{grid-template-columns:minmax(0,1fr)}");
  });
});
