// Shared by the stdio MCP bridge and the Claude Code/Codex hook (node:* only, the hook is copied standalone).
// The Acard server cannot read the user's disk, so local image paths in outgoing writes are uploaded here first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIMES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const MAX = 4 * 1024 * 1024;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+|<[^>]+>)((?:\s+"[^"]*")?)\)/g;
export const WRITE_TOOLS = new Set(["create_page", "update_page", "append_to_page", "insert_blocks", "update_block"]);
export const MEDIA_TOOLS = new Set([...WRITE_TOOLS, "attach_images", "attach_video"]);

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
  return uploadBytes(cfg, page, basename(file), MIMES[extname(file).toLowerCase()] || VIDEOS[extname(file).toLowerCase()], bytes);
}

async function uploadBytes(cfg, page, name, mime, bytes) {
  if (bytes.byteLength > MAX) throw new Error(name + " 은 4MB 보다 커요");
  const url = cfg.server + "/api/v1/media?" + (page ? "page=" + encodeURIComponent(page) + "&" : "") + "name=" + encodeURIComponent(name);
  const res = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + cfg.token, "Content-Type": mime }, body: bytes, signal: AbortSignal.timeout(30000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(name + ": " + (data.error || "HTTP " + res.status));
  return data.url;
}

// #33 "pasted:N": the N-th newest image the user pasted into this chat (1 = newest), read from the Claude Code / Codex
// transcript on this machine. The hook gets transcript_path; the stdio bridge uses the newest transcript of this folder.
function newestFile(dir, test, depth = 0) {
  let best = null;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const hit = e.isDirectory() ? (depth < 4 ? newestFile(full, test, depth + 1) : null) : test(e.name) ? { file: full, at: statSync(full).mtimeMs } : null;
    if (hit && (!best || hit.at > best.at)) best = hit;
  }
  return best;
}
export function findTranscript(cwd) {
  if (process.env.ACARD_TRANSCRIPT) return process.env.ACARD_TRANSCRIPT;
  const claudeDir = join(homedir(), ".claude", "projects", String(cwd || "").replace(/[^A-Za-z0-9]/g, "-"));
  const claude = newestFile(claudeDir, (n) => n.endsWith(".jsonl"), 4);
  const codex = newestFile(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions"), (n) => n.endsWith(".jsonl"));
  const picks = [claude, codex].filter(Boolean).sort((a, b) => b.at - a.at);
  return picks.length ? picks[0].file : "";
}
export function pastedImages(transcript) {
  if (!transcript) return [];
  let raw = "";
  try { raw = readFileSync(transcript, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.includes('"image') && !line.includes("input_image")) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const claude = row && row.type === "user" && row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const c of claude) if (c && c.type === "image" && c.source && c.source.type === "base64") out.push({ mime: c.source.media_type, data: c.source.data });
    const p = row && row.payload;
    const codex = p && p.type === "message" && p.role === "user" && Array.isArray(p.content) ? p.content : [];
    for (const c of codex) {
      const m = c && c.type === "input_image" && /^data:([^;,]+);base64,(.*)$/s.exec(String(c.image_url || ""));
      if (m) out.push({ mime: m[1], data: m[2] });
    }
  }
  return out.reverse();
}

async function resolveSrc(cfg, page, src, ctx, done) {
  if (done.has(src)) return done.get(src);
  let url = null;
  const pasted = /^pasted:(\d+)$/.exec(src);
  if (pasted) {
    ctx.pasted ||= pastedImages(ctx.transcript || findTranscript(ctx.cwd));
    const img = ctx.pasted[Number(pasted[1]) - 1];
    if (!img) throw new Error(src + ": 이 대화에서 붙여 넣은 이미지를 찾지 못했어요");
    url = await uploadBytes(cfg, page, "pasted-" + pasted[1] + "." + (String(img.mime).split("/")[1] || "png").replace("jpeg", "jpg"), img.mime, Buffer.from(img.data, "base64"));
  } else {
    const file = localFile(src, ctx.cwd);
    if (!file) return src;
    url = await upload(cfg, page, file);
  }
  done.set(src, url);
  return url;
}

