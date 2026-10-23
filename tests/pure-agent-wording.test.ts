import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer } from "../agents/mcp-tools";

// Agent-facing text in this edition describes the tools only: no house writing rules, owner title or language mandate.
// \uC8FC\uC778\uB2D8 is the owner title; it is escaped so a grep of the tree for it stays empty.
const BANNED = /\uC8FC\uC778\uB2D8|journal_|acard_first_run|get_agent_skills first|Korean|세 줄 요약|체크리스트|목차|do NOT|Never hand-write/;
const origin = "http://127.0.0.1:47811";
const src = readFileSync(join(import.meta.dir, "..", "agent-docs.js"), "utf8").replace(/^export /gm, "");
const { llmsTxt, agentsMd, connectClients } = new Function(src + "\nreturn { llmsTxt, agentsMd, connectClients };")();

describe("public agent wording", () => {
  test("llms.txt, AGENTS.md and the connect list are neutral and point at the MCP endpoint", () => {
    for (const text of [llmsTxt(origin), agentsMd(origin, []), JSON.stringify(connectClients(origin))]) {
      expect(text).not.toMatch(BANNED);
      expect(text).toContain(origin + "/mcp");
    }
    expect(agentsMd(origin, [])).toContain("> [!decision]");
  });

  test("the connect list offers MCP only, in the shape the settings page reads", () => {
    const clients = connectClients(origin);
    expect(clients.map((c: any) => c.id)).toEqual(["claude-code", "codex", "mcp"]);
    const codes = clients.flatMap((c: any) => c.methods.map((m: any) => m.code));
    expect(codes).toContain(`claude mcp add --transport http acard ${origin}/mcp`);
    expect(codes).toContain(`codex mcp add acard --url ${origin}/mcp`);
    expect(codes).toContain(`npx -y --package=${origin}/acard-cli.tgz acard mcp`);
    expect(JSON.parse(clients[2].methods[0].code)).toEqual({ mcpServers: { acard: { url: origin + "/mcp" } } });
    for (const c of clients) {
      expect(c).toMatchObject({ status: "unverified" });
      expect(c.docUrl.startsWith("https://")).toBe(true);
      for (const m of c.methods) expect(["command", "file"]).toContain(m.kind);
    }
    expect(codes.join("\n")).not.toMatch(/setup|plugin|skill|hooks/);
  });

  test("MCP server instructions are neutral and keep the block-edit and decision lines", async () => {
    const server = createAcardMcpServer(async () => ({}), "test");
    const client = new Client({ name: "pure-agent-wording", version: "test" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    const text = client.getInstructions()!;
    expect(text).not.toMatch(BANNED);
    expect(text.split("\n")[0]).toStartWith("Acard is a Notion-style notes app.");
    expect(text).toContain("> [!decision] <one sentence>");
    expect(text).toContain("expected_version");
    const decisions = (await client.listTools()).tools.find((t) => t.name === "list_decisions")!;
    expect(decisions.description).toBe("List open > [!decision] callouts across all pages.");
    await client.close();
  });
});
