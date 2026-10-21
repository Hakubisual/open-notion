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
  "CHECKLISTS: when the user asks for a checklist, 체크리스트, to-do or 할 일 list, write each item as a to-do line '- [ ] item' (done: '- [x] item'); the owner ticks those boxes in Acard. Put extra fields on the same line ('- [ ] 게임테스트실무 — 마감 10/21 07:00'). If the items need several columns (due date, owner...), use a table whose first column is 완료 with '[ ]' in every row (| 완료 | 과목 | 마감 |); those cells are checkboxes. A table without '[ ]' cells has nothing to check.",
  "VISUALS = PARTS: when a page needs a visual (status cards, a table with totals or shares, a chart, a heatmap, a step flow / DAG), do NOT write a new HTML block (html-embed): call list_parts, pick the part and write its fence with only JSON data (```acard-part {\"part\":\"chart\",\"v\":1} then the data, then ```), or call set_part_data. Parts compute sums, averages and ratios themselves and follow the page's dark theme; never put code, CSS or computed totals in the data. To change numbers in an existing part, call set_part_data with only the new data. A 5-block visual costs about 5% of the tokens as parts. Write an HTML block only when no part fits (an interactive demo, a custom layout) and the user asked for it. An HTML block follows the page's light/dark theme and sizes itself to its content: color it only with the Acard CSS variables (var(--fg), var(--fg-dim), var(--bg), var(--bg-soft), var(--surface), var(--line), var(--accent), var(--tag-<green|blue|purple|red|yellow|orange|pink|gray>-bg/-fg)) and never hard-code white/black backgrounds or text, font families, a body font size or a fixed height; plain table, h2-h4, .card, .pill/.tag and .muted already get the page look.",
  "FLOWS = DAG PART: any flow, process, pipeline, workflow or structure (전체 흐름, 구조도, 구성도, 작업 흐름) is the dag part with data only: nodes [{id, label, desc, items, tags:[{text, kind: agent|api|lib|person}], gate, state}], edges [[from, to, label?]], numbered, callout {title, text}. It draws step cards joined by arrows, left to right on wide screens and top-down on phones, in the page theme. Never hand-write HTML cards stacked with arrows (▼, →) or white/black boxes: such a write still saves but its result carries htmlWarnings naming the part to use. A list of items with the same fields (구분표) is the table part; text that does not fit a part goes into normal paragraphs next to it.",
  "EDITING HTML BLOCKS: to change an existing HTML block, do not resend the whole block: call patch_block with only the exact text to replace (find/replace pairs). If that HTML block draws cards, a table, a chart, a heatmap or a flow, tell the user it could become a part with data (smaller, follows the theme) and offer to convert it with set_part_data.",
  "COLUMNS: to put blocks side by side (2-4 columns), put 'acard_meta: 1' in the front matter and wrap them in marker lines: <!--acard columns {\"widths\":[0.5,0.5]}--> (widths optional), then <!--acard column--> before each column's blocks, then <!--acard /columns-->. The blocks between markers are ordinary markdown written without extra indent (a callout, heading, list, - [db_ref] or button each); read_page returns the same lines, so keep them when you update the page.",
  "LONG DOCUMENTS: one write takes up to 400,000 characters and 2,000 blocks per page (a block is a paragraph, list item, table, code block or heading). A 50 KB markdown write (~1,000 blocks) saves in a few seconds. Bigger than that: create the page with the first sections, then add the rest with append_to_page in pieces of about 30-50 KB split at ## headings, or write each large section as its own sub-page (create_page with parent). Writes are safe to retry: a page or an append is saved whole or not at all, and sending the same create_page or append_to_page again (same content, or the same idempotencyKey) returns the first result (duplicate: true) instead of a second page or a second copy. After a timeout, do not create the page under a new title; send the same call again or read_page / list_pages to see whether it landed.",
  "To ask the owner to decide something, write a callout line: > [!decision] 주인님 결정 필요: <one sentence>.",
  "BLOCK STYLE: to color a block, set a callout icon, size a widget embed (any https widget URL in '- [embed] <url>') or make a heading fold its indented blocks, put 'acard_meta: 1' in the page front matter and write one line right under that block: <!--acard {\"color\":\"yellow_background\",\"icon\":\"🔥\",\"height\":480,\"toggle\":true}--> (colors: gray brown orange yellow green blue purple pink red, plain or _background). read_page returns pages in this form; keep the lines when you rewrite. Heading 4 is '#### '.",
  "ACTION BUTTONS: a '- [button] <label>' line with a comment under it like <!--acard {\"actions\":[{\"type\":\"create_row\",\"database\":\"<db slug>\",\"template\":\"<template id>\",\"values\":{\"<property id>\":{\"relative\":\"today\"}}},{\"type\":\"open\",\"target\":\"created\"}],\"icon\":\"➕\",\"color\":\"blue\"}--> (acard_meta: 1 front matter) adds a database row when a person presses it; also {\"type\":\"confirm\",\"message\":\"...\"}. Keep these lines as read_page returns them. There is no tool to press a button, and actions on a database you may not write are not saved.",
  "READ AT A GLANCE: a page you write starts with a three-line summary callout ('> [!summary] 세 줄 요약' then three '> 1. ...' lines: what happened, what changed, what is left), then short sections (## heading, 2-4 sentences each). End each section with its sources on one callout line: '> [!sources] 세션 <journal session id or title> · 파일 `path` · 커밋 <short sha>' (only the ones you actually used).",
  "PEOPLE'S EDITS: a paragraph a person edited is protected. update_page, update_block and delete_block never change it; if your new text differs, Acard keeps the person's paragraph and attaches your text under it as an update suggestion the person accepts or dismisses (the result says suggestions: N). Do not retry to force it.",
  "TABLE OF CONTENTS: never hand-write a '## 목차' list; put one '- [toc]' line where it goes and the reader builds linked contents from the page's headings. A workflow, pipeline or structure diagram is a dag part (list_parts), not stacked HTML cards or an uploaded picture of boxes and arrows. To change one section, edit its blocks (read_blocks, update_block, insert_blocks), not a text replace over the whole page markdown.",
  "Never put secrets, tokens or passwords in pages. Full conventions: /AGENTS.md.",
  "IMAGES: markdown images with http(s) or data: sources are imported into Acard /media/ automatically on every write. The server cannot read your disk: for a local file (./shot.png, C:\\..., /Users/..., file://) call upload_media first and put the returned /media/ url in the markdown (the acard CLI bridge does this for you). A write result with imageWarnings lists images that stayed as outside links.",
  "WHAT YOU SAW: when you looked at an image (a screenshot or image file you opened, an image the user pasted, a video) and you write about it in a page, do not leave only text: attach_images (or attach_video for a video file) right after the paragraph it supports, with a caption saying what is visible, and let the paragraph summarize what the images show. Local paths and pasted:N are uploaded by the acard CLI on the user's machine; nothing is uploaded unless you attach it.",
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

const idempotencyKey = z.string().max(200).optional().describe("Any unique string for this write (e.g. a UUID). Sending the same call again with the same key returns the first result instead of writing twice; use it when you may retry after a timeout.");
const markdown = z.string().describe("Markdown body. Optional YAML frontmatter: title, parent, icon, tags.");
const images = z.array(z.object({ src: z.string().describe("Local path, pasted:N, /media/, http(s) or data: url."), caption: z.string().describe("What is visible, one Korean sentence."), time: z.string().optional() }))
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
  tool("list_decisions", "List open '주인님 결정 필요' decision callouts across all pages.", {}, "listDecisions", true);
  for (const feature of features) {
    tool(feature.name, feature.description, feature.inputSchema(z), feature.operation, feature.scope === "read");
  }
  return server;
}
