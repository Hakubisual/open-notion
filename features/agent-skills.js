// Provision on discovery, not on every schema initialization. Existing owner
// rules (including an intentionally empty or trashed page) are never replaced.
(() => {
  const seed = `# 에이전트 작성 규칙

## 먼저 읽기

작업을 시작할 때 get_agent_skills로 이 페이지를 읽으세요. 주인님이 고친 규칙을 따르세요. 페이지 슬러그는 agent-skills예요.

## 마크다운

한국어로 짧게 쓰세요. 제목은 #부터 ###까지, 목록은 - 항목, 할 일은 - [ ] 항목과 - [x] 항목을 쓰세요. 코드는 언어를 적은 코드 울타리로 감싸세요. 페이지 링크는 [[슬러그]]로 적으세요. 비밀, 토큰, 비밀번호를 노트에 넣지 마세요.

## 블록 편집

전체 페이지 교체보다 블록 편집을 우선하세요. read_blocks로 ID와 version을 읽고 update_block, insert_blocks, delete_block에 expected_version으로 보내세요. update_block은 블록 하나만 바꾸고 ID와 들여쓰기를 유지해요. 새 블록은 insert_blocks로 넣으세요. after_block_id가 null이면 맨 앞에, ID이면 해당 블록 바로 다음에 넣어요. delete_block은 지정한 블록만 지우고 자식 블록은 남겨요. 다른 블록과 주인님의 글을 보존하세요.

## 결정 요청

결정이 필요하면 다음 콜아웃에 질문 하나를 적으세요. 답을 추측하지 말고 list_decisions와 해당 페이지를 확인하세요.

예시 문법: > [!decision] 주인님 결정 필요: 어떤 방법으로 진행할까요?

## 충돌 처리

409는 읽은 뒤 페이지가 바뀌었다는 뜻이에요. read_blocks로 다시 읽고 새 내용과 내 변경을 합친 뒤 새 version으로 쓰세요. 오래된 버전을 버리거나 미래 시각을 만들어 강제로 덮어쓰지 마세요. MCP 오류의 structuredContent.status도 확인하세요.

## 시각 자료

그림이 독자에게 도움이 될 때만 넣으세요. 과정·단계·순서는 다이어그램(\`\`\`mermaid 울타리, flowchart LR, sequenceDiagram, timeline, gantt, mindmap), 비교할 숫자는 차트(\`\`\`acard-chart 울타리 안에 {"type":"bar|line|area|pie","labels":[...],"series":[{"name":"...","data":[숫자]}]}), 움직임이나 개념 설명은 시각 자료(\`\`\`acard-visual 울타리 안에 외부 주소 없는 HTML/SVG/CSS, 64KB 이하), 분위기나 물건은 이미지(upload_media 로 올린 뒤 ![캡션](/media/id))를 쓰세요. 울타리 언어 뒤에 {"caption":"한국어 캡션","alt":"한국어 대체 글"} 를 꼭 붙이세요. 단어 약 400개에 그림 하나 정도로, 장식용 그림은 넣지 마세요. 형식: research/visuals/format.md.

## HTTP API

GET /api/v1/agent-skills로 규칙을 읽어요. GET /api/v1/pages/{slug}/blocks로 블록을 읽어요. POST /api/v1/pages/{slug}/blocks는 삽입, PATCH /api/v1/pages/{slug}/blocks/{id}는 수정, DELETE /api/v1/pages/{slug}/blocks/{id}는 삭제예요. 쓰기 JSON에는 expected_version이 필요해요.
`;

  async function skills(db, principal, helpers) {
    const marker = crypto.randomUUID();
    const blocks = helpers.normaliseBlocks(helpers.markdownToBlocks(seed));
    // One transaction claims the slug and seeds only the page created here.
    // A concurrent read or an owner-created page cannot be overwritten.
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO pages (slug, title, parent, ord, kind, updated, source, hash) SELECT 'agent-skills', '에이전트 작성 규칙', NULL, COALESCE(MAX(ord), 0) + 10, 'note', ?, 'editor', ? FROM pages HAVING NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = 'agent-skills')")
        .bind(Date.now(), marker),
      ...blocks.map((block, ord) => db.prepare("INSERT INTO blocks (page, id, ord, type, text, checked, indent, meta) SELECT 'agent-skills', ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pages WHERE slug = 'agent-skills' AND hash = ?)")
        .bind(block.id, ord, block.type, block.text, block.checked ? 1 : 0, block.indent, block.meta ? JSON.stringify(block.meta) : null, marker)),
      db.prepare("UPDATE pages SET hash = NULL WHERE slug = 'agent-skills' AND hash = ?").bind(marker),
    ]);
    return agentOps.readPage(db, principal, helpers, { slug: "agent-skills" });
  }

  registerFeature({
    services: { mcpTools: [{ name: "get_agent_skills", description: "Read the owner's current agent-skills rules before writing. Seeds Korean defaults only when missing.",
      scope: "read", operation: "getAgentSkills", inputSchema: () => ({}) }] },
    agentOps: { getAgentSkills: skills },
    agentApi: async ({ path, method, helpers, run }) => {
      if (path !== "/api/v1/agent-skills") return null;
      if (method !== "GET") return helpers.json({ error: "지원하지 않는 방법이에요." }, 405);
      return helpers.json(await run("getAgentSkills", {}));
    },
  });
})();
