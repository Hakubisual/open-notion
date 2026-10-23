// Obsidian vault (zip or folder pick) -> ImpPlan (issue 130). Pure: runs in the Worker (inlined), the browser import
// engine and tests; every top-level name starts with "imp" because the Worker inlines all import-*.ts into one scope.
// Also reads plain markdown folders (same rules without .obsidian/). Links resolve in Obsidian's order: exact vault path,
// path relative to the note, unique basename, alias; a basename shared by several notes prefers the same folder, else the
// first by path and an ImpSkip "link-ambiguous". Note embeds become links ("embed-as-link"), so a self embed cannot loop.
import { impAssetRef, impEmptyCounts, impPageRef, type ImpAsset, type ImpEntry, type ImpPage, type ImpPlan, type ImpSkip } from "./import-plan.ts";
import { impDecodeText } from "./import-zip.ts";
import { impInlineRuns } from "./import-inline.ts";
import { impSanitizeBlocks } from "./import-sanitize.ts";
import { markdownToBlocks, type Block } from "./markdown-blocks.ts";

type ImpObsNote = { path: string; dir: string; base: string; text: string; front: Record<string, unknown>; aliases: string[]; title: string };

const IMP_OBS_IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const IMP_OBS_TONES: Record<string, string> = {
  note: "note", info: "note", todo: "note", abstract: "info", summary: "info", tldr: "info", example: "info",
  tip: "tip", hint: "tip", important: "tip", success: "success", check: "success", done: "success",
  question: "question", help: "question", faq: "question", warning: "warning", caution: "warning", attention: "warning",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger", quote: "quote", cite: "quote",
};
const IMP_OBS_TEXT_TYPES = new Set(["paragraph", "heading1", "heading2", "heading3", "heading4", "bulleted", "numbered", "to_do", "toggle", "quote", "callout"]);

