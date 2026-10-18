import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let html: any;

beforeAll(async () => {
  // 워커가 함께 인라인하는 표 공통 헬퍼를 연결하고 모델과 렌더러를 이어 붙인다.
  const root = join(import.meta.dir, "..");
  const shared = 'import { ico, tableHeaderIcon, tablePersonHtml, tableHeadingHtml, tableNewHtml, tableDateHtml, tableProgressHtml } from ' + JSON.stringify(pathToFileURL(join(root, "block-html.js")).href) + ';\n';
  const source = shared + readFileSync(join(root, "db-model.js"), "utf8") + "\n" + readFileSync(join(root, "db-html.js"), "utf8") + "\nexport { dbCellHtml, dbNumberCell };\n";
  const dir = mkdtempSync(join(tmpdir(), "db-html-"));
  const file = join(dir, "assembled.mjs");
  writeFileSync(file, source);
  html = await import(pathToFileURL(file).href);
});

const NOW = Date.UTC(2026, 9, 15);
const props = (extra: any[] = []) => [
  { id: "t", name: "이름", type: "title", config: {} },
  ...extra,
];
const row = (id: string, values: any, page: string | null = "page-" + id) => ({ id, page, ord: 0, values });

describe("row links", () => {
  test("every view links rows through row.page, never row.id", () => {
    const properties = props([{ id: "d", name: "날짜", type: "date", config: {} }]);
    const rows = [row("r1", { t: "A", d: { start: "2026-10-10" } }, "pg one")];
    const ctx = { now: NOW };
    const view = { id: "v", type: "x", config: {} };
    for (const fn of ["databaseTableHtml", "databaseGalleryHtml", "databaseListHtml", "databaseCalendarHtml", "databaseTimelineHtml"]) {
      const out = html[fn](properties, rows, view, ctx);
      expect(out).toContain('href="/edit/pg%20one/"');
      expect(out).not.toContain("/edit/r1/");
    }
  });

  test("rows without a page are not linked", () => {
    const out = html.databaseCalendarHtml(props([{ id: "d", name: "d", type: "date", config: {} }]), [row("r1", { t: "A", d: { start: "2026-10-10" } }, null)], { config: {} }, { now: NOW });
    expect(out).not.toContain("/edit/");
  });
});

describe("urls and files", () => {
  const cell = (type: string, value: any) => html.dbCellHtml({ id: "p", name: "p", type, config: {} }, value, {});

  test("javascript: and data: urls are never emitted as href", () => {
    expect(cell("url", "javascript:alert(1)")).not.toContain("href");
    expect(cell("url", "  JaVaScRiPt:alert(1)")).not.toContain("href");
    expect(cell("url", "//evil.example")).not.toContain("href");
    expect(cell("url", "https://ok.example/a")).toContain('href="https://ok.example/a"');
    expect(cell("url", "/relative/path")).toContain('href="/relative/path"');
  });

  test("email and phone only get mailto/tel hrefs", () => {
    expect(cell("email", "a@b.com")).toContain('href="mailto:a@b.com"');
    expect(cell("email", 'x"><script>')).not.toContain("<script>");
    expect(cell("phone", "+82 10-1234-5678")).toContain('href="tel:+82 10-1234-5678"');
    expect(cell("phone", "javascript:1")).not.toContain("href");
  });

  test("files: non-images listed with names, unsafe ones dropped", () => {
    const out = cell("files", [
      { name: "a.png", url: "https://x.test/a.png", type: "image/png" },
      { name: "report.pdf", url: "/files/report.pdf", type: "application/pdf" },
      { name: "evil.svg", url: "data:image/svg+xml,<svg onload=alert(1)>", type: "image/svg+xml" },
      { name: "js", url: "javascript:alert(1)" },
      { name: "s.svg", url: "https://x.test/s.svg", type: "image/svg+xml" },
    ]);
    expect(out).toContain('<img src="https://x.test/a.png"');
    expect(out).toContain(">report.pdf</a>");
    expect(out).not.toContain("data:");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img src=\"https://x.test/s.svg\"");
    expect(out).toContain(">s.svg</a>");
  });
});

describe("formula and numbers", () => {
  const f = { id: "f", name: "f", type: "formula", config: {} };
  test("false and 0 are displayed", () => {
    expect(html.dbCellHtml(f, false, {})).toContain("false");
    expect(html.dbCellHtml(f, 0, {})).toContain("0");
    expect(html.dbCellHtml(f, "", {})).toBe("");
  });

  test("bar scaling follows config.max, percent uses 1, number uses 100", () => {
    const n = (config: any, value: number) => html.dbNumberCell({ id: "n", name: "n", type: "number", config: Object.assign({ display: "bar" }, config) }, value);
    expect(n({ max: 200 }, 50)).toContain("width:25%");
    expect(n({ number_format: "percent" }, 0.5)).toContain("width:50%");
    expect(n({}, 50)).toContain("width:50%");
  });
});

