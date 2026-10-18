import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BIN, makeTempDir, removeDir } from "./run.js";

let dir, api, calls;

let memoReply = { ok: true, added: 1, enabled: true, scope: "memo+journal", muted: false };
function startJournal(status = 200) {
  calls = [];
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      calls.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body });
      if (status !== 200) return Response.json({ error: "down" }, { status });
      if (req.url.endsWith("/memo")) return Response.json(memoReply);
      if (req.url.endsWith("/start")) return Response.json({ session: "j1", page: "aj-j1" }, { status: 201 });
      return Response.json({ ok: true, seq: calls.length });
    },
  });
}

function env(extra = {}) {
  const e = { ...process.env, ACARD_HOME: join(dir, "acard-custom"), CLAUDE_CONFIG_DIR: join(dir, "claude"), CODEX_HOME: join(dir, "codex"), ...extra };
  delete e.ACARD_URL;
  if (!("ACARD_TOKEN" in extra)) delete e.ACARD_TOKEN;
  return e;
}

async function run(args, e, stdin) {
  const proc = Bun.spawn(["node", ...args], { env: e, stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

const hookCommand = (file, event) => JSON.parse(readFileSync(file, "utf8")).hooks[event].at(-1).hooks[0].command;
const runHook = (command, e, input) => {
  const [, script, client] = command.match(/^node "(.+)" (\w+)$/);
  return run([script, client], e, JSON.stringify(input));
};

beforeEach(async () => { dir = await makeTempDir(); memoReply = { ok: true, added: 1, enabled: true, scope: "memo+journal", muted: false }; });
afterEach(async () => { api?.stop(true); api = undefined; await removeDir(dir); });

test("install keeps other hooks, a turn posts start + one log, uninstall restores the settings", async () => {
  api = startJournal();
  const settings = join(dir, "claude", "settings.json");
  mkdirSync(join(dir, "claude"), { recursive: true });
  const mine = { model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } };
  writeFileSync(settings, JSON.stringify(mine));
  const e = env({ ACARD_TOKEN: "tok-secret-1" });

  const installed = await run([BIN, "--server", `http://localhost:${api.port}`, "hooks", "install"], e);
  expect(installed.code).toBe(0);
  expect(installed.stdout).not.toContain("tok-secret-1");
  const after = JSON.parse(readFileSync(settings, "utf8"));
  expect(after.model).toBe("opus");
  expect(after.hooks.Stop).toHaveLength(2);
  expect(JSON.parse(readFileSync(join(dir, "codex", "hooks.json"), "utf8")).hooks.UserPromptSubmit).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(dir, "codex", "hooks.json"), "utf8")).hooks.Stop[0].hooks[0].async).toBeUndefined();
  expect(after.hooks.Stop.at(-1).hooks[0].async).toBe(true);

  const hookEnv = env();
  await runHook(hookCommand(settings, "UserPromptSubmit"), hookEnv, { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "1+1은?", cwd: "/w/demo" });
  expect(calls).toHaveLength(0);
  const stop = await runHook(hookCommand(settings, "Stop"), hookEnv, { hook_event_name: "Stop", session_id: "s1", cwd: "/w/demo", last_assistant_message: "2예요." });
  expect(stop.code).toBe(0);
  await runHook(hookCommand(settings, "Stop"), hookEnv, { hook_event_name: "Stop", session_id: "s1", last_assistant_message: "또 2예요." });
  expect(calls.map((c) => c.path)).toEqual(["/api/v1/memo", "/api/v1/journal/start", "/api/v1/journal/log", "/api/v1/memo", "/api/v1/journal/log"]);
  expect(calls[0].auth).toBe("Bearer tok-secret-1");
  expect(calls[0].body.project).toBe("demo");
  expect(calls[1].body.project).toBe("demo");
  expect(calls[2].body).toMatchObject({ session: "j1", text: "질문: 1+1은?\n답: 2예요." });

  const codexStop = await runHook(hookCommand(join(dir, "codex", "hooks.json"), "Stop"), hookEnv, { hook_event_name: "Stop", session_id: "c1", last_assistant_message: "x" });
  expect(JSON.parse(codexStop.stdout)).toEqual({});

  expect((await run([BIN, "hooks", "uninstall"], e)).code).toBe(0);
  expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual(mine);
  expect(existsSync(join(dir, "acard-custom", "config.json"))).toBe(false);
  expect((await run([BIN, "hooks", "status"], e)).stdout).toContain("Claude Code: 꺼짐");
});

test("a failing server never breaks the agent: exit 0, no output, token kept out of the log", async () => {
  api = startJournal(500);
  const e = env({ ACARD_TOKEN: "tok-secret-2" });
  await run([BIN, "--server", `http://localhost:${api.port}`, "hooks", "install", "claude"], e);
  const settings = join(dir, "claude", "settings.json");
  const res = await runHook(hookCommand(settings, "Stop"), env(), { hook_event_name: "Stop", session_id: "s2", last_assistant_message: "hi" });
  expect(res).toEqual({ stdout: "", stderr: "", code: 0 });
  const log = readFileSync(join(dir, "acard-custom", "hook.log"), "utf8");
  expect(log).toContain("HTTP 500");
  expect(log).not.toContain("tok-secret-2");
  api.stop(true);
  api = undefined;
  const down = await runHook(hookCommand(settings, "Stop"), env(), { hook_event_name: "Stop", session_id: "s2", last_assistant_message: "hi" });
  expect(down.code).toBe(0);
});

test("memo only / muted: a turn sends one distilled, redacted memo and no journal", async () => {
  api = startJournal();
  memoReply = { ok: true, added: 2, enabled: true, scope: "memo", muted: false };
  const e = env({ ACARD_TOKEN: "tok-3", ACARD_PROJECT: "acard" });
  await run([BIN, "--server", `http://localhost:${api.port}`, "hooks", "install", "claude"], e);
  const settings = join(dir, "claude", "settings.json");
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, [
    JSON.stringify({ type: "user", message: { role: "user", content: "고쳐 줘" } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: join(dir, "src", "a.ts") } }] } }),
  ].join("\n"));
  const answer = "원인은 캐시 키였어요. 토큰 대신 쿠키를 쓰기로 결정했어요. 남은 일은 테스트 추가예요. password=hunter2secret";
  await runHook(hookCommand(settings, "Stop"), env({ ACARD_PROJECT: "acard" }), { hook_event_name: "Stop", session_id: "m1", cwd: dir, transcript_path: transcript, last_assistant_message: answer });
  expect(calls.map((c) => c.path)).toEqual(["/api/v1/memo"]);
  const body = calls[0].body;
  expect(body.project).toBe("acard");
  expect(body.files).toEqual(["src/a.ts"]);
  expect(body.items.map((i) => i.kind).sort()).toEqual(["decision", "fact", "todo"]);
  expect(JSON.stringify(body)).not.toContain("hunter2secret");
  memoReply = { ok: true, added: 0, enabled: true, scope: "memo+journal", muted: true, skipped: "muted" };
  await runHook(hookCommand(settings, "Stop"), env({ ACARD_PROJECT: "acard" }), { hook_event_name: "Stop", session_id: "m1", last_assistant_message: "다른 답이에요 길게 써요." });
  expect(calls.map((c) => c.path)).toEqual(["/api/v1/memo", "/api/v1/memo"]);
});
