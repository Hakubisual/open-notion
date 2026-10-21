import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

// #36: an agent never changes a paragraph a person edited; a different new text becomes one "update suggestion"
// under that paragraph, and the person accepts (replaces) or dismisses (removes) it.
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
      try { const out = []; for (const item of list) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

let sqlite: Database;
let db: ReturnType<typeof d1>;
let worker: { fetch(request: Request, env: any): Promise<Response> };
let env: any;
let writer: string;

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
const rows = (slug: string) => (sqlite.query("SELECT id, text, meta FROM blocks WHERE page = ? ORDER BY ord").all(slug) as any[])
  .map((r) => ({ id: r.id, text: r.text, meta: r.meta ? JSON.parse(r.meta) : null }));
const version = async (slug: string) => (await send("GET", "/api/v1/pages/" + encodeURIComponent(slug))).data.updated;

// The agent writes a page, then a person rewrites its second paragraph in the editor (the editor's PUT save).
async function pageWithPersonEdit() {
  const slug = (await send("POST", "/api/v1/pages", "---\ntitle: Plan\n---\n첫 문단\n\n둘째 문단\n\n셋째 문단\n")).data.slug;
  const page = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data;
  page.blocks[1].text = "사람이 고친 둘째 문단";
  if (page.blocks[1].meta) delete page.blocks[1].meta.richText;
  expect((await send("PUT", "/api/page/" + encodeURIComponent(slug), { title: "Plan", blocks: page.blocks, base_updated: page.page.updated }, "person")).status).toBe(200);
  return { slug, humanId: page.blocks[1].id as string };
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  db = d1(sqlite);
  worker = new Function(WORKER_SOURCE)();
  env = { DB: db, GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  await send("GET", "/api/v1/me");
  await ensureAgentSchema(db);
  writer = (await createAgentToken(db, { name: "Claude Code", scopes: ["read", "write"] })).token;
});

describe("person-edited paragraphs (#36)", () => {
  test("an agent update_page leaves the person's paragraph as written and attaches one suggestion under it", async () => {
    const { slug, humanId } = await pageWithPersonEdit();
    const res = await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "첫 문단 (갱신)\n\n에이전트가 다시 쓴 둘째 문단\n\n셋째 문단\n", expectedUpdated: await version(slug) });
    expect(res.status).toBe(200);
    const after = rows(slug);
    expect(after.map((r) => r.text)).toEqual(["첫 문단 (갱신)", "사람이 고친 둘째 문단", "셋째 문단"]);
    const human = after.find((r) => r.id === humanId)!;
    expect(human.meta.human).toBeTruthy();
    expect(human.meta.suggest).toMatchObject({ text: "에이전트가 다시 쓴 둘째 문단", by: "Claude Code" });
    expect(after.filter((r) => r.meta && r.meta.suggest).length).toBe(1);
    expect(res.data.suggestions).toBe(1);
  });

  test("an agent that writes the person's text back unchanged adds no suggestion", async () => {
    const { slug } = await pageWithPersonEdit();
    await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "첫 문단\n\n사람이 고친 둘째 문단\n\n넷째 문단 추가\n", expectedUpdated: await version(slug) });
    const after = rows(slug);
    expect(after.map((r) => r.text)).toEqual(["첫 문단", "사람이 고친 둘째 문단", "넷째 문단 추가"]);
    expect(after.filter((r) => r.meta && r.meta.suggest).length).toBe(0);
  });

  test("update_block and delete_block on the person's paragraph keep it and suggest instead", async () => {
    const { slug, humanId } = await pageWithPersonEdit();
    const path = "/api/v1/pages/" + encodeURIComponent(slug) + "/blocks/" + encodeURIComponent(humanId);
    const upd = await send("PATCH", path, { markdown: "블록 하나만 바꾼 제안", expected_version: await version(slug) });
    expect(upd.status).toBe(200);
    expect(rows(slug)[1]).toMatchObject({ text: "사람이 고친 둘째 문단", meta: { suggest: { text: "블록 하나만 바꾼 제안" } } });
    const del = await send("DELETE", path, { expected_version: await version(slug) });
    expect(del.status).toBe(200);
    const after = rows(slug);
    expect(after.map((r) => r.text)).toEqual(["첫 문단", "사람이 고친 둘째 문단", "셋째 문단"]);
    expect(after[1].meta.suggest).toMatchObject({ remove: true });
  });

  test("accept replaces the paragraph with the suggestion; dismiss removes only the suggestion", async () => {
    const { slug, humanId } = await pageWithPersonEdit();
    await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "첫 문단\n\n제안 문장 하나\n\n셋째 문단\n", expectedUpdated: await version(slug) });
    const accepted = await send("POST", "/api/page/" + encodeURIComponent(slug) + "/suggestion", { block: humanId, action: "accept" }, "person");
    expect(accepted.status).toBe(200);
    expect(rows(slug)[1].text).toBe("제안 문장 하나");
    expect(rows(slug)[1].meta.suggest).toBeUndefined();
    expect(rows(slug)[1].meta.human).toBeTruthy();

    await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "첫 문단\n\n또 다른 제안\n\n셋째 문단\n", expectedUpdated: await version(slug) });
    expect(rows(slug)[1].meta.suggest.text).toBe("또 다른 제안");
    const dismissed = await send("POST", "/api/page/" + encodeURIComponent(slug) + "/suggestion", { block: humanId, action: "dismiss" }, "person");
    expect(dismissed.status).toBe(200);
    expect(rows(slug)[1].text).toBe("제안 문장 하나");
    expect(rows(slug)[1].meta.suggest).toBeUndefined();
    expect((await send("POST", "/api/page/" + encodeURIComponent(slug) + "/suggestion", { block: humanId, action: "accept" }, "person")).status).toBe(404);
  });

  test("accepting a suggestion to remove deletes the paragraph", async () => {
    const { slug, humanId } = await pageWithPersonEdit();
    await send("DELETE", "/api/v1/pages/" + encodeURIComponent(slug) + "/blocks/" + encodeURIComponent(humanId), { expected_version: await version(slug) });
    expect((await send("POST", "/api/page/" + encodeURIComponent(slug) + "/suggestion", { block: humanId, action: "accept" }, "person")).status).toBe(200);
    expect(rows(slug).map((r) => r.text)).toEqual(["첫 문단", "셋째 문단"]);
  });

  test("the reader shows the suggestion card with 반영 and 무시 under the person's paragraph", async () => {
    const { slug, humanId } = await pageWithPersonEdit();
    await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "첫 문단\n\n제안 문장 하나\n\n셋째 문단\n", expectedUpdated: await version(slug) });
    const html = await (await worker.fetch(new Request("https://notes.test/" + encodeURIComponent(slug) + "/", { headers: { cookie: await cookie() } }), env)).text();
    const at = html.indexOf("사람이 고친 둘째 문단");
    const card = html.indexOf('data-suggest="' + humanId + '"');
    expect(at).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(at);
    expect(html.slice(card, card + 2000)).toContain("반영");
    expect(html.slice(card, card + 2000)).toContain("무시");
    expect(html.indexOf("셋째 문단")).toBeGreaterThan(card);
  });

  test("the editor's changed-blocks save marks only the paragraphs the person changed", async () => {
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: P\n---\n하나\n\n둘\n")).data.slug;
    const page = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data;
    const block = { ...page.blocks[0], text: "사람이 고친 하나", ord: 0 };
    const res = await send("PATCH", "/api/page/" + encodeURIComponent(slug) + "/blocks", { base_updated: page.page.updated, upserts: [block], deletes: [] }, "person");
    expect(res.status).toBe(200);
    const after = rows(slug);
    expect(after[0].meta.human).toBeTruthy();
    expect(after[1].meta?.human).toBeUndefined();
  });
});


