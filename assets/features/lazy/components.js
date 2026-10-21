// Editor side of the ds10 component registry: the same component-registry.js + components/*.js the reader uses
// (inlined at build time), a JSON data box with a live preview, and the slash entries for every registered component.
(function () {
  "use strict";
//__COMPONENT_SOURCE__
  var editor = window.AcardEditor;
  window.AcardComponents = { registerComponent: registerComponent, getComponent: getComponent, listComponents: listComponents, componentCatalog: componentCatalog, componentMarkdown: componentMarkdown, componentData: componentData, renderComponentBlock: renderComponentBlock, fallbackCardHtml: fallbackCardHtml, componentCss: componentCss };
  var style = document.createElement("style");
  style.textContent = componentCss();
  document.head.appendChild(style);

  function slashItems() {
    return listComponents().map(function (c) {
      return { type: "component:" + c.id, label: c.slash.label || c.name, hint: c.slash.hint || "", ico: c.slash.ico || "▦", aliases: c.slash.aliases || "", group: "컴포넌트" };
    });
  }

  // The block keeps the person's JSON exactly as typed; only the preview falls back to defaults.
  function mount(host, block, save) {
    var doc = host.ownerDocument;
    var comp = getComponent(String((block.meta && block.meta.ui) || ""));
    if (!block.text && comp) { block.text = JSON.stringify(comp.sample, null, 2); save(); }
    host.className = "ui-editor";
    host.replaceChildren();
    var preview = doc.createElement("div");
    preview.className = "ui-editor-preview";
    var tools = doc.createElement("details");
    tools.className = "ui-editor-data";
    var summary = doc.createElement("summary");
    summary.textContent = (comp ? comp.name : "컴포넌트") + " 데이터 고치기";
    var area = doc.createElement("textarea");
    area.className = "ui-editor-source";
    area.spellcheck = false;
    area.setAttribute("aria-label", "컴포넌트 데이터(JSON)");
    area.value = block.text;
    area.rows = Math.min(14, Math.max(4, block.text.split("\n").length + 1));
    var hint = doc.createElement("p");
    hint.className = "ui-editor-hint";
    var timer = 0;
    function draw() {
      preview.innerHTML = renderComponentBlock(block);
      var bad = preview.querySelector("[data-ui-invalid]");
      hint.textContent = !comp ? "모르는 컴포넌트예요. 이름(ui)을 확인해 주세요." : bad ? "JSON 형식이 맞지 않아 기본값으로 보여 주고 있어요." : "값을 고치면 바로 다시 그려져요.";
    }
    area.addEventListener("input", function () { block.text = area.value; save(); clearTimeout(timer); timer = setTimeout(draw, 200); });
    area.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
    tools.append(summary, area, hint);
    host.append(preview, tools);
    draw();
  }

  if (editor) editor.provide("components", { mount: mount, slashItems: slashItems, getComponent: getComponent });
})();
