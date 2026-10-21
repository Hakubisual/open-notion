import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { createAgentToken } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

const source = assembleWorkerSource();
const writer = { name: "Block agent", via: "token" as const, scopes: ["read", "write"] };
let sqlite: Database, env: any, worker: any, writeToken: string, readToken: string;
let client: Client, server: ReturnType<typeof createAcardMcpServer>;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...next: any[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = { GATE_PASSWORD: "test-pw", GATE_SECRET: "test-secret", ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    DB: { prepare: statement, batch: async (statements: ReturnType<typeof statement>[]) => {
      sqlite.exec("BEGIN");
      try { const out = []; for (const item of statements) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    } } };
  worker = new Function(source)();
  await worker.acardHost.run(env, writer, "whoami", {});
  writeToken = (await createAgentToken(env.DB, { name: writer.name, scopes: writer.scopes })).token;
  readToken = (await createAgentToken(env.DB, { name: "Reader", scopes: ["read"] })).token;
  await worker.acardHost.run(env, writer, "createPage", { slug: "blocks", title: "Blocks", markdown: "first\n\nsecond\n\nthird" });
  server = createAcardMcpServer(async (operation, input) => {
    try { return await worker.acardHost.run(env, writer, operation, input); }
    catch (error: any) { throw new OperationFailure(error.message, error.status); }
  }, "test", worker.acardHost.mcpTools);
  client = new Client({ name: "blocks-test", version: "test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});

afterEach(async () => { await client.close(); await server.close(); sqlite.close(); });

async function mcp(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError).not.toBe(true);
  return JSON.parse((response.content as any)[0].text);
}

async function rest(path: string, method = "GET", body?: unknown, token = writeToken) {
  return worker.fetch(new Request("https://notes.test/api/v1" + path, { method,
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }), env) as Promise<Response>;
}

test("MCP update preserves every other block and records history and attribution", async () => {
  const before = await mcp("read_blocks", { page: "blocks" });
  const middle = before.blocks[1].id;
  const untouched = () => sqlite.query("SELECT * FROM blocks WHERE page = 'blocks' AND id != ? ORDER BY ord").all(middle);
  const rows = untouched();
  const updated = await mcp("update_block", { page: "blocks", block_id: middle, markdown: "## changed", expected_version: before.version });
  const after = await mcp("read_blocks", { page: "blocks" });
  expect(after.blocks).toEqual([before.blocks[0], { id: middle, type: "heading2", text: "changed", markdown: "## changed" }, before.blocks[2]]);
  expect(untouched()).toEqual(rows);
  expect(updated.version).toBeGreaterThan(before.version);
  expect(after.version).toBe(updated.version);
  expect(sqlite.query("SELECT agent, action FROM agent_activity WHERE action = 'block-update'").all()).toEqual([{ agent: writer.name, action: "block-update" }]);
  const history = sqlite.query("SELECT snapshot FROM editor_history WHERE page = 'blocks'").all() as any[];
  expect(history).toHaveLength(1);
  expect(JSON.parse(history[0].snapshot).blocks.map((b: any) => b.text)).toEqual(["first", "second", "third"]);
});

test("patch_block changes only the found text of one block; a missing or repeated find is refused and nothing changes (#38)", async () => {
  await worker.acardHost.run(env, writer, "createPage", { slug: "kit", title: "Kit", markdown: "```html-embed\n<style>.n{color:red}</style><b class=n>$31.02</b><i>$1</i><i>$1</i>\n```\n\nafter" });
  const read = await mcp("read_blocks", { page: "kit" });
  const html = read.blocks[0];
  const done = await mcp("patch_block", { page: "kit", block_id: html.id, edits: [{ find: "$31.02", replace: "$31.50" }, { find: "color:red", replace: "color:blue" }], expected_version: read.version });
  expect(done.block_ids).toEqual([html.id]);
  const after = await mcp("read_blocks", { page: "kit" });
  expect(after.blocks[0]).toMatchObject({ id: html.id, type: "html", text: "<style>.n{color:blue}</style><b class=n>$31.50</b><i>$1</i><i>$1</i>" });
  expect(after.blocks[1].text).toBe("after");
  for (const edits of [[{ find: "$1<", replace: "$2<" }], [{ find: "nope", replace: "x" }]]) {
    const failed = await client.callTool({ name: "patch_block", arguments: { page: "kit", block_id: html.id, edits, expected_version: after.version } });
    expect(failed.isError).toBe(true);
  }
  expect((await mcp("read_blocks", { page: "kit" })).blocks[0].text).toBe(after.blocks[0].text);
});

test("stale writes return HTTP and MCP 409 without history or content changes", async () => {
  const before = await mcp("read_blocks", { page: "blocks" });
  const input = { page: "blocks", block_id: before.blocks[0].id, markdown: "new", expected_version: before.version };
  await mcp("update_block", input);
  expect((await rest("/pages/blocks/blocks/" + input.block_id, "PATCH", input)).status).toBe(409);
  const failed = await client.callTool({ name: "update_block", arguments: input });
  expect(failed.isError).toBe(true);
  expect(failed.structuredContent).toMatchObject({ status: 409 });
  expect(sqlite.query("SELECT COUNT(*) AS n FROM editor_history").get()).toEqual({ n: 1 });
  expect((await mcp("read_blocks", { page: "blocks" })).blocks[0].text).toBe("new");
});

test("MCP update_page keeps a person's later edit to block 3: 409 without or with a stale expectedUpdated, 200 with the fresh one (#25)", async () => {
  const read = await mcp("read_page", { slug: "blocks" });
  // The person edits block 3 in the editor after the agent's read: blocks change and the page stamp moves past the agent's write.
  const personAt = read.updated + 60000;
  sqlite.query("UPDATE blocks SET text = '사람이 고친 문장' WHERE page = 'blocks' AND ord = 2").run();
  sqlite.query("UPDATE pages SET updated = ? WHERE slug = 'blocks'").run(personAt);
  const texts = () => (sqlite.query("SELECT text FROM blocks WHERE page = 'blocks' ORDER BY ord").all() as any[]).map((row) => row.text);
  for (const args of [{ slug: "blocks", markdown: "agent only" }, { slug: "blocks", markdown: "agent only", expectedUpdated: read.updated }]) {
    const refused = await client.callTool({ name: "update_page", arguments: args });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({ status: 409 });
  }
  expect(texts()).toEqual(["first", "second", "사람이 고친 문장"]);
  const fresh = await mcp("read_page", { slug: "blocks" });
  expect(fresh.updated).toBe(personAt);
  await mcp("update_page", { slug: "blocks", markdown: "first\n\nsecond (agent)\n\n사람이 고친 문장", expectedUpdated: fresh.updated });
  expect(texts()).toEqual(["first", "second (agent)", "사람이 고친 문장"]);
});

test("read token cannot update, insert or delete through REST or the shared runner", async () => {
  const before = await mcp("read_blocks", { page: "blocks" });
  const base = { page: "blocks", block_id: before.blocks[0].id, after_block_id: null, markdown: "denied", expected_version: before.version };
  for (const [method, path, operation] of [
    ["PATCH", "/pages/blocks/blocks/" + base.block_id, "updateBlock"],
    ["DELETE", "/pages/blocks/blocks/" + base.block_id, "deleteBlock"],
    ["POST", "/pages/blocks/blocks", "insertBlocks"],
  ]) {
    expect((await rest(path, method, base, readToken)).status).toBe(403);
    await expect(worker.acardHost.run(env, { ...writer, scopes: ["read"] }, operation, base)).rejects.toMatchObject({ status: 403 });
  }
  expect((await rest("/pages/blocks/blocks", "GET", undefined, readToken)).status).toBe(200);
  expect((await rest("/pages/blocks/blocks", "GET", undefined, "")).status).toBe(401);
  expect(await mcp("read_blocks", { page: "blocks" })).toEqual(before);
});

test("insert after ID and null anchor preserve old IDs in order", async () => {
  const before = await mcp("read_blocks", { page: "blocks" });
  const inserted = await mcp("insert_blocks", { page: "blocks", after_block_id: before.blocks[0].id, markdown: "alpha\n\nbeta", expected_version: before.version });
  const after = await mcp("read_blocks", { page: "blocks" });
  expect(after.blocks.map((b: any) => b.text)).toEqual(["first", "alpha", "beta", "second", "third"]);
  expect(after.blocks.filter((b: any) => !inserted.block_ids.includes(b.id))).toEqual(before.blocks);
  const prepended = await rest("/pages/blocks/blocks", "POST", { after_block_id: null, markdown: "start", expected_version: after.version });
  expect(prepended.status).toBe(200);
  expect((await mcp("read_blocks", { page: "blocks" })).blocks[0].text).toBe("start");
});

test("delete removes only the requested block and saves its prior version", async () => {
  const before = await mcp("read_blocks", { page: "blocks" });
  const result = await rest("/pages/blocks/blocks/" + before.blocks[1].id, "DELETE", { expected_version: before.version });
  expect(result.status).toBe(200);
  expect((await mcp("read_blocks", { page: "blocks" })).blocks).toEqual([before.blocks[0], before.blocks[2]]);
  expect(sqlite.query("SELECT action FROM agent_activity WHERE action = 'block-delete'").all()).toHaveLength(1);
  expect(sqlite.query("SELECT id FROM editor_history").all()).toHaveLength(1);
});

test("invalid edits never claim the version or create history", async () => {
  const before = await mcp("read_blocks", { page: "blocks" });
  for (const [name, input, status] of [
    ["updateBlock", { block_id: before.blocks[0].id, markdown: "one\n\ntwo", expected_version: before.version }, 400],
    ["updateBlock", { block_id: before.blocks[0].id, markdown: "" , expected_version: before.version }, 400],
    ["updateBlock", { block_id: before.blocks[0].id, markdown: "one" }, 400],
    ["insertBlocks", { after_block_id: "absent", markdown: "one", expected_version: before.version }, 404],
    ["deleteBlock", { block_id: "absent", expected_version: before.version }, 404],
    ["deleteBlock", { block_id: before.blocks[0].id, expected_version: before.version + 1 }, 409],
  ] as const) {
    await expect(worker.acardHost.run(env, writer, name, { page: "blocks", ...input })).rejects.toMatchObject({ status });
  }
  expect(await mcp("read_blocks", { page: "blocks" })).toEqual(before);
  expect(sqlite.query("SELECT id FROM editor_history").all()).toHaveLength(0);
});

test("skills discovery creates one editable page, preserves owner changes and respects trash", async () => {
  const seeded = await mcp("get_agent_skills");
  expect(seeded.slug).toBe("agent-skills");
  expect((await rest("/agent-skills", "GET", undefined, readToken)).status).toBe(200);
  expect(sqlite.query("SELECT slug FROM pages WHERE slug = 'agent-skills'").all()).toHaveLength(1);
  expect(sqlite.query("SELECT id FROM blocks WHERE page = 'agent-skills' AND type = 'callout'").all()).toHaveLength(0);
  const before = await mcp("read_blocks", { page: "agent-skills" });
  await mcp("update_block", { page: "agent-skills", block_id: before.blocks[0].id, markdown: "# Owner rules", expected_version: before.version });
  expect((await mcp("get_agent_skills")).markdown).toContain("# Owner rules");
  sqlite.exec("INSERT INTO editor_trash (page, deleted) VALUES ('agent-skills', 1)");
  expect((await rest("/agent-skills")).status).toBe(404);
  sqlite.exec("DELETE FROM pages WHERE slug = 'agent-skills'");
  expect((await rest("/agent-skills")).status).toBe(404);
  expect(sqlite.query("SELECT slug FROM pages WHERE slug = 'agent-skills'").all()).toHaveLength(0);
});

// #39: agents pass the page as the address the person sees; every form reaches the same page for every write tool.
test("agent writes accept the page address, encoded slug or NFD Hangul, and name a page outside the workspace", async () => {
  await worker.acardHost.run(env, writer, "createPage", { slug: "샘플프로젝트-구성도", title: "샘플프로젝트 구성도", markdown: "첫 문단" });
  const slug = "샘플프로젝트-구성도", enc = encodeURIComponent(slug);
  const forms = ["https://notes.example.com/" + enc + "/", "https://notes.example.com/edit/" + enc + "/?new", "/" + slug + "/", enc, slug.normalize("NFD")];
  for (const form of forms) expect((await mcp("read_page", { slug: form })).slug).toBe(slug);
  await mcp("append_to_page", { slug: forms[0], markdown: "덧붙임" });
  const read = await mcp("read_page", { slug: forms[1] });
  await mcp("update_page", { slug: forms[2], markdown: "새 본문", expectedUpdated: read.updated });
  let blocks = await mcp("read_blocks", { page: forms[3] });
  await mcp("update_block", { page: forms[4], block_id: blocks.blocks[0].id, markdown: "블록 교체", expected_version: blocks.version });
  blocks = await mcp("read_blocks", { page: forms[0] });
  await mcp("insert_blocks", { page: forms[1], after_block_id: blocks.blocks[0].id, markdown: "끼운 문단", expected_version: blocks.version });
  blocks = await mcp("read_blocks", { page: forms[2] });
  await mcp("set_part_data", { page: forms[3], part: "badge", data: { items: [{ value: "1", label: "a", badge: "ok" }] }, expected_version: blocks.version });
  expect(sqlite.query("SELECT text FROM blocks WHERE page = ? ORDER BY ord").all(slug).map((row: any) => row.text).slice(0, 2)).toEqual(["블록 교체", "끼운 문단"]);
  expect(sqlite.query("SELECT slug FROM pages WHERE slug LIKE '%샘플프로젝트%'").all()).toHaveLength(1);
  expect((await rest("/pages/" + encodeURIComponent("https://notes.example.com/" + enc + "/"))).status).toBe(200);

  const missing = await client.callTool({ name: "read_page", arguments: { slug: "샘플프로젝트-작업-기록" } });
  expect(missing.isError).toBe(true);
  const text = (missing.content as any)[0].text;
  expect(text).toContain("워크스페이스");
  expect(text).toContain(slug);
});
