<p align="center"><a href="why-acard.md">English</a> · <b>한국어</b> · <a href="why-acard.zh-CN.md">简体中文</a></p>

# 왜 Acard 인가

Acard 는 로컬로 돌릴 수 있는 오픈 노션입니다. 이 문서는 흔히 함께 비교되는 Notion, Obsidian 과 나란히 놓고 그 뜻을
설명합니다. 둘 다 훌륭한 도구이고 많은 사람에게 잘 맞습니다. Acard 는 다른 선택지이며, 아래 표가 어디가 다른지 보여
줍니다.

Acard 에 대한 주장은 모두 이 레포에서 그것을 구현한 파일을 가리킵니다. Notion·Obsidian 에 대한 내용은 2026년 10월 기준
각 공식 도움말(맨 아래 링크)에서 가져왔고, 바뀔 수 있습니다.

## 한눈에 보기

| | Acard | Notion | Obsidian |
| --- | --- | --- | --- |
| 데이터 위치 | 내가 고른 폴더의 SQLite 파일 | Notion 클라우드, 앱에 오프라인 사본 | 로컬 볼트의 마크다운 파일 |
| 팀용 셀프호스트 | 됨: LAN·VPN 에 Bun 프로세스 하나 | 안 됨 | 기본 기능 없음, 공유 볼트는 Obsidian Sync |
| 편집 방식 | 블록, 열, 데이터베이스 | 블록, 열, 데이터베이스 | 마크다운 텍스트, 플러그인 |
| 데이터베이스 | 보기 7종, 관계, 롤업, 하위 항목, 수식, 행 템플릿 | 다양한 보기, 관계, 롤업, 수식 | Bases: 노트 속성 위의 데이터베이스 보기 |
| 오프라인 | 항상: 서버가 내 기기에서 돎 | 데스크톱·모바일 앱에 내려받은 페이지 | 항상 |
| 에이전트·스크립트 | 내 서버의 MCP 엔드포인트와 REST API | Notion 클라우드의 API·호스팅 MCP | 커뮤니티 플러그인, 또는 파일 직접 수정 |
| 백업 형식 | zip 하나: 모든 표, 모든 파일, 페이지별 마크다운 | 마크다운/CSV, HTML, PDF 내보내기 | 볼트 폴더 그 자체 |
| 소스 | MIT | 비공개 | 앱 비공개, 플러그인 API 공개 |

## Notion 과 비교하면

**문서가 내 장비에 머뭅니다.** Acard 서버는 모든 내용을 `ACARD_DATA_DIR` 로 정한 폴더의 `acard.sqlite` 와
`media.sqlite` 에 씁니다(`local/server.ts`). 만들 계정도, 중간에 끼는 외부 서비스도 없습니다. Notion 은 작업 공간을
자기 클라우드에 두고, 앱에서 고른 페이지만 오프라인용으로 내려받습니다.

**팀 서버로 직접 돌릴 수 있습니다.** `ACARD_HOST=0.0.0.0` 과 `ACARD_PASSWORD` 만 더하면 같은 프로세스가 비밀번호
로그인과 DNS 리바인딩을 막는 호스트 허용 목록을 갖춘 LAN 서버가 됩니다(`local/main.ts`, `local/server.ts`).
[서버 설치 안내](install-server.md)가 Windows·Linux 서비스로 등록하는 법까지 다룹니다. Notion 에는 셀프호스트판이
없습니다.

**익숙한 편집, 열린 코드.** 페이지는 블록이고, `/` 명령·열·토글·콜아웃과 표·보드·갤러리·목록·캘린더·타임라인·차트
보기를 갖춘 데이터베이스를 씁니다(`db-model.js`, `editor-next/`). 모든 코드를 MIT 라이선스로 읽고 고칠 수 있습니다.

**Notion 페이지를 그대로 가져옵니다.** `notion-import.ts` 가 Notion 의 "Markdown & CSV" 내보내기 zip 을 페이지와
데이터베이스까지 읽습니다. `notion-export.ts` 는 마크다운, 단독 HTML, 작업 공간 zip 으로 다시 내보냅니다.

