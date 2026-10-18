import postgres from "postgres";
import { pgD1, type PgDriver } from "./pg-d1";

export type DataEnv = { DATA_BACKEND?: string; HYPERDRIVE?: { connectionString: string } };

export type DbTiming = { n: number; ms: number; first: number };

export function postgresDriver(connectionString: string, timing: DbTiming = { n: 0, ms: 0, first: 0 }): { driver: PgDriver; end(): Promise<void> } {
  const sql = postgres(connectionString, {
    max: 5,
    prepare: false,
    fetch_types: false,
    connection: { search_path: "acard" },
    types: { int8: { to: 20, from: [20], serialize: (v: unknown) => String(v), parse: (v: string) => Number(v) } },
  });
  const wrap = (s: any, retryReads = false): PgDriver["query"] => async (text, params) => {
    let r;
    const t0 = Date.now();
    for (let attempt = 0; ; attempt++) {
      try { r = await s.unsafe(text, params as any[]); break; }
      catch (error) {
        // Hyperdrive sometimes hands out a pooled socket that is already closed or drops it mid-read; a read is safe to resend on a fresh one.
        const lost = (error as { code?: string })?.code === "CONNECTION_CLOSED" || /Network connection lost/i.test(String((error as Error)?.message));
        if (!retryReads || attempt >= 2 || !lost || !/^\s*(select|with)\b/i.test(text)) throw error;
      }
    }
    const spent = Date.now() - t0;
    if (timing.n === 0) timing.first = spent;
    timing.n += 1;
    timing.ms += spent;
    return { rows: [...r], count: r.count ?? r.length };
  };
  return {
    driver: { query: wrap(sql, true), transaction: fn => sql.begin(tx => fn(wrap(tx))) as any },
    end: () => sql.end({ timeout: 2 }),
  };
}

export function withDataBackend<E extends DataEnv & { DB?: unknown }>(env: E): { env: E; done(): Promise<void>; timing: DbTiming } {
  const timing: DbTiming = { n: 0, ms: 0, first: 0 };
  if (env.DATA_BACKEND !== "supabase" || !env.HYPERDRIVE) return { env, done: async () => {}, timing };
  const { driver, end } = postgresDriver(env.HYPERDRIVE.connectionString, timing);
  return { env: { ...env, DB: pgD1(driver), D1_BACKUP: env.DB }, done: end, timing };
}
