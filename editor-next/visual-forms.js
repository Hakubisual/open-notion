// Form <-> code conversion for diagram and chart blocks. Forms write the same Mermaid / acard-chart JSON text
// as hand-written blocks (docs: research/visuals/easy-edit-format.md). A block the form cannot represent exactly
// (toText(fromText(x)) !== x) opens in code mode so it is never rewritten silently.

var ID = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function nid(i) { return i < 26 ? ID[i] : ID[Math.floor(i / 26) - 1] + ID[i % 26]; }
function clean(s) { return String(s).replace(/[\[\]{}()|"<>:;]/g, " ").replace(/\s+/g, " ").trim(); }
function lines(text) { return String(text || "").split("\n").map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim(); }); }

export var DIAGRAM_KINDS = [
  { kind: "flow", label: "흐름", help: "한 줄에 한 단계씩 쓰세요.", sample: "기획\n디자인\n개발\n테스트\n출시" },
  { kind: "branch", label: "예/아니오", help: "첫 줄은 질문, '예:' 와 '아니오:' 로 시작하는 줄에 결과를 쓰세요.", sample: "재고가 있나요?\n예: 바로 배송\n아니오: 입고 알림" },
  { kind: "timeline", label: "타임라인", help: "'시점: 내용' 형식으로 한 줄씩 쓰세요.", sample: "1월: 기획 시작\n3월: 베타 공개\n6월: 정식 출시" },
  { kind: "mindmap", label: "마인드맵", help: "첫 줄이 가운데 주제예요. 들여쓰기(스페이스 2칸)로 가지를 만드세요.", sample: "새 서비스\n  사용자\n    학생\n    직장인\n  기능\n    메모\n    공유" },
  { kind: "org", label: "조직도", help: "첫 줄이 맨 위예요. 들여쓰기(스페이스 2칸)로 아래 사람을 쓰세요.", sample: "대표\n  개발팀장\n    프론트엔드\n    백엔드\n  디자인팀장" }
];

function tree(items) {
  var root = null, stack = [];
  items.forEach(function (raw, i) {
    var depth = /^\s*/.exec(raw)[0].replace(/\t/g, "  ").length;
    var node = { text: clean(raw), depth: depth, i: i, children: [] };
    if (!root) { root = node; stack = [node]; return; }
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root;
}

export function diagramToText(kind, input) {
  var items = lines(input);
  if (!items.length) return "";
  if (kind === "flow") {
    var out = ["flowchart LR"];
    items.forEach(function (t, i) { out.push("  " + nid(i) + "[" + clean(t) + "]" + (i ? "" : "")); });
    for (var i = 1; i < items.length; i += 1) out.push("  " + nid(i - 1) + " --> " + nid(i));
    return out.join("\n");
  }
  if (kind === "branch") {
    var q = clean(items[0]).replace(/\?$/, "") + "?";
    var yes = [], no = [];
    items.slice(1).forEach(function (t) {
      var m = /^\s*(예|네|yes|아니오|아니요|no)\s*[:：]\s*(.+)$/i.exec(t);
      if (m) (/^(예|네|yes)$/i.test(m[1]) ? yes : no).push(clean(m[2]));
    });
    var b = ["flowchart TD", "  Q{" + q + "}"], n = 0;
    yes.forEach(function (t) { b.push("  Q -->|예| Y" + n + "[" + t + "]"); n += 1; });
    no.forEach(function (t) { b.push("  Q -->|아니오| N" + n + "[" + t + "]"); n += 1; });
    return b.join("\n");
  }
  if (kind === "timeline") {
    var tl = ["timeline"];
    items.forEach(function (t) {
      var m = /^\s*([^:：]+)[:：]\s*(.*)$/.exec(t);
      tl.push("  " + (m ? clean(m[1]) + " : " + clean(m[2] || "-") : clean(t) + " : -"));
    });
    return tl.join("\n");
  }
  var root = tree(items);
  if (kind === "mindmap") {
    var mm = ["mindmap", "  root((" + root.text + "))"];
    (function walk(node, depth) { node.children.forEach(function (c) { mm.push("  ".repeat(depth + 2) + c.text); walk(c, depth + 1); }); })(root, 0);
    return mm.join("\n");
  }
  if (kind === "org") {
    var og = ["flowchart TD"], k = 0;
    (function walk(node) {
      node.id = nid(k); k += 1;
      og.push("  " + node.id + "[" + node.text + "]");
      node.children.forEach(function (c) { walk(c); og.push("  " + node.id + " --> " + c.id); });
    })(root);
    return og.join("\n");
  }
  return "";
}

// Reads Mermaid text back into {kind, input}; returns null unless regenerating gives the identical text.
export function diagramFromText(text) {
  var src = String(text || "").trim();
  if (!src) return { kind: "flow", input: "" };
  var ls = src.split("\n"), head = ls[0].trim(), body = ls.slice(1).map(function (l) { return l.trim(); });
  var candidates = [];
  var label = function (l) { var m = /^[A-Z]+\d*\[(.*)\]$/.exec(l); return m ? m[1] : null; };
  if (head === "flowchart LR") candidates.push({ kind: "flow", input: body.map(label).filter(function (x) { return x !== null; }).join("\n") });
  if (head === "timeline") candidates.push({ kind: "timeline", input: body.map(function (l) { return l.replace(/ : -$/, ":").replace(" : ", ": "); }).join("\n").replace(/:$/gm, "") });
  if (head === "mindmap") {
    var raw = ls.slice(1), root = /^\s*root\(\((.*)\)\)$/.exec(raw[0] || "");
    if (root) candidates.push({ kind: "mindmap", input: [root[1]].concat(raw.slice(1).map(function (l) { return l.slice(4); })).join("\n") });
  }
  if (head === "flowchart TD" && /^Q\{/.test(body[0] || "")) {
    var bi = [body[0].slice(2, -1)];
    body.slice(1).forEach(function (l) { var m = /^Q -->\|(예|아니오)\| [YN]\d+\[(.*)\]$/.exec(l); if (m) bi.push(m[1] + ": " + m[2]); });
    candidates.push({ kind: "branch", input: bi.join("\n") });
  }
  if (head === "flowchart TD") {
    var names = {}, kids = {}, order = [], hasParent = {};
    body.forEach(function (l) {
      var n = /^([A-Z]+)\[(.*)\]$/.exec(l), e = /^([A-Z]+) --> ([A-Z]+)$/.exec(l);
      if (n) { names[n[1]] = n[2]; order.push(n[1]); }
      else if (e) { (kids[e[1]] = kids[e[1]] || []).push(e[2]); hasParent[e[2]] = 1; }
    });
    var top = order.filter(function (id) { return !hasParent[id]; });
    if (top.length === 1) {
      var out = [];
      (function walk(id, d) { out.push("  ".repeat(d) + names[id]); (kids[id] || []).forEach(function (c) { walk(c, d + 1); }); })(top[0], 0);
      candidates.push({ kind: "org", input: out.join("\n") });
    }
  }
  for (var i = 0; i < candidates.length; i += 1) {
    if (diagramToText(candidates[i].kind, candidates[i].input) === src) return candidates[i];
  }
  return null;
}

export var CHART_TYPES = [["bar", "막대"], ["line", "선"], ["pie", "원"], ["area", "영역"]];

export function chartToText(spec) {
  var out = { type: spec.type || "bar" };
  if (spec.title) out.title = spec.title;
  out.labels = spec.labels;
  out.series = spec.series.map(function (s) { return { name: s.name, data: s.data }; });
  if (spec.unit) out.unit = spec.unit;
  return JSON.stringify(out);
}

export function chartFromText(text) {
  var src = String(text || "").trim();
  if (!src) return { type: "bar", title: "", labels: ["1월", "2월", "3월"], series: [{ name: "값", data: [3, 5, 8] }] };
  try {
    var d = JSON.parse(src);
    if (!d || !Array.isArray(d.labels) || !Array.isArray(d.series) || !d.series.length) return null;
    var ok = d.series.every(function (s) { return s && typeof s.name === "string" && Array.isArray(s.data) && s.data.every(function (v) { return v === null || typeof v === "number"; }); });
    if (!ok) return null;
    var spec = { type: d.type || "bar", title: d.title || "", labels: d.labels.map(String), series: d.series, unit: d.unit };
    return JSON.stringify(JSON.parse(chartToText(spec))) === JSON.stringify(d) ? spec : null;
  } catch (e) { return null; }
}

function num(v) { var n = Number(String(v).replace(/[,\s%₩$원명개]/g, "")); return String(v).trim() !== "" && isFinite(n) ? n : null; }

// Table block meta {columns, rows} -> chart spec: first column = labels, every numeric column = a series.
export function chartFromTable(meta, title) {
  var cols = meta.columns || [], rows = (meta.rows || []).filter(function (r) { return r.some(function (v) { return String(v).trim(); }); });
  var series = [];
  for (var c = 1; c < cols.length; c += 1) {
    var vals = rows.map(function (r) { return num(r[c]); });
    if (vals.some(function (v) { return v !== null; })) series.push({ name: String(cols[c]), data: vals });
  }
  if (!series.length || !rows.length) return null;
  return { type: "bar", title: title || "", labels: rows.map(function (r) { return String(r[0]); }), series: series.slice(0, 4) };
}

// "1월 120" / "- 사과: 30" lines -> chart spec, or null when fewer than 2 numeric lines.
export function chartFromLines(textLines) {
  var labels = [], data = [];
  textLines.forEach(function (l) {
    var m = /^\s*(?:[-*•]|\d+[.)])?\s*(.+?)\s*[:：=\-]?\s*(-?[\d,]+(?:\.\d+)?)\s*([%명개원]|만원)?\s*$/.exec(l);
    if (m && num(m[2]) !== null) { labels.push(m[1].replace(/[:：]$/, "").trim()); data.push(num(m[2])); }
  });
  return labels.length >= 2 && labels.length === textLines.length ? { type: "bar", title: "", labels: labels, series: [{ name: "값", data: data }] } : null;
}
