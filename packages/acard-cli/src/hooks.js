import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OURS = /^node "[^"]*[\\/]hook\.mjs" (claude|codex)$/;
const EVENTS = ["UserPromptSubmit", "Stop", "PreToolUse"];

const acardHome = (env) => env.ACARD_HOME || join(homedir(), ".acard");
const slash = (p) => p.replaceAll("\\", "/");
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8") || "{}") : {});
const writeJson = (file, data) => { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, JSON.stringify(data, null, 2) + "\n"); };

function targets(env, only) {
  const all = [
    { id: "claude", name: "Claude Code", file: join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json") },
    { id: "codex", name: "Codex", file: join(env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json") },
  ];
  return only ? all.filter((t) => t.id === only) : all;
}

const isOurs = (group) => (group.hooks || []).some((h) => OURS.test(String(h.command || "")));

function withoutOurs(config) {
  const hooks = config.hooks || {};
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const kept = hooks[event].filter((g) => !isOurs(g));
    removed += hooks[event].length - kept.length;
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (config.hooks && !Object.keys(hooks).length) delete config.hooks;
  return removed;
}

export function installHooks({ env = process.env, only, server, out }) {
  const home = acardHome(env);
  const script = join(home, "hook.mjs");
  mkdirSync(home, { recursive: true });
  copyFileSync(new URL("./hook.js", import.meta.url), script);
  copyFileSync(new URL("./local-images.js", import.meta.url), join(home, "local-images.mjs"));
  const token = env.ACARD_TOKEN || "";
  if (token) {
    writeFileSync(join(home, "config.json"), JSON.stringify({ token, server }) + "\n", { mode: 0o600 });
  } else if (!existsSync(join(home, "config.json"))) {
    out("주의: ACARD_TOKEN 이 없어서 기록이 보내지지 않아요. 토큰을 넣고 다시 설치하세요.");
  }
  for (const t of targets(env, only)) {
    const config = readJson(t.file);
    withoutOurs(config);
    config.hooks = config.hooks || {};
    for (const event of EVENTS) {
      const command = `node "${slash(script)}" ${t.id}`;
      const hook = event === "Stop" ? { type: "command", command, ...(t.id === "codex" ? {} : { async: true }), timeout: 30 } : { type: "command", command, timeout: event === "PreToolUse" ? 60 : 10 };
      (config.hooks[event] = config.hooks[event] || []).push(event === "PreToolUse" ? { matcher: "mcp__.*acard.*", hooks: [hook] } : { hooks: [hook] });
    }
    writeJson(t.file, config);
    out(`${t.name}: 훅을 설치했어요 (${t.file})`);
  }
  out("이제 대화가 끝날 때마다 질문과 답이 Acard 작업 기록에 남아요. 되돌리려면: acard hooks uninstall");
  if (!only || only === "codex") out("Codex 는 처음 한 번 /hooks 에서 새 훅을 신뢰(trust)해야 실행돼요.");
  return 0;
}

export function uninstallHooks({ env = process.env, only, out }) {
  for (const t of targets(env, only)) {
    if (!existsSync(t.file)) continue;
    const config = readJson(t.file);
    const removed = withoutOurs(config);
    if (removed) writeJson(t.file, config);
    out(`${t.name}: ${removed ? "훅을 지웠어요" : "설치된 훅이 없어요"} (${t.file})`);
  }
  if (!only) {
    const home = acardHome(env);
    for (const name of ["hook.mjs", "local-images.mjs", "config.json", "hook-state.json", "prompts"]) rmSync(join(home, name), { force: true, recursive: true });
  }
  out("자동 기록을 껐어요.");
  return 0;
}

export function hooksStatus({ env = process.env, out }) {
  for (const t of targets(env)) {
    const on = existsSync(t.file) && Object.values(readJson(t.file).hooks || {}).some((groups) => groups.some(isOurs));
    out(`${t.name}: ${on ? "켜짐" : "꺼짐"}`);
  }
  return 0;
}
