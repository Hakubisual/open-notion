import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js";
import { z } from "zod";

export type AgentPrincipal = {
  readonly name: string;
  readonly via: "token" | "oauth";
  readonly scopes: readonly string[];
};

export type AgentOperation =
  | "whoami"
  | "listPages"
  | "readPage"
  | "createPage"
  | "updatePage"
  | "appendToPage"
  | "listDatabases"
  | "readDatabase"
  | "addDatabaseRow"
  | "updateDatabaseRow"
  | "listDecisions"
  | (string & {});

export type FeatureMcpTool = {
  name: string;
  description: string;
  inputSchema: (zod: typeof z) => ZodRawShapeCompat;
  scope: "read" | "write";
  operation: string;
};

export type RunOperation = (operation: AgentOperation, input: Record<string, unknown>) => Promise<unknown>;

export class OperationFailure extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const INSTRUCTIONS = [
  "Acard is the owner's notes app. You write markdown; the owner (주인님) reads and edits it in a Notion-like UI.",
  "Call get_agent_skills first to read the owner's editable agent-skills page. Prefer read_blocks and update_block/insert_blocks/delete_block over full replacement. Pass its version as expected_version; on status 409 re-read and merge.",
  "Read a page before replacing it and prefer append_to_page for logs. Pass expectedUpdated from read_page to update_page; a conflict means re-read and merge.",
  "To ask the owner to decide something, write a callout line: > [!decision] 주인님 결정 필요: <one sentence>.",
  "Never put secrets, tokens or passwords in pages. Full conventions: /AGENTS.md.",
  "IMAGES: markdown images with http(s) or data: sources are imported into Acard /media/ automatically on every write. The server cannot read your disk: for a local file (./shot.png, C:\\..., /Users/..., file://) call upload_media first and put the returned /media/ url in the markdown (the acard CLI bridge does this for you). A write result with imageWarnings lists images that stayed as outside links.",
  "FIRST: at the start of every session call acard_first_run (no arguments). If the user just connected it tells you to look at the current project folder yourself and ask the user in your chat 'Acard에 이 프로젝트 문서들을 정리해서 올릴까요?'; send project content with acard_setup_project only after they say yes. Once a project is set up it returns the open task list: read it before working, and at the end of the session update that page (check done items, add new ones).",
  "AUTO-RECORD (always on, every conversation, without asking): the user relies on Acard to keep their notes up to date from this chat. Do not ask permission and do not skip it because the chat is casual; only stop if the user says so in this conversation.",
  "1) On your first reply of a conversation or task call journal_start {title, goal} and keep the session id.",
  "2) After every reply (or at least whenever a topic or step finishes) call journal_log with a 1-3 sentence summary of what was asked, answered or decided; batch with entries[]. Also log plans, decisions and why, errors and open questions; data.files = paths touched.",
  "3) When something is worth keeping (an idea, a plan, a decision, a how-to, research), write it as a human-readable note: list_pages/read_page to find an existing page, then append_to_page or update_page; create_page only if none fits.",
  "4) Save durable preferences and facts with journal_memory. When the task or conversation wraps up call journal_end {summary, outcome}.",
  "Keep calls small and quiet: record in the background, never instead of answering.",
].join("\n");

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  if (error instanceof OperationFailure) return { isError: true, content: [{ type: "text" as const, text: error.message }], structuredContent: { error: error.message, status: error.status } };
  throw error;
}

const markdown = z.string().describe("Markdown body. Optional YAML frontmatter: title, parent, icon, tags.");
const slug = z.string().describe("Page slug, as returned by list_pages.");
const props = z.record(z.string(), z.unknown()).describe("Cell values keyed by property id or property name.");

export function createAcardMcpServer(run: RunOperation, version: string, features: readonly FeatureMcpTool[] = []): McpServer {
  const server = new McpServer(
    { name: "acard", version },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  const tool = (
    name: string,
    description: string,
    shape: ZodRawShapeCompat,
    operation: AgentOperation,
    readOnly: boolean,
  ) => {
    const callback: ToolCallback<ZodRawShapeCompat> = async (input) => {
      await run("firstRunMark", {}).catch(() => undefined);
      const record = async (ok: boolean, error?: unknown) => {
        if (name.startsWith("journal_") || name.startsWith("acard_") || name === "whoami" || name === "get_agent_skills") return;
        const target = (input as Record<string, unknown>).slug ?? (input as Record<string, unknown>).page ?? (input as Record<string, unknown>).database;
        await run("journalAuto", { tool: name, target: typeof target === "string" ? target : undefined, ok, error: error instanceof Error ? error.message : undefined }).catch(() => undefined);
      };
      try {
        const value = await run(operation, input);
        await record(true);
        return result(value);
      } catch (error) {
        await record(false, error);
        return failure(error);
      }
    };
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } },
      callback,
    );
  };

  tool("whoami", "Show which agent this connection is and its scopes.", {}, "whoami", true);
  tool("list_pages", "List pages, or search titles and text when query is given.", { query: z.string().optional() }, "listPages", true);
  tool("read_page", "Read one page as markdown with frontmatter, its last authors and its updated timestamp.", { slug }, "readPage", true);
  tool(
    "create_page",
    "Create a page from markdown. Frontmatter or arguments set title, parent slug, icon and tags.",
    { markdown, title: z.string().optional(), parent: z.string().optional(), icon: z.string().optional(), tags: z.array(z.string()).optional() },
    "createPage",
    false,
  );
  tool(
    "update_page",
    "Replace a page's content with markdown. Pass expectedUpdated from read_page to avoid overwriting newer edits.",
    { slug, markdown, expectedUpdated: z.number().optional() },
    "updatePage",
    false,
  );
  tool("append_to_page", "Append markdown blocks to the end of a page without touching existing content.", { slug, markdown }, "appendToPage", false);
  tool("list_databases", "List databases (tables).", {}, "listDatabases", true);
  tool("read_database", "Read a database's properties and rows.", { database: z.string() }, "readDatabase", true);
  tool("add_database_row", "Add a row to a database.", { database: z.string(), props }, "addDatabaseRow", false);
  tool("update_database_row", "Change cells of one database row; other cells keep their values.", { database: z.string(), row: z.string(), props }, "updateDatabaseRow", false);
  tool("list_decisions", "List open '주인님 결정 필요' decision callouts across all pages.", {}, "listDecisions", true);
  for (const feature of features) {
    tool(feature.name, feature.description, feature.inputSchema(z), feature.operation, feature.scope === "read");
  }
  return server;
}
