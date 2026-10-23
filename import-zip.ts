// Safe zip reader + text decoder for the importer (#129 #131). Runs unchanged in the Worker (inlined), the browser
// bundle, the local edition and tests: only TextDecoder, DecompressionStream, Uint8Array and DataView are used.
//   impReadZip(bytes | ImpSource, limits) -> { entries, skipped }   entry.read() inflates with bomb + CRC checks
//   impReadNested(entries, limits, skipped?) -> entries              opens Notion "-Part-N.zip" root archives
//   impDecodeText(bytes) -> { text, encoding }                        BOM / UTF-8 / EUC-KR
// Failures are impZipError(code): "empty" | "corrupt" | "too-big" | "too-many" | "unreadable" | "bomb" (err.code).
import { IMP_LIMITS, type ImpEntry, type ImpSkip, type ImpSource } from "./import-plan.ts";

export type ImpZipLimits = typeof IMP_LIMITS;
export type ImpZipErrorCode = "empty" | "corrupt" | "too-big" | "too-many" | "unreadable" | "bomb";
export type ImpZipError = Error & { code: ImpZipErrorCode };
export type ImpTextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "euc-kr";

export function impZipError(code: ImpZipErrorCode, detail?: string): ImpZipError {
  const err = new Error(detail ? `${code}: ${detail}` : code) as ImpZipError;
  err.name = "ImpZipError";
  err.code = code;
  return err;
}

type ImpRawEntry = { path: string; method: number; flags: number; crc: number; csize: number; usize: number; offset: number; dir: boolean };

const IMP_SIG_EOCD = 0x06054b50;
const IMP_SIG_EOCD64_LOC = 0x07064b50;
const IMP_SIG_EOCD64 = 0x06064b50;
const IMP_SIG_CENTRAL = 0x02014b50;
const IMP_SIG_LOCAL = 0x04034b50;
const IMP_NOTION_ROOT = /^Export-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\//i;
const IMP_PART_ZIP = /-Part-\d+\.zip$/i;
const IMP_CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

const impCrcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function impCrc32(buf: Uint8Array, prev = 0): number {
  let c = ~prev;
  for (let i = 0; i < buf.length; i++) c = impCrcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const impView = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

function impU64(v: DataView, off: number): number {
  if (off + 8 > v.byteLength) throw impZipError("corrupt", "zip64 field cut short");
  const lo = v.getUint32(off, true);
  const hi = v.getUint32(off + 4, true);
  if (hi > 0x1fffff) throw impZipError("corrupt", "zip64 value above 2^53");
  return hi * 0x100000000 + lo;
}

function impSourceOf(input: ImpSource | Uint8Array): ImpSource {
  if (!(input instanceof Uint8Array)) return input;
  return { size: input.length, read: async (offset, length) => input.subarray(offset, offset + length) };
}

async function impReadExact(src: ImpSource, offset: number, length: number): Promise<Uint8Array> {
  if (offset < 0 || length < 0 || offset + length > src.size) throw impZipError("corrupt", "read outside the archive");
  const bytes = await src.read(offset, length);
  if (bytes.length !== length) throw impZipError("corrupt", "short read");
  return bytes;
}

function impDecodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder("utf-8").decode(bytes);
  for (const label of ["utf-8", "euc-kr"]) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      // not this encoding; try the next one
    }
  }
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : IMP_CP437[b - 0x80];
  return out;
}

// Returns the normalised path, or the reason the name is unsafe.
function impCheckPath(raw: string): { path: string } | { unsafe: string } {
  const name = raw.replace(/\\/g, "/");
  if (/[\u0000-\u001f\u007f]/.test(name)) return { unsafe: "control character in name" };
  if (name.startsWith("/")) return { unsafe: "absolute path" };
  if (/^[A-Za-z]:/.test(name)) return { unsafe: "drive letter" };
  const segs = name.split("/");
  if (segs.includes("..")) return { unsafe: "parent directory segment" };
  return { path: segs.filter((s) => s !== "" && s !== ".").join("/") };
}

function impHiddenPath(path: string): boolean {
  const segs = path.split("/");
  if (segs.includes("__MACOSX")) return true;
  if (segs.includes(".obsidian")) return false;
  return segs[segs.length - 1].startsWith(".");
}