function impObsDir(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

function impObsJoin(dir: string, rel: string): string {
  const out: string[] = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function impObsDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

// A YAML subset: "key: scalar", "key: [a, b]", "key:" followed by "  - item" lines; quoted strings, numbers, booleans.
function impObsFrontMatter(text: string): { front: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { front: {}, body: text };
  const front: Record<string, unknown> = {};
  let listKey = "";
  const scalar = (raw: string): unknown => {
    const v = raw.trim();
    if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1);
    if (v === "true" || v === "false") return v === "true";
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { (front[listKey] as unknown[]).push(scalar(item[1])); continue; }
    const kv = /^([A-Za-z0-9_\-가-힣]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest.trim() === "") { front[key] = []; listKey = key; continue; }
    listKey = "";
    const list = /^\[(.*)\]$/.exec(rest.trim());
    front[key] = list ? list[1].split(",").map((s) => scalar(s)).filter((s) => s !== "") : scalar(rest);
  }
  return { front, body: text.slice(m[0].length) };
}

function impObsList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// Inline #tags outside code spans, links and URLs; not headings (they are block syntax) and not pure numbers.
function impObsInlineTags(body: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence || /^\s*#{1,6}\s/.test(line)) continue;
    const clean = line.replace(/`[^`]*`/g, " ").replace(/\[\[[^\]]*\]\]/g, " ").replace(/\]\([^)]*\)/g, " ").replace(/https?:\/\/\S+/g, " ");
    for (const m of clean.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_\-/]+)/gu)) {
      const tag = m[1].replace(/\/+$/, "");
      if (tag && !/^\d+$/.test(tag)) out.push(tag);
    }
  }
  return out;
}

export async function impObsidianPlan(entries: ImpEntry[], opts: { name: string }): Promise<ImpPlan> {
  const skipped: ImpSkip[] = [];
  const counts = impEmptyCounts();
  // Vault root: one shared top folder is the vault itself, not a page.
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  const rootPrefix = tops.size === 1 && entries.every((e) => e.path.includes("/")) ? [...tops][0] + "/" : "";
  const vault = rootPrefix ? rootPrefix.slice(0, -1) : opts.name.replace(/\.zip$/i, "") || "vault";
  const rel = (path: string) => (rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path);
  const files = new Map<string, ImpEntry>();
  for (const e of entries) {
    const p = rel(e.path);
    if (!p || p.startsWith(".trash/")) continue;
    files.set(p, e);
  }

  let attachmentFolder = "/";
  const appJson = files.get(".obsidian/app.json");
  if (appJson) {
    try { attachmentFolder = String(JSON.parse(impDecodeText(await appJson.read()).text).attachmentFolderPath ?? "/"); } catch { /* default vault root */ }
  }

  const notes: ImpObsNote[] = [];
  const other: string[] = [];
  for (const [path, e] of files) {
    if (path.startsWith(".obsidian/")) continue;
    if (!/\.md$/i.test(path)) { other.push(path); continue; }
    const { text } = impDecodeText(await e.read());
    const { front, body } = impObsFrontMatter(text);
    if (front["excalidraw-plugin"] !== undefined) { skipped.push({ path, code: "plugin-syntax", detail: "Excalidraw drawing" }); continue; }
    const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    const h1 = /^\s*#\s+(.+?)\s*$/m.exec(body.split(/\r?\n/).find((l) => l.trim()) || "");
    const title = typeof front.title === "string" && front.title.trim() ? front.title.trim() : h1 ? h1[1] : base;
    if (path === "index.md" && /^#\s+목차\s*$/m.test(body) && body.split(/\r?\n/).filter((l) => l.trim()).slice(1).every((l) => /^- \[[^\]]*\]\(\.\/[^)]+\.md\)$/.test(l.trim()))) continue;
    notes.push({ path, dir: impObsDir(path), base, text: body, front, aliases: impObsList(front.aliases ?? front.alias), title });
  }
  notes.sort((a, b) => a.path.localeCompare(b.path));

  const byPath = new Map(notes.map((n) => [n.path.replace(/\.md$/i, "").toLowerCase(), n]));
  const byBase = new Map<string, ImpObsNote[]>();
  for (const n of notes) (byBase.get(n.base.toLowerCase()) || byBase.set(n.base.toLowerCase(), []).get(n.base.toLowerCase())!).push(n);
  const byAlias = new Map<string, ImpObsNote>();
  for (const n of notes) for (const a of n.aliases) if (!byAlias.has(a.toLowerCase())) byAlias.set(a.toLowerCase(), n);
  const fileByBase = new Map<string, string[]>();
  for (const p of other) { const b = p.slice(p.lastIndexOf("/") + 1).toLowerCase(); (fileByBase.get(b) || fileByBase.set(b, []).get(b)!).push(p); }

  function findNote(target: string, from: ImpObsNote, skipPath: string): ImpObsNote | null {
    const t = impObsDecode(target).replace(/\.md$/i, "").trim();
    if (!t) return from;
    const exact = byPath.get(t.toLowerCase());
    if (exact) return exact;
    const relative = byPath.get(impObsJoin(from.dir, t).toLowerCase());
    if (relative) return relative;
    const base = t.slice(t.lastIndexOf("/") + 1).toLowerCase();
    const same = byBase.get(base) || [];
    if (same.length === 1) return same[0];
    if (same.length > 1) {
      const local = same.find((n) => n.dir === from.dir);
      if (local) return local;
      skipped.push({ path: skipPath, code: "link-ambiguous", detail: "[[" + target + "]] -> " + same[0].path });
      return same[0];
    }
    return byAlias.get(t.toLowerCase()) || null;
  }

  function findFile(target: string, from: ImpObsNote): string | null {
    const t = impObsDecode(target).trim();
    const candidates: string[] = [t, impObsJoin(from.dir, t)];
    if (attachmentFolder === "./" || attachmentFolder === ".") candidates.push(impObsJoin(from.dir, t));
    else if (attachmentFolder.startsWith("./")) candidates.push(impObsJoin(impObsJoin(from.dir, attachmentFolder.slice(2)), t));
    else if (attachmentFolder && attachmentFolder !== "/") candidates.push(impObsJoin(attachmentFolder, t));
    for (const c of candidates) if (files.has(c) && !/\.md$/i.test(c)) return c;
    const named = fileByBase.get(t.slice(t.lastIndexOf("/") + 1).toLowerCase()) || [];
    return named[0] || null;
  }

  const assets = new Map<string, ImpAsset>();
  const useAsset = (path: string, kind: "image" | "file") => {
    if (!assets.has(path)) {
      const entry = files.get(path)!;
      assets.set(path, { key: path, path, name: path.slice(path.lastIndexOf("/") + 1), kind, size: entry.size, read: () => entry.read() });
      if (kind === "file") counts.attachments = [...assets.values()].filter((a) => a.kind === "file").length;
    }
    return impAssetRef(path);
  };

  // Folders become pages so the tree matches the vault; the vault root itself is not a page.
  const pages: ImpPage[] = [];
  const folderKey = (dir: string) => "folder:" + dir;
  const folders = new Set<string>();
  for (const n of notes) {
    const segs = n.dir ? n.dir.split("/") : [];
    for (let i = 1; i <= segs.length; i++) folders.add(segs.slice(0, i).join("/"));
  }
  for (const dir of [...folders].sort()) {
    const parentDir = impObsDir(dir);
    pages.push({ key: folderKey(dir), source: "obsidian:" + vault + "/" + dir + "/", title: dir.slice(dir.lastIndexOf("/") + 1), parent: parentDir ? folderKey(parentDir) : null, kind: "folder", blocks: [], tags: [] });
  }

  const tagSet = new Set<string>();
  for (const n of notes) {
    const tags = [...impObsList(n.front.tags ?? n.front.tag), ...impObsInlineTags(n.text)].map((t) => t.replace(/^#/, ""));
    const uniq = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    uniq.forEach((t) => tagSet.add(t.toLowerCase()));
    let body = n.text.replace(/%%[\s\S]*?%%/g, "");
    // Embeds first: ![[x]] / ![[x|300]] / ![[note#h]]; then the callout fold markers.
    const embedLines: Block[] = [];
    body = body.replace(/!\[\[([^\]\n]+)\]\]/g, (all, inner: string) => {
      const [targetRaw, sizeRaw] = inner.split("|");
      const target = targetRaw.split("#")[0].trim();
      const file = target && !/\.md$/i.test(target) && /\.[a-z0-9]{2,5}$/i.test(target) ? findFile(target, n) : null;
      if (file) {
        if (IMP_OBS_IMAGE.test(file)) {
          counts.images += 1;
          const px = sizeRaw ? Number(/^(\d+)/.exec(sizeRaw.trim())?.[1]) : 0;
          const width = px ? Math.min(100, Math.max(10, Math.round(px / 7.6))) : 100;
          return "![" + file.slice(file.lastIndexOf("/") + 1).replace(/[\]]/g, "") + "](" + useAsset(file, "image") + ' "' + width + '")';
        }
        return "\n\nIMPFILE:" + useAsset(file, "file") + "\u0000" + file.slice(file.lastIndexOf("/") + 1) + "\n\n";
      }
      const note = target ? findNote(target, n, n.path) : n;
      counts.embedsNote += 1;
      if (!note && target) {
        skipped.push({ path: n.path, code: "link-missing", detail: all });
        return inner;
      }
      skipped.push({ path: n.path, code: "embed-as-link", detail: all });
      const label = (inner.split("|")[1] || note!.title).replace(/[\[\]]/g, "");
      return "[" + label + "](" + impPageRef(note!.path) + ")";
    });
    body = body.replace(/\[\[([^\]|#\n]*)#\^[^\]|\n]*(\|[^\]\n]*)?\]\]/g, (_all, target: string, alias: string | undefined) => "[[" + target + (alias || "") + "]]");
    body = body.replace(/^>\s*>\s*(?=\[!)/gm, "\n> ");
    body = body.replace(/^(>\s*)+\[!(\w+)\]([+-]?)[ \t]*(.*)$/gm, (_all, _q, type: string, _fold, title: string) => "> [!" + (IMP_OBS_TONES[type.toLowerCase()] || "note") + "] " + title);
    // Nested callouts ("> > [!x]") become their own callout lines so both are kept.
    body = body.replace(/^>\s*>\s*/gm, "> ");
    const resolve = (target: string, label: string, heading: string) => {
      const found = findNote(target, n, n.path);
      if (!found) {
        counts.internalLinksToMissing += 1;
        skipped.push({ path: n.path, code: "link-missing", detail: "[[" + target + "]]" });
        return null;
      }
      counts.internalLinks += 1;
      const head = heading && !heading.startsWith("^") ? heading : "";
      return { href: impPageRef(found.path, head) };
    };
    body = body.replace(/^\s*\|.*\|\s*$/gm, (line) => line.replace(/\[\[([^\]|\\]+?)(?:\\?\|([^\]]+))?\]\]/g, (_all, target: string, label: string | undefined) => {
      const [t, heading = ""] = target.split("#");
      resolve(t, label || t, heading);
      return label || t;
    }));
    let blocks = markdownToBlocks(body).map((b) => {
      const m = b.type === "paragraph" ? /^IMPFILE:(imp-asset:[^\u0000]+)\u0000(.*)$/.exec(b.text) : null;
      return m ? { ...b, type: "file" as Block["type"], text: m[2], meta: { url: m[1], name: m[2] } } : b;
    });
    if (blocks.length && blocks[0].type === "heading1" && (blocks[0].text.trim() === n.title || blocks[0].text.trim() === n.base)) blocks = blocks.slice(1);
    for (const b of blocks) {
      if (b.type === "callout") counts.callouts += 1;
      if (b.type === "equation") counts.equations += 1;
      if (b.type === "code") { counts.codeBlocks += 1; if (/^dataview(js)?$/i.test(String(b.meta?.lang || ""))) skipped.push({ path: n.path, code: "plugin-syntax", detail: "dataview" }); }
      if (b.type === "to_do") counts.todos += 1;
      if (b.type === "diagram") { counts.codeBlocks += 1; b.type = "code"; b.meta = { lang: "mermaid" }; }
      if (b.type === "paragraph") counts.equations += (b.text.match(/(^|[^$\\])\$[^$\s][^$\n]*\$(?!\$)/g) || []).length;
    }
    // [[links]] and [x](note.md) links -> page placeholders.
    for (const b of blocks) {
      if (!IMP_OBS_TEXT_TYPES.has(b.type)) continue;
      const text = b.text.replace(/\[([^\]]+)\]\(<?([^)>]+?\.md)>?\)/g, (all, label: string, target: string) => (target.startsWith("imp-") ? all : "[[" + target.replace(/\.md$/i, "") + "|" + label + "]]"));
      const runs = impInlineRuns(text, { link: resolve });
      if (runs) { b.text = runs.text; b.meta = { ...(b.meta || {}), richText: runs.richText }; }
      else b.text = text;
    }
    // Front matter other than tags/aliases/cssclasses/title: a small property table at the top.
    const props = Object.entries(n.front).filter(([k]) => !["tags", "tag", "aliases", "alias", "cssclasses", "cssclass", "title"].includes(k));
    if (props.length) {
      const rows = props.map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v === true ? "예" : v === false ? "아니요" : String(v)]);
      blocks.unshift({ id: "props", type: "table", text: "속성 | 값", meta: { columns: ["속성", "값"], rows, header: true } } as Block);
    }
    counts.pages += 1;
    pages.push({ key: n.path, source: "obsidian:" + vault + "/" + n.path, title: n.title, parent: n.dir ? folderKey(n.dir) : null, kind: "note", blocks: impSanitizeBlocks(blocks).blocks, tags: uniq });
  }
  counts.tags = tagSet.size;
  counts.attachments = [...assets.values()].filter((a) => a.kind === "file").length;

  const used = new Set(assets.keys());
  for (const p of other) {
    if (used.has(p)) continue;
    if (/\.canvas$/i.test(p)) skipped.push({ path: p, code: "canvas" });
    else if (!IMP_OBS_IMAGE.test(p) && !/\.pdf$/i.test(p)) skipped.push({ path: p, code: "file-type" });
  }
  return { format: "obsidian", name: vault, pages, databases: [], assets: [...assets.values()], skipped, counts };
}
