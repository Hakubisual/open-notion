import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownToBlocks, blocksToMarkdown, acardMarkdown, acardMetaDocument } from "../markdown-blocks.ts";
import "../assets/editor-model.js";
import "../assets/columns-model.js";
import { renderBlocks } from "../block-html.js";
import { listComponents, componentCatalog, componentMarkdown, renderComponentBlock, getComponent } from "../component-registry.js";

const ROOT = join(import.meta.dir, "..");

describe("existing blocks (ds10 regression)", () => {
  // Captured from block-html.js before the component registry existed (every block type the markdown reader makes,
  // plus one unknown type with text). A change here means an existing page renders differently.
  const baseline = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/block-render-baseline.json"), "utf8"));
  test("every existing block type renders byte-identical to the pre-registry baseline", () => {
    // The last baseline block is an unknown, text-less type: it used to render as an empty anchor and is the one
    // intended change (now a fallback card). Everything before it must be identical.
    const unknown = baseline.blocks[baseline.blocks.length - 1];
    expect(unknown.type).toBe("made_up_type");
    for (const [makeCtx, expected] of [[() => ({ page: { slug: "snap" }, pages: [] }), baseline.html], [() => ({ page: { readOnly: true } }), baseline.readOnly]] as const) {
      const html = renderBlocks(baseline.blocks, makeCtx());
      expect(html.startsWith(expected)).toBe(true);
      expect(html.slice(expected.length)).toMatch(/^\n<span id="block-u1"><\/span>\n<style>\.ui\{[^<]*<\/style><div class="ui-fallback" role="note"><span class="ui-fallback-kind">made_up_type<\/span>/);
      expect(renderBlocks(baseline.blocks.slice(0, -1), makeCtx())).toBe(expected);
    }
  });
});

describe("component registry", () => {
  test("an acard-ui fence reads as a component block and writes back the same markdown", () => {
    const md = componentMarkdown("stat", { label: "가입 전환율", value: "18.4%", delta: "+12%" });
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("component");
    expect(blocks[0].meta).toEqual({ ui: "stat" });
    expect(blocksToMarkdown(blocks)).toBe(md);
    const doc = acardMetaDocument(acardMarkdown("t", blocks));
    expect(markdownToBlocks(doc.body, { meta: true })[0]).toMatchObject({ type: "component", meta: { ui: "stat" } });
  });

  test("every registered component has a schema, a sample, slash info and renders its sample without the fallback", () => {
    expect(listComponents().length).toBeGreaterThanOrEqual(2);
    for (const c of listComponents()) {
      expect(c.schema && typeof c.schema).toBe("object");
      expect(c.slash.label).toBeTruthy();
      const html = renderComponentBlock({ type: "component", text: JSON.stringify(c.sample), meta: { ui: c.id } });
      expect(html).toContain('data-ui="' + c.id + '"');
      expect(html).not.toContain("ui-fallback");
      expect(html).not.toContain("data-ui-invalid");
    }
  });

  test("malformed data renders with defaults at render time and the stored text is untouched", () => {
    const block = { id: "c1", type: "component", text: "{ not json", meta: { ui: "stat" } };
    const html = renderComponentBlock(block);
    expect(html).toContain('data-ui-invalid="1"');
    expect(html).toContain(getComponent("stat")!.defaults.label);
    expect(block.text).toBe("{ not json");
    expect(renderComponentBlock({ type: "component", text: "[1,2]", meta: { ui: "stat" } })).toContain('data-ui-invalid="1"');
  });

  test("data never injects HTML", () => {
    const html = renderComponentBlock({ type: "component", text: JSON.stringify({ label: "<img src=x onerror=alert(1)>", value: "<b>1</b>" }), meta: { ui: "stat" } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("an unknown component and an unknown text-less block type draw a fallback card, not nothing", () => {
    expect(renderComponentBlock({ type: "component", text: '{"a":1}', meta: { ui: "nope" } })).toContain('class="ui-fallback"');
    const page = renderBlocks([{ id: "x1", type: "future_block", text: "", meta: null }]);
    expect(page).toContain('class="ui-fallback"');
    expect(page).toContain("future_block");
    expect(renderBlocks([{ id: "x2", type: "future_block", text: "글", meta: null }])).toContain("<p>글</p>");
  });

  test("a page with components carries the component CSS once", () => {
    const blocks = markdownToBlocks(componentMarkdown("stat", {}) + "\n\n" + componentMarkdown("empty", {}));
    const html = renderBlocks(blocks, { page: { slug: "t" } });
    expect(html.match(/\.ui-stat\{/g)).toHaveLength(1);
  });

  test("the catalog gives agents schema, defaults and a ready-to-paste fence for each component", () => {
    const all = componentCatalog() as any[];
    expect(all.map((c) => c.id)).toEqual(listComponents().map((c) => c.id));
    for (const c of all) expect(markdownToBlocks(c.markdown)[0]).toMatchObject({ type: "component", meta: { ui: c.id } });
    expect(componentCatalog("nope")).toBeNull();
  });
});
