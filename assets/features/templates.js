(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  function button(text, fn, className) {
    var el = document.createElement("button"); el.type = "button"; el.textContent = text; el.className = className; el.onclick = fn; return el;
  }
  async function open() {
    try {
      return await editor.lazy("templates").then(function (picker) { return picker.open(); });
    } catch (error) { editor.setSave("템플릿을 불러오지 못했어요. 다시 눌러 주세요.", true); }
  }
  editor.openTemplatePicker = open;
  var blocks = document.getElementById("blocks"), empty = button("템플릿으로 시작", open, "template-empty-start");
  empty.hidden = !/[?&]create\b/.test(location.search);
  blocks.before(empty);
  editor.on("ready", function () {
    if (new URLSearchParams(location.search).has("templates")) open();
    document.getElementById("new-page").addEventListener("click", function (event) { event.stopImmediatePropagation(); open(); }, true);
    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault(); event.stopImmediatePropagation(); open();
      }
      var slash = document.getElementById("slash"), choice = slash.querySelector(".template-slash.sel");
      if (!slash.hidden && choice && event.key === "Enter") { event.preventDefault(); event.stopImmediatePropagation(); choice.click(); }
    }, true);
    // The button shows only while a note is empty. A keystroke can only make the page empty when the block it edited
    // became empty, so while the button is hidden the per-keystroke paths (input, characterData) look at that one block
    // instead of scanning all of them; a structural edit (childList) always re-checks, and hidden is written only when
    // the answer changes.
    var hiddenNow = null;
    function updateEmpty() {
      var hide = editor.state.kind !== "note" || editor.state.blocks.some(function (b) { return b.type !== "paragraph" || b.text.trim(); });
      if (hide !== hiddenNow) { hiddenNow = hide; empty.hidden = hide; }
    }
    function mayEmpty(target) {
      if (!hiddenNow) return true;
      var node = target && target.nodeType === 3 ? target.parentNode : target;
      var text = node && node.closest ? node.closest(".text") || node : node;
      return !text || !String(text.textContent || "").trim();
    }
    new MutationObserver(function (records) {
      if (records.some(function (r) { return r.type === "childList" || mayEmpty(r.target); })) updateEmpty();
    }).observe(blocks, { childList: true, subtree: true, characterData: true });
    blocks.addEventListener("input", function (event) { if (mayEmpty(event.target)) updateEmpty(); }); updateEmpty();
    var slash = document.getElementById("slash");
    new MutationObserver(function () {
      if (slash.hidden || slash.querySelector(".template-slash")) return;
      var item = button("새 페이지 · 템플릿으로 시작", function () { slash.hidden = true; open(); }, "template-slash");
      item.addEventListener("mousedown", function (event) { event.preventDefault(); });
      slash.append(item);
    }).observe(slash, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  });
})();
