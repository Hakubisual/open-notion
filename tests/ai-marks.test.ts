import { describe, expect, test } from "bun:test";
import "../assets/editor-model.js";
import "../assets/columns-model.js";
import "../assets/ai-marks.js";
import { acardMarkdown, acardMetaDocument, blocksToMarkdown, markdownToBlocks } from "../markdown-blocks";

const M = (globalThis as any).AiMarks;
const b = (id: string, type: string, text: string, meta: Record<string, unknown> | null = null, indent = 0) => ({ id, type, text, indent, checked: false, meta }) as any;

describe("effective mark", () => {
  test("a block's own mark beats the page default; no mark anywhere means edit (old pages unchanged)", () => {
    expect(M.effective(b("a", "paragraph", "글"), undefined)).toBe("edit");
    expect(M.effective(b("a", "paragraph", "글"), "lock")).toBe("lock");
    expect(M.effective(b("a", "paragraph", "글", { ai: "edit" }), "lock")).toBe("edit");
    expect(M.effective(b("a", "paragraph", "글", { ai: "ref" }), "edit")).toBe("ref");
    expect(M.effective(b("a", "paragraph", "글", { ai: "nonsense" }), "nonsense")).toBe("edit");
  });
  test("smart default: headings, quotes, tables, sources lock; 메모/자료 callouts are ref; body text is edit", () => {
    expect(M.effective(b("a", "heading2", "결론"), "smart")).toBe("lock");
    expect(M.effective(b("a", "quote", "인용"), "smart")).toBe("lock");
    expect(M.effective(b("a", "table", "a | b"), "smart")).toBe("lock");
    expect(M.effective(b("a", "paragraph", "출처: 통계청 2025"), "smart")).toBe("lock");
    expect(M.effective(b("a", "callout", "메모: 회의에서 나온 말"), "smart")).toBe("ref");
    expect(M.effective(b("a", "paragraph", "초안 문장"), "smart")).toBe("edit");
  });
});

describe("guard (agent / MCP writes)", () => {
  const before = [
    b("h", "heading1", "보고서"),
    b("p1", "paragraph", "AI가 고쳐도 되는 문단"),
    b("p2", "paragraph", "매출은 12억 원이었다.", { ai: "lock" }),
    b("r1", "callout", "자료: 3분기 12억", { ai: "ref" }),
    b("p3", "paragraph", "앞 부분 그리고 고정 문장 뒤 부분", { richText: [{ text: "앞 부분 그리고 " }, { text: "고정 문장", ai: "lock" }, { text: " 뒤 부분" }] }),
  ];
  test("locked and ref blocks come back byte-identical; edit blocks take the agent text", () => {
    const after = [
      b("h", "heading1", "보고서"),
      b("p1", "paragraph", "새로 쓴 문단"),
      b("p2", "paragraph", "매출은 15억 원이었다."),
      b("r1", "callout", "자료 지움"),
      b("p3", "paragraph", "새 앞 고정 문장 새 뒤"),
    ];
    const out = M.guard(before, after, "edit");
    expect(out.locked).toEqual(["p2", "r1"]);
    expect(out.blocks.find((x: any) => x.id === "p2")).toEqual(before[2]);
    expect(out.blocks.find((x: any) => x.id === "r1")).toEqual(before[3]);
    expect(out.blocks.find((x: any) => x.id === "p1").text).toBe("새로 쓴 문단");
    const p3 = out.blocks.find((x: any) => x.id === "p3");
    expect(p3.text).toBe("새 앞 고정 문장 새 뒤");
    expect(M.spans(p3)).toEqual([[4, 5, "lock"]]);
  });
  test("a removed locked block is put back where it stood; a dropped locked piece restores the whole block", () => {
    const after = [b("h", "heading1", "보고서"), b("p1", "paragraph", "x"), b("p3", "paragraph", "고정을 바꿨다")];
    const out = M.guard(before, after, "edit");
    expect(out.blocks.map((x: any) => x.id)).toEqual(["h", "p1", "p2", "r1", "p3"]);
    expect(out.locked).toEqual(["p2", "r1", "p3"]);
    expect(out.blocks[4]).toEqual(before[4]);
  });
  test("a writer cannot set or clear a mark", () => {
    const out = M.guard([b("p", "paragraph", "글", { ai: "edit" })], [b("p", "paragraph", "새 글", { ai: "edit" }), b("n", "paragraph", "새 블록", { ai: "lock" })], "edit");
    expect(out.blocks[0].meta).toEqual({ ai: "edit" });
    expect(out.blocks[1].meta).toBeNull();
  });
  test("a page locked by default keeps every block; a page with no marks is untouched (same objects' content)", () => {
    const page = [b("a", "paragraph", "하나"), b("c", "paragraph", "둘")];
    expect(M.guard(page, [b("a", "paragraph", "바꿈")], "lock").blocks).toEqual(page);
    const free = M.guard(page, [b("a", "paragraph", "바꿈")], "edit");
    expect(free.blocks).toEqual([b("a", "paragraph", "바꿈")]);
    expect(free.locked).toEqual([]);
  });
});

