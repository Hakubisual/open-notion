// Page side of parts (#38), built into assets/features/lazy/parts.js by scripts/build-parts.ts (bun scripts/build-parts.ts).
// The reader adds it once to pages that have a part block; the editor loads it with lazy("parts"). It never runs part
// code itself: it answers each part frame's {acpReady} with the code ({acpCode} for a default part, {acpHtml} for a
// workspace part read from /api/parts/<id>) and the page theme, and keeps the theme in sync. The code and the data
// stay inside the sandboxed frame.
import { PART_RUNTIME, PART_DEFAULT_IDS, PART_DEFAULTS, partBlockHtml, parsePartData, validatePartData } from "../../../part-html.js";

var root = document.documentElement;
var dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
var workspace = {};
var themes = {};
var BUILTIN_THEMES = ["acard", "terminal", "bento", "neon", "paper"];

function themeFor(id) {
  if (!id || BUILTIN_THEMES.indexOf(id) >= 0) return Promise.resolve("");
  if (!themes[id]) themes[id] = fetch("/api/parts/themes/" + encodeURIComponent(id), { credentials: "same-origin", headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; }).then(function (t) { return t && typeof t.css === "string" ? t.css : ""; }, function () { return ""; });
  return themes[id];
}

function theme() {
  var mode = root.getAttribute("data-theme");
  if (mode === "dark" || mode === "light") return mode;
  return dark && dark.matches ? "dark" : "light";
}

function frames() { return Array.prototype.slice.call(document.querySelectorAll("iframe.acp-frame")); }

