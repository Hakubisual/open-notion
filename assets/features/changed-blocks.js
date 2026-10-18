(function () {
  var editor = window.AcardEditor;
  if (!editor) return;
  // Sorted before save-queue: persistence wraps this transport and retains
  // full drafts. Load and compute the delta only when that queue sends.
  var previous = editor.transport;
  editor.transport = function (slug, payload) {
    return editor.lazy("changed-blocks").then(function (feature) {
      return feature.send(slug, payload, previous);
    });
  };
})();