describe("blocked (in-editor AI targets)", () => {
  const page = [b("a", "paragraph", "자유"), b("l", "paragraph", "고정", { ai: "lock" }), b("s", "paragraph", "가나다라마바", { richText: [{ text: "가나" }, { text: "다라", ai: "lock" }, { text: "마바" }] })];
  test("lock/ref blocks are refused; a range is refused only when it overlaps a marked piece", () => {
    expect(M.blocked(page, "edit", ["a", "l"])).toEqual(["l"]);
    expect(M.blocked(page, "edit", ["s"], [0, 2])).toEqual([]);
    expect(M.blocked(page, "edit", ["s"], [1, 3])).toEqual(["s"]);
    expect(M.blocked(page, "edit", ["s"])).toEqual(["s"]);
  });
  test("prompt context tags locked and reference text", () => {
    const ctx = M.promptContext([b("a", "paragraph", "본문"), b("r", "callout", "자료 A", { ai: "ref" }), b("l", "heading2", "제목", { ai: "lock" })], "edit");
    expect(ctx.text).toBe("본문\n<ref>자료 A</ref>\n<locked>제목</locked>");
    expect(ctx.refs).toEqual(["자료 A"]);
  });
});

describe("markdown round trip with AI marks (golden)", () => {
  const shape = (blocks: any[]) => blocks.map(({ type, text, indent, checked, meta }) => ({ type, text, indent: indent || 0, checked: !!checked, meta: meta ?? null }));
  const cases: Record<string, string> = {
    paragraph: "그냥 문장", heading1: "# 큰 제목", heading2: "## 중간 제목", heading3: "### 작은 제목", heading4: "#### 가장 작은 제목",
    bulleted: "- 항목\n  - 안쪽 항목", numbered: "1. 첫째", to_do: "- [ ] 할 일\n\n- [x] 끝낸 일", toggle: "- [toggle] 접기\n\n  속 문단",
    callout: "> [!tip] 먼저 볼 것\n> 둘째 줄", quote: "> 인용 첫 줄\n> 둘째 줄", code: "```js\nlet a = 1;\n\nlet b = 2;\n```", divider: "---",
    database: "| 이름 | 상태 |\n| --- | --- |\n| 노트 | 진행 |", table: "| 재료 | 양 |\n| === | === |\n| 밀가루 | 200g |",
    image: "![고양이 사진](/media/abc \"60\")", video: "- [video] https://youtu.be/x", audio: "- [audio] /media/song", file: "- [file] /media/doc 보고서.pdf",
    embed: "- [embed] https://maps.google.com/x", bookmark: "https://developer.mozilla.org/ko/", equation: "$$\n\\sum_{i=1}^{n} i\n$$", toc: "- [toc]",
    breadcrumb: "- [breadcrumb]", button: "- [button] 홈으로 | /", progress: "- [progress] 70 이번 주 진행", db_ref: "- [db_ref] mcp-master-facet",
    chart: "```acard-chart\n{\"type\":\"bar\",\"labels\":[\"a\"],\"series\":[{\"name\":\"s\",\"data\":[1]}]}\n```", diagram: "```mermaid\nflowchart LR\nA --> B\n```",
  };
  test("every block type keeps type, text, indent and its mark through acard-md export and import", () => {
    const marks = ["lock", "ref", "edit"];
    const blocks = markdownToBlocks(Object.values(cases).join("\n\n")).map((block, i) => ({ ...block, meta: { ...(block.meta || {}), ai: marks[i % 3] } }));
    const md = acardMarkdown("골든", blocks as any);
    const doc = acardMetaDocument(md);
    const back = markdownToBlocks(doc.body, { meta: true });
    expect(shape(back)).toEqual(shape(blocks));
    expect(acardMarkdown("골든", back)).toBe(md);
  });
  test("a marked text piece over bold and plain runs survives export and import and still guards", () => {
    const block = b("s", "paragraph", "앞 굵게 고정 뒤", { richText: [{ text: "앞 " }, { text: "굵게", bold: true, ai: "lock" }, { text: " 고정", ai: "lock" }, { text: " 뒤" }] });
    const md = blocksToMarkdown([block], { meta: true });
    expect(md).toBe('앞 **굵게** 고정 뒤\n<!--acard {"aiSpans":[["lock","**굵게** 고정"]]}-->');
    const back = markdownToBlocks(md, { meta: true });
    expect(back[0].meta).toEqual({ aiSpans: [["lock", "**굵게** 고정"]] });
    expect(blocksToMarkdown(back, { meta: true })).toBe(md);
    expect(M.guard(back, [{ ...back[0], text: "다 바꿈" }], "edit").locked).toEqual([back[0].id]);
  });
  test("pages without marks write exactly what they wrote before; other viewers see only an HTML comment", () => {
    const plain = markdownToBlocks(Object.values(cases).join("\n\n"));
    expect(blocksToMarkdown(plain, { meta: true })).toBe(blocksToMarkdown(plain));
    expect(blocksToMarkdown([b("p", "paragraph", "글", { ai: "lock" })], { meta: true })).toBe('글\n<!--acard {"ai":"lock"}-->');
    expect(blocksToMarkdown([b("p", "paragraph", "글", { ai: "lock" })])).toBe("글");
  });
  test("bad mark values are dropped, never a throw", () => {
    const back = markdownToBlocks('글\n<!--acard {"ai":"owner","aiSpans":[["x","a"],["lock",""],["ref","글"]]}-->', { meta: true });
    expect(back.map((x) => x.meta ?? null)).toEqual([{ aiSpans: [["ref", "글"]] }]);
  });
});
