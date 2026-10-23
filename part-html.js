// Parts (#38): a page keeps a part as ```acard-part {"part":"chart","v":1} + JSON data. The data is the page's; the code that
// draws it is not. Default parts ship in PART_RUNTIME, a versioned static file (/lazy/parts.js?v=, immutable) that the page
// hands to each part frame by postMessage; workspace parts (registered from an HTML block) come from /api/parts/<id>.
// The code only ever runs inside the same sandbox as HTML blocks: opaque-origin iframe (sandbox="allow-scripts", no
// allow-same-origin), CSP default-src 'none' so no network, no cookies or storage, no access to the page.
// Used by block-html.js (reader), the editor's lazy parts chunk, features/share.js (published/link frames) and
// features/parts.js (MCP list_parts / set_part_data validation).

import { FRAME_BASE_CSP } from "./sandbox-policy.js";
export const PART_MAX_BYTES = 64 * 1024;
export const PART_ID = /^[a-z][a-z0-9-]{1,39}$/;

const PART_STATE = { enum: ["ok", "warn", "stop", "wait", "info"] };
const PART_NUM = { type: ["number", "null"] };
const PART_TEXT = { type: "string", maxLength: 200 };

export const PART_DEFAULTS = [
  {
    id: "badge", name: "배지 카드", version: 1,
    description: "Status cards: a value, a label and a colored badge each. An item with \"of\" also shows value/of as a percentage.",
    schema: { type: "object", required: ["items"], properties: {
      title: PART_TEXT, note: PART_TEXT,
      items: { type: "array", maxItems: 12, items: { type: "object", required: ["label", "value"], properties: {
        label: PART_TEXT, value: { type: ["number", "string"] }, of: { type: "number" }, unit: { type: "string", maxLength: 8 },
        badge: { type: "string", maxLength: 24 }, state: PART_STATE } } } } },
    sample: { title: "이번 주 상태", items: [
      { label: "끝난 일", value: 12, of: 16, badge: "진행", state: "ok" },
      { label: "막힌 일", value: 2, badge: "확인 필요", state: "warn" },
      { label: "결정 대기", value: 1, badge: "오너", state: "wait" }] },
  },
  {
    id: "table", name: "표", version: 1,
    description: "Table with computed rows: \"sum\"/\"avg\" list column indexes that get a total/average row, \"ratio\" is a column index whose share of the column total is added as a % column.",
    schema: { type: "object", required: ["columns", "rows"], properties: {
      title: PART_TEXT, note: PART_TEXT, unit: { type: "string", maxLength: 8 },
      columns: { type: "array", maxItems: 12, items: { type: "string", maxLength: 60 } },
      rows: { type: "array", maxItems: 200, items: { type: "array", maxItems: 12, items: { type: ["string", "number", "null"] } } },
      sum: { type: "array", maxItems: 12, items: { type: "number", minimum: 0 } },
      avg: { type: "array", maxItems: 12, items: { type: "number", minimum: 0 } },
      ratio: { type: "number", minimum: 0 }, unitCols: { type: "array", maxItems: 12, items: { type: "number", minimum: 0 } } } },
    sample: { title: "모델별 비용", unit: "$", columns: ["모델", "호출", "비용"], rows: [["gpt-5.5", 120, 3.2], ["claude", 80, 2.1], ["gemini", 40, 0.7]], sum: [1, 2], ratio: 2 },
  },
  {
    id: "chart", name: "차트", version: 1,
    description: "Bar or line chart. The caption under it is computed: total, average and the highest point.",
    schema: { type: "object", required: ["labels", "series"], properties: {
      title: PART_TEXT, note: PART_TEXT, unit: { type: "string", maxLength: 8 }, type: { enum: ["bar", "line"] },
      labels: { type: "array", maxItems: 48, items: { type: ["string", "number"] } },
      series: { type: "array", maxItems: 4, items: { type: "object", required: ["data"], properties: {
        name: { type: "string", maxLength: 40 }, data: { type: "array", maxItems: 48, items: PART_NUM } } } } } },
    sample: { title: "요일별 작업 수", type: "bar", labels: ["월", "화", "수", "목", "금"], series: [{ name: "작업", data: [5, 8, 3, 9, 6] }] },
  },
  {
    id: "heatmap", name: "히트맵", version: 1,
    description: "Grid of values (rows x cols); null is an empty cell. Row totals and the busiest cell are computed.",
    schema: { type: "object", required: ["rows", "cols", "values"], properties: {
      title: PART_TEXT, note: PART_TEXT, unit: { type: "string", maxLength: 8 },
      rows: { type: "array", maxItems: 31, items: { type: "string", maxLength: 30 } },
      cols: { type: "array", maxItems: 48, items: { type: "string", maxLength: 12 } },
      values: { type: "array", maxItems: 31, items: { type: "array", maxItems: 48, items: PART_NUM } } } },
    sample: { title: "시간대별 작업", rows: ["월", "화", "수"], cols: ["9시", "12시", "15시", "18시"], values: [[1, 3, 2, null], [0, 4, 5, 1], [2, 2, null, 3]] },
  },
  {
    id: "dag", name: "흐름도(단계·구조)", version: 1,
    description: "THE part for any flow, process, pipeline, workflow or structure diagram (전체 흐름, 구조도, 구성도, 파이프라인). Never hand-write stacked HTML cards with arrows for this. Each node is a step card: label, optional desc, items (bullets), tags ({text, kind: agent|api|lib|person|stop}), gate (넘김 조건) and state done/doing/todo/stop. edges [from, to] or [from, to, label] draw arrows; nodes are placed left to right by dependency, branches and merges stack in a column, and narrow screens stack top-down. numbered: true numbers the steps; callout {title, text} adds a note box under the diagram. With states the done ratio is computed.",
    schema: { type: "object", required: ["nodes"], properties: {
      title: PART_TEXT, note: PART_TEXT, numbered: { type: "boolean" },
      callout: { type: "object", properties: { title: { type: "string", maxLength: 40 }, text: { type: "string", maxLength: 400 } } },
      nodes: { type: "array", maxItems: 40, items: { type: "object", required: ["id", "label"], properties: {
        id: { type: "string", maxLength: 40 }, label: { type: "string", maxLength: 60 }, state: { enum: ["done", "doing", "todo", "stop"] },
        desc: { type: "string", maxLength: 300 }, gate: { type: "string", maxLength: 160 },
        items: { type: "array", maxItems: 12, items: { type: "string", maxLength: 120 } },
        tags: { type: "array", maxItems: 8, items: { type: ["object", "string"], properties: { text: { type: "string", maxLength: 40 }, kind: { enum: ["agent", "api", "lib", "person", "stop", ""] } } } } } } },
      edges: { type: "array", maxItems: 80, items: { type: "array", maxItems: 3, items: { type: "string", maxLength: 40 } } } } },
    sample: { title: "작업 흐름", numbered: true, nodes: [
      { id: "ref", label: "레퍼런스", desc: "시안 이미지를 만들고 오너가 1장 고름", tags: [{ text: "ima2", kind: "api" }, { text: "오너 선택", kind: "person" }], gate: "기준 1장 확정", state: "done" },
      { id: "build", label: "제작", desc: "블록 먼저, 보이는 것만 교체", tags: [{ text: "에이전트", kind: "agent" }, { text: "라이브러리", kind: "lib" }], gate: "[시안 | 화면] 일치", state: "doing" },
      { id: "ship", label: "납품", desc: "시험 렌더 뒤 본 렌더", tags: [{ text: "오너 OK", kind: "person" }], gate: "오너 확인", state: "todo" }],
      edges: [["ref", "build"], ["build", "ship", "시험 렌더"]],
      callout: { title: "개선 루프", text: "작업마다 결과를 남기고 기준을 고친다." } },
  },
];
export const PART_DEFAULT_IDS = new Set(PART_DEFAULTS.map((p) => p.id));

