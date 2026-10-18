import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleWorkerSource } from "./assemble-worker";

const ROOT = join(import.meta.dir, "..");
export const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
const WORKER_SOURCE = assembleWorkerSource();
// 모듈 전역(schemaReady)이 테스트 사이에 새지 않도록 매번 새로 평가한다.
function loadWorker() {
  return new Function(WORKER_SOURCE)() as { fetch(request: Request, env: any): Promise<Response> };
}

// 실제 SQLite(bun:sqlite)를 D1 인터페이스로 감싼다. 쿼리는 그대로 실행하고 batch 는 하나의 트랜잭션이다.
function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => {
      const result = sqlite.query(sql).run(...(params as any[]));
      return { success: true, meta: { changes: result.changes } };
    },
    all: async () => ({ results: sqlite.query(sql).all(...(params as any[])) }),
    first: async () => sqlite.query(sql).get(...(params as any[])) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const item of list) out.push(await item.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const PASSWORD = "pw";
const SECRET = "secret";

export async function cookie() {
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "dn_auth=" + expires + "." + hex;
}

export function setup(options: { seed?: unknown; notesSeed?: unknown; assets?: Record<string, string>; assetFetch?: (request: Request) => Promise<Response>; config?: boolean; sqlite?: Database; worker?: ReturnType<typeof loadWorker> } = {}) {
  const sqlite = options.sqlite ?? new Database(":memory:");
  const worker = options.worker ?? loadWorker();
  const assets = {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/db-seed.json" && options.seed !== undefined) {
        return new Response(JSON.stringify(options.seed), { headers: { "content-type": "application/json" } });
      }
      if (path === "/notes-seed.json" && options.notesSeed !== undefined) {
        return new Response(JSON.stringify(options.notesSeed), { headers: { "content-type": "application/json", etag: "test-notes-seed" } });
      }
      if (options.assets && Object.prototype.hasOwnProperty.call(options.assets, path)) {
        return new Response(options.assets[path], { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (options.assetFetch) return await options.assetFetch(request);
      return new Response("not found", { status: 404 });
    },
  };
  const env: any = { DB: d1(sqlite), ASSETS: assets };
  if (options.config !== false) {
    env.GATE_PASSWORD = PASSWORD;
    env.GATE_SECRET = SECRET;
  }
  let auth = "";
  const call = async (method: string, path: string, body?: unknown, anonymous = false) => {
    if (!auth) auth = await cookie();
    const headers: Record<string, string> = {};
    if (!anonymous) headers.cookie = auth;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await worker.fetch(new Request("https://notes.test" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const text = await response.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
  return { sqlite, call, worker, env };
}
