import { describe, expect, test } from "bun:test";
import { notionImportZip } from "../notion-import.ts";

type F = { name: string; data: string | Uint8Array; method?: 0 | 8 };

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function buildZip(files: F[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const method = f.method ?? 0;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    chunks.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const H = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const H2 = "ffffffffffffffffffffffffffffffff";

describe("notionImportZip", () => {
  test("저장(stored) 방식 zip의 중첩 .md 자식은 부모 slug를 가진다", async () => {
    const zip = await buildZip([
      { name: `Parent ${H}.md`, data: "# Parent\n\nhello" },
      { name: `Parent ${H}/Child.md`, data: "child body" },
    ]);
    const r = await notionImportZip(zip);
    expect(r.pages.map((p) => p.slug)).toEqual(["parent", "child"]);
    expect(r.pages[1].parent).toBe("parent");
    expect(r.pages[0].parent).toBeNull();
  });

  test("deflate 방식 zip도 파싱된다", async () => {
    const zip = await buildZip([{ name: "한글 노트.md", data: "# 한글 노트\n\n본문입니다", method: 8 }]);
    const r = await notionImportZip(zip);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].title).toBe("한글 노트");
    expect(r.pages[0].slug).toBe("한글-노트");
    expect(r.pages[0].blocks[0].text).toBe("본문입니다");
  });

  test("32자리 16진 접미사가 파일 이름에서 제거된다", async () => {
    const r = await notionImportZip(await buildZip([{ name: `My_Page ${H}.md`, data: "x" }]));
    expect(r.pages[0].title).toBe("My Page");
    expect(r.pages[0].slug).toBe("my-page");
  });

  test(".csv는 database 블록 하나가 된다", async () => {
    const r = await notionImportZip(await buildZip([{ name: `Tasks ${H}.csv`, data: "Name,Status\r\nA,Done\nB,Todo\n" }]));
    const p = r.pages[0];
    expect(p.kind).toBe("db");
    expect(p.title).toBe("Tasks");
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0].type).toBe("database");
    expect(p.blocks[0].text).toBe("Name | Status");
    expect(p.blocks[0].meta).toEqual({
      columns: ["Name", "Status"],
      rows: [
        { Name: "A", Status: "Done" },
        { Name: "B", Status: "Todo" },
      ],
      view: "table",
    });
  });

  test("CSV 필드 안의 쉼표와 따옴표 속 줄바꿈이 올바르게 파싱된다", async () => {
    const csv = 'Name,Note\n"Kim, Jo","line1\nline2 ""q"""\nPlain,ok\n';
    const r = await notionImportZip(await buildZip([{ name: "t.csv", data: csv }]));
    const meta = r.pages[0].blocks[0].meta as { rows: Record<string, string>[] };
    expect(meta.rows).toEqual([
      { Name: "Kim, Jo", Note: 'line1\nline2 "q"' },
      { Name: "Plain", Note: "ok" },
    ]);
  });

  test(".md/.csv가 아닌 항목은 skipped에 들어간다", async () => {
    const r = await notionImportZip(
      await buildZip([
        { name: "index.html", data: "<html>" },
        { name: "img.png", data: new Uint8Array([1, 2, 3]) },
        { name: "a.md", data: "hi" },
      ]),
    );
    expect(r.pages).toHaveLength(1);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0]).toContain("index.html");
    expect(r.skipped[1]).toContain("img.png");
  });

  test("쓰레기 바이트는 던지지 않고 빈 pages와 warning을 돌려준다", async () => {
    const r = await notionImportZip(new Uint8Array([1, 2, 3, 4, 5]));
    expect(r.pages).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
    const r2 = await notionImportZip(new Uint8Array(0));
    expect(r2.pages).toEqual([]);
    expect(r2.warnings.length).toBeGreaterThan(0);
  });

  test("부모가 항상 자식보다 먼저 나온다", async () => {
    const zip = await buildZip([
      { name: `A ${H}/B ${H2}/Deep.md`, data: "d" },
      { name: `A ${H}/B ${H2}.md`, data: "b" },
      { name: `A ${H}.md`, data: "a" },
    ]);
    const r = await notionImportZip(zip);
    expect(r.pages.map((p) => p.slug)).toEqual(["a", "b", "deep"]);
    expect(r.pages[2].parent).toBe("b");
  });

  test("# 제목 헤딩은 문단 블록으로 중복되지 않는다", async () => {
    const r = await notionImportZip(await buildZip([{ name: "file-name.md", data: "# Real Title\n\nbody text" }]));
    expect(r.pages[0].title).toBe("Real Title");
    expect(r.pages[0].blocks).toHaveLength(1);
    expect(r.pages[0].blocks[0].type).toBe("paragraph");
    expect(r.pages[0].blocks[0].text).toBe("body text");
  });

  test("이름이 같은 파일은 slug가 구분되고 자식은 올바른 부모를 가리킨다", async () => {
    const zip = await buildZip([
      { name: `Dup ${H}.md`, data: "one" },
      { name: `Dup ${H2}.md`, data: "two" },
      { name: `Dup ${H2}/Kid.md`, data: "kid" },
    ]);
    const r = await notionImportZip(zip);
    const slugs = r.pages.map((p) => p.slug);
    expect(slugs.slice(0, 2)).toEqual(["dup", "dup-2"]);
    expect(new Set(slugs).size).toBe(3);
    expect(r.pages[2].parent).toBe("dup-2");
  });

  test("매칭되는 .md가 없는 폴더도 부모 slug가 된다", async () => {
    const r = await notionImportZip(await buildZip([{ name: `Folder Name ${H}/Leaf.md`, data: "x" }]));
    expect(r.pages[0].parent).toBe("folder-name");
  });
});
