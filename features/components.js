// ds10 component catalog for agents. The MCP tool description carries only the component names; the schema, defaults and
// a ready-to-paste fence come from list_components (MCP) or GET /api/v1/components[/<id>] (REST) when asked.
(() => {
  registerFeature({
    services: { mcpTools: [
      { name: "list_components", description: "Components for good-looking pages without HTML: " + componentNames() + ". Each is a ```acard-ui {\"ui\":\"<id>\"} fence holding JSON data only. Call with no id for every component's schema, defaults and example fence, or with id for one. Missing or malformed fields fall back to defaults when shown.", scope: "read", operation: "listComponents",
        inputSchema: (z) => ({ id: z.string().optional() }) },
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
    },
    agentApi: async ({ path, method, run, helpers }) => {
      const match = /^\/api\/v1\/components(?:\/([a-z][a-z0-9-]{1,39}))?$/.exec(path);
      if (!match) return null;
      if (method !== "GET") return helpers.json({ error: "지원하지 않는 방법이에요." }, 405);
      return helpers.json(await run("listComponents", match[1] ? { id: match[1] } : {}));
    },
  });
})();
