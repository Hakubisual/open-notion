// Page settings panel (acard-human-edit, design/human-edit/ref-settings.png): 작은 글씨 switch and the page's AI
// default mark. Fonts are the acard-font-library font-picker chunk, mounted just above this one in the same panel.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var AI = [["edit", "AI가 바꿔도 됨 (기본)", "AI가 내용을 고칠 수 있어요."], ["lock", "고정", "AI가 이 페이지를 고치지 않아요. 사람은 그대로 고칠 수 있어요."], ["ref", "참고", "AI가 참고 자료로만 읽어요."], ["smart", "자동", "제목·출처·인용·표는 고정, 메모·자료 상자는 참고, 나머지는 AI가 고칠 수 있어요."]];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function section(title) { var s = el("section", "ps-sec"); s.appendChild(el("h3", "ps-h", title)); return s; }
  function toggle(label, hint, on, change) {
    var row = el("label", "ps-row");
    var text = el("span", "ps-text"); text.appendChild(el("strong", null, label)); text.appendChild(el("small", null, hint));
    var input = el("input", "ps-switch"); input.type = "checkbox"; input.setAttribute("role", "switch"); input.checked = !!on;
    input.addEventListener("change", function () { change(input.checked); });
    row.append(text, input);
    return row;
  }

  function mount(host, settings, patch) {
    var root = el("div", "ps");
    var look = section("보기");
    look.appendChild(toggle("작은 글씨", "글씨 크기를 한 단계 작게 보여 줘요.", settings.small, function (v) { patch({ small: v }); }));
    var aiSec = section("AI 기본 표시"), group = el("div", "ps-ai"); group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "AI 기본 표시");
    AI.forEach(function (a) {
      var row = el("label", "ps-radio");
      var input = el("input"); input.type = "radio"; input.name = "ps-ai"; input.value = a[0]; input.checked = (settings.ai || "edit") === a[0];
      input.addEventListener("change", function () { patch({ ai: a[0] }).then(function () { var doc = document.getElementById("doc"); doc.dataset.aiDefault = a[0]; editor.lazy("ai-marks-ui").then(function (m) { m.paintPill(); }); }); });
      var text = el("span", "ps-text"); text.appendChild(el("strong", null, a[1])); text.appendChild(el("small", null, a[2]));
      row.append(input, text);
      group.appendChild(row);
    });
    aiSec.appendChild(group);
    root.append(look, aiSec);
    host.appendChild(root);
  }

  editor.provide("page-settings", { mount: mount });
})();
