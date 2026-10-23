// usage: bun scripts/qa/import-fixtures.ts <outDir>   writes deterministic Notion/Obsidian import QA fixtures + manifest.json
//
// Library use (unit tests): `import { buildFixture } from "../scripts/qa/import-fixtures.ts"` then
// `const f = await buildFixture("N1")` -> { files, zip, sourceCounts, expect, notes } built fully in memory, no disk I/O.
// Small fixtures (N1, N2, N3, O1, E1-E6, E8, E10) build in well under a second; N4, N5, E7 and E9 are big and meant for
// the CLI, but `buildFixture(name, { small: true })` gives a same-shaped miniature of them for tests.
//
// Every fixture is synthetic (no real personal data), built from fixed ids/dates and a seeded PRNG, so two runs
// produce byte-identical archives. Zips are written by the small writer below (local headers + central directory +
// EOCD, method 0 stored / method 8 deflate via CompressionStream("deflate-raw"), real CRC32, UTF-8 name flag 0x0800).
//
// manifest.json = { <fixtureId>: { file, kind, expect, sourceCounts, notes } }
// sourceCounts are tallied WHILE the generator builds each fixture (never by parsing the output):
//   pages                 .md / .html pages that an importer should turn into notes, including database row pages;
//                         excludes db .csv files, Notion's root index.html, .canvas files and attachments
//   databases             distinct databases (one <Name> <id>.csv [+ _all.csv] pair = one database)
//   dbRows                data rows across all database CSVs (header row not counted; _all.csv rows counted once)
//   internalLinks         body links (markdown [..](..), [[wikilink]], HTML <a href>) whose target is another page
//                         inside the same fixture, counted per occurrence; self-links count; links to .csv files,
//                         relation values in property lines and notion.so URLs do not count
//   internalLinksToMissing body links of the same shape whose target page is NOT in the fixture, per occurrence
//   images                image references in page bodies (![..](..), ![[..]], <img>, <figure class=image>) that point
//                         at an image file shipped in the fixture, per occurrence (![[photo.png]] + ![[photo.png|300]] = 2);
//                         javascript:/http image refs are not counted
//   attachments           DISTINCT non-image files (pdf, bin, ...) referenced from page bodies that ship in the fixture
//   tags                  DISTINCT tag names (inline #tag, nested #a/b, front-matter tags: list); Notion fixtures = 0
//   embedsNote            note transclusions ![[Note]] / ![[Note#..]], per occurrence (self-embed counts)
//   callouts              Notion <aside>/figure.callout blocks + Obsidian > [!type] blocks (nested ones count)
//   equations             $$ block equations + $inline$ equations, per occurrence (KaTeX figure in HTML = 1)
//   codeBlocks            fenced ``` blocks of any language (mermaid/dataview fences included) + HTML pre.code
//   todos                 - [ ] / - [x] items + HTML to-do-list items, per item
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- public types
export type SourceCounts = {
  pages: number;
  databases: number;
  dbRows: number;
  internalLinks: number;
  internalLinksToMissing: number;
  images: number;
  attachments: number;
  tags: number;
  embedsNote: number;
  callouts: number;
  equations: number;
  codeBlocks: number;
  todos: number;
};
export type FixtureName = "N1" | "N2" | "N3" | "N4" | "N5" | "O1" | "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8" | "E9" | "E10";
export type Expect = "import" | "reject";
export type BuildOpts = { small?: boolean };
export type Fixture = {
  /** Uncompressed bytes of every entry added as a whole (O1 folder form). Streamed multi-MB padding entries
   *  (N4 images are included; N5 archive.bin and E9 zeros.bin are not) and E1/E2 (no entries) are omitted. */
  files: Map<string, Uint8Array>;
  zip: Uint8Array;
  sourceCounts: SourceCounts;
  expect: Expect;
  notes: string;
};
export const FIXTURE_FILES: Record<FixtureName, string> = {
  N1: "notion-md.zip",
  N2: "notion-html.zip",
  N3: "notion-parts.zip",
  N4: "notion-large.zip",
  N5: "notion-overcap.zip",
  O1: "obsidian-vault.zip",
  E1: "empty.zip",
  E2: "broken.zip",
  E3: "traversal.zip",
  E4: "script.zip",
  E5: "cycle.zip",
  E6: "collide.zip",
  E7: "bigcsv.zip",
  E8: "encoding.zip",
  E9: "zipbomb.zip",
  E10: "nested-deep.zip",
};
const FIXTURE_KIND: Record<FixtureName, string> = {
  N1: "notion-markdown-csv",
  N2: "notion-html",
  N3: "notion-markdown-csv-parts",
  N4: "notion-markdown-csv-large",
  N5: "notion-markdown-csv-overcap",
  O1: "obsidian-vault-zip",
  E1: "edge",
  E2: "edge",
  E3: "edge",
  E4: "edge",
  E5: "edge",
  E6: "edge",
  E7: "edge",
  E8: "edge",
  E9: "edge",
  E10: "edge",
};
export const FIXTURE_NAMES = Object.keys(FIXTURE_FILES) as FixtureName[];

// ---------------------------------------------------------------- primitives
const enc = new TextEncoder();
const utf8 = (s: string): Uint8Array => enc.encode(s);
const MIB = 1024 * 1024;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

