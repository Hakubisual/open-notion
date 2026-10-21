// Block color menu (notion-parity C6), lazy so the editor first screen stays inside its budget.
// open(anchor, block): ten text colors and ten backgrounds; arrows move, Enter picks, Esc closes without saving.
// The CSS chunk also carries the reader's color rules (BLOCK_COLOR_CSS in block-html.js) so colored blocks look the same while editing.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var NAMES = [["default", "기본"], ["gray", "회색"], ["brown", "갈색"], ["orange", "주황"], ["yellow", "노랑"], ["green", "초록"], ["blue", "파랑"], ["purple", "보라"], ["pink", "분홍"], ["red", "빨강"]];
  var box = null, back = null;
  function close() {
    if (!box) return;
    box.remove(); box = null;
    document.removeEventListener("pointerdown", outside, true);
    if (back && back.focus) back.focus();
  }
  function outside(ev) { if (box && !box.contains(ev.target)) close(); }
  function pick(block, value) {
    var meta = Object.assign({}, block.meta);
    if (value === "default") delete meta.color; else meta.color = value;
    block.meta = Object.keys(meta).length ? meta : null;
    back = null; close();
    editor.render(); editor.scheduleSave();
  }
  function open(anchor, block) {
    close();
    back = document.activeElement;
    var current = (block.meta && block.meta.color) || "default";
    box = document.createElement("div");
    box.className = "bc-menu"; box.setAttribute("role", "menu"); box.setAttribute("aria-label", "블록 색");
    [["글자색", ""], ["배경색", "_background"]].forEach(function (group) {
      var h = document.createElement("h3"); h.textContent = group[0]; box.appendChild(h);
      var grid = document.createElement("div"); grid.className = "bc-grid";
      NAMES.forEach(function (n) {
        var value = n[0] === "default" ? "default" : n[0] + group[1];
        var b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "menuitemradio");
        b.className = "bc-swatch" + (value === "default" ? "" : " bc-" + value) + (group[1] ? " bg" : "");
        b.textContent = "A"; b.dataset.value = value;
        b.title = n[1] + (group[1] ? " 배경" : " 글자");
        b.setAttribute("aria-label", b.title);
        b.setAttribute("aria-checked", String(current === value && !(value === "default" && group[1])));
        b.addEventListener("click", function () { pick(block, value); });
        grid.appendChild(b);
      });
      box.appendChild(grid);
    });
    box.addEventListener("keydown", function (ev) {
      var all = Array.prototype.slice.call(box.querySelectorAll("button")), at = all.indexOf(document.activeElement);
      var step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[ev.key];
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
      else if (step) { ev.preventDefault(); all[Math.max(0, Math.min(all.length - 1, (at < 0 ? 0 : at) + step))].focus(); }
    });
    document.body.appendChild(box);
    var rect = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8)) + "px";
    box.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - box.offsetHeight - 8)) + "px";
    (box.querySelector('[aria-checked="true"]') || box.querySelector("button")).focus();
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); }, 0);
  }
  editor.provide("block-style", { open: open, close: close });
})();
