import { beforeEach, expect, test } from "bun:test";
import { cookie, setup } from "./db-harness";

// notion-parity-1 IS-6: the editor's 마크다운으로 내보내기 (format=acard-md) and 가져오기 (/api/import/md) keep every block's
// color, icon, embed height, heading level, toggle heading and indent; the Notion-style format=md stays without them.
let h: ReturnType<typeof setup> & { worker: any };
const styled = [
  { id: "p1", type: "paragraph", text: "빨간 글", meta: { color: "red" } },
  { id: "h4", type: "heading4", text: "소제목", meta: { color: "blue_background" } },
  { id: "c1", type: "callout", text: "불 조심", meta: { tone: "warn", icon: "🔥", color: "orange_background" } },
  { id: "e1", type: "embed", text: "", meta: { url: "https://x.github.io/w", height: 480 } },
  { id: "t1", type: "heading2", text: "접는 제목", meta: { toggle: true, open: false } },
  { id: "k1", type: "bulleted", text: "자식", indent: 1, meta: { color: "green" } },
];
const shape = (rows: any[]) => rows.map((r) => [r.type, r.text, r.indent || 0, typeof r.meta === "string" ? JSON.parse(r.meta || "null") : r.meta ?? null]);

beforeEach(async () => {
  h = setup() as typeof h;
  await h.call("GET", "/api/tree");
  await h.call("POST", "/api/pages", { title: "스타일 원본", slug: "style-src" });
  expect((await h.call("PUT", "/api/page/style-src", { title: "스타일 원본", blocks: styled })).status).toBe(200);
});

test("format=acard-md exports a flagged document that /api/import/md reads back the same", async () => {
  const res = await h.worker.fetch(new Request("https://notes.test/api/export?slug=style-src&format=acard-md", { headers: { cookie: await cookie() } }), h.env);
  expect(res.status).toBe(200);
  const md = await res.text();
  expect(md).toStartWith('---\ntitle: "스타일 원본"\nacard_meta: 1\n---\n');
  expect(md).toContain('> [!warn] 불 조심\n<!--acard {"color":"orange_background","icon":"🔥"}-->');
  const form = new FormData();
  form.append("file", new File([md], "style-src.md", { type: "text/markdown" }));
  const imported = await h.worker.fetch(new Request("https://notes.test/api/import/md", { method: "POST", body: form, headers: { cookie: await cookie() } }), h.env);
  const body = await imported.json() as any;
  expect(body.imported).toBe(1);
  expect(body.pages[0].title).toBe("스타일 원본");
  const slug = body.pages[0].slug;
  const rows = h.sqlite.query("SELECT type, text, indent, meta FROM blocks WHERE page = ? ORDER BY ord").all(slug);
  const strip = (list: any[]) => list.map(([type, text, indent, meta]) => [type, text, indent, meta && Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "richText"))]);
  expect(strip(shape(rows))).toEqual(strip(shape(styled)));
});

test("the Notion-style format=md and a plain markdown import are unchanged", async () => {
  const res = await h.worker.fetch(new Request("https://notes.test/api/export?slug=style-src&format=md", { headers: { cookie: await cookie() } }), h.env);
  const md = await res.text();
  expect(md).not.toContain("acard");
  expect(md).toContain("#### 소제목");
  const form = new FormData();
  form.append("file", new File(['hello\n<!--acard {"color":"red"}-->'], "plain.md", { type: "text/markdown" }));
  const body = await (await h.worker.fetch(new Request("https://notes.test/api/import/md", { method: "POST", body: form, headers: { cookie: await cookie() } }), h.env)).json() as any;
  const rows = h.sqlite.query("SELECT text, meta FROM blocks WHERE page = ?").all(body.pages[0].slug) as any[];
  expect(rows.map((r) => [r.text, JSON.parse(r.meta || "null")])).toEqual([['hello <!--acard {"color":"red"}-->', null]]);
});
