// Block operations share the authenticated agent runner across MCP and REST.
(() => {
  function pageSlug(helpers, input) {
    if (typeof input.page !== "string" || !input.page.trim()) throw new AgentError("페이지 슬러그가 필요해요.");
    return helpers.resolveSlug(input.page);
  }

  async function foundPage(db, helpers, input) {
    const slug = pageSlug(helpers, input);
    const found = await helpers.readPage(db, slug);
    if (!found) throw new AgentError("없는 페이지예요.", 404);
    return { slug, ...found };
  }

  function blockResult(found, helpers) {
    return { page: found.slug, version: found.page.updated, updated: found.page.updated,
      blocks: found.blocks.map(block => ({ id: block.id, type: block.type, text: block.text,
        markdown: helpers.blocksToMarkdown([block]) })) };
  }

  function parsedBlocks(helpers, markdown) {
    if (typeof markdown !== "string") throw new AgentError("마크다운 본문이 필요해요.");
    if (markdown.length > 400_000) throw new AgentError("본문이 너무 길어요.", 413);
    const parsed = helpers.markdownToBlocks(markdown);
    if (!parsed.length) throw new AgentError("블록 내용이 비었어요. 삭제는 delete_block을 쓰세요.");
    if (parsed.length > 2000) throw new AgentError("페이지에는 블록을 2000개까지 넣을 수 있어요.", 413);
    // normaliseBlocks refuses an over-long block (64 KB for HTML/visual/chart/diagram, 100,000 characters otherwise).
    return helpers.normaliseBlocks(parsed);
  }

  async function edit(db, principal, helpers, input, action) {
    if (typeof input.expected_version !== "number" || !Number.isSafeInteger(input.expected_version) || input.expected_version < 0) {
      throw new AgentError("read_blocks의 version을 expected_version 숫자로 보내 주세요.");
    }
    const found = await foundPage(db, helpers, input);
    await folderGuard(db, found.slug);
    if (found.page.updated !== input.expected_version) throw new AgentError("그사이 페이지가 바뀌었어요. 다시 읽고 합친 뒤 쓰세요.", 409);
    const blocks = found.blocks.slice();
    const anchor = action === "insert" ? input.after_block_id : input.block_id;
    if (!(action === "insert" && anchor === null) && (typeof anchor !== "string" || !anchor)) throw new AgentError("블록 ID가 필요해요.");
    const index = anchor === null ? -1 : blocks.findIndex(block => block.id === anchor);
    if (anchor !== null && index < 0) throw new AgentError("없는 블록이에요.", 404);
    let affected, imageWarnings = [];
    if (action === "delete") {
      affected = [blocks[index].id];
      blocks.splice(index, 1);
    } else {
      const added = parsedBlocks(helpers, input.markdown);
      if (helpers.ingestImages) imageWarnings = await helpers.ingestImages(db, found.slug, added);
      if (action === "update") {
        if (added.length !== 1) throw new AgentError("update_block에는 블록 하나만 보내 주세요. 여러 블록은 insert_blocks를 쓰세요.");
        added[0].id = blocks[index].id;
        added[0].indent = blocks[index].indent;
        blocks.splice(index, 1, added[0]);
      } else {
        if (blocks.length + added.length > 2000) throw new AgentError("페이지에는 블록을 2000개까지 넣을 수 있어요.", 413);
        for (const block of added) block.id = "a" + crypto.randomUUID();
        blocks.splice(index + 1, 0, ...added);
      }
      affected = added.map(block => block.id);
    }
    // #36: an update or delete aimed at a paragraph a person edited becomes a suggestion under it instead.
    const guard = humanGuard(found.blocks, blocks, principal.name);
    blocks.splice(0, blocks.length, ...guard.blocks);
    // Compare in SQL, not only against the earlier read. Even same-millisecond
    // writes advance the stamp so only one caller can claim a read version.
    const version = Math.max(Date.now(), found.page.updated + 1);
    const claimed = await db.prepare("UPDATE pages SET updated = ? WHERE slug = ? AND updated = ?")
      .bind(version, found.slug, input.expected_version).run();
    if (Number(claimed?.meta?.changes ?? 0) === 0) throw new AgentError("그사이 페이지가 바뀌었어요. 다시 읽고 합친 뒤 쓰세요.", 409);
    await helpers.captureEditorVersion(db, found.slug);
    await db.prepare("UPDATE pages SET source = 'editor', hash = NULL WHERE slug = ?").bind(found.slug).run();
    // Existing blocks bypass normalization: preserve opaque editor metadata.
    await helpers.saveBlocks(db, found.slug, blocks);
    await db.prepare("INSERT INTO agent_activity (id, page, agent, via, action, created) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), found.slug, principal.name, principal.via, "block-" + action, version).run();
    const written = action === "delete" ? [] : blocks.filter(block => affected.includes(block.id));
    return withWarnings(humanNote({ page: found.slug, version, updated: version, block_ids: affected }, guard), imageWarnings, written);
  }

  registerFeature({
    services: { mcpTools: [
      { name: "read_blocks", description: "Read ordered blocks with stable IDs and a page version. Read before editing.", scope: "read", operation: "readBlocks",
        inputSchema: z => ({ page: z.string() }) },
      { name: "update_block", description: "Replace exactly one block from markdown, keeping its ID and indentation. Other blocks stay unchanged. Requires version from read_blocks.", scope: "write", operation: "updateBlock",
        inputSchema: z => ({ page: z.string(), block_id: z.string(), markdown: z.string(), expected_version: z.number().int().nonnegative() }) },
      { name: "insert_blocks", description: "Insert markdown immediately after a block ID, or at the start when after_block_id is null. Requires version from read_blocks.", scope: "write", operation: "insertBlocks",
        inputSchema: z => ({ page: z.string(), after_block_id: z.string().nullable(), markdown: z.string(), expected_version: z.number().int().nonnegative() }) },
      { name: "delete_block", description: "Delete only the named block, not its descendants. Requires version from read_blocks.", scope: "write", operation: "deleteBlock",
        inputSchema: z => ({ page: z.string(), block_id: z.string(), expected_version: z.number().int().nonnegative() }) },
    ] },
    agentOps: {
      readBlocks: async (db, principal, helpers, input) => blockResult(await foundPage(db, helpers, input), helpers),
      updateBlock: (db, principal, helpers, input) => edit(db, principal, helpers, input, "update"),
      insertBlocks: (db, principal, helpers, input) => edit(db, principal, helpers, input, "insert"),
      deleteBlock: (db, principal, helpers, input) => edit(db, principal, helpers, input, "delete"),
    },
    agentApi: async ({ path, method, request, helpers, run }) => {
      const match = /^\/api\/v1\/pages\/([^/]+)\/blocks(?:\/([^/]+))?$/.exec(path);
      if (!match) return null;
      let page, block_id;
      try { page = decodeURIComponent(match[1]); block_id = match[2] ? decodeURIComponent(match[2]) : undefined; }
      catch { throw new AgentError("주소를 읽지 못했어요."); }
      if (!block_id && method === "GET") return helpers.json(await run("readBlocks", { page }));
      const operation = !block_id && method === "POST" ? "insertBlocks"
        : block_id && (method === "PATCH" || method === "PUT") ? "updateBlock"
        : block_id && method === "DELETE" ? "deleteBlock" : null;
      if (!operation) return helpers.json({ error: "지원하지 않는 방법이에요." }, 405);
      const text = await request.text();
      if (text.length > 410_000) throw new AgentError("본문이 너무 길어요.", 413);
      let input;
      try { input = JSON.parse(text); } catch { throw new AgentError("JSON 본문을 읽지 못했어요."); }
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new AgentError("JSON 객체가 필요해요.");
      return helpers.json(await run(operation, { ...input, page, block_id }));
    },
  });
})();