const VIDEOS = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };
const bin = (name) => process.env["ACARD_" + name.toUpperCase()] || name;
const stamp = (sec) => { const s = Math.max(0, Math.floor(sec)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

// Keyframes on this machine (no server transcoding): ffprobe for the length, then one frame at the middle of each of
// `count` equal slices, scaled to at most 1280 px wide. Without ffmpeg the caller gets a note instead of frames.
export function extractFrames(file, count = 4) {
  const n = Math.min(6, Math.max(3, Math.round(Number(count) || 4)));
  let duration;
  try {
    duration = Number(execFileSync(bin("ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8", timeout: 20000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch (error) {
    return { frames: [], note: error && error.code === "ENOENT" ? "이 PC 에 ffmpeg(ffprobe)가 없어 영상 장면을 뽑지 못했어요. ffmpeg 를 설치하거나 장면을 이미지로 저장해 attach_images 로 붙이세요." : "영상을 읽지 못했어요: " + basename(file) };
  }
  if (!Number.isFinite(duration) || duration <= 0) return { frames: [], note: "영상 길이를 알 수 없어요: " + basename(file) };
  const dir = mkdtempSync(join(tmpdir(), "acard-frames-"));
  const frames = [];
  try {
    for (let i = 0; i < n; i++) {
      const at = duration * (i + 0.5) / n;
      const out = join(dir, "frame-" + (i + 1) + ".jpg");
      execFileSync(bin("ffmpeg"), ["-v", "error", "-ss", at.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", "-y", out], { timeout: 30000, windowsHide: true, stdio: "ignore" });
      if (existsSync(out)) frames.push({ time: stamp(at), bytes: readFileSync(out), name: basename(file, extname(file)) + "-" + stamp(at).replace(":", "m") + "s.jpg" });
    }
  } catch (error) {
    if (!frames.length) return { frames: [], note: error && error.code === "ENOENT" ? "이 PC 에 ffmpeg 가 없어 영상 장면을 뽑지 못했어요." : "영상 장면을 뽑지 못했어요: " + basename(file) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { frames, duration };
}

export async function rewriteLocalImages(cfg, tool, args, cwd = process.cwd(), transcript = "") {
  if (!args || typeof args !== "object") return { args, uploaded: 0, errors: [] };
  const page = args.page || args.slug || "";
  const ctx = { cwd, transcript };
  let uploaded = 0;
  const errors = [], done = new Map();
  const next = { ...args };
  // images[] on writes and attach_images: local paths and pasted:N become /media/ urls.
  if ((WRITE_TOOLS.has(tool) || tool === "attach_images") && Array.isArray(args.images)) {
    next.images = [];
    for (const item of args.images) {
      const src = item && typeof item.src === "string" ? item.src : "";
      try {
        const url = src ? await resolveSrc(cfg, page, src, ctx, done) : src;
        if (url !== src) uploaded++;
        next.images.push({ ...item, src: url });
      } catch (error) { errors.push(String(error.message || error)); next.images.push(item); }
    }
  }
  if (tool === "attach_video" && typeof args.path === "string" && args.path && !Array.isArray(args.frames)) {
    const file = localVideo(args.path, cwd);
    if (!file) next.note = "영상 파일을 찾지 못했어요(mp4, mov, webm, m4v): " + args.path;
    else {
      const got = extractFrames(file, args.count);
      if (got.note) next.note = got.note;
      const captions = Array.isArray(args.captions) ? args.captions : [];
      next.frames = [];
      for (const [i, frame] of got.frames.entries()) {
        try {
          next.frames.push({ src: await uploadBytes(cfg, page, frame.name, "image/jpeg", frame.bytes), time: frame.time, ...(captions[i] ? { caption: String(captions[i]) } : {}) });
          uploaded++;
        } catch (error) { errors.push(String(error.message || error)); }
      }
      if (args.upload_video === true) {
        try { next.video = { src: await upload(cfg, page, file), name: basename(file) }; uploaded++; }
        catch (error) { errors.push(String(error.message || error)); }
      }
    }
    delete next.path; delete next.count; delete next.captions; delete next.upload_video;
  }
  if (WRITE_TOOLS.has(tool) && typeof args.markdown === "string") {
    let markdown = args.markdown;
    for (const m of String(markdown).matchAll(IMAGE)) {
      const src = m[2];
      if (!/^<?pasted:\d+>?$/.test(src) && !localFile(src, cwd)) continue;
      try {
        const url = await resolveSrc(cfg, page, src.replace(/^<|>$/g, ""), ctx, done);
        markdown = markdown.split("](" + src).join("](" + url);
        uploaded++;
      } catch (error) { errors.push(String(error.message || error)); }
    }
    next.markdown = markdown;
  }
  return { args: uploaded || next.note || next.frames ? next : args, uploaded, errors };
}

function localVideo(src, cwd) {
  let s = String(src);
  if (/^file:/i.test(s)) { try { s = fileURLToPath(s); } catch { return null; } }
  if (!VIDEOS[extname(s).toLowerCase()]) return null;
  const full = isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s) ? s : resolve(cwd, s);
  return existsSync(full) && statSync(full).isFile() ? full : null;
}
