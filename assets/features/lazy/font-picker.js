// Opening this list loads only catalog.json and the label-only preview fonts; a font's body files load after it is picked.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var catalog;
  var SPECIMEN = String.fromCharCode(0xAC00) + " Aa";
  function load() {
    if (!catalog) catalog = fetch("/fonts/catalog.json").then(function (r) { if (!r.ok) throw Error("catalog " + r.status); return r.json(); });
    return catalog.then(function (data) {
      if (data.previewCss && !document.querySelector('link[href="' + data.previewCss + '"]')) {
        var link = document.createElement("link"); link.rel = "stylesheet"; link.href = data.previewCss; document.head.appendChild(link);
      }
      return data;
    });
  }
  function mount(host, current, pick) {
    return load().then(function (data) {
      host.replaceChildren();
      var title = document.createElement("p"); title.className = "font-pick-title"; title.textContent = "글꼴"; host.appendChild(title);
      var buttons = [];
      data.groups.forEach(function (group) {
        var fonts = data.fonts.filter(function (f) { return f.category === group.id; });
        if (!fonts.length) return;
        var head = document.createElement("p"); head.className = "font-pick-group"; head.textContent = group.label; host.appendChild(head);
        var row = document.createElement("div"); row.className = "font-pick-row"; host.appendChild(row);
        fonts.forEach(function (font) {
          var b = document.createElement("button"); b.type = "button"; b.className = "font-pick-item"; b.dataset.font = font.id;
          var sample = document.createElement("span"); sample.className = "font-pick-sample"; sample.textContent = SPECIMEN; sample.style.cssText = font.previewCss; sample.setAttribute("aria-hidden", "true"); sample.setAttribute("translate", "no");
          var name = document.createElement("span"); name.className = "font-pick-name"; name.textContent = font.label; name.style.cssText = font.previewCss;
          b.appendChild(sample); b.appendChild(name);
          if (font.headingOnly) { var tag = document.createElement("span"); tag.className = "font-pick-tag"; tag.textContent = "제목만"; b.appendChild(tag); }
          b.title = font.headingOnly ? font.label + ": 제목과 큰 머리글에만 쓰여요 (본문은 기본 글꼴)" : font.label;
          b.setAttribute("aria-pressed", font.id === current ? "true" : "false");
          b.addEventListener("click", function () {
            if (b.getAttribute("aria-pressed") === "true") return;
            Promise.resolve(pick(font.id)).then(function () {
              buttons.forEach(function (other) { other.setAttribute("aria-pressed", other === b ? "true" : "false"); });
            });
          });
          buttons.push(b); row.appendChild(b);
        });
      });
    });
  }
  editor.provide("font-picker", { mount: mount, catalog: load });
})();
