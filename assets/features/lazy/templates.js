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
      if (!pendingPage) pendingPage = await editor.api("/pages", { method: "POST", body: JSON.stringify({ title: template ? template.name : "제목 없음" }) });
      if (template) {
        if (template.personal) await editor.api("/page/" + encodeURIComponent(pendingPage.slug) + "/from-template", { method: "POST", body: JSON.stringify({ templateId: template.id }) });
        else await editor.api("/page/" + encodeURIComponent(pendingPage.slug), { method: "PUT", body: JSON.stringify({ title: template.name, blocks: template.blocks }) });
      }
      location.href = "/edit/" + encodeURIComponent(pendingPage.slug) + "/" + (template ? "" : "?new");
    } catch (error) {
      creating = false;
      dialog.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      fail(error);
    }
  }
  async function open() {
    if (dialog && dialog.open) return;
    if (!dialog) { dialog = node("dialog", "", "template-picker"); document.body.appendChild(dialog); }
    dialog.replaceChildren();
    var header = node("header"), heading = node("h2", "템플릿으로 시작"); heading.id = "template-heading";
    dialog.setAttribute("aria-labelledby", heading.id);
    var close = button("닫기", function () { dialog.close(); }, "template-close");
    header.append(heading, close, node("p", "목적에 맞는 틀을 골라 내 페이지로 바꿔 보세요."));
    var layout = node("div", "", "template-layout"), catalog = node("div", "", "template-catalog"), aside = node("section", "", "template-preview");
    aside.setAttribute("aria-label", "템플릿 미리보기");
    var status = node("p", "불러오는 중...", "template-status"); status.setAttribute("role", "status");
    layout.append(catalog, aside); dialog.append(header, status, layout);
    dialog.append(button("빈 페이지로 시작", function () { create(null); }, "template-blank"));
    dialog.showModal();
    try {
      var data = await editor.api("/templates");
      status.textContent = "";
      function choose(template, card) {
        selected = template;
        catalog.querySelectorAll(".template-card").forEach(function (b) { b.setAttribute("aria-pressed", String(b === card)); });
        aside.replaceChildren();
        aside.append(node("span", "미리보기", "template-eyebrow"), node("h3", template.name));
        var body = node("div", "", "template-preview-body");
        template.blocks.forEach(function (block) {
          if (block.type === "heading1") return;
          var text = (block.type === "to_do" ? (block.checked ? "[x] " : "[ ] ") : block.type === "bulleted" ? "• " : "") + block.text;
          body.append(node(/^heading/.test(block.type) ? "h4" : "p", text));
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
          card.append(icon(template.icon), node("strong", template.name), node("span", template.description));
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
