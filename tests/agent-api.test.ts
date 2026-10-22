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
let worker: {
  fetch(request: Request, env: any): Promise<Response>;
  acardHost: {
    principalFromToken(env: any, token: string): Promise<any>;
    run(env: any, principal: any, operation: string, input: Record<string, unknown>): Promise<any>;
  };
};
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

async function gateCookie() {
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "dn_auth=" + expires + "." + mac;
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

// Owner pick 2026-10-20: the developer-facing p50/p95 table sits under a closed "고급" and is fetched only when opened.
describe("settings > agent connections", () => {
  test("the response-time table is folded under a closed 고급 and not loaded until it opens", () => {
    const html = read("assets/agents.html");
    const details = /<details\b([^>]*)>([\s\S]*?)<\/details>/.exec(html);
    expect(details).not.toBeNull();
    expect(details![1]).not.toMatch(/\bopen\b/);
    expect(details![2]).toMatch(/<summary[^>]*>고급<\/summary>/);
    expect(details![2]).toContain('id="latency"');
    expect(html.replace(details![0], "")).not.toContain("latency");
    const js = read("assets/agents.js");
    const toggle = js.indexOf('addEventListener("toggle"');
    expect(toggle).toBeGreaterThan(0);
    expect(js.match(/loadLatency\(\);/g)?.length).toBe(1);
    expect(js.indexOf("loadLatency();")).toBeGreaterThan(toggle);
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

  test("block style round trips through the page API with acard_meta: 1, and stays text without it (notion-parity)", async () => {
    const writer = await token(["read", "write"]);
    const md = '---\ntitle: 스타일\nacard_meta: 1\n---\n> [!note] 메모\n<!--acard {"color":"yellow_background","icon":"🔥"}-->\n\n## 접는 제목\n<!--acard {"toggle":true,"open":false}-->\n\n  안쪽\n\n- [embed] https://x.github.io/w\n<!--acard {"height":480}-->\n';
    const slug = (await call("POST", "/api/v1/pages", { token: writer, markdown: md })).data.slug;
    const stored = sqlite.query("SELECT type, meta FROM blocks WHERE page = ? ORDER BY ord").all(slug).map((r: any) => [r.type, JSON.parse(r.meta || "null")]);
    expect(stored).toEqual([["callout", { tone: "note", color: "yellow_background", icon: "🔥" }], ["heading2", { toggle: true, open: false }], ["paragraph", null], ["embed", { url: "https://x.github.io/w", height: 480 }]]);
    const raw = (await call("GET", "/api/v1/pages/" + slug, { token: writer, accept: "text/markdown" })).data;
    expect(raw).toContain("acard_meta: 1");
    expect(raw).toContain('> [!note] 메모\n<!--acard {"color":"yellow_background","icon":"🔥"}-->');
    expect(raw).toContain('<!--acard {"height":480}-->');
    const plain = (await call("POST", "/api/v1/pages", { token: writer, markdown: '---\ntitle: 평범\n---\nhello\n<!--acard {"color":"red"}-->\n' })).data.slug;
    expect(sqlite.query("SELECT text, meta FROM blocks WHERE page = ?").all(plain).map((r: any) => [r.text, r.meta])).toEqual([['hello <!--acard {"color":"red"}-->', null]]);
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

  test("a person's edit after the agent's read survives an update without expectedUpdated (409), and the right version succeeds (#25)", async () => {
    const writer = await token(["read", "write"]);
    const slug = (await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: Plan\n---\none\n\ntwo\n\nthree\n" })).data.slug;
    // The agent wrote a minute ago, so the person's save below is later without waiting on the clock.
    sqlite.query("UPDATE pages SET updated = updated - 60000 WHERE slug = ?").run(slug);
    sqlite.query("UPDATE agent_activity SET created = created - 60000 WHERE page = ?").run(slug);
    const read = await call("GET", "/api/v1/pages/" + slug, { token: writer });
    expect(read.headers.get("etag")).toBe('"' + read.data.updated + '"');
    // The person changes block 3 in the editor (the editor's own save route).
    const editor = (await worker.fetch(new Request("https://notes.test/api/page/" + slug, { headers: { cookie: await gateCookie() } }), env).then((r) => r.json())) as any;
    editor.blocks[2].text = "사람이 고친 셋째 문단";
    if (editor.blocks[2].meta) delete editor.blocks[2].meta.richText;
    const saved = await worker.fetch(new Request("https://notes.test/api/page/" + slug, { method: "PUT", headers: { cookie: await gateCookie(), "content-type": "application/json" }, body: JSON.stringify({ title: "Plan", blocks: editor.blocks, base_updated: editor.page.updated }) }), env);
    expect(saved.status).toBe(200);
    const texts = () => (sqlite.query("SELECT text FROM blocks WHERE page = ? ORDER BY ord").all(slug) as any[]).map((row) => row.text);

    const blind = await call("PUT", "/api/v1/pages/" + slug, { token: writer, body: { markdown: "agent rewrite" } });
    expect(blind.status).toBe(409);
    expect(blind.data.error).toContain("다시 읽고");
    const stale = await call("PUT", "/api/v1/pages/" + slug, { token: writer, body: { markdown: "agent rewrite", expectedUpdated: read.data.updated } });
    expect(stale.status).toBe(409);
    const staleIfMatch = await worker.fetch(new Request("https://notes.test/api/v1/pages/" + slug, { method: "PATCH", headers: { authorization: "Bearer " + writer, "content-type": "text/markdown", "if-match": read.headers.get("etag")! }, body: "agent rewrite" }), env);
    expect(staleIfMatch.status).toBe(409);
    expect(texts()).toEqual(["one", "two", "사람이 고친 셋째 문단"]);

    const fresh = await call("GET", "/api/v1/pages/" + slug, { token: writer });
    const merged = await worker.fetch(new Request("https://notes.test/api/v1/pages/" + slug, { method: "PUT", headers: { authorization: "Bearer " + writer, "content-type": "text/markdown", "if-match": fresh.headers.get("etag")! }, body: "one\n\ntwo (agent)\n\n사람이 고친 셋째 문단\n" }), env);
    expect(merged.status).toBe(200);
    expect(texts()).toEqual(["one", "two (agent)", "사람이 고친 셋째 문단"]);
    // The agent wrote last again, so its next blind update is allowed like before.
    expect((await call("PUT", "/api/v1/pages/" + slug, { token: writer, body: { markdown: "one\n\ntwo (agent 2)\n\n사람이 고친 셋째 문단\n" } })).status).toBe(200);
  });

  test("a page no agent ever wrote is not overwritten without expectedUpdated", async () => {
    const writer = await token(["read", "write"]);
    sqlite.exec("INSERT INTO pages (slug, title, parent, ord, kind, updated, source) VALUES ('mine', 'Mine', NULL, 0, 'note', 5, 'editor')");
    sqlite.exec("INSERT INTO blocks (page, id, ord, type, text, checked, indent) VALUES ('mine', 'b1', 0, 'paragraph', 'owner text', 0, 0)");
    expect((await call("PUT", "/api/v1/pages/mine", { token: writer, body: { markdown: "agent text" } })).status).toBe(409);
    expect((await call("PUT", "/api/v1/pages/mine", { token: writer, body: { markdown: "agent text", expectedUpdated: 5 } })).status).toBe(200);
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

  // #39: a page address in another form goes to the page; a page that is not in this workspace says why instead of "Not Found".
  test("the reader follows an NFD or double-encoded address and explains a page that is not in this workspace", async () => {
    const writer = await token(["read", "write"], "Codex");
    const slug = (await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: 샘플프로젝트 구성도\n---\n본문\n" })).data.slug;
    const open = async (path: string) => worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: await gateCookie(), accept: "text/html" }, redirect: "manual" }), env);
    for (const path of ["/" + encodeURIComponent(slug.normalize("NFD")) + "/", "/" + encodeURIComponent(encodeURIComponent(slug)) + "/"]) {
      const moved = await open(path);
      expect(moved.status).toBe(301);
      expect(moved.headers.get("location")).toBe("/" + encodeURIComponent(slug) + "/");
    }
    const missing = await open("/" + encodeURIComponent("다른-워크스페이스-페이지") + "/");
    expect(missing.status).toBe(404);
    const html = await missing.text();
    expect(html).toContain('data-missing="다른-워크스페이스-페이지"');
    expect(html).toContain('href="/settings/agents/"');
  });

  // #44: the database pooler ran out of connections and the reader drew the static "없는 문서예요" 404 for a page that exists.
  test("a database error on a page opens a retrying 503 page, never a not-found page", async () => {
    const writer = await token(["read", "write"], "Codex");
    const slug = (await call("POST", "/api/v1/pages", { token: writer, markdown: "---\ntitle: 모델링 구분표\n---\n본문\n" })).data.slug;
    const busy = () => { throw Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"), { code: "XX000" }); };
    const open = async () => worker.fetch(new Request("https://notes.test/" + encodeURIComponent(slug) + "/", { headers: { cookie: await gateCookie(), accept: "text/html" } }), env);
    const prepare = db.prepare;
    env.ASSETS = { fetch: async () => new Response("<h1>없는 문서예요</h1>", { status: 404, headers: { "content-type": "text/html" } }) };
    db.prepare = (sql: string) => (/FROM editor_trash|FROM pages/.test(sql) ? { bind: () => ({ first: busy, all: busy, run: busy }), first: busy, all: busy, run: busy } : prepare(sql)) as any;
    const down = await open();
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBeTruthy();
    const html = await down.text();
    expect(html).not.toContain("없는 문서");
    expect(html).not.toContain("없는 페이지");
    expect(html).toContain("잠시 연결이 몰렸어요");
    expect(html).toContain("data-retry");
    db.prepare = prepare;
    const up = await open();
    expect(up.status).toBe(200);
    expect(await up.text()).toContain("모델링 구분표");
  });
});

describe("agent target parent permissions (#89)", () => {
  async function owner(method: string, path: string, body: unknown) {
    const response = await worker.fetch(new Request("https://notes.test" + path, {
      method, headers: { cookie: await gateCookie(), "content-type": "application/json" }, body: JSON.stringify(body),
    }), env);
    expect(response.ok).toBe(true);
    return response.json();
  }

  for (const transport of ["REST", "MCP host"] as const) {
    for (const role of ["none", "read"] as const) for (const operation of ["create", "move"] as const) {
      test(transport + " " + operation + " refuses a " + role + " target parent before writing", async () => {
        const made = await createAgentToken(db, { name: "Scoped writer", scopes: ["read", "write"] });
        const writer = made.token;
        await owner("POST", "/api/db", { title: "Restricted", slug: "restricted", page: true });
        expect((await call("POST", "/api/v1/pages", { token: writer, body: { slug: "nested", parent: "restricted", markdown: "Original child" } })).status).toBe(201);
        expect((await call("POST", "/api/v1/pages", { token: writer, body: { slug: "movable", markdown: "Original content" } })).status).toBe(201);
        await owner("PUT", "/api/page/restricted/access/agents", { token: made.record.id, level: role });
        const principal = await worker.acardHost.principalFromToken(env, writer);
        const snapshot = () => ({
          pages: sqlite.query("SELECT * FROM pages ORDER BY slug").all(),
          blocks: sqlite.query("SELECT * FROM blocks ORDER BY page, ord").all(),
          activity: sqlite.query("SELECT * FROM agent_activity ORDER BY id").all(),
        });
        const before = snapshot();
        for (const parent of ["restricted", "nested"]) for (const frontmatter of [false, true]) {
          const input = { slug: operation === "create" ? "new-child" : "movable", markdown: frontmatter ? "---\nparent: " + parent + "\n---\nChanged" : "Changed", ...(frontmatter ? {} : { parent }) };
          if (transport === "REST") {
            const result = await call(operation === "create" ? "POST" : "PATCH", operation === "create" ? "/api/v1/pages" : "/api/v1/pages/movable", { token: writer, body: input });
            expect(result.status).toBe(403);
          } else {
            await expect(worker.acardHost.run(env, principal, operation === "create" ? "createPage" : "updatePage", input)).rejects.toMatchObject({ status: 403 });
          }
          expect(snapshot()).toEqual(before);
        }
        await owner("PUT", "/api/page/restricted/access/agents", { token: made.record.id, level: "write" });
        const allowed = await call(operation === "create" ? "POST" : "PATCH", operation === "create" ? "/api/v1/pages" : "/api/v1/pages/movable", { token: writer, body: { slug: "new-child", parent: "nested", markdown: "Allowed" } });
        expect(allowed.status).toBe(operation === "create" ? 201 : 200);
        expect(allowed.data.parent).toBe("nested");
      });
    }

    test(transport + " database lists hide denied databases and retain readable databases", async () => {
      const made = await createAgentToken(db, { name: "Scoped reader", scopes: ["read", "write"] });
      for (const slug of ["visible", "readonly", "hidden"]) await owner("POST", "/api/db", { title: slug, slug, page: true });
      await owner("POST", "/api/db", { title: "nested-hidden", slug: "nested-hidden", parent: "hidden", page: true });
      await owner("PUT", "/api/page/hidden/access/agents", { token: made.record.id, level: "none" });
      await owner("PUT", "/api/page/readonly/access/agents", { token: made.record.id, level: "read" });
      const result = transport === "REST"
        ? (await call("GET", "/api/v1/databases", { token: made.token })).data
        : await worker.acardHost.run(env, await worker.acardHost.principalFromToken(env, made.token), "listDatabases", {});
      expect(result.databases.map((d: any) => d.slug)).toEqual(["readonly", "visible"]);
      const unrestricted = await token(["read", "write"], "Unrestricted");
      expect((await call("GET", "/api/v1/databases", { token: unrestricted })).data.databases.map((d: any) => d.slug)).toEqual(["hidden", "nested-hidden", "readonly", "visible"]);
    });
  }
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

  test("an agent's row update on a two-way relation shows on the other database too (notion-parity-5 C2)", async () => {
    const writer = await token(["read", "write"], "Codex");
    const cookie = await gateCookie();
    const owner = async (method: string, path: string, body?: unknown) => (await worker.fetch(new Request("https://notes.test" + path, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env)).json();
    const trips = await owner("POST", "/api/db", { title: "여행" });
    const plans = await owner("POST", "/api/db", { title: "일정" });
    const rel = await owner("POST", "/api/db/" + plans.slug + "/properties", { name: "여행", type: "relation", config: { database: trips.slug, synced: true }, pairName: "일정" });
    const trip = (await owner("POST", "/api/db/" + trips.slug + "/rows", { props: {} })).row;
    const plan = (await owner("POST", "/api/db/" + plans.slug + "/rows", { props: {} })).row;
    const updated = await call("PATCH", "/api/v1/databases/" + plans.slug + "/rows/" + plan.id, { token: writer, body: { props: { [rel.property.id]: [trip.id] } } });
    expect(updated.status).toBe(200);
    const tripRow = (await owner("GET", "/api/db/" + trips.slug)).rows.find((r: any) => r.id === trip.id);
    expect(tripRow.props[rel.pair.id]).toEqual([plan.id]);
    const bad = await call("PATCH", "/api/v1/databases/" + plans.slug + "/rows/" + plan.id, { token: writer, body: { props: { [rel.property.id]: ["no-such-row"] } } });
    expect(bad.status).toBe(400);
    expect((await owner("GET", "/api/db/" + trips.slug)).rows.find((r: any) => r.id === trip.id).props[rel.pair.id]).toEqual([plan.id]);
  });

  test("rows carry formula values, and a style() result is its plain text", async () => {
    const writer = await token(["read", "write"], "Codex");
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const cookie = "dn_auth=" + expires + "." + mac;
    const post = (path: string, body: unknown) => worker.fetch(new Request("https://notes.test/api" + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((r: Response) => r.json());
    const database = await post("/db", { title: "Deadlines" });
    const due = (await post("/db/" + database.slug + "/properties", { name: "마감", type: "date" })).property;
    const state = (await post("/db/" + database.slug + "/properties", { name: "상태", type: "formula", config: { expression: 'if(prop("마감") < now(), "지남".style("red", "b"), "남음")' } })).property;
    const schema = (await call("GET", "/api/v1/databases/" + database.slug + "/rows", { token: writer })).data;
    const title = schema.properties.find((p: any) => p.type === "title");
    await call("POST", "/api/v1/databases/" + database.slug + "/rows", { token: writer, body: { props: { [title.id]: "어제", [due.id]: "2020-01-01" } } });
    await call("POST", "/api/v1/databases/" + database.slug + "/rows", { token: writer, body: { props: { [title.id]: "내일", [due.id]: "2999-01-01" } } });
    const rows = (await call("GET", "/api/v1/databases/" + database.slug + "/rows", { token: writer })).data.rows;
    const byTitle = Object.fromEntries(rows.map((r: any) => [r.title, r.props[state.id]]));
    expect(byTitle).toEqual({ 어제: "지남", 내일: "남음" });
  });
});
