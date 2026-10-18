(() => {
  const editor = window.AcardEditor;
  if (!editor) return;
  editor.on("ready", () => {
    let button = document.getElementById("ask-notes-btn");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "mini";
      button.textContent = "노트에 묻기";
      button.setAttribute("aria-haspopup", "dialog");
      document.querySelector(".docbar").after(button);
    }
    button.disabled = false;
    button.onclick = async () => {
      button.disabled = true;
      try { (await editor.lazy("ask-notes")).open(button); }
      catch (_) { button.textContent = "불러오기 실패 · 새로고침해 주세요"; }
      finally { button.disabled = false; }
    };
  });
})();
