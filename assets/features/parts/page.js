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

function mount(host, block, save) {
  var doc = host.ownerDocument;
  var meta = block.meta || (block.meta = {});
  var part = typeof meta.part === "string" ? meta.part : "";
  var def = PART_DEFAULTS.filter(function (p) { return p.id === part; })[0];
  if (!block.text && def) { block.text = JSON.stringify(def.sample, null, 2); save(); }
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

if (window.AcardEditor) window.AcardEditor.provide("parts", { mount: mount });
