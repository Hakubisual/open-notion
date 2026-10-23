// Markdown paste (issue 134): text copied from Obsidian, an AI chat or a Notion page becomes real blocks. build.ts
// bundles this entry with the import modules into lazy/paste-md.js; editor-next loads it on the first paste that looks
// like markdown and calls pasteBlocks(text, titles).
import { markdownToBlocks } from "../../../markdown-blocks.ts";
import { impInlineRuns } from "../../../import-inline.ts";
import { impSanitizeBlocks } from "../../../import-sanitize.ts";

const TONES = { note: "note", info: "note", todo: "note", abstract: "info", summary: "info", tldr: "info", example: "info", tip: "tip", hint: "tip", important: "tip", success: "success", check: "success", done: "success", question: "question", help: "question", faq: "question", warning: "warning", caution: "warning", attention: "warning", failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger", quote: "quote", cite: "quote" };
const TEXT = new Set(["paragraph", "heading1", "heading2", "heading3", "heading4", "bulleted", "numbered", "to_do", "toggle", "quote", "callout"]);

function pasteBlocks(text, titles) {
  let body = String(text || "").replace(/\r\n?/g, "\n");
  const front = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(body);
  if (front) body = body.slice(front[0].length);
  body = body.replace(/%%[\s\S]*?%%/g, "");
  body = body.replace(/^>\s*>\s*(?=\[!)/gm, "\n> ");
  body = body.replace(/^(>\s*)+\[!(\w+)\]([+-]?)[ \t]*(.*)$/gm, (_all, _q, type, _fold, title) => "> [!" + (TONES[type.toLowerCase()] || "note") + "] " + title);
  const bySlug = new Map();
  for (const t of titles || []) bySlug.set(String(t.title || "").toLowerCase(), String(t.slug));
  const link = (target) => {
    const slug = bySlug.get(String(target).replace(/\.md$/i, "").split("/").pop().toLowerCase());
    return slug ? { mention: slug } : null;
  };
  const blocks = markdownToBlocks(body);
  for (const b of blocks) {
    if (!TEXT.has(b.type)) continue;
    const runs = impInlineRuns(b.text, { link, href: (href) => (/^(https?:|mailto:|\/(?!\/)|#)/i.test(href) ? href : null) });
    if (!runs) continue;
    b.text = runs.text;
    b.meta = { ...(b.meta || {}), richText: runs.richText };
  }
  return impSanitizeBlocks(blocks).blocks;
}

window.AcardEditor.provide("paste-md", { pasteBlocks });
