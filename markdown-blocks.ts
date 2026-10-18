// 마크다운 -> 블록 변환기.
// 도리는 마크다운을 쓰고(정본), 오너는 브라우저 에디터에서 같은 페이지를 블록으로 고친다.
// 그래서 마크다운을 블록 목록으로 바꾸는 규칙이 한 곳에만 있어야 한다. 빌드와 시드가 이걸 쓴다.

export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulleted"
  | "numbered"
  | "to_do"
  | "toggle"
  | "callout"
  | "quote"
  | "code"
  | "divider"
  | "database"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "embed"
  | "bookmark"
  | "columns"
  | "table"
  | "equation"
  | "toc"
  | "breadcrumb"
  | "button"
  | "progress"
  | "db_ref"
  | "diagram"
  | "chart"
  | "visual"
  | "html";

// Visual blocks are fenced blocks: ```mermaid / ```acard-chart / ```acard-visual, with an optional JSON meta object
// after the language. Format: research/visuals/format.md.
const VISUAL_FENCES: Record<string, BlockType> = { mermaid: "diagram", "acard-chart": "chart", "acard-visual": "visual", "html-embed": "html" };
const VISUAL_LANGS: Record<string, string> = { diagram: "mermaid", chart: "acard-chart", visual: "acard-visual", html: "html-embed" };
const VISUAL_META_KEYS = ["caption", "alt", "height"];

