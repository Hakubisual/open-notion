(function () {
  "use strict";
  window.mountEditorFormat = function (context) {
    var model = window.EditorModel, range = null, host = null;
    var toolbar = document.createElement("div"); toolbar.className = "format-toolbar"; toolbar.hidden = true; toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "텍스트 서식");
    document.body.appendChild(toolbar);
    function selection() {
      var sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) { toolbar.hidden = true; return; }
      var node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      var text = node.closest(".text");
      if (!text || !text.contains(sel.focusNode)) return;
      range = sel.getRangeAt(0).cloneRange(); host = text;
      var rect = range.getBoundingClientRect();
      toolbar.style.left = Math.max(8, Math.min(rect.left, innerWidth - Math.min(540, innerWidth - 16))) + "px";
      toolbar.style.top = Math.max(8, rect.top - 92) + "px";
      toolbar.hidden = false;
      var bounds = toolbar.getBoundingClientRect();
      if (bounds.right > innerWidth - 8) toolbar.style.left = Math.max(8, parseFloat(toolbar.style.left) - (bounds.right - innerWidth + 8)) + "px";
    }
    function apply(tag, attrs) {
      if (!range || !host) return;
      var span = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (key) { span.setAttribute(key, attrs[key]); });
      span.appendChild(range.extractContents()); range.insertNode(span);
      range.selectNodeContents(span);
      var sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      host.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function button(label, fn) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-label", label);
      b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      b.addEventListener("click", fn); toolbar.appendChild(b);
    }
    [["굵게", "strong"], ["기울임", "em"], ["밑줄", "u"], ["취소선", "s"], ["코드", "code"]].forEach(function (pair) { button(pair[0], function () { apply(pair[1]); }); });
    button("링크", function () {
      var dialog = document.createElement("dialog"); dialog.className = "editor-panel";
      var label = document.createElement("label"); label.textContent = "링크 주소 (https:// 또는 /)";
      var input = document.createElement("input"); input.type = "url"; label.appendChild(input); dialog.appendChild(label);
      var error = document.createElement("p"); error.setAttribute("role", "alert"); dialog.appendChild(error);
      var save = document.createElement("button"); save.type = "button"; save.className = "mini"; save.textContent = "링크 적용";
      save.addEventListener("click", function () { var value = model.safeHref(input.value); if (!value) { error.textContent = "https:// 또는 /로 시작하는 주소를 넣어 주세요."; return; } apply("a", { href: value }); dialog.close(); });
      var cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "mini"; cancel.textContent = "취소"; cancel.addEventListener("click", function () { dialog.close(); });
      dialog.appendChild(save); dialog.appendChild(cancel); dialog.addEventListener("close", function () { dialog.remove(); }); document.body.appendChild(dialog); dialog.showModal(); input.focus();
    });
    button("서식 지우기", function () { if (!range) return; var text = document.createTextNode(range.toString()); range.deleteContents(); range.insertNode(text); host.dispatchEvent(new Event("input", { bubbles: true })); toolbar.hidden = true; });
    [["글자색", "data-color"], ["배경색", "data-background"]].forEach(function (pair) {
      var select = document.createElement("select"); select.setAttribute("aria-label", pair[0]);
      var initial = document.createElement("option"); initial.value = ""; initial.textContent = pair[0]; select.appendChild(initial);
      var labels = { default: "기본", gray: "회색", brown: "갈색", orange: "주황", yellow: "노랑", green: "초록", blue: "파랑", purple: "보라", pink: "분홍", red: "빨강" };
      model.colors.forEach(function (color) { var option = document.createElement("option"); option.value = color; option.textContent = labels[color]; select.appendChild(option); });
      select.addEventListener("change", function () { var attrs = {}; attrs[pair[1]] = select.value; apply("span", attrs); select.value = ""; }); toolbar.appendChild(select);
    });
    document.addEventListener("mouseup", selection);
    document.addEventListener("keyup", selection);
    document.addEventListener("pointerdown", function (ev) { if (!toolbar.contains(ev.target) && !ev.target.closest(".text")) toolbar.hidden = true; });

    var mention = document.createElement("div"); mention.className = "slash"; mention.hidden = true; document.body.appendChild(mention);
    context.mention = function (text, block) {
      var sel = getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return;
      var caret = sel.getRangeAt(0), before = caret.cloneRange(); before.selectNodeContents(text); before.setEnd(caret.endContainer, caret.endOffset);
      var match = /(@|\[\[)([^@\[\]\n]*)$/.exec(before.toString());
      if (!match) { mention.hidden = true; return; }
      var query = match[2].toLowerCase();
      var entries = context.state.pages.filter(function (page) { return page.title.toLowerCase().includes(query) || page.slug.toLowerCase().includes(query); }).slice(0, 12).map(function (page) { return { label: page.title, page: page.slug }; });
      if (match[1] === "@") {
        var today = new Date();
        var date = /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
        if (!query || query === "오늘" || /^\d{4}-\d{2}-\d{2}$/.test(query)) entries.unshift({ label: date, date: date });
        if (window.AcardAgent && (!query || "acard 에이전트 agent".includes(query))) entries.unshift({ label: "Acard 에이전트", agent: true });
      }
      mention.replaceChildren(); var rect = caret.getBoundingClientRect();
      mention.style.left = Math.max(8, Math.min(rect.left, innerWidth - 280)) + "px";
      mention.style.top = Math.min(rect.bottom + 6, innerHeight - 250) + "px";
      entries.forEach(function (entry) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = entry.label;
        b.addEventListener("mousedown", function (ev) {
          ev.preventDefault();
          var startOffset = before.toString().length - match[0].length;
          var walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), node, offset = 0;
          var replace = caret.cloneRange();
          while ((node = walker.nextNode())) { if (offset + node.length >= startOffset) { replace.setStart(node, startOffset - offset); break; } offset += node.length; }
          replace.deleteContents();
          if (entry.agent) {
            var mark = document.createTextNode(window.AcardAgent.MARK + " "); replace.insertNode(mark); replace.setStartAfter(mark); replace.collapse(true); sel.removeAllRanges(); sel.addRange(replace);
            block.meta = Object.assign({}, block.meta, { richText: model.readRich(text) }); block.text = text.textContent;
            context.scheduleSave(); mention.hidden = true; return;
          }
          var el = document.createElement(entry.page ? "a" : "time"); el.textContent = entry.label;
          if (entry.page) { el.dataset.page = entry.page; el.href = "/" + encodeURIComponent(entry.page) + "/"; } else el.dateTime = entry.date;
          replace.insertNode(el); replace.setStartAfter(el); replace.collapse(true); sel.removeAllRanges(); sel.addRange(replace);
          block.meta = Object.assign({}, block.meta, { richText: model.readRich(text) }); block.text = text.textContent;
          context.scheduleSave(); mention.hidden = true;
        }); mention.appendChild(b);
      });
      mention.hidden = !entries.length;
    };
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { mention.hidden = true; toolbar.hidden = true; } });
  };
})();
