// get_agent_skills reads a workspace page with the slug 'agent-skills' when a person wrote one for agents.
// Nothing is created here: a workspace without that page (or with it in the trash) gets a 404.
(() => {
  registerFeature({
    services: { mcpTools: [{ name: "get_agent_skills", description: "Read the workspace page 'agent-skills' if a person wrote one for agents. Returns 404 when there is none.",
      scope: "read", operation: "getAgentSkills", inputSchema: () => ({}) }] },
    agentOps: { getAgentSkills: (db, principal, helpers) => agentOps.readPage(db, principal, helpers, { slug: "agent-skills" }) },
    agentApi: async ({ path, method, helpers, run }) => {
      if (path !== "/api/v1/agent-skills") return null;
      if (method !== "GET") return helpers.json({ error: "Method not allowed." }, 405);
      return helpers.json(await run("getAgentSkills", {}));
    },
  });
})();