function randomBytes(seed: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const r = rng(seed);
  const words = new Uint32Array(out.buffer, 0, n >>> 2);
  for (let i = 0; i < words.length; i++) words[i] = r();
  for (let i = words.length * 4; i < n; i++) out[i] = r() & 0xff;
  return out;
}

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Uint8Array, prev = 0): number {
  let c = ~prev;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function deflateRaw(chunks: Iterable<Uint8Array>): Promise<Uint8Array> {
  const it = chunks[Symbol.iterator]();
  const rs = new ReadableStream<BufferSource>({
    pull(ctrl) {
      const n = it.next();
      if (n.done) ctrl.close();
      else ctrl.enqueue(new Uint8Array(n.value.buffer as ArrayBuffer, n.value.byteOffset, n.value.byteLength));
    },
  });
  const s = rs.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** 32-hex Notion-style id derived from a label (md5), stable across runs. */
const hid = (label: string): string => createHash("md5").update(label).digest("hex");
const EXPORT_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const ROOT = `Export-${EXPORT_UUID}`;
/** Notion-style link path: each segment percent-encoded (space -> %20, non-ASCII -> UTF-8 bytes). */
const encPath = (p: string): string => p.split("/").map((s) => (s === ".." ? s : encodeURIComponent(s))).join("/");
/** Relative path from the directory containing `from` to `to` (both zip paths). */
function rel(from: string, to: string): string {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

// ---------------------------------------------------------------- zip writer (sink-based: memory or file)
type Sink = { write(b: Uint8Array): void; close(): void };
class MemorySink implements Sink {
  private chunks: Uint8Array[] = [];
  write(b: Uint8Array): void {
    this.chunks.push(b);
  }
  close(): void {}
  bytes(): Uint8Array {
    return concat(this.chunks);
  }
}
class FileSink implements Sink {
  private fd: number;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, "w");
  }
  write(b: Uint8Array): void {
    let off = 0;
    while (off < b.length) off += writeSync(this.fd, b, off, b.length - off);
  }
  close(): void {
    closeSync(this.fd);
  }
}

type ZipEntry = {
  nameBytes: Uint8Array;
  utf8Flag: boolean;
  method: 0 | 8;
  crc: number;
  compSize: number;
  size: number;
  body: Iterable<Uint8Array>;
};
const DOS_TIME = (12 << 11) | (0 << 5) | 0; // 12:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 23; // 2026-10-23

class ZipWriter {
  private offset = 0;
  private central: Uint8Array[] = [];
  private n = 0;
  /** Uncompressed content of whole-buffer entries, keyed by entry name (see Fixture.files). */
  readonly files = new Map<string, Uint8Array>();
  constructor(private sink: Sink) {}
  private write(b: Uint8Array): void {
    this.sink.write(b);
    this.offset += b.length;
  }
  entry(e: ZipEntry): void {
    const flags = e.utf8Flag ? 0x0800 : 0;
    const local = new Uint8Array(30 + e.nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, e.method, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, e.crc, true);
    lv.setUint32(18, e.compSize, true);
    lv.setUint32(22, e.size, true);
    lv.setUint16(26, e.nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(e.nameBytes, 30);
    const cen = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.compSize, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, e.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, this.offset, true);
    cen.set(e.nameBytes, 46);
    this.write(local);
    let written = 0;
    for (const chunk of e.body) {
      this.write(chunk);
      written += chunk.length;
    }
    if (written !== e.compSize) throw new Error(`zip body size mismatch for ${new TextDecoder().decode(e.nameBytes)}`);
    this.central.push(cen);
    this.n++;
  }
  /** Normal entry: name is UTF-8; data compressed with deflate-raw unless method 0. */
  async add(name: string, data: string | Uint8Array, method: 0 | 8 = 8): Promise<void> {
    const raw = typeof data === "string" ? utf8(data) : data;
    const body = method === 8 ? await deflateRaw([raw]) : raw;
    this.files.set(name, raw);
    this.entry({ nameBytes: utf8(name), utf8Flag: true, method, crc: crc32(raw), compSize: body.length, size: raw.length, body: [body] });
  }
  /** Entry whose name bytes are NOT UTF-8 (legacy code page), stored; recorded in files under the latin1 reading. */
  addLegacyName(nameBytes: Uint8Array, data: string): void {
    const raw = utf8(data);
    this.files.set(new TextDecoder("latin1").decode(nameBytes), raw);
    this.entry({ nameBytes, utf8Flag: false, method: 0, crc: crc32(raw), compSize: raw.length, size: raw.length, body: [raw] });
  }
  /** Stored entry streamed from a chunk factory (called twice: once for CRC, once to write); not recorded in files. */
  addStoredChunks(name: string, size: number, chunks: () => Iterable<Uint8Array>): void {
    let crc = 0;
    for (const c of chunks()) crc = crc32(c, crc);
    this.entry({ nameBytes: utf8(name), utf8Flag: true, method: 0, crc, compSize: size, size, body: chunks() });
  }
  close(): number {
    const cdStart = this.offset;
    for (const c of this.central) this.write(c);
    const cdSize = this.offset - cdStart;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.n, true);
    ev.setUint16(10, this.n, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    ev.setUint16(20, 0, true);
    this.write(end);
    this.sink.close();
    return this.offset;
  }
}

type VFile = { name: string; data: string | Uint8Array; method?: 0 | 8 };
async function addAll(z: ZipWriter, files: VFile[]): Promise<void> {
  for (const f of files) await z.add(f.name, f.data, f.method ?? (typeof f.data === "string" ? 8 : 0));
}
async function zipBytes(files: VFile[]): Promise<Uint8Array> {
  const sink = new MemorySink();
  const z = new ZipWriter(sink);
  await addAll(z, files);
  z.close();
  return sink.bytes();
}

// ---------------------------------------------------------------- counters
class Counter {
  c: SourceCounts = {
    pages: 0,
    databases: 0,
    dbRows: 0,
    internalLinks: 0,
    internalLinksToMissing: 0,
    images: 0,
    attachments: 0,
    tags: 0,
    embedsNote: 0,
    callouts: 0,
    equations: 0,
    codeBlocks: 0,
    todos: 0,
  };
  private tagSet = new Set<string>();
  private attSet = new Set<string>();
  page(): void {
    this.c.pages++;
  }
  tag(name: string): string {
    this.tagSet.add(name.toLowerCase());
    this.c.tags = this.tagSet.size;
    return name;
  }
  attachment(key: string): void {
    this.attSet.add(key);
    this.c.attachments = this.attSet.size;
  }
  // markdown helpers (each returns the markdown it counted)
  link(text: string, target: string): string {
    this.c.internalLinks++;
    return `[${text}](${target})`;
  }
  missingLink(text: string, target: string): string {
    this.c.internalLinksToMissing++;
    return `[${text}](${target})`;
  }
  wiki(target: string, display?: string, missing = false): string {
    if (missing) this.c.internalLinksToMissing++;
    else this.c.internalLinks++;
    return display === undefined ? `[[${target}]]` : `[[${target}|${display}]]`;
  }
  image(alt: string, target: string): string {
    this.c.images++;
    return `![${alt}](${target})`;
  }
  wikiImage(target: string): string {
    this.c.images++;
    return `![[${target}]]`;
  }
  embedNote(target: string): string {
    this.c.embedsNote++;
    return `![[${target}]]`;
  }
  fileLink(text: string, target: string, key = target): string {
    this.attachment(key);
    return `[${text}](${target})`;
  }
  wikiFile(target: string): string {
    this.attachment(target);
    return `![[${target}]]`;
  }
  callout(md: string): string {
    this.c.callouts++;
    return md;
  }
  equation(md: string): string {
    this.c.equations++;
    return md;
  }
  code(lang: string, body: string): string {
    this.c.codeBlocks++;
    return "```" + lang + "\n" + body + "\n```";
  }
  todo(done: boolean, text: string): string {
    this.c.todos++;
    return `- [${done ? "x" : " "}] ${text}`;
  }
}

// ---------------------------------------------------------------- binary assets
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const t = utf8(type);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(data, crc32(t)), false);
  return concat([len, t, data, crc]);
}
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function ihdr(w: number, h: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, w, false);
  v.setUint32(4, h, false);
  d[8] = 8; // bit depth
  d[9] = 2; // RGB
  return pngChunk("IHDR", d);
}
/** Real, decodable RGB PNG with seeded pixel noise. */
function smallPng(w: number, h: number, seed: number): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 3));
  const r = rng(seed);
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w * 3; x++) raw[row + 1 + x] = (r() >>> 24) & 0xff;
  }
  return concat([PNG_SIG, ihdr(w, h), pngChunk("IDAT", new Uint8Array(deflateSync(raw))), pngChunk("IEND", new Uint8Array(0))]);
}
/** PNG header + IHDR + one IDAT whose payload is random (incompressible) bytes; not decodable, but a valid chunk stream. */
function bigFakePng(bytes: number, seed: number): Uint8Array {
  const head = concat([PNG_SIG, ihdr(1024, 1024)]);
  const payload = randomBytes(seed, bytes - head.length - 12 - 12);
  return concat([head, pngChunk("IDAT", payload), pngChunk("IEND", new Uint8Array(0))]);
}
function jpegLike(bytes: number, seed: number): Uint8Array {
  const soi = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00]);
  return concat([soi, randomBytes(seed, bytes - soi.length - 2), new Uint8Array([0xff, 0xd9])]);
}
function pdfLike(title: string, padBytes = 0, seed = 1): Uint8Array {
  const body =
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >> endobj\n` +
    `4 0 obj << /Length 44 >> stream\nBT /F1 12 Tf 20 50 Td (${title}) Tj ET\nendstream endobj\n`;
  const tail = `trailer << /Root 1 0 R >>\n%%EOF\n`;
  const pad =
    padBytes > 0
      ? concat([utf8("5 0 obj << /Length " + padBytes + " >> stream\n"), randomBytes(seed, padBytes), utf8("\nendstream endobj\n")])
      : new Uint8Array(0);
  return concat([utf8(body), pad, utf8(tail)]);
}

// ---------------------------------------------------------------- csv
function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvRow = (fields: string[]): string => fields.map(csvField).join(",");

// ---------------------------------------------------------------- Notion N1 content model (shared by N1 md, N2 html, N5)
const ID = {
  home: hid("home"),
  db: hid("projects-db"),
  web: hid("website-redesign"),
  mobile: hid("mobile-app"),
  brand: hid("brand-refresh"),
  meeting: hid("meeting-notes"),
  school: hid("school-assessment"),
  missing: hid("old-roadmap-not-exported"),
  shared: hid("shared-external-doc"),
};
const NAMES = {
  home: `Home ${ID.home}`,
  db: `Projects ${ID.db}`,
  web: `Website redesign ${ID.web}`,
  mobile: `Mobile app ${ID.mobile}`,
  brand: `Brand refresh ${ID.brand}`,
  meeting: `Meeting notes ${ID.meeting}`,
  school: `학교 수행평가 📚 ${ID.school}`,
  missing: `Old roadmap ${ID.missing}`,
};
type PropType = "status" | "select" | "multi_select" | "person" | "date" | "checkbox" | "number" | "url" | "email" | "relation" | "created_time";
type Prop = { key: string; type: PropType; value: string; relation?: { title: string; name: string }[] };
type DbRow = { title: string; name: string; props: Prop[] };
const DB_ROWS: DbRow[] = [
  {
    title: "Website redesign",
    name: NAMES.web,
    props: [
      { key: "Status", type: "status", value: "In progress" },
      { key: "Priority", type: "select", value: "High" },
      { key: "Tags", type: "multi_select", value: "Design, Frontend" },
      { key: "Owner", type: "person", value: "Jane Doe" },
      { key: "Due", type: "date", value: "October 23, 2026 3:00 PM → October 30, 2026 5:00 PM" },
      { key: "Done", type: "checkbox", value: "No" },
      { key: "Budget", type: "number", value: "$12,500" },
      { key: "Progress", type: "number", value: "15%" },
      { key: "Site", type: "url", value: "https://example.com" },
      { key: "Contact", type: "email", value: "jane@example.com" },
      { key: "Related", type: "relation", value: "", relation: [{ title: "Mobile app", name: NAMES.mobile }] },
      { key: "Created time", type: "created_time", value: "October 1, 2026 9:12 AM" },
    ],
  },
  {
    title: "Mobile app",
    name: NAMES.mobile,
    props: [
      { key: "Status", type: "status", value: "Not started" },
      { key: "Priority", type: "select", value: "Medium" },
      { key: "Tags", type: "multi_select", value: "Mobile" },
      { key: "Owner", type: "person", value: "Kim Minsu" },
      { key: "Due", type: "date", value: "October 23, 2026 3:00 PM" },
      { key: "Done", type: "checkbox", value: "No" },
      { key: "Budget", type: "number", value: "$8,000" },
      { key: "Progress", type: "number", value: "0%" },
      { key: "Site", type: "url", value: "https://example.org/app" },
      { key: "Contact", type: "email", value: "minsu@example.com" },
      {
        key: "Related",
        type: "relation",
        value: "",
        relation: [
          { title: "Website redesign", name: NAMES.web },
          { title: "Brand refresh", name: NAMES.brand },
        ],
      },
      { key: "Created time", type: "created_time", value: "October 2, 2026 10:00 AM" },
    ],
  },
  {
    title: "Brand refresh",
    name: NAMES.brand,
    props: [
      { key: "Status", type: "status", value: "Done" },
      { key: "Priority", type: "select", value: "Low" },
      { key: "Tags", type: "multi_select", value: "Design" },
      { key: "Owner", type: "person", value: "Jane Doe, Kim Minsu" },
      { key: "Due", type: "date", value: "2026년 10월 23일 오후 3:00" },
      { key: "Done", type: "checkbox", value: "Yes" },
      { key: "Budget", type: "number", value: "$1,200.50" },
      { key: "Progress", type: "number", value: "100%" },
      { key: "Site", type: "url", value: "https://example.net" },
      { key: "Contact", type: "email", value: "brand@example.com" },
      { key: "Related", type: "relation", value: "", relation: [] },
      { key: "Created time", type: "created_time", value: "2026년 9월 21일 오후 1:22" },
    ],
  },
];
const DB_HEADER = ["Name", ...DB_ROWS[0].props.map((p) => p.key)];

/** Markdown&CSV export file list under `root`, tallying counts into `c`. */
function notionMarkdownFiles(c: Counter, root = ROOT): VFile[] {
  const homeDir = `${root}/${NAMES.home}`;
  const projDir = `${homeDir}/${NAMES.db}`;
  const P = {
    home: `${root}/${NAMES.home}.md`,
    projStub: `${homeDir}/${NAMES.db}.md`,
    projCsv: `${homeDir}/${NAMES.db}.csv`,
    projAll: `${homeDir}/${NAMES.db}_all.csv`,
    web: `${projDir}/${NAMES.web}.md`,
    mobile: `${projDir}/${NAMES.mobile}.md`,
    brand: `${projDir}/${NAMES.brand}.md`,
    meeting: `${projDir}/${NAMES.web}/${NAMES.meeting}.md`,
    mockup: `${projDir}/${NAMES.web}/mockup.png`,
    photo: `${projDir}/${NAMES.web}/photo.jpg`,
    brief: `${projDir}/${NAMES.web}/brief.pdf`,
    school: `${homeDir}/${NAMES.school}.md`,
    chart: `${homeDir}/${NAMES.school}/chart.png`,
    missing: `${homeDir}/${NAMES.missing}.md`,
  };
  const L = (from: string, to: string) => encPath(rel(from, to));
  const files: VFile[] = [];

  // Home
  c.page();
  files.push({
    name: P.home,
    data: [
      "# Home",
      "",
      "Welcome to the synthetic workspace. **Bold**, *italic*, `code`, [example](https://example.com).",
      "",
      "## Pages",
      "",
      c.link("Projects", L(P.home, P.projStub)),
      "",
      c.link("학교 수행평가 📚", L(P.home, P.school)),
      "",
      c.missingLink("Old roadmap", L(P.home, P.missing)),
      "",
      `[Shared doc](https://www.notion.so/Shared-doc-${ID.shared}?pvs=21)`,
      "",
      c.todo(false, "Review projects"),
      c.todo(true, "Set up workspace"),
      "",
      "---",
      "",
      "> Synthetic quote for QA.",
      "",
    ].join("\n"),
  });

  // Projects: database stub page + csv + _all.csv
  c.page();
  files.push({ name: P.projStub, data: `# Projects\n\n[Projects](${encPath(rel(P.projStub, P.projAll))})\n` });
  c.c.databases++;
  const csvRows = DB_ROWS.map((row) =>
    csvRow([
      row.title,
      ...row.props.map((p) =>
        p.type === "relation" ? (p.relation ?? []).map((r) => `${r.title} (${encPath(`${NAMES.home}/${NAMES.db}/${r.name}.md`)})`).join(", ") : p.value,
      ),
    ]),
  );
  c.c.dbRows += DB_ROWS.length;
  files.push({ name: P.projAll, data: [csvRow(DB_HEADER), ...csvRows].join("\n") + "\n" });
  files.push({ name: P.projCsv, data: [csvRow(DB_HEADER), ...csvRows.slice(0, 2)].join("\n") + "\n" });

  const propLines = (row: DbRow, from: string): string =>
    row.props
      .map((p) => {
        const v = p.type === "relation" ? (p.relation ?? []).map((r) => `${r.title} (${L(from, `${projDir}/${r.name}.md`)})`).join(", ") : p.value;
        return v ? `${p.key}: ${v}` : null;
      })
      .filter((x): x is string => x !== null)
      .join("\n");

  // Website redesign (row page with the full block zoo)
  c.page();
  files.push({
    name: P.web,
    data: [
      "# Website redesign",
      "",
      propLines(DB_ROWS[0], P.web),
      "",
      c.callout(`<aside>\n💡 Kickoff notes live in ${c.link("Meeting notes", L(P.web, P.meeting))}.\n\n</aside>`),
      "",
      "## Goals",
      "",
      "Ship the new site with **bold** claims, *italic* nuance, `inline code` and a [link](https://example.com).",
      "",
      "- Toggle summary",
      "    Hidden child paragraph inside the toggle.",
      "",
      c.image(encPath(`${NAMES.web}/mockup.png`), L(P.web, P.mockup)),
      "",
      c.image(encPath(`${NAMES.web}/photo.jpg`), L(P.web, P.photo)),
      "",
      c.fileLink("brief.pdf", L(P.web, P.brief), "brief.pdf"),
      "",
      c.equation("$$\nE = mc^2\n$$"),
      "",
      c.code("typescript", "export const greet = (name: string) => `hi ${name}`;"),
      "",
      "### Checklist",
      "",
      c.todo(false, "Wireframes"),
      c.todo(true, "Kickoff"),
      c.todo(false, "Copy review"),
      "",
      "| Task | Owner | Done |",
      "| --- | --- | --- |",
      "| Wireframes | Jane | No |",
      "| Copy | Minsu | Yes |",
      "",
      "---",
      "",
      "> Quote: design is how it works.",
      "",
      `See also ${c.link("학교 수행평가 📚", L(P.web, P.school))}.`,
      "",
    ].join("\n"),
  });
  files.push({ name: P.mockup, data: smallPng(16, 16, 101) });
  files.push({ name: P.photo, data: jpegLike(2048, 102) });
  files.push({ name: P.brief, data: pdfLike("Brief") });

  // Meeting notes (3rd level)
  c.page();
  files.push({
    name: P.meeting,
    data: [
      "# Meeting notes",
      "",
      `Back to ${c.link("Website redesign", L(P.meeting, P.web))} or ${c.link("Home", L(P.meeting, P.home))}.`,
      "",
      "## Decisions",
      "",
      c.todo(true, "Agree on palette"),
      c.todo(false, "Book user tests"),
      "",
      c.code("bash", "bun test"),
      "",
      "- Toggle: parking lot",
      "    Items we did not get to.",
      "",
    ].join("\n"),
  });

  // Other rows
  c.page();
  files.push({
    name: P.mobile,
    data: ["# Mobile app", "", propLines(DB_ROWS[1], P.mobile), "", `Depends on ${c.link("Website redesign", L(P.mobile, P.web))}.`, ""].join("\n"),
  });
  c.page();
  files.push({
    name: P.brand,
    data: ["# Brand refresh", "", propLines(DB_ROWS[2], P.brand), "", "브랜드 작업은 완료되었습니다.", ""].join("\n"),
  });

  // Korean + emoji page
  c.page();
  files.push({
    name: P.school,
    data: [
      "# 학교 수행평가 📚",
      "",
      `${c.link("홈으로", L(P.school, P.home))} 돌아가기.`,
      "",
      c.callout("<aside>\n📌 제출 기한: 2026년 10월 30일\n\n</aside>"),
      "",
      c.image(encPath(`${NAMES.school}/chart.png`), L(P.school, P.chart)),
      "",
      c.todo(false, "자료 조사"),
      c.todo(true, "주제 선정"),
      "",
      c.equation("$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$"),
      "",
    ].join("\n"),
  });
  files.push({ name: P.chart, data: smallPng(24, 12, 103) });
  return files;
}

