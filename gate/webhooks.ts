// Outgoing webhooks (#113, migration 030, docs: agent-docs.js webhooksMd).
//   1. Every write a request makes is seen through the live-feed sinks (gate/live.ts); watchWrites() keeps, per page, what
//      kind of change it was (created / content / trashed / restored / deleted), read off the SQL and its row count.
//   2. After the response, queueWebhooks() reads the current title/parent/trash state of those pages and calls
//      webhook_enqueue(), which merges them into one pending delivery per endpoint and page (the debounce), then arms the
//      "global:webhooks" WorkspaceStore alarm (workers/acard-workspace) for the earliest send time.
//   3. The alarm (and the 15-minute cron as a safety net) POSTs /__webhooks/tick, which leases due deliveries, checks the
//      target again (DNS), signs and sends them, and records the result; webhook_result() schedules retries with
//      exponential backoff and turns an endpoint off after WEBHOOK_CONFIG.disable_after failures in a row.
// Nothing here runs in the local edition (local/server.ts does not load gate/agent-entry.ts).
import type { Sink } from "./live";

export const WEBHOOK_CONFIG = {
  debounce_ms: 10_000,
  max_wait_ms: 60_000,
  timeout_ms: 10_000,
  backoff_base_ms: 30_000,
  backoff_max_ms: 3_600_000,
  max_attempts: 8,
  disable_after: 10,
  max_endpoints: 5,
  keep_days: 7,
  batch: 8,
  lease_ms: 60_000,
  tolerance_s: 300,
  test_per_minute: 10,
  presence_ttl_ms: 20_000,
} as const;

export const WEBHOOK_EVENTS = ["page.created", "page.updated", "page.renamed", "page.moved", "page.trashed", "page.restored", "page.deleted"] as const;
const SQL_CONFIG = Object.fromEntries((["debounce_ms", "max_wait_ms", "backoff_base_ms", "backoff_max_ms", "max_attempts", "disable_after"] as const).map((k) => [k, WEBHOOK_CONFIG[k]]));

type Store = { armWebhooks?(nextAt: number): Promise<unknown>; hit?(key: string, limit: number, period: number): Promise<boolean> };
export type WebhookEnv = {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly SITE_URL?: string;
  readonly WEBHOOK_SECRET_KEY?: string;
  readonly WORKSPACE?: { idFromName(name: string): unknown; get(id: unknown): Store };
};
export type Actor = { kind: "human" | "api_token" | "oauth_app" | "agent" | "guest" | "system"; name?: string; token_id?: string };

export class WebhookError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// ---------- signing ----------

export async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(timestamp + "." + body)));
}

export async function signatureHeader(secret: string, body: string, now = Date.now()): Promise<string> {
  const t = Math.floor(now / 1000);
  return "t=" + t + ",v1=" + (await sign(secret, t, body));
}

// The receiver's check, kept here so the tests prove the documented recipe.
export async function verifySignature(secret: string, header: string | null, body: string, now = Date.now(), toleranceS: number = WEBHOOK_CONFIG.tolerance_s): Promise<boolean> {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "") || Math.abs(now / 1000 - t) > toleranceS) return false;
  const expected = await sign(secret, t, body);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

// ---------- secrets: shown once, stored encrypted (AES-GCM, key from the WEBHOOK_SECRET_KEY Worker secret) ----------

export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "whsec_" + b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const secretHint = (secret: string) => secret.slice(0, 10) + "…" + secret.slice(-4);

async function aesKey(env: WebhookEnv): Promise<CryptoKey> {
  if (!env.WEBHOOK_SECRET_KEY) throw new WebhookError(503, "웹훅 비밀값 키가 아직 설정되지 않았어요.");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("acard-webhook-secret:v1:" + env.WEBHOOK_SECRET_KEY));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function sealSecret(env: WebhookEnv, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(secret)));
  return "v1." + b64(iv) + "." + b64(sealed);
}
export async function openSecret(env: WebhookEnv, sealed: string): Promise<string> {
  const [v, iv, data] = sealed.split(".");
  if (v !== "v1" || !iv || !data) throw new Error("unknown secret format");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(data)));
}

// ---------- SSRF: only public https hosts, checked when registered and again (DNS) before every send ----------

function v4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const bytes = m.slice(1).map(Number);
  return bytes.every((b) => b <= 255) ? bytes : null;
}

