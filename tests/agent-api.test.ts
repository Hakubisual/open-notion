import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentToken, ensureAgentSchema, revokeAgentToken } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

const ROOT = join(import.meta.dir, "..");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
const WORKER_SOURCE = assembleWorkerSource();

function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }),
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

let sqlite: Database;
let db: ReturnType<typeof d1>;
let worker: { fetch(request: Request, env: any): Promise<Response> };
let env: any;

async function call(method: string, path: string, options: { token?: string; body?: unknown; markdown?: string; accept?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = "Bearer " + options.token;
  if (options.accept) headers.accept = options.accept;
  let body: string | undefined;
  if (options.markdown !== undefined) { headers["content-type"] = "text/markdown"; body = options.markdown; }
  else if (options.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(options.body); }
  const response = await worker.fetch(new Request("https://notes.test" + path, { method, headers, body }), env);
  const text = await response.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

async function token(scopes: string[], name = "Claude Code") {
  return (await createAgentToken(db, { name, scopes })).token;
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  db = d1(sqlite);
  worker = new Function(WORKER_SOURCE)();
  env = { DB: db, GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  await call("GET", "/api/v1/me");
  await ensureAgentSchema(db);
});

describe("acard-agents migration", () => {
  test("the migration file matches the runtime schema and can run twice on live data", async () => {
    const sql = read("migrations/acard-agents.sql");
    const statements = sql.split("\n").filter((line) => line.trim() && !line.trim().startsWith("--"));
    for (const statement of statements) expect(statement).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS /);
    const fresh = new Database(":memory:");
    fresh.exec(sql);
    await ensureAgentSchema(d1(fresh));
    fresh.exec("INSERT INTO agent_grants (id, client_name, scopes, created) VALUES ('g1', 'Cursor', 'read', 1)");
    fresh.exec(sql);
    await ensureAgentSchema(d1(fresh));
    expect(fresh.query("SELECT client_name FROM agent_grants").all()).toEqual([{ client_name: "Cursor" }]);
    const tables = (name: Database) => (name.query("SELECT name, sql FROM sqlite_master WHERE name LIKE 'agent_%' OR name = 'page_tags' ORDER BY name").all() as any[]).map((row) => row.name + "|" + String(row.sql).replace(/\s+/g, " ").replace(" IF NOT EXISTS", ""));
    const runtimeOnly = new Database(":memory:");
    await ensureAgentSchema(d1(runtimeOnly));
    expect(tables(fresh)).toEqual(tables(runtimeOnly));
  });
});

describe("agent tokens are separate from the human gate", () => {
  test("anonymous, malformed and gate-cookie-only requests get 401 with an OAuth challenge", async () => {
    const anonymous = await call("GET", "/api/v1/pages");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource");
    expect((await call("GET", "/api/v1/pages", { token: "acard_not-a-real-token" })).status).toBe(401);
    expect((await call("GET", "/api/v1/pages", { token: "something-else" })).status).toBe(401);
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const cookieOnly = await worker.fetch(new Request("https://notes.test/api/v1/pages", { headers: { cookie: "dn_auth=" + expires + "." + mac } }), env);
    expect(cookieOnly.status).toBe(401);
  });

  test("tokens are stored only as hashes and a revoked token stops working", async () => {
    const created = await createAgentToken(db, { name: "Codex", scopes: ["read", "write"] });
    const stored = sqlite.query("SELECT * FROM agent_tokens").get() as any;
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(stored.hash).toHaveLength(64);
    expect((await call("GET", "/api/v1/me", { token: created.token })).data).toEqual({ agent: "Codex", via: "token", scopes: ["read", "write"] });
    expect(await revokeAgentToken(db, created.record.id)).toBe(true);
    expect((await call("GET", "/api/v1/me", { token: created.token })).status).toBe(401);
  });

  test("a read-only token cannot write", async () => {
    const reader = await token(["read"], "Reader");
    expect((await call("GET", "/api/v1/pages", { token: reader })).status).toBe(200);
    const denied = await call("POST", "/api/v1/pages", { token: reader, markdown: "---\ntitle: X\n---\nhi" });
    expect(denied.status).toBe(403);
    expect(sqlite.query("SELECT COUNT(*) AS c FROM pages WHERE title = 'X'").get()).toEqual({ c: 0 });
  });
});

describe("markdown pages through /api/v1", () => {
  test("create from frontmatter, edit, read back as markdown with the author", async () => {
    const writer = await token(["read", "write"], "Claude Code");
    sqlite.exec("INSERT INTO pages (slug, title, parent, ord, kind, updated, source) VALUES ('work', 'Work', NULL, 0, 'note', 1, 'editor')");
    const created = await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: 작업 기록\nparent: work\nicon: 🤖\ntags: [log, agent]\n---\n# 오늘\n\n- [ ] 할 일\n" });
    expect(created.status).toBe(201);
    const slug = created.data.slug;
    expect(created.data.parent).toBe("work");

    const edited = await call("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { token: writer, body: { markdown: "---\ntitle: 작업 기록 2\ntags: [log]\n---\n# 오늘\n\n- [x] 할 일\n" } });
    expect(edited.status).toBe(200);

    const page = (await call("GET", "/api/v1/pages/" + encodeURIComponent(slug), { token: writer })).data;
    expect(page.title).toBe("작업 기록 2");
    expect(page.parent).toBe("work");
    expect(page.icon).toBe("🤖");
    expect(page.tags).toEqual(["log"]);
    expect(page.authors.map((a: any) => [a.agent, a.action])).toEqual([["Claude Code", "update"], ["Claude Code", "create"]]);
    expect(page.markdown).toContain("- [x] 할 일");

    const raw = await call("GET", "/api/v1/pages/" + encodeURIComponent(slug), { token: writer, accept: "text/markdown" });
    expect(raw.headers.get("content-type")).toContain("text/markdown");
    expect(raw.data).toStartWith("---\ntitle: 작업 기록 2\n");
    expect(raw.data).toContain("last_author: Claude Code");

    const history = sqlite.query("SELECT COUNT(*) AS c FROM editor_history WHERE page = ?").get(slug) as any;
    expect(history.c).toBe(1);
  });

  test("a stale expectedUpdated is rejected with 409 and keeps the newer content", async () => {
    const writer = await token(["read", "write"]);
    const slug = (await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: Shared\n---\nv1\n" })).data.slug;
    const readAt = (await call("GET", "/api/v1/pages/" + slug, { token: writer })).data.updated;
    sqlite.query("UPDATE pages SET updated = ? WHERE slug = ?").run(readAt + 5000, slug);
    sqlite.query("UPDATE blocks SET text = 'human edit' WHERE page = ?").run(slug);
    const stale = await call("PUT", "/api/v1/pages/" + slug, { token: writer, body: { markdown: "v2 from agent", expectedUpdated: readAt } });
    expect(stale.status).toBe(409);
    const texts = (sqlite.query("SELECT text FROM blocks WHERE page = ?").all(slug) as any[]).map((row) => row.text);
    expect(texts).toEqual(["human edit"]);
    const fresh = await call("PUT", "/api/v1/pages/" + slug, { token: writer, body: { markdown: "v3 from agent", expectedUpdated: readAt + 5000 } });
    expect(fresh.status).toBe(200);
  });

  test("unknown parent is rejected and nothing is created", async () => {
    const writer = await token(["read", "write"]);
    const result = await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: Orphan\nparent: nope\n---\nx" });
    expect(result.status).toBe(404);
    expect(sqlite.query("SELECT COUNT(*) AS c FROM pages WHERE title = 'Orphan'").get()).toEqual({ c: 0 });
  });

  test("append keeps existing blocks and adds new ones at the end", async () => {
    const writer = await token(["read", "write"], "OMO");
    const slug = (await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: Log\n---\n첫 줄\n" })).data.slug;
    const appended = await call("POST", "/api/v1/pages/" + slug + "/append", { token: writer, markdown: "둘째 줄\n\n셋째 줄\n" });
    expect(appended.data.appended).toBe(2);
    const texts = (sqlite.query("SELECT text FROM blocks WHERE page = ? ORDER BY ord").all(slug) as any[]).map((row) => row.text);
    expect(texts).toEqual(["첫 줄", "둘째 줄", "셋째 줄"]);
  });

  test("search and list find pages; decision callouts are listed", async () => {
    const writer = await token(["read", "write"]);
    await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: 배포 질문\n---\n> [!decision] 주인님 결정 필요: 오늘 배포할까요?\n" });
    await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: 그냥 메모\n---\n> [!note] 메모\n" });
    const found = (await call("GET", "/api/v1/pages?q=" + encodeURIComponent("배포"), { token: writer })).data.pages;
    expect(found.map((p: any) => p.title)).toEqual(["배포 질문"]);
    const decisions = (await call("GET", "/api/v1/decisions", { token: writer })).data.decisions;
    expect(decisions.map((d: any) => d.title)).toEqual(["배포 질문"]);
    expect(decisions[0].text).toContain("오늘 배포할까요?");
  });
});

describe("human page view shows who wrote last", () => {
  async function view(slug: string) {
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const response = await worker.fetch(new Request("https://notes.test/" + slug + "/", { headers: { cookie: "dn_auth=" + expires + "." + mac } }), env);
    const html = await response.text();
    return /<span class="who">[\s\S]*?<\/span>([^<]+)<\/span>/.exec(html)?.[1] ?? "";
  }

  test("an agent write names the agent; a later human edit names the owner again", async () => {
    const writer = await token(["read", "write"], "Claude Code");
    const slug = (await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: Byline\n---\nhello\n" })).data.slug;
    expect(await view(slug)).toBe("Claude Code가 씀");
    sqlite.query("UPDATE pages SET updated = ? WHERE slug = ?").run(Date.now() + 60_000, slug);
    expect(await view(slug)).toBe("오너가 씀");
  });
});

describe("database rows through /api/v1", () => {
  test("add and update a row with attribution, using property names", async () => {
    const writer = await token(["read", "write"], "Codex");
    const cookieWorker = worker;
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const madeDb = await cookieWorker.fetch(new Request("https://notes.test/api/db", { method: "POST", headers: { cookie: "dn_auth=" + expires + "." + mac, "content-type": "application/json" }, body: JSON.stringify({ title: "Tasks" }) }), env);
    const database = await madeDb.json();

    const list = (await call("GET", "/api/v1/databases", { token: writer })).data.databases;
    expect(list.map((d: any) => d.slug)).toContain(database.slug);
    const schema = (await call("GET", "/api/v1/databases/" + database.slug + "/rows", { token: writer })).data;
    const title = schema.properties.find((p: any) => p.type === "title");

    const added = await call("POST", "/api/v1/databases/" + database.slug + "/rows", { token: writer, body: { props: { [title.name]: "에이전트 행" } } });
    expect(added.status).toBe(201);
    const rowId = added.data.row.id;
    const updated = await call("PATCH", "/api/v1/databases/" + database.slug + "/rows/" + rowId, { token: writer, body: { props: { [title.id]: "고친 행" } } });
    expect(updated.status).toBe(200);
    const rows = (await call("GET", "/api/v1/databases/" + database.slug + "/rows", { token: writer })).data.rows;
    expect(rows.map((r: any) => r.title)).toEqual(["고친 행"]);
    const activity = (sqlite.query("SELECT agent, action FROM agent_activity WHERE page = ? ORDER BY created").all(added.data.row.page) as any[]);
    expect(activity.map((a) => a.action)).toEqual(["row-add", "row-update"]);
    expect(activity.every((a) => a.agent === "Codex")).toBe(true);

    const missing = await call("PATCH", "/api/v1/databases/" + database.slug + "/rows/nope", { token: writer, body: { props: { [title.id]: "x" } } });
    expect(missing.status).toBe(404);
  });
});
