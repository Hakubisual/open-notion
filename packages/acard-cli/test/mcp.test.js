import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { TOKEN } from "./fake-server.js";
import { BIN } from "./run.js";

let remote;
const seenAuth = [];
const uploads = [];

function buildRemoteServer() {
  const server = new McpServer({ name: "acard-remote-fake", version: "9.9.9" });
  server.registerTool(
    "create_page",
    { description: "create", inputSchema: { title: z.string(), markdown: z.string() } },
    async ({ markdown }) => ({ content: [{ type: "text", text: markdown }] }),
  );
  server.registerTool(
    "append_to_page",
    { description: "append", inputSchema: { slug: z.string(), markdown: z.string() } },
    async ({ markdown }) => ({ content: [{ type: "text", text: markdown }] }),
  );
  server.registerTool(
    "echo",
    { description: "Echo text back", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
  );
  return server;
}

beforeAll(() => {
  remote = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/api/v1/media") {
        uploads.push({ search: new URL(req.url).search, type: req.headers.get("content-type"), size: (await req.arrayBuffer()).byteLength });
        return Response.json({ url: "/media/00000000000000a" + uploads.length }, { status: 201 });
      }
      if (path !== "/mcp") return new Response("not found", { status: 404 });
      seenAuth.push(req.headers.get("authorization"));
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: "invalid token" }, { status: 401 });
      // Stateless: one server + transport per request.
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await buildRemoteServer().connect(transport);
      return transport.handleRequest(req);
    },
  });
});

afterAll(() => remote.stop(true));

test("acard mcp proxies tools/list and tools/call over stdio", async () => {
  const env = { ...process.env, ACARD_TOKEN: TOKEN, ACARD_URL: `http://localhost:${remote.port}` };
  const transport = new StdioClientTransport({ command: "node", args: [BIN, "mcp"], env, stderr: "pipe" });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  try {
    expect(client.getServerVersion()?.name).toBe("acard-remote-fake");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["create_page", "append_to_page", "echo"]);
    expect(tools[2].inputSchema.properties.text.type).toBe("string");
    const result = await client.callTool({ name: "echo", arguments: { text: "안녕" } });
    expect(result.content).toEqual([{ type: "text", text: "echo: 안녕" }]);
    expect(seenAuth.length).toBeGreaterThan(0);
    expect(seenAuth.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
  } finally {
    await client.close();
  }
});

test("acard mcp uploads local image paths before forwarding a write and rewrites them to /media/", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "acard-img-"));
  writeFileSync(join(dir, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const env = { ...process.env, ACARD_TOKEN: TOKEN, ACARD_URL: `http://localhost:${remote.port}` };
  const transport = new StdioClientTransport({ command: "node", args: [BIN, "mcp"], env, cwd: dir, stderr: "pipe" });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "append_to_page", arguments: { slug: "notes", markdown: "![화면](./shot.png)\n\n![웹](https://x.test/a.png)\n\n![없음](./missing.png)" } });
    expect(result.content[0].text).toBe("![화면](/media/00000000000000a1)\n\n![웹](https://x.test/a.png)\n\n![없음](./missing.png)");
    expect(uploads).toEqual([{ search: "?page=notes&name=shot.png", type: "image/png", size: 8 }]);
    const made = await client.callTool({ name: "create_page", arguments: { title: "새", markdown: "![s](./shot.png)" } });
    expect(made.content[0].text).toBe("![s](/media/00000000000000a2)");
    expect(uploads[1].search).toBe("?name=shot.png");
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