function blockedV4([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

// Eight 16-bit groups, or null when the text is not an IPv6 address (zone ids are refused).
function v6(text: string): number[] | null {
  let host = text.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(":") || host.includes("%")) return null;
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (tail) {
    const b = v4(tail[1]);
    if (!b) return null;
    host = host.slice(0, -tail[1].length) + ((b[0] << 8) | b[1]).toString(16) + ":" + ((b[2] << 8) | b[3]).toString(16);
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function blockedV6(w: number[]): boolean {
  const embedded = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0 || w[5] === 0xffff)) return w[5] === 0 || blockedV4(embedded(w[6], w[7]));
  if (w[0] === 0x64 && w[1] === 0xff9b) return w[2] !== 0 || blockedV4(embedded(w[6], w[7]));
  if (w[0] === 0x2002) return blockedV4(embedded(w[1], w[2]));
  return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00
    || (w[0] === 0x2001 && (w[1] === 0x0db8 || w[1] < 0x0200)) || (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0);
}

export function isBlockedIp(ip: string): boolean {
  const four = v4(ip);
  if (four) return blockedV4(four);
  const six = v6(ip);
  return six ? blockedV6(six) : true;
}

const INTERNAL = "내부망·이 컴퓨터·클라우드 메타데이터 주소로는 보낼 수 없어요.";
const BLOCKED_SUFFIX = ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "arpa", "test", "invalid", "example"];
type UrlCheck = { ok: true; url: string; host: string; ip: boolean } | { ok: false; error: string };

export function checkUrl(raw: unknown, siteHost?: string | null): UrlCheck {
  const bad = (error: string): UrlCheck => ({ ok: false, error });
  if (typeof raw !== "string" || !raw.trim()) return bad("받을 주소를 적어 주세요.");
  const text = raw.trim();
  if (text.length > 2000) return bad("주소가 너무 길어요.");
  let url: URL;
  try { url = new URL(text); } catch { return bad("주소 형식이 맞지 않아요."); }
  if (url.protocol !== "https:") return bad("https:// 로 시작하는 주소만 쓸 수 있어요.");
  if (url.username || url.password) return bad("주소에 아이디나 비밀번호를 넣을 수 없어요.");
  if (url.port && url.port !== "443") return bad("기본 포트(443)만 쓸 수 있어요.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let ip = false;
  if (host.startsWith("[")) {
    const words = v6(host);
    if (!words || blockedV6(words)) return bad(INTERNAL);
    ip = true;
  } else if (/^[\d.]+$/.test(host)) {
    const bytes = v4(host);
    if (!bytes || blockedV4(bytes)) return bad(INTERNAL);
    ip = true;
  } else {
    const labels = host.split(".");
    if (labels.length < 2 || BLOCKED_SUFFIX.includes(labels[labels.length - 1]) || host.endsWith(".home.arpa")) return bad(INTERNAL);
    const site = (siteHost ?? "").toLowerCase();
    if (site && (host === site || host.endsWith("." + site))) return bad("이 사이트 자신의 주소로는 보낼 수 없어요.");
  }
  url.hash = "";
  return { ok: true, url: url.toString(), host: host.replace(/^\[|\]$/g, ""), ip };
}

export async function resolveHost(host: string): Promise<string[]> {
  const ask = async (type: "A" | "AAAA") => {
    const res = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(host) + "&type=" + type, { headers: { accept: "application/dns-json" } });
    if (!res.ok) throw new Error("dns " + res.status);
    const body = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
    return (body.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  };
  const [a, aaaa] = await Promise.all([ask("A"), ask("AAAA")]);
  return [...a, ...aaaa];
}

export async function checkTarget(raw: unknown, siteHost?: string | null): Promise<UrlCheck> {
  const checked = checkUrl(raw, siteHost);
  if (!checked.ok || checked.ip) return checked;
  let ips: string[];
  try { ips = await resolveHost(checked.host); } catch { return { ok: false, error: "주소를 확인하지 못했어요. 잠시 뒤 다시 해 보세요." }; }
  if (!ips.length) return { ok: false, error: "주소를 찾을 수 없어요(DNS)." };
  if (ips.some(isBlockedIp)) return { ok: false, error: INTERNAL };
  return checked;
}

const siteHost = (env: WebhookEnv) => { try { return env.SITE_URL ? new URL(env.SITE_URL).hostname : null; } catch { return null; } };

// ---------- which pages a request changed ----------

export type Hints = Map<string, Set<string>>;
const WRITE = /^\s*(?:with\b[\s\S]*?\)\s*)?(insert(?:\s+or\s+\w+)?\s+into|replace\s+into|update|delete\s+from)\s+"?([a-z_]+)"?/i;
const PAGE_TABLES: Record<string, string[]> = { pages: ["slug"], blocks: ["page", "slug"], editor_trash: ["page"], editor_page_settings: ["page"] };

