// Visual blocks -> HTML, with no client script: diagram (a Mermaid-syntax subset drawn as SVG), chart (JSON spec drawn
// as SVG with a CSS draw-in) and visual (sandboxed iframe). Used by block-html.js on the server and by the editor's
// lazy "visuals" chunk for live preview. Every user string reaches the SVG through esc(); no HTML labels, no links,
// no click callbacks (the effect of Mermaid securityLevel "strict"). Format: research/visuals/format.md.

const VIS_COLORS = ["#86dfe3", "#c4b2f4", "#94bff4", "#a4dcb9", "#f1c692", "#eab1cd"];
const VIS_STROKE = "#7b68ee";
export const VISUAL_MAX_BYTES = 64 * 1024;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function num(value) { return Math.round(value * 10) / 10; }
// Rough text width: CJK/full-width glyphs are about one em, the rest about 0.58 em.
function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) w += /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/.test(ch) ? size : size * 0.58;
  return w;
}
function clip(text, max) { const s = String(text).trim(); return s.length > max ? s.slice(0, max - 1) + "…" : s; }
function svgOpen(width, height, label, cls) {
  return '<svg class="acv ' + cls + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + num(width) + " " + num(height) + '" width="' + num(width) + '" role="img" aria-label="' + esc(label) + '" style="max-width:100%;height:auto;font-family:inherit"><title>' + esc(label) + "</title>";
}
function label(x, y, text, size, extra) {
  return '<text x="' + num(x) + '" y="' + num(y) + '" font-size="' + size + '" text-anchor="middle" dominant-baseline="central" fill="currentColor"' + (extra || "") + ">" + esc(text) + "</text>";
}
const IGNORED = /^(click|href|call|style|classDef|class|linkStyle|%%|accTitle|accDescr|direction\s)/;

