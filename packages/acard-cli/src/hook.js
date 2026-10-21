// Copied standalone to ~/.acard/hook.mjs by `acard hooks install`: node:* imports only; always exits 0.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";

const HOME = process.env.ACARD_HOME || join(homedir(), ".acard");
const STATE = join(HOME, "hook-state.json");
const CONFIG = join(HOME, "config.json");
const LOG = join(HOME, "hook.log");
const TIMEOUT_MS = 10000;
const PART = 1800;
const TRANSCRIPT_TAIL = 400000;

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
const log = (line) => { try { mkdirSync(HOME, { recursive: true }); appendFileSync(LOG, new Date().toISOString() + " " + line + "\n"); } catch {} };
const clip = (s, n) => { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Same masks as the server (features/journal.js) so secrets never leave this machine.
const SECRET_PATTERNS = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, /\bsk-ant-[A-Za-z0-9_-]{10,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{30,}/g, /\bacard_[A-Za-z0-9._-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
const KEYED = /\b(authorization|bearer|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)(["']?\s*[:=]\s*["']?|\s+)([^\s"',;]{6,})/gi;
export function redact(text) {
  let out = String(text ?? "");
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[가림]");
  return out.replace(KEYED, (_, key, sep) => key + sep + "[가림]");
}

const git = (cwd, args) => { try { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim(); } catch { return ""; } };
export function detectProject(cwd) {
  if (process.env.ACARD_PROJECT) return clip(process.env.ACARD_PROJECT, 60);
  if (!cwd) return "";
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  const fromRemote = remote.replace(/\/+$/, "").split(/[/:]/).pop().replace(/\.git$/, "");
  if (fromRemote) return clip(fromRemote, 60);
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  return clip(basename(top || cwd), 60);
}

// The last turn of a Claude Code or Codex transcript (JSONL): the files edited in it.
export function turnFiles(path, cwd) {
  if (!path) return [];
  let raw = "";
  try {
    const size = statSync(path).size;
    raw = readFileSync(path, "utf8");
    if (size > TRANSCRIPT_TAIL) raw = raw.slice(-TRANSCRIPT_TAIL);
  } catch { return []; }
  const lines = raw.split("\n").filter(Boolean);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/"type":"user"/.test(l) && /"role":"user","content":"/.test(l)) { start = i; break; }
    if (/"type":"user_message"|"role":"user","content":\[\{"type":"input_text"/.test(l)) { start = i; break; }
  }
  const files = new Set();
  const add = (f) => {
    f = String(f || "").trim();
    if (!f) return;
    if (cwd && isAbsolute(f)) { const r = relative(cwd, f); if (r && !r.startsWith("..")) f = r; }
    files.add(f.replaceAll("\\", "/"));
  };
  for (const l of lines.slice(start)) {
    let row;
    try { row = JSON.parse(l); } catch { continue; }
    const content = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const c of content) {
      if (c && c.type === "tool_use" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name || "") && c.input) add(c.input.file_path || c.input.notebook_path || c.input.path);
    }
    const payload = row && row.payload;
    const patch = payload && (payload.type === "function_call" || payload.type === "custom_tool_call") ? String(payload.arguments || payload.input || "") : "";
    for (const m of patch.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n"\\]+)/g)) add(m[1]);
  }
  return [...files].slice(0, 12);
}

const RULES = [
  ["todo", /\b(TODO|follow[- ]?up|next step)\b|할 ?일|다음에|남은 |아직 안|해야 (해요|합니다|함)/i],
  ["decision", /\b(decided|chose|instead of|we'll use|going with)\b|결정|하기로|대신 |선택했|으로 갑니다|으로 가요/i],
  ["fact", /\b(root cause|turns out|found that|because)\b|원인|알고 보니|확인했|발견|때문에|이유는/i],
];
// Rule-based distill: a few one-sentence notes, never the transcript.
export function ruleNotes(answer) {
  const text = String(answer || "").replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/[*_#>|]/g, " ");
  const sentences = text.split(/\n+|(?<=[.!?。])\s+|(?<=[요다죠])\.?\s+(?=[가-힣A-Z])/).map((s) => s.replace(/^\s*[-•\d.)]+\s*/, "").replace(/\s+/g, " ").trim()).filter((s) => s.length >= 8);
  const out = [];
  for (const s of sentences) {
    const hit = RULES.find(([, re]) => re.test(s));
    if (hit && out.filter((o) => o.kind === hit[0]).length < 2) out.push({ kind: hit[0], text: clip(s, 200) });
    if (out.length >= 4) break;
  }
  if (!out.length && sentences.length) out.push({ kind: "summary", text: clip(sentences[0], 200) });
  return out;
}

const MEMO_PROMPT = "Turn this coding-agent turn into 1-4 short notes for a project memo, in the user's language. Each note is one sentence of kind decision, fact (something learned), todo (open work) or summary. Skip chit-chat; never include secrets, tokens, or code. Reply with JSON only: {\"items\":[{\"kind\":\"decision\",\"text\":\"...\"}]}";
// Optional: the user's own model distills the turn (ACARD_MEMO_MODEL + an Anthropic-compatible key on this machine).
async function modelNotes(prompt, answer) {
  const key = process.env.ACARD_MEMO_API_KEY || process.env.ANTHROPIC_API_KEY;
  const model = process.env.ACARD_MEMO_MODEL;
  if (!key || !model || process.env.ACARD_MEMO_MODEL === "off") return null;
  const base = String(process.env.ACARD_MEMO_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await fetch(base + "/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 400, system: MEMO_PROMPT, messages: [{ role: "user", content: "Question:\n" + redact(prompt) + "\n\nAnswer:\n" + redact(answer) }] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const text = data && Array.isArray(data.content) ? data.content.map((c) => c.text || "").join("") : "";
  const json = /\{[\s\S]*\}/.exec(text);
  const items = json ? (JSON.parse(json[0]).items || []) : [];
  const kinds = ["decision", "fact", "todo", "summary"];
  const out = items.filter((i) => i && kinds.includes(i.kind) && String(i.text || "").trim()).slice(0, 4).map((i) => ({ kind: i.kind, text: clip(redact(i.text), 200) }));
  return out.length ? out : null;
}

async function post(cfg, path, body) {
  const res = await fetch(cfg.server + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("HTTP " + res.status + " " + (data.error || "")), { status: res.status });
  return data;
}

export async function runHook(client, input) {
  const file = readJson(CONFIG, {});
  const cfg = { token: process.env.ACARD_TOKEN || file.token || "", server: String(process.env.ACARD_URL || file.server || "https://notes.example.com").replace(/\/+$/, "") };
  const key = client + ":" + String(input.session_id || "default");
  const promptFile = join(HOME, "prompts", key.replace(/[^A-Za-z0-9_-]/g, "_") + ".txt");
  const update = (change) => {
    const state = readJson(STATE, { sessions: {} });
    const cutoff = Date.now() - 14 * 864e5;
    for (const [k, v] of Object.entries(state.sessions)) if ((v.at || 0) < cutoff) delete state.sessions[k];
    state.sessions[key] = { ...state.sessions[key], ...change, at: Date.now() };
    mkdirSync(HOME, { recursive: true });
    writeFileSync(STATE, JSON.stringify(state));
  };
  if (input.hook_event_name === "PreToolUse") {
    const tool = String(input.tool_name || "").replace(/^mcp__[^_]*acard[^_]*__/i, "");
    if (!/^mcp__/.test(String(input.tool_name || "")) || !/acard/i.test(String(input.tool_name)) || !cfg.token) return "ignored";
    let mod;
    try { mod = await import(new URL("./local-images.mjs", import.meta.url)); } catch { mod = await import(new URL("./local-images.js", import.meta.url)); }
    const local = await mod.rewriteLocalImages(cfg, tool, input.tool_input, input.cwd || process.cwd(), String(input.transcript_path || ""));
    if (local.args === input.tool_input) return "ignored";
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: local.args } }) + "\n");
    return "images";
  }
  if (input.hook_event_name === "UserPromptSubmit") {
    mkdirSync(join(HOME, "prompts"), { recursive: true });
    writeFileSync(promptFile, clip(input.prompt, PART));
    return "prompt";
  }
  if (input.hook_event_name !== "Stop") return "ignored";
  const answer = clip(input.last_assistant_message, PART);
  let prompt = "";
  try { prompt = readFileSync(promptFile, "utf8"); rmSync(promptFile, { force: true }); } catch {}
  if (!answer && !prompt) return "empty";
  const entry = readJson(STATE, { sessions: {} }).sessions[key] || {};
  if (!cfg.token) { log("skip: ACARD_TOKEN 이 없어요 (acard hooks install 을 토큰과 함께 다시 실행하세요)"); return "no-token"; }
  const label = client === "codex" ? "Codex" : "Claude Code";
  const project = entry.project || detectProject(String(input.cwd || ""));
  if (project && !entry.project) update({ project });

  let memo = null;
  if (project) {
    const items = (await modelNotes(prompt, answer).catch(() => null)) || ruleNotes(answer);
    const files = turnFiles(input.transcript_path, String(input.cwd || ""));
    try {
      memo = await post(cfg, "/api/v1/memo", { project, client: label, items: items.map((i) => ({ kind: i.kind, text: redact(i.text) })), files });
    } catch (error) {
      if (error.status !== 404) log("memo error " + client + ": " + error.message);
    }
  }
  if (memo && (memo.muted || !memo.enabled || memo.scope === "memo")) return memo.added ? "memo" : "skipped";

  if (!entry.session) {
    const started = await post(cfg, "/api/v1/journal/start", {
      title: clip(redact(prompt) || label + " 대화", 80),
      goal: label + " 대화 자동 기록" + (project ? " (" + project + ")" : ""),
      ...(project ? { project } : {}),
    });
    entry.session = started.session;
    update({ session: entry.session });
  }
  const text = (prompt ? "질문: " + redact(prompt) + "\n" : "") + "답: " + (redact(answer) || "(내용 없음)");
  try {
    await post(cfg, "/api/v1/journal/log", { session: entry.session, kind: "step", text, data: { source: client + "-hook" } });
  } catch (error) {
    if (error.status === 404 || error.status === 409) update({ session: undefined });
    throw error;
  }
  return "logged";
}

export async function hookMain(client) {
  let wrote = false;
  try {
    const input = await stdinJson();
    const result = await runHook(client === "codex" ? "codex" : "claude", input);
    wrote = result === "images";
    if (result === "logged" || result === "memo") log("ok " + result + " " + client + " " + String(input.session_id || ""));
  } catch (error) {
    log("error " + client + ": " + String(error && error.message || error));
  }
  if (client === "codex" && !wrote) process.stdout.write("{}\n");
  return 0;
}

async function stdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim() ? JSON.parse(raw) : {};
}

if (process.argv[1] && /hook\.m?js$/.test(process.argv[1]) && process.argv[2]) {
  hookMain(process.argv[2]).then((code) => { process.exitCode = code; });
}
