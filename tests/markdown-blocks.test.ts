import { describe, expect, test } from "bun:test";
import { blockLinks, blocksToMarkdown, markdownToBlocks } from "../markdown-blocks.ts";

describe("markdownToBlocks", () => {
  test("중첩 토글 문단 제목 목록의 왕복은 깊이를 보존한다", () => {
    const input = "- [toggle] 부모\n\n  자식 문단\n\n  ## 자식 제목\n\n  - 목록\n    - 손자\n\n다음";
    const blocks = markdownToBlocks(input);
    expect(blocks.map(b => b.indent)).toEqual([0, 1, 1, 1, 2, 0]);
    expect(markdownToBlocks(blocksToMarkdown(blocks)).map(({type, text, indent}) => ({type, text, indent})))
      .toEqual(blocks.map(({type, text, indent}) => ({type, text, indent})));
  });
  test("제목은 단계별 블록이 된다", () => {
    const blocks = markdownToBlocks("# 하나\n## 둘\n### 셋\n#### 넷");
    expect(blocks.map((b) => b.type)).toEqual(["heading1", "heading2", "heading3", "heading3"]);
    expect(blocks[0].text).toBe("하나");
    expect(blocks[3].text).toBe("넷");
  });

  test("할 일 목록은 체크 상태를 갖는다", () => {
    const blocks = markdownToBlocks("- [ ] 안 한 일\n- [x] 한 일");
    expect(blocks.map((b) => b.type)).toEqual(["to_do", "to_do"]);
    expect(blocks[0].checked).toBe(false);
    expect(blocks[1].checked).toBe(true);
  });

  test("토글과 목록은 들여쓰기를 기억한다", () => {
    const blocks = markdownToBlocks("- [toggle] 접기\n  - 안에 든 항목\n1. 첫째");
    expect(blocks.map((b) => b.type)).toEqual(["toggle", "bulleted", "numbered"]);
    expect(blocks[1].indent).toBe(1);
  });

  test("콜아웃은 여러 줄을 한 블록으로 모은다", () => {
    const blocks = markdownToBlocks("> [!tip] 먼저 볼 것\n> 둘째 줄\n\n다음 문단");
    expect(blocks[0].type).toBe("callout");
    expect(blocks[0].text).toBe("먼저 볼 것\n둘째 줄");
    expect(blocks[0].meta?.tone).toBe("tip");
    expect(blocks[1].type).toBe("paragraph");
  });

  test("표는 데이터베이스 블록이 된다", () => {
    const blocks = markdownToBlocks("| 이름 | 상태 |\n| --- | --- |\n| 노트 | 진행 |\n| 서버 | 대기 |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("database");
    expect(blocks[0].meta?.columns).toEqual(["이름", "상태"]);
    expect(blocks[0].meta?.rows).toEqual([
      { 이름: "노트", 상태: "진행" },
      { 이름: "서버", 상태: "대기" },
    ]);
  });

  test("코드블록과 구분선", () => {
    const blocks = markdownToBlocks("```js\nlet a = 1;\n```\n\n---\n\n끝");
    expect(blocks.map((b) => b.type)).toEqual(["code", "divider", "paragraph"]);
    expect(blocks[0].text).toBe("let a = 1;");
    expect(blocks[0].meta?.lang).toBe("js");
  });

  test("문단은 빈 줄에서 끊기고 한 줄로 합쳐진다", () => {
    const blocks = markdownToBlocks("첫 줄\n둘째 줄\n\n새 문단");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[0].text).toBe("첫 줄 둘째 줄");
  });

  test("블록마다 다른 id를 준다", () => {
    const blocks = markdownToBlocks("가\n\n나\n\n다");
    expect(new Set(blocks.map((b) => b.id)).size).toBe(3);
  });
});

