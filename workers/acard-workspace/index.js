import { DurableObject } from "cloudflare:workers";

// One SQLite Durable Object per signed-up workspace (not the owner, who stays on D1).
// The app talks to it through a D1-shaped adapter (gate/tenancy.ts), so app SQL runs unchanged
// but can only ever see this workspace's own database.

const WRITE = /^\s*(insert|update|delete|replace)\b/i;
const DAILY_WRITES = 5000;
const RECURRING_RETRY_MS = 5 * 60 * 1000;

// Repeating row templates (notion-parity C5): the site asks the workspace's own store to wake it at the earliest next run;
// the alarm calls back POST /__recurring/tick with the shared secret and re-arms with the time the site answers.
async function recurringTick(env, ws) {
  const res = await fetch(env.SITE_URL + "/__recurring/tick", {
    method: "POST",
    headers: { "content-type": "application/json", "x-recurring-tick": env.RECURRING_TICK_SECRET || "" },
    body: JSON.stringify({ ws }),
  });
  if (!res.ok) throw new Error("recurring tick " + res.status);
  return await res.json();
}

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

  // Several statements in one round trip (gate/tenancy.ts d1Adapter). Each item runs in order and reports its own result,
  // so one failing statement fails only its caller, like separate exec/batch calls did.
  async pipe(items) {
    return items.map((item) => {
      try {
        const value = item.batch
          ? this.ctx.storage.transactionSync(() => item.batch.map((s) => this.run(s.sql, s.params, "run")))
          : this.run(item.sql, item.params, item.mode);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
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

  async scheduleRecurring(ws, nextAt) {
    if (typeof ws !== "string" || !/^[0-9a-f]{32}$/.test(ws)) throw new Error("bad workspace");
    await this.ctx.storage.put("recurringWs", ws);
    if (Number.isFinite(nextAt)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, nextAt));
    else await this.ctx.storage.deleteAlarm();
    return { armed: Number.isFinite(nextAt) ? nextAt : null };
  }

  async alarm() {
    const ws = await this.ctx.storage.get("recurringWs");
    if (!ws) return;
    let next;
    try {
      next = (await recurringTick(this.env, ws)).next;
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + RECURRING_RETRY_MS);
      return;
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }

  // The instance named "global:media" is not a workspace: it holds the byte total of every media original in R2 so
  // uploads stop before the R2 free tier (10 GB) is passed. Check-and-add happens in one call, and a Durable Object runs
  // one call at a time, so two uploads can never both take the last free bytes.
  mediaLedger() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS media_ledger (id INTEGER PRIMARY KEY CHECK (id = 1), used INTEGER NOT NULL, alerted INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("INSERT OR IGNORE INTO media_ledger (id, used, alerted) VALUES (1, 0, 0)");
    return this.sql.exec("SELECT used, alerted FROM media_ledger WHERE id = 1").one();
  }

  async mediaUsage(delta, cap) {
    const row = this.mediaLedger();
    const used = Number(row.used), change = Number(delta) || 0;
    if (change > 0 && Number.isFinite(cap) && used + change > cap) return { ok: false, used, alerted: Number(row.alerted) };
    const next = Math.max(0, used + change);
    this.sql.exec("UPDATE media_ledger SET used = ? WHERE id = 1", next);
    return { ok: true, used: next, alerted: Number(row.alerted) };
  }

  async mediaSetUsage(bytes) {
    this.mediaLedger();
    this.sql.exec("UPDATE media_ledger SET used = ? WHERE id = 1", Math.max(0, Number(bytes) || 0));
    return this.mediaLedger();
  }

  async mediaMarkAlerted(level) {
    const row = this.mediaLedger();
    if (Number(row.alerted) >= level) return false;
    this.sql.exec("UPDATE media_ledger SET alerted = ? WHERE id = 1", level);
    return true;
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
  // The owner workspace lives on the main database, not in a store, so a 15-minute cron runs its repeating templates.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(recurringTick(env, "owner").catch((error) => console.error("owner recurring tick failed", error instanceof Error ? error.message : String(error))));
  },
};
