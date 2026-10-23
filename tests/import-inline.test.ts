import { describe, expect, test } from "bun:test";
import { impInlineRuns, impStripInline, type ImpRun } from "../import-inline.ts";
import { blocksToMarkdown } from "../markdown-blocks.ts";

function runs(text: string, opts?: Parameters<typeof impInlineRuns>[1]): ImpRun[] {
  const out = impInlineRuns(text, opts);
  if (!out) throw new Error("expected runs for: " + text);
  expect(out.richText.map((r) => r.text).join("")).toBe(out.text);
  return out.richText;
}

describe("impInlineRuns marks", () => {
  test("**bold** and __bold__", () => {
    expect(runs("a **b** c")).toEqual([{ text: "a " }, { text: "b", bold: true }, { text: " c" }]);
    expect(runs("a __b__ c")).toEqual([{ text: "a " }, { text: "b", bold: true }, { text: " c" }]);
  });
  test("*italic* and _italic_", () => {
    expect(runs("a *b* c")).toEqual([{ text: "a " }, { text: "b", italic: true }, { text: " c" }]);
    expect(runs("a _b_ c")).toEqual([{ text: "a " }, { text: "b", italic: true }, { text: " c" }]);
  });
  test("`code` keeps its content literal", () => {
    expect(runs("a `b` c")).toEqual([{ text: "a " }, { text: "b", code: true }, { text: " c" }]);
    expect(runs("`x **y** z`")).toEqual([{ text: "x **y** z", code: true }]);
  });
  test("~~strike~~", () => {
    expect(runs("a ~~b~~ c")).toEqual([{ text: "a " }, { text: "b", strike: true }, { text: " c" }]);
  });
  test("==highlight== becomes background yellow", () => {
    expect(runs("a ==b== c")).toEqual([{ text: "a " }, { text: "b", background: "yellow" }, { text: " c" }]);
  });
  test("[label](https) and mailto links", () => {
    expect(runs("see [x](https://x.test/a) now")).toEqual([{ text: "see " }, { text: "x", href: "https://x.test/a" }, { text: " now" }]);
    expect(runs("[m](mailto:a@b.c)")).toEqual([{ text: "m", href: "mailto:a@b.c" }]);
    expect(runs("[r](/page/) [h](#top)")).toEqual([{ text: "r", href: "/page/" }, { text: " " }, { text: "h", href: "#top" }]);
  });
  test("unsafe hrefs drop the link and keep the label", () => {
    expect(runs("[x](javascript:alert(1))")).toEqual([{ text: "x" }]);
    expect(runs("[x](data:text/html,a)")).toEqual([{ text: "x" }]);
    expect(runs("[x](vbscript:a)")).toEqual([{ text: "x" }]);
    expect(runs("[x](//evil.test)")).toEqual([{ text: "x" }]);
    expect(runs("[**b**](javascript:x)")).toEqual([{ text: "b", bold: true }]);
  });
  test("imp-page: and imp-asset: placeholders are kept as href", () => {
    expect(runs("[p](imp-page:docs/a.md#Intro)")).toEqual([{ text: "p", href: "imp-page:docs/a.md#Intro" }]);
    expect(runs("[f](imp-asset:files/x.pdf)")).toEqual([{ text: "f", href: "imp-asset:files/x.pdf" }]);
  });
  test("nested marks: **a [b](https://x) c** and bold inside italic", () => {
    expect(runs("**a [b](https://x) c**")).toEqual([
      { text: "a ", bold: true }, { text: "b", bold: true, href: "https://x" }, { text: " c", bold: true },
    ]);
    expect(runs("*i **b** i*")).toEqual([{ text: "i ", italic: true }, { text: "b", italic: true, bold: true }, { text: " i", italic: true }]);
    expect(runs("[*i* and `c`](https://x)")).toEqual([
      { text: "i", italic: true, href: "https://x" }, { text: " and ", href: "https://x" }, { text: "c", code: true, href: "https://x" },
    ]);
  });
});

