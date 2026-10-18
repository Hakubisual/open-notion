import { describe, expect, test } from "bun:test";
import { markdownToBlocks, type Block } from "../markdown-blocks.ts";
import { notionBlocksToMarkdown, pageToHtml, workspaceToZip } from "../notion-export.ts";

const b = (type: Block["type"], text: string, extra: Partial<Block> = {}): Block => ({
  id: "x",
  type,
  text,
  ...extra,
});

// 비트 단위로 직접 계산하는 느린 CRC-32 (표 없이) - 구현과 독립된 기준값
function slowCrc(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readCentral(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const out: { name: string; crc: number; method: number; flags: number; size: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const nameLen = view.getUint16(pos + 28, true);
    out.push({
      name: new TextDecoder().decode(zip.slice(pos + 46, pos + 46 + nameLen)),
      crc: view.getUint32(pos + 16, true),
      method: view.getUint16(pos + 10, true),
      flags: view.getUint16(pos + 8, true),
      size: view.getUint32(pos + 24, true),
    });
    pos += 46 + nameLen;
  }
  return out;
}

describe("notionBlocksToMarkdown", () => {
  test("각 블록 종류가 기대한 마크다운으로 나온다", () => {
    const md = notionBlocksToMarkdown("제목", [
      b("heading1", "하나"),
      b("heading2", "둘"),
      b("heading3", "셋"),
      b("paragraph", "본문"),
      b("bulleted", "항목"),
      b("numbered", "순서"),
      b("to_do", "할 일"),
      b("to_do", "한 일", { checked: true }),
      b("toggle", "접기"),
      b("callout", "주의\n둘째 줄", { meta: { tone: "warn" } }),
      b("callout", "기본"),
      b("quote", "인용\n이어서"),
      b("code", "const a = 1;", { meta: { lang: "ts" } }),
      b("divider", ""),
    ]);
    expect(md.startsWith("# 제목\n\n")).toBe(true);
    for (const line of [
      "# 하나",
      "## 둘",
      "### 셋",
      "본문",
      "- 항목",
      "1. 순서",
      "- [ ] 할 일",
      "- [x] 한 일",
      "- [toggle] 접기",
      "> [!warn] 주의\n> 둘째 줄",
      "> [!note] 기본",
      "> 인용\n> 이어서",
      "```ts\nconst a = 1;\n```",
      "---",
    ]) {
      expect(md).toContain(line);
    }
  });

  test("들여쓰기가 중첩 글머리표에서 보존된다", () => {
    const md = notionBlocksToMarkdown("t", [b("bulleted", "부모"), b("bulleted", "자식", { indent: 2 })]);
    expect(md).toContain("- 부모\n    - 자식");
    const back = markdownToBlocks(md);
    expect(back[2].indent).toBe(2);
  });

  test("혼합 문서가 markdownToBlocks를 거쳐도 타입과 텍스트가 같다", () => {
    const blocks: Block[] = [
      b("heading2", "개요"),
      b("paragraph", "첫 문단"),
      b("bulleted", "가"),
      b("numbered", "나"),
      b("to_do", "다", { checked: true }),
      b("toggle", "라"),
      b("callout", "마\n바", { meta: { tone: "tip" } }),
      b("quote", "사"),
      b("code", "a\n\nb", { meta: { lang: "py" } }),
      b("divider", ""),
      b("paragraph", "끝"),
    ];
    const back = markdownToBlocks(notionBlocksToMarkdown("문서", blocks));
    expect(back[0]).toMatchObject({ type: "heading1", text: "문서" });
    const rest = back.slice(1);
    expect(rest.map((x) => x.type)).toEqual(blocks.map((x) => x.type));
    expect(rest.map((x) => x.text)).toEqual(blocks.map((x) => x.text));
  });

  test("데이터베이스가 파이프 표로 왕복한다", () => {
    const db = b("database", "이름 | 상태", {
      meta: {
        columns: ["이름", "상태"],
        rows: [
          { 이름: "A", 상태: "진행" },
          { 이름: "B", 상태: "완료" },
        ],
      },
    });
    const md = notionBlocksToMarkdown("t", [db]);
    expect(md).toContain("| 이름 | 상태 |\n| --- | --- |\n| A | 진행 |\n| B | 완료 |");
    const back = markdownToBlocks(md)[1];
    expect(back.type).toBe("database");
    expect(back.meta).toEqual(db.meta);
  });

  test("셀 안의 |는 \\|로 이스케이프되어 표를 깨지 않는다", () => {
    const db = b("database", "", { meta: { columns: ["식"], rows: [{ 식: "a|b" }] } });
    const md = notionBlocksToMarkdown("t", [db]);
    expect(md).toContain("| a\\|b |");
    const rows = md.split("\n").filter((l) => l.startsWith("|"));
    expect(rows).toHaveLength(3);
  });
});

describe("pageToHtml", () => {
  test("스크립트와 외부 참조가 없고 제목이 들어간다", () => {
    const html = pageToHtml({
      title: "도리 노트 <1>",
      blocks: [b("heading2", "소제목"), b("paragraph", "본문"), b("code", "x", { meta: { lang: "js" } })],
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="ko"');
    expect(html).toContain("<h1>도리 노트 &lt;1&gt;</h1>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<link");
  });
});

describe("workspaceToZip", () => {
  const pages = [
    { slug: "a", title: "첫 페이지", blocks: [b("paragraph", "안녕")] },
    { slug: "b", title: "둘째", blocks: [b("bulleted", "항목")] },
  ];

  test("PK 로컬 헤더로 시작하고 중앙 디렉터리에 이름과 CRC가 맞게 나열된다", () => {
    const zip = workspaceToZip(pages);
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const entries = readCentral(zip);
    expect(entries.map((e) => e.name)).toEqual(["index.md", "a.md", "b.md"]);
    const enc = new TextEncoder();
    const index = enc.encode("# 목차\n\n- [첫 페이지](./a.md)\n- [둘째](./b.md)\n");
    expect(entries[0].crc).toBe(slowCrc(index));
    expect(entries[0].size).toBe(index.length);
    const a = enc.encode(notionBlocksToMarkdown("첫 페이지", pages[0].blocks));
    expect(entries[1].crc).toBe(slowCrc(a));
    for (const e of entries) {
      expect(e.method).toBe(0);
      expect(e.flags & 0x0800).toBe(0x0800);
    }
  });

  test("CRC-32 표준 검증값(123456789 -> CBF43926)과 같은 알고리즘이다", () => {
    expect(slowCrc(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  test("같은 입력이면 같은 바이트가 나온다", () => {
    expect(workspaceToZip(pages)).toEqual(workspaceToZip(pages));
  });
});
