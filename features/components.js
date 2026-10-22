// ds10 component catalog for agents. The MCP tool description carries only the component names; the schema, defaults and
// a ready-to-paste fence come from list_components (MCP) or GET /api/v1/components[/<id>] (REST) when asked.
// set_component_data (#98) writes one component block's JSON data, checked against the component's schema, through
// humanGuard (#36) like set_part_data. Rendering still never changes stored data: defaults fill gaps only when drawn.
(() => {
  const COMPONENT_MAX_BYTES = 64 * 1024;

  async function setComponentData(db, principal, helpers, input) {
    if (typeof input.expected_version !== "number" || !Number.isSafeInteger(input.expected_version) || input.expected_version < 0) throw new AgentError("read_blocks의 version을 expected_version 숫자로 보내 주세요.");
    if (typeof input.page !== "string" || !input.page.trim()) throw new AgentError("페이지 슬러그가 필요해요.");
    let data = input.data;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = null; } }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AgentError("data 는 JSON 객체여야 해요.");
    const slug = helpers.resolveSlug(input.page);
    const found = await helpers.readPage(db, slug);
    if (!found) throw new AgentError("없는 페이지예요.", 404);
    if (found.page.updated !== input.expected_version) throw new AgentError("그사이 페이지가 바뀌었어요. 다시 읽고 합친 뒤 쓰세요.", 409);
    const blocks = found.blocks.slice();
    let index = -1, ui = typeof input.ui === "string" ? input.ui : "";
    if (typeof input.block_id === "string" && input.block_id) {
      index = blocks.findIndex((b) => b.id === input.block_id);
      if (index < 0) throw new AgentError("없는 블록이에요.", 404);
      if (blocks[index].type !== "component") throw new AgentError("컴포넌트 블록이 아니에요. set_component_data 는 컴포넌트 블록의 데이터만 바꿔요.");
      const own = String(blocks[index].meta?.ui || "");
      if (ui && ui !== own) throw new AgentError("이 블록은 " + own + " 컴포넌트예요. 다른 컴포넌트는 ui 와 after_block_id 로 새 블록을 붙인 뒤 delete_block 으로 옛 블록을 지워 주세요.");
      ui = own;
    } else if (!ui) throw new AgentError("block_id(기존 컴포넌트 블록) 또는 ui(새 블록을 붙일 컴포넌트 id)가 필요해요.");
    const comp = getComponent(ui);
    if (!comp) throw new AgentError("없는 컴포넌트예요: " + ui + ". list_components 로 확인해 주세요.", 404);
    const errors = validatePartData(comp.schema || { type: "object" }, data);
    if (errors.length) throw new AgentError("컴포넌트 " + ui + " 데이터가 스키마와 맞지 않아요: " + errors.slice(0, 5).join(" · ") + ". list_components 로 스키마를 확인해 주세요.");
    const text = JSON.stringify(data, null, 2);
    if (new TextEncoder().encode(text).length > COMPONENT_MAX_BYTES) throw new AgentError("컴포넌트 데이터는 64KB 까지예요.", 413);
    let affected;
    if (index >= 0) {
      blocks[index] = { ...blocks[index], text, meta: { ...(blocks[index].meta || {}), ui } };
      affected = blocks[index].id;
    } else {
      const block = { id: "a" + crypto.randomUUID(), type: "component", text, indent: 0, checked: false, meta: { ui } };
      const after = typeof input.after_block_id === "string" ? blocks.findIndex((b) => b.id === input.after_block_id) : blocks.length - 1;
      if (typeof input.after_block_id === "string" && after < 0) throw new AgentError("없는 블록이에요.", 404);
      blocks.splice(after + 1, 0, block);
      affected = block.id;
    }
    const guard = humanGuard(found.blocks, blocks, principal.name);
    const version = Math.max(Date.now(), found.page.updated + 1);
    const claimed = await db.prepare("UPDATE pages SET updated = ? WHERE slug = ? AND updated = ?").bind(version, slug, input.expected_version).run();
    if (Number(claimed?.meta?.changes ?? 0) === 0) throw new AgentError("그사이 페이지가 바뀌었어요. 다시 읽고 합친 뒤 쓰세요.", 409);
    await helpers.captureEditorVersion(db, slug);
    await db.prepare("UPDATE pages SET source = 'editor', hash = NULL WHERE slug = ?").bind(slug).run();
    await helpers.saveBlocks(db, slug, guard.blocks);
    await db.prepare("INSERT INTO agent_activity (id, page, agent, via, action, created) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), slug, principal.name, principal.via, "component-data", version).run();
    return humanNote({ page: slug, version, updated: version, block_id: affected, ui }, guard);
  }

  registerFeature({
    services: { mcpTools: [
      { name: "list_components", description: "Components for good-looking pages without HTML: " + componentNames() + ". Each is a ```acard-ui {\"ui\":\"<id>\"} fence holding JSON data only. Call with no id for every component's schema, defaults and example fence, or with id for one. Missing or malformed fields fall back to defaults when shown.", scope: "read", operation: "listComponents",
        inputSchema: (z) => ({ id: z.string().optional() }) },
      { name: "set_component_data", description: "Set the JSON data of a component block (block_id) or add a new component block (ui = component id, optional after_block_id). The data is checked against the component's schema from list_components; a mismatch fails and names the field. A component a person edited keeps the person's data and yours becomes an update suggestion. Requires version from read_blocks as expected_version.", scope: "write", operation: "setComponentData",
        inputSchema: (z) => ({ page: z.string(), block_id: z.string().optional(), ui: z.string().optional(), after_block_id: z.string().optional(), data: z.record(z.string(), z.unknown()), expected_version: z.number().int().nonnegative() }) },
    ] },
    agentOps: {
      listComponents: async (db, principal, helpers, input) => {
        if (typeof input.id === "string" && input.id) {
          const one = componentCatalog(input.id);
          if (!one) throw new AgentError("없는 컴포넌트예요: " + input.id + ". list_components 로 목록을 확인해 주세요.", 404);
          return one;
        }
        return { fence: COMPONENT_FENCE, components: componentCatalog() };
      },
      setComponentData: (db, principal, helpers, input) => setComponentData(db, principal, helpers, input),
    },
    agentApi: async ({ path, method, run, helpers }) => {
      const match = /^\/api\/v1\/components(?:\/([a-z][a-z0-9-]{1,39}))?$/.exec(path);
      if (!match) return null;
      if (method !== "GET") return helpers.json({ error: "지원하지 않는 방법이에요." }, 405);
      return helpers.json(await run("listComponents", match[1] ? { id: match[1] } : {}));
    },
  });
})();