// Themes (#38): a part draws structure only and takes its look from CSS variables; a theme is one set of those variables
// for light and/or dark. Built-in themes ship here, workspace themes live in the part_themes table.
export const PART_THEME_KEYS = ["font", "mono", "radius", "radius-s", "fg", "dim", "line", "card", "soft", "acc", "bar", "hi", "ok-b", "ok-f", "warn-b", "warn-f", "stop-b", "stop-f", "wait-b", "wait-f", "info-b", "info-f"];
const PART_THEME_VALUE = /^[#\w\s.,%()'"+-]{1,160}$/;
export const PART_THEMES = [
  { id: "acard", name: "Acard 기본", description: "페이지의 밝은/어두운 테마를 그대로 따라가요." },
  { id: "terminal", name: "터미널", description: "남색 바탕, 금색 강조, 고정폭 글꼴, 각진 모서리. 어두운 테마 고정.",
    dark: { font: "ui-monospace,'JetBrains Mono',Consolas,monospace", mono: "ui-monospace,'JetBrains Mono',Consolas,monospace", radius: "0px", "radius-s": "0px", fg: "#e7e7ed", dim: "#93939f", line: "#383840", card: "#171826", soft: "#1e2030", acc: "#dbc66f", bar: "#8fbc7a", hi: "#e09a4d", "ok-b": "#22331f", "ok-f": "#8fbc7a", "warn-b": "#3a2f17", "warn-f": "#e09a4d", "stop-b": "#3a1d1f", "stop-f": "#f08a8a", "wait-b": "#332f17", "wait-f": "#dbc66f", "info-b": "#1d2638", "info-f": "#9ab8e8" } },
  { id: "bento", name: "벤토", description: "둥근 큰 카드와 부드러운 파스텔, 숫자를 크게.",
    light: { radius: "18px", "radius-s": "6px", fg: "#1d1d1f", dim: "#6e6e73", line: "#e8e8ed", card: "#ffffff", soft: "#f5f5f7", acc: "#0071e3", bar: "#7cc4fa", hi: "#ff9f0a", "ok-b": "#e3f6e8", "ok-f": "#1a7f37", "warn-b": "#fff4dc", "warn-f": "#9a6700", "stop-b": "#ffe9e7", "stop-f": "#c9372c", "wait-b": "#efeafe", "wait-f": "#6e40c9", "info-b": "#e6f1fe", "info-f": "#0058b0" },
    dark: { radius: "18px", "radius-s": "6px", fg: "#f5f5f7", dim: "#a1a1a6", line: "#2c2c2e", card: "#1c1c1e", soft: "#2c2c2e", acc: "#2997ff", bar: "#409cff", hi: "#ffb340", "ok-b": "#173622", "ok-f": "#5fd38d", "warn-b": "#3b2d10", "warn-f": "#ffcc66", "stop-b": "#3d1a18", "stop-f": "#ff8a80", "wait-b": "#2b2245", "wait-f": "#bf9dff", "info-b": "#132a45", "info-f": "#7ab8ff" } },
  { id: "neon", name: "네온", description: "검은 바탕에 청록·분홍 형광 강조. 어두운 테마 고정.",
    dark: { radius: "12px", "radius-s": "4px", fg: "#eaf2ff", dim: "#8a93a6", line: "#232838", card: "#0b0d14", soft: "#121624", acc: "#ff4fd8", bar: "#22e3ff", hi: "#ff4fd8", "ok-b": "#0f2b25", "ok-f": "#3ff2b0", "warn-b": "#2e2610", "warn-f": "#ffd84f", "stop-b": "#2e1020", "stop-f": "#ff5c8a", "wait-b": "#221436", "wait-f": "#c792ff", "info-b": "#0d2236", "info-f": "#5cc8ff" } },
  { id: "paper", name: "종이", description: "따뜻한 종이색, 명조 글꼴, 얇은 선.",
    light: { font: "'Noto Serif KR','Nanum Myeongjo',Georgia,serif", radius: "4px", "radius-s": "2px", fg: "#2b2a26", dim: "#6f6a5f", line: "#e4ddcd", card: "#fbf8f1", soft: "#f3eee2", acc: "#9c4a2f", bar: "#c9a77c", hi: "#9c4a2f", "ok-b": "#e8efdc", "ok-f": "#4f6b2a", "warn-b": "#f4e8cc", "warn-f": "#80591a", "stop-b": "#f4dcd5", "stop-f": "#9c3a2a", "wait-b": "#ebe3f0", "wait-f": "#6b4a80", "info-b": "#e2e9ee", "info-f": "#3e5f78" },
    dark: { font: "'Noto Serif KR','Nanum Myeongjo',Georgia,serif", radius: "4px", "radius-s": "2px", fg: "#ece6d8", dim: "#a69f8f", line: "#3a352c", card: "#1f1c17", soft: "#2a261f", acc: "#e0906d", bar: "#b8966b", hi: "#e0906d", "ok-b": "#27301d", "ok-f": "#a9c27f", "warn-b": "#352c18", "warn-f": "#e2c07a", "stop-b": "#3a211b", "stop-f": "#ef9b86", "wait-b": "#2d2433", "wait-f": "#c7a6dc", "info-b": "#1f2a33", "info-f": "#9cbbd2" } },
];

// Returns Korean error lines for a theme's {light, dark} variable sets (empty = valid).
export function validatePartTheme(theme) {
  const errors = [];
  if (!theme || typeof theme !== "object") return ["테마는 객체여야 해요."];
  if (!theme.light && !theme.dark) errors.push("light 나 dark 변수 묶음 중 하나는 있어야 해요.");
  for (const mode of ["light", "dark"]) {
    const vars = theme[mode];
    if (vars === undefined) continue;
    if (!vars || typeof vars !== "object" || Array.isArray(vars)) { errors.push(mode + ": 객체여야 해요."); continue; }
    for (const [key, value] of Object.entries(vars)) {
      if (!PART_THEME_KEYS.includes(key)) errors.push(mode + "." + key + ": 쓸 수 없는 변수예요 (" + PART_THEME_KEYS.join(", ") + ")");
      else if (typeof value !== "string" || !PART_THEME_VALUE.test(value)) errors.push(mode + "." + key + ": 색·길이·글꼴 이름만 쓸 수 있어요.");
    }
  }
  return errors;
}

// CSS for the part frame. A theme with one mode keeps it in both page modes; with two it follows the page.
export function partThemeCss(theme) {
  if (!theme || (!theme.light && !theme.dark) || validatePartTheme(theme).length) return "";
  const block = (vars) => Object.entries(vars).map(([k, v]) => "--" + k + ":" + v).join(";");
  const scheme = (vars, mode) => block(vars) + ";color-scheme:" + mode;
  if (theme.light && theme.dark) return ":root,:root[data-theme=light]{" + scheme(theme.light, "light") + "}:root[data-theme=dark]{" + scheme(theme.dark, "dark") + "}@media (prefers-color-scheme:dark){:root:not([data-theme]){" + scheme(theme.dark, "dark") + "}}";
  const only = theme.light ? "light" : "dark";
  const css = scheme(theme[only], only);
  return ":root,:root[data-theme=light],:root[data-theme=dark]{" + css + "}@media (prefers-color-scheme:dark){:root:not([data-theme]){" + css + "}}";
}
export const PART_THEME_IDS = new Set(PART_THEMES.map((t) => t.id));


function partTypeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "nan";
  return typeof value;
}