const SHAPES = [
  [/^\(\[(.*)\]\)$/, "stadium"], [/^\(\((.*)\)\)$/, "circle"], [/^\[\[(.*)\]\]$/, "sub"], [/^\[\((.*)\)\]$/, "db"],
  [/^\{\{(.*)\}\}$/, "hex"], [/^\[(.*)\]$/, "rect"], [/^\((.*)\)$/, "round"], [/^\{(.*)\}$/, "diamond"], [/^>(.*)\]$/, "flag"],
];
function parseNode(token, nodes) {
  const m = /^([A-Za-z0-9_\u00c0-\uffff-]+)\s*(.*)$/.exec(token.trim());
  if (!m) return null;
  const id = m[1];
  let text = null, shape = null;
  for (const [re, kind] of SHAPES) {
    const s = re.exec(m[2].trim());
    if (s) { text = s[1].replace(/^"(.*)"$/, "$1"); shape = kind; break; }
  }
  const node = nodes.get(id) || { id, text: id, shape: "rect" };
  if (text !== null) { node.text = text; node.shape = shape; }
  nodes.set(id, node);
  return id;
}
const EDGE = /\s*(<?-->|<?---|<?-\.->|-\.-|<?==>|===|--x|--o)\s*(?:\|([^|]*)\|)?\s*/;
function parseFlowchart(lines, header) {
  const dir = (/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)/i.exec(header) || [])[1] || "TB";
  const nodes = new Map(), edges = [];
  for (const raw of lines) {
    const line = raw.trim().replace(/;$/, "");
    if (!line || IGNORED.test(line) || /^(subgraph|end)\b/.test(line)) continue;
    // "A -- text --> B" becomes "A -->|text| B"
    const normal = line.replace(/--\s+([^->|][^>]*?)\s+-->/g, "-->|$1|").replace(/==\s+([^=>|][^>]*?)\s+==>/g, "==>|$1|");
    const parts = normal.split(EDGE);
    let prev = null;
    for (let i = 0; i < parts.length; i += 3) {
      const group = (parts[i] || "").split("&").map((t) => parseNode(t, nodes)).filter(Boolean);
      if (prev && i > 0) {
        const kind = parts[i - 2], text = (parts[i - 1] || "").trim();
        for (const from of prev) for (const to of group) edges.push({ from, to, text, dashed: /\./.test(kind), thick: /=/.test(kind), arrow: />/.test(kind) });
      }
      prev = group;
    }
  }
  return { dir: dir.toUpperCase() === "TD" ? "TB" : dir.toUpperCase(), nodes: [...nodes.values()], edges };
}
function rankNodes(nodes, edges) {
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.from).push(e.to);
  // Drop back edges found by DFS so cycles still get a layering.
  const state = new Map(), forward = [];
  const visit = (id) => {
    state.set(id, 1);
    for (const to of out.get(id)) {
      if (state.get(to) === 1) continue;
      forward.push([id, to]);
      if (!state.get(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.get(n.id)) visit(n.id);
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const [a, b] of forward) if (rank.get(b) < rank.get(a) + 1) { rank.set(b, rank.get(a) + 1); moved = true; }
    if (!moved) break;
  }
  return rank;
}
function nodeShape(n, x, y, w, h, fill) {
  const s = ' fill="' + fill + '" fill-opacity=".55" stroke="' + VIS_STROKE + '" stroke-width="1.5"';
  const l = x - w / 2, t = y - h / 2;
  switch (n.shape) {
    case "diamond": return '<path d="M' + num(x) + " " + num(t) + " L" + num(x + w / 2) + " " + num(y) + " L" + num(x) + " " + num(t + h) + " L" + num(l) + " " + num(y) + ' Z"' + s + "/>";
    case "circle": return '<ellipse cx="' + num(x) + '" cy="' + num(y) + '" rx="' + num(w / 2) + '" ry="' + num(h / 2) + '"' + s + "/>";
    case "hex": return '<path d="M' + num(l + 12) + " " + num(t) + " H" + num(l + w - 12) + " L" + num(l + w) + " " + num(y) + " L" + num(l + w - 12) + " " + num(t + h) + " H" + num(l + 12) + " L" + num(l) + " " + num(y) + ' Z"' + s + "/>";
    case "stadium": case "round": case "db": return '<rect x="' + num(l) + '" y="' + num(t) + '" width="' + num(w) + '" height="' + num(h) + '" rx="' + (n.shape === "round" ? 10 : num(h / 2)) + '"' + s + "/>";
    default: return '<rect x="' + num(l) + '" y="' + num(t) + '" width="' + num(w) + '" height="' + num(h) + '" rx="4"' + s + "/>" + (n.shape === "sub" ? '<path d="M' + num(l + 8) + " " + num(t) + " V" + num(t + h) + " M" + num(l + w - 8) + " " + num(t) + " V" + num(t + h) + '" stroke="' + VIS_STROKE + '"/>' : "");
  }
}
function arrowDefs(id) {
  return '<defs><marker id="' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + VIS_STROKE + '"/></marker></defs>';
}
function wrapLines(text, size, max) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/(\s+)/)) {
    if (!word) continue;
    if (textWidth(line + word, size) <= max || !line.trim()) line += word;
    else { lines.push(line.trim()); line = word.trimStart(); }
    while (textWidth(line, size) > max) {
      let cut = line.length;
      while (cut > 1 && textWidth(line.slice(0, cut), size) > max) cut--;
      lines.push(line.slice(0, cut)); line = line.slice(cut);
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, 4);
}
function multiLabel(x, y, lines, size, extra) {
  const lead = size * 1.25, top = y - ((lines.length - 1) * lead) / 2;
  return '<text font-size="' + size + '" text-anchor="middle" dominant-baseline="central" fill="currentColor"' + (extra || "") + ">" + lines.map((l, i) => '<tspan x="' + num(x) + '" y="' + num(top + i * lead) + '">' + esc(l) + "</tspan>").join("") + "</text>";
}
function flowchartSvg(graph, title, uid, dirOverride) {
  if (!graph.nodes.length) return null;
  const dir = dirOverride || graph.dir;
  const rank = rankNodes(graph.nodes, graph.edges);
  const horizontal = dir === "LR" || dir === "RL";
  const nodes = graph.nodes.map((n) => {
    const lines = wrapLines(clip(n.text, 60), 14, horizontal ? 120 : 200);
    const tw = Math.max(...lines.map((l) => textWidth(l, 14)));
    const diamond = n.shape === "diamond";
    const w = Math.max(64, tw + 32) * (diamond ? 1.45 : 1), h = Math.max(44, lines.length * 17.5 + 18) * (diamond ? 1.4 : 1);
    return { ...n, lines, w, h: n.shape === "circle" ? Math.max(h, w * 0.5) : h };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layers = [];
  for (const n of nodes) (layers[rank.get(n.id)] ||= []).push(n);
  const back = (e) => e.from !== e.to && rank.get(e.to) <= rank.get(e.from);
  const labelW = Math.max(0, ...graph.edges.filter((e) => e.text && !back(e)).map((e) => textWidth(clip(e.text, 30), 12) + 16));
  const gapMain = Math.max(56, horizontal ? labelW + 28 : 56), gapCross = 28, pad = 20;
  const layerMain = layers.map((ns) => Math.max(...ns.map((n) => (horizontal ? n.w : n.h))));
  const layerCross = layers.map((ns) => ns.reduce((s, n) => s + (horizontal ? n.h : n.w), 0) + gapCross * (ns.length - 1));
  const cross = Math.max(...layerCross);
  let main = pad;
  layers.forEach((ns, li) => {
    let c = pad + (cross - layerCross[li]) / 2;
    for (const n of ns) {
      const size = horizontal ? n.h : n.w;
      const m = main + layerMain[li] / 2, k = c + size / 2;
      n.x = horizontal ? m : k; n.y = horizontal ? k : m;
      c += size + gapCross;
    }
    main += layerMain[li] + gapMain;
  });
  main += pad - gapMain;
  const backs = graph.edges.filter(back);
  const bow = backs.length ? 12 + 22 * backs.length + Math.max(0, ...backs.map((e) => (e.text ? (horizontal ? 8 : textWidth(clip(e.text, 30), 12) / 2 + 8) : 0))) : 0;
  let width = horizontal ? main : cross + pad * 2 + bow, height = horizontal ? cross + pad * 2 + bow : main;
  if (dir === "RL" || dir === "BT") for (const n of nodes) { if (dir === "RL") n.x = width - n.x; else n.y = height - n.y; }
  const exit = (n, toward) => {
    const dx = toward.x - n.x, dy = toward.y - n.y;
    if (!dx && !dy) return [n.x, n.y];
    const s = Math.max(Math.abs(dx) / (n.w / 2), Math.abs(dy) / (n.h / 2));
    return [n.x + dx / s, n.y + dy / s];
  };
  let backIndex = 0;
  const edgeSvg = graph.edges.map((e, i) => {
    const a = byId.get(e.from), b = byId.get(e.to);
    let d, mid;
    if (a === b) { d = "M" + num(a.x + a.w / 2) + " " + num(a.y - 6) + " c 28 -26, 28 26, 0 12"; mid = [a.x + a.w / 2 + 30, a.y]; }
    else if (back(e)) {
      const k = backIndex++;
      if (horizontal) {
        const yb = pad + cross + 22 + k * 22, p = [a.x, a.y + a.h / 2], q = [b.x, b.y + b.h / 2];
        d = "M" + num(p[0]) + " " + num(p[1]) + " C" + num(p[0]) + " " + num(yb) + " " + num(q[0]) + " " + num(yb) + " " + num(q[0]) + " " + num(q[1]);
        mid = [(p[0] + q[0]) / 2, yb - 4];
      } else {
        const xb = pad + cross + 22 + k * 22, p = [a.x + a.w / 2, a.y], q = [b.x + b.w / 2, b.y];
        d = "M" + num(p[0]) + " " + num(p[1]) + " C" + num(xb) + " " + num(p[1]) + " " + num(xb) + " " + num(q[1]) + " " + num(q[0]) + " " + num(q[1]);
        mid = [xb, (p[1] + q[1]) / 2];
      }
    } else { const p = exit(a, b), q = exit(b, a); d = "M" + num(p[0]) + " " + num(p[1]) + " L" + num(q[0]) + " " + num(q[1]); mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }
    const text = e.text ? clip(e.text, 30) : "", tw = text ? textWidth(text, 12) + 10 : 0;
    return '<path class="acv-edge" style="--i:' + i + '" d="' + d + '" fill="none" stroke="' + VIS_STROKE + '" stroke-width="' + (e.thick ? 3 : 1.5) + '"' + (e.dashed ? ' stroke-dasharray="5 4"' : "") + (e.arrow ? ' marker-end="url(#' + uid + ')"' : "") + "/>" +
      (text ? '<rect x="' + num(mid[0] - tw / 2) + '" y="' + num(mid[1] - 10) + '" width="' + num(tw) + '" height="20" rx="4" fill="#fff" fill-opacity=".92"/>' + label(mid[0], mid[1], text, 12, ' style="fill:#333"') : "");
  }).join("");
  const nodeSvg = nodes.map((n, i) => '<g class="acv-node" style="--i:' + i + '">' + nodeShape(n, n.x, n.y, n.w, n.h, VIS_COLORS[i % VIS_COLORS.length]) + multiLabel(n.x, n.y, n.lines, 14, ' style="fill:#1f1d2b"') + "</g>").join("");
  return svgOpen(width, height, title, "acv-flow") + arrowDefs(uid) + edgeSvg + nodeSvg + "</svg>";
}

function sequenceSvg(lines, title, uid) {
  const actors = [], index = new Map(), steps = [];
  const actor = (name) => { const key = name.trim(); if (!index.has(key)) { index.set(key, actors.length); actors.push({ id: key, text: key }); } return index.get(key); };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || IGNORED.test(line) || /^(autonumber|activate|deactivate|loop|end|alt|else|opt|par|and|rect|critical|break|box)\b/.test(line)) continue;
    const p = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/.exec(line);
    if (p) { const i = actor(p[2]); if (p[3]) actors[i].text = p[3].trim(); continue; }
    const note = /^note\s+(?:over|left of|right of)\s+([^:]+):\s*(.*)$/i.exec(line);
    if (note) { const ids = note[1].split(",").map(actor); steps.push({ note: true, from: Math.min(...ids), to: Math.max(...ids), text: note[2] }); continue; }
    const m = /^([^-:>]+?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?([^:]+?)\s*:\s*(.*)$/.exec(line);
    if (m) steps.push({ from: actor(m[1]), to: actor(m[3]), dashed: m[2].startsWith("--"), text: m[4] });
  }
  if (!actors.length) return null;
  const colW = Math.max(120, ...actors.map((a) => textWidth(clip(a.text, 24), 14) + 40), ...steps.filter((s) => !s.note).map((s) => (textWidth(clip(s.text, 40), 12) + 30) / Math.max(1, Math.abs(s.to - s.from))));
  const pad = 20, head = 40, rowH = 44;
  const width = pad * 2 + colW * actors.length, height = pad * 2 + head * 2 + rowH * steps.length + 24;
  const cx = (i) => pad + colW * i + colW / 2;
  let out = svgOpen(width, height, title, "acv-seq") + arrowDefs(uid);
  actors.forEach((a, i) => {
    out += '<line x1="' + num(cx(i)) + '" x2="' + num(cx(i)) + '" y1="' + (pad + head) + '" y2="' + (height - pad - head) + '" stroke="' + VIS_STROKE + '" stroke-opacity=".35" stroke-dasharray="4 4"/>';
    for (const y of [pad, height - pad - head]) out += '<rect x="' + num(cx(i) - colW / 2 + 10) + '" y="' + y + '" width="' + num(colW - 20) + '" height="' + head + '" rx="8" fill="' + VIS_COLORS[i % VIS_COLORS.length] + '" fill-opacity=".55" stroke="' + VIS_STROKE + '"/>' + label(cx(i), y + head / 2, clip(a.text, 24), 14, ' style="fill:#1f1d2b"');
  });
  steps.forEach((s, k) => {
    const y = pad + head + 24 + rowH * k + rowH / 2;
    if (s.note) {
      const l = cx(s.from) - colW / 2 + 16, r = cx(s.to) + colW / 2 - 16;
      out += '<g class="acv-node" style="--i:' + k + '"><rect x="' + num(l) + '" y="' + num(y - 15) + '" width="' + num(r - l) + '" height="30" rx="4" fill="#fff6c8" stroke="#e6c86a"/>' + label((l + r) / 2, y, clip(s.text, 50), 12, ' style="fill:#333"') + "</g>";
      return;
    }
    const x1 = cx(s.from), x2 = cx(s.to);
    const d = s.from === s.to ? "M" + num(x1) + " " + num(y - 8) + " h 36 v 16 h -34" : "M" + num(x1) + " " + num(y + 6) + " H" + num(x2 + (x2 > x1 ? -2 : 2));
    out += '<path class="acv-edge" style="--i:' + k + '" d="' + d + '" fill="none" stroke="' + VIS_STROKE + '" stroke-width="1.5"' + (s.dashed ? ' stroke-dasharray="5 4"' : "") + ' marker-end="url(#' + uid + ')"/>' + label(s.from === s.to ? x1 + 40 : (x1 + x2) / 2, y - 8, clip(s.text, 40), 12, s.from === s.to ? ' text-anchor="start"' : "");
  });
  return out + "</svg>";
}

function timelineSvg(lines, title) {
  let heading = "";
  const periods = [];
  let section = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || IGNORED.test(line)) continue;
    const t = /^title\s+(.+)$/.exec(line);
    if (t) { heading = t[1]; continue; }
    const s = /^section\s+(.+)$/.exec(line);
    if (s) { section = s[1]; continue; }
    const parts = line.split(/\s*:\s*/);
    if (parts.length >= 2 && parts[0]) periods.push({ name: parts[0], events: parts.slice(1).filter(Boolean), section });
    else if (parts[0] === "" && periods.length) periods[periods.length - 1].events.push(...parts.slice(1).filter(Boolean));
  }
  if (!periods.length) return null;
  const colW = Math.max(130, ...periods.map((p) => Math.max(textWidth(clip(p.name, 20), 14), ...p.events.map((e) => textWidth(clip(e, 22), 12))) + 24));
  const pad = 20, top = heading ? 44 : 16, maxEvents = Math.max(...periods.map((p) => p.events.length));
  const width = pad * 2 + colW * periods.length, height = top + 60 + maxEvents * 34 + pad;
  let out = svgOpen(width, height, title || heading, "acv-time");
  if (heading) out += label(width / 2, 22, clip(heading, 60), 16, ' font-weight="600"');
  const axis = top + 50;
  out += '<path class="acv-edge" style="--i:0" d="M' + pad + " " + axis + " H" + (width - pad) + '" stroke="' + VIS_STROKE + '" stroke-width="2"/>';
  periods.forEach((p, i) => {
    const x = pad + colW * i + colW / 2, fill = VIS_COLORS[i % VIS_COLORS.length];
    out += '<g class="acv-node" style="--i:' + i + '"><rect x="' + num(x - colW / 2 + 8) + '" y="' + top + '" width="' + num(colW - 16) + '" height="32" rx="16" fill="' + fill + '" fill-opacity=".7"/>' + label(x, top + 16, clip(p.name, 20), 14, ' font-weight="600" style="fill:#1f1d2b"') +
      '<circle cx="' + num(x) + '" cy="' + axis + '" r="6" fill="' + VIS_STROKE + '"/>' +
      p.events.map((e, k) => '<rect x="' + num(x - colW / 2 + 12) + '" y="' + (axis + 14 + k * 34) + '" width="' + num(colW - 24) + '" height="28" rx="6" fill="' + fill + '" fill-opacity=".3"/>' + label(x, axis + 28 + k * 34, clip(e, 22), 12)).join("") + "</g>";
  });
  return out + "</svg>";
}

