// Acard export zip -> ImpPlan (#133). The zip holds acard-export.json (format "acard-export", version 1), one acard-md
// file per page, files/<mediaId>-<name> per referenced media and a csv per database (ignored here: the manifest carries
// the typed rows). Pure, runs in the Worker, browsers and tests; every top-level name starts with "imp".
//   impAcardPlan(entries, { name }) -> ImpPlan   page key = slug, db key = slug, asset key = media.file
import { IMP_LIMITS, impAssetRef, impEmptyCounts, impPageRef, type ImpAsset, type ImpDb, type ImpEntry, type ImpPage, type ImpPlan, type ImpProperty, type ImpSkip } from "./import-plan.ts";
import { impDecodeText } from "./import-zip.ts";
import { impInlineRuns, type ImpRun } from "./import-inline.ts";
import { impSanitizeBlocks } from "./import-sanitize.ts";
import { acardMetaDocument, markdownToBlocks, type Block } from "./markdown-blocks.ts";

export type ImpAcardManifest = {
  format: "acard-export";
  version: number;
  pages?: { slug: string; title?: string; parent?: string | null; kind?: string; file?: string; tags?: string[]; icon?: string }[];
  databases?: { slug: string; title?: string; parent?: string | null; properties?: ImpProperty[]; rows?: { page: string; values?: Record<string, unknown> }[] }[];
  media?: { id: string; name?: string; mime?: string; file?: string }[];
};

