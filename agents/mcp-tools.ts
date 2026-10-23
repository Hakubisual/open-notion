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
  "Acard is a Notion-style notes app. Read and write pages as Markdown; people read and edit the same pages in a block editor.",
  "Prefer read_blocks and update_block/insert_blocks/delete_block over replacing a page. Pass the version you read as expected_version; on status 409 re-read and merge.",
  "To ask a person to decide something, write a callout line: > [!decision] <one sentence>.",
  "Read a page before replacing it and prefer append_to_page for logs. Pass expectedUpdated from read_page to update_page; a conflict means re-read and merge.",
  "PARTS: list_parts returns the part types (badge, table, chart, heatmap, dag, plus parts made from HTML blocks) with their JSON data schema and a ready fence; write the fence with JSON data only, or change one with set_part_data.",
  "COMPONENTS: for a summary, key numbers (stats), steps, a comparison or a timeline, call list_components and write a ```acard-ui {\"ui\":\"<id>\"} fence with JSON data only (no HTML, no CSS); change one later with set_component_data. Example:\n```acard-ui {\"ui\":\"stat\"}\n{\"label\":\"가입 전환율\",\"value\":\"18.4%\",\"delta\":\"+12%\"}\n```",
  "HTML BLOCKS: patch_block changes part of an existing HTML block with find/replace pairs.",
  "COLUMNS: to put blocks side by side (2-4 columns), put 'acard_meta: 1' in the front matter and wrap them in marker lines: <!--acard columns {\"widths\":[0.5,0.5]}--> (widths optional), then <!--acard column--> before each column's blocks, then <!--acard /columns-->. The blocks between markers are ordinary markdown written without extra indent (a callout, heading, list, - [db_ref] or button each); read_page returns the same lines, so keep them when you update the page.",
  "LONG DOCUMENTS: one write takes up to 400,000 characters and 2,000 blocks per page (a block is a paragraph, list item, table, code block or heading). A 50 KB markdown write (~1,000 blocks) saves in a few seconds. Bigger than that: create the page with the first sections, then add the rest with append_to_page in pieces of about 30-50 KB split at ## headings, or write each large section as its own sub-page (create_page with parent). Writes are safe to retry: a page or an append is saved whole or not at all, and sending the same create_page or append_to_page again (same content, or the same idempotencyKey) returns the first result (duplicate: true) instead of a second page or a second copy. After a timeout, do not create the page under a new title; send the same call again or read_page / list_pages to see whether it landed.",
  "BLOCK STYLE: to color a block, set a callout icon, size a widget embed (any https widget URL in '- [embed] <url>') or make a heading fold its indented blocks, put 'acard_meta: 1' in the page front matter and write one line right under that block: <!--acard {\"color\":\"yellow_background\",\"icon\":\"🔥\",\"height\":480,\"toggle\":true}--> (colors: gray brown orange yellow green blue purple pink red, plain or _background). read_page returns pages in this form; keep the lines when you rewrite. Heading 4 is '#### '.",
  "ACTION BUTTONS: a '- [button] <label>' line with a comment under it like <!--acard {\"actions\":[{\"type\":\"create_row\",\"database\":\"<db slug>\",\"template\":\"<template id>\",\"values\":{\"<property id>\":{\"relative\":\"today\"}}},{\"type\":\"open\",\"target\":\"created\"}],\"icon\":\"➕\",\"color\":\"blue\"}--> (acard_meta: 1 front matter) adds a database row when a person presses it; also {\"type\":\"confirm\",\"message\":\"...\"}. Keep these lines as read_page returns them. There is no tool to press a button, and actions on a database you may not write are not saved.",
  "PEOPLE'S EDITS: a paragraph a person edited is protected. update_page, update_block and delete_block never change it; if your new text differs, Acard keeps the person's paragraph and attaches your text under it as an update suggestion the person accepts or dismisses (the result says suggestions: N). Do not retry to force it.",
  "CONTENTS: a '- [toc]' line shows a linked table of contents built from the page's headings.",
  "Never put secrets, tokens or passwords in pages. Full conventions: /AGENTS.md.",
  "IMAGES: markdown images with http(s) or data: sources are imported into Acard /media/ automatically on every write. The server cannot read your disk: for a local file (./shot.png, C:\\..., /Users/..., file://) call upload_media first and put the returned /media/ url in the markdown (the acard CLI bridge does this for you). A write result with imageWarnings lists images that stayed as outside links.",
].join("\n");

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  if (error instanceof OperationFailure) return { isError: true, content: [{ type: "text" as const, text: error.message }], structuredContent: { error: error.message, status: error.status } };
  throw error;
}

