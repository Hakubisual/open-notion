(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var dialog, selected, creating = false, pendingPage = null;
  var icons = {
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    check: "m8 6 2 2 4-4M8 14l2 2 4-4M17 7h4M17 15h4M3 3v18",
    sun: "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
    book: "M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1v16",
    flag: "M4 22V3c6-4 10 4 16 0v11c-6 4-10-4-16 0",
    branch: "M6 3v12a6 6 0 0 0 12 0V9M3 3h6M15 6l3 3 3-3M3 15h6",
    map: "m3 5 6-3 6 3 6-3v17l-6 3-6-3-6 3V5M9 2v17M15 5v17",
    rewind: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2",
    target: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    chart: "M3 3v18h18M7 16v-4M12 16V8M17 16v-7",
    file: "M14 2H4v20h16V8l-6-6v6h6M8 13h8M8 17h6"
  };
  function node(tag, text, className) {
    var el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el;
  }
  function button(text, fn, className) {
    var el = node("button", text, className); el.type = "button"; el.onclick = fn; return el;
  }
  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS(svg.namespaceURI, "path");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    path.setAttribute("d", icons[name] || icons.file); svg.appendChild(path); return svg;
  }
  // Section headings make the one-line outline on each card.
  function outline(template) {
    return template.blocks.filter(function (b) { return b.type === "heading2"; }).map(function (b) { return b.text; }).slice(0, 4).join(" · ");
  }
  // The preview draws components with the same renderer as the page once the components chunk is loaded.
  function previewBlock(block) {
    var ui = window.AcardComponents;
    if (block.type === "component" && ui) {
      var box = node("div", "", "template-preview-ui"); box.innerHTML = ui.renderComponentBlock(block); return box;
    }
    if (block.type === "component") return node("p", "▦ " + ((block.meta && block.meta.ui) || ""), "template-preview-chip");
    if (block.type === "to_do") return node("p", block.text, "template-preview-todo" + (block.checked ? " done" : ""));
    if (block.type === "bulleted") return node("p", block.text, "template-preview-bullet");
    return node(/^heading/.test(block.type) ? "h4" : "p", block.text);
  }
  function fail(error) {
    dialog.querySelector(".template-status").textContent = "만들지 못했어요: " + error.message;
  }
  async function create(template) {
    if (creating) return;
    creating = true;
    dialog.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    try {
      await editor.save();
      // Keep the created slug on a failed PUT so retry never creates a duplicate page.
      var filled = template && !template.personal ? fillTemplate(template) : null;
      if (!pendingPage) pendingPage = await editor.api("/pages", { method: "POST", body: JSON.stringify({ title: template ? (filled ? filled.title : template.name) : "제목 없음" }) });
      if (template) {
        if (template.personal) await editor.api("/page/" + encodeURIComponent(pendingPage.slug) + "/from-template", { method: "POST", body: JSON.stringify({ templateId: template.id }) });
        else await editor.api("/page/" + encodeURIComponent(pendingPage.slug), { method: "PUT", body: JSON.stringify({ title: filled.title, blocks: filled.blocks, base_updated: pendingPage.updated }) });
        if (!template.personal && template.settings) await editor.api("/page/" + encodeURIComponent(pendingPage.slug) + "/settings", { method: "PUT", body: JSON.stringify(template.settings) });
      }
      location.href = "/edit/" + encodeURIComponent(pendingPage.slug) + "/" + (template ? "" : "?new");
    } catch (error) {
      creating = false;
      dialog.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      fail(error);
    }
  }
  function fill(text, title) {
    var now = new Date(Date.now() + 9 * 3600000).toISOString(), vars = { date: now.slice(0, 10), today: now.slice(0, 10), time: now.slice(11, 16), title: title };
    return String(text).replace(/\{\{(date|today|time|title)\}\}/g, function (all, key) { return vars[key]; });
  }
  function fillTemplate(template) {
    var title = fill(template.name, template.name);
    return { title: title, blocks: template.blocks.map(function (block) {
      var copy = JSON.parse(JSON.stringify(block)), value = block.type === "component" ? JSON.stringify(title).slice(1, -1) : title;
      copy.text = fill(block.text, value);
      if (copy.meta && Array.isArray(copy.meta.richText)) copy.meta.richText.forEach(function (run) { run.text = fill(run.text, title); });
      return copy;
    }) };
  }
  async function open() {
    if (dialog && dialog.open) return;
    if (!dialog) { dialog = node("dialog", "", "template-picker"); document.body.appendChild(dialog); }
    dialog.replaceChildren();
    var header = node("header"), heading = node("h2", "템플릿으로 시작"); heading.id = "template-heading";
    dialog.setAttribute("aria-labelledby", heading.id);
    var close = button("닫기", function () { dialog.close(); }, "template-close");
    header.append(heading, close, node("p", "목적에 맞는 틀을 골라 내 페이지로 바꿔 보세요."), node("p", "{{date}}, {{title}} 같은 변수를 쓸 수 있어요", "template-hint"));
    var layout = node("div", "", "template-layout"), catalog = node("div", "", "template-catalog"), aside = node("section", "", "template-preview");
    aside.setAttribute("aria-label", "템플릿 미리보기");
    var status = node("p", "불러오는 중...", "template-status"); status.setAttribute("role", "status");
    layout.append(catalog, aside); dialog.append(header, status, layout);
    dialog.append(button("빈 페이지로 시작", function () { create(null); }, "template-blank"));
    dialog.showModal();
    try {
      var data = (await Promise.all([editor.api("/templates"), editor.lazy("components").catch(function () {})]))[0];
      status.textContent = "";
      function choose(template, card) {
        selected = template;
        catalog.querySelectorAll(".template-card").forEach(function (b) { b.setAttribute("aria-pressed", String(b === card)); });
        aside.replaceChildren();
        aside.append(node("span", "미리보기", "template-eyebrow"), node("h3", template.name));
        var body = node("div", "", "template-preview-body");
        template.blocks.forEach(function (block) {
          if (block.type !== "heading1") body.append(previewBlock(block));
        });
        aside.append(body, button("이 템플릿 사용", function () { create(selected); }, "template-use"));
      }
      function group(title, templates, personal) {
        catalog.append(node("h3", title));
        var grid = node("div", "", "template-grid"); catalog.append(grid);
        if (!templates.length) { grid.append(node("p", "페이지 설정에서 자주 쓰는 페이지를 저장해 보세요.", "template-empty")); return; }
        templates.forEach(function (template) {
          template.personal = personal;
          var card = button("", function () { choose(template, card); }, "template-card");
          var ico = node("span", "", "template-ico"), sections = outline(template);
          ico.append(icon(template.icon));
          card.append(ico, node("strong", template.name), node("span", template.description, "template-desc"));
          if (sections) card.append(node("span", sections, "template-outline"));
          grid.append(card);
          if (!selected) choose(template, card);
        });
      }
      selected = null;
      group("추천 템플릿", data.templates, false); group("내 템플릿", data.personal, true);
    } catch (error) { status.textContent = "템플릿을 불러오지 못했어요. 닫고 다시 열어 주세요."; }
  }
  editor.provide("templates", { open: open });
})();