// Positions of the ? marks that are not inside a quoted literal.
function marks(sql: string): number[] {
  const out: number[] = [];
  let quote = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) { if (ch === quote) quote = sql[i + 1] === quote ? (i++, quote) : ""; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "?") out.push(i);
  }
  return out;
}

// Values bound to one of `columns` in the WHERE part (col = ?, col IN (?, ?)), or in the column list of INSERT ... VALUES.
export function boundSlugs(sql: string, params: unknown[], columns: string[]): string[] {
  const out: string[] = [];
  const at = marks(sql);
  const insert = /insert(?:\s+or\s+\w+)?\s+into\s+"?[a-z_]+"?\s*\(([^)]*)\)\s*values\s*\(/i.exec(sql);
  if (insert) {
    const cols = insert[1].split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
    const start = insert.index + insert[0].length;
    const close = sql.indexOf(")", start);
    const values = sql.slice(start, close).split(",").map((v) => v.trim());
    let n = at.filter((p) => p < start).length;
    values.forEach((v, i) => { if (v === "?") { if (columns.includes(cols[i] ?? "")) out.push(String(params[n])); n += 1; } });
    return out.filter((s) => s && s !== "undefined");
  }
  const where = sql.search(/\bwhere\b/i);
  if (where < 0) return out;
  at.forEach((pos, n) => {
    if (pos < where) return;
    const m = /(?:[a-z_]+\.)?"?([a-z_]+)"?\s*(?:=|\bin\s*\((?:\s*\?\s*,)*)\s*$/i.exec(sql.slice(0, pos));
    if (m && columns.includes(m[1].toLowerCase()) && typeof params[n] === "string") out.push(params[n] as string);
  });
  return out;
}

export function collectWrite(hints: Hints, sql: string, params: unknown[], changes: number | null): void {
  const m = WRITE.exec(sql);
  if (!m || changes === 0) return;
  const table = m[2].toLowerCase();
  const columns = PAGE_TABLES[table];
  if (!columns) return;
  const op = m[1].toLowerCase().startsWith("update") ? "update" : m[1].toLowerCase().startsWith("delete") ? "delete" : "insert";
  let kinds: string[];
  if (table === "pages") kinds = op === "insert" ? ["created", "content"] : op === "delete" ? ["deleted"] : ["content"];
  else if (table === "editor_trash") kinds = op === "delete" ? ["restored"] : /values\s*\(\s*\?\s*,\s*\?\s*,\s*0\s*\)/i.test(sql) ? ["trashed"] : ["deleted"];
  else kinds = ["content"];
  for (const slug of boundSlugs(sql, params, columns).slice(0, 50)) {
    if (slug.length > 200) continue;
    const set = hints.get(slug) ?? new Set<string>();
    kinds.forEach((k) => set.add(k));
    if (hints.size < 50 || hints.has(slug)) hints.set(slug, set);
  }
}

const HINTS = new WeakMap<Sink, Hints>();
export function watchWrites(sink: Sink): Sink {
  const hints: Hints = new Map();
  HINTS.set(sink, hints);
  sink.onWrite = (sql, params, changes) => collectWrite(hints, sql, params, changes);
  return sink;
}

// ---------- queueing ----------

async function rpc<T>(env: WebhookEnv, fn: string, args: Record<string, unknown>): Promise<T> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new WebhookError(503, "웹훅 저장소가 연결되지 않았어요.");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: key, authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("webhooks " + fn + " " + res.status + " " + text.slice(0, 200));
  return (text ? JSON.parse(text) : null) as T;
}

