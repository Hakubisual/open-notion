import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

// ds10: components written by an agent through the real worker (agent API -> saved blocks -> reader HTML), and the
// agent catalog over MCP and REST.
const WORKER_SOURCE = assembleWorkerSource();
const F = "```";

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

let sqlite: Database, env: any, worker: any, writer: string;
const agent = { name: "Claude Code", via: "token" as const, scopes: ["read", "write"] };

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
const rows = (slug: string) => (sqlite.query("SELECT id, type, text, meta FROM blocks WHERE page = ? ORDER BY ord").all(slug) as any[]).map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));

beforeEach(async () => {
  sqlite = new Database(":memory:");
  worker = new Function(WORKER_SOURCE)();
  env = { DB: d1(sqlite), GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  await send("GET", "/api/v1/me");
  await ensureAgentSchema(env.DB);
  writer = (await createAgentToken(env.DB, { name: agent.name, scopes: agent.scopes })).token;
});

describe("components through the worker", () => {
  test("an agent writes components; the stored text is kept as written and the reader draws them, malformed data with defaults", async () => {
    const md = "---\ntitle: ds10 컴포넌트\n---\n\n" +
      F + 'acard-ui {"ui":"stat"}\n{"label":"가입 전환율","value":"18.4%","delta":"+12%"}\n' + F + "\n\n" +
      F + 'acard-ui {"ui":"stat"}\n{ broken\n' + F + "\n\n" +
      F + 'acard-ui {"ui":"no-such-thing"}\n{"a":1}\n' + F + "\n";
    const created = await send("POST", "/api/v1/pages", md);
    expect(created.status).toBe(201);
    const slug = created.data.slug;
    const stored = rows(slug);
    expect(stored.map((r) => r.type)).toEqual(["component", "component", "component"]);
    expect(stored[1].text).toBe("{ broken");
    const page = await send("GET", "/" + encodeURIComponent(slug) + "/", undefined, "person");
    expect(page.status).toBe(200);
    expect(page.data).toContain('data-ui="stat"');
    expect(page.data).toContain("18.4%");
    expect(page.data).toContain('data-ui-invalid="1"');
    expect(page.data).toContain('class="ui-fallback"');
    expect(page.data.match(/\.ui-stat\{/g)).toHaveLength(1);
    const read = await send("GET", "/api/v1/pages/" + encodeURIComponent(slug));
    expect(read.data.markdown).toContain(F + 'acard-ui {"ui":"stat"}');
  });

  test("list_components on MCP names every component in its description and returns schema, defaults and a fence", async () => {
    const server = createAcardMcpServer(async (operation, input) => {
      try { return await worker.acardHost.run(env, agent, operation, input); } catch (error: any) { throw new OperationFailure(error.message, error.status); }
    }, "test", worker.acardHost.mcpTools);
    const client = new Client({ name: "components-test", version: "test" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    const tool = (await client.listTools()).tools.find((t) => t.name === "list_components")!;
    expect(tool.description).toContain("stat");
    expect(tool.description).toContain("empty");
    expect(tool.description!.length).toBeLessThan(800);
    const all = JSON.parse(((await client.callTool({ name: "list_components", arguments: {} })).content as any)[0].text);
    expect(all.fence).toBe("acard-ui");
    const stat = all.components.find((c: any) => c.id === "stat");
    expect(stat.schema.properties.label).toBeTruthy();
    expect(stat.markdown).toStartWith(F + 'acard-ui {"ui":"stat"}');
    const one = JSON.parse(((await client.callTool({ name: "list_components", arguments: { id: "empty" } })).content as any)[0].text);
    expect(one.id).toBe("empty");
    const missing = await client.callTool({ name: "list_components", arguments: { id: "nope" } });
    expect(missing.isError).toBe(true);
    await client.close(); await server.close();
  });

  test("GET /api/v1/components lists the catalog and /api/v1/components/<id> one entry", async () => {
    const all = await send("GET", "/api/v1/components");
    expect(all.status).toBe(200);
    expect(all.data.components.map((c: any) => c.id)).toContain("stat");
    expect((await send("GET", "/api/v1/components/stat")).data.id).toBe("stat");
    expect((await send("GET", "/api/v1/components/nope")).status).toBe(404);
  });
});
