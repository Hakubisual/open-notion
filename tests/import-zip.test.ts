import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { IMP_LIMITS } from "../import-plan.ts";
import { impDecodeText, impReadNested, impReadZip, impZipError } from "../import-zip.ts";
import { buildFixture } from "./fixtures/import-fixtures.ts";

const ROOT_RE = /^Export-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\//i;
const BOMB_PATH = process.env.ACARD_ZIPBOMB_FIXTURE ?? "";
const utf8 = (s: string) => new TextEncoder().encode(s);
const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e) => e.code);

// Minimal zip writer for the unit cases (stored entries, arbitrary names, no safety).
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}
function zipOf(files: { name: string; data?: Uint8Array; crc?: number; method?: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8(f.name);
    const data = f.data ?? utf8("# " + f.name + "\n");
    const crc = f.crc ?? crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, f.method ?? 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, f.method ?? 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, data);
    offset += local.length + data.length;
    central.push(cen);
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    parts.push(c);
    cdSize += c.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  parts.push(end);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

test("N1: entries = fixture files minus the Notion Export root, every entry reads back byte-identical", async () => {
  const f = await buildFixture("N1");
  const { entries, skipped } = await impReadZip(f.zip);
  const expected = [...f.files.keys()].map((k) => k.replace(ROOT_RE, "")).sort();
  expect(entries.map((e) => e.path).sort()).toEqual(expected);
  expect(entries.length).toBe(f.files.size);
  expect(skipped).toEqual([]);
  for (const e of entries) {
    const want = [...f.files.entries()].find(([k]) => k.replace(ROOT_RE, "") === e.path)![1];
    expect(e.size).toBe(want.length);
    expect(await e.read()).toEqual(want);
  }
});

test("N1 via ImpSource (slice reads) gives the same entries as the byte array", async () => {
  const f = await buildFixture("N1");
  const reads: number[] = [];
  const src = { size: f.zip.length, read: async (o: number, l: number) => (reads.push(l), f.zip.subarray(o, o + l)) };
  const a = await impReadZip(src);
  const b = await impReadZip(f.zip);
  expect(a.entries.map((e) => e.path)).toEqual(b.entries.map((e) => e.path));
  expect(reads.length).toBeGreaterThan(0);
  expect(await a.entries[0].read()).toEqual(await b.entries[0].read());
});

test("E1: 0 bytes -> code empty", async () => {
  const f = await buildFixture("E1");
  expect(f.zip.length).toBe(0);
  expect(await codeOf(impReadZip(f.zip))).toBe("empty");
});

test("E2: truncated archive -> code corrupt", async () => {
  const f = await buildFixture("E2");
  expect(await codeOf(impReadZip(f.zip))).toBe("corrupt");
});

test("E3: 1 entry ok.md + 4 unsafe-path skips", async () => {
  const f = await buildFixture("E3");
  const { entries, skipped } = await impReadZip(f.zip);
  expect(entries.map((e) => e.path)).toEqual(["ok.md"]);
  expect(skipped.map((s) => s.code)).toEqual(["unsafe-path", "unsafe-path", "unsafe-path", "unsafe-path"]);
  expect(skipped.map((s) => s.path).sort()).toEqual(["../evil.md", "/abs.md", "C:/win.md", "a/../../b.md"].sort());
  expect(new TextDecoder().decode(await entries[0].read())).toBe("# ok\n\nsafe entry\n");
});

test("path rules: backslash, NUL, control chars, dotfiles, __MACOSX, .obsidian keep, dirs dropped", async () => {
  const z = zipOf([
    { name: "dir/" },
    { name: "a\\b.md" },
    { name: "nul\u0000.md" },
    { name: "ctl\u0001.md" },
    { name: "__MACOSX/x.md" },
    { name: ".DS_Store" },
    { name: "sub/.hidden.md" },
    { name: ".obsidian/app.json" },
    { name: "vault/.obsidian/plugins/x/.data.json" },
    { name: "./dot/slash.md" },
    { name: "D:x.md" },
  ]);
  const { entries, skipped } = await impReadZip(z);
  expect(entries.map((e) => e.path).sort()).toEqual([".obsidian/app.json", "a/b.md", "dot/slash.md", "vault/.obsidian/plugins/x/.data.json"]);
  expect(skipped.map((s) => [s.path, s.code]).sort()).toEqual([
    ["D:x.md", "unsafe-path"],
    ["ctl\u0001.md", "unsafe-path"],
    ["nul\u0000.md", "unsafe-path"],
  ]);
});

test("Export root is stripped only when every entry shares it", async () => {
  const root = "Export-1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b/";
  const shared = await impReadZip(zipOf([{ name: root + "a.md" }, { name: root + "sub/b.md" }]));
  expect(shared.entries.map((e) => e.path).sort()).toEqual(["a.md", "sub/b.md"]);
  const mixed = await impReadZip(zipOf([{ name: root + "a.md" }, { name: "other.md" }]));
  expect(mixed.entries.map((e) => e.path).sort()).toEqual([root + "a.md", "other.md"].sort());
});

test("limits: too-big, too-many, unreadable method, crc mismatch -> corrupt", async () => {
  const z = zipOf([{ name: "a.md" }, { name: "b.md" }]);
  expect(await codeOf(impReadZip(z, { ...IMP_LIMITS, archiveBytes: z.length - 1 }))).toBe("too-big");
  expect(await codeOf(impReadZip(z, { ...IMP_LIMITS, entries: 1 }))).toBe("too-many");
  const bad = await impReadZip(zipOf([{ name: "lzma.md", method: 14 }, { name: "crc.md", crc: 0x12345678 }]));
  expect(bad.entries.length).toBe(2);
  expect(await codeOf(bad.entries[0].read())).toBe("unreadable");
  expect(await codeOf(bad.entries[1].read())).toBe("corrupt");
  const err = impZipError("bomb", "x");
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe("bomb");
});

test("E8: CP949 csv and UTF-16LE / UTF-8 BOM md decode to the Korean text, legacy names decoded", async () => {
  const f = await buildFixture("E8");
  const { entries, skipped } = await impReadZip(f.zip);
  expect(skipped).toEqual([]);
  const byName = (re: RegExp) => entries.find((e) => re.test(e.path))!;
  const csvKey = [...f.files.keys()].find((k) => k.endsWith(".csv"))!;
  const csv = impDecodeText(await byName(/^표 .*\.csv$/).read());
  expect(csv.encoding).toBe("euc-kr");
  expect(csv.text).toBe(new TextDecoder("euc-kr").decode(f.files.get(csvKey)!));
  expect(csv.text.startsWith("이름,상태,메모\n웹사이트 개선,진행 중,\"한글, 쉼표\"\n모바일 앱,완료,메모 없음\n")).toBe(true);
  const u16Key = [...f.files.keys()].find((k) => k.includes("UTF16 "))!;
  const u16 = impDecodeText(await byName(/^UTF16 /).read());
  expect(u16.encoding).toBe("utf-16le");
  expect(u16.text).toBe(new TextDecoder("utf-16le").decode(f.files.get(u16Key)!));
  expect(u16.text).toBe("# UTF-16 page\n\nUTF-16LE with BOM. 한글 본문.\n");
  const bom = impDecodeText(await byName(/^BOM /).read());
  expect(bom.encoding).toBe("utf-8");
  expect(bom.text).toBe("# BOM page\n\nUTF-8 with BOM. 한글 본문.\n");
  expect(entries.map((e) => e.path)).toContain("한글 노트.md");
  expect(entries.map((e) => e.path)).toContain("café.md");
  expect(new TextDecoder().decode(await byName(/^한글 노트\.md$/).read())).toContain("# 한글 노트");
});

test("impDecodeText: UTF-16BE BOM, plain UTF-8, EUC-KR fallback", () => {
  expect(impDecodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0xd5, 0x5c]))).toEqual({ text: "A한", encoding: "utf-16be" });
  expect(impDecodeText(utf8("plain 한글"))).toEqual({ text: "plain 한글", encoding: "utf-8" });
  expect(impDecodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]))).toEqual({ text: "한글", encoding: "euc-kr" });
});

