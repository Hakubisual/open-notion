import postgres from "postgres";
import { pgD1, type PgDriver } from "./pg-d1";

export type DataEnv = { DATA_BACKEND?: string; HYPERDRIVE?: { connectionString: string } };

export type DbTiming = { n: number; ms: number; first: number };

// #44: the pooler behind Hyperdrive answers "max clients reached" / "too many clients" when every server connection is
// taken. Nothing ran on the database for such a query, so a read or a write is safe to send again after a short wait.
export function isDbBusy(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "53300" || /EMAXCONNSESSION|EMAXCONN|max clients reached|too many clients|remaining connection slots/i.test(String(e?.message ?? error));
}

export const BUSY_BACKOFF_MS = [80, 200, 400, 700];

// A request runs at most MAX_INFLIGHT queries at once (a transaction counts as one), the rest wait their turn here.
// The queue belongs to one driver, i.e. one request: a queue shared by every request of an isolate handed a freed slot
// to a promise of another request, which Workers cancels, and a request that was cancelled or hung never gave its slot
// back, so every later request of that isolate waited forever ("Worker's code had hung", Cloudflare 1101).
export const MAX_INFLIGHT = 6;
function limiter() {
  let inflight = 0;
  const queue: (() => void)[] = [];
  return async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (inflight >= MAX_INFLIGHT) await new Promise<void>((go) => queue.push(go));
    else inflight++;
    try { return await work(); }
    finally { const next = queue.shift(); if (next) next(); else inflight--; }
  };
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms + Math.random() * ms * 0.5));

export function postgresDriver(connectionString: string, timing: DbTiming = { n: 0, ms: 0, first: 0 }): { driver: PgDriver; end(): Promise<void> } {
  const sql = postgres(connectionString, {
    max: 3,
    prepare: false,
    fetch_types: false,
    idle_timeout: 5,
    connection: { search_path: "acard" },
    types: { int8: { to: 20, from: [20], serialize: (v: unknown) => String(v), parse: (v: string) => Number(v) } },
  });
  const slot = limiter();
  const wrap = (s: any, outer: boolean): PgDriver["query"] => async (text, params) => {
    let r;
    const t0 = Date.now();
    const once = () => s.unsafe(text, params as any[]);
    for (let attempt = 0; ; attempt++) {
      try { r = await (outer ? slot(once) : once()); break; }
      catch (error) {
        if (!outer) throw error;
        if (isDbBusy(error) && attempt < BUSY_BACKOFF_MS.length) { await pause(BUSY_BACKOFF_MS[attempt]); continue; }
        // Hyperdrive sometimes hands out a pooled socket that is already closed or drops it mid-read; a read is safe to resend on a fresh one.
        const lost = (error as { code?: string })?.code === "CONNECTION_CLOSED" || /Network connection lost/i.test(String((error as Error)?.message));
        if (attempt >= 2 || !lost || !/^\s*(select|with)\b/i.test(text)) throw error;
      }
    }
    const spent = Date.now() - t0;
    if (timing.n === 0) timing.first = spent;
    timing.n += 1;
    timing.ms += spent;
    return { rows: [...r], count: r.count ?? r.length };
  };
  const transaction: PgDriver["transaction"] = async (fn) => {
    for (let attempt = 0; ; attempt++) {
      let started = false;
      try { return await slot(() => sql.begin((tx) => { started = true; return fn(wrap(tx, false)); }) as any); }
      catch (error) {
        // Busy before BEGIN ran: no statement of the transaction reached the database, so it is sent again whole.
        if (started || !isDbBusy(error) || attempt >= BUSY_BACKOFF_MS.length) throw error;
        await pause(BUSY_BACKOFF_MS[attempt]);
      }
    }
  };
  // A multi-statement simple query is one implicit transaction on the server: one round trip, nothing applied if a
  // statement fails. Retried only when the pooler was busy before it ran.
  const script: PgDriver["script"] = async (text) => {
    const t0 = Date.now();
    for (let attempt = 0; ; attempt++) {
      try { await slot(() => sql.unsafe(text)); break; }
      catch (error) {
        if (!isDbBusy(error) || attempt >= BUSY_BACKOFF_MS.length) throw error;
        await pause(BUSY_BACKOFF_MS[attempt]);
      }
    }
    if (timing.n === 0) timing.first = Date.now() - t0;
    timing.n += 1;
    timing.ms += Date.now() - t0;
  };
  return {
    driver: { query: wrap(sql, true), transaction, script },
    end: () => sql.end({ timeout: 2 }),
  };
}

export function withDataBackend<E extends DataEnv & { DB?: unknown }>(env: E): { env: E; done(): Promise<void>; timing: DbTiming } {
  const timing: DbTiming = { n: 0, ms: 0, first: 0 };
  if (env.DATA_BACKEND !== "supabase" || !env.HYPERDRIVE) return { env, done: async () => {}, timing };
  const { driver, end } = postgresDriver(env.HYPERDRIVE.connectionString, timing);
  return { env: { ...env, DB: pgD1(driver), D1_BACKUP: env.DB }, done: end, timing };
}
