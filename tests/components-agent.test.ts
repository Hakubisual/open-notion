import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { componentCatalog, listComponents } from "../component-registry.js";
import "../components/index.js";
import { assembleWorkerSource } from "./assemble-worker";

// #98: agents use components well - MCP instructions point at them, set_component_data writes schema-checked data
// through the person-edit guard, and AGENTS.md lists the registered components from the catalog.
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

let sqlite: Database, env: any, worker: any, writer: string, client: Client, server: ReturnType<typeof createAcardMcpServer>;
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
const version = async (slug: string) => (await send("GET", "/api/v1/pages/" + encodeURIComponent(slug))).data.updated;
async function call(name: string, args: Record<string, unknown>) {
  const out: any = await client.callTool({ name, arguments: args });
  const text = out.content[0].text;
  return { isError: Boolean(out.isError), text, data: out.isError ? null : JSON.parse(text) };
}
async function statPage() {
  const md = "---\ntitle: 지표\n---\n\n# 현황\n\n" + F + 'acard-ui {"ui":"stat"}\n{"label":"가입","value":"10"}\n' + F + "\n";
  const slug = (await send("POST", "/api/v1/pages", md)).data.slug;
  return { slug, statId: rows(slug).find((r) => r.type === "component")!.id, headingId: rows(slug)[0].id };
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  worker = new Function(WORKER_SOURCE)();
  env = { DB: d1(sqlite), GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  await send("GET", "/api/v1/me");
  await ensureAgentSchema(env.DB);
  writer = (await createAgentToken(env.DB, { name: agent.name, scopes: agent.scopes })).token;
  server = createAcardMcpServer(async (operation, input) => {
    try { return await worker.acardHost.run(env, agent, operation, input); } catch (error: any) { throw new OperationFailure(error.message, error.status); }
  }, "test", worker.acardHost.mcpTools);
  client = new Client({ name: "components-agent-test", version: "test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});

describe("agents and components (#98)", () => {
  test("instructions carry one COMPONENTS line with an acard-ui example; list_components stays a name list without schemas", async () => {
    const lines = client.getInstructions()!.split("\n");
    const at = lines.findIndex((l) => l.startsWith("COMPONENTS:"));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at]).toContain("list_components");
    expect(lines[at + 1]).toBe(F + 'acard-ui {"ui":"stat"}');
    expect(JSON.parse(lines[at + 2]).value).toBeTruthy();
    expect(lines[at + 3]).toBe(F);
    const tools = (await client.listTools()).tools;
    const list = tools.find((t) => t.name === "list_components")!;
    // Basic ids appear in full; every other family is folded to prefix-{a,b} so the one-line description stays short.
    const named = (id: string) => list.description!.includes(id) || new RegExp(id.slice(0, id.indexOf("-") + 1) + "\\{[^}]*\\b" + id.slice(id.indexOf("-") + 1) + "\\b").test(list.description!);
    for (const c of listComponents()) expect(named(c.id), c.id).toBe(true);
    expect(list.description).not.toContain("properties");
    expect(list.description!.split("\n")).toHaveLength(1);
    expect(tools.find((t) => t.name === "set_component_data")!.annotations?.readOnlyHint).toBe(false);
  });

  test("set_component_data writes valid data to a block, adds a new block after an anchor and returns errors for bad data", async () => {
    const { slug, statId, headingId } = await statPage();
    const bad = await call("set_component_data", { page: slug, block_id: statId, data: { label: 3, value: "1" }, expected_version: await version(slug) });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("data.label");
    const missing = await call("set_component_data", { page: slug, block_id: statId, data: { label: "a" }, expected_version: await version(slug) });
    expect(missing.text).toContain("data.value");
    expect(JSON.parse(rows(slug)[1].text)).toEqual({ label: "가입", value: "10" });

    const ok = await call("set_component_data", { page: slug, block_id: statId, data: { label: "가입 전환율", value: "18.4%", delta: "+12%" }, expected_version: await version(slug) });
    expect(ok.data).toMatchObject({ block_id: statId, ui: "stat" });
    expect(JSON.parse(rows(slug)[1].text).value).toBe("18.4%");
    expect(rows(slug)[1].meta).toMatchObject({ ui: "stat" });

    const added = await call("set_component_data", { page: slug, ui: "empty", after_block_id: headingId, data: { title: "비어 있어요" }, expected_version: await version(slug) });
    expect(rows(slug).map((r) => [r.type, r.meta?.ui ?? null])).toEqual([["heading1", null], ["component", "empty"], ["component", "stat"]]);
    expect(rows(slug)[1].id).toBe(added.data.block_id);

    const html = (await send("GET", "/" + encodeURIComponent(slug) + "/", undefined, "person")).data;
    expect(html).toContain("18.4%");
    expect(html).toContain('data-ui="empty"');
    expect((await send("GET", "/api/v1/pages/" + encodeURIComponent(slug))).data.markdown).toContain(F + 'acard-ui {"ui":"empty"}');

    const v = await version(slug);
    expect((await call("set_component_data", { page: slug, block_id: headingId, data: {}, expected_version: v })).text).toContain("컴포넌트 블록이 아니에요");
    expect((await call("set_component_data", { page: slug, ui: "nope", data: {}, expected_version: v })).text).toContain("없는 컴포넌트");
    expect((await call("set_component_data", { page: slug, block_id: statId, ui: "empty", data: {}, expected_version: v })).text).toContain("stat 컴포넌트");
    expect((await call("set_component_data", { page: slug, data: {}, expected_version: v })).text).toContain("block_id");
    const stale = await call("set_component_data", { page: slug, block_id: statId, data: { label: "a", value: 1 }, expected_version: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("바뀌었어요");
    await expect(worker.acardHost.run(env, { ...agent, scopes: ["read"] }, "setComponentData", { page: slug, block_id: statId, data: { label: "a", value: 1 }, expected_version: v })).rejects.toThrow("권한");
  });

  test("a component a person edited keeps the person's data; the agent's data becomes an update suggestion", async () => {
    const { slug, statId } = await statPage();
    const page = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data;
    const personData = '{"label":"사람","value":"7"}';
    page.blocks.find((b: any) => b.id === statId).text = personData;
    expect((await send("PUT", "/api/page/" + encodeURIComponent(slug), { title: "지표", blocks: page.blocks, base_updated: page.page.updated }, "person")).status).toBe(200);
    const res = await call("set_component_data", { page: slug, block_id: statId, data: { label: "agent", value: "1" }, expected_version: await version(slug) });
    expect(res.data.suggestions).toBe(1);
    const block = rows(slug).find((r) => r.id === statId)!;
    expect(block.text).toBe(personData);
    expect(JSON.parse(block.meta.suggest.text).label).toBe("agent");
  });
});

describe("AGENTS.md components section (#98)", () => {
  const src = readFileSync(join(import.meta.dir, "..", "agent-docs.js"), "utf8").replace(/^export /gm, "");
  const { agentsMd, componentsMd } = new Function(src + "\nreturn { agentsMd, componentsMd };")();

  test("lists every registered component from componentCatalog() with its fields and a ready fence", () => {
    const md: string = agentsMd("https://notes.test", componentCatalog());
    const section = md.slice(md.indexOf("## Components"), md.indexOf("## Where to write work logs"));
    expect(section).toContain("set_component_data");
    for (const c of componentCatalog() as any[]) expect(section).toContain("- `" + c.id + "` " + c.name);
    expect(section).toContain("label*, value*");
    expect(section).toContain((componentCatalog() as any[])[0].markdown);
  });

  test("without a catalog the section still points at list_components and lists nothing", () => {
    const md: string = componentsMd(undefined);
    expect(md).toContain("list_components");
    expect(md).not.toContain("- `");
  });
});
