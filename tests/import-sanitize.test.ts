import { describe, expect, test } from "bun:test";
import { impSafeHref, impSanitizeBlocks, impSanitizeSvg, impSanitizeText } from "../import-sanitize.ts";
import { markdownToBlocks, type Block } from "../markdown-blocks.ts";
import { buildFixture } from "./fixtures/import-fixtures.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const DANGER = ["<script", "onerror=", "onload=", "javascript:"];

describe("impSafeHref", () => {
  test("accepts the EditorModel.safeHref shapes and import placeholders", () => {
    for (const ok of ["https://example.com/a?b=1", "http://x", "mailto:a@b.c", "/page/", "#frag", "imp-page:Home abc.md#Goals", "imp-asset:dir/with space/x.png"]) {
      expect(impSafeHref(ok)).toBe(ok);
    }
  });
  test("rejects javascript:, protocol-relative, control chars, backslashes and non-strings", () => {
    for (const bad of ["javascript:alert(1)", "//evil.test/x", "/a\\b", "https://x\u0001y", "data:text/html,<b>", "imp-page:\u0000x", 12, null, undefined]) {
      expect(impSafeHref(bad)).toBe("");
    }
  });
});

describe("impSanitizeText", () => {
  test("removes scripts, dangerous tags, handler attributes and bad URLs", () => {
    const { text, removed } = impSanitizeText(
      'a<SCRIPT type="x">\nalert(1)\n</script >b<iframe src="https://evil.test"></iframe><img src=x onerror=alert(1)><a href="JavaScript:alert(1)">l</a>[x](javascript:alert(1))<form action="/x">',
    );
    expect(text).toBe('ab<img src=x><a>l</a>x');
    expect(removed).toBe(7);
  });
  test("an unterminated script tag is removed to the end", () => {
    expect(impSanitizeText("before<script>alert(1)\nmore").text).toBe("before");
  });
  test("plain text that mentions script stays", () => {
    const input = "<b>bold</b> and the word script";
    expect(impSanitizeText(input)).toEqual({ text: input, removed: 0 });
  });
  test("obfuscated attribute URLs are caught, benign ones stay", () => {
    expect(impSanitizeText('<a href="java\nscript:x">a</a><a href="&#106;avascript:x">b</a><a href="https://ok.test">c</a>').text).toBe('<a>a</a><a>b</a><a href="https://ok.test">c</a>');
    expect(impSanitizeText("[d](data:text/html;base64,PGI+) and [ok](https://ok.test)").text).toBe("d and [ok](https://ok.test)");
  });
});

describe("impSanitizeBlocks", () => {
  test("executable block types become code blocks with the source kept", () => {
    const blocks = markdownToBlocks('```html-embed\n<script>alert(1)</script>\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n```acard-chart\n{"type":"bar"}\n```');
    expect(blocks.map((b) => b.type)).toEqual(["html", "diagram", "chart"]);
    const out = impSanitizeBlocks(blocks);
    expect(out.blocks.map((b) => [b.type, b.meta?.lang])).toEqual([["code", "html"], ["code", "mermaid"], ["code", "json"]]);
    expect(out.blocks[0].text).toBe("<script>alert(1)</script>");
    expect(out.removed).toBe(0);
  });
  test("code block text is never touched", () => {
    const blocks: Block[] = [{ id: "c", type: "code", text: "<script>x</script>", meta: { lang: "html" } }];
    expect(impSanitizeBlocks(blocks).blocks).toEqual(blocks);
  });
  test("a valid https image src stays; a javascript: src becomes a paragraph with the caption only", () => {
    const out = impSanitizeBlocks(markdownToBlocks("![cap](https://ok.test/a.png)\n\n![evil](javascript:alert(1))\n\n![ph](imp-asset:dir/x.png)"));
    expect(out.blocks[0]).toMatchObject({ type: "image", text: "cap", meta: { src: "https://ok.test/a.png" } });
    expect(out.blocks[1]).toEqual({ id: out.blocks[1].id, type: "paragraph", text: "evil", indent: 0 });
    expect(out.blocks[2]).toMatchObject({ type: "image", meta: { src: "imp-asset:dir/x.png" } });
    expect(out.removed).toBe(1);
  });
  test("url blocks need a safe url, else they become a paragraph with their name", () => {
    const blocks: Block[] = [
      { id: "f", type: "file", text: "", meta: { url: "vbscript:x", name: "spec.pdf" } },
      { id: "v", type: "video", text: "", meta: { url: "imp-asset:v.mp4" } },
      { id: "b", type: "button", text: "Go", meta: { url: "data:text/html,x" } },
      { id: "e", type: "embed", text: "", meta: { url: "https://ok.test/e" } },
    ];
    const out = impSanitizeBlocks(blocks);
    expect(out.blocks.map((b) => b.type)).toEqual(["paragraph", "video", "paragraph", "embed"]);
    expect(out.blocks[0].text).toBe("spec.pdf");
    expect(out.blocks[2].text).toBe("Go");
    expect(out.removed).toBe(2);
  });
  test("richText runs lose unsafe hrefs but keep text, marks and mentions", () => {
    const blocks: Block[] = [{
      id: "p", type: "paragraph", text: "a b c",
      meta: { richText: [{ text: "a", href: "javascript:x", bold: true }, { text: " b", href: "imp-page:Home.md" }, { text: " c", mention: { type: "page", slug: "imp-page:Home.md" } }] },
    }];
    const out = impSanitizeBlocks(blocks);
    expect(out.blocks[0].meta?.richText).toEqual([{ text: "a", bold: true }, { text: " b", href: "imp-page:Home.md" }, { text: " c", mention: { type: "page", slug: "imp-page:Home.md" } }]);
    expect(out.removed).toBe(1);
  });
  test("when the text changes, stale richText is dropped and the input is not mutated", () => {
    const blocks: Block[] = [{ id: "p", type: "paragraph", text: "x<script>y</script>", meta: { richText: [{ text: "x<script>y</script>" }] } }];
    const out = impSanitizeBlocks(blocks);
    expect(out.blocks[0]).toEqual({ id: "p", type: "paragraph", text: "x", meta: {} });
    expect(blocks[0].text).toBe("x<script>y</script>");
    expect(blocks[0].meta?.richText).toHaveLength(1);
  });
});

