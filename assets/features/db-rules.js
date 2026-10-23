(function () {
  var editor = window.AcardEditor;
  if (!editor) return;
  var root = document.getElementById("doc");
  function mount() {
    root.querySelectorAll(".dbtools:not([data-db-rules])").forEach(function (bar) {
      bar.dataset.dbRules = "1";
      var host = bar.closest("[data-dbref]"), slug = host ? host.dataset.dbref : editor.slug;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dbtool";
      button.textContent = "규칙";
      button.onclick = function () {
        button.disabled = true;
        editor.lazy("db-rules").then(function (api) { return api.open(slug, button); })
          .catch(function (error) { button.textContent = error.message; })
          .finally(function () { button.disabled = false; });
      };
      bar.appendChild(button);
    });
  }
  editor.on("ready", function () { mount(); new MutationObserver(mount).observe(root, { childList: true, subtree: true }); });
})();