// ---------------------------------------------------------------- Notion N2 HTML
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dashed = (id: string): string => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
function htmlPage(id: string, title: string, propsHtml: string, body: string): string {
  return (
    `<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>/* notion css */ body{font-family:sans-serif}</style></head>\n` +
    `<body><article id="${dashed(id)}" class="page sans"><header><h1 class="page-title">${esc(title)}</h1><p class="page-description"></p>` +
    `<table class="properties"><tbody>${propsHtml}</tbody></table></header>\n<div class="page-body">\n${body}\n</div></article></body></html>\n`
  );
}
function propValueHtml(p: Prop, hrefOf: (name: string) => string, c: Counter): string {
  switch (p.type) {
    case "status":
      return `<span class="status-value"><div class="status-dot status-dot-color-blue"></div>${esc(p.value)}</span>`;
    case "select":
      return `<span class="selected-value select-value-color-blue">${esc(p.value)}</span>`;
    case "multi_select":
      return p.value
        .split(", ")
        .map((v) => `<span class="selected-value select-value-color-green">${esc(v)}</span>`)
        .join("");
    case "person":
      return p.value
        .split(", ")
        .map((v) => `<span class="user">${esc(v)}</span>`)
        .join(", ");
    case "date":
    case "created_time":
      return `<time>@${esc(p.value)}</time>`;
    case "checkbox":
      return `<div class="checkbox checkbox-${p.value === "Yes" ? "on" : "off"}"></div>`;
    case "url":
      return `<a href="${esc(p.value)}">${esc(p.value)}</a>`;
    case "email":
      return `<a href="mailto:${esc(p.value)}">${esc(p.value)}</a>`;
    case "relation":
      return (p.relation ?? [])
        .map((r) => {
          c.c.internalLinks++;
          return `<a href="${hrefOf(r.name)}">${esc(r.title)}</a>`;
        })
        .join(", ");
    case "number":
      return esc(p.value);
  }
}
function propsTable(row: DbRow, hrefOf: (name: string) => string, c: Counter): string {
  return row.props
    .filter((p) => p.type !== "relation" || (p.relation ?? []).length > 0)
    .map(
      (p) =>
        `<tr class="property-row property-row-${p.type}"><th><span class="icon property-icon"></span>${esc(p.key)}</th><td>${propValueHtml(p, hrefOf, c)}</td></tr>`,
    )
    .join("");
}
const SVG_TYPE: Record<PropType, string> = {
  status: "typesStatus",
  select: "typesSelect",
  multi_select: "typesMultipleSelect",
  person: "typesPerson",
  date: "typesDate",
  checkbox: "typesCheckbox",
  number: "typesNumber",
  url: "typesUrl",
  email: "typesEmail",
  relation: "typesRelation",
  created_time: "typesCreatedTime",
};