**에이전트가 남의 서버가 아닌 내 서버에서 일합니다.** 로컬 서버는 `/mcp` 에 MCP 를, 그리고 REST API 를 엽니다
(`agents/mcp-tools.ts`, `agent-api.js`). 내 컴퓨터의 에이전트가 클라우드를 거치지 않고 페이지를 마크다운으로 읽고 씁니다.

Notion 이 앞서는 점: 여러 사람의 실시간 동시 편집(커서 표시), 방대한 템플릿·연동 생태계, 완성도 높은 모바일 앱, 훨씬
많은 데이터베이스 기능. 관리형 서비스를 원한다면 Notion(또는 [호스팅판 Acard](https://acard.dev))이 더 쉽습니다.

## Obsidian 과 비교하면

**데이터베이스와 블록이 기본입니다.** Acard 는 페이지를 순서 있는 블록으로, 데이터베이스를 타입이 있는 속성·보기·관계·
하위 항목·수식을 갖춘 진짜 표로 저장합니다(`gate/_worker.js` 스키마, `db-formula.js`). Obsidian 은 마크다운 텍스트가
중심이고, Bases 플러그인이 노트 속성 위에 데이터베이스 형태의 보기를 더합니다.

**서버 하나, 기기 여러 대, 동기화 서비스 없이.** 모든 브라우저·휴대폰·데스크톱 앱이 같은 서버와 이야기하고, 무언가
바뀌면 라이브 피드(`/api/live`, `gate/live.ts`)가 열린 페이지를 새로 고칩니다. 팀은 주소 하나를 나누면 작업 공간 하나를
함께 씁니다. Obsidian 은 기기마다 볼트를 두고, 여러 사람이 볼트를 함께 쓰려면 Obsidian Sync 를 씁니다.

**사람과 에이전트가 함께 쓰도록.** 에이전트는 MCP·REST 로 마크다운을 쓰고, 사람은 같은 내용을 깔끔한 페이지로 읽고
블록으로 고칩니다(`markdown-blocks.ts` 가 마크다운을 블록으로 바꾸는 유일한 규칙). 페이지는 게시하거나 링크로 읽기 전용
공유할 수 있습니다(`features/share.js`).

**읽을 수 있는 백업.** 백업 zip(`gate/archive.ts`)에는 모든 표가 JSON 으로, 모든 파일과 페이지별 마크다운 사본이 들어
있어 Acard 없이도 노트를 읽을 수 있습니다. `local/auto-backup.ts` 가 매일 하나씩 만들고 최신본을 남깁니다.
`packages/acard-cli` 로 페이지를 `.md` 파일 폴더로 내려받을 수도 있습니다.

Obsidian 이 앞서는 점: 노트가 곧 일반 파일이라 어떤 편집기·Git·파일 동기화든 바로 쓸 수 있습니다. 방대한 플러그인·테마
생태계, 그래프 보기, 성숙한 모바일 앱, 종단간 암호화 Sync 가 있습니다. 개인 마크다운 볼트가 목적이라면 Obsidian 이
아주 잘 맞습니다.

## 이럴 때 Acard 가 맞습니다

- 노션 같은 페이지와 데이터베이스를 쓰고 싶지만, 문서는 내 기기나 사내망에만 있어야 할 때.
- 작은 팀이 사람마다 클라우드 계정을 만들지 않고 사무실 서버 하나로 작업 공간을 함께 쓰고 싶을 때.
- AI 에이전트가 MCP 로 내 노트를 로컬에서 읽고 쓰게 하고 싶을 때.
- 코드를 직접 읽고, 감사하고, 고치고 싶을 때.

## 출처

- Notion 오프라인: https://www.notion.com/help/use-pages-offline
- Notion 내보내기: https://www.notion.com/help/export-your-content
- Obsidian Bases: https://obsidian.md/help/bases
- Obsidian 공유 볼트: https://obsidian.md/help/sync/collaborate
- Obsidian 라이선스: https://obsidian.md/license
