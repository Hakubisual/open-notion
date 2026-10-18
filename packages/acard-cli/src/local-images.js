// Shared by the stdio MCP bridge and the Claude Code/Codex hook (node:* only, the hook is copied standalone).
// The Acard server cannot read the user's disk, so local image paths in outgoing writes are uploaded here first.
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIMES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const MAX = 4 * 1024 * 1024;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+|<[^>]+>)((?:\s+"[^"]*")?)\)/g;
export const WRITE_TOOLS = new Set(["create_page", "update_page", "append_to_page", "insert_blocks", "update_block"]);

function localFile(src, cwd) {
  let s = src.replace(/^<|>$/g, "");
  if (/^(?:https?|data):/i.test(s) || s.startsWith("/media/")) return null;
  if (/^file:/i.test(s)) { try { s = fileURLToPath(s); } catch { return null; } }
  else s = decodeURIComponent(s);
  if (!MIMES[extname(s).toLowerCase()]) return null;
  const full = isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s) ? s : resolve(cwd, s);
  return existsSync(full) && statSync(full).isFile() ? full : null;
}

export function findLocalImages(markdown, cwd = process.cwd()) {
  const found = [];
  for (const m of String(markdown || "").matchAll(IMAGE)) { const file = localFile(m[2], cwd); if (file) found.push({ src: m[2], file }); }
  return found;
}

async function upload(cfg, page, file) {
  const bytes = readFileSync(file);
  if (bytes.byteLength > MAX) throw new Error(basename(file) + " 은 4MB 보다 커요");
  const url = cfg.server + "/api/v1/media?" + (page ? "page=" + encodeURIComponent(page) + "&" : "") + "name=" + encodeURIComponent(basename(file));
  const res = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + cfg.token, "Content-Type": MIMES[extname(file).toLowerCase()] }, body: bytes, signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(basename(file) + ": " + (data.error || "HTTP " + res.status));
  return data.url;
}

export async function rewriteLocalImages(cfg, tool, args, cwd = process.cwd()) {
  if (!WRITE_TOOLS.has(tool) || !args || typeof args.markdown !== "string") return { args, uploaded: 0, errors: [] };
  const images = findLocalImages(args.markdown, cwd);
  if (!images.length) return { args, uploaded: 0, errors: [] };
  const page = args.page || args.slug || "";
  let markdown = args.markdown, uploaded = 0;
  const errors = [], done = new Map();
  for (const { src, file } of images) {
    try {
      if (!done.has(file)) done.set(file, await upload(cfg, page, file));
      markdown = markdown.split("](" + src).join("](" + done.get(file));
      uploaded++;
    } catch (error) { errors.push(String(error.message || error)); }
  }
  return { args: { ...args, markdown }, uploaded, errors };
}