const DAY = 86400000;
function parseDay(text) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim()); if (!m) return null; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return Number.isFinite(t) ? t : null; }
function parseSpan(text) { const m = /^(\d+(?:\.\d+)?)\s*([dwh])$/.exec(String(text).trim()); return m ? Number(m[1]) * (m[2] === "w" ? 7 : m[2] === "h" ? 1 / 24 : 1) * DAY : null; }
function ganttSvg(lines, title) {
  let heading = "", section = "";
  const tasks = [], byId = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || IGNORED.test(line) || /^(dateFormat|axisFormat|excludes|todayMarker|tickInterval|weekday|includes)\b/.test(line)) continue;
    const t = /^title\s+(.+)$/.exec(line);
    if (t) { heading = t[1]; continue; }
    const s = /^section\s+(.+)$/.exec(line);
    if (s) { section = s[1]; continue; }
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const fields = m[2].split(",").map((f) => f.trim()).filter(Boolean);
    const flags = [];
    while (fields.length && /^(done|active|crit|milestone)$/.test(fields[0])) flags.push(fields.shift());
    let id = null;
    if (fields.length >= 3 || (fields.length === 2 && !parseDay(fields[0]) && !/^after\s/.test(fields[0]))) id = fields.shift();
    const prev = tasks[tasks.length - 1];
    let start = prev ? prev.end : null, end = null;
    const startField = fields.length > 1 ? fields.shift() : null;
    if (startField) {
      const after = /^after\s+(.+)$/.exec(startField);
      start = after ? Math.max(...after[1].split(/\s+/).map((ref) => (byId.get(ref) || { end: start ?? 0 }).end)) : parseDay(startField) ?? start;
    }
    const last = fields.shift();
    if (last) end = parseDay(last) ?? (start !== null && parseSpan(last) !== null ? start + parseSpan(last) : null);
    if (start === null || end === null || end < start) continue;
    const task = { name: m[1].trim(), section, start, end, flags };
    tasks.push(task);
    if (id) byId.set(id, task);
  }
  if (!tasks.length) return null;
  const min = Math.min(...tasks.map((t) => t.start)), max = Math.max(...tasks.map((t) => t.end), min + DAY);
  const nameW = Math.min(220, Math.max(90, ...tasks.map((t) => textWidth(clip(t.name, 24), 13) + 20)));
  const pad = 20, top = heading ? 64 : 40, rowH = 30, plotW = 560;
  const width = pad * 2 + nameW + plotW, height = top + tasks.length * rowH + pad;
  const x = (t) => pad + nameW + ((t - min) / (max - min)) * plotW;
  let out = svgOpen(width, height, title || heading, "acv-gantt");
  if (heading) out += label(width / 2, 22, clip(heading, 60), 16, ' font-weight="600"');
  const ticks = 5;
  for (let k = 0; k <= ticks; k++) {
    const t = min + ((max - min) * k) / ticks, d = new Date(t);
    out += '<line x1="' + num(x(t)) + '" x2="' + num(x(t)) + '" y1="' + (top - 6) + '" y2="' + (height - pad) + '" stroke="currentColor" stroke-opacity=".12"/>' + label(x(t), top - 16, (d.getUTCMonth() + 1) + "/" + d.getUTCDate(), 11, ' fill-opacity=".7"');
  }
  let lastSection = null, color = -1;
  tasks.forEach((t, i) => {
    if (t.section !== lastSection) { lastSection = t.section; color++; }
    const y = top + i * rowH, fill = VIS_COLORS[color % VIS_COLORS.length];
    out += '<text x="' + (pad + nameW - 10) + '" y="' + (y + rowH / 2) + '" font-size="13" text-anchor="end" dominant-baseline="central" fill="currentColor">' + esc(clip(t.name, 24)) + "</text>";
    if (t.flags.includes("milestone")) out += '<path class="acv-bar" style="--i:' + i + '" d="M' + num(x(t.start)) + " " + (y + 5) + " l10 10 l-10 10 l-10 -10 z" + '" fill="' + VIS_STROKE + '"/>';
    else out += '<rect class="acv-bar" style="--i:' + i + '" x="' + num(x(t.start)) + '" y="' + (y + 6) + '" width="' + num(Math.max(3, x(t.end) - x(t.start))) + '" height="' + (rowH - 12) + '" rx="5" fill="' + (t.flags.includes("crit") ? "#f19a9a" : fill) + '"' + (t.flags.includes("done") ? ' fill-opacity=".5"' : "") + (t.flags.includes("active") ? ' stroke="' + VIS_STROKE + '" stroke-width="1.5"' : "") + "/>";
  });
  return out + "</svg>";
}