function codeFor(part) {
  if (PART_DEFAULT_IDS.has(part)) return Promise.resolve({ acpCode: PART_RUNTIME });
  if (!workspace[part]) {
    workspace[part] = fetch("/api/parts/" + encodeURIComponent(part), { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (row) { return row && typeof row.code === "string" ? { acpHtml: row.code } : { acpCode: PART_RUNTIME }; }, function () { return { acpCode: PART_RUNTIME }; });
  }
  return workspace[part];
}

addEventListener("message", function (e) {
  var m = e.data;
  if (!m || (!m.acpReady && !m.acvH)) return;
  var frame = frames().filter(function (f) { return f.contentWindow === e.source; })[0];
  if (!frame) return;
  if (m.acvH) { frame.style.height = Math.min(20000, +m.acvH) + "px"; return; }
  var part = frame.getAttribute("data-part") || "";
  Promise.all([codeFor(part), themeFor(frame.getAttribute("data-theme-id") || "")]).then(function (got) {
    var code = got[0], msg = { acpTheme: theme() };
    for (var k in code) msg[k] = code[k];
    if (got[1]) msg.acpThemeCss = got[1];
    frame.contentWindow.postMessage(msg, "*");
  });
});

function sendTheme() { var t = theme(); frames().forEach(function (f) { f.contentWindow && f.contentWindow.postMessage({ acpTheme: t }, "*"); }); }
new MutationObserver(sendTheme).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
if (dark && dark.addEventListener) dark.addEventListener("change", sendTheme);
frames().forEach(function (f) { f.contentWindow && f.contentWindow.postMessage({ acpHello: 1 }, "*"); });

// The '/' menu (#38 draft A): a 부품 group with the five defaults and a 내 부품 group with this workspace's parts (the same
// list list_parts gives agents). Picking one turns the line into a part block with the part's sample data and opens
// the fill form (lazy part-form) on it.
var THUMB = {
  badge: '<rect x="3" y="6" width="26" height="20" rx="3" class="t-soft"/><circle cx="8" cy="11" r="2" class="t-ok"/><circle cx="8" cy="16" r="2" class="t-acc"/><circle cx="8" cy="21" r="2" class="t-hi"/><path d="M12 11h12M12 16h9M12 21h11" class="t-ln"/>',
  table: '<rect x="3" y="6" width="26" height="20" rx="3" class="t-soft"/><path d="M3 11h26M3 16h26M3 21h26M12 6v20M21 6v20" class="t-ln"/><path d="M22.5 23.5h5" class="t-hi t-w"/>',
  chart: '<path d="M4 26h24" class="t-ln"/><rect x="6" y="16" width="3.5" height="9" rx="1" class="t-acc"/><rect x="11.5" y="11" width="3.5" height="14" rx="1" class="t-bar"/><rect x="17" y="14" width="3.5" height="11" rx="1" class="t-acc"/><rect x="22.5" y="7" width="3.5" height="18" rx="1" class="t-hi"/>',
  heatmap: '<g class="t-acc"><rect x="4" y="7" width="5" height="5" rx="1" opacity=".35"/><rect x="10.5" y="7" width="5" height="5" rx="1"/><rect x="17" y="7" width="5" height="5" rx="1" opacity=".6"/><rect x="23.5" y="7" width="5" height="5" rx="1" opacity=".2"/><rect x="4" y="13.5" width="5" height="5" rx="1" opacity=".8"/><rect x="10.5" y="13.5" width="5" height="5" rx="1" opacity=".3"/><rect x="17" y="13.5" width="5" height="5" rx="1"/><rect x="23.5" y="13.5" width="5" height="5" rx="1" opacity=".55"/><rect x="4" y="20" width="5" height="5" rx="1" opacity=".5"/><rect x="10.5" y="20" width="5" height="5" rx="1" opacity=".9"/><rect x="17" y="20" width="5" height="5" rx="1" opacity=".25"/><rect x="23.5" y="20" width="5" height="5" rx="1" opacity=".7"/></g>',
  dag: '<path d="M10 16c4 0 4-6 8-6M10 16c4 0 4 6 8 6" class="t-ln"/><rect x="3" y="12.5" width="8" height="7" rx="2" class="t-acc"/><circle cx="22" cy="10" r="4" class="t-bar"/><circle cx="22" cy="22" r="4" class="t-hi"/>',
  mine: '<rect x="3" y="6" width="26" height="20" rx="3" class="t-soft"/><path d="M7 11h9M7 15h6" class="t-ln"/><rect x="18" y="17" width="2.5" height="6" rx=".5" class="t-bar"/><rect x="21.5" y="14" width="2.5" height="9" rx=".5" class="t-acc"/><rect x="25" y="16" width="2.5" height="7" rx=".5" class="t-bar"/>'
};
var DESC = {
  badge: "상태를 한눈에 보여주는 카드예요", table: "숫자를 입력하면 합계를 자동으로 계산해요", chart: "수치를 막대·선으로 시각화해요",
  heatmap: "데이터의 분포를 한눈에 보여줘요", dag: "과정과 관계를 흐름도로 정리해요"
};
var LABEL = { badge: "상태 카드", table: "표 (합계 자동)", chart: "차트 (막대·선)", heatmap: "히트맵 (열지도)", dag: "흐름도 (DAG)" };
var ALIAS = { badge: "상태 카드 배지 badge status kpi", table: "표 합계 자동 table sum", chart: "차트 막대 선 그래프 chart bar line", heatmap: "히트맵 열지도 heatmap", dag: "흐름도 dag 단계 구조 flow pipeline" };
var mine = [];
var listed = null;
var focusId = "";

function thumb(id) { return '<svg class="acp-thumb" viewBox="0 0 32 32" aria-hidden="true">' + (THUMB[id] || THUMB.mine) + "</svg>"; }
function entry(p, own) {
  return { type: "part:" + p.id, label: (!own && LABEL[p.id]) || p.name || p.id, hint: own ? "내 부품" : "부품", ico: thumb(own ? "mine" : p.id), part: p.id, v: p.version || 1, mine: own,
    desc: own ? "우리 팀이 만든 부품이에요" : DESC[p.id] || "", aliases: "부품 part " + (ALIAS[p.id] || "") + " " + p.id,
    preview: function () { return partBlockHtml({ type: "part", text: JSON.stringify(p.sample || {}), meta: { part: p.id, v: p.version || 1, height: 150 } }, "pv-" + p.id); } };
}
// Workspace parts come from GET /api/parts once per editor; the defaults are always there even when the list fails.
function load(api) {
  if (!listed) listed = Promise.resolve(api ? api("/parts") : null).then(function (body) {
    mine = (body && body.parts || []).filter(function (p) { return !p.builtin && PART_ID_RE.test(p.id); });
  }, function () { mine = []; });
  return listed;
}
var PART_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
// After 부품으로 등록 (#38 stage 2): drop the memoised list and read it again so the '/' menu shows the new part at once.
function reload(api) { listed = null; return load(api); }
function slashItems() { return PART_DEFAULTS.map(function (p) { return entry(p, false); }).concat(mine.map(function (p) { return entry(p, true); })); }
function partInfo(id) {
  var def = PART_DEFAULTS.filter(function (p) { return p.id === id; })[0];
  if (def) return def;
  return mine.filter(function (p) { return p.id === id; })[0] || null;
}
// Turns the block into a part block: meta {part, v}, the part's sample as its data, and the form takes the focus.
function pick(block, id) {
  var p = partInfo(id);
  if (!p) return false;
  block.type = "part";
  block.meta = { part: p.id, v: p.version || 1 };
  block.text = JSON.stringify(p.sample && typeof p.sample === "object" ? p.sample : {}, null, 2);
  focusId = block.id;
  return true;
}

// Inserts a part block with the part's sample after state.blocks[index] (-1: at the end), draws and saves; returns the
// new block, or null when the part is unknown.
function insertPart(editor, index, id) {
  var p = partInfo(id);
  if (!p || !editor || !editor.state) return null;
  var blocks = editor.state.blocks, at = index < 0 || index >= blocks.length ? blocks.length : index + 1;
  var block = { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: "part", text: JSON.stringify(p.sample && typeof p.sample === "object" ? p.sample : {}, null, 2), checked: false, indent: index >= 0 && blocks[index] ? blocks[index].indent || 0 : 0, meta: { part: p.id, v: p.version || 1 } };
  blocks.splice(at, 0, block);
  focusId = block.id;
  if (editor.render) editor.render();
  if (editor.scheduleSave) editor.scheduleSave();
  return block;
}

function mount(host, block, save) {
  var meta = block.meta || (block.meta = {});
  var part = typeof meta.part === "string" ? meta.part : "";
  var def = PART_DEFAULTS.filter(function (p) { return p.id === part; })[0];
  if (!block.text && def) { block.text = JSON.stringify(def.sample, null, 2); save(); }
  var focus = focusId && focusId === block.id;
  if (focus) focusId = "";
  var editor = window.AcardEditor;
  if (!editor || !editor.lazy) return mountJson(host, block, save, def);
  Promise.all([editor.lazy("part-form"), def ? null : load(editor.api)]).then(function (got) {
    var info = partInfo(part) || {};
    got[0].mount(host, { block: block, schema: info.schema || {}, name: info.name || part, version: meta.v || info.version || 1, focus: focus,
      parse: parsePartData, validate: validatePartData, save: save,
      preview: function (el) { el.innerHTML = partBlockHtml(block, "ed" + String(block.id || "").replace(/[^\w-]/g, "")); } });
  }, function () { mountJson(host, block, save, def); });
}

function mountJson(host, block, save, def) {
  var doc = host.ownerDocument;
  var part = (block.meta && block.meta.part) || "";
  host.className = "acv-editor acp-editor";
  host.replaceChildren();
  var head = doc.createElement("div"), area = doc.createElement("textarea"), note = doc.createElement("p"), preview = doc.createElement("div"), timer = 0;
  head.className = "acv-head";
  head.textContent = "부품 " + (def ? def.name : part) + " · 데이터(JSON)";
  area.className = "acv-source";
  area.spellcheck = false;
  area.setAttribute("aria-label", "부품 데이터");
  area.value = block.text;
  area.rows = Math.min(16, Math.max(4, block.text.split("\n").length + 1));
  note.className = "acv-hint";
  preview.className = "acv-preview";
  function check() {
    var data = parsePartData(block.text);
    var errors = !data ? ["JSON 객체가 아니에요."] : def ? validatePartData(def.schema, data) : [];
    note.textContent = errors.length ? errors.slice(0, 3).join(" · ") : "데이터만 고치면 부품이 다시 그려져요. 코드는 부품에 있어요.";
  }
  function draw() { preview.innerHTML = partBlockHtml(block, "ed" + String(block.id || "").replace(/[^\w-]/g, "")); check(); }
  area.addEventListener("input", function () { block.text = area.value; save(); clearTimeout(timer); timer = setTimeout(draw, 250); });
  area.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
  host.append(head, area, note, preview);
  draw();
}

if (window.AcardEditor) window.AcardEditor.provide("parts", { mount: mount, load: load, reload: reload, slashItems: slashItems, pick: pick, insertPart: insertPart });
