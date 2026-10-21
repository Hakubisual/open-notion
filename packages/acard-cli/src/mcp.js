import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { authHeaders } from "./api.js";
import { rewriteLocalImages } from "./local-images.js";

const log = (msg) => process.stderr.write(`acard mcp: ${msg}\n`);

/** Local stdio MCP server that forwards tools/* to the remote Streamable HTTP endpoint. */
export async function runMcpProxy(cfg, version) {
  const client = new Client({ name: "acard-cli-proxy", version });
  const remote = new StreamableHTTPClientTransport(new URL(cfg.server + "/mcp"), {
    requestInit: { headers: authHeaders(cfg) },
  });
  try {
    await client.connect(remote);
  } catch (err) {
    log(`failed to connect to ${cfg.server}/mcp: ${err.message}`);
    if (err.code === 401 || /\b401\b|unauthori[sz]ed/i.test(err.message)) {
      log("인증 실패: Acard 설정 > 에이전트 연결 에서 토큰을 만든 뒤 ACARD_TOKEN 환경변수로 지정하세요.");
    }
    return 1;
  }
  const info = client.getServerVersion();
  log(`connected to ${cfg.server}/mcp (${info?.name ?? "unknown"} ${info?.version ?? ""})`);

  const server = new Server(
    { name: info?.name ?? "acard", version: info?.version ?? version },
    { capabilities: { tools: client.getServerCapabilities()?.tools ?? {} }, instructions: client.getInstructions() },
  );
  server.setRequestHandler(ListToolsRequestSchema, (req) => client.listTools(req.params));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const local = await rewriteLocalImages(cfg, req.params.name, req.params.arguments);
    if (local.uploaded) log(`로컬 이미지·영상 ${local.uploaded}개를 올리고 주소를 바꿨어요`);
    const out = await client.callTool({ ...req.params, arguments: local.args });
    if (local.errors.length) out.content = [...(out.content || []), { type: "text", text: "로컬 이미지를 올리지 못했어요: " + local.errors.join("; ") }];
    return out;
  });

  const local = new StdioServerTransport();
  const closed = new Promise((resolve) => {
    server.onclose = resolve;
  });
  await server.connect(local);
  await closed;
  await client.close().catch((err) => log(`close failed: ${err.message}`));
  return 0;
}
