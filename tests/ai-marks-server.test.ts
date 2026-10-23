import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

const WORKER_SOURCE = assembleWorkerSource();
let sqlite: Database, db: any, worker: any, env: any, writer: string;
const agent = { name: "Claude Code", via: "token" as const, scopes: ["read", "write"] };

function d1(lite: Database) {
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: lite.query(sql).run(...(params as any[])).changes } }),
    all: async () => ({ results: lite.query(sql).all(...(params as any[])) }),
    first: async () => lite.query(sql).get(...(params as any[])) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => {
      lite.exec("BEGIN");
      try { const out = []; for (const item of list) out.push(await item.run()); lite.exec("COMMIT"); return out; }
      catch (error) { lite.exec("ROLLBACK"); throw error; }
    },
  };
}
async function cookie() {
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "dn_auth=" + expires + "." + mac;
}
async function send(method: string, path: string, body?: unknown, auth: "agent" | "person" = "agent") {
  const headers: Record<string, string> = auth === "agent" ? { authorization: "Bearer " + writer } : { cookie: await cookie() };
  if (body !== undefined) headers["content-type"] = typeof body === "string" ? "text/markdown" : "application/json";
  const res = await worker.fetch(new Request("https://notes.test" + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env);
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}
const rows = (slug: string) => (sqlite.query("SELECT id, type, text, meta FROM blocks WHERE page = ? ORDER BY ord").all(slug) as any[])
  .map((r) => ({ id: r.id, type: r.type, text: r.text, meta: r.meta ? JSON.parse(r.meta) : null }));
const version = async (slug: string) => (await send("GET", "/api/v1/pages/" + encodeURIComponent(slug))).data.updated;

// A person writes a report page and marks it in the editor: the figure sentence locked, the notes callout as reference,
// and the words "12억 원" inside the summary locked.
async function markedPage() {
  const slug = (await send("POST", "/api/v1/pages", "---\ntitle: 분기 보고\n---\n# 분기 보고\n\n요약 문단은 매출 12억 원을 적는다.\n\n3분기 매출은 12억 원이었다.\n\n> [!note] 자료: 9월 매출 4억, 8월 4억, 7월 4억\n\n초안 문단\n")).data.slug;
  const page = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data;
  const [h, summary, figure, notes, draft] = page.blocks;
  summary.meta = { ...(summary.meta || {}), richText: [{ text: "요약 문단은 매출 " }, { text: "12억 원", ai: "lock" }, { text: "을 적는다." }] };
  figure.meta = { ...(figure.meta || {}), ai: "lock" };
  notes.meta = { ...(notes.meta || {}), ai: "ref" };
  const saved = await send("PUT", "/api/page/" + encodeURIComponent(slug), { title: "분기 보고", blocks: [h, summary, figure, notes, draft], base_updated: page.page.updated }, "person");
  expect(saved.status).toBe(200);
  return { slug, ids: { h: h.id, summary: summary.id, figure: figure.id, notes: notes.id, draft: draft.id } };
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  db = d1(sqlite);
  worker = new Function(WORKER_SOURCE)();
  env = { DB: db, GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  await send("GET", "/api/v1/me");
  await ensureAgentSchema(db);
  writer = (await createAgentToken(db, { name: agent.name, scopes: agent.scopes })).token;
});

describe("AI marks on the server (acard-human-edit)", () => {
  test("the person's marks are stored as block meta", async () => {
    const { slug, ids } = await markedPage();
    const stored = rows(slug);
    expect(stored.find((r) => r.id === ids.figure)!.meta.ai).toBe("lock");
    expect(stored.find((r) => r.id === ids.notes)!.meta.ai).toBe("ref");
    expect(stored.find((r) => r.id === ids.summary)!.meta.richText[1]).toEqual({ text: "12억 원", ai: "lock" });
  });

  test("an agent update_page that rewrites everything leaves locked, ref and locked-piece blocks byte-identical and says so", async () => {
    const { slug, ids } = await markedPage();
    const before = rows(slug);
    const res = await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "# 분기 보고\n\n요약: 매출이 15억 원으로 늘었다.\n\n3분기 매출은 15억 원이었다.\n\n> [!note] 자료 정리함\n\n새 초안 문단\n", expectedUpdated: await version(slug) });
    expect(res.status).toBe(200);
    expect(res.data.locked.sort()).toEqual([ids.summary, ids.figure, ids.notes].sort());
    const after = rows(slug);
    for (const id of [ids.summary, ids.figure, ids.notes]) expect(after.find((r) => r.id === id)).toEqual(before.find((r) => r.id === id));
    expect(after.find((r) => r.id === ids.draft)!.text).toBe("새 초안 문단");
  });

  test("an agent cannot drop a locked block or add its own marks through markdown", async () => {
    const { slug, ids } = await markedPage();
    const res = await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "---\nacard_meta: 1\n---\n# 분기 보고\n\n새 글\n<!--acard {\"ai\":\"lock\"}-->\n", expectedUpdated: await version(slug) });
    expect(res.status).toBe(200);
    const after = rows(slug);
    expect(after.map((r) => r.id)).toContain(ids.figure);
    expect(after.map((r) => r.id)).toContain(ids.notes);
    const made = after.find((r) => r.text === "새 글")!;
    expect(made.meta?.ai).toBeUndefined();
  });

  test("REST update_block / delete_block / patch_block on a locked block are refused with 423 and nothing changes", async () => {
    const { slug, ids } = await markedPage();
    const before = rows(slug);
    const path = "/api/v1/pages/" + encodeURIComponent(slug) + "/blocks/" + encodeURIComponent(ids.figure);
    const upd = await send("PATCH", path, { markdown: "3분기 매출은 99억 원이었다.", expected_version: await version(slug) });
    expect(upd.status).toBe(423);
    expect(String(upd.data.error)).toContain(ids.figure);
    const del = await send("DELETE", path, { expected_version: await version(slug) });
    expect(del.status).toBe(423);
    const ref = await send("PATCH", "/api/v1/pages/" + encodeURIComponent(slug) + "/blocks/" + encodeURIComponent(ids.notes), { markdown: "자료 바꿈", expected_version: await version(slug) });
    expect(ref.status).toBe(423);
    expect(rows(slug)).toEqual(before);
    const free = await send("PATCH", "/api/v1/pages/" + encodeURIComponent(slug) + "/blocks/" + encodeURIComponent(ids.draft), { markdown: "고쳐도 되는 문단", expected_version: await version(slug) });
    expect(free.status).toBe(200);
  });

  test("update_block on a block with a locked piece is kept when the piece survives and restored when it does not", async () => {
    const { slug, ids } = await markedPage();
    const path = "/api/v1/pages/" + encodeURIComponent(slug) + "/blocks/" + encodeURIComponent(ids.summary);
    expect((await send("PATCH", path, { markdown: "이번 분기 매출은 12억 원이다.", expected_version: await version(slug) })).status).toBe(200);
    let summary = rows(slug).find((r) => r.id === ids.summary)!;
    expect(summary.text).toBe("이번 분기 매출은 12억 원이다.");
    const res = await send("PATCH", path, { markdown: "매출은 15억 원이다.", expected_version: await version(slug) });
    expect(res.status).toBe(200);
    expect(res.data.locked).toEqual([ids.summary]);
    summary = rows(slug).find((r) => r.id === ids.summary)!;
    expect(summary.text).toBe("이번 분기 매출은 12억 원이다.");
  });

  test("MCP read_blocks shows the marks; MCP update_block on the locked block fails and the stored block is unchanged", async () => {
    const { slug, ids } = await markedPage();
    const server = createAcardMcpServer(async (operation, input) => {
      try { return await worker.acardHost.run(env, agent, operation, input); }
      catch (error: any) { throw new OperationFailure(error.message, error.status); }
    }, "test", worker.acardHost.mcpTools);
    const client = new Client({ name: "marks-test", version: "test" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    try {
      const read = JSON.parse(((await client.callTool({ name: "read_blocks", arguments: { page: slug } })).content as any)[0].text);
      const byId = new Map(read.blocks.map((x: any) => [x.id, x]));
      expect((byId.get(ids.figure) as any).ai).toBe("lock");
      expect((byId.get(ids.notes) as any).ai).toBe("ref");
      expect((byId.get(ids.summary) as any).locked_text).toEqual(["12억 원"]);
      expect((byId.get(ids.draft) as any).ai).toBeUndefined();
      const before = rows(slug);
      const res = await client.callTool({ name: "update_block", arguments: { page: slug, block_id: ids.figure, markdown: "바꿈", expected_version: read.version } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("고정");
      expect(rows(slug)).toEqual(before);
    } finally { await client.close(); await server.close(); }
  });

  test("a person's own edit of a locked block is never blocked", async () => {
    const { slug, ids } = await markedPage();
    const page = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data;
    const figure = page.blocks.find((x: any) => x.id === ids.figure);
    figure.text = "3분기 매출은 12억 3천만 원이었다.";
    if (figure.meta) delete figure.meta.richText;
    const res = await send("PUT", "/api/page/" + encodeURIComponent(slug), { title: "분기 보고", blocks: page.blocks, base_updated: page.page.updated }, "person");
    expect(res.status).toBe(200);
    const stored = rows(slug).find((r) => r.id === ids.figure)!;
    expect(stored.text).toBe("3분기 매출은 12억 3천만 원이었다.");
    expect(stored.meta.ai).toBe("lock");
  });

  test("a page default of lock keeps an agent from changing any block; the default is a page setting", async () => {
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: 잠근 페이지\n---\n하나\n\n둘\n")).data.slug;
    const set = await send("PUT", "/api/page/" + encodeURIComponent(slug) + "/settings", { ai: "lock", small: true }, "person");
    expect(set.status).toBe(200);
    expect(set.data.settings).toMatchObject({ ai: "lock", small: true });
    expect((await send("PUT", "/api/page/" + encodeURIComponent(slug) + "/settings", { ai: "owner" }, "person")).status).toBe(400);
    const before = rows(slug);
    const res = await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "다 바꿈\n", expectedUpdated: await version(slug) });
    expect(res.status).toBe(200);
    const after = rows(slug);
    for (const block of before) expect(after.find((r) => r.id === block.id)).toEqual(block);
    expect(after.filter((r) => before.some((b) => b.id === r.id)).map((r) => r.text)).toEqual(["하나", "둘"]);
    expect(after.map((r) => r.text)).toContain("다 바꿈");
  });

  test("pages without marks behave exactly as before (no locked field, agent text applied)", async () => {
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: 보통\n---\n하나\n\n둘\n")).data.slug;
    const res = await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "하나 고침\n\n둘\n", expectedUpdated: await version(slug) });
    expect(res.status).toBe(200);
    expect(res.data.locked).toBeUndefined();
    expect(rows(slug).map((r) => r.text)).toEqual(["하나 고침", "둘"]);
  });
});