export function validatePartData(schema, data, path = "data") {
  const errors = [];
  const walk = (s, v, p) => {
    if (!s || typeof s !== "object" || errors.length >= 20) return;
    const t = partTypeOf(v);
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((x) => x === t || (x === "integer" && t === "number" && Number.isInteger(v)))) { errors.push(p + ": " + types.join("|") + " 이어야 해요 (지금 " + t + ")"); return; }
    }
    if (Array.isArray(s.enum) && !s.enum.includes(v)) { errors.push(p + ": " + s.enum.join(", ") + " 중 하나여야 해요"); return; }
    if (t === "string" && Number.isFinite(s.maxLength) && v.length > s.maxLength) errors.push(p + ": " + s.maxLength + "자까지예요");
    if (t === "number" && Number.isFinite(s.minimum) && v < s.minimum) errors.push(p + ": " + s.minimum + " 이상이어야 해요");
    if (t === "number" && Number.isFinite(s.maximum) && v > s.maximum) errors.push(p + ": " + s.maximum + " 이하여야 해요");
    if (t === "array") {
      if (Number.isFinite(s.maxItems) && v.length > s.maxItems) errors.push(p + ": " + s.maxItems + "개까지예요");
      if (s.items) v.forEach((item, i) => walk(s.items, item, p + "[" + i + "]"));
    }
    if (t === "object") {
      for (const key of Array.isArray(s.required) ? s.required : []) if (!(key in v)) errors.push(p + "." + key + ": 꼭 있어야 해요");
      for (const [key, sub] of Object.entries(s.properties || {})) if (key in v) walk(sub, v[key], p + "." + key);
    }
  };
  walk(schema, data, path);
  return errors;
}

