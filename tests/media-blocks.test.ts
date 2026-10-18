import { describe, expect, test } from "bun:test";
import { markdownToBlocks } from "../markdown-blocks.ts";
import { renderBlocks } from "../block-html.js";

describe("markdownToBlocks: 미디어·레이아웃 블록", () => {
  test("이미지 한 줄은 캡션과 폭을 기억한다", () => {
    const blocks = markdownToBlocks('![서울 야경](/media/abc "60")\n\n![없는 폭](https://x.test/i.png)');
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].text).toBe("서울 야경");
    expect(blocks[0].meta).toEqual({ src: "/media/abc", width: 60 });
    expect(blocks[1].meta.width).toBe(100);
  });

  test("한 줄 미디어 블록들", () => {
    const blocks = markdownToBlocks([
      "- [video] https://youtu.be/dQw4w9WgXcQ",
      "- [audio] /media/s1",
      "- [file] /media/f1 업무계획서.pdf",
      "- [embed] https://codepen.io/x",
      "- [bookmark] https://example.com",
      "- [toc]",
      "- [breadcrumb]",
    ].join("\n"));
    expect(blocks.map((b) => b.type)).toEqual(["video", "audio", "file", "embed", "bookmark", "toc", "breadcrumb"]);
    expect(blocks[0].meta.url).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(blocks[2].text).toBe("업무계획서.pdf");
    expect(blocks[2].meta).toEqual({ url: "/media/f1", name: "업무계획서.pdf" });
  });

  test("버튼은 라벨과 주소를 나누고 진행률은 값을 0~100 으로 묶는다", () => {
    const blocks = markdownToBlocks("- [button] 시작하기 | https://example.com\n\n- [progress] 170 과한 값");
    expect(blocks[0].type).toBe("button");
    expect(blocks[0].text).toBe("시작하기");
    expect(blocks[0].meta.url).toBe("https://example.com");
    expect(blocks[1].meta.value).toBe(100);
  });

  test("주소만 있는 줄은 북마크가 되고 문단은 거기서 끊긴다", () => {
    const blocks = markdownToBlocks("앞 문장\nhttps://example.com/a\n뒷 문장");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "bookmark", "paragraph"]);
    expect(blocks[1].meta.url).toBe("https://example.com/a");
  });

  test("$$ 겉치장은 수식 블록이 된다", () => {
    const blocks = markdownToBlocks("$$\nE = mc^2\n$$");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("equation");
    expect(blocks[0].text).toBe("E = mc^2");
  });

  test(":::cols 는 --- 로 열을 나누고 2~3열로 묶는다", () => {
    const blocks = markdownToBlocks(":::cols\n첫째\n---\n둘째\n---\n셋째\n---\n넷째\n:::");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("columns");
    expect(blocks[0].meta.columns).toEqual([
      { text: "첫째" }, { text: "둘째" }, { text: "셋째\n넷째" },
    ]);
  });

  test("=== 구분 표는 간단 표, --- 구분 표는 데이터베이스다", () => {
    const simple = markdownToBlocks("| 열1 | 열2 |\n| === | === |\n| a | b |");
    expect(simple[0].type).toBe("table");
    expect(simple[0].meta).toEqual({ columns: ["열1", "열2"], rows: [["a", "b"]], header: true });
    const db = markdownToBlocks("| 열1 | 열2 |\n| --- | --- |\n| a | b |");
    expect(db[0].type).toBe("database");
  });
});

