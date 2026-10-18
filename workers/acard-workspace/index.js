import { DurableObject } from "cloudflare:workers";

// One SQLite Durable Object per signed-up workspace (not the owner, who stays on D1).
// The app talks to it through a D1-shaped adapter (gate/tenancy.ts), so app SQL runs unchanged
// but can only ever see this workspace's own database.

const WRITE = /^\s*(insert|update|delete|replace)\b/i;
const DAILY_WRITES = 5000;

function clean(params) {
  return (params || []).map((value) => (value === undefined ? null : value === true ? 1 : value === false ? 0 : value));
}

export class WorkspaceStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.day = 0;
    this.writes = 0;
    this.hits = new Map();
  }

  count(sql) {
    if (!WRITE.test(sql)) return;
    const day = Math.floor(Date.now() / 86_400_000);
    if (day !== this.day) { this.day = day; this.writes = 0; }
    this.writes += 1;
    if (this.writes > DAILY_WRITES) throw new Error("QUOTA: 오늘 저장할 수 있는 양을 다 썼어요. 내일 다시 시도해 주세요.");
  }

  run(sql, params, mode) {
    this.count(sql);
    const rows = this.sql.exec(sql, ...clean(params)).toArray();
    if (mode === "all") return { results: rows, success: true, meta: {} };
    if (mode === "first") return rows[0] ?? null;
    const changes = Number(this.sql.exec("SELECT changes() AS c").one().c);
    return { results: rows, success: true, meta: { changes } };
  }

  async exec(sql, params, mode) {
    return this.run(sql, params, mode);
  }

  async batch(list) {
    return this.ctx.storage.transactionSync(() => list.map((item) => this.run(item.sql, item.params, "run")));
  }

  async stats() {
    const count = (table) => {
      try { return Number(this.sql.exec("SELECT count(*) AS n FROM " + table).one().n); } catch { return 0; }
    };
    return { pages: count("pages"), blocks: count("blocks"), db_rows: count("db_rows"), media: count("media"), agent_tokens: count("agent_tokens"), share_links: count("share_links"), bytes: this.ctx.storage.sql.databaseSize };
  }

  async wipe() {
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }

  async hit(key, limit, periodSeconds) {
    const now = Date.now();
    const window = Math.floor(now / (periodSeconds * 1000));
    const entry = this.hits.get(key);
    if (!entry || entry.window !== window) { this.hits.set(key, { window, n: 1 }); }
    else entry.n += 1;
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.window !== window) this.hits.delete(k);
    return (this.hits.get(key)?.n ?? 0) <= limit;
  }
}

export default {
  fetch() {
    return new Response("acard-workspace has no public routes", { status: 404 });
  },
};
