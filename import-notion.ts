// Notion "Markdown & CSV" and "HTML" exports -> ImpPlan (issue 129). Pure: runs in the Worker (inlined), the browser
// import engine and tests; every top-level name starts with "imp" because the Worker inlines all import-*.ts into one scope.
// Names end in " <32 hex id>"; a page "A <id>.md" owns the folder "A <id>/" (its sub-pages, row pages and files).
// A database is "<Name> <id>.csv" (+ "_all.csv", preferred) with its row pages in "<Name> <id>/". Links are relative,
// percent-encoded paths; a link to a page in the export becomes a page placeholder, anything else stays text + ImpSkip.
import { impAssetRef, impEmptyCounts, impPageRef, type ImpAsset, type ImpDb, type ImpEntry, type ImpPage, type ImpPlan, type ImpProperty, type ImpRow, type ImpSkip } from "./import-plan.ts";
import { impDecodeText } from "./import-zip.ts";
import { impInlineRuns } from "./import-inline.ts";
import { impCellValue, impInferProperty, impNotionKeyValueLines, impParseCsv, impRelationTargets } from "./import-csv.ts";
import { impSanitizeBlocks } from "./import-sanitize.ts";
import { markdownToBlocks, type Block } from "./markdown-blocks.ts";

const IMP_NOTION_ID = /\s+([0-9a-f]{32})(_all)?$/i;
const IMP_NOTION_IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const IMP_NOTION_TEXT = new Set(["paragraph", "heading1", "heading2", "heading3", "heading4", "bulleted", "numbered", "to_do", "toggle", "quote", "callout"]);

function impNotionStem(path: string): { dir: string; name: string; id: string; all: boolean; ext: string } {
  const slash = path.lastIndexOf("/");
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const m = IMP_NOTION_ID.exec(stem);
  return { dir: slash < 0 ? "" : path.slice(0, slash), name: (m ? stem.slice(0, m.index) : stem).trim() || "Untitled", id: m ? m[1].toLowerCase() : "", all: !!(m && m[2]), ext };
}

function impNotionJoin(dir: string, rel: string): string {
  const out: string[] = dir ? dir.split("/") : [];
  let decoded = rel;
  try { decoded = decodeURIComponent(rel); } catch { /* keep the raw path */ }
  for (const seg of decoded.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!out.length) return "\u0000outside"; out.pop(); }
    else out.push(seg);
  }
  return out.join("/");
}

const IMP_NOTION_UNSAFE = /^\s*(javascript|vbscript|data|file|blob):/i;
const impNotionScheme = (href: string) => (/^\s*data:/i.test(href) ? "data url" : "script url");

function impNotionEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code: string) => {
    const c = code.toLowerCase();
    if (c[0] === "#") return String.fromCodePoint(c[1] === "x" ? parseInt(c.slice(2), 16) : Number(c.slice(1)));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[c] ?? all;
  });
}

// ---------------------------------------------------------------- a tiny HTML tree (no DOMParser in Workers)
type ImpNode = { tag: string; attrs: Record<string, string>; children: (ImpNode | string)[] };
const IMP_VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "source", "wbr"]);

function impNotionParseHtml(html: string): ImpNode {
  const root: ImpNode = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].startsWith("<!--")) continue;
    if (m[5] !== undefined || m[0] === "<") { stack[stack.length - 1].children.push(impNotionEntities(m[5] ?? "<")); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) attrs[a[1].toLowerCase()] = impNotionEntities((a[2] ?? "").replace(/^["']|["']$/g, ""));
    const node: ImpNode = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!IMP_VOID.has(tag) && !m[4] && tag !== "script" && tag !== "style" && stack.length < 200) stack.push(node);
    if (tag === "script" || tag === "style") {
      const close = html.indexOf("</" + tag, (m.index ?? 0) + m[0].length);
      const end = close < 0 ? -1 : html.indexOf(">", close);
      if (end < 0) break;
      re.lastIndex = end + 1;
    }
  }
  return root;
}

