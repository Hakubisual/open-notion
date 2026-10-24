// Tab feature palette (acard-human-edit, design/human-edit/ref-tab-palette.png): Tab on an empty line (or 기능 찾기 in the
// phone toolbar) opens a search over every block type, registered component and palette command (command-search.js, local
// only). Enter on a result puts it in.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var S = null, box = null, input = null, list = null, results = [], sel = 0, state = null, commands = [];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function rowOf(id) { return document.querySelector('#blocks .blk[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }

  function catalog() {
    var blocks = editor.blockTypes ? editor.blockTypes() : [];
    return blocks.map(function (b) { return Object.assign({ kind: /^component:/.test(b.type) ? "component" : "block", group: /^component:/.test(b.type) ? "컴포넌트" : "블록" }, b); })
      .concat(commands.map(function (c) { return Object.assign({ kind: "command", type: "command:" + c.id, group: c.group || "명령" }, c); }));
  }

  function close(restore) {
    if (!box) return;
    box.remove(); box = null; input = null; list = null;
    document.removeEventListener("pointerdown", outside, true);
    var s = state; state = null;
    if (restore !== false && s) { var r = rowOf(s.blockId), t = r && r.querySelector(".text"); if (t) t.focus(); }
  }
  function outside(ev) { if (box && !box.contains(ev.target)) close(false); }

  function insert(item) {
    var id = state.blockId;
    S.remember(item.type);
    if (item.kind === "command") { close(false); return item.run({ blockId: id }); }
    close(false);
    var block = editor.state.blocks.find(function (b) { return b.id === id; });
    if (!block) return;
    if (editor.commands && editor.commands.setType) editor.commands.setType(id, item.type);
  }

  function highlight(text, query) {
    var frag = document.createDocumentFragment(), q = String(query || "").toLowerCase().replace(/\s+/g, "");
    var at = q && !/^[\u3131-\u314e]+$/.test(q) ? String(text).toLowerCase().indexOf(q) : -1;
    if (at < 0) { frag.appendChild(document.createTextNode(text)); return frag; }
    frag.appendChild(document.createTextNode(text.slice(0, at)));
    frag.appendChild(el("mark", "tp-hit", text.slice(at, at + q.length)));
    frag.appendChild(document.createTextNode(text.slice(at + q.length)));
    return frag;
  }

  function paint() {
    var q = input.value;
    var found = S.search(catalog(), q, 8), order = [];
    found.forEach(function (x) { if (order.indexOf(x.group) < 0) order.push(x.group); });
    results = [];
    order.forEach(function (g) { found.forEach(function (x) { if (x.group === g) results.push(x); }); });
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.replaceChildren();
    var last = null;
    results.forEach(function (item, i) {
      if (item.group !== last) { list.appendChild(el("h4", "tp-group", item.group)); last = item.group; }
      var b = el("button", "tp-item"); b.type = "button"; b.id = "tp-o" + i; b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(i === sel));
      b.appendChild(el("span", "tp-ico", item.ico || "▦"));
      var label = el("span", "tp-label"); label.appendChild(highlight(item.label, q)); b.appendChild(label);
      if (item.hint) b.appendChild(el("span", "tp-hint", "— " + item.hint));
      b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      b.addEventListener("click", function () { insert(item); });
      list.appendChild(b);
    });
    if (!results.length && q.trim()) list.appendChild(el("p", "tp-empty", "맞는 기능이 없어요."));
    input.setAttribute("aria-activedescendant", "tp-o" + sel);
  }

  function keys(ev) {
    if (ev.isComposing || ev.keyCode === 229) return;
    var count = Math.max(1, results.length);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); sel = (sel + (ev.key === "ArrowDown" ? 1 : count - 1)) % count; paint(); var o = document.getElementById("tp-o" + sel); if (o) o.scrollIntoView({ block: "nearest" }); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (sel < results.length) insert(results[sel]); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === "Tab") { ev.preventDefault(); sel = (sel + (ev.shiftKey ? count - 1 : 1)) % count; paint(); }
  }

  function open(blockId, anchor) {
    close(false);
    state = { blockId: blockId };
    box = el("div", "tp"); box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "기능 찾기");
    var bar = el("div", "tp-bar");
    bar.appendChild(el("span", "tp-search", "⌕"));
    input = el("input", "tp-input"); input.type = "text"; input.placeholder = "도표, 차트, 타임라인…";
    input.setAttribute("role", "combobox"); input.setAttribute("aria-expanded", "true"); input.setAttribute("aria-controls", "tp-list"); input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-label", "기능 찾기");
    bar.appendChild(input);
    bar.appendChild(el("kbd", "tp-kbd", "Tab"));
    list = el("div", "tp-list"); list.id = "tp-list"; list.setAttribute("role", "listbox");
    box.append(bar, list);
    input.addEventListener("input", function () { sel = 0; paint(); });
    input.addEventListener("keydown", keys);
    document.body.appendChild(box);
    var r = (anchor || rowOf(blockId)).getBoundingClientRect();
    var w = Math.min(440, innerWidth - 16);
    box.style.width = w + "px";
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
    box.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 420)) + "px";
    paint();
    input.focus();
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); }, 0);
    if (editor.loadComponents) editor.loadComponents().then(function () { if (box) paint(); });
  }

  var api = {
    open: open, close: close,
    register: function (cmd) {
      if (!cmd || typeof cmd.id !== "string" || typeof cmd.label !== "string" || typeof cmd.run !== "function") throw new TypeError("palette.register needs {id, label, run}");
      commands = commands.filter(function (c) { return c.id !== cmd.id; }).concat([cmd]);
      return function () { commands = commands.filter(function (c) { return c !== cmd; }); };
    }
  };
  var openNow = open;
  api.open = function (blockId, anchor) {
    return editor.lazy("command-search").then(function (s) { S = s; openNow(blockId, anchor); });
  };
  editor.palette = Object.assign(editor.palette || {}, api);
  (editor.palette.queue || []).forEach(function (c) { try { api.register(c); } catch (_) {} });
  editor.provide("tab-palette", api);
})();
