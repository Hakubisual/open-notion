// Agent write limits (acard-storage-cost 5): a stuck or looping agent stops at a fixed number of writes per token, with a
// 429 + Retry-After and a Korean message, instead of rewriting pages without end. Counted once per write request at the
// agent entry (gate/agent-entry.ts): a write tool in an MCP tools/call, a non-GET /api/v1 call, or a bearer page save.
// A person saving in the editor (cookie session) never comes through here. Counters live in memory in one Durable Object
// per workspace (workers/acard-workspace agentWrite), so counting adds no database write.
//
// The numbers are set in one place: the admin console's ai_limits (agentWritesPerMinute / agentWritesPerDay per role,
// user_roles.limits per account), read through the same Supabase registry as the AI limits and cached for a minute. These
// defaults apply when the registry has no value. Measured 2026-10-22 (report: acard-storage-cost-report.json): the busiest
// real agent day was 142 writes and the busiest minute 13 (owner and admin workspaces, agent_activity + journal_events),
// so 60 a minute and 2,000 a day are about 4-5x the busiest minute and 14x the busiest day.
export const AGENT_WRITE_DEFAULTS = { agentWritesPerMinute: 60, agentWritesPerDay: 2000 };

type Stub = { agentWrite(token: string, perMinute: number, perDay: number): Promise<{ ok: boolean; limit?: "minute" | "day"; max?: number; retryAfter?: number }> };
type Namespace = { idFromName(name: string): unknown; get(id: unknown): unknown };
export type WriteLimitEnv = { readonly WORKSPACE?: Namespace; readonly SUPABASE_URL?: string; readonly SUPABASE_SERVICE_ROLE_KEY?: string; readonly OWNER_USER_ID?: string };

const READ_TOOLS = new Set(["whoami", "list_pages", "read_page", "list_databases", "read_database", "list_decisions", "get_agent_skills", "list_components", "acard_first_run", "list_tags", "read_blocks", "list_parts"]);

// MCP: every tools/call except the read tools above counts (journal_* and memo_add included: they write too). Other JSON-RPC
// methods (initialize, tools/list) never count. A batch counts each call.
export function mcpWriteCalls(body: unknown): number {
  const list = Array.isArray(body) ? body : [body];
  return list.filter((m) => m && typeof m === "object" && (m as { method?: unknown }).method === "tools/call" && !READ_TOOLS.has(String((m as { params?: { name?: unknown } }).params?.name ?? ""))).length;
}

export function isRestWrite(method: string, path: string): boolean {
  return path.startsWith("/api/v1/") && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && !path.startsWith("/api/v1/cloud/");
}

const cache = new Map<string, { at: number; limits: typeof AGENT_WRITE_DEFAULTS }>();
const CACHE_MS = 60_000;

async function registryLimits(env: WriteLimitEnv, userId: string | null): Promise<typeof AGENT_WRITE_DEFAULTS> {
  const key = userId ?? "-";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.limits;
  let limits = { ...AGENT_WRITE_DEFAULTS };
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && userId) {
    try {
      const res = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/ai_context", {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" },
        body: JSON.stringify({ p_user: userId }),
      });
      if (res.ok) {
        const ctx = await res.json() as { role?: { role?: string; limits?: Record<string, unknown> } | null; limits?: { role: string; limits: Record<string, unknown> }[] };
        const role = ctx.role?.role ?? (userId === env.OWNER_USER_ID ? "owner" : "member");
        const merged = { ...(ctx.limits ?? []).find((l) => l.role === role)?.limits, ...(ctx.role?.limits ?? {}) } as Record<string, unknown>;
        for (const name of Object.keys(AGENT_WRITE_DEFAULTS) as (keyof typeof AGENT_WRITE_DEFAULTS)[]) {
          const v = merged[name];
          if (typeof v === "number" && Number.isInteger(v) && v >= 0) limits[name] = v;
        }
      }
    } catch (error) {
      console.error("agent write limits: registry unavailable, using defaults", String(error));
    }
  }
  cache.set(key, { at: Date.now(), limits });
  return limits;
}

function tooMany(limit: "minute" | "day", max: number, retryAfter: number): Response {
  const message = limit === "minute"
    ? "에이전트가 1분에 쓸 수 있는 횟수(" + max + "번)를 넘었어요. " + retryAfter + "초 뒤에 다시 쓸 수 있어요. 같은 내용을 반복해서 쓰고 있지 않은지 확인해 주세요."
    : "에이전트가 오늘 쓸 수 있는 횟수(" + max + "번)를 다 썼어요. 내일 0시(UTC, 한국 시간 오전 9시)에 다시 쓸 수 있어요. 더 필요하면 관리자에게 한도를 늘려 달라고 해 주세요.";
  return new Response(JSON.stringify({ error: message, limit, max, retryAfter }), {
    status: 429,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": String(retryAfter) },
  });
}

// null = go ahead; a Response = refuse with it. Fails open: when the counter cannot be reached the write goes through
// (the per-workspace daily store cap in workers/acard-workspace still applies).
export async function checkAgentWrites(env: WriteLimitEnv, ws: string, tokenKey: string, userId: string | null, count: number): Promise<Response | null> {
  if (count < 1 || !env.WORKSPACE) return null;
  const limits = await registryLimits(env, userId);
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName("agent-writes:" + ws)) as Stub;
  for (let i = 0; i < count; i++) {
    let result;
    try { result = await stub.agentWrite(tokenKey, limits.agentWritesPerMinute, limits.agentWritesPerDay); }
    catch (error) { console.error("agent write counter unavailable", String(error)); return null; }
    if (!result.ok) return tooMany(result.limit ?? "minute", result.max ?? 0, result.retryAfter ?? 60);
  }
  return null;
}

export function clearAgentWriteCache() {
  cache.clear();
}