describe("view selection, filter, order, calculations", () => {
  const properties = props([{ id: "n", name: "수", type: "number", config: {} }]);
  const rows = [row("a", { t: "Alpha", n: 3 }), row("b", { t: "Beta", n: 10 }), row("c", { t: "Gamma", n: 7 })];
  const views = [
    { id: "v1", name: "전체", type: "table", config: { sorts: [{ property: "n", direction: "descending" }], calculations: { n: "sum" } } },
    { id: "v2", name: "큰 것", type: "table", config: { filter: { property: "n", operator: "greater_than", value: 5 }, sorts: [{ property: "n", direction: "ascending" }] } },
  ];

  test("defaults to first view and sorts", () => {
    const out = html.databaseHtml(properties, rows, views, { now: NOW });
    expect(out.indexOf("Beta")).toBeLessThan(out.indexOf("Gamma"));
    expect(out.indexOf("Gamma")).toBeLessThan(out.indexOf("Alpha"));
    expect(out).toMatch(/<button type="button" role="tab" aria-selected="true" class="dbtab on" data-view="table"><svg[^>]*>[\s\S]*?<\/svg>전체<\/button>/);
  });

  test("viewId selects view, filtering and ordering rows", () => {
    const out = html.databaseHtml(properties, rows, views, { now: NOW, viewId: "v2" });
    expect(out).not.toContain("Alpha");
    expect(out.indexOf("Gamma")).toBeLessThan(out.indexOf("Beta"));
    expect(out).toContain("2행");
  });

  test("calculation is rendered once, in the footer only", () => {
    const out = html.databaseHtml(properties, rows, views, { now: NOW });
    expect(out.split("<tfoot>").length).toBe(2);
    expect(out).not.toContain("thcalc");
    expect(out.match(/<td>20<\/td>/g)?.length).toBe(1);
  });
});

describe("reader table presentation", () => {
  test("board cells expose reusable assets and render completion from status", () => {
    const properties = [
      { id: "title", name: "작업 이름", type: "title", config: {} },
      { id: "owner", name: "담당자", type: "select", config: { options: [{ id: "dori", name: "도리", color: "gray" }] } },
      { id: "status", name: "상태", type: "status", config: { options: [{ id: "done", name: "완료", color: "green" }, { id: "doing", name: "진행 중", color: "blue" }] } },
      { id: "progress", name: "진행률", type: "number", config: { display: "bar", max: 100 } },
      { id: "due", name: "마감일", type: "date", config: {} },
    ];
    const out = html.databaseHtml(properties, [row("done", { title: "검증", owner: "dori", status: "done", progress: 100, due: { start: "2026-11-30" } })], [], { slug: "board", now: NOW });
    expect(out).toContain('class="db-reader-assets"');
    expect(out).toContain('data-table-icon="calendar"');
    expect(out).toContain('data-table-property="due"');
    expect(out).toContain('class="table-check on"');
    expect(out).toContain('class="numwrap complete"');
    expect(out).toContain('100%');
    expect(out).toContain('2026년 11월 30일');
    const doing = html.databaseTableHtml(properties, [row("doing", { title: "검증", status: "doing", progress: 100 })], { config: {} }, {});
    expect(doing).not.toContain('class="numwrap complete"');
    expect(doing).not.toContain('class="table-check on"');
  });

  test("keeps real properties, people, status values and the editor link", () => {
    const properties = props([
      { id: "s", name: "상태", type: "status", config: { options: [{ id: "done", name: "완료", color: "gray" }] } },
      { id: "p", name: "담당", type: "text", config: {} },
    ]);
    const out = html.databaseHtml(properties, [row("a", { t: "실제 작업", s: "done", p: "도리" })], [], { slug: "board", now: NOW });
    expect(out).toContain('class="tag green table-status"');
    expect(out).toContain('/img/avatars/dori-96.webp');
    expect(out).toContain('href="/edit/board/"');
    expect(out.match(/<th scope="col"/g)?.length).toBe(3);
    expect(out.match(/<td class="table-select">/g)?.length).toBe(1);
    expect(out).toContain('class="dbviewbar dbtabs"');
  });

  test("bar text precedes the track and completion gets its own tone", () => {
    const out = html.dbNumberCell({ type: "number", config: { display: "bar" } }, 100);
    expect(out).toContain('class="numwrap complete"');
    expect(out.indexOf('class="numtext"')).toBeLessThan(out.indexOf('class="numbartrack"'));
  });
});