describe("person-edited blocks inside columns (notion-parity C13)", () => {
  const guardOf = () => new Function("registerFeature", require("node:fs").readFileSync(require("node:path").join(import.meta.dir, "..", "features", "human-blocks.js"), "utf8") + "\nreturn humanGuard;")(() => {});
  const B = (id: string, type: string, indent: number, text = "", human = false) => ({ id, type, text, checked: false, indent, meta: human ? { human: { at: 1 } } : null });
  const before = [B("t", "paragraph", 0, "top"), B("cs", "columns", 0), B("c1", "column", 1), B("a", "paragraph", 2, "왼쪽 첫"), B("p", "paragraph", 2, "사람 글", true),
    B("c2", "column", 1), B("q", "paragraph", 2, "오른쪽"), B("z", "paragraph", 0, "끝")];
  const shape = (blocks: any[]) => blocks.map((b) => b.id + ":" + b.indent + (b.meta && b.meta.suggest ? ":suggest" : ""));
  test("an agent that removes the whole columns keeps the protected paragraph inside its column and columns", () => {
    const out = guardOf()(before, [B("t", "paragraph", 0, "top"), B("z", "paragraph", 0, "끝")], "Agent");
    expect(shape(out.blocks)).toEqual(["t:0", "cs:0", "c1:1", "p:2:suggest", "z:0"]);
  });
  test("an agent that moves the protected paragraph to another column leaves it in the person's column", () => {
    const moved = [B("t", "paragraph", 0, "top"), B("cs", "columns", 0), B("c1", "column", 1), B("a", "paragraph", 2, "왼쪽 첫"), B("c2", "column", 1),
      B("q", "paragraph", 2, "오른쪽"), B("p", "paragraph", 2, "사람 글"), B("z", "paragraph", 0, "끝")];
    expect(shape(guardOf()(before, moved, "Agent").blocks)).toEqual(["t:0", "cs:0", "c1:1", "a:2", "p:2", "c2:1", "q:2", "z:0"]);
  });
  test("dismissing the removal suggestion keeps the paragraph in its column", async () => {
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: Cols\n---\n위\n")).data.slug;
    const page = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data;
    const blocks = [page.blocks[0], B("cs", "columns", 0), B("c1", "column", 1), B("p", "paragraph", 2, "사람 글"), B("c2", "column", 1), B("q", "paragraph", 2, "오른쪽")];
    expect((await send("PUT", "/api/page/" + encodeURIComponent(slug), { title: "Cols", blocks, base_updated: page.page.updated }, "person")).status).toBe(200);
    expect((await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: "위\n", expectedUpdated: await version(slug) })).status).toBe(200);
    const kept = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data.blocks;
    expect(kept.map((b: any) => b.id + ":" + b.type + ":" + b.indent)).toEqual([page.blocks[0].id + ":paragraph:0", "cs:columns:0", "c1:column:1", "p:paragraph:2", "c2:column:1", "q:paragraph:2"]);
    expect(kept.find((b: any) => b.id === "p").meta.suggest.remove).toBe(true);
    expect((await send("POST", "/api/page/" + encodeURIComponent(slug) + "/suggestion", { block: "p", action: "dismiss" }, "person")).status).toBe(200);
    const after = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data.blocks;
    expect(after.map((b: any) => b.id + ":" + b.indent)).toEqual([page.blocks[0].id + ":0", "cs:0", "c1:1", "p:2", "c2:1", "q:2"]);
  });
});


