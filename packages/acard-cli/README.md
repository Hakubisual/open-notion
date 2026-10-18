# acard-cli

Acard 노트를 로컬 마크다운 파일로 동기화하고, 원격 MCP 엔드포인트를 로컬 stdio MCP 서버로 연결해 주는 CLI입니다. Node 18+ 와 Bun 에서 모두 동작합니다.

## 설정

Acard **설정 > 에이전트 연결** 에서 토큰을 만든 뒤 환경변수로 지정합니다. 토큰은 출력되지 않습니다.

```bash
export ACARD_TOKEN=...                      # 필수
export ACARD_URL=https://notes.example.com   # 선택 (기본값), 또는 --server <url>
```

## 명령

```bash
npx acard-cli whoami          # {agent, via, scopes} 출력
npx acard-cli pull [dir]      # 노트(kind "note")를 <dir>/<slug>.md 로 저장 (기본 ./acard)
npx acard-cli push [dir]      # 로컬 변경을 원격에 반영
npx acard-cli mcp             # stdio MCP 서버 ({server}/mcp 프록시)
```

`bunx acard-cli ...` 도 같습니다. 레포 안에서는 `node packages/acard-cli/bin/acard.js <command>` 로 실행할 수 있습니다.

### pull / push 동작

- 동기화 상태는 `<dir>/.acard-sync.json` 에 `slug -> {updated, hash}` 로 기록됩니다.
- `pull` 은 마지막 pull 이후 로컬에서 수정한 파일은 덮어쓰지 않고 `skipped` 로 알립니다.
- `push` 는 파일별로 `created` / `updated` / `unchanged` / `conflict` / `error` 를 출력합니다.
  - 내용 해시가 바뀐 파일만 전송합니다 (`PUT /api/v1/pages/{slug}`).
  - 원격 `updated` 가 마지막 pull 보다 새로우면 **conflict** 로 건너뜁니다. 원격 편집을 조용히 덮어쓰지 않습니다.
  - 상태에 없는 새 `.md` 파일은 `POST /api/v1/pages` 로 생성하고, 서버가 정한 `<slug>.md` 로 이름을 바꿉니다. 제목/부모/아이콘/태그는 frontmatter 로 지정합니다.
  - conflict 나 error 가 하나라도 있으면 종료 코드가 0 이 아닙니다.

새 페이지 예시:

```markdown
---
title: 회의록
parent: hello
tags: [meeting]
---

본문
```

### MCP 클라이언트 등록 예시

```json
{
  "mcpServers": {
    "acard": {
      "command": "npx",
      "args": ["-y", "acard-cli", "mcp"],
      "env": { "ACARD_TOKEN": "..." }
    }
  }
}
```

## 테스트

```bash
cd packages/acard-cli
bun install
bun test
```

테스트는 `Bun.serve` 로 가짜 API/MCP 서버를 띄우고 CLI 를 실제 Node 서브프로세스로 실행합니다.