// #58: an agent that writes an HTML block which paints its own white/black boxes or a stacked card flow gets a warning
// in the write result pointing at the part that should draw it (dag for flows, table for card lists). The write
// itself is kept. HTML that already uses the theme variables or prefers-color-scheme is left alone.
// A background colour written as a literal that is near white or near black (luminance > .9 or < .12).
function htmlFixedBackground(src) {
  const re = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}\b|white\b|black\b|rgba?\([^)]*\))/gi;
  for (let m; (m = re.exec(src));) {
    const v = m[1].toLowerCase();
    if (v === "white" || v === "black") return true;
    let rgb = null;
    if (v[0] === "#") { const h = v.length <= 5 ? v.slice(1, 4).split("").map((c) => c + c).join("") : v.slice(1, 7); rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
    else { const n = v.match(/[\d.]+/g); if (n && n.length >= 3 && (n.length < 4 || +n[3] >= .5)) rgb = n.slice(0, 3).map(Number); }
    if (!rgb) continue;
    const lum = (.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]) / 255;
    if (lum > .9 || lum < .12) return true;
  }
  return false;
}
// A flow drawn by hand: an element holding only an arrow glyph between cards, or arrow/flow classes.
const HTML_FLOW = />\s*(?:[▼▽↓→➔➡⬇]|&darr;|&rarr;)\s*<\/|class="[^"]*\b(?:ar|arrow|arrows|flow)\b|content:\s*['"](?:[→↓▼]|\\2192|\\2193)/;
export function htmlBlockWarnings(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (!block || block.type !== "html") continue;
    const src = String(block.text || "");
    const fixed = htmlFixedBackground(src), cards = (src.match(/<div class="[^"]*\b(?:card|st|b|box|step)\b/g) || []).length, flow = HTML_FLOW.test(src) && cards >= 2;
    if (!fixed && !flow) continue;
    if (!flow && /prefers-color-scheme/.test(src)) continue;
    out.push({ block_id: block.id, warning: (flow
      ? "이 HTML 블록은 카드를 쌓고 화살표를 손으로 그린 흐름도예요. 흐름·구조·파이프라인은 dag 부품(list_parts)에 nodes/edges 데이터만 넣어 주세요: 단계마다 label, desc, tags, gate, 화살표는 edges."
      : "이 HTML 블록은 배경색(흰색/검은색)을 직접 정해서 다크·라이트 테마를 따라가지 못해요.")
      + " 카드 목록이나 표는 table 부품, 상태 카드는 badge 부품을 쓰세요. HTML을 꼭 써야 하면 색을 var(--fg), var(--bg-soft), var(--line) 같은 Acard 변수로 쓰세요." });
  }
  return out;
}