test("E9 small (16 MiB declared, ratio > 200): zeros.bin is rejected as bomb before inflating", async () => {
  const f = await buildFixture("E9", { small: true });
  const { entries, skipped } = await impReadZip(f.zip);
  expect(entries.map((e) => e.path)).toEqual([[...f.files.keys()][0].replace(ROOT_RE, "")]);
  expect(skipped).toEqual([{ path: "zeros.bin", code: "bomb", detail: expect.stringContaining("ratio") }]);
});

test("E9 small with the ratio check relaxed: streaming read still throws bomb at the entry cap", async () => {
  const f = await buildFixture("E9", { small: true });
  const limits = { ...IMP_LIMITS, ratio: 1e9, entryInflateBytes: 4 * 1024 * 1024 };
  const a = await impReadZip(f.zip, limits);
  expect(a.skipped).toEqual([{ path: "zeros.bin", code: "bomb", detail: expect.stringContaining("declared") }]);
  const b = await impReadZip(f.zip, { ...limits, entryInflateBytes: 64 * 1024 * 1024, totalInflateBytes: 2 * 1024 * 1024 });
  const zeros = b.entries.find((e) => e.path === "zeros.bin")!;
  expect(await codeOf(zeros.read())).toBe("bomb");
});

test("E9 full disk fixture (1 GiB declared) is rejected as bomb in < 5 s", async () => {
  if (!existsSync(BOMB_PATH)) {
    console.warn("E9 full fixture not on disk; small variant covered above");
    return;
  }
  const started = performance.now();
  const bytes = new Uint8Array(readFileSync(BOMB_PATH));
  const { entries, skipped } = await impReadZip(bytes);
  expect(skipped.map((s) => s.code)).toEqual(["bomb"]);
  expect(entries.map((e) => e.path)).toEqual([expect.stringMatching(/^readme .*\.md$/)]);
  for (const e of entries) await e.read();
  expect(performance.now() - started).toBeLessThan(5000);
});