async function impReadDirectory(src: ImpSource, limits: ImpZipLimits): Promise<{ raw: Uint8Array; count: number }> {
  const tailLen = Math.min(src.size, 65536 + 22);
  const tailStart = src.size - tailLen;
  const tail = await impReadExact(src, tailStart, tailLen);
  const tv = impView(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === IMP_SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw impZipError("corrupt", "no end of central directory");
  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locAt = tailStart + eocd - 20;
    if (locAt < 0) throw impZipError("corrupt", "zip64 locator missing");
    const loc = impView(await impReadExact(src, locAt, 20));
    if (loc.getUint32(0, true) !== IMP_SIG_EOCD64_LOC) throw impZipError("corrupt", "zip64 locator missing");
    const recAt = impU64(loc, 8);
    const rec = impView(await impReadExact(src, recAt, 56));
    if (rec.getUint32(0, true) !== IMP_SIG_EOCD64) throw impZipError("corrupt", "zip64 end record missing");
    count = impU64(rec, 32);
    cdSize = impU64(rec, 40);
    cdOffset = impU64(rec, 48);
  }
  if (count > limits.entries) throw impZipError("too-many", `${count} entries`);
  if (cdOffset + cdSize > src.size) throw impZipError("corrupt", "central directory outside the archive");
  return { raw: await impReadExact(src, cdOffset, cdSize), count };
}

function impParseDirectory(cd: Uint8Array, count: number, archiveSize: number): ImpRawEntry[] {
  const v = impView(cd);
  const out: ImpRawEntry[] = [];
  let pos = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > cd.length || v.getUint32(pos, true) !== IMP_SIG_CENTRAL) throw impZipError("corrupt", "bad central directory entry");
    const flags = v.getUint16(pos + 8, true);
    const method = v.getUint16(pos + 10, true);
    const crc = v.getUint32(pos + 16, true);
    let csize = v.getUint32(pos + 20, true);
    let usize = v.getUint32(pos + 24, true);
    const nameLen = v.getUint16(pos + 28, true);
    const extraLen = v.getUint16(pos + 30, true);
    const commentLen = v.getUint16(pos + 32, true);
    const extAttr = v.getUint32(pos + 38, true);
    let offset = v.getUint32(pos + 42, true);
    const nameEnd = pos + 46 + nameLen;
    const extraEnd = nameEnd + extraLen;
    if (extraEnd + commentLen > cd.length) throw impZipError("corrupt", "central directory entry cut short");
    for (let p = nameEnd; p + 4 <= extraEnd; ) {
      const id = v.getUint16(p, true);
      const len = v.getUint16(p + 2, true);
      const fieldEnd = Math.min(p + 4 + len, extraEnd);
      if (id === 0x0001) {
        const f = new DataView(cd.buffer, cd.byteOffset + p + 4, fieldEnd - p - 4);
        let q = 0;
        if (usize === 0xffffffff) {
          usize = impU64(f, q);
          q += 8;
        }
        if (csize === 0xffffffff) {
          csize = impU64(f, q);
          q += 8;
        }
        if (offset === 0xffffffff) offset = impU64(f, q);
      }
      p = fieldEnd;
    }
    if (offset + 30 + csize > archiveSize) throw impZipError("corrupt", "entry data outside the archive");
    const name = impDecodeName(cd.subarray(pos + 46, nameEnd), (flags & 0x0800) !== 0);
    out.push({ path: name, method, flags, crc, csize, usize, offset, dir: name.endsWith("/") || name.endsWith("\\") || (extAttr & 0x10) !== 0 });
    pos = extraEnd + commentLen;
  }
  return out;
}

async function impInflate(raw: Uint8Array, e: ImpRawEntry, limits: ImpZipLimits, budget: { total: number }): Promise<Uint8Array> {
  const cap = Math.min(e.usize + 1024, limits.entryInflateBytes);
  const stream = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(new Uint8Array(raw.buffer as ArrayBuffer, raw.byteOffset, raw.byteLength));
      c.close();
    },
  }).pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      budget.total += value.length;
      if (size > cap) throw impZipError("bomb", `${e.path} inflates past ${cap} bytes`);
      if (budget.total > limits.totalInflateBytes) throw impZipError("bomb", `total inflated bytes over ${limits.totalInflateBytes}`);
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    if ((err as ImpZipError).code) throw err;
    throw impZipError("corrupt", `${e.path}: ${(err as Error).message}`);
  }
  if (size !== e.usize) throw impZipError("corrupt", `${e.path} inflated to ${size} bytes, declared ${e.usize}`);
  const out = new Uint8Array(size);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function impReadEntry(src: ImpSource, e: ImpRawEntry, limits: ImpZipLimits, budget: { total: number }): Promise<Uint8Array> {
  const head = impView(await impReadExact(src, e.offset, 30));
  if (head.getUint32(0, true) !== IMP_SIG_LOCAL) throw impZipError("corrupt", `${e.path}: bad local header`);
  const dataAt = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  if (dataAt + e.csize > src.size) throw impZipError("corrupt", `${e.path}: truncated entry`);
  const raw = await impReadExact(src, dataAt, e.csize);
  let out: Uint8Array;
  if (e.method === 0) {
    if (raw.length !== e.usize) throw impZipError("corrupt", `${e.path}: stored size mismatch`);
    budget.total += raw.length;
    if (budget.total > limits.totalInflateBytes) throw impZipError("bomb", `total inflated bytes over ${limits.totalInflateBytes}`);
    out = raw;
  } else if (e.method === 8) {
    out = await impInflate(raw, e, limits, budget);
  } else {
    throw impZipError("unreadable", `${e.path}: compression method ${e.method}`);
  }
  if (impCrc32(out) !== e.crc) throw impZipError("corrupt", `${e.path}: crc mismatch`);
  return out;
}