export function parsePartData(text) {
  try {
    const data = JSON.parse(String(text || ""));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

// The part frame runtime (assets/features/parts/runtime.js), minified once and written here as text by
// scripts/build-parts.ts so no bundler can rewrite it (the worker bundle adds __name() calls a frame does not have).
// PART_RUNTIME:BEGIN
export const PART_RUNTIME = "(()=>{(function(){var D=\"@font-face{font-family:'Acard Part';src:local('Pretendard Variable'),local('Pretendard'),local('Malgun Gothic'),local('Apple SD Gothic Neo'),local('Noto Sans KR');size-adjust:94.2%}:root{--font:'Acard Part',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--mono:ui-monospace,Consolas,monospace;--radius:10px;--radius-s:3px;--fs-12:12px;--fs-13:13px;--fs-14:14px;--fs-15:15px;--fs-21:21px;--fg:#26252c;--dim:#5f5d69;--line:#ececf0;--card:#fff;--soft:#f6f6f8;--acc:#6450dc;--bar:#86c5e8;--hi:#e0a63c;--ok-b:#e3f5ec;--ok-f:#1d7550;--warn-b:#fdf3d8;--warn-f:#7f590b;--stop-b:#fdeaec;--stop-f:#b13443;--wait-b:#efe9fd;--wait-f:#7048d6;--info-b:#e5f0fd;--info-f:#2563b8;color-scheme:light}:root[data-theme=dark]{--fg:#ecebf2;--dim:#a3a1ad;--line:#31313a;--card:#1b1b20;--soft:#26262d;--acc:#a597ff;--bar:#5fa8d3;--hi:#f2c66b;--ok-b:#1f3a2e;--ok-f:#8ee0b5;--warn-b:#3f3520;--warn-f:#f2d38a;--stop-b:#45252b;--stop-f:#ffadb6;--wait-b:#322a52;--wait-f:#c7b6ff;--info-b:#1e3149;--info-f:#9cc6fb;color-scheme:dark}@media (prefers-color-scheme:dark){:root:not([data-theme]){--fg:#ecebf2;--dim:#a3a1ad;--line:#31313a;--card:#1b1b20;--soft:#26262d;--acc:#a597ff;--bar:#5fa8d3;--hi:#f2c66b;--ok-b:#1f3a2e;--ok-f:#8ee0b5;--warn-b:#3f3520;--warn-f:#f2d38a;--stop-b:#45252b;--stop-f:#ffadb6;--wait-b:#322a52;--wait-f:#c7b6ff;--info-b:#1e3149;--info-f:#9cc6fb;color-scheme:dark}}html,body{margin:0;background:var(--card);color:var(--fg);font-size:var(--fs-14);line-height:1.5;font-family:var(--font)}body{padding:2px 2px 4px}.ap h4{margin:0 0 10px;font-size:var(--fs-15)}.cap{color:var(--dim);font-size:var(--fs-12);margin-top:8px}.row{display:flex;gap:10px;flex-wrap:wrap}.cd{flex:1 1 140px;border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px;background:var(--soft)}.cd b{display:block;font-weight:650;font-size:var(--fs-21);line-height:1.3;font-family:var(--mono);margin:4px 0 2px}.cd span.l{color:var(--dim);font-size:var(--fs-13)}.bd{display:inline-block;padding:1px 8px;border-radius:99px;font-size:var(--fs-12);background:var(--info-b);color:var(--info-f)}.bd.ok{background:var(--ok-b);color:var(--ok-f)}.bd.warn{background:var(--warn-b);color:var(--warn-f)}.bd.stop{background:var(--stop-b);color:var(--stop-f)}.bd.wait{background:var(--wait-b);color:var(--wait-f)}.tw{overflow-x:auto}table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}td:not(.n){white-space:normal;min-width:5em;word-break:keep-all;overflow-wrap:break-word}th{color:var(--dim);font-weight:600;font-size:var(--fs-13)}.n{text-align:right;font-family:var(--mono)}tfoot td{font-weight:650;border-bottom:0}svg{width:100%;height:auto;display:block}.hm{display:grid;gap:3px;align-items:center}.hm i{display:block;height:18px;border-radius:var(--radius-s)}.hm span{font-size:var(--fs-12);color:var(--dim);white-space:nowrap}.nd rect{fill:var(--soft);stroke:var(--line)}.nd.done rect{fill:var(--ok-b);stroke:var(--ok-f)}.nd.doing rect{fill:var(--info-b);stroke:var(--info-f)}.nd.stop rect{fill:var(--stop-b);stroke:var(--stop-f)}.nd text{fill:var(--fg);font-size:var(--fs-13)}.ed{stroke:var(--dim);fill:none}.fw{position:relative}.fl{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);column-gap:var(--gx,40px);align-items:stretch}.fl.st{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:minmax(0,1fr);row-gap:34px}.fc{display:flex;flex-direction:column;gap:14px;min-width:0}.fl.st .fc{flex-direction:row;flex-wrap:wrap}.fl.st .fn{flex:1 1 150px}.fn{flex:1 1 auto;position:relative;z-index:1;min-width:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--soft);padding:12px 13px;display:flex;flex-direction:column;gap:7px;font-size:var(--fs-13);line-height:1.5;word-break:keep-all;overflow-wrap:break-word}.fn.done{border-color:var(--ok-f)}.fn.doing{border-color:var(--info-f);box-shadow:0 0 0 1px var(--info-f)}.fn.stop{border-color:var(--stop-f)}.fn .no{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:99px;background:var(--acc);color:var(--card);font-weight:700;font-size:var(--fs-12);font-family:var(--mono)}.fn b{display:block;font-size:var(--fs-15);font-weight:700;line-height:1.35;color:var(--fg)}.fn p{margin:0;color:var(--dim)}.fn ul{margin:0;padding-left:16px;color:var(--dim)}.fn .tg{display:flex;flex-wrap:wrap;gap:4px}.fn .gt{margin-top:auto;padding-top:8px;border-top:1px solid var(--line);color:var(--fg);font-size:var(--fs-12)}.fn .gt:before{content:'\\\\2691  ';color:var(--acc)}.t{display:inline-block;padding:1px 8px;border-radius:99px;font-size:var(--fs-12);line-height:1.6;background:var(--line);color:var(--fg)}.t.agent{background:var(--wait-b);color:var(--wait-f)}.t.api{background:var(--info-b);color:var(--info-f)}.t.lib{background:var(--ok-b);color:var(--ok-f)}.t.person{background:var(--warn-b);color:var(--warn-f)}.t.stop{background:var(--stop-b);color:var(--stop-f)}.fe{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.fe path{stroke:var(--dim);stroke-width:1.5;fill:none}.fe .hd{fill:var(--dim);stroke:none}.el{position:absolute;z-index:2;transform:translate(-50%,-50%);max-width:86px;padding:1px 4px;background:var(--card);color:var(--dim);font-size:var(--fs-12);line-height:1.3;text-align:center}.co{margin-top:14px;border:1px dashed var(--hi);border-radius:var(--radius);padding:10px 14px;font-size:var(--fs-13);color:var(--fg)}.co:before{content:'\\\\21BB  ';color:var(--hi);font-weight:700}.co b{color:var(--hi)}\";function i(t){return String(t==null?\"\":t).replace(/[&<>\"']/g,function(r){return{\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[r]})}function A(t){return(t||[]).filter(function(r){return typeof r===\"number\"&&isFinite(r)})}function N(t){return A(t).reduce(function(r,n){return r+n},0)}function I(t){var r=A(t);return r.length?N(r)/r.length:0}function S(t,r){if(typeof t!==\"number\")return i(t);var n=Math.round(t*100)/100,o=n.toLocaleString(\"ko-KR\",{maximumFractionDigits:2});return r===\"$\"?\"$\"+o:i(o+(r||\"\"))}function R(t,r){return r?Math.round(t/r*1000)/10+\"%\":\"-\"}var G={badge:function(t){return'<div class=\"row\">'+(t.items||[]).map(function(r){var n=typeof r.of===\"number\"&&typeof r.value===\"number\"?'<span class=\"l\"> / '+S(r.of,r.unit)+\" · \"+R(r.value,r.of)+\"</span>\":\"\";return'<div class=\"cd\">'+(r.badge?'<span class=\"bd '+i(r.state||\"info\")+'\">'+i(r.badge)+\"</span>\":\"\")+\"<b>\"+S(r.value,r.unit)+n+'</b><span class=\"l\">'+i(r.label)+\"</span></div>\"}).join(\"\")+\"</div>\"},table:function(t){var r=t.columns||[],n=t.rows||[],o=t.sum||[],g=t.avg||[],d=typeof t.ratio===\"number\"?t.ratio:-1,f=function(e){return n.map(function(v){return v[e]})},z=d>=0?N(f(d)):0,x=r.map(function(e,v){return v>0&&A(f(v)).length>0}),l=t.unitCols||(d>=0?[d]:[]),h=function(e){return l.indexOf(e)>=0?t.unit:\"\"},c=\"<tr>\"+r.map(function(e,v){return'<th class=\"'+(x[v]?\"n\":\"\")+'\">'+i(e)+\"</th>\"}).join(\"\")+(d>=0?'<th class=\"n\">비중</th>':\"\")+\"</tr>\",a=n.map(function(e){return\"<tr>\"+r.map(function(v,M){return'<td class=\"'+(x[M]?\"n\":\"\")+'\">'+S(e[M],h(M))+\"</td>\"}).join(\"\")+(d>=0?'<td class=\"n\">'+R(typeof e[d]===\"number\"?e[d]:0,z)+\"</td>\":\"\")+\"</tr>\"}).join(\"\"),u=function(e,v,M){return v.length?\"<tr><td>\"+e+\"</td>\"+r.slice(1).map(function(y,s){var b=s+1;return'<td class=\"n\">'+(v.indexOf(b)>=0?S(M(f(b)),h(b)):\"\")+\"</td>\"}).join(\"\")+(d>=0?'<td class=\"n\">'+(e===\"합계\"?\"100%\":\"\")+\"</td>\":\"\")+\"</tr>\":\"\"};return'<div class=\"tw\"><table><thead>'+c+\"</thead><tbody>\"+a+\"</tbody><tfoot>\"+u(\"합계\",o,N)+u(\"평균\",g,I)+\"</tfoot></table></div>\"},chart:function(t){var r=t.labels||[],n=(t.series||[]).slice(0,4),o=[];n.forEach(function(s){o=o.concat(A(s.data))});var g=Math.max.apply(null,o.concat([0]))||1,d=600,f=180,z=10,x=Math.max(1,r.length),l=d/x,h=[\"var(--bar)\",\"var(--acc)\",\"var(--hi)\",\"var(--ok-f)\"],c=function(s){return z+f-s/g*f},a='<svg viewBox=\"0 0 '+d+\" \"+(f+z+22)+'\" role=\"img\" aria-label=\"'+i(t.title||\"차트\")+'\">';for(var u=0;u<=4;u++)a+='<line x1=\"0\" x2=\"'+d+'\" y1=\"'+c(g*u/4)+'\" y2=\"'+c(g*u/4)+'\" stroke=\"var(--line)\"/>';n.forEach(function(s,b){var m=s.data||[];if(t.type===\"line\"){var w=[];m.forEach(function(k,C){if(typeof k===\"number\")w.push(C*l+l/2+\",\"+c(k))}),a+='<polyline points=\"'+w.join(\" \")+'\" fill=\"none\" stroke=\"'+h[b]+'\" stroke-width=\"3\" stroke-linejoin=\"round\"/>'}else{var p=l*0.7/n.length;m.forEach(function(k,C){if(typeof k!==\"number\")return;var O=C*l+l*0.15+p*b;a+='<rect x=\"'+O+'\" y=\"'+Math.min(c(k),c(0))+'\" width=\"'+Math.max(1,p-2)+'\" height=\"'+Math.abs(c(0)-c(k))+'\" rx=\"3\" fill=\"'+(n.length===1&&k===g?\"var(--hi)\":h[b])+'\"><title>'+i(r[C])+\": \"+S(k,t.unit)+\"</title></rect>\"})}});var e=Math.ceil(x/12);r.forEach(function(s,b){if(b%e===0)a+='<text x=\"'+(b*l+l/2)+'\" y=\"'+(f+z+16)+'\" font-size=\"12\" text-anchor=\"middle\" fill=\"var(--dim)\">'+i(s)+\"</text>\"}),a+=\"</svg>\";var v=n[0]?n[0].data||[]:[],M=v.indexOf(Math.max.apply(null,A(v).concat([-1/0]))),y=n.map(function(s){return(n.length>1?i(s.name||\"\")+\" \":\"\")+\"합계 \"+S(N(s.data),t.unit)+\" · 평균 \"+S(I(s.data),t.unit)}).join(\" / \");if(M>=0)y+=\" · 최고 \"+i(r[M])+\" \"+S(v[M],t.unit);return a+'<div class=\"cap\">'+y+\"</div>\"},heatmap:function(t){var r=t.rows||[],n=t.cols||[],o=t.values||[],g=[];o.forEach(function(l){g=g.concat(A(l))});var d=Math.max.apply(null,g.concat([0]))||1,f={v:-1/0,r:0,c:0},z=function(l){if(typeof l!==\"number\")return\"repeating-linear-gradient(45deg,var(--line) 0 3px,transparent 3px 6px)\";var h=Math.max(0.12,l/d);return\"color-mix(in srgb,var(--acc) \"+Math.round(h*100)+\"%,var(--soft))\"},x='<div class=\"hm\" style=\"grid-template-columns:auto repeat('+n.length+',minmax(10px,1fr)) auto\"><span></span>'+n.map(function(l){return\"<span>\"+i(l)+\"</span>\"}).join(\"\")+'<span class=\"n\">합계</span>';return r.forEach(function(l,h){var c=o[h]||[];x+=\"<span>\"+i(l)+\"</span>\"+n.map(function(a,u){var e=c[u];if(typeof e===\"number\"&&e>f.v)f={v:e,r:h,c:u};return'<i style=\"background:'+z(e)+'\" title=\"'+i(l+\" \"+n[u]+\": \"+(typeof e===\"number\"?e:\"없음\"))+'\"></i>'}).join(\"\")+'<span class=\"n\">'+S(N(c),t.unit)+\"</span>\"}),x+=\"</div>\",x+(f.v>-1/0?'<div class=\"cap\">전체 '+S(N(g),t.unit)+\" · 가장 많은 칸 \"+i(r[f.r]+\" \"+n[f.c])+\" \"+S(f.v,t.unit)+\"</div>\":\"\")},dag:function(t){var r=t.nodes||[],n=(t.edges||[]).filter(function(a){return a&&a.length>=2}),o={};r.forEach(function(a){o[a.id]=0});for(var g=0;g<r.length;g++){var d=!1;if(n.forEach(function(a){if(a[0]in o&&a[1]in o&&o[a[1]]<o[a[0]]+1&&o[a[0]]<r.length)o[a[1]]=o[a[0]]+1,d=!0}),!d)break}r.forEach(function(a){if(n.some(function(e){return e[1]===a.id}))return;var u=n.filter(function(e){return e[0]===a.id&&e[1]in o}).map(function(e){return o[e[1]]});if(u.length)o[a.id]=Math.max(o[a.id],Math.min.apply(null,u)-1)});var f=[];r.forEach(function(a){(f[o[a.id]]=f[o[a.id]]||[]).push(a)}),f=f.filter(Boolean);var z=n.some(function(a){return a[2]}),x=function(a){var u=(a.tags||[]).map(function(e){var v=typeof e===\"string\"?{text:e}:e||{};return'<span class=\"t '+i(v.kind||\"\")+'\">'+i(v.text)+\"</span>\"}).join(\"\");return'<div class=\"fn '+i(a.state||\"\")+'\" data-id=\"'+i(a.id)+'\">'+(t.numbered?'<span class=\"no\">'+(r.indexOf(a)+1)+\"</span>\":\"\")+\"<b>\"+i(a.label||a.id)+\"</b>\"+(a.desc?\"<p>\"+i(a.desc)+\"</p>\":\"\")+(a.items&&a.items.length?\"<ul>\"+a.items.map(function(e){return\"<li>\"+i(e)+\"</li>\"}).join(\"\")+\"</ul>\":\"\")+(u?'<div class=\"tg\">'+u+\"</div>\":\"\")+(a.gate?'<div class=\"gt\">'+i(a.gate)+\"</div>\":\"\")+\"</div>\"},l='<div class=\"fw\" role=\"group\" aria-label=\"'+i(t.title||\"흐름\")+'\" data-edges=\"'+i(JSON.stringify(n.map(function(a){return[String(a[0]),String(a[1]),a[2]?String(a[2]):\"\"]})))+'\"><div class=\"fl\" data-cols=\"'+f.length+'\" style=\"--gx:'+(z?56:36)+'px\">'+f.map(function(a){return'<div class=\"fc\">'+a.map(x).join(\"\")+\"</div>\"}).join(\"\")+'</div><svg class=\"fe\" aria-hidden=\"true\"></svg></div>';if(t.callout&&(t.callout.title||t.callout.text))l+='<div class=\"co\">'+(t.callout.title?\"<b>\"+i(t.callout.title)+\"</b>: \":\"\")+i(t.callout.text)+\"</div>\";var h=r.filter(function(a){return a.state}).length,c=r.filter(function(a){return a.state===\"done\"}).length;return l+(h?'<div class=\"cap\">완료 '+c+\" / \"+r.length+\" 단계 · \"+R(c,r.length)+\"</div>\":\"\")}},K=document.getElementById(\"acp-data\"),j=document.getElementById(\"acp\"),L=document.createElement(\"style\");L.textContent=D+(typeof window<\"u\"&&window.acardPartTheme||\"\"),document.head.appendChild(L);var E={};try{E=JSON.parse(K.textContent)||{}}catch(t){E=null}var F=G[j.getAttribute(\"data-part\")];if(!E||!F){j.innerHTML='<p class=\"cap\">이 부품을 그리지 못했어요.</p>';return}if(j.className=\"ap\",j.innerHTML=(E.title?\"<h4>\"+i(E.title)+\"</h4>\":\"\")+F(E)+(E.note?'<div class=\"cap\">'+i(E.note)+\"</div>\":\"\"),j.querySelector&&j.querySelector(\".fw\"))V(j.querySelector(\".fw\"));function V(t){var r=t.querySelector(\".fl\"),n=t.querySelector(\".fe\"),o=[],g=-1;try{o=JSON.parse(t.getAttribute(\"data-edges\"))||[]}catch(l){o=[]}var d=+r.getAttribute(\"data-cols\")||1,f=\"http://www.w3.org/2000/svg\";function z(l){var h=r.querySelectorAll(\".fn\");for(var c=0;c<h.length;c++)if(h[c].getAttribute(\"data-id\")===l)return h[c];return null}function x(){var l=t.clientWidth,h=parseFloat(getComputedStyle(r).getPropertyValue(\"--gx\"))||40;r.classList.toggle(\"st\",d>1&&l<d*120+(d-1)*h);var c=l+\"x\"+t.clientHeight;if(c===g)return;g=c;var a=r.classList.contains(\"st\"),u=t.getBoundingClientRect();while(n.firstChild)n.removeChild(n.firstChild);Array.prototype.forEach.call(t.querySelectorAll(\".el\"),function(e){e.remove()}),o.forEach(function(e){var v=z(e[0]),M=z(e[1]);if(!v||!M)return;var y=v.getBoundingClientRect(),s=M.getBoundingClientRect(),b,m,w,p,k,C,O=function(q){return{l:q.left-u.left,r:q.right-u.left,t:q.top-u.top,b:q.bottom-u.top}};if(y=O(y),s=O(s),!a&&s.l>=y.r-1){if(b=y.r,m=(y.t+y.b)/2,w=s.l-1,p=(s.t+s.b)/2,Math.abs(m-p)<2)p=m;var _=(b+w)/2;k=\"M\"+b+\" \"+m+\" C\"+_+\" \"+m+\" \"+_+\" \"+p+\" \"+(w-6)+\" \"+p,C=\"M\"+w+\" \"+p+\" l-7 -4.5 v9 z\"}else if(b=(y.l+y.r)/2,m=y.b,w=(s.l+s.r)/2,p=s.t-1,p<=m){m=y.t,p=s.b+1;var H=(m+p)/2;k=\"M\"+b+\" \"+m+\" C\"+b+\" \"+H+\" \"+w+\" \"+H+\" \"+w+\" \"+(p+6),C=\"M\"+w+\" \"+p+\" l-4.5 7 h9 z\"}else{var J=(m+p)/2;k=\"M\"+b+\" \"+m+\" C\"+b+\" \"+J+\" \"+w+\" \"+J+\" \"+w+\" \"+(p-6),C=\"M\"+w+\" \"+p+\" l-4.5 -7 h9 z\"}var T=document.createElementNS(f,\"path\");T.setAttribute(\"d\",k),n.appendChild(T);var P=document.createElementNS(f,\"path\");if(P.setAttribute(\"d\",C),P.setAttribute(\"class\",\"hd\"),n.appendChild(P),e[2]){var B=document.createElement(\"div\");B.className=\"el\",B.textContent=e[2],B.style.left=(b+w)/2+\"px\",B.style.top=(a&&p>m?p-15:(m+p)/2)+\"px\",t.appendChild(B)}})}if(x(),typeof ResizeObserver<\"u\")new ResizeObserver(function(){x()}).observe(t);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){g=-1,x()})}})();})();";
// PART_RUNTIME:END


// Frame bootstrap (inline in every part frame). It reports its height like HTML blocks (acvH), asks the page for code
// ({acpReady}, again on the page's {acpHello} when the page script loaded later) and accepts code only from its parent:
// {acpCode} runs a default part, {acpHtml} a workspace part (HTML whose scripts read window.acardPartData), {acpTheme}
// switches light/dark. With inline code (published pages, where no page script exists) it draws at once.
const PART_BOOT = 'var R=document.documentElement,D=document.getElementById("acp-data"),P=document.getElementById("acp").getAttribute("data-part"),done=0;'
  + 'function ask(){parent.postMessage({acpReady:1,part:P,theme:document.getElementById("acp").getAttribute("data-theme-id")},"*")}'
  + 'function h(){parent.postMessage({acvH:Math.ceil(document.body.getBoundingClientRect().height)},"*")}'
  + 'function run(c){var s=document.createElement("script");s.textContent=c;document.body.appendChild(s)}'
  + 'function go(m){if(done)return;done=1;if(m.acpThemeCss!=null)window.acardPartTheme=String(m.acpThemeCss);if(m.acpHtml!=null){try{window.acardPartData=JSON.parse(D.textContent)}catch(e){window.acardPartData=null}var t=document.createElement("div");t.innerHTML=m.acpHtml;'
  + 'Array.prototype.forEach.call(t.childNodes,function(n){if(n.tagName==="SCRIPT")run(n.textContent);else document.body.appendChild(n)})}else run(m.acpCode);h();parent.postMessage({acpDrawn:1},"*")}'
  + 'addEventListener("message",function(e){var m=e.data;if(e.source!==parent||!m)return;if(m.acpHello&&!done)ask();if(m.acpTheme)R.setAttribute("data-theme",m.acpTheme);if(m.acpCode!=null||m.acpHtml!=null)go(m)});'
  + 'new ResizeObserver(h).observe(document.body);';

function partJson(text) { return String(text).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026"); }
function partEsc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

export const PART_CSP = FRAME_BASE_CSP;

export function partSrcdoc(partId, dataText, inline, themeId = "", themeCss = "") {
  const data = parsePartData(dataText);
  const theme = themeCss ? ",acpThemeCss:" + partJson(JSON.stringify(String(themeCss))) : "";
  const start = inline ? (inline.html != null ? "go({acpHtml:" + partJson(JSON.stringify(String(inline.html))) + theme + "})" : "go({acpCode:" + partJson(JSON.stringify(String(inline.code))) + theme + "})") : themeCss ? "window.acardPartTheme=" + partJson(JSON.stringify(String(themeCss))) + ";ask()" : "ask()";
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + PART_CSP + '"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
    + '<div id="acp" data-part="' + partEsc(partId) + '" data-theme-id="' + partEsc(themeId) + '"></div><script type="application/json" id="acp-data">' + partJson(data ? JSON.stringify(data) : "null") + "</script>"
    + "<script>(function(){" + PART_BOOT + start + "})()</scr" + "ipt></body></html>";
}

export function partBlockHtml(block, uid, inline) {
  const meta = block.meta || {};
  const partId = typeof meta.part === "string" && PART_ID.test(meta.part) ? meta.part : "";
  const themeId = typeof meta.theme === "string" && PART_ID.test(meta.theme) ? meta.theme : "";
  const builtinTheme = PART_THEMES.find((t) => t.id === themeId);
  const text = String(block.text || "");
  const caption = meta.caption ? String(meta.caption) : "";
  const fig = (inner, failed) => '<figure class="acv-fig acv-part" data-part="' + partEsc(partId) + '" style="margin:1.2em 0"' + (failed ? ' data-failed="1"' : "") + ">" + inner + (caption ? '<figcaption style="margin-top:.5em;font-size:.88em;opacity:.72;text-align:center">' + partEsc(caption) + "</figcaption>" : "") + "</figure>";
  if (!partId) return fig('<div class="acv-fail" role="note"><p>부품 이름(part)이 없어요.</p><pre><code>' + partEsc(text.slice(0, 400)) + "</code></pre></div>", true);
  if (new TextEncoder().encode(text).length > PART_MAX_BYTES) return fig('<div class="acv-fail" role="note"><p>64KB 를 넘어서 보여 주지 않아요.</p></div>', true);
  const height = Number.isFinite(meta.height) ? Math.max(80, Math.min(1200, Math.trunc(meta.height))) : 160;
  const fid = "acv-f" + String(uid).replace(/[^\w-]/g, "");
  const resize = '<script>addEventListener("message",function(e){var f=document.getElementById("' + fid + '"),h=e.data&&+e.data.acvH;if(f&&e.source===f.contentWindow&&h>0)f.style.height=Math.min(20000,h)+"px"})</scr' + 'ipt>';
  return fig(resize + '<iframe id="' + fid + '" class="acv-frame acp-frame" data-part="' + partEsc(partId) + '" data-theme-id="' + partEsc(themeId) + '" sandbox="allow-scripts" referrerpolicy="no-referrer" title="' + partEsc(meta.alt || caption || "부품 " + partId) + '" style="width:100%;height:' + height + 'px;border:0;background:transparent" srcdoc="' + partEsc(partSrcdoc(partId, text, inline, themeId, builtinTheme ? partThemeCss(builtinTheme) : "")) + '"></iframe>');
}

// #38: a part's suggestion is new JSON data; name the values that change instead of diffing the JSON text.
export function partSuggestLine(before, after) {
  let a = null, b = null;
  try { a = JSON.parse(before); b = JSON.parse(after); } catch { return "에이전트가 이 부품의 데이터를 바꾸자고 해요."; }
  const changes = [];
  const walk = (x, y, path) => {
    if (changes.length > 4) return;
    if (x && y && typeof x === "object" && typeof y === "object") { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? path + "." + k : k); return; }
    if (JSON.stringify(x) !== JSON.stringify(y)) changes.push(path + ": " + (x === undefined ? "없음" : JSON.stringify(x)) + " → " + (y === undefined ? "없음" : JSON.stringify(y)));
  };
  walk(a, b, "");
  return "에이전트가 이 부품의 데이터를 바꾸자고 해요" + (changes.length ? ": " + changes.slice(0, 4).join(", ") + (changes.length > 4 ? " 외" : "") : ".");
}
