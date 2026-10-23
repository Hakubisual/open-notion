import { describe, expect, test } from "bun:test";
import { blocksToMarkdown, markdownToBlocks } from "../markdown-blocks.ts";
import { renderBlocks } from "../block-html.js";

const SNAP = { name: "단어 수", tree: [{ t: "stat", label: "단어", value: "1,200" }, { t: "slider", name: "n", label: "목표", min: 0, max: 10, value: 3 }] };
const block = (meta: Record<string, unknown>, text = '{"n":3}') => ({ id: "p1", type: "plugin", text, meta });

describe("plugin blocks (issue 144)", () => {
  test("an acard-plugin fence round-trips with its plugin, block and snapshot", () => {
    const md = blocksToMarkdown([block({ plugin: "word-count", block: "counter", snapshot: SNAP }) as any]);
    expect(md).toContain('```acard-plugin {"plugin":"word-count","block":"counter","snapshot":');
    const [back] = markdownToBlocks(md);
    expect(back.type).toBe("plugin");
    expect(back.meta).toEqual({ plugin: "word-count", block: "counter", snapshot: SNAP });
    expect(back.text).toBe('{"n":3}');
  });

  test("signed-in readers with plugins on get a frame host and the runtime script", () => {
    const html = renderBlocks([block({ plugin: "word-count", block: "counter" })], { page: { slug: "a" }, plugins: true });
    expect(html).toContain('<figure class="pl-block" data-plugin="word-count" data-block="counter"><div class="pl-host">');
    expect(html).toContain('<script src="/lazy/plugins.js?v=');
    expect(html).not.toContain("<iframe");
  });

  test("shared/published pages and plugins-off readers get the static snapshot only, controls disabled, no script", () => {
    for (const ctx of [{ page: { readOnly: true }, plugins: true }, { page: { slug: "a" } }, undefined]) {
      const html = renderBlocks([block({ plugin: "word-count", block: "counter", snapshot: SNAP })], ctx as any);
      expect(html).toContain('class="pl-static"');
      expect(html).toContain("플러그인이 만든 화면 · 단어 수");
      expect(html).toContain(" disabled");
      expect(html).not.toMatch(/<script|<iframe/);
    }
  });

  test("without a snapshot a public page shows a short note; a hostile snapshot stays text", () => {
    expect(renderBlocks([block({ plugin: "word-count", block: "counter" })], { page: { readOnly: true } } as any)).toContain("Acard 에서 열면 보여요");
    const evil = renderBlocks([block({ plugin: "x-y", block: "b", snapshot: { name: "<img src=x onerror=alert(1)>", tree: [{ t: "text", text: "<script>alert(1)</script>" }, { t: "html", html: "<b>x</b>" }] } })], { page: { readOnly: true } } as any);
    expect(evil).not.toMatch(/<script>alert|<img src=x/);
    expect(evil).toContain("&lt;script&gt;");
    const badId = renderBlocks([block({ plugin: "Bad\"><x", block: "b" })], { page: { readOnly: true } } as any);
    expect(badId).toContain('data-plugin=""');
  });
});
