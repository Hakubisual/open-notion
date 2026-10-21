(function () {
  var editor = window.AcardEditor;
  if (!editor) return;
  editor.on("ready", function () {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "menuitem";
    button.textContent = "공유 · 게시";
    button.onclick = function () {
      document.getElementById("more-menu").hidden = true;
      editor.lazy("share-dialog").then(function (share) { share.open(editor.slug); }).catch(function () { button.textContent = "불러오지 못했어요. 새로고침해 주세요."; });
    };
    var menu = document.getElementById("more-menu"), line = menu.querySelector(".menu-width + hr");
    if (line) line.after(button); else menu.prepend(button);
  });
})();