const IMP_ACARD_MANIFEST = "acard-export.json";
const IMP_ACARD_TEXT_TYPES = new Set<string>(["paragraph", "heading1", "heading2", "heading3", "heading4", "bulleted", "numbered", "to_do", "toggle", "quote", "callout"]);
const IMP_ACARD_URL_TYPES = new Set<string>(["file", "video", "audio"]);
const IMP_ACARD_PAGE_HREF = /^\/([^/?#]+)\/?(?:#(.*))?$/;
const IMP_ACARD_MEDIA_HREF = /^\/media\/([^/?#]+)/;
const IMP_ACARD_FILE_HREF = /(?:^|\/)(files\/[^/]+)$/;
// "- [file] files/<id>-<name> label": markdownToBlocks keeps only absolute urls on these lines, so the zip path becomes /media/<id> first.
const IMP_ACARD_MEDIA_LINE = /^(\s*[-*]\s+\[(?:file|video|audio)\]\s+)(\S+)/;

function impAcardError(code: string, detail: string): Error {
  return Object.assign(new Error(`${code}: ${detail}`), { code });
}

function impAcardDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function impAcardStripFrontMatter(text: string): string {
  const doc = acardMetaDocument(text);
  if (doc.flagged) return doc.body;
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export async function impAcardPlan(entries: ImpEntry[], opts: { name: string }): Promise<ImpPlan> {
  const manifestEntry = entries.find((e) => e.path === IMP_ACARD_MANIFEST);
  if (!manifestEntry) throw impAcardError("empty", "acard-export.json missing");
  let manifest: ImpAcardManifest;
  try {
    manifest = JSON.parse(impDecodeText(await manifestEntry.read()).text) as ImpAcardManifest;
  } catch (err) {
    throw impAcardError("corrupt", `acard-export.json: ${(err as Error).message}`);
  }
  if (!manifest || manifest.format !== "acard-export" || !Array.isArray(manifest.pages)) throw impAcardError("corrupt", "acard-export.json is not an Acard export");

  const byPath = new Map(entries.map((e) => [e.path, e]));
  const skipped: ImpSkip[] = [];
  const counts = impEmptyCounts();
  const pageSlugs = new Set<string>();
  const titleToSlug = new Map<string, string>();
  for (const p of manifest.pages) {
    if (!p || typeof p.slug !== "string" || !p.slug) continue;
    pageSlugs.add(p.slug);
    if (p.title && !titleToSlug.has(p.title)) titleToSlug.set(p.title, p.slug);
  }
  const dbSlugs = new Set<string>();
  for (const d of manifest.databases ?? []) if (d && typeof d.slug === "string" && d.slug) dbSlugs.add(d.slug);

  // media id -> asset key (the zip path), only for files that are really in the archive
  const assets: ImpAsset[] = [];
  const assetByMediaId = new Map<string, string>();
  const mediaIdByFile = new Map<string, string>();
  for (const m of manifest.media ?? []) {
    if (!m || typeof m.id !== "string" || typeof m.file !== "string") continue;
    const entry = byPath.get(m.file);
    if (!entry) {
      skipped.push({ path: m.file, code: "unreadable", detail: "media file listed in acard-export.json is not in the archive" });
      continue;
    }
    const kind: ImpAsset["kind"] = typeof m.mime === "string" && m.mime.startsWith("image/") ? "image" : "file";
    assets.push({ key: m.file, path: m.file, name: m.name || m.file.slice(m.file.lastIndexOf("/") + 1), kind, size: entry.size, read: entry.read });
    assetByMediaId.set(m.id, m.file);
    mediaIdByFile.set(m.file, m.id);
  }
  const assetFor = (href: string): string | null => {
    const media = IMP_ACARD_MEDIA_HREF.exec(href);
    if (media) return assetByMediaId.get(media[1]) ?? null;
    const file = IMP_ACARD_FILE_HREF.exec(href);
    if (file && mediaIdByFile.has(file[1])) return file[1];
    return null;
  };
  const isMediaHref = (href: string) => IMP_ACARD_MEDIA_HREF.test(href) || IMP_ACARD_FILE_HREF.test(href);
  const rewriteMediaLines = (body: string) =>
    body
      .split("\n")
      .map((line) => {
        const m = IMP_ACARD_MEDIA_LINE.exec(line);
        const file = m ? IMP_ACARD_FILE_HREF.exec(m[2]) : null;
        const id = file ? mediaIdByFile.get(file[1]) : undefined;
        return m && id ? m[1] + "/media/" + id + line.slice(m[0].length) : line;
      })
      .join("\n");

  const wikiLink = (target: string, _label: string, heading: string) => {
    const slug = pageSlugs.has(target) ? target : titleToSlug.get(target);
    return slug ? { href: impPageRef(slug, heading) } : null;
  };

  const pages: ImpPage[] = [];
  const tagSet = new Set<string>();
  for (const p of manifest.pages) {
    if (!p || typeof p.slug !== "string" || !p.slug) continue;
    if (pages.length >= IMP_LIMITS.pages) {
      skipped.push({ path: p.file || p.slug, code: "limit-pages" });
      continue;
    }
    const entry = typeof p.file === "string" ? byPath.get(p.file) : undefined;
    let blocks: Block[] = [];
    let fmTitle = "";
    if (entry) {
      const text = impDecodeText(await entry.read()).text;
      fmTitle = acardMetaDocument(text).title;
      blocks = markdownToBlocks(rewriteMediaLines(impAcardStripFrontMatter(text)), { meta: true });
    } else if (p.file) {
      skipped.push({ path: p.file, code: "unreadable", detail: "page file listed in acard-export.json is not in the archive" });
    }
    const pagePath = p.file || p.slug;
    const resolveRun = (run: ImpRun): ImpRun => {
      if (typeof run.href !== "string") return run;
      if (run.href.startsWith("imp-page:")) {
        counts.internalLinks += 1;
        return run;
      }
      const asset = assetFor(run.href);
      if (asset) {
        counts.attachments += 1;
        return { ...run, href: impAssetRef(asset) };
      }
      const page = IMP_ACARD_PAGE_HREF.exec(run.href);
      if (page && pageSlugs.has(page[1])) {
        counts.internalLinks += 1;
        return { ...run, href: impPageRef(page[1], page[2] ? impAcardDecode(page[2]) : undefined) };
      }
      if (!page && !isMediaHref(run.href)) return run;
      if (page) counts.internalLinksToMissing += 1;
      skipped.push({ path: pagePath, code: "link-missing", detail: run.href });
      const { href: _drop, ...rest } = run;
      return rest;
    };
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      if (IMP_ACARD_TEXT_TYPES.has(block.type)) {
        const inline = impInlineRuns(block.text, { link: wikiLink });
        if (inline) {
          block.text = inline.text;
          block.meta = { ...block.meta, richText: inline.richText.map(resolveRun) };
        }
      }
      if (block.type === "image" && typeof block.meta?.src === "string") {
        const asset = assetFor(block.meta.src);
        if (asset) {
          counts.images += 1;
          block.meta = { ...block.meta, src: impAssetRef(asset) };
        } else if (isMediaHref(block.meta.src)) {
          skipped.push({ path: pagePath, code: "link-missing", detail: block.meta.src });
          blocks[i] = { id: block.id, type: "paragraph", text: block.text, indent: block.indent };
        }
      } else if (IMP_ACARD_URL_TYPES.has(block.type) && typeof block.meta?.url === "string") {
        const asset = assetFor(block.meta.url);
        if (asset) {
          counts.attachments += 1;
          block.meta = { ...block.meta, url: impAssetRef(asset) };
        } else if (isMediaHref(block.meta.url)) {
          skipped.push({ path: pagePath, code: "link-missing", detail: block.meta.url });
          blocks[i] = { id: block.id, type: "paragraph", text: block.text || String(block.meta.name || ""), indent: block.indent };
        }
      }
      if (block.type === "callout") counts.callouts += 1;
      else if (block.type === "equation") counts.equations += 1;
      else if (block.type === "code") counts.codeBlocks += 1;
      else if (block.type === "to_do") counts.todos += 1;
    }
    const tags = Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
    for (const t of tags) tagSet.add(t.toLowerCase());
    const parent = typeof p.parent === "string" && (pageSlugs.has(p.parent) || dbSlugs.has(p.parent)) ? p.parent : null;
    const kind: ImpPage["kind"] = p.kind === "db_row" || p.kind === "folder" ? p.kind : "note";
    const page: ImpPage = { key: p.slug, source: "acard:" + p.slug, title: p.title || fmTitle || p.slug, parent, kind, blocks: impSanitizeBlocks(blocks).blocks, tags };
    if (typeof p.icon === "string" && p.icon) page.icon = p.icon;
    pages.push(page);
  }
  counts.pages = pages.length;
  counts.tags = tagSet.size;

  const databases: ImpDb[] = [];
  for (const d of manifest.databases ?? []) {
    if (!d || typeof d.slug !== "string" || !d.slug) continue;
    const properties = Array.isArray(d.properties) ? d.properties.filter((pr) => pr && typeof pr.id === "string" && typeof pr.name === "string" && typeof pr.type === "string") : [];
    const relationIds = new Set(properties.filter((pr) => pr.type === "relation").map((pr) => pr.id));
    const rows: ImpDb["rows"] = [];
    for (const r of d.rows ?? []) {
      if (!r || typeof r.page !== "string" || !pageSlugs.has(r.page)) continue;
      if (rows.length >= IMP_LIMITS.rowsPerDatabase) {
        skipped.push({ path: d.slug, code: "limit-rows", detail: r.page });
        continue;
      }
      const values: Record<string, unknown> = {};
      for (const [id, value] of Object.entries(r.values ?? {})) {
        if (!relationIds.has(id)) {
          values[id] = value;
          continue;
        }
        const targets = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "string" ? [value] : [];
        const inside = targets.filter((t) => pageSlugs.has(t));
        for (const t of targets) if (!pageSlugs.has(t)) skipped.push({ path: r.page, code: "relation-outside", detail: t });
        values[id] = inside;
      }
      rows.push({ page: r.page, values });
    }
    const parent = typeof d.parent === "string" && pageSlugs.has(d.parent) ? d.parent : null;
    databases.push({ key: d.slug, source: "acard:" + d.slug, title: d.title || d.slug, parent, properties, rows });
    counts.dbRows += rows.length;
  }
  counts.databases = databases.length;

  return { format: "acard", name: opts.name, pages, databases, assets, skipped, counts };
}
