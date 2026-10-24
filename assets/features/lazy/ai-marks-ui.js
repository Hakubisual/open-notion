// AI marks in the editor (acard-human-edit): draws a block's mark (lock / ref) and marked text pieces (CSS in this chunk),
// and gives the menus one place to change them: setBlock(id, mark), setRange(id, start, end, mark), setPage(mark).
// A mark is the person's own note for the AI; people can always edit marked text. Server: features/human-blocks.js.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  // The marks model (/ai-marks.js, the same file the Worker inlines) loads with this chunk, once.
  var ready = window.AiMarks ? Promise.resolve() : new Promise(function (resolve, reject) {
    var s = document.createElement("script"); s.src = "/ai-marks.js"; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
  });
  var M = null;
  function withModel(fn) { return function () { var args = arguments; return ready.then(function () { M = window.AiMarks; return fn.apply(null, args); }); }; }
  var LABEL = { edit: "AI가 바꿔도 됨", lock: "고정", ref: "참고", smart: "자동" };

  function toast(text) {
    var t = document.createElement("div");
    t.className = "aim-toast"; t.setAttribute("role", "status"); t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function find(id) { return editor.state.blocks.find(function (b) { return b.id === id; }); }

  // Whole block: lock / ref / edit. "edit" is stored only when the page default is not edit (it overrides it).
  function setBlock(id, mark) {
    var block = find(id);
    if (!block) return;
    var meta = Object.assign({}, block.meta);
    var page = (document.getElementById("doc") || {}).dataset ? document.getElementById("doc").dataset.aiDefault || "edit" : "edit";
    if (mark === "edit" && page === "edit") delete meta.ai; else meta.ai = mark;
    block.meta = Object.keys(meta).length ? meta : null;
    editor.render(); editor.scheduleSave();
    toast(mark === "lock" ? "이 블록은 AI가 바꾸지 않아요" : mark === "ref" ? "AI가 이 블록을 참고 자료로 읽어요" : "AI가 이 블록을 고칠 수 있어요");
  }

  // A piece of one block's text ([start, end) in plain-text offsets): lock / ref, or edit to clear the piece's mark.
  function setRange(id, start, end, mark) {
    var block = find(id);
    if (!block || !(end > start)) return;
    var runs = Array.isArray(block.meta && block.meta.richText) ? block.meta.richText : [{ text: String(block.text || "") }];
    var withPiece = M.withSpans({ text: block.text, meta: { richText: runs } }, [[start, end - start, mark === "edit" ? "lock" : mark]]).richText;
    if (mark === "edit") {
      var at = 0;
      withPiece = withPiece.map(function (run) {
        var from = at; at += run.text.length;
        if (from >= start && at <= end && run.ai) { var copy = Object.assign({}, run); delete copy.ai; return copy; }
        return run;
      });
    }
    var meta = Object.assign({}, block.meta, { richText: withPiece });
    delete meta.aiSpans;
    block.meta = meta;
    editor.render(); editor.scheduleSave();
    toast(mark === "lock" ? "고른 부분은 AI가 바꾸지 않아요" : mark === "ref" ? "고른 부분을 AI가 참고해요" : "고른 부분의 표시를 풀었어요");
  }

  function setPage(mark) {
    return editor.api("/page/" + encodeURIComponent(editor.slug) + "/settings", { method: "PUT", body: JSON.stringify({ ai: mark }) }).then(function (data) {
      var doc = document.getElementById("doc");
      doc.dataset.aiDefault = data.settings.ai || "edit";
      paintPill();
      editor.render();
      toast("페이지 기본: " + LABEL[doc.dataset.aiDefault]);
      return data.settings;
    });
  }

  var pill = null;
  function paintPill() {
    var doc = document.getElementById("doc");
    var v = (doc && doc.dataset.aiDefault) || "edit";
    if (!pill) {
      pill = document.createElement("button");
      pill.type = "button"; pill.className = "aim-pill";
      pill.addEventListener("click", function () { editor.lazy("context-menu").then(function (menu) { menu.openPageMarks(pill); }, function () {}); });
      var tools = document.getElementById("page-tools");
      if (tools) tools.appendChild(pill);
    }
    pill.dataset.v = v;
    pill.replaceChildren(document.createElement("i"), document.createTextNode("페이지 기본: " + LABEL[v]));
    pill.setAttribute("aria-label", "AI 기본 표시: " + LABEL[v] + " (바꾸기)");
    pill.hidden = v === "edit" && !editor.state.blocks.some(function (b) { return M.effective(b, "edit") !== "edit" || M.spans(b).length; });
  }

  function markOf(id) {
    var block = find(id), doc = document.getElementById("doc");
    return block ? M.effective(block, (doc && doc.dataset.aiDefault) || "edit") : "edit";
  }

  editor.on("saved", function () { if (pill) paintPill(); });
  ready.then(function () { M = window.AiMarks; paintPill(); }, function () {});
  editor.provide("ai-marks-ui", { ready: ready, setBlock: withModel(setBlock), setRange: withModel(setRange), setPage: withModel(setPage), markOf: withModel(markOf), paintPill: withModel(paintPill), LABEL: LABEL });
})();