function notionHtmlFiles(c: Counter, root = ROOT): VFile[] {
  const homeDir = `${root}/${NAMES.home}`;
  const projDir = `${homeDir}/${NAMES.db}`;
  const P = {
    index: `${root}/index.html`,
    home: `${root}/${NAMES.home}.html`,
    proj: `${homeDir}/${NAMES.db}.html`,
    projCsv: `${homeDir}/${NAMES.db}.csv`,
    projAll: `${homeDir}/${NAMES.db}_all.csv`,
    web: `${projDir}/${NAMES.web}.html`,
    mobile: `${projDir}/${NAMES.mobile}.html`,
    brand: `${projDir}/${NAMES.brand}.html`,
    meeting: `${projDir}/${NAMES.web}/${NAMES.meeting}.html`,
    mockup: `${projDir}/${NAMES.web}/mockup.png`,
    photo: `${projDir}/${NAMES.web}/photo.jpg`,
    brief: `${projDir}/${NAMES.web}/brief.pdf`,
    school: `${homeDir}/${NAMES.school}.html`,
    chart: `${homeDir}/${NAMES.school}/chart.png`,
    missing: `${homeDir}/${NAMES.missing}.html`,
  };
  const L = (from: string, to: string) => encPath(rel(from, to));
  const a = (from: string, to: string, text: string, missing = false): string => {
    if (missing) c.c.internalLinksToMissing++;
    else c.c.internalLinks++;
    return `<a href="${L(from, to)}">${esc(text)}</a>`;
  };
  const img = (from: string, to: string): string => {
    c.c.images++;
    return `<figure id="${dashed(hid(to))}" class="image"><a href="${L(from, to)}"><img style="width:480px" src="${L(from, to)}"/></a></figure>`;
  };
  const todo = (done: boolean, text: string): string => {
    c.c.todos++;
    return `<ul id="${dashed(hid("todo:" + text))}" class="to-do-list"><li><div class="checkbox checkbox-${done ? "on" : "off"}"></div> <span class="to-do-children-${done ? "checked" : "unchecked"}">${esc(text)}</span><div class="indented"></div></li></ul>`;
  };
  const callout = (icon: string, inner: string): string => {
    c.c.callouts++;
    return `<figure class="block-color-gray_background callout" style="white-space:pre-wrap;display:flex" id="${dashed(hid("callout:" + inner))}"><div style="font-size:1.5em"><span class="icon">${icon}</span></div><div style="width:100%">${inner}</div></figure>`;
  };
  const equation = (tex: string): string => {
    c.c.equations++;
    return `<figure id="${dashed(hid("eq:" + tex))}" class="equation"><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow></mrow><annotation encoding="application/x-tex">${esc(tex)}</annotation></semantics></math></span></span></span></div></figure>`;
  };
  const code = (lang: string, body: string): string => {
    c.c.codeBlocks++;
    return `<pre id="${dashed(hid("code:" + body))}" class="code"><code class="language-${lang}">${esc(body)}</code></pre>`;
  };
  const p = (inner: string): string => `<p id="${dashed(hid("p:" + inner))}" class="">${inner}</p>`;
  const files: VFile[] = [];

  files.push({
    name: P.index,
    data: `<html><head><meta charset="utf-8"><title>Export</title></head><body><h1>Workspace export</h1><ul><li><a href="${L(P.index, P.home)}">Home</a></li></ul></body></html>\n`,
  });

  c.page();
  files.push({
    name: P.home,
    data: htmlPage(
      ID.home,
      "Home",
      "",
      [
        p(`Welcome to the synthetic workspace. <strong>Bold</strong>, <em>italic</em>, <code>code</code>, <a href="https://example.com">example</a>.`),
        `<h2 id="${dashed(hid("h2:pages"))}" class="">Pages</h2>`,
        `<figure id="${dashed(hid("ltp:proj"))}" class="link-to-page">${a(P.home, P.proj, "Projects")}</figure>`,
        `<figure id="${dashed(hid("ltp:school"))}" class="link-to-page">${a(P.home, P.school, "학교 수행평가 📚")}</figure>`,
        `<figure id="${dashed(hid("ltp:missing"))}" class="link-to-page">${a(P.home, P.missing, "Old roadmap", true)}</figure>`,
        p(`<a href="https://www.notion.so/Shared-doc-${ID.shared}?pvs=21">Shared doc</a>`),
        todo(false, "Review projects"),
        todo(true, "Set up workspace"),
        `<hr id="${dashed(hid("hr:home"))}"/>`,
        `<blockquote id="${dashed(hid("q:home"))}" class="">Synthetic quote for QA.</blockquote>`,
      ].join("\n"),
    ),
  });

  // Projects database page: collection table + csv files
  c.page();
  c.c.databases++;
  c.c.dbRows += DB_ROWS.length;
  const hrefFromProj = (name: string) => encPath(`${NAMES.db}/${name}.html`);
  const thead = `<thead><tr>${["Name", ...DB_ROWS[0].props.map((pp) => pp.key)]
    .map((k, i) => `<th><span class="icon property-icon"><svg class="${i === 0 ? "typesTitle" : SVG_TYPE[DB_ROWS[0].props[i - 1].type]}"></svg></span>${esc(k)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = DB_ROWS.map((row) => {
    c.c.internalLinks++;
    const cells = row.props.map((pp) => `<td class="cell-${hid(pp.key).slice(0, 4)}">${propValueHtml(pp, hrefFromProj, c)}</td>`).join("");
    return `<tr id="${dashed(hid("row:" + row.title))}"><td class="cell-title"><a href="${hrefFromProj(row.name)}">${esc(row.title)}</a></td>${cells}</tr>`;
  }).join("\n");
  files.push({
    name: P.proj,
    data: htmlPage(
      ID.db,
      "Projects",
      "",
      `<div id="${dashed(hid("coll:projects"))}" class="collection-content"><h4 class="collection-title">All projects</h4><table class="collection-content">${thead}<tbody>\n${tbody}\n</tbody></table></div>`,
    ),
  });
  const csvRows = DB_ROWS.map((row) =>
    csvRow([
      row.title,
      ...row.props.map((pp) =>
        pp.type === "relation" ? (pp.relation ?? []).map((r) => `${r.title} (${encPath(`${NAMES.home}/${NAMES.db}/${r.name}.html`)})`).join(", ") : pp.value,
      ),
    ]),
  );
  files.push({ name: P.projAll, data: [csvRow(DB_HEADER), ...csvRows].join("\n") + "\n" });
  files.push({ name: P.projCsv, data: [csvRow(DB_HEADER), ...csvRows.slice(0, 2)].join("\n") + "\n" });

  const hrefSibling = (name: string) => encPath(`${name}.html`);
  c.page();
  c.attachment("brief.pdf");
  files.push({
    name: P.web,
    data: htmlPage(
      ID.web,
      "Website redesign",
      propsTable(DB_ROWS[0], hrefSibling, c),
      [
        callout("💡", `Kickoff notes live in ${a(P.web, P.meeting, "Meeting notes")}.`),
        `<h2 id="${dashed(hid("h2:goals"))}" class="">Goals</h2>`,
        p(`Ship the new site with <strong>bold</strong> claims, <em>italic</em> nuance, <code>inline code</code> and a <a href="https://example.com">link</a>.`),
        `<ul id="${dashed(hid("toggle:1"))}" class="toggle"><li><details open=""><summary>Toggle summary</summary>${p("Hidden child paragraph inside the toggle.")}</details></li></ul>`,
        img(P.web, P.mockup),
        img(P.web, P.photo),
        `<figure id="${dashed(hid("file:brief"))}"><div class="source"><a href="${L(P.web, P.brief)}">brief.pdf</a></div></figure>`,
        equation("E = mc^2"),
        code("TypeScript", "export const greet = (name: string) => `hi ${name}`;"),
        `<h3 id="${dashed(hid("h3:checklist"))}" class="">Checklist</h3>`,
        todo(false, "Wireframes"),
        todo(true, "Kickoff"),
        todo(false, "Copy review"),
        `<table id="${dashed(hid("table:1"))}" class="simple-table"><tbody><tr id="r1"><td class="simple-table-header-color">Task</td><td>Owner</td><td>Done</td></tr><tr id="r2"><td>Wireframes</td><td>Jane</td><td>No</td></tr><tr id="r3"><td>Copy</td><td>Minsu</td><td>Yes</td></tr></tbody></table>`,
        `<hr id="${dashed(hid("hr:web"))}"/>`,
        `<blockquote id="${dashed(hid("q:web"))}" class="">Quote: design is how it works.</blockquote>`,
        p(`See also ${a(P.web, P.school, "학교 수행평가 📚")}.`),
      ].join("\n"),
    ),
  });
  files.push({ name: P.mockup, data: smallPng(16, 16, 101) });
  files.push({ name: P.photo, data: jpegLike(2048, 102) });
  files.push({ name: P.brief, data: pdfLike("Brief") });

  c.page();
  files.push({
    name: P.meeting,
    data: htmlPage(
      ID.meeting,
      "Meeting notes",
      "",
      [
        p(`Back to ${a(P.meeting, P.web, "Website redesign")} or ${a(P.meeting, P.home, "Home")}.`),
        `<h2 id="${dashed(hid("h2:decisions"))}" class="">Decisions</h2>`,
        todo(true, "Agree on palette"),
        todo(false, "Book user tests"),
        code("Bash", "bun test"),
        `<ul id="${dashed(hid("toggle:2"))}" class="toggle"><li><details open=""><summary>Toggle: parking lot</summary>${p("Items we did not get to.")}</details></li></ul>`,
      ].join("\n"),
    ),
  });

  c.page();
  files.push({
    name: P.mobile,
    data: htmlPage(ID.mobile, "Mobile app", propsTable(DB_ROWS[1], hrefSibling, c), p(`Depends on ${a(P.mobile, P.web, "Website redesign")}.`)),
  });
  c.page();
  files.push({ name: P.brand, data: htmlPage(ID.brand, "Brand refresh", propsTable(DB_ROWS[2], hrefSibling, c), p("브랜드 작업은 완료되었습니다.")) });

  c.page();
  files.push({
    name: P.school,
    data: htmlPage(
      ID.school,
      "학교 수행평가 📚",
      "",
      [
        p(`${a(P.school, P.home, "홈으로")} 돌아가기.`),
        callout("📌", "제출 기한: 2026년 10월 30일"),
        img(P.school, P.chart),
        todo(false, "자료 조사"),
        todo(true, "주제 선정"),
        equation("\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}"),
      ].join("\n"),
    ),
  });
  files.push({ name: P.chart, data: smallPng(24, 12, 103) });
  return files;
}

// ---------------------------------------------------------------- Obsidian vault
function obsidianFiles(c: Counter): VFile[] {
  const files: VFile[] = [];
  const note = (path: string, body: string): void => {
    c.page();
    files.push({ name: path, data: body });
  };
  files.push({
    name: ".obsidian/app.json",
    data: JSON.stringify({ attachmentFolderPath: "attachments", useMarkdownLinks: false, newLinkFormat: "shortest", alwaysUpdateLinks: true }, null, 2) + "\n",
  });
  files.push({
    name: ".obsidian/workspace.json",
    data:
      JSON.stringify(
        {
          main: {
            id: "main-1",
            type: "split",
            children: [{ id: "leaf-1", type: "leaf", state: { type: "markdown", state: { file: "Home.md", mode: "source" } } }],
            direction: "vertical",
          },
          active: "leaf-1",
          lastOpenFiles: ["Home.md", "Projects/README.md", "일기/2026-10-23.md"],
        },
        null,
        2,
      ) + "\n",
  });

  note(
    "Home.md",
    [
      "---",
      "tags:",
      `  - ${c.tag("home")}`,
      `  - ${c.tag("area/school")}`,
      "aliases:",
      "  - Start",
      "  - 홈",
      "date: 2026-10-23",
      "rating: 4",
      "done: true",
      "cssclasses:",
      "  - wide",
      "---",
      "# Home",
      "",
      `Welcome. Projects live in ${c.wiki("Projects/README", "Projects")} and the archive in ${c.wiki("Archive/README")}.`,
      `Ambiguous bare link: ${c.wiki("README")} (two notes share this basename).`,
      `Daily note: ${c.wiki("일기/2026-10-23")}. Missing target: ${c.wiki("Does not exist", undefined, true)}.`,
      `Heading link ${c.wiki("Projects/Website redesign#Goals")} and block link ${c.wiki("Notes/Ideas#^idea1")}.`,
      `Markdown-style link ${c.link("spec", "Projects/Website%20redesign.md")}.`,
      "",
      `Inline tags: #${c.tag("home")} #${c.tag("area/school")} #${c.tag("qa")}`,
      "",
      c.wikiImage("photo.png"),
      c.wikiImage("photo.png|300"),
      c.wikiFile("spec.pdf"),
      c.embedNote("Notes/Ideas"),
      "",
      c.callout("> [!note] Title\n> A note callout with ==highlighted== text."),
      "",
      "%%This whole line is a comment%%",
      "",
      c.todo(false, "Open task"),
      c.todo(true, "Closed task"),
      "",
    ].join("\n"),
  );

  note(
    "Projects/README.md",
    [
      "---",
      "tags:",
      `  - ${c.tag("projects")}`,
      "---",
      "# Projects",
      "",
      `Overview of ${c.wiki("Projects/Website redesign")} and ${c.wiki("Projects/Mobile app", "the app")}.`,
      `Old plans: ${c.wiki("Archive/README", "archive index")}.`,
      "",
      "status:: active",
      "",
      c.code("dataview", 'TABLE status, rating FROM "Projects" WHERE status = "active"'),
      "",
    ].join("\n"),
  );
  note(
    "Projects/Website redesign.md",
    [
      "---",
      "date: 2026-10-23",
      "rating: 5",
      "done: false",
      "tags:",
      `  - ${c.tag("projects")}`,
      `  - ${c.tag("design")}`,
      "---",
      "# Website redesign",
      "",
      "status:: active",
      "owner:: Jane",
      "",
      "## Goals",
      "",
      "Ship the new site. ==Launch by November.== %%internal note%%",
      "",
      c.wikiImage("diagram.png|400x300"),
      "",
      c.callout("> [!warning]+ Scope\n> Expanded foldable warning."),
      "",
      c.todo(false, `#${c.tag("task")} Write report 📅 2026-10-30 ⏫`),
      c.todo(true, `#${c.tag("task")} Kickoff ✅ 2026-10-20`),
      "",
      `Related: ${c.wiki("Projects/Mobile app")}, ${c.wiki("Home")}.`,
      "",
    ].join("\n"),
  );
  note(
    "Projects/Mobile app.md",
    [
      "# Mobile app",
      "",
      `Depends on ${c.wiki("Projects/Website redesign#Goals", "the site goals")}.`,
      "",
      c.callout("> [!tip]- Hint\n> Collapsed tip."),
      "",
      `Tags: #${c.tag("projects")} #${c.tag("mobile")}`,
      "",
    ].join("\n"),
  );
  note(
    "Archive/README.md",
    ["# Archive", "", `Back to ${c.wiki("Projects/README", "current projects")}. Contents: ${c.wiki("Archive/Old plan")}.`, "", `#${c.tag("archive")}`, ""].join("\n"),
  );
  note(
    "Archive/Old plan.md",
    ["# Old plan", "", `Superseded by ${c.wiki("Projects/Website redesign")}.`, "", "~~Deprecated~~ text. Footnote[^1].", "", "[^1]: Synthetic footnote.", ""].join("\n"),
  );
  note(
    "일기/2026-10-23.md",
    [
      "---",
      "date: 2026-10-23",
      "tags:",
      `  - ${c.tag("일기")}`,
      "---",
      "# 2026-10-23",
      "",
      `어제: ${c.wiki("일기/2026-10-22")}. 홈: ${c.wiki("Home", "홈")}.`,
      "",
      `오늘 한 일 #${c.tag("area/school")}`,
      "",
      c.todo(true, "수행평가 자료 정리"),
      c.todo(false, "발표 준비"),
      "",
    ].join("\n"),
  );
  note("일기/2026-10-22.md", ["---", "date: 2026-10-22", "---", "# 2026-10-22", "", `내일: ${c.wiki("일기/2026-10-23")}.`, "", c.wikiImage("photo.png"), ""].join("\n"));
  note(
    "Notes/Ideas.md",
    [
      "# Ideas",
      "",
      "First idea paragraph. ^idea1",
      "",
      "- Idea list item",
      "- Another item",
      "",
      "^idealist",
      "",
      `Links back to ${c.wiki("Home")} and ${c.wiki("Notes/Math#^eq1", "the equation")}.`,
      "",
      "==Highlight== and %%inline comment%% in one line.",
      "",
    ].join("\n"),
  );
  note(
    "Notes/Math.md",
    [
      "# Math",
      "",
      `Inline ${c.equation("$E = mc^2$")} math and a block:`,
      "",
      c.equation("$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$"),
      "",
      "^eq1",
      "",
      c.code("mermaid", "graph TD;\n  A[Home] --> B[Projects];\n  B --> C[Website redesign];"),
      "",
    ].join("\n"),
  );
  note(
    "Notes/Dataview.md",
    [
      "# Dataview",
      "",
      "status:: draft",
      "priority:: 2",
      "",
      "Inline field in a sentence [due:: 2026-11-01].",
      "",
      c.code("dataview", 'LIST FROM #projects WHERE status = "active" SORT file.name ASC'),
      "",
    ].join("\n"),
  );
  note(
    "Notes/Tasks.md",
    [
      "# Tasks",
      "",
      c.todo(false, `#${c.tag("task")} Write QA report 📅 2026-10-30`),
      c.todo(false, `#${c.tag("task")} Review fixtures ⏳ 2026-10-28 📅 2026-10-31 🔁 every week`),
      c.todo(true, `#${c.tag("task")} Build generator ✅ 2026-10-23`),
      "",
    ].join("\n"),
  );
  note(
    "Notes/Self embed.md",
    ["# Self embed", "", "This note embeds itself (cycle):", "", c.embedNote("Notes/Self embed"), "", `And ${c.embedNote("Home#^nonexistent")} a block that does not exist.`, ""].join("\n"),
  );
  note(
    "Notes/Callouts.md",
    [
      "# Callouts",
      "",
      c.callout("> [!note] Title\n> Plain note."),
      "",
      c.callout("> [!warning]+\n> Foldable, expanded."),
      "",
      c.callout("> [!tip]-\n> Foldable, collapsed."),
      "",
      c.callout(`> [!question] Nested?\n${c.callout("> > [!example]\n> > Inner example callout.")}`),
      "",
    ].join("\n"),
  );
  note(
    "Notes/Links.md",
    [
      "# Links",
      "",
      `Plain ${c.wiki("Home")}, alias ${c.wiki("Home", "start here")}, heading ${c.wiki("Projects/Website redesign#Goals")}, block ${c.wiki("Notes/Ideas#^idealist")}.`,
      `Markdown ${c.link("mobile", "Projects/Mobile%20app.md")}, missing ${c.wiki("Ghost note", "ghost", true)}, external [site](https://example.com).`,
      "Canvas: [Board](Board.canvas)",
      "",
      "| Col | Link |",
      "| --- | --- |",
      `| a | ${c.wiki("Home", "escaped pipe").replace("|", "\\|")} |`,
      "",
    ].join("\n"),
  );
  // Board.canvas (JSON Canvas 1.0)
  files.push({
    name: "Board.canvas",
    data:
      JSON.stringify(
        {
          nodes: [
            { id: "n1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "Plan [[Home]]" },
            { id: "n2", type: "file", x: 300, y: 0, width: 400, height: 300, file: "Projects/Website redesign.md", subpath: "#Goals" },
            { id: "n3", type: "file", x: 300, y: 350, width: 300, height: 200, file: "attachments/photo.png" },
            { id: "n4", type: "link", x: 0, y: 200, width: 250, height: 60, url: "https://example.com" },
            { id: "g1", type: "group", x: -40, y: -40, width: 800, height: 700, label: "Board", color: "4" },
          ],
          edges: [
            { id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left", toEnd: "arrow", label: "details" },
            { id: "e2", fromNode: "n2", toNode: "n3", fromSide: "bottom", toSide: "top" },
          ],
        },
        null,
        2,
      ) + "\n",
  });
  files.push({ name: "attachments/photo.png", data: smallPng(32, 32, 201) });
  files.push({ name: "attachments/diagram.png", data: smallPng(40, 30, 202) });
  files.push({ name: "attachments/spec.pdf", data: pdfLike("Spec") });
  return files;
}

// ---------------------------------------------------------------- per-fixture builders
type BuildResult = { expect: Expect; notes: string };
type Builder = (z: ZipWriter, c: Counter, opts: BuildOpts) => Promise<BuildResult>;

const N1_NOTES =
  "7 pages (Home > Projects db stub > 3 row pages > Meeting notes, plus Korean/emoji page) import with 1 database of 3 rows; Old roadmap link is missing (kept as text); notion.so ?pvs=21 link stays external; mockup.png/photo.jpg/chart.png import as images, brief.pdf as attachment.";
const O1_NOTES =
  "15 notes in nested folders (Korean filenames, two README.md) import; .obsidian/ and Board.canvas are skipped or kept as files; attachments/ resolved via attachmentFolderPath; [[README]] is ambiguous (either README, no crash); [[Does not exist]] and [[Ghost note]] stay as plain text; the Self embed cycle must not loop; tags/aliases/date/rating/done/cssclasses front matter read as typed properties; callouts, ==hl==, %%comment%% (hidden), math, mermaid, dataview fields/blocks and the Tasks 📅 line are kept as text or mapped.";

const BUILDERS: Record<FixtureName, Builder> = {
  async N1(z, c) {
    await addAll(z, notionMarkdownFiles(c));
    return { expect: "import", notes: N1_NOTES };
  },

  async N2(z, c) {
    await addAll(z, notionHtmlFiles(c));
    return {
      expect: "import",
      notes:
        "Same content as N1 as HTML: index.html at root is skipped; 7 article.page files become pages; table.properties -> properties; collection-content table + csv -> 1 database with 3 rows (row title cells and relation cells are links, so internalLinks is higher than N1).",
    };
  },

  async N3(z, c) {
    const H = hid("parts-home"),
      A = hid("parts-alpha"),
      B = hid("parts-beta"),
      G = hid("parts-gamma");
    const home = `${ROOT}/Home ${H}.md`,
      alpha = `${ROOT}/Home ${H}/Alpha ${A}.md`,
      beta = `${ROOT}/Home ${H}/Beta ${B}.md`,
      gamma = `${ROOT}/Home ${H}/Beta ${B}/Gamma ${G}.md`;
    const L = (f: string, t: string) => encPath(rel(f, t));
    c.page();
    c.page();
    c.page();
    c.page();
    const part1: VFile[] = [
      { name: home, data: `# Home\n\n${c.link("Alpha", L(home, alpha))}\n\n${c.link("Beta", L(home, beta))}\n` },
      { name: alpha, data: `# Alpha\n\nCross-part: ${c.link("Beta", L(alpha, beta))} and ${c.link("Gamma", L(alpha, gamma))}.\n\n${c.todo(false, "task in part 1")}\n` },
    ];
    const part2: VFile[] = [
      { name: beta, data: `# Beta\n\nCross-part: ${c.link("Alpha", L(beta, alpha))}. Child: ${c.link("Gamma", L(beta, gamma))}.\n` },
      { name: gamma, data: `# Gamma\n\nUp: ${c.link("Beta", L(gamma, beta))}, cross-part: ${c.link("Home", L(gamma, home))}.\n\n${c.code("python", "print('part 2')")}\n` },
    ];
    await z.add(`${ROOT}-Part-1.zip`, await zipBytes(part1), 0);
    await z.add(`${ROOT}-Part-2.zip`, await zipBytes(part2), 0);
    return {
      expect: "import",
      notes:
        "Outer zip holds Export-<uuid>-Part-1.zip (Home, Alpha) and -Part-2.zip (Beta, Gamma); both parts are opened one level down and merged, so all 4 pages import and the 8 cross-part links resolve.",
    };
  },

  async N4(z, c, opts) {
    const BIG = hid("big-root");
    const bigDir = `${ROOT}/Big ${BIG}`;
    const SECTIONS = opts.small ? 2 : 40,
      PER = 50;
    const IMG_EVERY = opts.small ? 50 : 84,
      PDF_EVERY = opts.small ? 70 : 143;
    const imgBytes = opts.small ? 40_000 : 3_500_000,
      pdfPad = opts.small ? 20_000 : 2_600_000;
    const secIds = Array.from({ length: SECTIONS }, (_, s) => hid(`big-section-${s}`));
    const secName = (s: number) => `Section ${String(s + 1).padStart(2, "0")} ${secIds[s]}`;
    const pageId = (s: number, p: number) => hid(`big-page-${s}-${p}`);
    const pageName = (s: number, p: number) => `Page ${String(s * PER + p + 1).padStart(4, "0")} ${pageId(s, p)}`;
    c.page();
    await z.add(`${bigDir}.md`, `# Big\n\n${secIds.map((_, s) => c.link(`Section ${s + 1}`, encPath(`Big ${BIG}/${secName(s)}.md`))).join("\n\n")}\n`);
    let imgSeed = 4000,
      pdfSeed = 5000,
      imgCount = 0,
      pdfCount = 0;
    const sizeRng = rng(77);
    for (let s = 0; s < SECTIONS; s++) {
      c.page();
      await z.add(
        `${bigDir}/${secName(s)}.md`,
        `# Section ${s + 1}\n\n${Array.from({ length: PER }, (_, p) => c.link(`Page ${s * PER + p + 1}`, encPath(`${secName(s)}/${pageName(s, p)}.md`))).join("\n\n")}\n`,
      );
      for (let p = 0; p < PER; p++) {
        const g = s * PER + p;
        const self = `${bigDir}/${secName(s)}/${pageName(s, p)}`;
        const lines = [`# Page ${g + 1}`, "", `Section ${c.link("index", encPath(`../${secName(s)}.md`))}.`];
        if (p + 1 < PER) lines.push(`Next: ${c.link(`Page ${g + 2}`, encPath(`${pageName(s, p + 1)}.md`))}.`);
        if (g % IMG_EVERY === 0) {
          await z.add(`${self}/image.png`, bigFakePng(imgBytes + (sizeRng() % 400_001), imgSeed++), 0);
          lines.push("", c.image(encPath(`${pageName(s, p)}/image.png`), encPath(`${pageName(s, p)}/image.png`)));
          imgCount++;
        }
        if (g % PDF_EVERY === 1) {
          await z.add(`${self}/attachment-${g}.pdf`, pdfLike(`Attachment ${g}`, pdfPad, pdfSeed++), 0);
          lines.push("", c.fileLink(`attachment-${g}.pdf`, encPath(`${pageName(s, p)}/attachment-${g}.pdf`), `attachment-${g}.pdf`));
          pdfCount++;
        }
        lines.push("", c.todo(g % 2 === 0, `item ${g}`), "");
        const r = rng(9000 + g);
        for (let k = 0; k < 40; k++) lines.push(`Paragraph ${k} of page ${g + 1}: token-${r() % 100000} ${"synthetic filler text for size ".repeat(6)}${r() % 977}.`, "");
        c.page();
        await z.add(`${self}.md`, lines.join("\n"));
      }
    }
    if (!opts.small && (imgCount !== 24 || pdfCount !== 14)) throw new Error(`N4 asset count drift img=${imgCount} pdf=${pdfCount}`);
    return {
      expect: "import",
      notes: opts.small
        ? "Miniature of N4 (2 sections, 101 pages, tiny images/PDFs): same folder shape, imports fully."
        : "2041 small pages in 40 sections plus 24 stored 3.5-3.9 MB PNG-shaped images and 14 ~2.6 MB PDFs; total 110-200 MB so it is under the 500 MB cap and must import fully (slowly is fine).",
    };
  },

  async N5(z, c, opts) {
    await addAll(z, notionMarkdownFiles(c));
    c.page();
    await z.add(`${ROOT}/${NAMES.home}/Archive ${hid("archive-page")}.md`, `# Archive\n\n${c.fileLink("archive.bin", encPath("archive.bin"), "archive.bin")}\n`);
    const chunks = opts.small ? 4 : 560;
    const pattern = randomBytes(999, MIB);
    z.addStoredChunks(`${ROOT}/${NAMES.home}/archive.bin`, chunks * MIB, function* () {
      for (let i = 0; i < chunks; i++) yield pattern;
    });
    return {
      expect: "reject",
      notes: opts.small
        ? "Miniature of N5 (4 MiB archive.bin): same shape; the real CLI fixture is > 520 MB and must be refused."
        : "Valid N1 content plus one 560 MiB stored archive.bin; total > 520 MB so the import is refused up front with an over-500 MB message and nothing is imported.",
    };
  },

  async O1(z, c) {
    const files = obsidianFiles(c);
    for (const f of files) await z.add(`obsidian-vault/${f.name}`, f.data, typeof f.data === "string" ? 8 : 0);
    return { expect: "import", notes: O1_NOTES };
  },

  async E1() {
    return { expect: "reject", notes: "0-byte file: rejected as 'not a zip / empty file', no crash." };
  },

  async E2(_z, c) {
    // zip bytes are produced by buildFixture (N1 truncated); the counter mirrors N1's content
    notionMarkdownFiles(c);
    return {
      expect: "reject",
      notes: "N1 cut at 60% (central directory and EOCD missing): rejected as a damaged zip with a clear message; sourceCounts are N1's, nothing should import.",
    };
  },

  async E3(z, c) {
    c.page();
    await addAll(z, [
      { name: "../evil.md", data: "# evil\n\nescaped parent dir\n" },
      { name: "/abs.md", data: "# abs\n\nabsolute path\n" },
      { name: "a/../../b.md", data: "# b\n\ndotdot in the middle\n" },
      { name: "C:\\win.md", data: "# win\n\nwindows drive path\n" },
      { name: "ok.md", data: "# ok\n\nsafe entry\n" },
    ]);
    return {
      expect: "import",
      notes: "../evil.md, /abs.md, a/../../b.md, C:\\win.md skipped as unsafe paths (never written outside the import root); ok.md imported as 1 page.",
    };
  },

  async E4(z, c) {
    const X = hid("xss-page"),
      HP = hid("xss-html-page");
    c.page();
    c.page();
    const md = [
      "# XSS",
      "",
      "<script>alert(1)</script>",
      "",
      c.code("html-embed", '<script>alert("fence")</script>'),
      "",
      "[x](javascript:alert(1))",
      "",
      "![i](javascript:alert(1))",
      "",
      "<img src=x onerror=alert(1)>",
      "",
      c.image("evil.svg", encPath(`XSS ${X}/evil.svg`)),
      "",
      `Safe ${c.link("Notion page", encPath(`Notion page ${HP}.html`))}.`,
      "",
    ].join("\n");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10" onload="alert(1)"><script>alert(2)</script><image xlink:href="https://evil.test/x" href="https://evil.test/x" width="10" height="10"/><rect width="10" height="10" fill="red"/></svg>\n`;
    const html = htmlPage(
      HP,
      "Notion page",
      "",
      `<p id="p1" class="">hello<script>alert(3)</script></p>\n<p id="p2" class=""><img src="x" onerror="alert(4)"></p>\n<p id="p3" class=""><a href="javascript:alert(5)">js link</a></p>`,
    );
    await addAll(z, [
      { name: `${ROOT}/XSS ${X}.md`, data: md },
      { name: `${ROOT}/XSS ${X}/evil.svg`, data: svg },
      { name: `${ROOT}/Notion page ${HP}.html`, data: html },
    ]);
    return {
      expect: "import",
      notes:
        "Both pages import but no script runs: <script>, onerror and javascript: URLs are stripped or shown as plain text, the html-embed fence stays a code block, evil.svg is either dropped or served inert (no onload/script/external href executed).",
    };
  },

  async E5(z, c) {
    const A = hid("cycle-a"),
      B = hid("cycle-b"),
      C = hid("cycle-c");
    c.page();
    c.page();
    c.page();
    await addAll(z, [
      { name: `${ROOT}/A ${A}.md`, data: `# A\n\nTo ${c.link("B", encPath(`B ${B}.md`))}.\n` },
      { name: `${ROOT}/B ${B}.md`, data: `# B\n\nBack to ${c.link("A", encPath(`A ${A}.md`))}.\n` },
      { name: `${ROOT}/C ${C}.md`, data: `# C\n\nSelf: ${c.link("C", encPath(`C ${C}.md`))}.\n` },
    ]);
    return { expect: "import", notes: "A<->B and C->C link cycles import as 3 pages with links resolved; no infinite loop or hang." };
  },

  async E6(z, c) {
    const ids = [hid("collide-1"), hid("collide-2"), hid("collide-3"), hid("collide-4")];
    c.page();
    c.page();
    c.page();
    c.page();
    await addAll(z, [
      { name: `${ROOT}/Notes ${ids[0]}.md`, data: `# Notes\n\nFirst Notes page. ${c.link("other Notes", encPath(`Notes ${ids[1]}.md`))}\n` },
      { name: `${ROOT}/Notes ${ids[1]}.md`, data: "# Notes\n\nSecond Notes page.\n" },
      { name: `${ROOT}/notes ${ids[2]}.md`, data: "# notes\n\nlowercase notes page.\n" },
      { name: `${ROOT}/NOTES ${ids[3]}.md`, data: "# NOTES\n\nUPPERCASE notes page.\n" },
    ]);
    return {
      expect: "import",
      notes:
        "4 pages whose titles differ only by id or letter case all import as 4 distinct pages (distinct slugs); the link from the first Notes page resolves to the second by id, not by title.",
    };
  },

  async E7(z, c, opts) {
    const DBID = hid("big-table");
    const ROWS = opts.small ? 200 : 20_000,
      COLS = 30;
    const header = csvRow(Array.from({ length: COLS }, (_, i) => (i === 0 ? "Name" : `Col ${i}`)));
    const lines: string[] = [header];
    const r = rng(7007);
    for (let i = 0; i < ROWS; i++) {
      const f: string[] = [];
      for (let j = 0; j < COLS; j++) {
        if (j === 0) f.push(`Row ${i + 1}`);
        else if (j === 1) f.push(`Kim, Jo ${i}`);
        else if (j === 2) f.push(`line1 ${i}\nline2 "q"`);
        else if (j === 3) f.push(i % 2 ? "Yes" : "No");
        else if (j === 4) f.push("October 23, 2026 3:00 PM");
        else f.push(`v${j}-${r() % 10_000}`);
      }
      lines.push(csvRow(f));
    }
    c.c.databases++;
    c.c.dbRows += ROWS;
    c.page();
    await addAll(z, [
      { name: `${ROOT}/Big table ${DBID}.md`, data: `# Big table\n\n[Big table](${encPath(`Big table ${DBID}.csv`)})\n` },
      { name: `${ROOT}/Big table ${DBID}.csv`, data: lines.join("\n") + "\n" },
    ]);
    return {
      expect: "import",
      notes: `One database CSV of ${ROWS.toLocaleString("en-US")} rows x 30 columns with quoted commas/newlines imports as 1 database (rows may be paged/truncated with a visible notice) plus the stub page; no OOM and no field misalignment.`,
    };
  },

  async E8(z, c) {
    const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
    const dbid = hid("cp949-db");
    c.c.databases++;
    c.c.dbRows += 2;
    // CP949 bytes for: 이름,상태,메모 / 웹사이트 개선,진행 중,"한글, 쉼표" / 모바일 앱,완료,메모 없음
    const cp949Csv = concat([
      hex("c0ccb8a72cbbf3c5c22cb8deb8f0"),
      utf8("\n"),
      hex("c0a5bbe7c0ccc6ae20b0b3bcb12cc1f8c7e020c1df2c22c7d1b1db2c20bdb0c7a522"),
      utf8("\n"),
      hex("b8f0b9d9c0cf20bedb2cbfcfb7e12cb8deb8f020bef8c0bd"),
      utf8("\n"),
    ]);
    await z.add(`${ROOT}/표 ${dbid}.csv`, cp949Csv, 8);
    c.page();
    const utf16 = (s: string): Uint8Array => {
      const b = new Uint8Array(2 + s.length * 2);
      b[0] = 0xff;
      b[1] = 0xfe;
      for (let i = 0; i < s.length; i++) {
        const cu = s.charCodeAt(i);
        b[2 + i * 2] = cu & 0xff;
        b[3 + i * 2] = cu >> 8;
      }
      return b;
    };
    await z.add(`${ROOT}/UTF16 ${hid("utf16-page")}.md`, utf16("# UTF-16 page\n\nUTF-16LE with BOM. 한글 본문.\n"), 8);
    c.page();
    await z.add(`${ROOT}/BOM ${hid("bom-page")}.md`, concat([new Uint8Array([0xef, 0xbb, 0xbf]), utf8("# BOM page\n\nUTF-8 with BOM. 한글 본문.\n")]), 8);
    c.page();
    z.addLegacyName(concat([utf8(`${ROOT}/`), hex("c7d1b1db20b3ebc6ae2e6d64")]), "# 한글 노트\n\nEUC-KR filename bytes, no UTF-8 flag.\n");
    c.page();
    z.addLegacyName(concat([utf8(`${ROOT}/`), hex("636166822e6d64")]), "# cafe\n\nCP437 filename bytes (caf\u00e9.md), no UTF-8 flag.\n");
    return {
      expect: "import",
      notes:
        "CP949 CSV decodes to Korean headers/cells (or imports with replacement chars but never crashes); UTF-16LE BOM and UTF-8 BOM pages import with the BOM stripped and correct titles; the two entries without the UTF-8 name flag (EUC-KR '한글 노트.md', CP437 'café.md') import under a best-effort decoded name.",
    };
  },

  async E9(z, c, opts) {
    c.page();
    await z.add(`${ROOT}/readme ${hid("bomb-readme")}.md`, "# readme\n\nThe other entry inflates to 1 GiB.\n");
    const chunks = opts.small ? 16 : 1024;
    const zero = new Uint8Array(MIB);
    let crc = 0;
    for (let i = 0; i < chunks; i++) crc = crc32(zero, crc);
    const comp = await deflateRaw(
      (function* () {
        for (let i = 0; i < chunks; i++) yield zero;
      })(),
    );
    if (!opts.small && comp.length >= 2 * MIB) throw new Error(`zipbomb compressed too large: ${comp.length}`);
    z.entry({ nameBytes: utf8(`${ROOT}/zeros.bin`), utf8Flag: true, method: 8, crc, compSize: comp.length, size: chunks * MIB, body: [comp] });
    return {
      expect: "reject",
      notes: opts.small
        ? "Miniature of E9 (16 MiB of zeros): same shape; the real CLI fixture declares 1 GiB and must be refused before inflating."
        : "Headers declare a 1 GiB entry inside a < 2 MB zip: rejected before inflating (declared uncompressed total over the cap), memory stays flat.",
    };
  },

  async E10(z, c) {
    const names = Array.from({ length: 8 }, (_, i) => `L${i + 1} ${hid(`deep-${i + 1}`)}`);
    const files: VFile[] = [];
    for (let i = 0; i < 8; i++) {
      const dir = names.slice(0, i).join("/");
      const self = `${ROOT}/${dir ? dir + "/" : ""}${names[i]}.md`;
      c.page();
      const child = i + 1 < 8 ? c.link(`L${i + 2}`, encPath(`${names[i]}/${names[i + 1]}.md`)) : c.link("Leaf", encPath(`${names[i]}/Leaf ${hid("deep-leaf")}.md`));
      files.push({ name: self, data: `# L${i + 1}\n\nDown: ${child}\n` });
    }
    c.page();
    files.push({ name: `${ROOT}/${names.join("/")}/Leaf ${hid("deep-leaf")}.md`, data: `# Leaf\n\nUp to ${c.link("L1", encPath(`${"../".repeat(8)}${names[0]}.md`))}.\n` });
    await addAll(z, files);
    return { expect: "import", notes: "8 nested folder levels plus a leaf page: all 9 pages import with the parent chain intact and the leaf's ../ x8 link back to L1 resolves." };
  },
};

/** Builds one fixture into `sink` (zip bytes) and returns everything but the bytes. E1/E2 bypass the zip writer. */
async function buildInto(name: FixtureName, opts: BuildOpts, sink: Sink): Promise<Omit<Fixture, "zip">> {
  const c = new Counter();
  if (name === "E1") {
    sink.close();
    const r = await BUILDERS.E1(new ZipWriter(new MemorySink()), c, opts);
    return { files: new Map(), sourceCounts: { ...c.c }, ...r };
  }
  if (name === "E2") {
    const n1 = await buildFixture("N1", opts);
    sink.write(n1.zip.subarray(0, Math.floor(n1.zip.length * 0.6)));
    sink.close();
    const r = await BUILDERS.E2(new ZipWriter(new MemorySink()), c, opts);
    return { files: new Map(), sourceCounts: { ...c.c }, ...r };
  }
  const z = new ZipWriter(sink);
  const r = await BUILDERS[name](z, c, opts);
  z.close();
  return { files: z.files, sourceCounts: { ...c.c }, ...r };
}

/** Pure in-memory fixture builder (no disk I/O). See the header comment for which names are fast. */
export async function buildFixture(name: FixtureName, opts: BuildOpts = {}): Promise<Fixture> {
  const sink = new MemorySink();
  const r = await buildInto(name, opts, sink);
  return { ...r, zip: sink.bytes() };
}

// ---------------------------------------------------------------- CLI
type Manifest = Record<string, { file: string; kind: string; expect: Expect; sourceCounts: SourceCounts; notes: string }>;

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("usage: bun scripts/qa/import-fixtures.ts <outDir>");
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  const manifest: Manifest = {};
  for (const name of FIXTURE_NAMES) {
    const file = FIXTURE_FILES[name];
    console.log(`WORKING: fixtures - ${name} ${file}`);
    const path = join(outDir, file);
    const r = await buildInto(name, {}, new FileSink(path));
    manifest[name] = { file, kind: FIXTURE_KIND[name], expect: r.expect, sourceCounts: r.sourceCounts, notes: r.notes };
    if (name === "O1") {
      rmSync(join(outDir, "obsidian-vault"), { recursive: true, force: true });
      for (const [entry, data] of r.files) {
        const p = join(outDir, entry);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, data);
      }
      manifest["O1-dir"] = { file: "obsidian-vault/", kind: "obsidian-vault-folder", expect: r.expect, sourceCounts: r.sourceCounts, notes: `Folder form of O1. ${r.notes}` };
    }
    console.log(`${name.padEnd(4)} ${file.padEnd(20)} ${String(statSync(path).size).padStart(11)} bytes  expect=${r.expect}`);
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest.json written with ${Object.keys(manifest).length} entries`);
}

if (import.meta.main) await main();
