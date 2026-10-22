// acard-storage-cost 2: which media originals nothing refers to any more. Run one workspace at a time by
// scripts/media-quarantine.ts through POST /__media/orphans (secret header, like /__media/migrate).
//
// A workspace scan reads every row of every table except `media` itself and collects every 16-hex token it finds, in
// any column: page bodies and block meta, trash, page history, share links and published copies, page settings
// (icon/cover), database rows and templates, comments, journal events, agent activity and memos are all tables, so they
// are all covered, and a token that only looks like a media id only makes the scan keep more. The script unions the
// tokens of every workspace, so an id pasted into another workspace keeps the file too.
//
// A file is a candidate only when all of these hold; anything else is kept:
//   - its media row is older than 30 days;
//   - no workspace mentions its id anywhere;
//   - its row names no page, or a page that no longer exists and is not in the trash (a page's attachments list
//     shows files by their page even when the body does not link them);
//   - its R2 original is there (an id missing from R2 is reported, not touched).
export const ORPHAN_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN = /[0-9a-f]{16}/g;
const SCAN_PAGE = 40;

type Db = { prepare(sql: string): { all(): Promise<{ results?: Record<string, unknown>[] }>; bind(...v: unknown[]): { all(): Promise<{ results?: Record<string, unknown>[] }> } } };

export type MediaRow = { id: string; page: string | null; bytes: number; created: number; mime: string };

export function tokensIn(value: unknown, into: Set<string>) {
  if (value === null || value === undefined) return;
  const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  for (const match of text.toLowerCase().matchAll(TOKEN)) into.add(match[0]);
}

// postgres: the owner workspace on Supabase (schema acard); otherwise a workspace's SQLite store.
export async function scanWorkspace(db: Db, postgres: boolean) {
  const listed = postgres
    ? await db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'acard' AND table_type = 'BASE TABLE'").all()
    : await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'").all();
  const tables = (listed.results ?? []).map((row) => String(row.name)).filter((name) => /^[a-z_][a-z0-9_]*$/.test(name)).sort();
  const referenced = new Set<string>();
  const scanned: string[] = [];
  const failed: string[] = [];
  for (const table of tables) {
    if (table === "media") continue;
    try {
      // Pages of rows: a big history table is more than one store call may carry (32 MiB).
      let seen = 0;
      for (let offset = 0; ; offset += SCAN_PAGE) {
        const order = postgres ? " ORDER BY ctid" : " ORDER BY rowid";
        const rows = (await db.prepare("SELECT * FROM " + table + order + " LIMIT " + SCAN_PAGE + " OFFSET " + offset).all()).results ?? [];
        for (const row of rows) for (const value of Object.values(row)) tokensIn(value, referenced);
        seen += rows.length;
        if (rows.length < SCAN_PAGE) break;
      }
      scanned.push(table + ":" + seen);
    } catch (error) {
      failed.push(table + ": " + String((error as Error).message ?? error).slice(0, 120));
    }
  }
  const media = ((await db.prepare("SELECT id, page, bytes, created, mime FROM media").all()).results ?? []).map((r) => ({
    id: String(r.id), page: r.page === null || r.page === undefined ? null : String(r.page), bytes: Number(r.bytes) || 0, created: Number(r.created) || 0, mime: String(r.mime ?? ""),
  })) as MediaRow[];
  const pages = new Set(((await db.prepare("SELECT slug FROM pages").all()).results ?? []).map((r) => String(r.slug)));
  const trash = new Set(((await db.prepare("SELECT page FROM editor_trash").all().catch(() => ({ results: [] }))).results ?? []).map((r) => String(r.page)));
  return { tables: scanned, failed, referenced: [...referenced], media, livePages: media.filter((m) => m.page && (pages.has(m.page) || trash.has(m.page))).map((m) => m.id) };
}

export type WorkspaceScan = Awaited<ReturnType<typeof scanWorkspace>> & { ws: string };

// The decision over every workspace's scan. `inR2` says which original keys exist; `keyFor` maps a workspace + id to it.
export function orphanCandidates(scans: WorkspaceScan[], inR2: Set<string>, keyFor: (ws: string, id: string) => string, now = Date.now()) {
  const everywhere = new Set<string>();
  for (const scan of scans) for (const token of scan.referenced) everywhere.add(token);
  const candidates: (MediaRow & { ws: string; key: string })[] = [];
  const kept = { referenced: 0, young: 0, onLivePage: 0, notInR2: 0, scanFailed: 0 };
  for (const scan of scans) {
    const live = new Set(scan.livePages);
    for (const m of scan.media) {
      const key = keyFor(scan.ws, m.id);
      if (scan.failed.length) kept.scanFailed += 1;
      else if (everywhere.has(m.id)) kept.referenced += 1;
      else if (!(m.created > 0) || now - m.created < ORPHAN_MIN_AGE_MS) kept.young += 1;
      else if (live.has(m.id)) kept.onLivePage += 1;
      else if (!inR2.has(key)) kept.notInR2 += 1;
      else candidates.push({ ...m, ws: scan.ws, key });
    }
  }
  return { candidates, kept, bytes: candidates.reduce((n, c) => n + c.bytes, 0) };
}
