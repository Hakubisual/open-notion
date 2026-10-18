import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownToBlocks } from "../markdown-blocks.ts";
import { renderBlocks, navTree, introSplit } from "../block-html.js";

const ROOT = join(import.meta.dir, "..");

describe("renderBlocks", () => {
  test("source links have escaped stable anchors on paragraphs, headings and nested list items", () => {
    const html = renderBlocks([
      { id: 'p"1', type: "paragraph", text: "본문" },
      { id: "heading", type: "heading1", text: "제목" },
      { id: "parent", type: "bulleted", text: "부모" },
      { id: "child", type: "bulleted", text: "자식", indent: 1 },
    ]);
    expect(html).toContain('<span id="block-p&quot;1"></span>');
    expect(html).toContain('<span id="block-heading"></span>');
    expect(html).toContain('<h2 id="제목">');
    expect(html).toContain('<li><span id="block-parent"></span>부모<ul><li><span id="block-child"></span>자식</li></ul></li>');
  });
  test("토글과 목록의 자식은 부모 안에서 렌더링된다", () => {
    const html = renderBlocks(markdownToBlocks("- [toggle] 부모\n  - 자식\n    - 손자\n\n다음"));
    expect(html.replace(/<span id="block-[^"]*"><\/span>\n?/g, "")).toContain("<summary>부모</summary><ul><li>자식<ul><li>손자</li></ul></li></ul></details>");
    expect(html.indexOf("</details>")).toBeLessThan(html.indexOf("<p>다음</p>"));
  });
  test("제목에 목차가 가리킬 id를 붙인다", () => {
    const html = renderBlocks(markdownToBlocks("## 인프라 점검\n\n### 백업"));
    expect(html).toContain('<h3 id="인프라-점검">인프라 점검</h3>');
    expect(html).toContain('<h4 id="백업">백업</h4>');
  });

  test("같은 제목이 두 번이면 뒤엣것에 번호를 붙인다", () => {
    const html = renderBlocks(markdownToBlocks("## 메모\n\n## 메모"));
    expect(html).toContain('id="메모"');
    expect(html).toContain('id="메모-2"');
  });

  test("할 일은 체크 상태를 그대로 그린다", () => {
    const html = renderBlocks(markdownToBlocks("- [x] 끝난 일\n- [ ] 남은 일"));
    expect(html).toContain('<div class="todo on">');
    expect(html).toContain('<div class="todo">');
  });

  test("콜아웃과 토글과 표를 노션식 마크업으로 그린다", () => {
    const html = renderBlocks(markdownToBlocks("> [!tip] 먼저 볼 것\n\n- [toggle] 접기\n\n| 이름 | 상태 |\n| --- | --- |\n| 노트 | 진행 |"));
    expect(html).toContain('<div class="callout tip"><svg class="ico callout-ico"');
    expect(html).toContain('<div class="callout-body">먼저 볼 것</div></div>');
    expect(html).toContain('<details class="toggle"><summary>접기</summary></details>');
    expect(html).toContain("<table>");
    expect(html).toContain('<td><span class="tag table-status blue">진행</span></td>');
  });

  test("데이터베이스 표만 보기 도구를 표시하고 실제 담당자와 편집 주소를 유지한다", () => {
    const blocks = markdownToBlocks("| 프로젝트 | 상태 | 담당 |\n| --- | --- | --- |\n| 실제 작업 | 마무리 | 오너 |\n| 다음 작업 | 대기 | 도리 |");
    const html = renderBlocks(blocks, { page: { kind: "db", slug: "board" } });
    expect(html).toContain('class="table-toolbar"');
    expect(html).toContain('class="table-tab on"');
    expect(html).toContain('href="/edit/board/"');
    expect(html).toContain('class="tag table-status green"');
    expect(html).toContain('class="tag table-status purple"');
    expect(html).toContain('/img/avatars/owner-96.webp');
    expect(html).toContain('/img/avatars/dori-96.webp');
    expect(html.match(/<td class="table-select">/g)?.length).toBe(2);
    expect(html.match(/<th scope="col">/g)?.length).toBe(3);
    expect(renderBlocks(blocks, { page: { kind: "note", slug: "sample" } })).not.toContain('class="table-toolbar"');
  });

  test("마크다운 데이터베이스 표는 소개 영역 다음에 놓인다", () => {
    const blocks = markdownToBlocks("소개\n\n| 이름 | 상태 |\n| --- | --- |\n| 실제 작업 | 진행 |");
    const [intro, rest] = introSplit(blocks);
    expect(intro).toEqual([blocks[0]]);
    expect(rest).toEqual([blocks[1]]);
  });

  test("정적 프로젝트 표는 완료 상태와 진행률 및 날짜를 렌더링한다", () => {
    const blocks = markdownToBlocks("| 작업 이름 | 담당자 | 상태 | 우선순위 | 진행률 | 마감일 |\n| --- | --- | --- | --- | --- | --- |\n| 검증 | 도리 | 완료 | 높음 | 100 | 2026-11-30 |\n| 확인 | 오너 | 결정 필요 | 낮음 | 0 | |");
    const html = renderBlocks(blocks, { page: { kind: "db", slug: "board" } });
    expect(html).toContain('class="table-check on"');
    expect(html).toContain('class="numwrap complete"');
    expect(html).toContain('style="width:100%"');
    expect(html).toContain('class="tag pink"');
    expect(html).toContain('class="tag gray"');
    expect(html).toContain('2026년 11월 30일');
  });

  test("마크다운 문법이 글자로 새지 않는다", () => {
    const html = renderBlocks(markdownToBlocks("> [!note] 알림\n\n- [toggle] 접기"));
    expect(html).not.toContain("[!note]");
    expect(html).not.toContain("[toggle]");
  });

  test("[[슬러그]] 링크를 만든다", () => {
    const html = renderBlocks(markdownToBlocks("[[infra]] 도 봐"));
    expect(html).toContain('<a href="/infra/">infra</a>');
  });
});

describe("navTree", () => {
  test("부모-자식 순서를 지키고 현재 페이지만 표시한다", () => {
    const pages = [
      { slug: "index", title: "홈", parent: null, kind: "note" },
      { slug: "board", title: "현황", parent: null, kind: "db" },
      { slug: "child", title: "하위", parent: "board", kind: "note" },
    ];
    const html = navTree(pages, "board");
    expect(html).toContain('class="on" aria-current="page"');
    expect(html.indexOf("현황")).toBeLessThan(html.indexOf("하위"));
    expect(html).toContain('<span class="dbmark">표</span>');
  });
});

describe("worker renderer", () => {
  test("빌드가 만든 워커와 같은 렌더러를 쓴다", () => {
    const source = readFileSync(join(ROOT, "gate", "_worker.js"), "utf8");
    const shared = readFileSync(join(ROOT, "block-html.js"), "utf8");
    expect(source).toContain("//__BLOCK_HTML__");
    expect(source).not.toContain("function renderBlocks");
    const inlined = shared.replace(/^export /gm, "").trim();
    expect(source.replace("//__BLOCK_HTML__", inlined)).toContain("function renderBlocks(blocks");
  });
});

describe("home slug alias", () => {
  test("워커가 home 을 index 로 맞춘다", () => {
    const source = readFileSync(join(ROOT, "gate", "_worker.js"), "utf8");
    expect(source).toContain('function resolveSlug(slug)');
    expect(source).toContain('return slug === "home" ? "index" : slug;');
    expect(source.match(/resolveSlug\(/g).length).toBeGreaterThanOrEqual(4);
  });

  test("빌드가 /home/ 도 같이 만든다", async () => {
    const proc = Bun.spawnSync(["bun", "run", "build.ts"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(0);
    const home = await Bun.file(join(ROOT, "dist", "home", "index.html")).text();
    const index = await Bun.file(join(ROOT, "dist", "index.html")).text();
    expect(home).toBe(index);
    expect(home).toContain("Next up");
  }, 120000);
});
