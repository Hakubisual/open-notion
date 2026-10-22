import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AGENT_WRITE_DEFAULTS, checkAgentWrites, clearAgentWriteCache, isRestWrite, mcpWriteCalls } from "../gate/agent-write-limit";

class FakeDurableObject { ctx: any; env: any; constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; } }
class FakeWorkerEntrypoint { ctx: any; env: any; constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; } }
// mock.module stays in place for the rest of the bun test process, so it carries every export later test files import.
mock.module("cloudflare:workers", () => ({ DurableObject: FakeDurableObject, WorkerEntrypoint: FakeWorkerEntrypoint }));
const { WorkspaceStore } = await import("../workers/acard-workspace/index.js");

function store() {
  const sqlite = new Database(":memory:");
  const ctx = { storage: { sql: { exec: (sql: string, ...p: unknown[]) => { const rows = sqlite.query(sql).all(...(p as any[])) as any[]; return { toArray: () => rows, one: () => rows[0] }; } }, transactionSync: (fn: () => unknown) => fn() } };
  return new (WorkspaceStore as any)(ctx, {});
}

function env(stores = new Map<string, any>(), extra: Record<string, unknown> = {}) {
  return { WORKSPACE: { idFromName: (n: string) => n, get: (n: string) => { if (!stores.has(n)) stores.set(n, store()); return stores.get(n); } }, ...extra };
}

beforeEach(() => clearAgentWriteCache());

describe("agent write limits (acard-storage-cost 5)", () => {
  test("which requests count: MCP write tools (each call in a batch), REST writes; never reads, initialize, tools/list or cloud", () => {
    expect(mcpWriteCalls({ jsonrpc: "2.0", method: "tools/call", params: { name: "append_to_page" } })).toBe(1);
    expect(mcpWriteCalls({ method: "tools/call", params: { name: "journal_log" } })).toBe(1);
    expect(mcpWriteCalls({ method: "tools/call", params: { name: "read_page" } })).toBe(0);
    expect(mcpWriteCalls({ method: "tools/list" })).toBe(0);
    expect(mcpWriteCalls({ method: "initialize" })).toBe(0);
    expect(mcpWriteCalls([{ method: "tools/call", params: { name: "insert_blocks" } }, { method: "tools/call", params: { name: "list_pages" } }, { method: "tools/call", params: { name: "update_page" } }])).toBe(2);
    expect(mcpWriteCalls(null)).toBe(0);
    expect([isRestWrite("POST", "/api/v1/pages"), isRestWrite("PATCH", "/api/v1/pages/a"), isRestWrite("GET", "/api/v1/pages"), isRestWrite("POST", "/api/v1/cloud/backups")]).toEqual([true, true, false, false]);
  });

  test("the 61st write in a minute is a 429 with Retry-After and a Korean message; another token and another workspace are separate", async () => {
    const stores = new Map();
    const e = env(stores);
    for (let i = 0; i < AGENT_WRITE_DEFAULTS.agentWritesPerMinute; i++) expect(await checkAgentWrites(e, "ws1", "token:a", null, 1)).toBeNull();
    const refused = await checkAgentWrites(e, "ws1", "token:a", null, 1);
    expect(refused!.status).toBe(429);
    const retry = Number(refused!.headers.get("retry-after"));
    expect(retry >= 1 && retry <= 60).toBe(true);
    const body = await refused!.json() as any;
    expect(body).toMatchObject({ limit: "minute", max: 60 });
    expect(body.error).toContain("1분에 쓸 수 있는 횟수(60번)");
    expect(await checkAgentWrites(e, "ws1", "token:b", null, 1)).toBeNull();
    expect(await checkAgentWrites(e, "ws2", "token:a", null, 1)).toBeNull();
    expect(stores.has("agent-writes:ws1")).toBe(true);
  });

  test("the daily limit answers until the next UTC day; a refused write is not counted", async () => {
    const s = store();
    for (let i = 0; i < 3; i++) expect((await s.agentWrite("t", Infinity, 3)).ok).toBe(true);
    const day = await s.agentWrite("t", Infinity, 3);
    expect(day).toMatchObject({ ok: false, limit: "day", max: 3 });
    expect(day.retryAfter).toBeGreaterThan(0);
    expect(day.retryAfter).toBeLessThanOrEqual(86400);
    const m = store();
    expect((await m.agentWrite("t", 1, 10)).ok).toBe(true);
    expect((await m.agentWrite("t", 1, 10)).ok).toBe(false);
    expect((await m.agentWrite("t", 1, 10)).ok).toBe(false);
    expect(m.agentWrites.tokens.get("t")).toMatchObject({ inMinute: 1, inDay: 1 });
  });

  test("limits come from the admin console (ai_limits role row, then the user's own override), cached for a minute", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (url: string) => {
      calls++;
      expect(url).toBe("https://supa.test/rest/v1/rpc/ai_context");
      return Response.json({ role: { role: "tester", limits: { agentWritesPerMinute: 2 } }, limits: [{ role: "tester", limits: { agentWritesPerMinute: 5, agentWritesPerDay: 100 } }] });
    }) as any;
    try {
      const e = env(new Map(), { SUPABASE_URL: "https://supa.test", SUPABASE_SERVICE_ROLE_KEY: "k" });
      expect(await checkAgentWrites(e, "ws", "t", "u1", 1)).toBeNull();
      expect(await checkAgentWrites(e, "ws", "t", "u1", 1)).toBeNull();
      const third = await checkAgentWrites(e, "ws", "t", "u1", 1);
      expect(((await third!.json()) as any).max).toBe(2);
      expect(calls).toBe(1);
    } finally { globalThis.fetch = realFetch; }
  });

  test("an unreachable counter or registry lets the write through (fails open), and no Durable Object means no limit", async () => {
    const broken = { WORKSPACE: { idFromName: (n: string) => n, get: () => ({ agentWrite: async () => { throw new Error("down"); } }) } };
    expect(await checkAgentWrites(broken, "ws", "t", null, 1)).toBeNull();
    expect(await checkAgentWrites({}, "ws", "t", null, 5)).toBeNull();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("registry down"); }) as any;
    try { expect(await checkAgentWrites(env(), "ws", "t", "u", 1, )).toBeNull(); }
    finally { globalThis.fetch = realFetch; }
  });
});
