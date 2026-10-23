// Import sanitizer (#131): blocks and SVG coming from an import never carry executable content. Pure (TextDecoder-free
// string work), runs in the Worker, the browser and tests. `removed` counts dangerous things taken out (scripts, handler
// attributes, javascript:/vbscript:/data:text/html URLs, rejected block URLs and run hrefs); turning an executable block
// type into a code block is a policy downgrade and is not counted.
import type { Block, BlockType } from "./markdown-blocks.ts";

const IMP_SAFE_HREF = /^(https?:|mailto:|\/(?!\/)|#)[^\s\x00-\x1f\x7f\\]*$/i;
const IMP_PLACEHOLDER = /^imp-(?:page|asset):[^\x00-\x1f\x7f]+$/;

export function impSafeHref(value: unknown): string {
  if (typeof value !== "string") return "";
  return IMP_SAFE_HREF.test(value) || IMP_PLACEHOLDER.test(value) ? value : "";
}

const IMP_SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const IMP_SCRIPT_OPEN = /<script\b[^>]*>[\s\S]*$/i;
const IMP_BAD_TAG = /<\/?(?:iframe|object|embed|frame|frameset|meta|base|form)\b[^>]*>/gi;
const IMP_TAG = /<[a-zA-Z][^>]*>/g;
const IMP_ATTR = /[\s/]+([^\s=>/]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
const IMP_MD_LINK = /!?\[([^\]]*)\]\(\s*((?:[^()]|\([^()]*\))*)\)/g;
const IMP_BAD_URL = /^(?:javascript|vbscript):|^data:text\/html/i;

function impDecodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&tab;/gi, "\t").replace(/&newline;/gi, "\n").replace(/&colon;/gi, ":");
}

function impBadUrl(raw: string): boolean {
  const value = impDecodeEntities(raw.replace(/^["']|["']$/g, "")).replace(/[\s\x00-\x1f\x7f]/g, "");
  return IMP_BAD_URL.test(value);
}

export function impSanitizeText(text: string): { text: string; removed: number } {
  let removed = 0;
  let s = String(text ?? "");
  const count = (pattern: RegExp, replacement: string) => { s = s.replace(pattern, () => { removed += 1; return replacement; }); };
  count(IMP_SCRIPT, "");
  count(IMP_SCRIPT_OPEN, "");
  count(IMP_BAD_TAG, "");
  s = s.replace(IMP_TAG, (tag) => tag.replace(IMP_ATTR, (attr, name: string, value: string) => {
    if (/^on/i.test(name) || impBadUrl(value)) { removed += 1; return ""; }
    return attr;
  }).replace(/[\s/"']on[a-z]+\s*=[^>]*/gi, () => { removed += 1; return ""; }));
  s = s.replace(IMP_MD_LINK, (all, label: string, target: string) => {
    if (!impBadUrl(target)) return all;
    removed += 1;
    return label;
  });
  return { text: s, removed };
}

const IMP_EXEC_LANG: Partial<Record<BlockType, string>> = { html: "html", visual: "html", part: "json", component: "json", chart: "json", diagram: "mermaid" };
const IMP_URL_TYPES = new Set<BlockType>(["video", "audio", "file", "embed", "bookmark", "button"]);

function impParagraph(block: Block, text: string): Block {
  const out: Block = { id: block.id, type: "paragraph", text };
  if (block.indent !== undefined) out.indent = block.indent;
  return out;
}

export function impSanitizeBlocks(blocks: Block[]): { blocks: Block[]; removed: number } {
  let removed = 0;
  const out = blocks.map((block) => {
    const lang = IMP_EXEC_LANG[block.type];
    if (lang) return { ...block, type: "code" as BlockType, meta: { lang } };
    if (block.type === "code") return block;
    const meta = block.meta ? { ...block.meta } : undefined;
    const next: Block = meta ? { ...block, meta } : { ...block };
    const cleaned = impSanitizeText(block.text);
    if (cleaned.removed) {
      removed += cleaned.removed;
      next.text = cleaned.text;
      if (meta) delete meta.richText;
    }
    if (block.type === "image") {
      if (impSafeHref(meta?.src)) return next;
      removed += 1;
      return impParagraph(next, next.text);
    }
    if (IMP_URL_TYPES.has(block.type) && meta && typeof meta.url === "string" && meta.url && !impSafeHref(meta.url)) {
      removed += 1;
      return impParagraph(next, next.text || (typeof meta.name === "string" ? meta.name : ""));
    }
    if (meta && Array.isArray(meta.richText)) {
      meta.richText = meta.richText.map((run) => {
        if (!run || typeof run !== "object" || !("href" in run) || impSafeHref((run as { href: unknown }).href)) return run;
        removed += 1;
        const { href: _drop, ...rest } = run as Record<string, unknown>;
        return rest;
      });
    }
    return next;
  });
  return { blocks: out, removed };
}

const IMP_SVG_TAGS = ["script", "foreignObject", "iframe", "embed", "object", "handler", "listener", "audio", "video", "canvas"];
const IMP_SVG_DATA = /^data:image\/(?:png|jpeg|gif|webp);base64,/i;

function impSvgRefOk(value: string): boolean {
  return value.startsWith("#") || IMP_SVG_DATA.test(value);
}

export function impSanitizeSvg(svgText: string): string {
  let s = String(svgText).replace(/<!DOCTYPE[\s\S]*?(?:\[[\s\S]*?\])?\s*>/gi, "").replace(/<!ENTITY[\s\S]*?>/gi, "").replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, "");
  for (const tag of IMP_SVG_TAGS) {
    s = s.replace(new RegExp("<" + tag + "\\b[\\s\\S]*?<\\/" + tag + "\\s*>", "gi"), "").replace(new RegExp("<" + tag + "\\b[^>]*\\/?>", "gi"), "");
  }
  s = s.replace(/<(set|animate\w*)\b[^>]*attributeName\s*=\s*["']?(?:xlink:)?href[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi, "");
  s = s.replace(/[\s/](on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ");
  s = s.replace(/[\s/]((?:xlink:)?href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (all, _name, value: string) => {
    return impSvgRefOk(value.replace(/^["']|["']$/g, "").trim()) ? all : "";
  });
  s = s.replace(/@import[^;]*;?/gi, "");
  s = s.replace(/url\(\s*(["']?)([^)]*?)\1\s*\)/gi, (all, _q, value: string) => (impSvgRefOk(value.trim()) ? all : "none"));
  s = s.replace(/javascript:/gi, "");
  return s;
}
