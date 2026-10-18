(function () {
  "use strict";
  var editor = window.AcardEditor;
  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }
  function input(type, value) {
    var el = node("input");
    el.type = type;
    if (type === "checkbox") el.checked = !!value;
    else el.value = value || "";
    return el;
  }
  editor.provide("form-row", { open: async function (slug, anchor) {
    var existing = document.querySelector(".fr-builder");
    if (existing) { existing.focus(); return; }
    var path = "/db/" + encodeURIComponent(slug) + "/form";
    var data = await editor.api(path);
    var config = data.form && data.form.config;
    var dialog = node("dialog", "fr-builder");
    dialog.setAttribute("aria-labelledby", "fr-builder-title");
    var header = node("header", "fr-header");
    var heading = node("h2", "", "폼 만들기");
    heading.id = "fr-builder-title";
    var close = node("button", "fr-close", "닫기");
    close.type = "button";
    close.onclick = function () { dialog.close(); };
    header.append(heading, node("p", "", "보여 줄 속성과 질문을 골라 주세요."), close);
    var form = node("form", "fr-content");
    var titleLabel = node("label", "fr-field", "폼 제목");
    var title = input("text", config ? config.title : "새 작업");
    title.required = true;
    title.maxLength = 120;
    titleLabel.appendChild(title);
    form.appendChild(titleLabel);
    form.appendChild(node("p", "fr-hint", "포함한 속성만 입력받아요. 필수 항목은 빠짐없이 작성해야 해요."));
    var rows = data.properties.map(function (prop) {
      var field = config && config.fields.find(function (entry) { return entry.property === prop.id; });
      var row = node("div", "fr-property");
      var include = input("checkbox", config ? !!field : prop.type === "title");
      include.setAttribute("aria-label", prop.name + " 포함");
      var includeLabel = node("label", "fr-include");
      includeLabel.append(include, node("span", "", prop.name));
      var label = input("text", field ? field.label : prop.name);
      label.maxLength = 120;
      label.setAttribute("aria-label", prop.name + " 질문");
      var required = input("checkbox", field ? field.required : prop.type === "title");
      var requiredLabel = node("label", "fr-required-label");
      required.setAttribute("aria-label", prop.name + " 필수");
      requiredLabel.append(required, document.createTextNode("필수"));
      function toggle() {
        label.disabled = required.disabled = !include.checked;
        label.required = include.checked;
        row.classList.toggle("fr-excluded", !include.checked);
      }
      include.onchange = toggle;
      toggle();
      row.append(includeLabel, label, requiredLabel);
      form.appendChild(row);
      return { property: prop.id, include: include, label: label, required: required };
    });
    var status = node("p", "fr-status");
    status.setAttribute("role", "status");
    var footer = node("div", "fr-actions");
    var save = node("button", "fr-primary", data.form ? "저장하기" : "폼 만들기");
    save.type = "submit";
    var open = node("a", "fr-secondary", "폼 열기");
    open.hidden = !data.form;
    if (data.form) open.href = "/form/" + encodeURIComponent(data.form.id);
    footer.append(save, open);
    form.append(status, footer, node("p", "fr-hint", "Acard에 로그인한 나만 열 수 있어요."));
    form.onsubmit = async function (event) {
      event.preventDefault();
      var fields = rows.filter(function (row) { return row.include.checked; }).map(function (row) { return { property: row.property, label: row.label.value, required: row.required.checked }; });
      if (!fields.length) { status.textContent = "속성을 하나 이상 골라 주세요."; return; }
      save.disabled = true;
      status.textContent = "저장 중이에요.";
      try {
        var result = await editor.api(path, { method: "PUT", body: JSON.stringify({ config: { title: title.value, fields: fields } }) });
        open.href = "/form/" + encodeURIComponent(result.form.id);
        open.hidden = false;
        save.textContent = "저장하기";
        status.textContent = "폼을 저장했어요.";
      } catch (error) { status.textContent = error.message; }
      finally { save.disabled = false; }
    };
    dialog.append(header, form);
    dialog.addEventListener("close", function () { dialog.remove(); if (anchor.isConnected) anchor.focus(); });
    document.body.appendChild(dialog);
    dialog.showModal();
  } });
})();