// `budget` is shared by every archive of one import (impReadNested passes one in for all Part zips).
export async function impReadZip(input: ImpSource | Uint8Array, limits: ImpZipLimits = IMP_LIMITS, budget: { total: number } = { total: 0 }): Promise<{ entries: ImpEntry[]; skipped: ImpSkip[] }> {
  const src = impSourceOf(input);
  if (src.size === 0) throw impZipError("empty");
  if (src.size > limits.archiveBytes) throw impZipError("too-big", `${src.size} bytes`);
  if (src.size < 22) throw impZipError("corrupt", "shorter than an end record");
  const dir = await impReadDirectory(src, limits);
  const raw = impParseDirectory(dir.raw, dir.count, src.size);
  const skipped: ImpSkip[] = [];
  const safe: ImpRawEntry[] = [];
  for (const e of raw) {
    if (e.dir) continue;
    const checked = impCheckPath(e.path);
    if ("unsafe" in checked) {
      skipped.push({ path: e.path.replace(/\\/g, "/"), code: "unsafe-path", detail: checked.unsafe });
      continue;
    }
    if (checked.path === "" || impHiddenPath(checked.path)) continue;
    safe.push({ ...e, path: checked.path });
  }
  const root = safe.length > 0 ? safe[0].path.match(IMP_NOTION_ROOT)?.[0] : undefined;
  if (root && safe.every((e) => e.path.startsWith(root))) for (const e of safe) e.path = e.path.slice(root.length);
  const entries: ImpEntry[] = [];
  for (const e of safe) {
    if (e.path === "") continue;
    if (e.usize > limits.entryInflateBytes) {
      skipped.push({ path: e.path, code: "bomb", detail: `declared ${e.usize} bytes` });
      continue;
    }
    if (e.usize > limits.ratioMinBytes && e.usize / Math.max(e.csize, 1) > limits.ratio) {
      skipped.push({ path: e.path, code: "bomb", detail: `ratio ${Math.round(e.usize / Math.max(e.csize, 1))}:1` });
      continue;
    }
    entries.push({ path: e.path, size: e.usize, read: () => impReadEntry(src, e, limits, budget) });
  }
  return { entries, skipped };
}

// Notion splits big exports into "<root>-Part-N.zip" files inside one outer zip. When every root entry is such a part
// (or the archive holds only root-level zips), each part is opened and their entries are concatenated; deeper zips
// stay ordinary entries. Inner skips are appended to `skipped` when given, prefixed with the part name.
export async function impReadNested(entries: ImpEntry[], limits: ImpZipLimits = IMP_LIMITS, skipped?: ImpSkip[]): Promise<ImpEntry[]> {
  const root = entries.filter((e) => !e.path.includes("/"));
  const nested = root.length > 0 && root.every((e) => /\.zip$/i.test(e.path)) && (root.every((e) => IMP_PART_ZIP.test(e.path)) || root.length === entries.length);
  if (!nested) return entries;
  const parts = root.slice().sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const out: ImpEntry[] = [];
  const budget = { total: 0 };
  for (const part of parts) {
    const inner = await impReadZip(await part.read(), limits, budget);
    out.push(...inner.entries);
    if (skipped) skipped.push(...inner.skipped.map((s) => ({ ...s, path: `${part.path}/${s.path}` })));
  }
  return out.concat(entries.filter((e) => e.path.includes("/")));
}

export function impDecodeText(bytes: Uint8Array): { text: string; encoding: ImpTextEncoding } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le" };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be" };
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}
