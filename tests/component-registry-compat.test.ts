import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownToBlocks, blocksToMarkdown } from "../markdown-blocks.ts";
import "../assets/editor-model.js";
import "../assets/columns-model.js";
import { renderBlocks } from "../block-html.js";
import * as shared from "../component-registry.js";
import "../components/index.js";

// Visual kit (acard-visual-kit): the registry grew optional fields (family, presets), componentCss(ids),
// componentOwnCss, componentIdsIn and per-component inline CSS on pages. Existing callers register components
// with the ds10 call shape, so these tests pin that shape as a check, not a promise.
const ROOT = join(import.meta.dir, "..");
// Test components go into a separate registry instance so other test files in this bun process never see them.
const ISOLATED_COPY = "../component-registry.js?compat-test";
const isolated: typeof shared = await import(ISOLATED_COPY);
const { registerComponent, getComponent, listComponents, componentCatalog, componentMarkdown, componentData, renderComponentBlock, componentCss, componentOwnCss, componentNames, COMPONENT_BASE_CSS, UI_PRESETS, UI_FAMILIES } = isolated;
const { componentIdsIn } = shared;
const baseline = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/component-render-baseline.json"), "utf8"));

// Exactly the ds10 shape (component-registry.js header comment at 2405ac6e): no family, no presets.
const OLD_SHAPE = {
  id: "compat-old-shape", name: "옛 모양", description: "A component registered with the ds10 fields only.",
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  defaults: { title: "기본 제목" },
  sample: { title: "예시 제목" },
  slash: { label: "옛 모양", hint: "호환 확인", ico: "◇", aliases: "compat old" },
  css: ".ui-compat-old-shape{border:1px solid var(--color-border)}",
  render(d: any, h: any) { return '<p class="ui-compat-t">' + h.rich(h.str(d.title, "기본 제목", 40)) + "</p>"; },
};

describe("old registerComponent call shape", () => {
  const reg = registerComponent(OLD_SHAPE);

  test("registers and returns a frozen def with the given fields unchanged", () => {
    expect(Object.isFrozen(reg)).toBe(true);
    expect(getComponent("compat-old-shape")).toBe(reg);
    for (const key of ["id", "name", "description", "schema", "defaults", "sample", "slash", "css", "render"] as const) expect(reg[key]).toBe(OLD_SHAPE[key]);
    expect(reg.family).toBe("basic");
    expect(reg.presets).toEqual({});
  });

  test("renders sample, empty and malformed data the same way as before", () => {
    expect(renderComponentBlock({ type: "component", text: JSON.stringify(OLD_SHAPE.sample), meta: { ui: OLD_SHAPE.id } }))
      .toBe('<div class="ui ui-compat-old-shape" data-ui="compat-old-shape"><p class="ui-compat-t">예시 제목</p></div>');
    expect(renderComponentBlock({ type: "component", text: "", meta: { ui: OLD_SHAPE.id } })).toContain("기본 제목");
    expect(renderComponentBlock({ type: "component", text: "{ nope", meta: { ui: OLD_SHAPE.id } })).toContain('data-ui-invalid="1"');
  });

  test("shows up in the catalog, the slash data, the names line and the css", () => {
    const entry = componentCatalog("compat-old-shape") as any;
    expect(entry).toMatchObject({ id: OLD_SHAPE.id, name: OLD_SHAPE.name, description: OLD_SHAPE.description, schema: OLD_SHAPE.schema, defaults: OLD_SHAPE.defaults, sample: OLD_SHAPE.sample, markdown: componentMarkdown(OLD_SHAPE.id, OLD_SHAPE.sample) });
    expect(listComponents().map((c) => c.id)).toContain(OLD_SHAPE.id);
    expect(listComponents("basic").map((c) => c.id)).toContain(OLD_SHAPE.id);
    expect(componentNames()).toContain(OLD_SHAPE.id);
    expect(componentCss()).toContain(OLD_SHAPE.css);
    expect(componentCss([OLD_SHAPE.id])).toBe(COMPONENT_BASE_CSS + OLD_SHAPE.css);
    expect(componentOwnCss(OLD_SHAPE.id)).toBe(OLD_SHAPE.css);
  });

  test("a minimal def (id + render only) still gets defaults, sample and slash filled in", () => {
    const min = registerComponent({ id: "compat-minimal", name: "최소", description: "only id and render", render: () => "<p>x</p>" });
    expect(min.defaults).toEqual({});
    expect(min.sample).toEqual({});
    expect(min.slash).toEqual({ label: "최소", hint: "only id and render", ico: "▦" });
  });

  test("bad ids and a missing render still throw", () => {
    expect(() => registerComponent({ id: "Bad Id", render: () => "" })).toThrow();
    expect(() => registerComponent({ id: "no-render" })).toThrow();
  });

  test("calling with the same id again replaces the component (unchanged behavior)", () => {
    registerComponent({ ...OLD_SHAPE, id: "compat-replace", name: "a" });
    registerComponent({ ...OLD_SHAPE, id: "compat-replace", name: "b" });
    expect(getComponent("compat-replace")!.name).toBe("b");
  });

  test("helpers handed to render keep their ds10 names", () => {
    let seen: any = null;
    registerComponent({ id: "compat-helpers", name: "h", description: "h", render: (_d: any, h: any) => { seen = h; return ""; } });
    renderComponentBlock({ type: "component", text: "{}", meta: { ui: "compat-helpers" } });
    for (const name of ["esc", "rich", "str", "oneOf", "list"]) expect(typeof seen[name]).toBe("function");
    expect(seen.TONES).toEqual(["neutral", "info", "success", "warning", "danger", "accent"]);
  });
});

