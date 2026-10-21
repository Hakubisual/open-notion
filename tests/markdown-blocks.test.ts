import { describe, expect, test } from "bun:test";
import { acardMarkdown, acardMetaDocument, blockLinks, blocksToMarkdown, markdownToBlocks } from "../markdown-blocks.ts";

describe("markdownToBlocks", () => {
  test("중첩 토글 문단 제목 목록의 왕복은 깊이를 보존한다", () => {
    const input = "- [toggle] 부모\n\n  자식 문단\n\n  ## 자식 제목\n\n  - 목록\n    - 손자\n\n다음";
    const blocks = markdownToBlocks(input);
    expect(blocks.map(b => b.indent)).toEqual([0, 1, 1, 1, 2, 0]);
    expect(markdownToBlocks(blocksToMarkdown(blocks)).map(({type, text, indent}) => ({type, text, indent})))
      .toEqual(blocks.map(({type, text, indent}) => ({type, text, indent})));
  });
  test("제목은 단계별 블록이 된다", () => {
    // notion-parity C16: #### is heading 4; ##### and ###### have no own level and become heading 4.
    const blocks = markdownToBlocks("# 하나\n## 둘\n### 셋\n#### 넷\n##### 다섯\n###### 여섯");
    expect(blocks.map((b) => b.type)).toEqual(["heading1", "heading2", "heading3", "heading4", "heading4", "heading4"]);
    expect(blocksToMarkdown([blocks[3]])).toBe("#### 넷");
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
    heading4: "#### 가장 작은 제목",
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
    expect(new Set(blocks.map(b => b.type)).size).toBe(29); // columns brings column (notion-parity C13)
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

  test("번호 목록은 읽기 화면과 같은 1. 2. 3. 번호로 내보내고, 다른 블록이 끼면 다시 1부터 센다", () => {
    const md = "1. 가\n1. 나\n  1. 안쪽\n  1. 안쪽 둘\n1. 다\n\n## 제목\n\n1. 새 목록";
    expect(blocksToMarkdown(markdownToBlocks(md))).toBe("1. 가\n\n2. 나\n\n  1. 안쪽\n\n  2. 안쪽 둘\n\n3. 다\n\n## 제목\n\n1. 새 목록");
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

describe("부품 블록 (#38)", () => {
  test("부품 다섯 개와 글이 섞인 페이지가 마크다운 -> 블록 -> 마크다운으로 그대로 돌아온다", () => {
    const F = "```";
    const md = [
      "# 주간 현황",
      F + 'acard-part {"part":"badge","v":1}\n{"items":[{"label":"끝난 일","value":12,"of":16,"state":"ok"}]}\n' + F,
      F + 'acard-part {"part":"table","v":1,"caption":"비용"}\n{"columns":["모델","비용"],"rows":[["a",1.5],["b|c",2]],"sum":[1],"ratio":1}\n' + F,
      "중간 문단",
      F + 'acard-part {"part":"chart","v":1}\n{"labels":["월"],"series":[{"data":[null]}]}\n' + F,
      F + 'acard-part {"part":"heatmap","v":1,"height":240}\n{"rows":["월"],"cols":["9시"],"values":[[1]]}\n' + F,
      "- 목록\n\n  " + F + 'acard-part {"part":"dag","v":1}\n  {"nodes":[{"id":"a","label":"</script>"}]}\n  ' + F,
    ].join("\n\n");
    const blocks = markdownToBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["heading1", "part", "part", "paragraph", "part", "part", "bulleted", "part"]);
    expect(blocks.filter((b) => b.type === "part").map((b) => b.meta?.part)).toEqual(["badge", "table", "chart", "heatmap", "dag"]);
    expect(blocks[7].indent).toBe(1);
    expect(JSON.parse(blocks[7].text).nodes[0].label).toBe("</script>");
    expect(blocksToMarkdown(blocks)).toBe(md);
    const again = markdownToBlocks(blocksToMarkdown(blocks));
    expect(again.map(({ type, text, meta, indent }) => ({ type, text, meta, indent }))).toEqual(blocks.map(({ type, text, meta, indent }) => ({ type, text, meta, indent })));
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

describe("block meta comment lines (notion-parity C6 C7 C11)", () => {
  const shape = (blocks: ReturnType<typeof markdownToBlocks>) =>
    blocks.map(({ type, text, indent, checked, meta }) => ({ type, text, indent: indent || 0, checked: !!checked, meta: meta ?? null }));
  const b = (type: string, text: string, extra: Record<string, unknown> = {}) => ({ id: "x", type, text, indent: 0, ...extra }) as any;
  const styled = [
    b("paragraph", "빨간 글", { meta: { color: "red" } }),
    b("heading4", "소제목", { meta: { color: "blue_background" } }),
    b("bulleted", "목록", { meta: { color: "green" } }),
    b("bulleted", "안쪽", { indent: 1, meta: { color: "pink_background" } }),
    b("to_do", "할 일", { checked: true, meta: { color: "purple" } }),
    b("code", "let a = 1;\n<!--acard {\"color\":\"red\"}-->", { meta: { lang: "js", color: "gray_background" } }),
    b("table", "재료 | 양", { meta: { columns: ["재료", "양"], rows: [["밀", "1"]], header: true, color: "yellow_background" } }),
    b("image", "사진", { meta: { src: "/media/abc", width: 60, color: "brown" } }),
    b("divider", "", { meta: { color: "red" } }),
    b("callout", "불 조심\n둘째 줄", { meta: { tone: "warn", icon: "🔥", color: "orange_background" } }),
    b("embed", "", { meta: { url: "https://x.github.io/w", height: 480 } }),
    b("heading2", "접히는 제목", { meta: { toggle: true, open: false } }),
    b("paragraph", "자식 하나", { indent: 1 }),
    b("paragraph", "자식 둘", { indent: 1, meta: { color: "red" } }),
    b("heading3", "열린 접는 제목", { meta: { toggle: true, open: true } }),
    b("paragraph", "그냥 글"),
  ];
  test("every styled block comes back with the same type, text, meta and indent", () => {
    const md = blocksToMarkdown(styled, { meta: true });
    expect(md).toContain('> [!warn] 불 조심\n> 둘째 줄\n<!--acard {"color":"orange_background","icon":"🔥"}-->');
    expect(md).toContain('  - 안쪽\n  <!--acard {"color":"pink_background"}-->');
    expect(shape(markdownToBlocks(md, { meta: true }))).toEqual(shape(styled));
    expect(blocksToMarkdown(markdownToBlocks(md, { meta: true }), { meta: true })).toBe(md);
  });
  test("blocks without meta write exactly what they wrote before, with or without the flag", () => {
    const plain = markdownToBlocks("# 제목\n\n문단\n\n- 항목\n\n> [!note] 메모\n\n- [embed] https://codepen.io/x\n\n- [progress] 70 진행");
    expect(blocksToMarkdown(plain, { meta: true })).toBe(blocksToMarkdown(plain));
    expect(blocksToMarkdown(styled).match(/<!--acard/g)!.length).toBe(1); // only the code text itself
  });
  test("without the flag a meta comment stays text, as it always did", () => {
    const md = 'hello\n<!--acard {"color":"red"}-->';
    const blocks = markdownToBlocks(md);
    expect(blocks.map((x) => [x.type, x.text, x.meta ?? null])).toEqual([["paragraph", 'hello <!--acard {"color":"red"}-->', null]]);
  });
  test("that text block survives a flagged export and import as the same text", () => {
    const blocks = markdownToBlocks('<!--acard {"color":"red"}-->\n\n\\<!--acard x-->');
    const again = markdownToBlocks(blocksToMarkdown(blocks, { meta: true }), { meta: true });
    expect(again.map((x) => [x.type, x.text, x.meta ?? null])).toEqual(blocks.map((x) => [x.type, x.text, x.meta ?? null]));
  });
  test("curly text and bad comments are text or ignored, never a throw", () => {
    expect(markdownToBlocks("가격 {color=red}", { meta: true }).map((x) => [x.text, x.meta ?? null])).toEqual([["가격 {color=red}", null]]);
    const bad = markdownToBlocks('글\n<!--acard {"color":"chartreuse"}-->\n\n둘\n<!--acard {broken-->', { meta: true });
    expect(bad.every((x) => !x.meta)).toBe(true);
    const odd = markdownToBlocks('글\n<!--acard {"color":"red","icon":"<b>","height":"9","onclick":"x","toggle":"yes"}-->', { meta: true });
    expect(odd.map((x) => x.meta)).toEqual([{ color: "red", icon: "<b>" }]);
    expect(markdownToBlocks('<!--acard {"color":"red"}-->', { meta: true }).map((x) => x.type)).toEqual(["paragraph"]);
  });
  test("button actions round-trip in a flagged document, only on a button, and a malformed list is dropped (notion-parity C3)", () => {
    const actions = [
      { type: "confirm", message: "추가할까요?" },
      { type: "create_row", database: "todo", template: "t1", values: { p3: { relative: "today" }, p4: { ref: "row" } } },
      { type: "open", target: "created" },
    ];
    const blocks = [
      { id: "a", type: "button", text: "할 일 추가", checked: false, indent: 0, meta: { actions, icon: "➕", color: "blue" } },
      { id: "b", type: "button", text: "이동", checked: false, indent: 0, meta: { url: "https://example.com" } },
    ] as Parameters<typeof blocksToMarkdown>[0];
    const md = blocksToMarkdown(blocks, { meta: true });
    expect(md).toContain("- [button] 할 일 추가\n<!--acard ");
    expect(md).toContain("- [button] 이동 | https://example.com");
    const back = markdownToBlocks(md, { meta: true });
    expect(back[0].meta).toEqual({ url: "", color: "blue", icon: "➕", actions: [actions[0], actions[1], actions[2]] });
    expect(back[1].meta).toEqual({ url: "https://example.com" });
    expect(blocksToMarkdown(blocks)).not.toContain("<!--acard");
    const plain = markdownToBlocks('- [button] x\n<!--acard {"actions":[{"type":"create_row","database":"d"}]}-->');
    expect(plain[0].meta).toEqual({ url: "" });
    expect(plain.length).toBe(2);
    const bad = markdownToBlocks('- [button] x\n<!--acard {"actions":[{"type":"send_mail","to":"a@b.c"}],"color":"red"}-->', { meta: true });
    expect(bad[0].meta).toEqual({ url: "", color: "red" });
    const onParagraph = markdownToBlocks('글\n<!--acard {"actions":[{"type":"create_row","database":"d"}]}-->', { meta: true });
    expect(onParagraph[0].meta?.actions).toBeUndefined();
  });
  test("acard-md documents carry the flag and title; other front matter is left alone", () => {
    const doc = acardMarkdown('제목 "따옴"', styled);
    const parsed = acardMetaDocument(doc);
    expect(parsed.flagged).toBe(true);
    expect(parsed.title).toBe('제목 "따옴"');
    expect(shape(markdownToBlocks(parsed.body, { meta: true }))).toEqual(shape(styled));
    expect(acardMetaDocument("---\ntitle: x\n---\n본문").flagged).toBe(false);
    expect(acardMetaDocument("본문").body).toBe("본문");
  });
});


describe("columns as marker lines (notion-parity C13)", () => {
  const B = (id: string, type: any, indent: number, text = "", meta: any = undefined) => ({ id, type, text, indent, ...(meta ? { meta } : {}) });
  const tree = (blocks: any[]) => blocks.map((b) => b.type + ":" + (b.indent || 0) + (b.text ? ":" + b.text : "") + (b.meta && b.meta.widths ? ":" + JSON.stringify(b.meta.widths) : ""));
  const two = [
    B("cs", "columns", 0, "", { widths: [0.6, 0.4] }),
    B("c1", "column", 1), B("co", "callout", 2, "안내"), B("l1", "bulleted", 3, "하나"), B("l2", "bulleted", 4, "둘"),
    B("c2", "column", 1), B("h", "heading2", 2, "오른쪽 제목"), B("d", "db_ref", 2, "", { database: "board" }),
    B("after", "paragraph", 0, "밖"),
  ];
  test("two columns (callout with a two-level list, heading + db_ref) round trip with relative indents", () => {
    const md = blocksToMarkdown(two, { meta: true });
    expect(md).toContain('<!--acard columns {"widths":[0.6,0.4]}-->');
    expect(md).toContain("<!--acard column-->\n\n> [!note] 안내\n\n  - 하나\n\n    - 둘");
    expect(md).toContain("<!--acard /columns-->\n\n밖");
    expect(tree(markdownToBlocks(md, { meta: true }))).toEqual(tree(two));
  });
  test("old text-only columns and old :::cols markdown both come out as column blocks and marker lines", () => {
    const old = [B("k", "columns", 0, "", { columns: [{ text: "가\n나" }, { text: "다" }] })];
    const md = blocksToMarkdown(old, { meta: true });
    expect(md).toBe('<!--acard columns {"widths":[0.5,0.5]}-->\n\n<!--acard column-->\n\n가\n\n나\n\n<!--acard column-->\n\n다\n\n<!--acard /columns-->');
    const fromCols = markdownToBlocks(":::cols\n가\n나\n---\n다\n:::");
    expect(tree(fromCols)).toEqual(["columns:0:[0.5,0.5]", "column:1", "paragraph:2:가", "paragraph:2:나", "column:1", "paragraph:2:다"]);
    expect(blocksToMarkdown(fromCols, { meta: true })).toBe(md);
  });
  test("an unclosed marker stays text and does not throw", () => {
    const blocks = markdownToBlocks("<!--acard columns-->\n\n가\n\n<!--acard column-->", { meta: true });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(blocks[0].text).toBe("<!--acard columns-->");
  });
  test("without the acard_meta flag marker lines are plain text", () => {
    const blocks = markdownToBlocks("<!--acard columns-->\n\n가\n\n<!--acard /columns-->");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });
  test("a text line that is a marker is escaped on write and stays text", () => {
    const blocks = [B("p", "paragraph", 0, "<!--acard column-->")];
    const md = blocksToMarkdown(blocks, { meta: true });
    expect(md).toBe("\\<!--acard column-->");
    expect(markdownToBlocks(md, { meta: true }).map((b) => b.type + ":" + b.text)).toEqual(["paragraph:<!--acard column-->"]);
  });
  test("without the flag, simple text columns go back to :::cols and other columns write their blocks one after another", () => {
    expect(blocksToMarkdown(markdownToBlocks(":::cols\n왼\n---\n오\n:::"))).toBe(":::cols\n왼\n---\n오\n:::");
    expect(blocksToMarkdown(two)).toBe("> [!note] 안내\n\n  - 하나\n\n    - 둘\n\n## 오른쪽 제목\n\n- [db_ref] board\n\n밖");
  });
});