// Whether a workspace has an endpoint switched on, cached briefly per isolate so a workspace without webhooks costs
// one small read per presence_ttl_ms, not one per save. A new endpoint is heard by other isolates within that time.
const presence = new Map<string, { on: boolean; at: number }>();
export function forgetPresence(ws?: string): void { if (ws) presence.delete(ws); else presence.clear(); }
async function hasEndpoints(env: WebhookEnv, ws: string): Promise<boolean> {
  const hit = presence.get(ws);
  if (hit && Date.now() - hit.at < WEBHOOK_CONFIG.presence_ttl_ms) return hit.on;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/webhook_endpoints?select=id&enabled=eq.true&limit=1&ws=eq." + encodeURIComponent(ws), { headers: { apikey: key, authorization: "Bearer " + key } });
  if (!res.ok) throw new Error("webhooks presence " + res.status);
  const on = ((await res.json()) as unknown[]).length > 0;
  presence.set(ws, { on, at: Date.now() });
  return on;
}

type Db = { prepare(sql: string): { bind(...p: unknown[]): { all(): Promise<{ results?: Record<string, unknown>[] }> } } };
type Item = { slug: string; state: { exists: boolean; title?: string; parent?: string | null; kind?: string; trashed?: boolean }; hints: string[] };

export async function pageStates(db: unknown, hints: Hints): Promise<Item[]> {
  const slugs = [...hints.keys()].slice(0, 20);
  if (!slugs.length) return [];
  const rows = await (db as Db).prepare("SELECT p.slug, p.title, p.parent, p.kind, CASE WHEN EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug AND t.permanent = 0) THEN 1 ELSE 0 END AS trashed FROM pages p WHERE p.slug IN (" + slugs.map(() => "?").join(", ") + ")")
    .bind(...slugs).all();
  const found = new Map((rows.results ?? []).map((r) => [String(r.slug), r]));
  return slugs.map((slug) => {
    const r = found.get(slug);
    const state = r ? { exists: true, title: String(r.title ?? ""), parent: (r.parent as string | null) ?? null, kind: String(r.kind ?? "note"), trashed: Number(r.trashed) === 1 } : { exists: false };
    return { slug, state, hints: [...(hints.get(slug) ?? [])] };
  });
}

async function arm(env: WebhookEnv, next: number | null | undefined) {
  if (!Number.isFinite(next) || !env.WORKSPACE) return;
  await env.WORKSPACE.get(env.WORKSPACE.idFromName("global:webhooks")).armWebhooks?.(Number(next));
}

// A plain save rewrites title and parent with unchanged values, so a rename or move is only claimed from the SQL when
// the request came through the rename or move route; otherwise it is found by comparing with the last delivered state.
export function routeHints(path: string): string[] {
  if (/^\/api\/page\/[^/]+\/rename\/?$/.test(path)) return ["rename"];
  if (/^\/api\/page\/[^/]+\/move\/?$/.test(path)) return ["move"];
  return [];
}

