import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const ROOT = join(import.meta.dir, "..");
const NAME_TABLE_INDEX = 5; // WOFF2 known-table index of "name"

function base128(bytes: Uint8Array, at: { i: number }): number {
  let value = 0;
  for (let n = 0; n < 5; n++) {
    const b = bytes[at.i++];
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) return value;
  }
  throw new Error("bad UIntBase128");
}

function woff2Names(file: Uint8Array): Map<number, string> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0) !== 0x774f4632) throw new Error("not WOFF2");
  const numTables = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  const at = { i: 48 };
  let offset = 0;
  let name: { start: number; length: number } | undefined;
  for (let t = 0; t < numTables; t++) {
    const flags = file[at.i++];
    const index = flags & 0x3f;
    if (index === 63) at.i += 4;
    const origLength = base128(file, at);
    const version = flags >> 6;
    const transformed = index === 10 || index === 11 ? version === 0 : version !== 0;
    const length = transformed ? base128(file, at) : origLength;
    if (index === NAME_TABLE_INDEX) name = { start: offset, length };
    offset += length;
  }
  if (!name) throw new Error("no name table");
  const tables = brotliDecompressSync(file.subarray(at.i, at.i + compressedSize));
  const table = new DataView(tables.buffer, tables.byteOffset + name.start, name.length);
  const count = table.getUint16(2);
  const strings = table.getUint16(4);
  const names = new Map<number, string>();
  for (let r = 0; r < count; r++) {
    const rec = 6 + r * 12;
    const platform = table.getUint16(rec);
    const id = table.getUint16(rec + 6);
    const len = table.getUint16(rec + 8);
    const raw = new Uint8Array(table.buffer, table.byteOffset + strings + table.getUint16(rec + 10), len);
    const text = platform === 3 || platform === 0 ? new TextDecoder("utf-16be").decode(raw) : new TextDecoder("latin1").decode(raw);
    names.set(id, (names.get(id) ?? "") + text);
  }
  return names;
}

test("every bundled woff2 carries its OFL copyright and license (name IDs 0, 13, 14)", async () => {
  const missing: string[] = [];
  let checked = 0;
  for await (const found of new Bun.Glob("assets/fonts/**/*.woff2").scan(ROOT)) {
    const names = woff2Names(new Uint8Array(await readFile(join(ROOT, found))));
    checked++;
    if (!names.get(0)?.trim()) missing.push(found + ": copyright (0)");
    if (!/Open Font License/.test(names.get(13) ?? "")) missing.push(found + ": license description (13)");
    if (!names.get(14)?.trim()) missing.push(found + ": license URL (14)");
  }
  expect(checked).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});

test("each bundled font family has its full OFL text in LICENSES/ and a notice in THIRD_PARTY_NOTICES.md", async () => {
  const notices = await readFile(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const [family, file] of [["Pretendard", "OFL-Pretendard.txt"], ["Noto Serif KR", "OFL-NotoSerifKR.txt"], ["JetBrains Mono", "OFL-JetBrainsMono.txt"]]) {
    const text = await readFile(join(ROOT, "LICENSES", file), "utf8");
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(text).toMatch(/Copyright/);
    expect(notices).toContain(family);
    expect(notices).toContain("LICENSES/" + file);
  }
});