function mindmapSvg(lines, title) {
  const items = [];
  for (const raw of lines) {
    if (!raw.trim() || IGNORED.test(raw.trim()) || /^::icon/.test(raw.trim())) continue;
    const depth = /^\s*/.exec(raw)[0].replace(/\t/g, "  ").length;
    let text = raw.trim();
    for (const [re] of SHAPES) { const m = re.exec(text.replace(/^[A-Za-z0-9_-]+(?=[[({])/, "")); if (m) { text = m[1]; break; } }
    items.push({ depth, text: clip(text.replace(/^"(.*)"$/, "$1"), 30), children: [] });
  }
  if (!items.length) return null;
  const root = items[0], stack = [root];
  for (const item of items.slice(1)) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) stack.pop();
    stack[stack.length - 1].children.push(item);
    stack.push(item);
  }
  const pad = 20, rowH = 40, gap = 50;
  const levelW = [];
  const measure = (n, level) => { n.w = textWidth(n.text, level ? 13 : 15) + 28; levelW[level] = Math.max(levelW[level] || 0, n.w); n.children.forEach((c) => measure(c, level + 1)); };
  measure(root, 0);
  let row = 0;
  const place = (n, level) => {
    n.level = level;
    n.x = pad + levelW.slice(0, level).reduce((s, w) => s + w + gap, 0) + n.w / 2;
    if (!n.children.length) { n.y = pad + row * rowH + rowH / 2; row++; }
    else { n.children.forEach((c) => place(c, level + 1)); n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2; }
  };
  place(root, 0);
  const width = pad * 2 + levelW.reduce((s, w) => s + w + gap, 0) - gap, height = pad * 2 + Math.max(1, row) * rowH;
  let edges = "", nodes = "", k = 0, branch = 0;
  const draw = (n, color) => {
    const fill = n.level === 0 ? VIS_STROKE : VIS_COLORS[color % VIS_COLORS.length];
    nodes += '<g class="acv-node" style="--i:' + k++ + '"><rect x="' + num(n.x - n.w / 2) + '" y="' + num(n.y - 15) + '" width="' + num(n.w) + '" height="30" rx="15" fill="' + fill + '" fill-opacity="' + (n.level === 0 ? 1 : 0.6) + '"/>' + label(n.x, n.y, n.text, n.level ? 13 : 15, n.level ? ' style="fill:#1f1d2b"' : ' style="fill:#fff" font-weight="600"') + "</g>";
    n.children.forEach((c) => {
      const cc = n.level === 0 ? branch++ : color;
      const x1 = n.x + n.w / 2, x2 = c.x - c.w / 2, mx = (x1 + x2) / 2;
      edges += '<path class="acv-edge" style="--i:' + k + '" d="M' + num(x1) + " " + num(n.y) + " C" + num(mx) + " " + num(n.y) + " " + num(mx) + " " + num(c.y) + " " + num(x2) + " " + num(c.y) + '" fill="none" stroke="' + VIS_COLORS[cc % VIS_COLORS.length] + '" stroke-width="2.5"/>';
      draw(c, cc);
    });
  };
  draw(root, 0);
  return svgOpen(width, height, title || root.text, "acv-mind") + edges + nodes + "</svg>";
}

export const VISUAL_CSS = ".acv-fig{container-type:inline-size}.acv-narrow{display:none}@container (max-width:560px){.acv-wide:has(+.acv-narrow){display:none}.acv-narrow{display:block}}@media (prefers-reduced-motion:no-preference){.acv .acv-node,.acv .acv-bar,.acv .acv-edge{animation:acv-in .5s ease-out both;animation-delay:calc(var(--i,0)*60ms)}.acv .acv-bar{transform-box:fill-box;transform-origin:50% 100%;animation-name:acv-grow}.acv-gantt .acv-bar{transform-origin:0 50%;animation-name:acv-grow-x}.acv .acv-line{stroke-dasharray:var(--len);animation:acv-draw 1s ease-out both}}@keyframes acv-in{from{opacity:0}}@keyframes acv-grow{from{transform:scaleY(0)}}@keyframes acv-grow-x{from{transform:scaleX(0)}}@keyframes acv-draw{from{stroke-dashoffset:var(--len)}}";
const MOTION = "<style>" + VISUAL_CSS + "</style>";

export function diagramSvg(source, title, uid) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n").filter((l) => !/^\s*%%/.test(l));
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return null;
  const header = lines[first].trim(), rest = lines.slice(first + 1), id = "acv-m" + (uid || "0");
  try {
    if (/^(flowchart|graph)\b/i.test(header)) {
      const graph = parseFlowchart(rest, header);
      const wide = flowchartSvg(graph, title, id);
      if (!wide || (graph.dir !== "LR" && graph.dir !== "RL")) return wide;
      return '<div class="acv-wide">' + wide + '</div><div class="acv-narrow">' + flowchartSvg(graph, title, id + "n", "TB") + "</div>";
    }
    if (/^sequenceDiagram\b/.test(header)) return sequenceSvg(rest, title, id);
    if (/^timeline\b/.test(header)) return timelineSvg(rest, title);
    if (/^gantt\b/.test(header)) return ganttSvg(rest, title);
    if (/^mindmap\b/.test(header)) return mindmapSvg(rest, title);
  } catch (error) {
    return null;
  }
  return null;
}

