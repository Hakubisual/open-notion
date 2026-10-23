import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { assembleWorkerSource } from "./assemble-worker";

// The self-host edition has no project auto-record sidebar and no first-run agent tools; the home checklist still
// learns that an agent connected (firstRunMark -> /api/first-run).
const ROOT = join(import.meta.dir, "..");
const source = assembleWorkerSource();
const agent = { name: "Projects agent", via: "token" as const, scopes: ["read", "write"] };
let sqlite: Database, env: any, worker: any, client: Client, server: ReturnType<typeof createAcardMcpServer>;

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
  server = createAcardMcpServer(async (operation, input) => {
    try { return await worker.acardHost.run(env, agent, operation, input); }
    catch (error: any) { throw new OperationFailure(error.message, error.status); }
  }, "test", worker.acardHost.mcpTools);
  client = new Client({ name: "projects-test", version: "test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});

afterEach(async () => { await client.close(); await server.close(); sqlite.close(); });

test("the project files are not shipped and no page loads them", () => {
  for (const file of ["features/projects.js", "assets/features/lazy/projects.js", "assets/features/lazy/projects.css"]) expect({ file, shipped: existsSync(join(ROOT, file)) }).toEqual({ file, shipped: false });
  for (const marker of ["lazy/projects", "pj-side", "acard-projects-side"]) expect({ marker, found: source.includes(marker) }).toEqual({ marker, found: false });
  expect(source).toContain("fd-wait");
});

test("tools/list has no memo_add or first-run tools and calling one is an error", async () => {
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  expect(names).toContain("list_pages");
  for (const name of ["memo_add", "acard_first_run", "acard_setup_project"]) expect(names).not.toContain(name);
  const res = await client.callTool({ name: "memo_add", arguments: { project: "x", items: [{ kind: "fact", text: "y" }] } }) as any;
  expect(res.isError).toBe(true);
});

test("an agent call still marks the workspace connected for the home checklist", async () => {
  await client.callTool({ name: "list_pages", arguments: {} });
  const row = sqlite.query("SELECT state, client FROM first_run WHERE id = 1").get() as any;
  expect(row).toEqual({ state: "connected", client: "Projects agent" });
});
