// Shared contract of the importer (#129 #130 #131 #133). Pure data: the format readers (import-notion.ts,
// import-obsidian.ts, import-acard.ts) turn zip entries into one ImpPlan; features/import.js writes a plan to a
// workspace. The same files run in the Worker (inlined at //__IMPORT_CORE__), in the browser import chunk, in the local
// edition and in tests. Every top-level name starts with "imp" because the Worker inlines all of them into one scope.
import type { Block } from "./markdown-blocks.ts";

// Where an archive comes from: the browser passes File.slice reads, the Worker and tests pass bytes.
export type ImpSource = { size: number; read(offset: number, length: number): Promise<Uint8Array> };

// One file inside the archive after the safety checks. path uses "/" and never starts with "/" or contains "..";
// Notion's synthetic Export-<uuid>/ root and __MACOSX/dotfiles (except .obsidian/) are already removed.
export type ImpEntry = { path: string; size: number; read(): Promise<Uint8Array> };

export type ImpFormat = "notion-md" | "notion-html" | "obsidian" | "acard" | "markdown";

// Why something did not come in, or came in differently. The UI and docs/import.md turn the code into words.
export type ImpSkipCode =
  | "unsafe-path" | "bomb" | "too-big" | "file-type" | "unreadable" | "encoding" | "empty"
  | "link-missing" | "link-ambiguous" | "relation-outside" | "embed-as-link" | "plugin-syntax" | "canvas"
  | "duplicate-view" | "limit-pages" | "limit-rows" | "quota" | "script-removed" | "unsupported-block";
export type ImpSkip = { path: string; code: ImpSkipCode; detail?: string };

// Placeholders inside a plan's blocks. features/import.js swaps them for real addresses before saving:
//   richText run href / mention slug "imp-page:<key>" or "imp-page:<key>#<heading text>"  -> "/<slug>/" (+ "#<id>")
//   image meta.src, file / video / audio meta.url "imp-asset:<key>"                       -> "/media/<id>"
// A placeholder whose target is not in the plan never appears: the reader writes plain text and an ImpSkip instead.
export const IMP_PAGE = "imp-page:";
export const IMP_ASSET = "imp-asset:";

export function impPageRef(key: string, heading?: string): string {
  return IMP_PAGE + key + (heading ? "#" + heading : "");
}

export function impAssetRef(key: string): string {
  return IMP_ASSET + key;
}

export function impParseRef(value: unknown): { kind: "page"; key: string; heading: string } | { kind: "asset"; key: string } | null {
  if (typeof value !== "string") return null;
  if (value.startsWith(IMP_ASSET)) return { kind: "asset", key: value.slice(IMP_ASSET.length) };
  if (!value.startsWith(IMP_PAGE)) return null;
  const rest = value.slice(IMP_PAGE.length);
  const cut = rest.indexOf("#");
  return cut < 0 ? { kind: "page", key: rest, heading: "" } : { kind: "page", key: rest.slice(0, cut), heading: rest.slice(cut + 1) };
}

// key: stable within one plan (the entry path of the page / file / database).
// source: stable across uploads of the same export, used for the duplicate check:
//   notion:<32 hex id>   obsidian:<vault>/<path>   acard:<slug>   md:<path>
export type ImpPage = {
  key: string;
  source: string;
  title: string;
  parent: string | null; // key of a page, or of an ImpDb for its row pages
  kind: "note" | "folder" | "db_row";
  blocks: Block[];
  tags: string[];
  icon?: string;
};

export type ImpProperty = { id: string; name: string; type: string; config?: Record<string, unknown> };

// values: property id -> a value db-model.js normaliseCellValue accepts, except relation = page keys of row pages
// (resolved to row ids on commit), select / multi_select / status = option names (resolved to option ids on commit).
export type ImpRow = { page: string; values: Record<string, unknown> };

export type ImpDb = {
  key: string;
  source: string;
  title: string;
  parent: string | null;
  properties: ImpProperty[]; // properties[0] is the title property
  rows: ImpRow[];
};

export type ImpAsset = { key: string; path: string; name: string; kind: "image" | "file"; size: number; read(): Promise<Uint8Array> };

export type ImpCounts = {
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

export type ImpPlan = {
  format: ImpFormat;
  name: string;
  pages: ImpPage[];
  databases: ImpDb[];
  assets: ImpAsset[];
  skipped: ImpSkip[];
  counts: ImpCounts;
};

export const IMP_LIMITS = {
  archiveBytes: 500 * 1024 * 1024,
  entries: 50_000,
  pages: 5_000,
  rowsPerDatabase: 20_000,
  textBytes: 60 * 1024 * 1024,
  assetBytes: 10 * 1024 * 1024,
  entryInflateBytes: 200 * 1024 * 1024,
  totalInflateBytes: 1200 * 1024 * 1024,
  ratio: 200,
  ratioMinBytes: 1024 * 1024,
  requestBytes: 30 * 1024 * 1024,
  pagesPerChunk: 300,
};

export function impEmptyCounts(): ImpCounts {
  return { pages: 0, databases: 0, dbRows: 0, internalLinks: 0, internalLinksToMissing: 0, images: 0, attachments: 0, tags: 0, embedsNote: 0, callouts: 0, equations: 0, codeBlocks: 0, todos: 0 };
}