describe("agent pages with columns (notion-parity C13)", () => {
  const doc = (right: string) => "---\ntitle: Cols\nacard_meta: 1\n---\n<!--acard columns {\"widths\":[0.5,0.5]}-->\n\n<!--acard column-->\n\n> [!note] 왼쪽 안내\n\n  - 하나\n\n<!--acard column-->\n\n" + right + "\n\n<!--acard /columns-->\n\n끝\n";
  test("create_page with marker lines stores column blocks and read_page gives the same lines back", async () => {
    const slug = (await send("POST", "/api/v1/pages", doc("### 오른쪽"))).data.slug;
    const stored = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data.blocks;
    expect(stored.map((b: any) => b.type + ":" + b.indent)).toEqual(["columns:0", "column:1", "callout:2", "bulleted:3", "column:1", "heading3:2", "paragraph:0"]);
    const read = (await send("GET", "/api/v1/pages/" + encodeURIComponent(slug))).data;
    expect(read.markdown).toContain("<!--acard columns {\"widths\":[0.5,0.5]}-->\n\n<!--acard column-->\n\n> [!note] 왼쪽 안내\n\n  - 하나\n\n<!--acard column-->\n\n### 오른쪽\n\n<!--acard /columns-->");
  });
  test("update_page adding a heading to the right column changes only that column", async () => {
    const slug = (await send("POST", "/api/v1/pages", doc("### 오른쪽"))).data.slug;
    expect((await send("PUT", "/api/v1/pages/" + encodeURIComponent(slug), { markdown: doc("### 오른쪽\n\n### 더한 제목"), expectedUpdated: await version(slug) })).status).toBe(200);
    const stored = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data.blocks;
    expect(stored.map((b: any) => b.type + ":" + b.indent + ":" + b.text)).toEqual(["columns:0:", "column:1:", "callout:2:왼쪽 안내", "bulleted:3:하나", "column:1:", "heading3:2:오른쪽", "heading3:2:더한 제목", "paragraph:0:끝"]);
  });
});
