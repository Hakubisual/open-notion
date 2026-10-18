(function () {
  var editor = window.AcardEditor;
  if (!editor) return;
  function mount() {
    document.querySelectorAll(".dbtools:not([data-form-row])").forEach(function (bar) {
      bar.dataset.formRow = "1";
      var host = bar.closest("[data-dbref]"), slug = host ? host.dataset.dbref : editor.slug;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dbtool";
      button.textContent = "폼";
      button.onclick = function () {
        button.disabled = true;
        editor.lazy("form-row").then(function (api) { return api.open(slug, button); })
          .catch(function (error) { button.textContent = error.message; })
          .finally(function () { button.disabled = false; });
      };
      bar.appendChild(button);
    });
  }
  editor.on("ready", function () { mount(); new MutationObserver(mount).observe(document.body, { childList: true, subtree: true }); });
})();
