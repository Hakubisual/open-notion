import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { createAgentToken } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

// get_agent_skills only reads a page a person wrote; it never creates one.
const source = assembleWorkerSource();
const writer = { name: "Skills agent", via: "token" as const, scopes: ["read", "write"] };
let sqlite: Database, env: any, worker: any, readToken: string;
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
  readToken = (await createAgentToken(env.DB, { name: "Reader", scopes: ["read"] })).token;
  server = createAcardMcpServer(async (operation, input) => {
    try { return await worker.acardHost.run(env, writer, operation, input); }
    catch (error: any) { throw new OperationFailure(error.message, error.status); }
  }, "test", worker.acardHost.mcpTools);
  client = new Client({ name: "skills-test", version: "test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});

afterEach(async () => { await client.close(); await server.close(); sqlite.close(); });

const skills = () => client.callTool({ name: "get_agent_skills", arguments: {} }) as Promise<any>;
const rest = (method = "GET") => worker.fetch(new Request("https://notes.test/api/v1/agent-skills", { method,
  headers: { authorization: "Bearer " + readToken } }), env) as Promise<Response>;
const rows = () => sqlite.query("SELECT slug FROM pages WHERE slug = 'agent-skills'").all();

test("a fresh workspace has no agent-skills page and get_agent_skills does not create one", async () => {
  const missing = await skills();
  expect(missing.isError).toBe(true);
  expect(missing.structuredContent.status).toBe(404);
  expect((await rest()).status).toBe(404);
  expect(rows()).toHaveLength(0);
});

test("get_agent_skills returns a page a person wrote and 404s once it is trashed", async () => {
  await worker.acardHost.run(env, writer, "createPage", { slug: "agent-skills", title: "Agent skills", markdown: "# Team rules\n\nWrite short notes." });
  const found = await skills();
  expect(found.isError).not.toBe(true);
  const page = JSON.parse(found.content[0].text);
  expect(page.slug).toBe("agent-skills");
  expect(page.markdown).toContain("# Team rules");
  expect((await rest()).status).toBe(200);
  expect((await rest("POST")).status).toBe(405);
  sqlite.exec("INSERT INTO editor_trash (page, deleted) VALUES ('agent-skills', 1)");
  expect((await skills()).structuredContent.status).toBe(404);
  expect((await rest()).status).toBe(404);
  expect(rows()).toHaveLength(1);
});
