import { readFileSync } from "node:fs";
import { ApiError, makeConfig, request } from "./api.js";
import { pull, push } from "./sync.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const USAGE = `acard ${VERSION}

Usage:
  acard pull [dir]     원격 노트를 <dir>/<slug>.md 로 내려받기 (기본 ./acard)
  acard push [dir]     로컬 변경을 원격에 반영 (충돌 시 건너뜀)
  acard mcp            원격 {server}/mcp 를 stdio MCP 서버로 프록시
  acard whoami         현재 토큰 정보 출력
  acard hooks install [claude|codex]    대화가 끝날 때마다 Acard 작업 기록에 자동 저장
  acard hooks uninstall [claude|codex]  자동 기록 훅 지우기
  acard hooks status   훅 설치 상태

Options:
  --server <url>       서버 주소 (기본: $ACARD_URL 또는 https://notes.example.com)

Env:
  ACARD_TOKEN          에이전트 토큰 (Authorization: Bearer)
  ACARD_URL            서버 주소
`;

function parseArgs(argv) {
  const positional = [];
  let server;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") server = argv[++i];
    else if (a.startsWith("--server=")) server = a.slice("--server=".length);
    else if (a === "-h" || a === "--help") help = true;
    else if (a === "-v" || a === "--version") positional.unshift("version");
    else positional.push(a);
  }
  return { command: positional[0], rest: positional.slice(1), server, help };
}

const out = (line) => process.stdout.write(line + "\n");
const err = (line) => process.stderr.write(line + "\n");

export async function main(argv) {
  const { command, rest, server, help } = parseArgs(argv);
  if (help || !command) {
    (command || help ? out : err)(USAGE);
    return command || help ? 0 : 1;
  }
  const cfg = makeConfig({ server });
  try {
    switch (command) {
      case "version":
        out(VERSION);
        return 0;
      case "pull":
        return await pull(cfg, rest[0] || "./acard", out);
      case "push":
        return await push(cfg, rest[0] || "./acard", out);
      case "whoami": {
        const me = await request(cfg, "GET", "/api/v1/me");
        out(JSON.stringify({ agent: me.agent, via: me.via, scopes: me.scopes }, null, 2));
        return 0;
      }
      case "hooks": {
        const { installHooks, uninstallHooks, hooksStatus } = await import("./hooks.js");
        const only = ["claude", "codex"].includes(rest[1]) ? rest[1] : undefined;
        if (rest[0] === "install") return installHooks({ only, server: cfg.server, out });
        if (rest[0] === "uninstall") return uninstallHooks({ only, out });
        if (rest[0] === "status") return hooksStatus({ out });
        err(USAGE);
        return 1;
      }
      case "hook": {
        const { hookMain } = await import("./hook.js");
        return await hookMain(rest[0]);
      }
      case "mcp": {
        const { runMcpProxy } = await import("./mcp.js");
        return await runMcpProxy(cfg, VERSION);
      }
      default:
        err(`알 수 없는 명령: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (e) {
    if (e instanceof ApiError) {
      err(`오류: HTTP ${e.status}: ${e.error}`);
      if (e.status === 401) {
        err("인증 실패: ACARD_TOKEN 이 없거나 유효하지 않습니다. Acard 설정 > 에이전트 연결 에서 토큰을 만든 뒤 ACARD_TOKEN 환경변수로 지정하세요.");
      }
      return 1;
    }
    if (e?.cause?.code === "ECONNREFUSED" || e?.name === "TypeError") {
      err(`오류: ${cfg.server} 에 연결할 수 없습니다 (${e.cause?.code || e.message})`);
      return 1;
    }
    throw e;
  }
}
