import { markdownToBlocks, type Block } from "./markdown-blocks.ts";

// Notion "Markdown & CSV" 내보내기 ZIP을 페이지 목록으로 바꾼다. Node API 없이 Worker에서 돈다.

export type NotionImportedPage = {
  title: string;
  slug: string;
  parent: string | null;
  kind: "note" | "db";
  blocks: Block[];
};

export type NotionImportResult = {
  pages: NotionImportedPage[];
  skipped: string[];
  warnings: string[];
};

type NotionImportEntry = { name: string; method: number; csize: number; usize: number; offset: number };

let notionImportCounter = 0;
function notionImportNextId(): string {
  notionImportCounter += 1;
  return "b" + notionImportCounter.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function notionImportSlugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return slug || "page";
}

function notionImportStripHash(name: string): string {
  return name.replace(/[\s_-]*[0-9a-fA-F]{32}$/, "").trim();
}

function notionImportListEntries(bytes: Uint8Array): NotionImportEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip end-of-central-directory record not found");
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: NotionImportEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error("zip central directory is corrupt");
    }
    const method = view.getUint16(pos + 10, true);
    const csize = view.getUint32(pos + 20, true);
    const usize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    entries.push({ name, method, csize, usize, offset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function notionImportExtract(bytes: Uint8Array, entry: NotionImportEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = entry.offset;
  if (o + 30 > bytes.length || view.getUint32(o, true) !== 0x04034b50) {
    throw new Error("bad local header");
  }
  const start = o + 30 + view.getUint16(o + 26, true) + view.getUint16(o + 28, true);
  const raw = bytes.subarray(start, start + entry.csize);
  if (raw.length !== entry.csize) throw new Error("truncated entry");
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error("unsupported compression method " + entry.method);
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function notionImportParseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let touched = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      touched = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      touched = true;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      if (touched || field !== "") {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = "";
      touched = false;
    } else {
      field += c;
      touched = true;
    }
  }
  if (touched || field !== "") {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function notionImportZip(bytes: Uint8Array): Promise<NotionImportResult> {
  const result: NotionImportResult = { pages: [], skipped: [], warnings: [] };
  try {
    const entries = notionImportListEntries(bytes);
    const decoder = new TextDecoder();

    type Item = { segs: string[]; base: string; ext: string; entry: NotionImportEntry };
    const items: Item[] = [];
    for (const entry of entries) {
      if (entry.name.endsWith("/")) continue;
      const segs = entry.name.split("/").filter((s) => s !== "");
      const file = segs.pop() ?? "";
      const dot = file.lastIndexOf(".");
      const ext = dot >= 0 ? file.slice(dot + 1).toLowerCase() : "";
      if (ext !== "md" && ext !== "csv") {
        result.skipped.push(entry.name + " (not .md or .csv)");
        continue;
      }
      items.push({ segs, base: file.slice(0, dot), ext, entry });
    }
    // 부모가 항상 먼저 오도록 깊이순(안정 정렬)
    items.sort((a, b) => a.segs.length - b.segs.length);

    const slugByKey = new Map<string, string>();
    const used = new Set<string>();

    for (const item of items) {
      let body: string;
      try {
        body = decoder.decode(await notionImportExtract(bytes, item.entry));
      } catch (err) {
        result.skipped.push(item.entry.name + " (unreadable: " + (err instanceof Error ? err.message : "error") + ")");
        continue;
      }
      const cleaned = notionImportStripHash(item.base);
      const fileTitle = cleaned.replace(/[-_]+/g, " ").trim() || "Untitled";
      let title = fileTitle;
      let blocks: Block[];
      let kind: "note" | "db";

      if (item.ext === "md") {
        kind = "note";
        const lines = body.replace(/\r\n?/g, "\n").split("\n");
        const first = lines.findIndex((l) => l.trim() !== "");
        if (first >= 0) {
          const m = /^#\s+(.+?)\s*#*\s*$/.exec(lines[first]);
          if (m) {
            title = m[1];
            lines.splice(first, 1);
          }
        }
        blocks = markdownToBlocks(lines.join("\n"));
      } else {
        kind = "db";
        const table = notionImportParseCsv(body);
        const columns = table.length > 0 ? table[0] : [];
        const rows: Record<string, string>[] = [];
        for (const cells of table.slice(1)) {
          const r: Record<string, string> = {};
          columns.forEach((col, idx) => {
            r[col] = cells[idx] ?? "";
          });
          rows.push(r);
        }
        if (rows.length === 0) result.warnings.push(item.entry.name + ": csv has no rows");
        blocks = [
          {
            id: notionImportNextId(),
            type: "database",
            text: columns.join(" | "),
            meta: { columns, rows, view: "table" },
          },
        ];
      }

      const parentKey = item.segs.join("/");
      let parent: string | null = null;
      if (item.segs.length > 0) {
        parent =
          slugByKey.get(parentKey) ??
          notionImportSlugify(notionImportStripHash(item.segs[item.segs.length - 1]).replace(/[-_]+/g, " "));
      }

      const baseSlug = notionImportSlugify(title);
      let slug = baseSlug;
      for (let n = 2; used.has(slug); n++) slug = baseSlug + "-" + n;
      used.add(slug);
      slugByKey.set(item.segs.concat(item.base).join("/"), slug);

      result.pages.push({ title, slug, parent, kind, blocks });
    }
    if (result.pages.length === 0 && result.warnings.length === 0) {
      result.warnings.push("zip contained no importable .md or .csv files");
    }
  } catch (err) {
    return {
      pages: [],
      skipped: [],
      warnings: ["could not read zip: " + (err instanceof Error ? err.message : "unknown error")],
    };
  }
  return result;
}
