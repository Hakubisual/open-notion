// D1-shaped database over Postgres. The app keeps writing SQLite-flavoured SQL
// (`?` params, INSERT OR IGNORE/REPLACE, `IS ?`, group_concat); translate() turns
// it into Postgres SQL so the ~350 call sites stay unchanged. Schema is owned by
// migrations/supabase/*.sql, so runtime CREATE/DROP statements become no-ops.

export type PgRows = { rows: Record<string, unknown>[]; count: number };
export type PgDriver = {
  query(sql: string, params: unknown[]): Promise<PgRows>;
  transaction<T>(fn: (q: PgDriver["query"]) => Promise<T>): Promise<T>;
};

const REPLACE_KEYS: Record<string, string> = { agent_grants: "id", link_cache: "url", journal_digests: "day" };

const DDL = /^\s*(CREATE|DROP|ALTER)\s/i;

function mapOutsideStrings(sql: string, fn: (code: string) => string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const q = sql.indexOf("'", i);
    if (q < 0) { out += fn(sql.slice(i)); break; }
    out += fn(sql.slice(i, q));
    let end = q + 1;
    for (;;) {
      const next = sql.indexOf("'", end);
      if (next < 0) { end = sql.length; break; }
      if (sql[next + 1] === "'") { end = next + 2; continue; }
      end = next + 1; break;
    }
    out += sql.slice(q, end);
    i = end;
  }
  return out;
}

const cache = new Map<string, string | null>();

export function translate(sql: string): string | null {
  const hit = cache.get(sql);
  if (hit !== undefined) return hit;
  let out: string | null;
  if (DDL.test(sql)) out = null;
  else {
    let n = 0;
    let s = mapOutsideStrings(sql, code => code
      .replace(/\bMAX\(([^(),]+),\s*([^(),]+)\)/gi, "GREATEST($1, $2)")
      .replace(/\bIS\s+\?/gi, "IS NOT DISTINCT FROM ?")
      .replace(/\bIS\s+NOT\s+\?/gi, "IS DISTINCT FROM ?")
      .replace(/group_concat\(([^,()]+),\s*char\(10\)\)/gi, "string_agg($1, E'\\n')")
      .replace(/\bgroup_concat\(([^,()]+)\)/gi, "string_agg($1::text, ',')")
      .replace(/\bNOT LIKE\b/g, "NOT ILIKE")
      .replace(/(?<!NOT )\bLIKE\b/g, "ILIKE")
      .replace(/\bAS\s+([a-z]+[A-Z]\w*)/g, 'AS "$1"')
      .replace(/\?/g, () => "$" + ++n));
    const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i;
    const replace = /^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]*)\)/i;
    if (ignore.test(s)) s = s.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO") + " ON CONFLICT DO NOTHING";
    else {
      const m = replace.exec(s);
      if (m) {
        const key = REPLACE_KEYS[m[1]];
        if (!key) throw new Error("pg-d1: no conflict key for INSERT OR REPLACE INTO " + m[1]);
        const cols = m[2].split(",").map(c => c.trim()).filter(c => c !== key);
        s = s.replace(/^\s*INSERT\s+OR\s+REPLACE\s+INTO/i, "INSERT INTO") + " ON CONFLICT (" + key + ") DO UPDATE SET " + cols.map(c => c + " = excluded." + c).join(", ");
      }
    }
    out = s;
  }
  cache.set(sql, out);
  return out;
}

const normalize = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v);
const fix = (row: Record<string, unknown>) => {
  for (const k in row) {
    const v = row[k];
    if (typeof v === "bigint") row[k] = Number(v);
    else if (typeof v === "boolean") row[k] = v ? 1 : 0;
  }
  return row;
};

export function pgD1(driver: PgDriver) {
  type Stmt = { sql: string; params: unknown[]; bind(...p: unknown[]): Stmt; run(): Promise<any>; all(): Promise<any>; first(col?: string): Promise<any>; raw(): Promise<unknown[][]> };
  const exec = async (q: PgDriver["query"], sql: string, params: unknown[]) => {
    const text = translate(sql);
    if (text === null) return { rows: [], count: 0 };
    const r = await q(text, params.map(normalize));
    return { rows: r.rows.map(fix), count: r.count };
  };
  const result = (r: PgRows) => ({ success: true, results: r.rows, meta: { changes: r.count, rows_read: r.rows.length, rows_written: r.count } });
  const statement = (sql: string, params: unknown[] = []): Stmt => ({
    sql, params,
    bind: (...next) => statement(sql, next),
    run: async () => result(await exec(driver.query, sql, params)),
    all: async () => result(await exec(driver.query, sql, params)),
    first: async (col?: string) => {
      const row = (await exec(driver.query, sql, params)).rows[0] ?? null;
      return col ? (row ? row[col] ?? null : null) : row;
    },
    raw: async () => (await exec(driver.query, sql, params)).rows.map(r => Object.values(r)),
  });
  return {
    dialect: "pg" as const,
    prepare: (sql: string) => statement(sql),
    batch: async (list: Stmt[]) => {
      // Schema batches translate to no-ops on Postgres; skip the BEGIN/COMMIT round trips when nothing is left to run.
      const live = list.filter(s => translate(s.sql) !== null);
      if (!live.length) return list.map(() => result({ rows: [], count: 0 }));
      return driver.transaction(async q => {
        const out = [];
        for (const s of list) out.push(result(await exec(q, s.sql, s.params)));
        return out;
      });
    },
    exec: async (sql: string) => { await exec(driver.query, sql, []); return { count: 1, duration: 0 }; },
  };
}
