// CSV reader + Notion property type inference for the importer (#129). Pure functions, no DOM / Node APIs: the Worker
// inlines this file next to import-plan.ts, so every top-level name starts with "imp".
//   impParseCsv(text)                       -> string[][]              (BOM, RFC-4180 quotes, CRLF/LF/CR)
//   impInferProperty(name, values, index)   -> { type, config }        (title / checkbox / number / date / url / email /
//                                                                        relation / multi_select / select / status / text)
//   impCellValue(prop, raw)                 -> value for db-model normaliseCellValue (option NAMES, relation target paths)
//   impNotionKeyValueLines(body, headers)   -> { values, rest }        (strips "Key: value" lines of a Notion row page)
import type { ImpProperty } from "./import-plan.ts";

export type ImpInferred = { type: string; config: Record<string, unknown> };
export type ImpDateValue = { start: string; end: string | null };

// db-model OPTION_COLORS without "default".
export const impOptionColors = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export function impParseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const n = src.length;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < n) {
    let field = "";
    let quoted = false;
    if (src.charCodeAt(i) === 34) {
      quoted = true;
      let start = ++i;
      for (;;) {
        const q = src.indexOf('"', start);
        if (q < 0) {
          field += src.slice(start);
          i = n;
          break;
        }
        if (src.charCodeAt(q + 1) === 34) {
          field += src.slice(start, q + 1);
          start = q + 2;
          continue;
        }
        field += src.slice(start, q);
        i = q + 1;
        break;
      }
    }
    // unquoted text, or stray text after a closing quote, up to the next delimiter
    let j = i;
    while (j < n) {
      const d = src.charCodeAt(j);
      if (d === 44 || d === 10 || d === 13) break;
      j++;
    }
    field += src.slice(i, j);
    i = j;
    if (i >= n) {
      if (row.length || quoted || field !== "") row.push(field);
      break;
    }
    const d = src.charCodeAt(i++);
    if (d === 44) {
      row.push(field);
      if (i >= n) row.push("");
      continue;
    }
    if (d === 13 && src.charCodeAt(i) === 10) i++;
    if (row.length || quoted || field !== "") {
      row.push(field);
      rows.push(row);
    }
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

// ---------------------------------------------------------------- scalars
const IMP_URL = /^https?:\/\/\S+$/i;
const IMP_EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,24}$/;
const IMP_CURRENCY: Record<string, string> = { $: "dollar", "₩": "won", "€": "euro", "¥": "yen" };

export function impParseNumber(raw: string): { value: number; format: string } | null {
  let s = raw.trim().replace(/,/g, "");
  if (!s) return null;
  let format = raw.includes(",") ? "number_with_commas" : "number";
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  const cur = IMP_CURRENCY[s[0]];
  if (cur) {
    format = cur;
    s = s.slice(1);
    if (s.startsWith("-")) {
      neg = !neg;
      s = s.slice(1);
    }
  } else if (s.endsWith("%")) {
    format = "percent";
    s = s.slice(0, -1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const value = Number(s) * (neg ? -1 : 1);
  return Number.isFinite(value) ? { value, format } : null;
}

const IMP_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const IMP_TIME_EN = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i;
const IMP_TIME_KO = /^(오전|오후)\s*(\d{1,2}):(\d{2})$/;
const IMP_TIME_24 = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z?$/;
const IMP_DATE_EN = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(.+))?$/;
const IMP_DATE_KO = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s+(.+))?$/;
const IMP_DATE_ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(.+))?$/;

function impTime(text: string): string | null {
  const t = text.trim();
  let m = IMP_TIME_EN.exec(t);
  if (m) {
    if (Number(m[1]) < 1 || Number(m[1]) > 12) return null;
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === "PM") h += 12;
    return impHm(h, Number(m[2]));
  }
  m = IMP_TIME_KO.exec(t);
  if (m) {
    if (Number(m[2]) > 12) return null;
    let h = Number(m[2]) % 12;
    if (m[1] === "오후") h += 12;
    return impHm(h, Number(m[3]));
  }
  m = IMP_TIME_24.exec(t);
  if (m) return impHm(Number(m[1]), Number(m[2]));
  return null;
}

function impHm(h: number, min: number): string | null {
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

function impYmd(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1000) return null;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

// One point of a Notion date: "October 23, 2026 3:00 PM", "2026년 10월 23일 오후 3:00", "2026-10-23T15:00", "2026/10/23".
function impDatePoint(text: string): string | null {
  const t = text.trim();
  let day: string | null = null;
  let timeText: string | undefined;
  let m = IMP_DATE_KO.exec(t);
  if (m) {
    day = impYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    timeText = m[4];
  } else if ((m = IMP_DATE_ISO.exec(t))) {
    day = impYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    timeText = m[4];
  } else if ((m = IMP_DATE_EN.exec(t))) {
    const name = m[1].toLowerCase();
    const mo = IMP_MONTHS.findIndex((full) => full === name || (name.length === 3 && full.startsWith(name)));
    if (mo < 0) return null;
    day = impYmd(Number(m[3]), mo + 1, Number(m[2]));
    timeText = m[4];
  }
  if (!day) return null;
  if (timeText === undefined || timeText === "") return day;
  const time = impTime(timeText);
  return time ? day + "T" + time : null;
}

export function impParseDate(raw: string): ImpDateValue | null {
  let s = raw.trim().replace(/\s*\((?:GMT|UTC)[^)]*\)\s*$/i, "");
  if (!s) return null;
  const arrow = s.indexOf("→");
  if (arrow < 0) {
    const start = impDatePoint(s);
    return start ? { start, end: null } : null;
  }
  const start = impDatePoint(s.slice(0, arrow));
  if (!start) return null;
  const endText = s.slice(arrow + 1).trim();
  let end = impDatePoint(endText);
  if (!end) {
    // same-day range: "October 23, 2026 3:00 PM → 5:00 PM"
    const time = impTime(endText);
    if (!time) return null;
    end = start.slice(0, 10) + "T" + time;
  }
  return { start, end };
}

