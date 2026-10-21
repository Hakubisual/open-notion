// Live change feed: notice which workspace content a request changed, then tell that workspace's LiveFeed DO
// (workers/acard-live) after the response, so open tabs refresh without a reload. A notice carries kinds + candidate
// slugs only; the DO narrows slugs for guests, and clients re-read content through permission-checked APIs.

type Stmt = { sql: string; params: unknown[]; bind(...p: unknown[]): Stmt; run(): Promise<unknown>; all(): Promise<unknown>; first(col?: string): Promise<unknown>; raw?(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt; batch(list: Stmt[]): Promise<unknown[]>; [key: string]: unknown };
type LiveStub = { fetch(input: string, init?: RequestInit): Promise<Response> };
export type LiveNamespace = { idFromName(name: string): unknown; get(id: unknown): LiveStub };

const TABLE_KIND: Record<string, string> = {
  pages: "tree", blocks: "page", editor_trash: "tree", editor_page_settings: "tree", page_tags: "tags",
  databases: "tree", db_rows: "page", db_properties: "page", db_views: "page", editor_comments: "page",
  journal_sessions: "journal", journal_events: "journal", folder_prefs: "tree", quick_notes: "page",
  // #61: shared pages are edge-cached per feed number, so share settings and files must move it too.
  share_rules: "share", share_pages: "share", share_links: "share", media: "media", parts: "page", part_themes: "page",
};
const WRITE = /^\s*(?:with\b[\s\S]*?\)\s*)?(insert(?:\s+or\s+\w+)?\s+into|update|delete\s+from|replace\s+into)\s+"?([a-z_]+)"?/i;

export type Sink = { ws: string; kinds: Set<string>; slugs: Set<string> };

export function classify(sql: string): string | null {
  const match = WRITE.exec(sql);
  if (!match) return null;
  return TABLE_KIND[match[2].toLowerCase()] ?? null;
}

function note(sink: Sink, sql: string, params: unknown[]) {
  const kind = classify(sql);
  if (!kind) return;
  sink.kinds.add(kind);
  if (/^\s*update\s+"?pages"?\s+set\s+title/i.test(sql)) sink.kinds.add("title");
  for (const value of slugParams(sql, params)) if (typeof value === "string" && value && value.length <= 200 && sink.slugs.size < 50) sink.slugs.add(value);
}

const SLUG_COLUMN = /^(?:slug|page|parent|src)$/i;

// Only values bound to a page-identifying column count as slugs; titles and block text never enter a notice.
export function slugParams(sql: string, params: unknown[]): unknown[] {
  const out: unknown[] = [];
  const insert = /insert(?:\s+or\s+\w+)?\s+into\s+"?[a-z_]+"?\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(sql);
  if (insert) {
    const cols = insert[1].split(",").map((c) => c.trim().replace(/"/g, ""));
    const vals = insert[2].split(",").map((v) => v.trim());
    let at = sql.slice(0, insert.index).split("?").length - 1;
    vals.forEach((v, i) => { if (v === "?") { if (SLUG_COLUMN.test(cols[i] ?? "")) out.push(params[at]); at += 1; } });
    return out;
  }
  const marks = [...sql.matchAll(/("?[a-z_.]+"?)\s*(=|<>|!=|IN\s*\()\s*\?|\?/gi)];
  let at = 0;
  for (const m of marks) {
    const column = m[1] ? m[1].replace(/"/g, "").split(".").pop() ?? "" : "";
    if (SLUG_COLUMN.test(column)) out.push(params[at]);
    at += 1;
  }
  return out;
}

export function trackDb<T>(db: T, sink: Sink): T {
  const inner = db as unknown as Db;
  if (!inner || typeof inner.prepare !== "function" || (inner as { acardLive?: boolean }).acardLive) return db;
  const wrap = (stmt: Stmt): Stmt => {
    const fire = <R>(p: Promise<R>) => p.then((value) => { note(sink, stmt.sql, stmt.params ?? []); return value; });
    return {
      get sql() { return stmt.sql; },
      get params() { return stmt.params; },
      bind: (...p: unknown[]) => wrap(stmt.bind(...p)),
      run: () => fire(stmt.run()),
      all: () => fire(stmt.all()),
      first: (col?: string) => fire(stmt.first(col)),
      raw: () => fire(stmt.raw ? stmt.raw() : stmt.all()),
      __inner: stmt,
    } as Stmt;
  };
  const tracked = Object.create(inner) as Db;
  tracked.acardLive = true;
  tracked.prepare = (sql: string) => wrap(inner.prepare(sql));
  tracked.batch = async (list: Stmt[]) => {
    const raw = list.map((s) => ((s as unknown as { __inner?: Stmt }).__inner ?? s));
    const out = await inner.batch(raw);
    for (const s of raw) note(sink, s.sql, s.params ?? []);
    return out;
  };
  const script = (inner as { script?: (list: Stmt[]) => Promise<void> }).script;
  if (typeof script === "function") (tracked as { script?: unknown }).script = async (list: Stmt[]) => {
    const raw = list.map((s) => ((s as unknown as { __inner?: Stmt }).__inner ?? s));
    await script(raw);
    for (const s of raw) note(sink, s.sql, s.params ?? []);
  };
  return tracked as unknown as T;
}

export function newSink(ws: string): Sink {
  return { ws, kinds: new Set(), slugs: new Set() };
}

export async function publish(live: LiveNamespace | undefined, sinks: Sink[], src: string): Promise<void> {
  if (!live) return;
  const byWs = new Map<string, Sink>();
  for (const sink of sinks) {
    if (!sink.kinds.size) continue;
    const merged = byWs.get(sink.ws) ?? newSink(sink.ws);
    sink.kinds.forEach((k) => merged.kinds.add(k));
    sink.slugs.forEach((s) => merged.slugs.add(s));
    byWs.set(sink.ws, merged);
  }
  await Promise.all([...byWs.values()].map((sink) => live.get(live.idFromName("live:" + sink.ws)).fetch("https://live/publish", {
    method: "POST",
    body: JSON.stringify({ kinds: [...sink.kinds], slugs: [...sink.slugs], src }),
  }).catch(() => undefined)));
}

export function connect(live: LiveNamespace, ws: string, request: Request, scope: string[] | null): Promise<Response> {
  const url = new URL(request.url);
  const since = url.searchParams.get("since") ?? "";
  const sse = (request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket";
  const target = "https://live/" + (sse ? "sse" : "ws") + "?since=" + encodeURIComponent(since) + (scope ? "&scope=" + encodeURIComponent(JSON.stringify(scope)) : "");
  return live.get(live.idFromName("live:" + ws)).fetch(target, { headers: request.headers });
}