describe("impInlineRuns wiki links", () => {
  test("[[a|b]] with a resolver sets href or mention and shows the label", () => {
    const link = (target: string, label: string) => ({ href: "imp-page:" + target });
    expect(runs("go [[a|b]] now", { link })).toEqual([{ text: "go " }, { text: "b", href: "imp-page:a" }, { text: " now" }]);
    expect(runs("[[a]]", { link })).toEqual([{ text: "a", href: "imp-page:a" }]);
    expect(runs("[[a]]", { link: () => ({ mention: "a-slug" }) })).toEqual([{ text: "a", mention: { type: "page", slug: "a-slug" } }]);
  });
  test("[[target#heading]] shows target > heading unless a label is given", () => {
    const calls: unknown[] = [];
    const link = (target: string, label: string, heading: string) => { calls.push([target, label, heading]); return { href: "imp-page:" + target + "#" + heading }; };
    expect(runs("[[a#Intro]]", { link })).toEqual([{ text: "a > Intro", href: "imp-page:a#Intro" }]);
    expect(runs("[[a#Intro|Read]]", { link })).toEqual([{ text: "Read", href: "imp-page:a#Intro" }]);
    expect(calls).toEqual([["a", "a > Intro", "Intro"], ["a", "Read", "Intro"]]);
  });
  test("[[missing]] without a resolver or with null stays literal", () => {
    expect(impInlineRuns("see [[missing]] here")).toBeNull();
    expect(impInlineRuns("see [[missing|x]] here", { link: () => null })).toBeNull();
    expect(runs("**b** [[m]]", { link: () => null })).toEqual([{ text: "b", bold: true }, { text: " [[m]]" }]);
  });
});

describe("impInlineRuns literals", () => {
  test("CJK: ** around Korean works", () => {
    expect(runs("오늘 **한글** 메모")).toEqual([{ text: "오늘 " }, { text: "한글", bold: true }, { text: " 메모" }]);
    expect(runs("*기울임*")).toEqual([{ text: "기울임", italic: true }]);
  });
  test("snake_case_words and 2*3*4 stay literal", () => {
    expect(impInlineRuns("use snake_case_words here")).toBeNull();
    expect(impInlineRuns("2*3*4 = 24")).toBeNull();
    expect(impInlineRuns("a * b * c")).toBeNull();
  });
  test("escaped \\* and \\_ stay literal", () => {
    expect(runs("a \\*b\\* c \\_d\\_")).toEqual([{ text: "a *b* c _d_" }]);
  });
  test("plain text returns null", () => {
    expect(impInlineRuns("plain text")).toBeNull();
    expect(impInlineRuns("")).toBeNull();
    expect(impInlineRuns("unclosed **bold and `code")).toBeNull();
  });
  test("runs text join equals the visible text", () => {
    const out = impInlineRuns("**a** *b* `c` ~~d~~ ==e== [f](https://x) [[g|h]]", { link: () => ({ href: "/g/" }) })!;
    expect(out.text).toBe("a b c d e f h");
    expect(out.richText.map((r) => r.text).join("")).toBe(out.text);
  });
});

describe("impStripInline", () => {
  test("returns the visible text only", () => {
    expect(impStripInline("**Title** with `code` and [link](https://x)")).toBe("Title with code and link");
    expect(impStripInline("plain")).toBe("plain");
  });
});

describe("round trip through richMarkdown", () => {
  test("bold, code and links survive blocksToMarkdown and parse back to the same runs", () => {
    const src = "**b** and `c` and [l](https://x.test/) and [p](/page/)";
    const first = impInlineRuns(src)!;
    const md = blocksToMarkdown([{ id: "b1", type: "paragraph", text: first.text, meta: { richText: first.richText } }]);
    expect(md).toBe(src);
    expect(impInlineRuns(md)).toEqual(first);
  });
});