describe("blocksToMarkdown round trip", () => {
  const shape = (blocks: ReturnType<typeof markdownToBlocks>) =>
    blocks.map(({ type, text, indent, checked, meta }) => ({ type, text, indent: indent || 0, checked: !!checked, meta: meta ?? null }));
  const cases: Record<string, string> = {
    paragraph: "그냥 문장",
    heading1: "# 큰 제목",
    heading2: "## 중간 제목",
    heading3: "### 작은 제목",
    bulleted: "- 항목\n  - 안쪽 항목",
    numbered: "1. 첫째",
    to_do: "- [ ] 할 일\n\n- [x] 끝낸 일",
    toggle: "- [toggle] 접기\n\n  속 문단",
    callout: "> [!tip] 먼저 볼 것\n> 둘째 줄",
    quote: "> 인용 첫 줄\n> 둘째 줄",
    code: "```js\nlet a = 1;\n\nlet b = 2;\n```",
    divider: "---",
    database: "| 이름 | 상태 |\n| --- | --- |\n| 노트 | 진행 |",
    table: "| 재료 | 양 |\n| === | === |\n| 밀가루 | 200g |",
    image: "![고양이 사진](/media/abc \"60\")",
    imageFull: "![](/media/abc)",
    video: "- [video] https://youtu.be/x",
    audio: "- [audio] /media/song",
    file: "- [file] /media/doc 보고서.pdf",
    embed: "- [embed] https://maps.google.com/x",
    bookmark: "https://developer.mozilla.org/ko/",
    columns: ":::cols\n왼쪽 열\n---\n오른쪽 열\n:::",
    equation: "$$\n\\sum_{i=1}^{n} i\n$$",
    toc: "- [toc]",
    breadcrumb: "- [breadcrumb]",
    button: "- [button] 홈으로 | /",
    progress: "- [progress] 70 이번 주 진행",
    db_ref: "- [db_ref] mcp-master-facet",
  };
  for (const [name, markdown] of Object.entries(cases)) {
    test(name + " 블록은 마크다운으로 갔다 와도 같다", () => {
      const blocks = markdownToBlocks(markdown);
      expect(blocks.length).toBeGreaterThan(0);
      expect(shape(markdownToBlocks(blocksToMarkdown(blocks)))).toEqual(shape(blocks));
    });
  }

  test("모든 블록 종류가 한 페이지에서 순서와 깊이를 지킨다", () => {
    const page = Object.values(cases).join("\n\n");
    const blocks = markdownToBlocks(page);
    expect(new Set(blocks.map(b => b.type)).size).toBe(27);
    const again = markdownToBlocks(blocksToMarkdown(blocks));
    expect(shape(again)).toEqual(shape(blocks));
    expect(blocksToMarkdown(again)).toBe(blocksToMarkdown(blocks));
  });

  test("양식으로 만든 다이어그램·차트·표·이미지는 마크다운으로 갔다 와도 같고 양식으로 다시 열린다", async () => {
    const forms = await import("../editor-next/visual-forms.js");
    const blocks: Parameters<typeof blocksToMarkdown>[0] = [];
    for (const k of forms.DIAGRAM_KINDS) blocks.push({ id: k.kind, type: "diagram", text: forms.diagramToText(k.kind, k.sample) });
    blocks.push({ id: "c", type: "chart", text: forms.chartToText({ type: "line", title: "월별", labels: ["1월", "2월"], series: [{ name: "매출", data: [1200, null] }] }), meta: { caption: "매출" } });
    blocks.push({ id: "t", type: "table", text: "", meta: { columns: ["월", "매출"], rows: [["1월", "1,200"], ["2월", "900"]], header: true } });
    blocks.push({ id: "i", type: "image", text: "사진 설명", meta: { src: "/media/x", width: 60 } });
    const again = markdownToBlocks(blocksToMarkdown(blocks));
    expect(again.map((b) => b.type)).toEqual(["diagram", "diagram", "diagram", "diagram", "diagram", "chart", "table", "image"]);
    again.slice(0, 5).forEach((b, i) => expect(forms.diagramFromText(b.text)?.kind).toBe(forms.DIAGRAM_KINDS[i].kind));
    expect(forms.chartFromText(again[5].text)?.series[0].data).toEqual([1200, null]);
    expect(again[6].meta?.rows).toEqual([["1월", "1,200"], ["2월", "900"]]);
    expect(again[7].meta).toEqual({ src: "/media/x", width: 60 });
    expect(blocksToMarkdown(again)).toBe(blocksToMarkdown(blocks));
  });

  test("양식이 못 읽는 손으로 쓴 그림은 양식으로 열지 않는다", async () => {
    const forms = await import("../editor-next/visual-forms.js");
    expect(forms.diagramFromText("flowchart LR\n  A[시작] --> B{확인}\n  B -->|예| C[끝]")).toBeNull();
    expect(forms.chartFromText('{"type":"bar","labels":["a"],"series":[{"name":"x","data":["문자"]}]}')).toBeNull();
  });

  test("편집기 서식은 읽기 화면이 아는 굵게·코드·링크로 내보낸다", () => {
    const md = blocksToMarkdown([{ id: "a", type: "paragraph", text: "오늘 결정 infra", meta: { richText: [
      { text: "오늘 " }, { text: "결정", bold: true }, { text: " " }, { text: "infra", mention: { type: "page", slug: "infra" } },
    ] } }]);
    expect(md).toBe("오늘 **결정** [infra](/infra/)");
  });
});

describe("blockLinks", () => {
  test("[[슬러그]] 와 마크다운 링크를 모두 찾는다", () => {
    const blocks = markdownToBlocks("[[infra]] 를 보고 [결정](/decisions/) 도 봐");
    expect(blockLinks(blocks).sort()).toEqual(["decisions", "infra"]);
  });

  test("바깥 링크는 무시한다", () => {
    const blocks = markdownToBlocks("[노션](https://notion.so) 만 있음");
    expect(blockLinks(blocks)).toEqual([]);
  });
});