export function parseChartSpec(text) {
  let data;
  try { data = JSON.parse(String(text || "")); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const type = ["bar", "line", "area", "pie"].includes(data.type) ? data.type : "bar";
  const labels = (Array.isArray(data.labels) ? data.labels : []).slice(0, 24).map((l) => clip(l, 20));
  const series = (Array.isArray(data.series) ? data.series : []).slice(0, type === "pie" ? 1 : 4).map((s, i) => ({
    name: clip(s && s.name != null ? s.name : "값 " + (i + 1), 30),
    data: labels.map((_, k) => { const v = s && Array.isArray(s.data) ? s.data[k] : null; return typeof v === "number" && Number.isFinite(v) ? v : null; }),
  }));
  if (!labels.length || !series.length) return null;
  return { type, title: data.title ? clip(data.title, 60) : "", unit: data.unit ? clip(data.unit, 8) : "", labels, series };
}
function fmt(v) { return Math.abs(v) >= 1e9 ? v.toExponential(2) : Number(v.toPrecision(6)).toLocaleString("ko-KR", { maximumFractionDigits: 2 }); }
export function chartSvg(spec, title) {
  const name = title || spec.title || "차트";
  const multi = spec.series.length > 1;
  if (spec.type === "pie") {
    const values = spec.series[0].data.map((v) => (v && v > 0 ? v : 0)), total = values.reduce((s, v) => s + v, 0);
    if (!total) return null;
    let a = -Math.PI / 2, out = svgOpen(560, 300, name, "acv-chart");
    const pos = (r, t) => num(150 + r * Math.cos(t)) + " " + num(150 + r * Math.sin(t));
    values.forEach((v, i) => {
      if (!v) return;
      const span = (v / total) * Math.PI * 2, end = a + span, mid = a + span / 2;
      out += '<path class="acv-node" style="--i:' + i + '" d="M150 150 L' + pos(120, a) + " A120 120 0 0 1 " + pos(120, mid) + " A120 120 0 0 1 " + pos(120, end) + ' Z" fill="' + VIS_COLORS[i % VIS_COLORS.length] + '" stroke="#fff" stroke-width="2"><title>' + esc(spec.labels[i] + ": " + fmt(v) + spec.unit) + "</title></path>";
      a = end;
    });
    spec.labels.forEach((l, i) => {
      out += '<rect x="300" y="' + (40 + i * 24) + '" width="12" height="12" rx="3" fill="' + VIS_COLORS[i % VIS_COLORS.length] + '"/><text x="320" y="' + (46 + i * 24) + '" font-size="13" dominant-baseline="central" fill="currentColor">' + esc(l + " · " + (values[i] ? fmt(values[i]) + spec.unit + " (" + Math.round((values[i] / total) * 100) + "%)" : "-")) + "</text>";
    });
    return MOTION + out + "</svg>";
  }
  const all = spec.series.flatMap((s) => s.data.filter((v) => v !== null));
  if (!all.length) return null;
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all) || 1;
  const n = spec.labels.length, width = Math.max(480, n * (multi && spec.type === "bar" ? 28 * spec.series.length + 24 : 64) + 90), height = multi ? 330 : 300;
  const left = 60, right = 20, top = 24, bottom = 250;
  const step = (width - left - right) / n, x = (i) => left + step * (i + 0.5);
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  let out = svgOpen(width, height, name, "acv-chart");
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    out += '<line x1="' + left + '" x2="' + (width - right) + '" y1="' + num(y(v)) + '" y2="' + num(y(v)) + '" stroke="currentColor" stroke-opacity=".12"/><text x="' + (left - 8) + '" y="' + num(y(v)) + '" font-size="11" text-anchor="end" dominant-baseline="central" fill="currentColor" fill-opacity=".7">' + esc(fmt(v)) + "</text>";
  }
  out += '<line x1="' + left + '" x2="' + (width - right) + '" y1="' + num(y(0)) + '" y2="' + num(y(0)) + '" stroke="currentColor" stroke-opacity=".35"/>';
  spec.series.forEach((s, si) => {
    const color = multi ? VIS_COLORS[si % VIS_COLORS.length] : null;
    if (spec.type === "bar") {
      const bw = (step * 0.7) / spec.series.length;
      s.data.forEach((v, i) => {
        if (v === null) return;
        const bx = x(i) - (step * 0.7) / 2 + bw * si;
        out += '<rect class="acv-bar" style="--i:' + (i + si) + '" x="' + num(bx) + '" y="' + num(Math.min(y(0), y(v))) + '" width="' + num(bw - 2) + '" height="' + num(Math.abs(y(v) - y(0))) + '" rx="4" fill="' + (color || VIS_COLORS[i % VIS_COLORS.length]) + '"><title>' + esc(spec.labels[i] + " · " + s.name + ": " + fmt(v) + spec.unit) + "</title></rect>";
        if (!multi) out += label(bx + bw / 2 - 1, y(v) + (v < 0 ? 12 : -12), fmt(v) + spec.unit, 12, ' class="acv-node" style="--i:' + i + '"');
      });
    } else {
      const pts = s.data.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) return;
      const stroke = color || VIS_STROKE;
      const len = Math.ceil(pts.reduce((sum, p, i) => sum + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)) + 1;
      if (spec.type === "area") out += '<path class="acv-node" d="M' + num(pts[0][0]) + " " + num(y(0)) + pts.map((p) => " L" + num(p[0]) + " " + num(p[1])).join("") + " L" + num(pts[pts.length - 1][0]) + " " + num(y(0)) + ' Z" fill="' + stroke + '" fill-opacity=".18"/>';
      out += '<polyline class="acv-line" style="--len:' + len + '" points="' + pts.map((p) => num(p[0]) + "," + num(p[1])).join(" ") + '" fill="none" stroke="' + stroke + '" stroke-width="3" stroke-linejoin="round"/>';
      s.data.forEach((v, i) => { if (v !== null) out += '<circle class="acv-node" style="--i:' + i + '" cx="' + num(x(i)) + '" cy="' + num(y(v)) + '" r="4.5" fill="' + stroke + '"><title>' + esc(spec.labels[i] + " · " + s.name + ": " + fmt(v) + spec.unit) + "</title></circle>"; });
    }
  });
  spec.labels.forEach((l, i) => { out += label(x(i), bottom + 18, clip(l, Math.max(4, Math.floor(step / 9))), 12); });
  if (multi) spec.series.forEach((s, si) => { const lx = left + si * 130; out += '<rect x="' + lx + '" y="' + (height - 26) + '" width="12" height="12" rx="3" fill="' + VIS_COLORS[si % VIS_COLORS.length] + '"/><text x="' + (lx + 18) + '" y="' + (height - 20) + '" font-size="12" dominant-baseline="central" fill="currentColor">' + esc(s.name) + "</text>"; });
  return MOTION + out + "</svg>";
}

