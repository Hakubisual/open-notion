import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cardPreview, normaliseCard, normaliseView } from "../db-model.js";
import { setup } from "./db-harness";

let html: any;
beforeAll(async () => {
  const root = join(import.meta.dir, "..");
  const shared = "import { ico, tableHeaderIcon, tablePersonHtml, tableHeadingHtml, tableNewHtml, tableDateHtml, tableProgressHtml } from " + JSON.stringify(pathToFileURL(join(root, "block-html.js")).href) + ";\n";
  const source = shared + readFileSync(join(root, "db-model.js"), "utf8") + "\n" + readFileSync(join(root, "db-html.js"), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "db-card-"));
  writeFileSync(join(dir, "assembled.mjs"), source);
  html = await import(pathToFileURL(join(dir, "assembled.mjs")).href);
});

const properties = [
  { id: "t", name: "이름", type: "title", config: {} },
  { id: "f", name: "사진", type: "files", config: {} },
  { id: "g", name: "도면", type: "files", config: {} },
];
const rows = [
  { id: "r1", page: "p1", ord: 0, pageIcon: "🏠", cover: "https://img.test/cover-1.png", firstImage: null, values: { t: "커버 있음", f: [], g: [] } },
  { id: "r2", page: "p2", ord: 1, pageIcon: "", cover: null, firstImage: "https://img.test/body-2.png", values: { t: "본문 이미지", f: [], g: [] } },
  { id: "r3", page: "p3", ord: 2, pageIcon: "", cover: null, firstImage: null, values: { t: "파일", f: [{ name: "a.png", url: "https://img.test/file-3.png" }], g: [{ name: "b.png", url: "https://img.test/plan-3.png" }] } },
];
const view = (card?: unknown) => normaliseView({ id: "v", type: "gallery", config: card === undefined ? {} : { card } }, 0);

test("a gallery without card settings renders exactly as before (first files property, no size class)", () => {
  const out = html.databaseGalleryHtml(properties, rows, view(), { now: 0 });
  expect(out.startsWith('<div class="dbgallery"><article class="dbcard">')).toBe(true);
  expect(out).toContain("https://img.test/file-3.png");
  expect(out).not.toContain("cover-1.png");
  expect(out).not.toContain("dbcardicon");
  expect(view().config.card).toBeUndefined();
});

test("without card settings the server gallery and board retain their markup with async image decoding", () => {
  const props = [{"id":"t","name":"이름","type":"title","config":{}},{"id":"s","name":"상태","type":"status","config":{"options":[{"id":"o1","name":"A","color":"gray"},{"id":"o2","name":"B","color":"blue"}]}},{"id":"f","name":"사진","type":"files","config":{}},{"id":"n","name":"점수","type":"number","config":{}}];
  const rows = [{"id":"r1","page":"p1","ord":0,"pageIcon":"🏠","cover":"https://x/c.png","values":{"t":"하나","s":"o1","f":[{"name":"a.png","url":"https://x/a.png"}],"n":3}},{"id":"r2","page":"p2","ord":1,"values":{"t":"둘","s":"o2","f":[],"n":5}}];
  const plain = (type: string) => normaliseView({ id: "v", name: "v", type, config: {} }, 0);
  expect(html.databaseGalleryHtml(props, rows, plain("gallery"), { now: 0 })).toBe("<div class=\"dbgallery\"><article class=\"dbcard\"><div class=\"dbcardcover\"><a class=\"filethumb\" href=\"https://x/a.png\" target=\"_blank\" rel=\"noopener\"><img src=\"https://x/a.png\" alt=\"a.png\" decoding=\"async\" loading=\"lazy\"></a></div><div class=\"dbcardbody\"><a class=\"rowtitle\" href=\"/edit/p1/\"><span class=\"rowicon docicon\" aria-hidden=\"true\">📄</span><span>하나</span></a><div class=\"dbcardrow\"><span class=\"dbcardkey\">상태</span><span class=\"tag gray table-status\">A</span></div><div class=\"dbcardrow\"><span class=\"dbcardkey\">점수</span><span class=\"numtext\">3</span></div></div></article><article class=\"dbcard\"><div class=\"dbcardbody\"><a class=\"rowtitle\" href=\"/edit/p2/\"><span class=\"rowicon docicon\" aria-hidden=\"true\">📄</span><span>둘</span></a><div class=\"dbcardrow\"><span class=\"dbcardkey\">상태</span><span class=\"tag blue table-status\">B</span></div><div class=\"dbcardrow\"><span class=\"dbcardkey\">점수</span><span class=\"numtext\">5</span></div></div></article></div>");
  expect(html.databaseBoardHtml(props, rows, plain("board"), { now: 0 })).toBe("<div class=\"dbboard\"><section class=\"dbboardcol\"><header class=\"dbboardhead\"><span class=\"dot gray\"></span>A<span class=\"dbcount\">1</span></header><div class=\"dbboardcards\"><article class=\"dbcard\"><div class=\"dbcardcover\"><a class=\"filethumb\" href=\"https://x/a.png\" target=\"_blank\" rel=\"noopener\"><img src=\"https://x/a.png\" alt=\"a.png\" decoding=\"async\" loading=\"lazy\"></a></div><div class=\"dbcardbody\"><a class=\"rowtitle\" href=\"/edit/p1/\"><span class=\"rowicon docicon\" aria-hidden=\"true\">📄</span><span>하나</span></a><div class=\"dbcardrow\"><span class=\"dbcardkey\">점수</span><span class=\"numtext\">3</span></div></div></article></div></section><section class=\"dbboardcol\"><header class=\"dbboardhead\"><span class=\"dot blue\"></span>B<span class=\"dbcount\">1</span></header><div class=\"dbboardcards\"><article class=\"dbcard\"><div class=\"dbcardbody\"><a class=\"rowtitle\" href=\"/edit/p2/\"><span class=\"rowicon docicon\" aria-hidden=\"true\">📄</span><span>둘</span></a><div class=\"dbcardrow\"><span class=\"dbcardkey\">점수</span><span class=\"numtext\">5</span></div></div></article></div></section><section class=\"dbboardcol\"><header class=\"dbboardhead\"><span class=\"dot default\"></span>옵션 없음<span class=\"dbcount\">0</span></header><div class=\"dbboardcards\"></div></section></div>");
});