test("N3: impReadNested merges the Part-1 and Part-2 zips with each Export root stripped", async () => {
  const f = await buildFixture("N3");
  const outer = await impReadZip(f.zip);
  expect(outer.entries.map((e) => e.path).sort()).toEqual([...f.files.keys()].sort());
  const merged = await impReadNested(outer.entries, IMP_LIMITS, outer.skipped);
  const paths = merged.map((e) => e.path).sort();
  expect(paths.length).toBe(4);
  expect(paths.every((p) => !ROOT_RE.test(p) && !p.endsWith(".zip"))).toBe(true);
  expect(paths.filter((p) => /^Home [0-9a-f]{32}\.md$/.test(p)).length).toBe(1);
  expect(paths.filter((p) => /^Home [0-9a-f]{32}\/Alpha [0-9a-f]{32}\.md$/.test(p)).length).toBe(1);
  expect(paths.filter((p) => /^Home [0-9a-f]{32}\/Beta [0-9a-f]{32}\.md$/.test(p)).length).toBe(1);
  expect(paths.filter((p) => /^Home [0-9a-f]{32}\/Beta [0-9a-f]{32}\/Gamma [0-9a-f]{32}\.md$/.test(p)).length).toBe(1);
  const gamma = merged.find((e) => /Gamma/.test(e.path))!;
  expect(new TextDecoder().decode(await gamma.read())).toContain("# Gamma");
  expect(outer.skipped).toEqual([]);
});

test("impReadNested leaves non-part archives and deeper zips alone", async () => {
  const inner = zipOf([{ name: "in.md" }]);
  const plain = await impReadZip(zipOf([{ name: "a.md" }, { name: "sub/x.zip", data: inner }]));
  expect(await impReadNested(plain.entries)).toBe(plain.entries);
  const onlyZips = await impReadZip(zipOf([{ name: "b.zip", data: inner }, { name: "a.zip", data: inner }]));
  expect((await impReadNested(onlyZips.entries)).map((e) => e.path)).toEqual(["in.md", "in.md"]);
});

test("Part zips share one inflate budget: three parts under the cap each, over it together", async () => {
  const part = (n: number) => zipOf([{ name: "p" + n + ".md", data: new Uint8Array(400) }]);
  const outer = await impReadZip(zipOf([1, 2, 3].map((n) => ({ name: "Export-Part-" + n + ".zip", data: part(n) }))));
  const limits = { ...IMP_LIMITS, totalInflateBytes: 1000 };
  const merged = await impReadNested(outer.entries, limits);
  expect(merged.length).toBe(3);
  expect(await codeOf((async () => { for (const e of merged) await e.read(); })())).toBe("bomb");
});

test("E10: 9 levels of nested paths are kept", async () => {
  const f = await buildFixture("E10");
  const { entries } = await impReadZip(f.zip);
  expect(entries.map((e) => e.path).sort()).toEqual([...f.files.keys()].map((k) => k.replace(ROOT_RE, "")).sort());
  const depths = entries.map((e) => e.path.split("/").length);
  expect(Math.max(...depths)).toBe(9);
  expect(entries.length).toBe(9);
});