const idempotencyKey = z.string().max(200).optional().describe("Any unique string for this write (e.g. a UUID). Sending the same call again with the same key returns the first result instead of writing twice; use it when you may retry after a timeout.");
const markdown = z.string().describe("Markdown body. Optional YAML frontmatter: title, parent, icon, tags.");
const images = z.array(z.object({ src: z.string().describe("Local path, pasted:N, /media/, http(s) or data: url."), caption: z.string().describe("What is visible, one sentence."), time: z.string().optional() }))
  .optional().describe("Images you looked at, added under the markdown as agent images with captions (local paths are uploaded by the acard CLI). Prefer attach_images to place them next to a specific paragraph.");

// images[] on create/update/append becomes agent image lines at the end of the markdown (#33).
export function withImageList(input: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(input.images) || typeof input.markdown !== "string") return input;
  const list = (input.images as { src?: unknown; caption?: unknown; time?: unknown }[]).filter((i) => i && typeof i.src === "string" && i.src).slice(0, 8);
  const group = list.length > 1 ? " g=w" + Math.random().toString(36).slice(2, 7) : "";
  const lines = list.map((i) => "![" + String(i.caption ?? "").replace(/[\]\n]/g, " ").trim() + "](" + String(i.src).replace(/[()\s]/g, encodeURIComponent) + ' "' + (typeof i.time === "string" && /^\d{1,2}(?::\d{2}){1,2}$/.test(i.time) ? "t=" + i.time + " " : "") + "agent" + group + '")');
  const { images: _drop, ...rest } = input;
  return lines.length ? { ...rest, markdown: input.markdown.replace(/\s*$/, "") + "\n\n" + lines.join("\n") + "\n" } : rest;
}
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
      input = withImageList(input as Record<string, unknown>);
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
    "Create a page from markdown. Long documents: up to 2,000 blocks per page; over ~50 KB, create with the first sections and add the rest with append_to_page in 30-50 KB pieces split at ## headings, or use sub-pages. A retry of the same call (same content or idempotencyKey) returns the page already made (duplicate: true), never a second one. Frontmatter or arguments set title, parent slug, icon and tags. A page that groups other pages (a project, a topic) is a folder: create it with view: 'folder' and a one-line description, then write each long text as its own sub-page (parent = the folder); never put a long write-up into a folder page. Visuals (cards, tables with totals, charts, heatmaps, flows): use ```acard-part fences with JSON data from list_parts, not html-embed; a flow / pipeline / structure is the dag part (step cards + arrows), never stacked HTML cards. Checklist / 체크리스트 / to-do items: '- [ ] item' lines, or a table with a first column 완료 of '[ ]' cells when items have extra columns.",
    { markdown, title: z.string().optional(), parent: z.string().optional(), icon: z.string().optional(), tags: z.array(z.string()).optional(), view: z.enum(["folder", "article"]).optional(), description: z.string().max(200).optional(), images, idempotencyKey },
    "createPage",
    false,
  );
  tool(
    "update_page",
    "Replace a page's content with markdown. A page a person set to folder is refused with 409: write into a new sub-page (create_page with parent) instead. Keep existing ```acard-part and html-embed blocks as they are unless asked; to change one block use update_block, set_part_data (parts) or patch_block (HTML). Always pass expectedUpdated (the updated value from read_page). Without it, a page a person edited after the last agent write is refused with 409: re-read, merge, write again.",
    { slug, markdown, expectedUpdated: z.number().optional(), images },
    "updatePage",
    false,
  );
  tool("append_to_page", "Append markdown blocks to the end of a page without touching existing content. Use it to write a long document in pieces of 30-50 KB split at ## headings; the same piece sent again (same content or idempotencyKey) is not added twice (duplicate: true). Not for a folder page (409): add a sub-page there. Visuals: ```acard-part fences (list_parts), not html-embed. Checklist items: '- [ ] item' (checkable by the owner).", { slug, markdown, images, idempotencyKey }, "appendToPage", false);
  tool("list_databases", "List databases (tables).", {}, "listDatabases", true);
  tool("read_database", "Read a database's properties and rows.", { database: z.string() }, "readDatabase", true);
  tool("add_database_row", "Add a row to a database. ID (unique_id) properties are numbered by Acard; leave them out.", { database: z.string(), props }, "addDatabaseRow", false);
  tool("update_database_row", "Change cells of one database row; other cells keep their values.", { database: z.string(), row: z.string(), props }, "updateDatabaseRow", false);
  tool("list_decisions", "List open > [!decision] callouts across all pages.", {}, "listDecisions", true);
  for (const feature of features) {
    tool(feature.name, feature.description, feature.inputSchema(z), feature.operation, feature.scope === "read");
  }
  return server;
}