describe("impSanitizeSvg", () => {
  test("three benign SVGs come back unchanged", () => {
    const benign = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><circle r="4" fill="url(#g)"/><use xlink:href="#g" href="#g"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:url(#g);font-size:12px}</style><text class="a" x="1" y="9">on time</text><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>',
    ];
    for (const svg of benign) expect(impSanitizeSvg(svg)).toBe(svg);
  });
  test("applies every auto-images rule plus external href/src/url() removal", () => {
    const svg = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><style>@import url(https://evil.test/a.css); .b{fill:url(https://evil.test/p.png)} .c{fill:url("data:image/png;base64,AAAA")}</style><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><rect width="1" height="1" onclick="x()"/></a><image href="https://evil.test/t.png" src="https://evil.test/s.png"/><image xlink:href="data:image/svg+xml;base64,AAAA"/><set attributeName="href" to="javascript:x"/><use href="#ok"/><video src="https://evil.test/v.mp4"></video></svg>';
    const out = impSanitizeSvg(svg);
    expect(out).not.toMatch(/script|foreignObject|onload|onclick|javascript:|evil\.test|DOCTYPE|ENTITY|@import|<set|<video|svg\+xml/i);
    expect(out).toContain('href="#ok"');
    expect(out).toContain("<rect");
    expect(out).toContain('fill:url("data:image/png;base64,AAAA")');
    expect(out).toContain(".b{fill:none}");
  });
});

describe("fixture E4", () => {
  test("every md body is inert after markdownToBlocks + impSanitizeBlocks, evil.svg is inert, the html page text is inert", async () => {
    const fixture = await buildFixture("E4");
    const mdPaths = [...fixture.files.keys()].filter((p) => p.endsWith(".md"));
    const svgPaths = [...fixture.files.keys()].filter((p) => p.endsWith(".svg"));
    const htmlPaths = [...fixture.files.keys()].filter((p) => p.endsWith(".html"));
    expect(mdPaths).toHaveLength(1);
    expect(svgPaths).toHaveLength(1);
    expect(htmlPaths).toHaveLength(1);

    for (const path of mdPaths) {
      const raw = markdownToBlocks(decode(fixture.files.get(path)!));
      const rawJson = JSON.stringify(raw);
      for (const needle of ["<script", "onerror=", "javascript:"]) expect(rawJson).toContain(needle);
      const out = impSanitizeBlocks(raw);
      // Code blocks render through escapeHtml (block-html.js) and keep their source verbatim; every other block is scanned.
      const json = JSON.stringify(out.blocks.filter((b) => b.type !== "code"));
      for (const needle of DANGER) expect(json).not.toContain(needle);
      expect(out.removed).toBeGreaterThan(0);
      const codes = out.blocks.filter((b) => b.type === "code");
      expect(codes).toEqual([{ id: codes[0]?.id, type: "code", text: '<script>alert("fence")</script>', indent: 0, meta: { lang: "html" } }]);
      expect(out.blocks.filter((b) => b.type === "image")).toEqual([]);
      expect(out.blocks.find((b) => b.text === "evil.svg")).toMatchObject({ type: "paragraph" });
      expect(json).toContain("Notion page");
    }

    const svg = impSanitizeSvg(decode(fixture.files.get(svgPaths[0])!));
    for (const needle of ["<script", "onload", "https://evil.test"]) expect(svg).not.toContain(needle);
    expect(svg).toContain('<rect width="10" height="10" fill="red"/>');

    const html = impSanitizeText(decode(fixture.files.get(htmlPaths[0])!));
    for (const needle of DANGER) expect(html.text).not.toContain(needle);
    expect(html.text).toContain("hello");
    expect(html.text).toContain("js link");
    expect(html.removed).toBe(4); // <meta charset>, <script>, onerror=, javascript: href
  });
});

test("handlers glued with / instead of a space are removed too (lane review)", () => {
  for (const x of ["<svg/onload=alert(1)>", "<img/src=x/onerror=alert(1)>", "<a\"onclick=alert(1)>x</a>"]) {
    const out = impSanitizeText(x);
    expect(out.text).not.toMatch(/on(load|error|click)\s*=/i);
    expect(out.removed).toBeGreaterThan(0);
  }
  expect(impSanitizeSvg('<svg/onload="alert(1)"><image/href="https://evil.test/x.png"/></svg>')).not.toMatch(/onload|evil\.test/);
});