function visualMeta(info: string): Record<string, unknown> | null {
  if (!info.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(info);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, unknown> = {};
    for (const key of VISUAL_META_KEYS) {
      if (key === "height" ? Number.isFinite(parsed[key]) : typeof parsed[key] === "string" && parsed[key]) out[key] = parsed[key];
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export type Block = {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
  indent?: number;
  meta?: Record<string, unknown>;
};

export type ParsedPage = {
  title: string;
  slug: string;
  blocks: Block[];
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return "b" + counter.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableDivider(line: string): boolean {
  return /^\s*\|[\s:|=-]+\|\s*$/.test(line);
}

function isSimpleTableDivider(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.some((cell) => cell.includes("="));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const push = (type: BlockType, text: string, extra: Partial<Block> = {}) => {
    blocks.push({ id: nextId(), type, text, indent: currentIndent, ...extra });
  };
  let currentIndent = 0;

  while (i < lines.length) {
    const raw = lines[i];
    currentIndent = Math.floor((/^ */.exec(raw)?.[0].length ?? 0) / 2);
    const line = raw.trim();

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const ticks = /^`+/.exec(line.trim())![0];
      const info = line.trim().slice(ticks.length).trim();
      const langMatch = /^(\S*)\s*(.*)$/.exec(info)!;
      const visual = VISUAL_FENCES[langMatch[1]];
      const lang = visual ? langMatch[1] : info;
      const close = new RegExp("^`{" + ticks.length + ",}\\s*$");
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(visual || ticks.length > 3 ? close.test(lines[i].trim()) : /^```/.test(lines[i].trim()))) {
        body.push(lines[i].startsWith("  ".repeat(currentIndent)) ? lines[i].slice(currentIndent * 2) : lines[i]);
        i += 1;
      }
      i += 1;
      if (visual) {
        const meta = visualMeta(langMatch[2]);
        push(visual, body.join("\n"), meta ? { meta } : {});
      } else push("code", body.join("\n"), lang ? { meta: { lang } } : {});
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      push("divider", "");
      i += 1;
      continue;
    }

    // 파이프 표는 데이터베이스 블록이 되고, 첫 행이 열 이름이다.
    // 구분 행에 = 가 들어가면 데이터베이스가 아니라 그냥 표(간단 표)가 된다.
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const simple = isSimpleTableDivider(lines[i + 1]);
      const rows: Record<string, string>[] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitTableRow(lines[i]);
        const row: Record<string, string> = {};
        header.forEach((name, index) => {
          row[name] = cells[index] ?? "";
        });
        rows.push(row);
        i += 1;
      }
      if (simple) {
        const body = rows.map((row) => header.map((name) => row[name] ?? ""));
        push("table", header.join(" | "), { meta: { columns: header, rows: body, header: true } });
      } else {
        push("database", header.join(" | "), { meta: { columns: header, rows } });
      }
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const type = ("heading" + level) as BlockType;
      push(type, heading[2].trim());
      i += 1;
      continue;
    }

    // 토글: - [toggle] 제목  (아래에 들여쓴 줄이 있으면 그 줄들이 자식이 된다)
    const toggle = /^(\s*)[-*]\s+\[toggle\]\s*(.*)$/.exec(line);
    if (toggle) {
      const indent = currentIndent;
      push("toggle", toggle[2].trim(), { indent });
      i += 1;
      continue;
    }

    // 미디어·레이아웃 한 줄 블록: - [video] 주소, - [button] 라벨 | 주소, - [progress] 70 라벨, - [toc]
    const bracket = /^(\s*)[-*]\s+\[(video|audio|file|embed|bookmark|button|progress|toc|breadcrumb|db_ref)\]\s*(.*)$/.exec(line);
    if (bracket) {
      const kind = bracket[2] as BlockType;
      const rest = bracket[3].trim();
      if (kind === "db_ref") {
        push("db_ref", "", { meta: { database: rest } });
      } else if (kind === "video" || kind === "audio" || kind === "embed" || kind === "bookmark") {
        push(kind, "", { meta: { url: rest } });
      } else if (kind === "file") {
        const cut = rest.indexOf(" ");
        const url = cut >= 0 ? rest.slice(0, cut) : rest;
        const name = cut >= 0 ? rest.slice(cut + 1).trim() : "";
        push("file", name, { meta: { url, name } });
      } else if (kind === "button") {
        const cut = rest.indexOf("|");
        push("button", (cut >= 0 ? rest.slice(0, cut) : rest).trim(), { meta: { url: cut >= 0 ? rest.slice(cut + 1).trim() : "" } });
      } else if (kind === "progress") {
        const m = /^(\d+)\s*%?\s*(.*)$/.exec(rest);
        push("progress", m ? m[2] : rest, { meta: { value: m ? Math.min(100, Math.max(0, Number(m[1]))) : 0, color: "blue" } });
      } else {
        push(kind, "");
      }
      i += 1;
      continue;
    }

    // 이미지 한 줄: ![캡션](주소 "60")  — 마지막 따옴표 숫자는 폭(%) 이다
    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"(\d+)")?\)\s*$/.exec(line);
    if (image) {
      push("image", image[1], { meta: { src: image[2], width: image[3] ? Math.min(100, Math.max(10, Number(image[3]))) : 100 } });
      i += 1;
      continue;
    }

    // 수식 겉치장: $$ 와 $$ 사이
    if (/^\$\$\s*$/.test(line.trim())) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i].trim())) {
        body.push(lines[i].startsWith("  ".repeat(currentIndent)) ? lines[i].slice(currentIndent * 2) : lines[i]);
        i += 1;
      }
      i += 1;
      push("equation", body.join("\n").trim());
      continue;
    }

    // 열 나누기 겉치장: :::cols 와 ::: 사이, --- 로 열을 나눈다 (최대 3열)
    if (/^:::\s*cols?\d*\s*$/i.test(line.trim())) {
      const cols: { text: string }[] = [];
      let current: string[] = [];
      i += 1;
      while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) {
        if (/^-{3,}$/.test(lines[i].trim())) {
          cols.push({ text: current.join("\n").trim() });
          current = [];
          i += 1;
          continue;
        }
        current.push(lines[i]);
        i += 1;
      }
      i += 1;
      cols.push({ text: current.join("\n").trim() });
      // 3열을 넘으면 남은 묶음을 버리지 않고 마지막 열로 합친다.
      while (cols.length > 3) {
        const extra = cols.pop();
        cols[cols.length - 1].text = (cols[cols.length - 1].text + "\n" + extra.text).trim();
      }
      while (cols.length < 2) cols.push({ text: "" });
      push("columns", cols.map((c) => (c.text.split("\n")[0] ?? "")).join(" | "), { meta: { columns: cols } });
      continue;
    }

    // 주소만 있는 줄은 북마크 블록이 된다 (노션에서 주소를 붙여넣으면 카드가 되는 것과 같다)
    if (/^https?:\/\/\S+$/.test(line.trim())) {
      push("bookmark", "", { meta: { url: line.trim() } });
      i += 1;
      continue;
    }

    // 할 일: - [ ] / - [x]
    const todo = /^(\s*)[-*]\s+\[( |x|X)\]\s*(.*)$/.exec(line);
    if (todo) {
      const indent = currentIndent;
      push("to_do", todo[3].trim(), { indent, checked: todo[2].toLowerCase() === "x" });
      i += 1;
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const indent = currentIndent;
      push("bulleted", bullet[2].trim(), { indent });
      i += 1;
      continue;
    }
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      const indent = currentIndent;
      push("numbered", numbered[2].trim(), { indent });
      i += 1;
      continue;
    }

    // 콜아웃: > [!note] 내용  (다음 줄부터 이어지는 인용은 같은 콜아웃)
    const callout = /^>\s*\[!(\w+)\]\s*(.*)$/i.exec(line);
    if (callout) {
      const parts = [callout[2].trim()];
      i += 1;
      while (i < lines.length && /^>\s?/.test(lines[i].trimStart()) && lines[i].trim() !== ">") {
        parts.push(lines[i].trimStart().replace(/^>\s?/, "").trimEnd());
        i += 1;
      }
      push("callout", parts.join("\n").trim(), { meta: { tone: callout[1].toLowerCase() } });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trimStart())) {
        parts.push(lines[i].trimStart().replace(/^>\s?/, "").trimEnd());
        i += 1;
      }
      push("quote", parts.join("\n").trim());
      continue;
    }

    const parts: string[] = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const peek = lines[i];
      if (
        Math.floor((/^ */.exec(peek)?.[0].length ?? 0) / 2) !== currentIndent ||
        peek.trim() === "" ||
        /^(#{1,6})\s+/.test(peek.trim()) ||
        /^(\s*)[-*+]\s+/.test(peek) ||
        /^(\s*)\d+[.)]\s+/.test(peek) ||
        /^>\s?/.test(peek) ||
        /^```/.test(peek.trim()) ||
        isTableRow(peek) ||
        /^https?:\/\/\S+$/.test(peek.trim()) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(peek.trim())
      ) {
        break;
      }
      parts.push(peek.trim());
      i += 1;
    }
    push("paragraph", parts.join(" ").trim());
  }

  return blocks;
}

function tableCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "&#124;").replace(/\n/g, " ");
}

// Rich runs keep only the marks the reader's inline() renders back: bold, code and links.
function richMarkdown(block: Block): string {
  const runs = block.meta?.richText;
  if (!Array.isArray(runs) || block.type === "code") return block.text;
  return runs.map((run: any) => {
    let text = String(run?.text ?? "");
    if (!text.trim()) return text;
    if (run.code) text = "`" + text + "`";
    if (run.bold) text = "**" + text + "**";
    const href = run.mention?.type === "page" ? "/" + run.mention.slug + "/" : run.href;
    if (typeof href === "string" && /^(https?:\/\/|\/)/.test(href)) text = "[" + text + "](" + href + ")";
    return text;
  }).join("");
}

// Two-space indentation preserves child hierarchy without replacing existing flat callers.
// Every block type has a markdown form that markdownToBlocks reads back as the same type.
export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map((block) => {
    const meta = (block.meta || {}) as Record<string, any>;
    let text = richMarkdown(block);
    switch (block.type) {
      case "heading1": text = "# " + text; break;
      case "heading2": text = "## " + text; break;
      case "heading3": text = "### " + text; break;
      case "bulleted": text = "- " + text; break;
      case "numbered": text = "1. " + text; break;
      case "to_do": text = "- [" + (block.checked ? "x" : " ") + "] " + text; break;
      case "toggle": text = "- [toggle] " + text; break;
      case "callout": text = "> [!" + String(block.meta?.tone || "note") + "] " + text.replace(/\n/g, "\n> "); break;
      case "quote": text = text.split("\n").map(line => "> " + line).join("\n"); break;
      case "code": text = "```" + String(block.meta?.lang || "") + "\n" + text + "\n```"; break;
      case "diagram": case "chart": case "visual": case "html": {
        const picked: Record<string, unknown> = {};
        for (const key of VISUAL_META_KEYS) if (meta[key] !== undefined && meta[key] !== "" && meta[key] !== null) picked[key] = meta[key];
        const fence = "`".repeat(Math.max(3, ...[...block.text.matchAll(/^\s*(`{3,})/gm)].map((m) => m[1].length + 1)));
        text = fence + VISUAL_LANGS[block.type] + (Object.keys(picked).length ? " " + JSON.stringify(picked) : "") + "\n" + block.text + "\n" + fence;
        break;
      }
      case "divider": text = "---"; break;
      case "database": {
        const columns = Array.isArray(block.meta?.columns) ? block.meta.columns.map(String) : [];
        const rows = Array.isArray(block.meta?.rows) ? block.meta.rows : [];
        const rowText = (cells: unknown[]) => "| " + cells.map(tableCell).join(" | ") + " |";
        text = [rowText(columns), rowText(columns.map(() => "---")), ...rows.map(row => rowText(columns.map(column => String(row[column] ?? "")) ))].join("\n");
        break;
      }
      case "table": {
        const columns = Array.isArray(meta.columns) ? meta.columns.map(String) : [];
        const rows = Array.isArray(meta.rows) ? meta.rows : [];
        const rowText = (cells: unknown[]) => "| " + cells.map(tableCell).join(" | ") + " |";
        text = [rowText(columns), rowText(columns.map(() => "===")), ...rows.map((row: unknown[]) => rowText(columns.map((_c: string, index: number) => Array.isArray(row) ? row[index] : "")))].join("\n");
        break;
      }
      case "image": text = "![" + block.text.replace(/[\]\n]/g, " ") + "](" + String(meta.src || "") + (meta.width && Number(meta.width) !== 100 ? ' "' + Number(meta.width) + '"' : "") + ")"; break;
      case "video": case "audio": case "embed": text = "- [" + block.type + "] " + String(meta.url || ""); break;
      case "bookmark": text = /^https?:\/\/\S+$/.test(String(meta.url || "")) ? String(meta.url) : "- [bookmark] " + String(meta.url || ""); break;
      case "file": text = "- [file] " + String(meta.url || "") + (block.text || meta.name ? " " + (block.text || meta.name) : ""); break;
      case "button": text = "- [button] " + block.text + (meta.url ? " | " + meta.url : ""); break;
      case "progress": text = "- [progress] " + Math.min(100, Math.max(0, Number(meta.value) || 0)) + (block.text ? " " + block.text : ""); break;
      case "toc": case "breadcrumb": text = "- [" + block.type + "]"; break;
      case "db_ref": text = "- [db_ref] " + String(meta.database || ""); break;
      case "equation": text = "$$\n" + block.text + "\n$$"; break;
      case "columns": {
        const cols = Array.isArray(meta.columns) ? meta.columns : [];
        text = [":::cols", ...cols.map((col: { text?: string }, index: number) => (index ? "---\n" : "") + String(col?.text ?? "")), ":::"].join("\n");
        break;
      }
      case "paragraph": break;
    }
    const pad = "  ".repeat(Math.max(0, block.indent || 0));
    return text.split("\n").map(line => pad + line).join("\n");
  }).join("\n\n");
}

// 블록 안에서 나가는 링크를 뽑는다 (백링크용). [[슬러그]] 와 [글](/슬러그/) 둘 다 인정한다.
export function blockLinks(blocks: Block[]): string[] {
  const found = new Set<string>();
  const text = blocks.map((block) => block.text).join("\n");
  for (const match of text.matchAll(/\[\[([^\]\s]+)\]\]/g)) found.add(match[1]);
  for (const match of text.matchAll(/\]\(\/([^)\s#?]+)\/?\)/g)) {
    const slug = match[1].replace(/\/$/, "");
    if (slug && !slug.includes("/")) found.add(slug);
  }
  return [...found];
}

export function blocksHash(blocks: Block[]): string {
  const text = JSON.stringify(blocks);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16);
}
