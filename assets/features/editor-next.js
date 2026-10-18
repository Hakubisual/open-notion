(function () {
  // 새 편집기 스위치. ?editor=next 로 켜고 ?editor=classic 으로 끈다(선택은 이 브라우저에 기억).
  // 켜져 있으면 한글 조합 보호를 바로 걸고, 나머지 기능은 /lazy/editor-next.* 에서 불러온다.
  var editor = window.AcardEditor;
  if (!editor) return;
  var KEY = "acard-editor", DEFAULT_ON = true, mode = null;
  var asked = /[?&]editor=(next|classic)(?:&|$)/.exec(location.search);
  try {
    if (asked) localStorage.setItem(KEY, asked[1]);
    mode = localStorage.getItem(KEY);
  } catch (e) { mode = asked && asked[1]; }
  var on = mode ? mode === "next" : DEFAULT_ON;
  window.AcardEditorNext = { on: on };
  var menu = document.getElementById("more-menu");
  if (menu) {
    var toggle = document.createElement("button");
    toggle.type = "button"; toggle.className = "menuitem"; toggle.id = "editor-next-toggle";
    toggle.textContent = on ? "새 편집기 끄기 (예전 편집기로)" : "새 편집기 켜기";
    toggle.addEventListener("click", function () {
      try { localStorage.setItem(KEY, on ? "classic" : "next"); } catch (e) {}
      location.href = location.pathname + "?editor=" + (on ? "classic" : "next");
    });
    menu.appendChild(toggle);
  }
  if (!on) return;
  document.documentElement.dataset.editor = "next";
  // 한글·일본어 입력기가 글자를 조합하는 동안 누른 키(Enter, Backspace, 화살표 등)는 입력기 몫이다.
  // 편집기 단축키가 먼저 받으면 블록이 조합 중에 잘리거나 글자가 두 번 들어간다.
  window.addEventListener("keydown", function (ev) {
    if (ev.isComposing || ev.keyCode === 229) ev.stopImmediatePropagation();
  }, true);
  editor.on("ready", function () {
    editor.lazy("editor-next").then(function (feature) { feature.start(); }).catch(function (error) {
      console.error("editor-next failed", error);
      editor.setSave("새 편집기 기능을 불러오지 못했어요. 새로고침해 주세요.", true);
    });
  });
})();
