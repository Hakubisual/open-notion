// Self-host edition: AI features (writing, polish, chat agent, suggestions) belong to the paid edition.
// This stub keeps the services.ai contract so optional callers degrade to their rule-based paths.
(() => {
  const off = { error: "AI 기능은 이 에디션에 들어 있지 않아요.", status: 503 };
  registerFeature({ services: { ai: {
    plan: async () => ({ ...off, chain: [], record: async () => {} }),
    complete: async () => off,
    record: async () => {},
    context: async () => null,
    estimate: (text) => Math.ceil(String(text || "").length / 2),
    userIdOf: () => null,
    registryOn: () => false,
    sb: async () => { throw new Error("no registry"); },
    ROUTES: {},
  } } });
})();