const impHasClass = (n: ImpNode, c: string) => (" " + (n.attrs.class || "") + " ").includes(" " + c + " ");
function impFind(n: ImpNode, pred: (n: ImpNode) => boolean): ImpNode | null {
  for (const c of n.children) {
    if (typeof c === "string") continue;
    if (pred(c)) return c;
    const hit = impFind(c, pred);
    if (hit) return hit;
  }
  return null;
}
function impFindAll(n: ImpNode, pred: (n: ImpNode) => boolean, out: ImpNode[] = []): ImpNode[] {
  for (const c of n.children) if (typeof c !== "string") { if (pred(c)) out.push(c); impFindAll(c, pred, out); }
  return out;
}
function impText(n: ImpNode | string): string {
  if (typeof n === "string") return n;
  if (n.tag === "br") return "\n";
  return n.children.map(impText).join("");
}
// Inline HTML -> markdown-ish text that impInlineRuns understands.
function impInlineMd(n: ImpNode | string): string {
  if (typeof n === "string") return n.replace(/([*_`~\\[\]])/g, "\\$1");
  const inner = n.children.map(impInlineMd).join("");
  switch (n.tag) {
    case "strong": case "b": return inner.trim() ? "**" + inner + "**" : inner;
    case "em": case "i": return inner.trim() ? "*" + inner + "*" : inner;
    case "code": return "`" + impText(n) + "`";
    case "s": case "del": return "~~" + inner + "~~";
    case "mark": return "==" + inner + "==";
    case "a": return n.attrs.href && !IMP_NOTION_UNSAFE.test(n.attrs.href) ? "[" + inner + "](" + n.attrs.href.replace(/\)/g, "%29").replace(/ /g, "%20") + ")" : inner;
    case "br": return "\n";
    case "span": return impHasClass(n, "notion-text-equation-token") ? "$" + impText(n) + "$" : inner;
    default: return inner;
  }
}

// ---------------------------------------------------------------- the plan
export async function impNotionPlan(entries: ImpEntry[], opts: { name: string; format: "notion-md" | "notion-html" }): Promise<ImpPlan> {
  const html = opts.format === "notion-html";
  const skipped: ImpSkip[] = [];
  const counts = impEmptyCounts();
  const files = new Map(entries.map((e) => [e.path, e]));
  const pageExt = html ? "html" : "md";
  const pagePaths = entries.map((e) => e.path).filter((p) => /\.(md|html)$/i.test(p) && !/(^|\/)index\.html$/i.test(p));
  const csvPaths = entries.map((e) => e.path).filter((p) => p.toLowerCase().endsWith(".csv"));

  // Databases: one per "<Name> <id>" csv pair; _all.csv preferred.
  type DbInfo = { key: string; dir: string; name: string; id: string; csv: string; folder: string };
  const dbs = new Map<string, DbInfo>();
  for (const p of csvPaths) {
    const s = impNotionStem(p);
    const k = (s.dir ? s.dir + "/" : "") + s.name + (s.id ? " " + s.id : "");
    const prev = dbs.get(k);
    if (prev && !s.all) { skipped.push({ path: p, code: "duplicate-view" }); continue; }
    if (prev && s.all) skipped.push({ path: prev.csv, code: "duplicate-view" });
    dbs.set(k, { key: p, dir: s.dir, name: s.name, id: s.id, csv: p, folder: k });
  }
  // A page whose body is only a link to its database csv is the database's stub page.
  const dbByFolder = new Map([...dbs.values()].map((d) => [d.folder, d]));

  // Page keys, parents and titles.
  const pageByPath = new Map<string, ImpPage>();
  const pageById = new Map<string, string>();
  const rowDbOf = new Map<string, DbInfo>();
  const stemOfPath = (p: string) => p.replace(/\.(md|html)$/i, "");
  for (const p of pagePaths) {
    const s = impNotionStem(p);
    if (s.id) pageById.set(s.id, p);
    const dbHere = dbByFolder.get(s.dir);
    if (dbHere) rowDbOf.set(p, dbHere);
  }
  const parentOf = (p: string): string | null => {
    const dir = impNotionStem(p).dir;
    if (!dir) return null;
    const db = dbByFolder.get(dir);
    if (db) return db.key;
    for (const ext of [pageExt, html ? "md" : "html"]) if (files.has(dir + "." + ext)) return dir + "." + ext;
    return null;
  };

  const assets = new Map<string, ImpAsset>();
  const useAsset = (path: string, kind: "image" | "file") => {
    if (!assets.has(path)) {
      const e = files.get(path)!;
      assets.set(path, { key: path, path, name: path.slice(path.lastIndexOf("/") + 1), kind, size: e.size, read: () => e.read() });
    }
    return impAssetRef(path);
  };

  const resolveTarget = (from: string, href: string): { page?: string; asset?: string; external?: boolean } => {
    if (/^(https?:|mailto:)/i.test(href)) {
      const m = /notion\.so\/[^?#]*?([0-9a-f]{32})/i.exec(href);
      if (m && pageById.has(m[1].toLowerCase())) return { page: pageById.get(m[1].toLowerCase()) };
      return { external: true };
    }
    const target = impNotionJoin(impNotionStem(from).dir, href.split("#")[0]);
    if (files.has(target) && /\.(md|html)$/i.test(target)) return { page: target };
    if (files.has(target) && /\.csv$/i.test(target)) return {};
    if (files.has(target)) return { asset: target };
    const id = /([0-9a-f]{32})(?:_all)?\.(md|html|csv)$/i.exec(target)?.[1]?.toLowerCase();
    if (id && pageById.has(id)) return { page: pageById.get(id) };
    return {};
  };

  const pages: ImpPage[] = [];
  const rowValues = new Map<string, Record<string, string>>();
  const dbHeaders = new Map<string, string[]>();
  for (const d of dbs.values()) {
    const table = impParseCsv(impDecodeText(await files.get(d.csv)!.read()).text);
    dbHeaders.set(d.key, table[0] || []);
  }

  for (const p of pagePaths.sort()) {
    const s = impNotionStem(p);
    const raw = impDecodeText(await files.get(p)!.read()).text;
    let title = s.name;
    let blocks: Block[] = [];
    let isStub = false;
    const pageIsHtml = /\.html$/i.test(p);
    if (!pageIsHtml) {
      const db = rowDbOf.get(p);
      let body = raw.replace(/\r\n?/g, "\n");
      if (db) {
        const kv = impNotionKeyValueLines(body, dbHeaders.get(db.key) || []);
        rowValues.set(p, kv.values);
        body = kv.rest;
      }
      const lines = body.split("\n");
      const first = lines.findIndex((l) => l.trim() !== "");
      if (first >= 0 && /^#\s+/.test(lines[first])) { title = lines[first].replace(/^#\s+/, "").trim() || title; lines.splice(first, 1); }
      body = lines.join("\n");
      const children = new Set(pagePaths.filter((c) => parentOf(c) === p).map((c) => c.slice(c.lastIndexOf("/") + 1)));
      const nonEmpty = body.split("\n").filter((l) => l.trim());
      isStub = nonEmpty.length > 0 && nonEmpty.every((l) => /^\[[^\]]*\]\([^)]*\.csv\)$/.test(l.trim()));
      // Callouts: <aside> ... </aside> -> "> [!note] text" lines (icon kept as the first emoji).
      body = body.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_all, inner: string) => {
        const text = inner.trim();
        const icon = /^(\p{Extended_Pictographic}\uFE0F?)\s*/u.exec(text);
        return "> [!note]" + (icon ? "{icon:" + icon[1] + "} " : " ") + (icon ? text.slice(icon[0].length) : text).split("\n").join("\n> ");
      });
      // Images and file links pointing into the export.
      body = body.replace(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/gm, (all, _alt: string, href: string) => {
        const t = resolveTarget(p, href);
        if (t.asset && IMP_NOTION_IMAGE.test(t.asset)) { counts.images += 1; return "\n\nIMPIMAGE:" + useAsset(t.asset, "image") + "\u0000" + t.asset.slice(t.asset.lastIndexOf("/") + 1) + "\n\n"; }
        if (IMP_NOTION_UNSAFE.test(href)) { skipped.push({ path: p, code: "script-removed", detail: impNotionScheme(href) + " in an image" }); return ""; }
        skipped.push({ path: p, code: "link-missing", detail: href });
        return "";
      });
      body = body.replace(/^\[([^\]]+)\]\(([^)]+)\)\s*$/gm, (all, label: string, href: string) => {
        const t = resolveTarget(p, href);
        if (t.asset && !IMP_NOTION_IMAGE.test(t.asset)) return "\n\nIMPFILE:" + useAsset(t.asset, "file") + "\u0000" + label + "\n\n";
        if (/\.csv\)?$/i.test(href)) return "";
        if (t.page && children.has(t.page.slice(t.page.lastIndexOf("/") + 1))) { counts.internalLinks += 1; return "\n\nIMPCHILD:" + t.page + "\u0000" + label + "\n\n"; }
        return all;
      });
      blocks = markdownToBlocks(body);
      // Notion writes a toggle as a bullet whose children are indented plain lines (a sub-list stays a sub-list).
      blocks = blocks.map((b, i) => {
        const next = blocks[i + 1];
        return b.type === "bulleted" && next && next.type === "paragraph" && (next.indent ?? 0) > (b.indent ?? 0) ? { ...b, type: "toggle" as Block["type"] } : b;
      });
      for (let i = 1; i < blocks.length; i++) if (blocks[i - 1].type === "toggle" && (blocks[i].indent ?? 0) > (blocks[i - 1].indent ?? 0) + 1) blocks[i] = { ...blocks[i], indent: (blocks[i - 1].indent ?? 0) + 1 };
    } else {
      const tree = impNotionParseHtml(raw);
      const h1 = impFind(tree, (n) => n.tag === "h1" && impHasClass(n, "page-title"));
      if (h1) title = impText(h1).trim() || title;
      const db = rowDbOf.get(p);
      if (db) {
        const props = impFind(tree, (n) => n.tag === "table" && impHasClass(n, "properties"));
        const values: Record<string, string> = {};
        for (const tr of props ? impFindAll(props, (n) => n.tag === "tr") : []) {
          const th = impFind(tr, (n) => n.tag === "th"), td = impFind(tr, (n) => n.tag === "td");
          if (!th || !td) continue;
          values[impText(th).trim()] = impText(td).replace(/^@/, "").trim();
          if (impHasClass(tr, "property-row-relation")) for (const a of impFindAll(td, (x) => x.tag === "a")) if (resolveTarget(p, a.attrs.href || "").page) counts.internalLinks += 1;
        }
        rowValues.set(p, values);
      }
      const body = impFind(tree, (n) => n.tag === "div" && impHasClass(n, "page-body"));
      blocks = body ? impNotionHtmlBlocks(body, 0, (href) => resolveTarget(p, href), p, counts, skipped, useAsset) : [];
      isStub = !!impFind(tree, (n) => n.tag === "div" && impHasClass(n, "collection-content")) && blocks.every((b) => b.type === "database" || !b.text.trim());
      if (isStub) blocks = [];
    }
    blocks = blocks.map((b) => {
      const image = b.type === "paragraph" ? /^IMPIMAGE:(imp-asset:[^\u0000]+)\u0000(.*)$/.exec(b.text) : null;
      if (image) return { ...b, type: "image" as Block["type"], text: image[2], meta: { src: image[1], width: 100 } };
      const file = b.type === "paragraph" ? /^IMPFILE:(imp-asset:[^\u0000]+)\u0000(.*)$/.exec(b.text) : null;
      if (file) return { ...b, type: "file" as Block["type"], text: file[2], meta: { url: file[1], name: file[2] } };
      const child = b.type === "paragraph" ? /^IMPCHILD:([^\u0000]+)\u0000(.*)$/.exec(b.text) : null;
      if (child) return { ...b, text: child[2], meta: { richText: [{ text: child[2], href: impPageRef(child[1]) }] } };
      if (b.type === "callout") {
        const icon = /^\{icon:([^}]+)\}\s*/.exec(b.text);
        return icon ? { ...b, text: b.text.slice(icon[0].length), meta: { ...(b.meta || {}), tone: "note", icon: icon[1] } } : { ...b, meta: { ...(b.meta || {}), tone: "note" } };
      }
      return b;
    });
    if (isStub) blocks = blocks.filter((b) => b.text.trim());
    for (const b of blocks) {
      if (!IMP_NOTION_TEXT.has(b.type) || (b.meta && Array.isArray(b.meta.richText))) continue;
      const runs = impInlineRuns(b.text, { href: (href) => {
        if (/^(imp-|#)/.test(href)) return href;
        if (IMP_NOTION_UNSAFE.test(href)) { skipped.push({ path: p, code: "script-removed", detail: impNotionScheme(href) + " in a link" }); return null; }
        const t = resolveTarget(p, href);
        if (t.page) { counts.internalLinks += 1; return impPageRef(t.page); }
        if (t.asset) return useAsset(t.asset, IMP_NOTION_IMAGE.test(t.asset) ? "image" : "file");
        if (t.external) return href;
        counts.internalLinksToMissing += 1;
        skipped.push({ path: p, code: "link-missing", detail: href });
        return null;
      } });
      if (runs) { b.text = runs.text; b.meta = { ...(b.meta || {}), richText: runs.richText }; }
    }
    const db = rowDbOf.get(p);
    const clean = impSanitizeBlocks(blocks);
    for (const b of clean.blocks) {
      if (b.type === "callout") counts.callouts += 1;
      if (b.type === "equation") counts.equations += 1;
      if (b.type === "code") counts.codeBlocks += 1;
      if (b.type === "to_do") counts.todos += 1;
    }
    if (clean.removed) skipped.push({ path: p, code: "script-removed", detail: String(clean.removed) });
    const page: ImpPage = { key: p, source: s.id ? "notion:" + s.id : "notion-path:" + p, title, parent: parentOf(p), kind: db ? "db_row" : "note", blocks: clean.blocks, tags: [] };
    pages.push(page);
    pageByPath.set(p, page);
    counts.pages += 1;
  }
  counts.attachments = [...assets.values()].filter((a) => a.kind === "file").length;

  // Databases: typed properties from the csv, rows linked to their row pages.
  const databases: ImpDb[] = [];
  for (const d of dbs.values()) {
    const table = impParseCsv(impDecodeText(await files.get(d.csv)!.read()).text);
    const header = table[0] || [];
    const body = table.slice(1);
    const properties: ImpProperty[] = header.map((name, i) => {
      const inferred = impInferProperty(name, body.map((r) => r[i] ?? ""), i);
      return { id: i === 0 ? "title" : "p" + i, name, type: inferred.type, config: inferred.config };
    });
    const rowPages = pagePaths.filter((p) => rowDbOf.get(p) === d);
    const rows: ImpRow[] = [];
    body.forEach((cells, r) => {
      const name = (cells[0] ?? "").trim();
      const page = rowPages.find((p) => pageByPath.get(p)?.title === name) || rowPages.find((p) => name.startsWith(impNotionStem(p).name)) || "";
      const values: Record<string, unknown> = {};
      properties.forEach((prop, i) => {
        const raw = cells[i] ?? "";
        if (prop.type === "relation") {
          const targets = impRelationTargets(raw) || [];
          const keys: string[] = [];
          for (const t of targets) {
            const found = /^https?:/.test(t) ? resolveTarget(d.csv, t).page : (files.has(t) ? t : resolveTarget(d.csv, t).page || pagePaths.find((pp) => pp.endsWith("/" + t.slice(t.lastIndexOf("/") + 1))));
            if (found && rowDbOf.has(found)) keys.push(found);
            else skipped.push({ path: d.csv, code: "relation-outside", detail: t });
          }
          values[prop.id] = keys;
        } else values[prop.id] = impCellValue(prop, raw);
      });
      if (rows.length >= 20000) { if (rows.length === 20000) skipped.push({ path: d.csv, code: "limit-rows" }); return; }
      if (page) rows.push({ page, values });
      else {
        const key = d.folder + "/__row" + r;
        pages.push({ key, source: "notion-row:" + d.id + ":" + r, title: name || "제목 없음", parent: d.key, kind: "db_row", blocks: [], tags: [] });
        rows.push({ page: key, values });
      }
    });
    counts.databases += 1;
    counts.dbRows += rows.length;
    const stub = pagePaths.find((p) => stemOfPath(p) === d.folder);
    databases.push({ key: d.key, source: d.id ? "notion-db:" + d.id : "notion-db-path:" + d.csv, title: d.name, parent: stub || (d.dir && files.has(d.dir + "." + pageExt) ? d.dir + "." + pageExt : null), properties, rows });
  }
  return { format: opts.format, name: opts.name.replace(/\.zip$/i, ""), pages, databases, assets: [...assets.values()], skipped, counts };
}

function impNotionHtmlBlocks(
  root: ImpNode, indent: number, resolve: (href: string) => { page?: string; asset?: string; external?: boolean }, from: string,
  counts: ReturnType<typeof impEmptyCounts>, skipped: ImpSkip[], useAsset: (path: string, kind: "image" | "file") => string,
): Block[] {
  const out: Block[] = [];
  let n = 0;
  const id = () => "h" + indent + "-" + (n++).toString(36) + "-" + out.length;
  const push = (type: string, text: string, meta?: Record<string, unknown>, extra: Partial<Block> = {}) => out.push({ id: id(), type: type as Block["type"], text, indent, ...(meta ? { meta } : {}), ...extra } as Block);
  for (const c of root.children) {
    if (typeof c === "string") { if (c.trim()) push("paragraph", c.trim()); continue; }
    const md = () => impInlineMd(c).trim();
    switch (c.tag) {
      case "p": if (impText(c).trim()) push("paragraph", md()); break;
      case "h1": case "h2": case "h3": push(c.tag === "h1" ? "heading1" : c.tag === "h2" ? "heading2" : "heading3", md()); break;
      case "blockquote": push("quote", md()); break;
      case "hr": push("divider", ""); break;
      case "pre": {
        const code = impFind(c, (x) => x.tag === "code");
        const lang = /language-([\w+-]+)/.exec(code?.attrs.class || "")?.[1]?.toLowerCase() || "";
        push("code", impText(code || c), lang ? { lang } : undefined);
        break;
      }
      case "figure": {
        if (impHasClass(c, "callout")) {
          const icon = impFind(c, (x) => x.tag === "span" && impHasClass(x, "icon"));
          const divs = c.children.filter((x): x is ImpNode => typeof x !== "string" && x.tag === "div");
          const body = divs[divs.length - 1];
          push("callout", body ? impInlineMd(body).trim() : "", { tone: "note", ...(icon ? { icon: impText(icon).trim() } : {}) });
        } else if (impHasClass(c, "equation")) {
          const tex = impFind(c, (x) => x.tag === "annotation");
          push("equation", impText(tex || c).trim());
        } else if (impHasClass(c, "image")) {
          const img = impFind(c, (x) => x.tag === "img");
          const t = img ? resolve(img.attrs.src || "") : {};
          if (t.asset) { counts.images += 1; push("image", t.asset.slice(t.asset.lastIndexOf("/") + 1), { src: useAsset(t.asset, "image"), width: 100 }); }
          else skipped.push({ path: from, code: "link-missing", detail: img?.attrs.src || "image" });
        } else {
          const a = impFind(c, (x) => x.tag === "a");
          const t = a ? resolve(a.attrs.href || "") : {};
          if (t.asset) push("file", impText(a!).trim(), { url: useAsset(t.asset, "file"), name: impText(a!).trim() });
          else if (a) push("paragraph", impInlineMd(c).trim());
        }
        break;
      }
      case "ul": case "ol": {
        for (const li of c.children) {
          if (typeof li === "string" || li.tag !== "li") continue;
          if (impHasClass(c, "to-do-list")) {
            const checked = !!impFind(li, (x) => impHasClass(x, "checkbox-on"));
            const span = impFind(li, (x) => x.tag === "span");
            push("to_do", span ? impInlineMd(span).trim() : impText(li).trim(), undefined, { checked });
          } else if (impHasClass(c, "toggle")) {
            const details = impFind(li, (x) => x.tag === "details");
            const summary = details ? impFind(details, (x) => x.tag === "summary") : null;
            push("toggle", summary ? impInlineMd(summary).trim() : "");
            if (details) out.push(...impNotionHtmlBlocks({ tag: "div", attrs: {}, children: details.children.filter((x) => x !== summary) }, indent + 1, resolve, from, counts, skipped, useAsset));
          } else {
            const own = { tag: "span", attrs: {}, children: li.children.filter((x) => typeof x === "string" || !(x.tag === "div" && impHasClass(x, "indented")) && x.tag !== "ul" && x.tag !== "ol") } as ImpNode;
            push(c.tag === "ol" ? "numbered" : "bulleted", impInlineMd(own).trim());
            const nested = li.children.filter((x): x is ImpNode => typeof x !== "string" && ((x.tag === "div" && impHasClass(x, "indented")) || x.tag === "ul" || x.tag === "ol"));
            for (const nst of nested) out.push(...impNotionHtmlBlocks(nst.tag === "div" ? nst : { tag: "div", attrs: {}, children: [nst] }, indent + 1, resolve, from, counts, skipped, useAsset));
          }
        }
        break;
      }
      case "table": {
        if (impHasClass(c, "simple-table")) {
          const rows = impFindAll(c, (x) => x.tag === "tr").map((tr) => impFindAll(tr, (x) => x.tag === "td" || x.tag === "th").map((td) => impText(td).trim()));
          if (rows.length) push("table", rows[0].join(" | "), { columns: rows[0], rows: rows.slice(1), header: true });
        }
        break;
      }
      case "nav": push("toc", ""); break;
      case "div": {
        if (impHasClass(c, "collection-content")) {
          for (const a of impFindAll(c, (x) => x.tag === "a")) if (resolve(a.attrs.href || "").page) counts.internalLinks += 1;
          break;
        }
        out.push(...impNotionHtmlBlocks(c, indent, resolve, from, counts, skipped, useAsset));
        break;
      }
      default: if (impText(c).trim()) push("paragraph", md());
    }
  }
  return out;
}