// "Title (Path%20To/Row%20<id>.md), Other (https://www.notion.so/Other-<id>?pvs=21)" -> decoded targets, or null.
const IMP_RELATION_ITEM = /(.+?) \((\S+?\.(?:md|html)|https?:\/\/(?:www\.)?notion\.so\/\S+?)\)(?:, |$)/y;

export function impRelationTargets(raw: string): string[] | null {
  const s = raw.trim();
  if (!s) return [];
  const out: string[] = [];
  IMP_RELATION_ITEM.lastIndex = 0;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = IMP_RELATION_ITEM.exec(s))) {
    out.push(impDecodePath(m[2]));
    consumed = IMP_RELATION_ITEM.lastIndex;
    if (consumed >= s.length) break;
  }
  return consumed === s.length && out.length ? out : null;
}

function impDecodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

// ---------------------------------------------------------------- inference
function impOptions(names: Iterable<string>): { id: string; name: string; color: string }[] {
  const out: { id: string; name: string; color: string }[] = [];
  for (const name of names) out.push({ id: "o" + (out.length + 1), name, color: impOptionColors[out.length % impOptionColors.length] });
  return out;
}

export function impInferProperty(name: string, values: string[], index: number): ImpInferred {
  if (index === 0) return { type: "title", config: {} };
  const vals: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t) vals.push(t);
  }
  if (!vals.length) return { type: "text", config: {} };

  if (vals.every((v) => /^(yes|no)$/i.test(v))) return { type: "checkbox", config: {} };

  const formats = new Map<string, number>();
  let numeric = true;
  for (const v of vals) {
    const num = impParseNumber(v);
    if (!num) {
      numeric = false;
      break;
    }
    formats.set(num.format, (formats.get(num.format) ?? 0) + 1);
  }
  if (numeric) {
    let best = "number";
    let bestCount = -1;
    for (const [f, c] of formats) {
      const rank = f === "number" ? 0 : f === "number_with_commas" ? 1 : 2;
      const bestRank = best === "number" ? 0 : best === "number_with_commas" ? 1 : 2;
      if (rank > bestRank || (rank === bestRank && c > bestCount)) {
        best = f;
        bestCount = c;
      }
    }
    return { type: "number", config: { number_format: best } };
  }

  if (vals.every((v) => impParseDate(v))) return { type: "date", config: {} };
  if (vals.every((v) => IMP_URL.test(v))) return { type: "url", config: {} };
  if (vals.every((v) => IMP_EMAIL.test(v))) return { type: "email", config: {} };

  const targets = new Set<string>();
  let relation = true;
  for (const v of vals) {
    const t = impRelationTargets(v);
    if (!t) {
      relation = false;
      break;
    }
    for (const p of t) targets.add(p);
  }
  if (relation) return { type: "relation", config: { notionTargets: [...targets] } };

  const distinct = new Set<string>();
  let hasList = false;
  let repeat = false;
  for (const v of vals) {
    if (distinct.has(v)) repeat = true;
    distinct.add(v);
    if (v.includes(", ")) hasList = true;
  }
  if (hasList) {
    const split = new Set<string>();
    for (const v of vals) for (const part of v.split(", ")) if (part.trim()) split.add(part.trim());
    if (split.size <= 50) return { type: "multi_select", config: { options: impOptions(split) } };
  }
  if (distinct.size <= 30 && (repeat || vals.length <= 10)) {
    const type = /^(status|상태)$/i.test(name.trim()) ? "status" : "select";
    return { type, config: { options: impOptions(distinct) } };
  }
  return { type: "text", config: {} };
}

// ---------------------------------------------------------------- cell values
export function impCellValue(prop: Pick<ImpProperty, "type">, raw: string): unknown {
  const s = raw.trim();
  switch (prop.type) {
    case "checkbox":
      return /^(yes|true)$/i.test(s);
    case "number": {
      const num = impParseNumber(s);
      return num ? num.value : null;
    }
    case "date":
    case "created_time":
    case "updated_time":
      return impParseDate(s);
    case "select":
    case "status":
      return s || null;
    case "multi_select":
    case "person":
      return s ? s.split(", ").map((p) => p.trim()).filter(Boolean) : [];
    case "relation":
      return impRelationTargets(s);
    default:
      return s;
  }
}

// ---------------------------------------------------------------- row page property lines
export function impNotionKeyValueLines(body: string, headers: string[]): { values: Record<string, string>; rest: string } {
  const lines = body.split(/\r?\n/);
  const sorted = headers
    .map((h) => h.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let title = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith("# ")) title = i;
    break;
  }
  let i = title + 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  const values: Record<string, string> = {};
  const first = i;
  while (i < lines.length) {
    const line = lines[i];
    const header = sorted.find((h) => line.startsWith(h) && line.charCodeAt(h.length) === 58);
    if (!header) break;
    values[header] = line.slice(header.length + 1).trim();
    i++;
  }
  if (i === first) return { values, rest: body };
  const tail = lines.slice(i);
  while (tail.length && tail[0].trim() === "") tail.shift();
  const head = lines.slice(0, title + 1);
  const rest = head.length && tail.length ? [...head, "", ...tail] : [...head, ...tail];
  return { values, rest: rest.join("\n") };
}