test("card preview follows the chosen source: none, page cover, first page image, a files property", () => {
  const pick = (card: unknown) => rows.map((row) => cardPreview(properties, view(card), row, row.values));
  expect(pick({ preview: "none" })).toEqual([null, null, null]);
  expect(pick({ preview: "page_cover" })).toEqual(["https://img.test/cover-1.png", null, null]);
  expect(pick({ preview: "page_content" })).toEqual([null, "https://img.test/body-2.png", null]);
  expect(pick({ preview: "property", property: "g" })).toEqual([null, null, "https://img.test/plan-3.png"]);
  expect(pick(undefined)).toEqual([null, null, "https://img.test/file-3.png"]);
});

test("server cards use the size, fit and icon settings; rows without an image get no broken img", () => {
  const out = html.databaseGalleryHtml(properties, rows, view({ preview: "page_cover", size: "l", fit: "contain", icon: true }), { now: 0 });
  expect(out).toContain("minmax(320px,1fr)");
  expect(out).toContain('src="https://img.test/cover-1.png"');
  expect(out).toContain("object-fit:contain;height:200px");
  expect(out.match(/<img/g)?.length).toBe(1);
  expect(out).toContain('<span class="dbcardicon">🏠</span>');
  const noIcon = html.databaseGalleryHtml(properties, rows, view({ preview: "page_cover", icon: false }), { now: 0 });
  expect(noIcon).not.toContain("dbcardicon");
  expect(noIcon).toContain("minmax(240px,1fr)");
});

test("card settings are normalised: unknown values fall back, icon defaults to shown", () => {
  expect(normaliseCard({ preview: "video", size: "xl", fit: "stretch" })).toEqual({ preview: "property", property: "", size: "m", fit: "cover", icon: true });
  expect(normaliseView(JSON.parse(JSON.stringify(view({ preview: "page_cover", size: "s" }))), 0)).toEqual(view({ preview: "page_cover", size: "s" }));
});

test("the database API gives each row its page cover, icon and first body image", async () => {
  const ctx = setup();
  const created = (await ctx.call("POST", "/api/db", { title: "카드" })).data;
  const base = "/api/db/" + encodeURIComponent(created.slug);
  const title = (await ctx.call("GET", base)).data.properties.find((p: any) => p.type === "title").id;
  const row = (await ctx.call("POST", base + "/rows", { props: { [title]: "집" } })).data.row;
  const page = encodeURIComponent(row.page);
  expect((await ctx.call("PUT", "/api/page/" + page + "/settings", { cover: "https://img.test/c.png", icon: "🏠" })).status).toBe(200);
  const blocks = [{ id: "b1", type: "paragraph", text: "글" }, { id: "b2", type: "image", text: "", meta: { src: "https://img.test/first.png" } }, { id: "b3", type: "image", text: "", meta: { src: "https://img.test/second.png" } }];
  expect((await ctx.call("PUT", "/api/page/" + page, { title: "집", blocks })).status).toBe(200);
  const got = (await ctx.call("GET", base)).data.rows.find((r: any) => r.id === row.id);
  expect([got.cover, got.pageIcon, got.firstImage]).toEqual(["https://img.test/c.png", "🏠", "https://img.test/first.png"]);
});