export async function queueWebhooks(env: WebhookEnv, sinks: Sink[], actor: Actor, extra: string[] = []): Promise<number> {
  const byWs = new Map<string, { db: unknown; hints: Hints }>();
  for (const sink of sinks) {
    const hints = HINTS.get(sink);
    if (!hints?.size || !sink.db) continue;
    const entry = byWs.get(sink.ws) ?? { db: sink.db, hints: new Map() };
    for (const [slug, kinds] of hints) entry.hints.set(slug, new Set([...(entry.hints.get(slug) ?? []), ...kinds, ...extra]));
    byWs.set(sink.ws, entry);
  }
  if (!byWs.size || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return 0;
  let queued = 0;
  for (const [ws, { db, hints }] of byWs) {
    if (!(await hasEndpoints(env, ws))) continue;
    const items = await pageStates(db, hints);
    const result = await rpc<{ endpoints: number; queued: number; next: number | null }>(env, "webhook_enqueue", { p_ws: ws, p_items: items, p_actor: actor, p_config: SQL_CONFIG });
    presence.set(ws, { on: result.endpoints > 0, at: Date.now() });
    queued += result.queued;
    await arm(env, result.next);
  }
  return queued;
}

// ---------- sending ----------

type Claimed = {
  id: string; endpoint_id: string; ws: string; page_slug: string; event_type: string; changes: string[]; attempts: number;
  page: Item["state"] | null; actor: Actor | null; last_change_at: string; url: string; secret_enc: string; tuning: Record<string, number> | null;
};

export function payload(site: string, d: Pick<Claimed, "id" | "ws" | "page_slug" | "event_type" | "changes" | "attempts" | "page" | "actor" | "last_change_at">) {
  const page = d.page ?? { exists: false };
  const live = page.exists !== false;
  const slug = encodeURIComponent(d.page_slug);
  return {
    id: d.id,
    type: d.event_type,
    version: 1,
    occurred_at: new Date(d.last_change_at).toISOString(),
    attempt: d.attempts,
    workspace: { id: d.ws },
    page: {
      slug: d.page_slug, title: page.title ?? null, parent: page.parent ?? null, kind: page.kind ?? null, trashed: Boolean(page.trashed),
      url: live ? site + "/" + slug + "/" : null, api: live ? site + "/api/v1/pages/" + slug : null,
    },
    changes: d.changes,
    actor: d.actor ?? { kind: "system" },
  };
}

type Sent = { ok: boolean; status: number | null; error: string | null; ms: number };

async function send(env: WebhookEnv, rawUrl: string, sealed: string, body: string, id: string, type: string, timeoutMs: number): Promise<Sent> {
  const started = Date.now();
  const done = (ok: boolean, status: number | null, error: string | null): Sent => ({ ok, status, error, ms: Date.now() - started });
  const target = await checkTarget(rawUrl, siteHost(env));
  if (!target.ok) return done(false, null, "blocked: " + target.error);
  try {
    const secret = await openSecret(env, sealed);
    const res = await fetch(target.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        "user-agent": "Acard-Webhooks/1.0",
        "x-acard-event": type,
        "x-acard-delivery": id,
        "x-acard-signature": await signatureHeader(secret, body),
      },
      body,
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return done(true, res.status, null);
    return done(false, res.status, res.status >= 300 && res.status < 400 ? "redirect not followed" : "HTTP " + res.status);
  } catch (error) {
    const name = (error as Error | null)?.name;
    return done(false, null, name === "TimeoutError" || name === "AbortError" ? "timeout" : String((error as Error)?.message ?? error).slice(0, 200));
  }
}

export async function webhookTick(env: WebhookEnv, options: { cron?: boolean } = {}): Promise<{ sent: number; results: { id: string; status: string; http: number | null }[]; next: number | null }> {
  const site = (env.SITE_URL ?? "").replace(/\/$/, "");
  const claimed = await rpc<Claimed[]>(env, "webhook_claim", { p_limit: WEBHOOK_CONFIG.batch, p_lease_ms: WEBHOOK_CONFIG.lease_ms });
  const results = await Promise.all(claimed.map(async (d) => {
    const timeout = Number(d.tuning?.timeout_ms) > 0 ? Number(d.tuning!.timeout_ms) : WEBHOOK_CONFIG.timeout_ms;
    const sent = await send(env, d.url, d.secret_enc, JSON.stringify(payload(site, d)), d.id, d.event_type, timeout);
    const r = await rpc<{ status: string }>(env, "webhook_result", { p_id: d.id, p_ok: sent.ok, p_status: sent.status, p_error: sent.error, p_ms: sent.ms, p_config: SQL_CONFIG });
    return { id: d.id, status: r?.status ?? "unknown", http: sent.status };
  }));
  if (options.cron) await rpc(env, "webhook_prune", { p_days: WEBHOOK_CONFIG.keep_days }).catch(() => undefined);
  const next = claimed.length >= WEBHOOK_CONFIG.batch ? Date.now() + 1000 : await rpc<number | null>(env, "webhook_next", {});
  return { sent: claimed.length, results, next: next === null ? null : Number(next) };
}

// ---------- settings API (cookie session; /api/webhooks) ----------

const ID = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(test|rotate|deliveries))?$/;

function events(raw: unknown): string[] {
  if (raw === undefined) return [...WEBHOOK_EVENTS];
  if (!Array.isArray(raw) || !raw.length || raw.some((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))) throw new WebhookError(400, "보낼 이벤트를 하나 이상 골라 주세요.");
  return [...new Set(raw as string[])];
}
function description(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string" || raw.length > 200) throw new WebhookError(400, "설명은 200자까지 쓸 수 있어요.");
  return raw.trim();
}
async function target(env: WebhookEnv, raw: unknown): Promise<string> {
  const checked = await checkTarget(raw, siteHost(env));
  if (!checked.ok) throw new WebhookError(400, checked.error);
  return checked.url;
}