describe("renderBlocks: 미디어·레이아웃 블록", () => {
  const parse = (md: string) => renderBlocks(markdownToBlocks(md));

  test("이미지는 폭과 캡션과 크게 보기 링크를 그린다", () => {
    const html = parse('![서울](/media/abc "60")');
    expect(html).toContain('style="width:60%"');
    expect(html).toContain('<a class="imgview" href="/media/abc">');
    expect(html).toContain("<figcaption>서울</figcaption>");
  });

  test("유튜브 주소는 nocookie iframe 이 되고 파일 주소는 video 태그가 된다", () => {
    const html = parse("- [video] https://youtu.be/dQw4w9WgXcQ\n\n- [video] /media/clip.mp4");
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(html).toContain('<video controls preload="metadata" src="/media/clip.mp4">');
  });

  test("임베드는 허용 목록 밖 주소를 iframe 으로 넣지 않는다", () => {
    const ok = parse("- [embed] https://codepen.io/x");
    expect(ok).toContain("<iframe");
    const bad = parse("- [embed] https://evil.example/x");
    expect(bad).not.toContain("<iframe");
    expect(bad).toContain("여기에 넣을 수 없는 주소예요");
  });

  test("북마크와 파일 카드를 그린다", () => {
    const html = parse("https://example.com\n\n- [file] /media/f1 계획서.pdf");
    expect(html).toContain('<a class="bookmark" href="https://example.com"');
    expect(html).toContain('class="filecard"');
    expect(html).toContain("계획서.pdf");
  });

  test("열 나누기와 간단 표를 그린다", () => {
    const html = parse(":::cols\n가\n---\n나\n:::\n\n| 열1 | 열2 |\n| === | === |\n| 1 | 2 |");
    expect(html).toContain('<div class="cols cols2">');
    expect(html).toContain("<p>가</p>");
    expect(html).toContain('<div class="stable" tabindex="0" role="region"');
    expect(html).toContain('</svg>열1</span></th>');
    expect(html).toContain("<td>1</td>");
  });

  test("목차 블록은 제목보다 앞에 있어도 같은 id 로 걸린다", () => {
    const html = parse("- [toc]\n\n## 첫 절\n\n### 더하기");
    expect(html).toContain('<nav class="tocblock"><details open><summary><h3>목차</h3> <span class="tcount">2</span></summary><ul><li class="lvl3"><a href="#첫-절">첫 절</a></li><li class="lvl4"><a href="#더하기">더하기</a></li>');
    expect(html).toContain('<h3 id="첫-절">');
  });

  test("제목이 12개를 넘는 목차는 하위 제목을 접는다", () => {
    const steps = Array.from({ length: 12 }, (_, i) => "### 단계 " + (i + 1)).join("\n\n");
    const html = parse("- [toc]\n\n## 개요\n\n## 단계별 상세\n\n" + steps + "\n\n## 배운 점");
    expect(html).toContain('<li class="lvl3"><a href="#개요">개요</a></li>');
    expect(html).toContain('<li class="lvl3 tocgrp"><details><summary><a href="#단계별-상세">단계별 상세</a> <span class="tcount">12</span></summary><ul><li class="lvl4"><a href="#단계-1">단계 1</a></li>');
    expect(html).toContain('</ul></details></li><li class="lvl3"><a href="#배운-점">배운 점</a></li>');
  });

  test("이동 경로는 부모 체인을 그린다", () => {
    const pages = [
      { slug: "index", title: "홈", parent: null },
      { slug: "projects", title: "프로젝트", parent: "index" },
      { slug: "akanesasu", title: "아카네사스", parent: "projects" },
    ];
    const html = renderBlocks(markdownToBlocks("- [breadcrumb]"), { page: pages[2], pages });
    expect(html).toContain('<nav class="crumbs"><a href="/">홈</a><span class="sep"');
    expect(html.indexOf("프로젝트")).toBeLessThan(html.indexOf("아카네사스"));
  });

  test("버튼과 진행률 막대를 그린다", () => {
    const html = parse("- [button] 시작하기 | https://example.com\n\n- [progress] 70 완료율");
    expect(html).toContain('<a class="btn" href="https://example.com">시작하기</a>');
    expect(html).toContain('aria-valuenow="70"');
    expect(html).toContain('style="width:70%"');
  });

  test("수식은 이스케이프되고 모르는 커맨드는 남는다", () => {
    const html = parse("$$\n\\frac{a}{b} <script>alert(1)</script>\n$$");
    expect(html).not.toContain("<script>");
    expect(html).toContain('class="mfrac"');
    expect(html).toContain("&lt;script&gt;");
  });

  test("주소가 없는 미디어 블록은 아무것도 그리지 않는다", () => {
    expect(parse("- [video]\n\n- [bookmark]\n\n- [button] 라벨")).toBe("");
  });
});