describe("existing components are unchanged by the visual kit", () => {
  const { getComponent, renderComponentBlock, componentCatalog, componentCss } = shared;
  test("every ds10 component renders byte-identical to the 2405ac6e capture (sample, empty, malformed) with the same css, catalog and slash", () => {
    for (const id of baseline.ids as string[]) {
      const c = getComponent(id)!;
      const b = baseline.components[id];
      const r = (text: string) => renderComponentBlock({ type: "component", text, meta: { ui: id } });
      expect(r(JSON.stringify(c.sample))).toBe(b.sample);
      expect(r("")).toBe(b.empty);
      expect(r("{ nope")).toBe(b.malformed);
      expect(c.css || "").toBe(b.css);
      expect(c.slash).toEqual(b.slash);
      const { family, presets, ...rest } = componentCatalog(id) as any;
      expect(family).toBe("basic");
      expect(rest).toEqual(b.catalog);
    }
  });

  test("componentCss() with no argument still joins every component in registration order", () => {
    expect(componentCss().startsWith(baseline.componentCss)).toBe(true);
  });
});

describe("additive fields", () => {
  test("family and presets: unknown values fall back, a preset fills fields the stored data leaves out", () => {
    expect(UI_FAMILIES).toContain("chart");
    expect(UI_PRESETS).toEqual(["report", "friendly", "paper", "showcase"]);
    const c = registerComponent({ id: "compat-preset", name: "p", description: "p", family: "nope", presets: { paper: { tone: "mono" }, made_up: { tone: "x" } },
      defaults: { tone: "color", title: "t" }, render: (d: any, h: any) => "<i>" + h.esc(d.tone) + "</i>" });
    expect(c.family).toBe("basic");
    expect(Object.keys(c.presets)).toEqual(["paper"]);
    expect(componentData({ type: "component", text: '{"preset":"paper"}', meta: { ui: "compat-preset" } }).data.tone).toBe("mono");
    expect(componentData({ type: "component", text: '{"preset":"paper","tone":"own"}', meta: { ui: "compat-preset" } }).data.tone).toBe("own");
    const html = renderComponentBlock({ type: "component", text: '{"preset":"paper"}', meta: { ui: "compat-preset" } });
    expect(html).toBe('<div class="ui ui-compat-preset" data-ui="compat-preset" data-preset="paper"><i>mono</i></div>');
    expect(renderComponentBlock({ type: "component", text: '{"preset":"<x>"}', meta: { ui: "compat-preset" } })).not.toContain("data-preset");
    expect((componentCatalog("compat-preset") as any).presets).toEqual(["paper"]);
  });

  test("registerHelpers adds a frozen helper group every render receives; taken names and ds10 names are refused", () => {
    const { registerHelpers } = isolated;
    registerHelpers("compatMath", { twice: (n: number) => n * 2 });
    registerComponent({ id: "compat-uses-helper", name: "u", description: "u", render: (d: any, h: any) => "<b>" + h.compatMath.twice(Number(d.n) || 0) + "</b>" });
    expect(renderComponentBlock({ type: "component", text: '{"n":21}', meta: { ui: "compat-uses-helper" } })).toContain("<b>42</b>");
    expect(() => registerHelpers("compatMath", {})).toThrow();
    for (const name of ["esc", "rich", "str", "oneOf", "list", "TONES"]) expect(() => registerHelpers(name, {})).toThrow();
    expect(() => registerHelpers("Bad name", {})).toThrow();
  });

  test("registerFamilyCss: a family's shared rules join componentCss(ids) once for any member, and nothing for other families", () => {
    const { registerFamilyCss, familyCss } = isolated;
    registerFamilyCss("chart", ".compat-chart-family{}");
    registerComponent({ id: "compat-chart-a", name: "a", description: "a", family: "chart", css: ".a{}", render: () => "" });
    registerComponent({ id: "compat-chart-b", name: "b", description: "b", family: "chart", css: ".b{}", render: () => "" });
    expect(familyCss("chart")).toBe(".compat-chart-family{}");
    expect(componentCss(["compat-chart-a", "compat-chart-b"])).toBe(COMPONENT_BASE_CSS + ".compat-chart-family{}.a{}.b{}");
    expect(componentCss([OLD_SHAPE.id, "compat-chart-a"])).toBe(COMPONENT_BASE_CSS + OLD_SHAPE.css + ".compat-chart-family{}.a{}");
    expect(componentCss([OLD_SHAPE.id])).not.toContain("compat-chart-family");
    expect(() => registerFamilyCss("nope", "")).toThrow();
  });

  test("componentIdsIn lists each data-ui once in order", () => {
    expect(componentIdsIn('<div data-ui="stat"></div><div data-ui="tabs"></div><div data-ui="stat"></div>')).toEqual(["stat", "tabs"]);
    expect(componentIdsIn("")).toEqual([]);
  });

  const { componentMarkdown, componentOwnCss, getComponent, COMPONENT_BASE_CSS } = shared;
  test("a page carries the base css once and each used component's css once, not every component's", () => {
    const md = componentMarkdown("stat", { label: "a", value: "1" }) + "\n\n" + componentMarkdown("tabs", { tabs: [{ label: "x" }] }) + "\n\n" + componentMarkdown("stat", { label: "b", value: "2" });
    const html = renderBlocks(markdownToBlocks(md), { page: { slug: "p" }, pages: [] });
    expect(html.split(COMPONENT_BASE_CSS).length - 1).toBe(1);
    expect(html.match(/\.ui-stat\{/g)).toHaveLength(1);
    expect(html.split(componentOwnCss("tabs")).length - 1).toBe(1);
    expect(html).not.toContain(".ui-acc");
    expect(html).not.toContain(".ui-tl{");
    expect(blocksToMarkdown(markdownToBlocks(md))).toBe(md);
  });

  test("one ctx across two render calls (intro + body) does not repeat the base or a component's rules", () => {
    const ctx: any = { page: { slug: "p" }, pages: [] };
    const one = renderBlocks(markdownToBlocks(componentMarkdown("stat", { label: "a", value: "1" })), ctx);
    const two = renderBlocks(markdownToBlocks(componentMarkdown("stat", { label: "b", value: "2" }) + "\n\n" + componentMarkdown("steps", (getComponent("steps")!.sample))), ctx);
    expect((one + two).split(COMPONENT_BASE_CSS).length - 1).toBe(1);
    expect((one + two).match(/\.ui-stat\{/g)).toHaveLength(1);
    expect(two).toContain(componentOwnCss("steps"));
  });
});
