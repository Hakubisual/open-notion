// Acard plugin UI tree (#144). A plugin never sends HTML: its render() returns a tree of nodes from a fixed set of
// components (text, stat, compare, chart, steps, callout, tabs ... and controls), the way GPT-6 Intelligent UI composes
// answers from native components. One renderer draws the tree inside the sandbox frame (live, with controls) and on the
// server for shared/published pages (static snapshot, controls disabled, no script). Every string is escaped; only
// **bold** and `code` survive as markup. Dependency-free: inlined into the worker, bundled into the frame boot script
// (scripts/build-plugin-frame.ts) and re-exported by the plugin SDK.

export const PLUGIN_UI_LIMITS = Object.freeze({ nodes: 400, depth: 8, text: 2000, bytes: 64 * 1024, items: 50, columns: 8, rows: 100, series: 6, points: 200, options: 30 });
const TONES = ["neutral", "info", "success", "warning", "danger", "accent"];
const NODE = new Set(["text", "heading", "stat", "stats", "compare", "table", "chart", "steps", "callout", "tabs", "badge", "list", "divider", "row", "column", "grid",
  "button", "input", "slider", "select", "toggle", "form"]);
const NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function rich(v) { return esc(v).replace(/\*\*([^*]{1,200})\*\*/g, "<b>$1</b>").replace(/`([^`]{1,200})`/g, "<code>$1</code>"); }
function num(v) { return typeof v === "number" && Number.isFinite(v); }
function fmt(v) { return num(v) ? (Math.round(v * 1000) / 1000).toLocaleString("ko-KR") : String(v ?? ""); }

// Returns a cleaned copy (unknown nodes and fields dropped, lists and strings capped) plus warnings; never throws.
export function checkTree(input) {
  const warnings = [];
  let count = 0;
  const str = (v, max = PLUGIN_UI_LIMITS.text) => (typeof v === "string" ? v : num(v) ? String(v) : typeof v === "boolean" ? String(v) : "").slice(0, max);
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const tone = (v) => (TONES.includes(v) ? v : "neutral");
  const walk = (n, depth) => {
    if (n === null || n === undefined || n === false) return null;
    if (typeof n === "string" || num(n)) return { t: "text", text: str(n) };
    if (typeof n !== "object" || Array.isArray(n)) { warnings.push("bad node"); return null; }
    if (!NODE.has(n.t)) { warnings.push("unknown node " + String(n.t).slice(0, 20)); return null; }
    if (++count > PLUGIN_UI_LIMITS.nodes) { if (count === PLUGIN_UI_LIMITS.nodes + 1) warnings.push("too many nodes"); return null; }
    if (depth > PLUGIN_UI_LIMITS.depth) { warnings.push("too deep"); return null; }
    const kids = (v) => list(v, PLUGIN_UI_LIMITS.items).map((c) => walk(c, depth + 1)).filter(Boolean);
    switch (n.t) {
      case "text": return { t: "text", text: str(n.text), ...(n.muted ? { muted: true } : {}) };
      case "heading": return { t: "heading", text: str(n.text, 200), level: [2, 3, 4].includes(n.level) ? n.level : 3 };
      case "stat": return { t: "stat", label: str(n.label, 80), value: str(n.value, 40), delta: str(n.delta, 16), note: str(n.note, 160) };
      case "stats": return { t: "stats", items: list(n.items, 8).filter((x) => x && typeof x === "object").map((x) => ({ label: str(x.label, 80), value: str(x.value, 40), delta: str(x.delta, 16) })) };
      case "compare": case "table": {
        const columns = list(n.columns, PLUGIN_UI_LIMITS.columns).map((c) => str(c, 60));
        const rows = list(n.rows, PLUGIN_UI_LIMITS.rows).filter(Array.isArray).map((r) => r.slice(0, columns.length || PLUGIN_UI_LIMITS.columns).map((c) => (c === true || c === false ? c : str(c, 200))));
        return { t: n.t, columns, rows, ...(Number.isInteger(n.highlight) ? { highlight: n.highlight } : {}) };
      }
      case "chart": return { t: "chart", kind: n.kind === "line" ? "line" : "bar", labels: list(n.labels, PLUGIN_UI_LIMITS.points).map((l) => str(l, 24)),
        series: list(n.series, PLUGIN_UI_LIMITS.series).filter((s) => s && typeof s === "object").map((s) => ({ name: str(s.name, 40), data: list(s.data, PLUGIN_UI_LIMITS.points).map((d) => (num(d) ? d : null)) })), unit: str(n.unit, 8) };
      case "steps": return { t: "steps", items: list(n.items, 12).filter((x) => x && typeof x === "object").map((x) => ({ title: str(x.title, 80), text: str(x.text, 200), state: ["done", "now", "todo"].includes(x.state) ? x.state : "todo" })) };
      case "callout": return { t: "callout", tone: tone(n.tone), title: str(n.title, 80), text: str(n.text) };
      case "badge": return { t: "badge", text: str(n.text, 40), tone: tone(n.tone) };
      case "list": return { t: "list", ordered: Boolean(n.ordered), items: list(n.items, PLUGIN_UI_LIMITS.items).map((x) => str(x, 400)) };
      case "divider": return { t: "divider" };
      case "tabs": return { t: "tabs", items: list(n.items, 8).filter((x) => x && typeof x === "object").map((x) => ({ label: str(x.label, 40), children: kids(x.children) })) };
      case "row": case "column": return { t: n.t, children: kids(n.children) };
      case "grid": return { t: "grid", cols: Number.isInteger(n.cols) && n.cols >= 1 && n.cols <= 4 ? n.cols : 2, children: kids(n.children) };
      case "button": return { t: "button", label: str(n.label, 40), action: NAME.test(n.action) ? n.action : "click", tone: n.tone === "primary" ? "primary" : "default" };
      case "input": return { t: "input", name: NAME.test(n.name) ? n.name : "value", label: str(n.label, 60), kind: n.kind === "number" ? "number" : "text", value: str(n.value, 400), placeholder: str(n.placeholder, 60) };
      case "slider": {
        const min = num(n.min) ? n.min : 0, max = num(n.max) && n.max > min ? n.max : min + 100;
        const value = num(n.value) ? Math.min(max, Math.max(min, n.value)) : min;
        return { t: "slider", name: NAME.test(n.name) ? n.name : "value", label: str(n.label, 60), min, max, step: num(n.step) && n.step > 0 ? n.step : 1, value };
      }
      case "select": return { t: "select", name: NAME.test(n.name) ? n.name : "value", label: str(n.label, 60), options: list(n.options, PLUGIN_UI_LIMITS.options).filter((o) => o && typeof o === "object").map((o) => ({ value: str(o.value, 60), label: str(o.label, 60) })), value: str(n.value, 60) };
      case "toggle": return { t: "toggle", name: NAME.test(n.name) ? n.name : "value", label: str(n.label, 60), value: Boolean(n.value) };
      case "form": return { t: "form", action: NAME.test(n.action) ? n.action : "submit", submit: str(n.submit, 40) || "확인", children: kids(n.children) };
    }
    return null;
  };
  const roots = Array.isArray(input) ? input : [input];
  const tree = { t: "column", children: roots.slice(0, PLUGIN_UI_LIMITS.items).map((n) => walk(n, 1)).filter(Boolean) };
  const bytes = new TextEncoder().encode(JSON.stringify(tree)).length;
  if (bytes > PLUGIN_UI_LIMITS.bytes) return { tree: null, warnings: [...warnings, "too big"], bytes };
  return { tree, warnings, bytes };
}

function chartSvg(n) {
  const W = 560, H = 180, top = 8, labels = n.labels, series = n.series;
  const values = series.flatMap((s) => s.data.filter(num));
  const max = Math.max(0, ...values) || 1, min = Math.min(0, ...values);
  const y = (v) => top + H - ((v - min) / (max - min || 1)) * H;
  const count = Math.max(1, labels.length, ...series.map((s) => s.data.length)), band = W / count;
  const colors = ["var(--pl-c1)", "var(--pl-c2)", "var(--pl-c3)", "var(--pl-c4)", "var(--pl-c5)", "var(--pl-c6)"];
  let out = '<svg class="pl-chart" viewBox="0 0 ' + W + " " + (H + top + 22) + '" role="img" aria-label="' + esc(series.map((s) => s.name).join(", ") || "chart") + '">';
  for (let i = 0; i <= 4; i++) { const v = min + ((max - min) * i) / 4; out += '<line x1="0" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" class="pl-grid"/>'; }
  series.forEach((s, si) => {
    if (n.kind === "line") {
      const pts = s.data.map((d, i) => (num(d) ? (i * band + band / 2).toFixed(1) + "," + y(d).toFixed(1) : null)).filter(Boolean).join(" ");
      out += '<polyline points="' + pts + '" fill="none" stroke="' + colors[si] + '" stroke-width="2.5" stroke-linejoin="round"/>';
    } else {
      const w = (band * 0.7) / Math.max(1, series.length);
      s.data.forEach((d, i) => { if (!num(d)) return; const x = i * band + band * 0.15 + w * si; out += '<rect x="' + x.toFixed(1) + '" y="' + Math.min(y(d), y(0)).toFixed(1) + '" width="' + Math.max(1, w - 2).toFixed(1) + '" height="' + Math.abs(y(0) - y(d)).toFixed(1) + '" rx="3" fill="' + colors[si] + '"><title>' + esc((labels[i] ?? "") + ": " + fmt(d) + n.unit) + "</title></rect>"; });
    }
  });
  const every = Math.ceil(count / 12);
  labels.forEach((l, i) => { if (i % every === 0) out += '<text x="' + (i * band + band / 2).toFixed(1) + '" y="' + (H + top + 16) + '" text-anchor="middle" class="pl-axis">' + esc(l) + "</text>"; });
  return out + "</svg>" + (series.length > 1 ? '<div class="pl-legend">' + series.map((s, i) => '<span><i style="background:' + colors[i] + '"></i>' + esc(s.name) + "</span>").join("") + "</div>" : "");
}

// HTML for a checked tree. static: true = no live controls (shared pages and the reader for logged-out visitors).
export function renderTreeHtml(tree, opts = {}) {
  const off = opts.static ? " disabled" : "";
  let uid = 0;
  const cell = (v) => (v === true ? '<span class="pl-yes" aria-label="예">✓</span>' : v === false ? '<span class="pl-no" aria-label="아니요">—</span>' : rich(v));
  const draw = (n) => {
    if (!n) return "";
    const kids = (list) => (list || []).map(draw).join("");
    switch (n.t) {
      case "text": return '<p class="pl-text' + (n.muted ? " pl-muted" : "") + '">' + rich(n.text).replace(/\n/g, "<br>") + "</p>";
      case "heading": return "<h" + n.level + ' class="pl-h">' + rich(n.text) + "</h" + n.level + ">";
      case "stat": return '<div class="pl-stat"><span class="pl-stat-l">' + rich(n.label) + '</span><span class="pl-stat-v">' + esc(n.value) + "</span>" + (n.delta ? '<span class="pl-delta' + (/^\s*[-−↓]/.test(n.delta) ? " down" : /^\s*[+↑]/.test(n.delta) ? " up" : "") + '">' + esc(n.delta) + "</span>" : "") + (n.note ? '<span class="pl-muted">' + rich(n.note) + "</span>" : "") + "</div>";
      case "stats": return '<div class="pl-stats">' + n.items.map((s) => draw({ t: "stat", ...s, note: "" })).join("") + "</div>";
      case "compare": case "table": {
        const hl = n.t === "compare" && Number.isInteger(n.highlight) ? n.highlight : -1;
        const c = (j) => (j === hl ? ' class="pl-hl"' : "");
        return '<div class="pl-table" tabindex="0"><table><thead><tr>' + n.columns.map((h, j) => "<th" + c(j) + ">" + rich(h) + "</th>").join("") + "</tr></thead><tbody>" +
          n.rows.map((r) => "<tr>" + r.map((v, j) => (j === 0 && n.t === "compare" ? "<th>" + cell(v) + "</th>" : "<td" + c(j) + ">" + cell(v) + "</td>")).join("") + "</tr>").join("") + "</tbody></table></div>";
      }
      case "chart": return '<figure class="pl-fig">' + chartSvg(n) + "</figure>";
      case "steps": return '<ol class="pl-steps">' + n.items.map((s, i) => '<li class="pl-step ' + s.state + '"><span class="pl-mark">' + (s.state === "done" ? "✓" : i + 1) + '</span><span><b>' + rich(s.title) + "</b>" + (s.text ? '<span class="pl-muted">' + rich(s.text) + "</span>" : "") + "</span></li>").join("") + "</ol>";
      case "callout": return '<div class="pl-callout ' + n.tone + '" role="note">' + (n.title ? "<b>" + rich(n.title) + "</b>" : "") + "<p>" + rich(n.text) + "</p></div>";
      case "badge": return '<span class="pl-badge ' + n.tone + '">' + esc(n.text) + "</span>";
      case "list": return (n.ordered ? "<ol" : "<ul") + ' class="pl-list">' + n.items.map((x) => "<li>" + rich(x) + "</li>").join("") + (n.ordered ? "</ol>" : "</ul>");
      case "divider": return '<hr class="pl-hr">';
      case "tabs": {
        const id = "pl-tab" + ++uid;
        return '<div class="pl-tabs">' + n.items.map((tab, i) => '<input type="radio" name="' + id + '" id="' + id + i + '"' + (i === 0 ? " checked" : "") + '><label for="' + id + i + '">' + esc(tab.label) + '</label><div class="pl-tab">' + kids(tab.children) + "</div>").join("") + "</div>";
      }
      case "row": return '<div class="pl-row">' + kids(n.children) + "</div>";
      case "column": return '<div class="pl-col">' + kids(n.children) + "</div>";
      case "grid": return '<div class="pl-grid" style="--pl-cols:' + n.cols + '">' + kids(n.children) + "</div>";
      case "button": return '<button type="button" class="pl-btn' + (n.tone === "primary" ? " primary" : "") + '" data-action="' + esc(n.action) + '"' + off + ">" + esc(n.label) + "</button>";
      case "input": return '<label class="pl-field"><span>' + esc(n.label) + '</span><input class="pl-in" name="' + esc(n.name) + '" type="' + (n.kind === "number" ? "number" : "text") + '" value="' + esc(n.value) + '" placeholder="' + esc(n.placeholder) + '"' + off + "></label>";
      case "slider": return '<label class="pl-field"><span>' + esc(n.label) + ' <output>' + esc(fmt(n.value)) + '</output></span><input class="pl-range" type="range" name="' + esc(n.name) + '" min="' + n.min + '" max="' + n.max + '" step="' + n.step + '" value="' + n.value + '"' + off + "></label>";
      case "select": return '<label class="pl-field"><span>' + esc(n.label) + '</span><select class="pl-in" name="' + esc(n.name) + '"' + off + ">" + n.options.map((o) => '<option value="' + esc(o.value) + '"' + (o.value === n.value ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></label>";
      case "toggle": return '<label class="pl-toggle"><input type="checkbox" name="' + esc(n.name) + '"' + (n.value ? " checked" : "") + off + "><span>" + esc(n.label) + "</span></label>";
      case "form": return '<form class="pl-form" data-action="' + esc(n.action) + '">' + kids(n.children) + '<button type="submit" class="pl-btn primary"' + off + ">" + esc(n.submit) + "</button></form>";
    }
    return "";
  };
  return '<div class="pl-ui">' + draw(tree) + "</div>";
}

// Layout by content kind (owner order, Intelligent UI 3): one number -> stat, a {name: number} map -> stats, rows of
// objects -> compare, a list of strings -> steps, numbers or {x, y} points -> a line chart, anything else -> text.
export function uiAuto(data, title) {
  const head = title ? [{ t: "heading", text: String(title), level: 3 }] : [];
  if (num(data)) return [...head, { t: "stat", label: title || "", value: fmt(data) }];
  if (Array.isArray(data) && data.length && data.every(num)) return [...head, { t: "chart", kind: "line", labels: data.map((_, i) => String(i + 1)), series: [{ name: title || "", data }] }];
  if (Array.isArray(data) && data.length && data.every((p) => p && typeof p === "object" && "x" in p && num(p.y))) return [...head, { t: "chart", kind: "line", labels: data.map((p) => String(p.x)), series: [{ name: title || "", data: data.map((p) => p.y) }] }];
  if (Array.isArray(data) && data.length && data.every((s) => typeof s === "string")) return [...head, { t: "steps", items: data.map((s, i) => ({ title: s, state: i === 0 ? "now" : "todo" })) }];
  if (Array.isArray(data) && data.length && data.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
    const keys = [...new Set(data.flatMap((r) => Object.keys(r)))].slice(0, PLUGIN_UI_LIMITS.columns);
    return [...head, { t: "compare", columns: keys, rows: data.map((r) => keys.map((k) => (typeof r[k] === "boolean" ? r[k] : r[k] ?? ""))) }];
  }
  if (data && typeof data === "object" && Object.values(data).length && Object.values(data).every(num)) return [...head, { t: "stats", items: Object.entries(data).slice(0, 8).map(([label, v]) => ({ label, value: fmt(v) })) }];
  return [...head, { t: "text", text: typeof data === "string" ? data : JSON.stringify(data ?? "") }];
}

// Builders for plugin code (acard.ui.* inside the sandbox worker, and the SDK).
export const ui = Object.freeze({
  text: (text, o) => ({ t: "text", text, ...o }), heading: (text, level = 3) => ({ t: "heading", text, level }),
  stat: (label, value, delta, note) => ({ t: "stat", label, value, delta, note }), stats: (items) => ({ t: "stats", items }),
  compare: (columns, rows, highlight) => ({ t: "compare", columns, rows, highlight }), table: (columns, rows) => ({ t: "table", columns, rows }),
  chart: (kind, labels, series, unit) => ({ t: "chart", kind, labels, series, unit }), steps: (items) => ({ t: "steps", items }),
  callout: (tone, title, text) => ({ t: "callout", tone, title, text }), badge: (text, tone) => ({ t: "badge", text, tone }), list: (items, ordered) => ({ t: "list", items, ordered }),
  divider: () => ({ t: "divider" }), tabs: (items) => ({ t: "tabs", items }), row: (...children) => ({ t: "row", children }), column: (...children) => ({ t: "column", children }),
  grid: (cols, ...children) => ({ t: "grid", cols, children }), button: (label, action, tone) => ({ t: "button", label, action, tone }),
  input: (name, label, value, kind) => ({ t: "input", name, label, value, kind }), slider: (name, label, value, min, max, step) => ({ t: "slider", name, label, value, min, max, step }),
  select: (name, label, options, value) => ({ t: "select", name, label, options, value }), toggle: (name, label, value) => ({ t: "toggle", name, label, value }),
  form: (action, submit, ...children) => ({ t: "form", action, submit, children }), auto: uiAuto,
});

export const PLUGIN_UI_CSS = ":root{--pl-r:12px;--pl-font:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,system-ui,'Malgun Gothic',sans-serif;--pl-mono:ui-monospace,Consolas,monospace;--pl-fg:#26252c;--pl-dim:#6b6977;--pl-line:#e8e7ee;--pl-card:#fff;--pl-soft:#f6f6f9;--pl-acc:#6e56cf;--pl-acc-soft:#efebfd;--pl-on-acc:#fff;--pl-ok-b:#e3f5ec;--pl-ok-f:#1d7550;--pl-warn-b:#fdf3d8;--pl-warn-f:#7f590b;--pl-bad-b:#fdeaec;--pl-bad-f:#b13443;--pl-info-b:#e5f0fd;--pl-info-f:#2563b8;--pl-c1:#6e56cf;--pl-c2:#86c5e8;--pl-c3:#e0a63c;--pl-c4:#3fa37a;--pl-c5:#e46b8a;--pl-c6:#7a7887;color-scheme:light}" +
  ":root[data-theme=dark]{--pl-fg:#ecebf2;--pl-dim:#a3a1ad;--pl-line:#33333b;--pl-card:#1b1b20;--pl-soft:#25252c;--pl-acc:#a597ff;--pl-acc-soft:#2e2950;--pl-on-acc:#16151a;--pl-ok-b:#1f3a2e;--pl-ok-f:#8ee0b5;--pl-warn-b:#3f3520;--pl-warn-f:#f2d38a;--pl-bad-b:#45252b;--pl-bad-f:#ffadb6;--pl-info-b:#1e3149;--pl-info-f:#9cc6fb;--pl-c1:#a597ff;--pl-c2:#5fa8d3;--pl-c3:#f2c66b;--pl-c4:#6fd3a6;--pl-c5:#ff9db5;--pl-c6:#a3a1ad;color-scheme:dark}" +
  ".pl-ui{font-family:var(--pl-font);font-size:var(--fs-14,14px);line-height:1.55;color:var(--pl-fg);display:flex;flex-direction:column;gap:12px}.pl-ui *{box-sizing:border-box}.pl-text{margin:0}.pl-muted{color:var(--pl-dim);font-size:13px}.pl-h{margin:4px 0 0;font-weight:700;line-height:1.3}h2.pl-h{font-size:20px}h3.pl-h{font-size:17px}h4.pl-h{font-size:15px}" +
  ".pl-ui code{font-family:var(--pl-mono);font-size:.92em;padding:1px 5px;border-radius:5px;background:var(--pl-soft)}" +
  ".pl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.pl-stat{display:flex;flex-direction:column;gap:3px;padding:12px 14px;border:1px solid var(--pl-line);border-radius:12px;background:var(--pl-card)}.pl-stat-l{color:var(--pl-dim);font-size:13px}.pl-stat-v{font-size:24px;font-weight:750;line-height:1.2;overflow-wrap:anywhere}" +
  ".pl-delta{align-self:flex-start;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:650;background:var(--pl-soft);color:var(--pl-dim)}.pl-delta.up{background:var(--pl-ok-b);color:var(--pl-ok-f)}.pl-delta.down{background:var(--pl-bad-b);color:var(--pl-bad-f)}" +
  ".pl-table{overflow-x:auto;border:1px solid var(--pl-line);border-radius:12px}.pl-table table{width:100%;border-collapse:collapse}.pl-table th,.pl-table td{padding:8px 12px;border-top:1px solid var(--pl-line);text-align:left;vertical-align:top}.pl-table thead th{border-top:0;background:var(--pl-soft);font-weight:650}.pl-table tbody th{color:var(--pl-dim);font-weight:500}.pl-hl{background:var(--pl-acc-soft)}.pl-yes{color:var(--pl-acc);font-weight:700}.pl-no{color:var(--pl-dim)}" +
  ".pl-fig{margin:0}.pl-chart{width:100%;height:auto;display:block}.pl-grid line,.pl-chart .pl-grid{stroke:var(--pl-line)}.pl-axis{fill:var(--pl-dim);font-size:12px}.pl-legend{display:flex;flex-wrap:wrap;gap:12px;color:var(--pl-dim);font-size:12px}.pl-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px}" +
  ".pl-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.pl-step{display:flex;gap:10px;align-items:flex-start}.pl-step>span:last-child{display:flex;flex-direction:column}.pl-mark{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:99px;border:2px solid var(--pl-line);font-size:12px;font-weight:700;color:var(--pl-dim)}.pl-step.done .pl-mark{background:var(--pl-acc);border-color:var(--pl-acc);color:var(--pl-on-acc)}.pl-step.now .pl-mark{border-color:var(--pl-acc);color:var(--pl-acc)}" +
  ".pl-callout{padding:10px 14px;border-radius:12px;background:var(--pl-soft);border:1px solid var(--pl-line)}.pl-callout p{margin:2px 0 0}.pl-callout.info{background:var(--pl-info-b);border-color:transparent;color:var(--pl-info-f)}.pl-callout.success{background:var(--pl-ok-b);border-color:transparent;color:var(--pl-ok-f)}.pl-callout.warning{background:var(--pl-warn-b);border-color:transparent;color:var(--pl-warn-f)}.pl-callout.danger{background:var(--pl-bad-b);border-color:transparent;color:var(--pl-bad-f)}.pl-callout.accent{background:var(--pl-acc-soft);border-color:transparent}" +
  ".pl-badge{display:inline-block;align-self:flex-start;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:650;background:var(--pl-soft);color:var(--pl-dim)}.pl-badge.info{background:var(--pl-info-b);color:var(--pl-info-f)}.pl-badge.success{background:var(--pl-ok-b);color:var(--pl-ok-f)}.pl-badge.warning{background:var(--pl-warn-b);color:var(--pl-warn-f)}.pl-badge.danger{background:var(--pl-bad-b);color:var(--pl-bad-f)}.pl-badge.accent{background:var(--pl-acc-soft);color:var(--pl-acc)}" +
  ".pl-list{margin:0;padding-left:20px}.pl-hr{border:0;border-top:1px solid var(--pl-line);margin:4px 0;width:100%}.pl-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.pl-col{display:flex;flex-direction:column;gap:12px}.pl-grid{display:grid;grid-template-columns:repeat(var(--pl-cols),minmax(0,1fr));gap:10px}@media (max-width:480px){.pl-grid{grid-template-columns:1fr}}" +
  ".pl-tabs{display:flex;flex-wrap:wrap;gap:4px}.pl-tabs>input{position:absolute;opacity:0;pointer-events:none}.pl-tabs>label{order:0;padding:5px 12px;border-radius:99px;cursor:pointer;color:var(--pl-dim);font-weight:600}.pl-tabs>input:checked+label{background:var(--pl-acc-soft);color:var(--pl-acc)}.pl-tabs>input:focus-visible+label{outline:2px solid var(--pl-acc);outline-offset:2px}.pl-tab{order:1;width:100%;display:none;padding-top:8px}.pl-tabs>input:checked+label+.pl-tab{display:flex;flex-direction:column;gap:12px}" +
  ".pl-btn{font:inherit;font-weight:600;min-height:36px;padding:6px 14px;border-radius:10px;border:1px solid var(--pl-line);background:var(--pl-card);color:var(--pl-fg);cursor:pointer}.pl-btn.primary{background:var(--pl-acc);border-color:var(--pl-acc);color:var(--pl-on-acc)}.pl-btn:disabled{opacity:.55;cursor:default}.pl-btn:focus-visible,.pl-in:focus-visible,.pl-range:focus-visible,.pl-toggle input:focus-visible{outline:2px solid var(--pl-acc);outline-offset:2px}" +
  ".pl-field{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--pl-dim)}.pl-field output{color:var(--pl-fg);font-weight:650}.pl-in{font:inherit;color:var(--pl-fg);background:var(--pl-card);border:1px solid var(--pl-line);border-radius:10px;min-height:36px;padding:6px 10px}.pl-range{width:100%;accent-color:var(--pl-acc)}" +
  ".pl-toggle{display:inline-flex;gap:8px;align-items:center;cursor:pointer}.pl-toggle input{accent-color:var(--pl-acc);width:18px;height:18px}.pl-form{display:flex;flex-direction:column;gap:10px;align-items:flex-start}";
