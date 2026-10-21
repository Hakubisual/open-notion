// D1-shaped database over Postgres. The app keeps writing SQLite-flavoured SQL
// (`?` params, INSERT OR IGNORE/REPLACE, `IS ?`, group_concat); translate() turns
// it into Postgres SQL so the ~350 call sites stay unchanged. Schema is owned by
// migrations/supabase/*.sql, so runtime CREATE/DROP statements become no-ops.

export type PgRows = { rows: Record<string, unknown>[]; count: number };
export type PgDriver = {
  query(sql: string, params: unknown[]): Promise<PgRows>;
  transaction<T>(fn: (q: PgDriver["query"]) => Promise<T>): Promise<T>;
  // Statements without parameters sent as one simple-protocol message: Postgres runs them as one implicit
  // transaction (all or nothing) in one round trip, so row locks taken inside are held only while it executes.
  script?(text: string): Promise<void>;
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

// Parameters written into the statement as quoted literals. Through Hyperdrive every round trip costs ~125 ms, and
// postgres.js sends a parameterised statement as Parse/Describe first and Bind/Execute after the answer (two round
// trips, no pipelining); a statement without parameters is one simple-protocol message and pipelines. A quoted
// literal is an untyped constant exactly like an untyped parameter (postgres.js sends strings and numbers as type 0),
// so Postgres resolves it the same way. E'' with doubled backslashes and quotes cannot end the literal early.
const literal = (v: unknown): string | null => {
  if (v === null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? "'" + String(v) + "'" : null;
  if (typeof v === "bigint") return "'" + v.toString() + "'";
  if (typeof v === "string") return v.includes("\0") ? null : "E'" + v.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  return null;
};

// null when a value has no safe literal form (bytes, objects, NUL): that statement keeps its parameters.
export function inline(text: string, params: unknown[]): string | null {
  const values = params.map(literal);
  if (values.some(v => v === null)) return null;
  return mapOutsideStrings(text, code => code.replace(/\$(\d+)/g, (m, n) => values[Number(n) - 1] ?? m));
}

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
    const values = params.map(normalize);
    const flat = values.length ? inline(text, values) : text;
    const r = await (flat === null ? q(text, values) : q(flat, []));
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
  const self = {
    dialect: "pg" as const,
    prepare: (sql: string) => statement(sql),
    batch: async (list: Stmt[]) => {
      // Schema batches translate to no-ops on Postgres; skip the BEGIN/COMMIT round trips when nothing is left to run.
      const live = list.filter(s => translate(s.sql) !== null);
      if (!live.length) return list.map(() => result({ rows: [], count: 0 }));
      // Every statement is handed to the connection at once, in order: postgres.js pipelines them, so a batch costs
      // BEGIN + one round trip + COMMIT instead of one round trip per statement. Postgres still runs them one after
      // another, and after a failure the rest fail too and the transaction rolls back.
      return driver.transaction(async q => (await Promise.all(list.map(s => exec(q, s.sql, s.params)))).map(result));
    },
    // A batch whose per-statement results nobody reads (block replacement): one round trip, all or nothing.
    script: async (list: Stmt[]): Promise<void> => {
      const flat = list.flatMap(s => { const t = translate(s.sql); return t === null ? [] : [s.params.length ? inline(t, s.params.map(normalize)) : t]; });
      if (!flat.length) return;
      if (driver.script && flat.every(t => t !== null)) return driver.script(flat.join(";\n"));
      await self.batch(list);
    },
    exec: async (sql: string) => { await exec(driver.query, sql, []); return { count: 1, duration: 0 }; },
  };
  return self;
}