export async function webhookApi(request: Request, env: WebhookEnv, url: URL, who: { ws: string; user: string }): Promise<Response> {
  const path = url.pathname.replace(/\/$/, "").slice("/api/webhooks".length);
  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");
  if (method !== "GET" && origin && origin !== url.origin) return json({ error: "다른 사이트에서 보낸 요청이에요." }, 403);
  const body = async () => {
    const value = await request.json().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new WebhookError(400, "JSON 본문을 읽지 못했어요.");
    return value as Record<string, unknown>;
  };
  try {
    if (path === "" && method === "GET") {
      return json({ webhooks: await rpc(env, "webhook_list", { p_ws: who.ws }), events: WEBHOOK_EVENTS, limit: WEBHOOK_CONFIG.max_endpoints });
    }
    if (path === "" && method === "POST") {
      const input = await body();
      const address = await target(env, input.url);
      const secret = newSecret();
      const made = await rpc<Record<string, unknown>>(env, "webhook_create", {
        p_ws: who.ws, p_user: who.user, p_url: address, p_description: description(input.description), p_events: events(input.events),
        p_secret_enc: await sealSecret(env, secret), p_secret_hint: secretHint(secret), p_limit: WEBHOOK_CONFIG.max_endpoints,
      });
      if (made?.error === "limit") return json({ error: "웹훅은 " + WEBHOOK_CONFIG.max_endpoints + "개까지 만들 수 있어요." }, 409);
      forgetPresence(who.ws);
      return json({ webhook: made, secret }, 201);
    }
    const m = ID.exec(path);
    if (!m) return json({ error: "없는 API예요." }, 404);
    const [, id, action] = m;
    if (!action && method === "PATCH") {
      const input = await body();
      const patch: Record<string, unknown> = {};
      if ("url" in input) patch.url = await target(env, input.url);
      if ("description" in input) patch.description = description(input.description);
      if ("events" in input) patch.events = events(input.events);
      if ("enabled" in input) {
        if (typeof input.enabled !== "boolean") throw new WebhookError(400, "enabled 는 true 나 false 예요.");
        patch.enabled = input.enabled;
      }
      const row = await rpc(env, "webhook_update", { p_ws: who.ws, p_id: id, p_patch: patch });
      if (!row) return json({ error: "없는 웹훅이에요." }, 404);
      forgetPresence(who.ws);
      return json({ webhook: row });
    }
    if (!action && method === "DELETE") {
      const gone = await rpc<boolean>(env, "webhook_delete", { p_ws: who.ws, p_id: id });
      forgetPresence(who.ws);
      return gone ? json({ ok: true }) : json({ error: "없는 웹훅이에요." }, 404);
    }
    if (action === "rotate" && method === "POST") {
      const secret = newSecret();
      const row = await rpc(env, "webhook_update", { p_ws: who.ws, p_id: id, p_patch: { secret_enc: await sealSecret(env, secret), secret_hint: secretHint(secret) } });
      return row ? json({ webhook: row, secret }) : json({ error: "없는 웹훅이에요." }, 404);
    }
    if (action === "deliveries" && method === "GET") {
      return json({ deliveries: await rpc(env, "webhook_log", { p_ws: who.ws, p_id: id, p_limit: 20 }) });
    }
    if (action === "test" && method === "POST") {
      const store = env.WORKSPACE?.get(env.WORKSPACE.idFromName("global:webhooks"));
      if (store?.hit && !(await store.hit("test:" + who.ws, WEBHOOK_CONFIG.test_per_minute, 60))) return json({ error: "테스트는 1분에 " + WEBHOOK_CONFIG.test_per_minute + "번까지 보낼 수 있어요." }, 429);
      const hook = await rpc<{ url: string; secret_enc: string } | null>(env, "webhook_target", { p_ws: who.ws, p_id: id });
      if (!hook) return json({ error: "없는 웹훅이에요." }, 404);
      const pingId = crypto.randomUUID();
      const ping = { id: pingId, type: "ping", version: 1, occurred_at: new Date().toISOString(), attempt: 1, workspace: { id: who.ws }, page: null, changes: ["ping"], actor: { kind: "human" } };
      const sent = await send(env, hook.url, hook.secret_enc, JSON.stringify(ping), pingId, "ping", WEBHOOK_CONFIG.timeout_ms);
      await rpc(env, "webhook_record", { p_ws: who.ws, p_id: id, p_type: "ping", p_ok: sent.ok, p_status: sent.status, p_error: sent.error, p_ms: sent.ms });
      return json(sent);
    }
    return json({ error: "지원하지 않는 방법이에요." }, 405);
  } catch (error) {
    if (error instanceof WebhookError) return json({ error: error.message }, error.status);
    throw error;
  }
}