export const VISUAL_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";
export function visualSrcdoc(source) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + VISUAL_CSP + '"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;font-family:system-ui,sans-serif}body{display:flow-root}</style></head><body>' + String(source) + '<script>(function(){function h(){parent.postMessage({acvH:Math.ceil(document.body.getBoundingClientRect().height)},"*")}addEventListener("load",h);new ResizeObserver(h).observe(document.body)})()</scr' + 'ipt></body></html>';
}

function figure(type, inner, meta, fallback) {
  const caption = meta && meta.caption ? String(meta.caption) : "";
  return '<figure class="acv-fig acv-' + type + '" style="margin:1.2em 0;padding:16px;border:1px solid rgba(123,104,238,.16);border-radius:14px;overflow-x:auto;text-align:center"' + (fallback ? ' data-failed="1"' : "") + ">" + inner + (caption ? '<figcaption style="margin-top:.5em;font-size:.88em;opacity:.72">' + esc(caption) + "</figcaption>" : "") + "</figure>";
}
function failed(text, why) {
  return '<div class="acv-fail" role="note"><p>' + esc(why) + '</p><pre><code>' + esc(text) + "</code></pre></div>";
}

// One visual block -> HTML. uid keeps marker ids unique within a page.
export function visualBlockHtml(block, uid) {
  const meta = block.meta || {};
  const name = String(meta.alt || meta.caption || "");
  if (block.type === "diagram") {
    const svg = diagramSvg(block.text, name || "다이어그램", uid);
    return svg ? figure("diagram", MOTION + svg, meta) : figure("diagram", failed(block.text, "그리지 못한 다이어그램이에요. flowchart, sequenceDiagram, timeline, gantt, mindmap 을 쓸 수 있어요."), meta, true);
  }
  if (block.type === "chart") {
    const spec = parseChartSpec(block.text);
    const svg = spec && chartSvg(spec, name);
    return svg ? figure("chart", svg, meta) : figure("chart", failed(block.text, "차트 명세를 읽지 못했어요."), meta, true);
  }
  // visual (agent SVG/CSS) and html (HTML block: charts, demos, layouts) share one sandbox: opaque origin, no network.
  if (block.type === "visual" || block.type === "html") {
    const source = String(block.text || "");
    if (new TextEncoder().encode(source).length > VISUAL_MAX_BYTES) return figure(block.type, failed(source.slice(0, 400), "64KB 를 넘어서 보여 주지 않아요."), meta, true);
    const height = Number.isFinite(meta.height) ? Math.max(120, Math.min(1200, Math.trunc(meta.height))) : 320;
    const fid = "acv-f" + String(uid).replace(/[^\w-]/g, "");
    const resize = '<script>addEventListener("message",function(e){var f=document.getElementById("' + fid + '"),h=e.data&&+e.data.acvH;if(f&&e.source===f.contentWindow&&h)f.style.height=Math.min(1200,Math.max(120,h))+"px"})</scr' + 'ipt>';
    return figure(block.type, resize + '<iframe id="' + fid + '" class="acv-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="' + esc(name || (block.type === "html" ? "HTML 블록" : "시각 자료")) + '" style="width:100%;height:' + height + 'px;border:0;border-radius:8px;background:#fff" srcdoc="' + esc(visualSrcdoc(source)) + '"></iframe>', meta);
  }
  return "";
}
