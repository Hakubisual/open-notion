(function () {
  "use strict";
  var editor = window.AcardEditor;
  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }
  function select(label, options) {
    var el = node("select");
    el.setAttribute("aria-label", label);
    options.forEach(function (item) { var option = node("option", "", item.name); option.value = item.id; el.appendChild(option); });
    return el;
  }
  function field(label, control) { var el = node("label", "dr-field", label); el.appendChild(control); return el; }
  function button(label, action, cls) { var el = node("button", cls, label); el.type = "button"; el.onclick = action; return el; }
  editor.provide("db-rules", { open: async function (slug, anchor) {
    var existing = document.querySelector(".dr-dialog");
    if (existing) { existing.focus(); return; }
    var path = "/db/" + encodeURIComponent(slug) + "/rules", data = await editor.api(path);
    var properties = data.properties, rules = data.rules;
    var dialog = node("dialog", "dr-dialog");
    dialog.setAttribute("aria-labelledby", "dr-title");
    var header = node("header", "dr-header"), title = node("h2", "", "규칙");
    title.id = "dr-title";
    header.append(title, button("닫기", function () { dialog.close(); }));
    var content = node("div", "dr-content"), list = node("div", "dr-list");
    var hint = node("p", "dr-hint", "조건에 맞으면 다른 속성을 자동으로 채워요. 한 번 저장할 때 한 번만 실행해요.");
    var status = node("p", "dr-status"); status.setAttribute("role", "status");
    function prop(id) { return properties.find(function (p) { return p.id === id; }); }
    function valueName(p, value) {
      if (!p) return "삭제된 속성";
      if (p.type === "checkbox") return value ? "체크" : "해제";
      if (p.type === "date") return value ? (typeof value === "string" ? value : value.start) : "비움";
      var option = (p.config.options || []).find(function (o) { return o.id === value; });
      return option ? option.name : value == null ? "비움" : String(value);
    }
    function summary(config) {
      var t = config.trigger, a = config.action, p = prop(t.property), target = prop(a.property);
      return (t.type === "created" ? "행이 만들어지면" : (p ? p.name : "삭제된 속성") + "가 [" + valueName(p, t.value) + "]로 바뀌면")
        + " → [" + (target ? target.name : "삭제된 속성") + "]을 " + (a.type === "today" ? "오늘로" : "[" + valueName(target, a.value) + "]로");
    }
    async function change(id, options) {
      await editor.api(path + "/" + encodeURIComponent(id), options);
      rules = (await editor.api(path)).rules;
      renderList();
    }
    function renderList() {
      list.replaceChildren();
      list.appendChild(node("h3", "", "저장한 규칙 " + rules.length + " / 20"));
      if (!rules.length) list.appendChild(node("p", "dr-muted", "아직 규칙이 없어요. 아래에서 첫 규칙을 만들어 보세요."));
      rules.forEach(function (rule) {
        var row = node("article", "dr-rule"), text = node("p", "", summary(rule.config));
        var actions = node("div", "dr-actions"), toggle = node("input");
        toggle.type = "checkbox"; toggle.checked = rule.enabled; toggle.disabled = !rule.valid;
        var label = field("사용", toggle);
        toggle.onchange = async function () {
          toggle.disabled = true;
          try { await change(rule.id, { method: "PATCH", body: JSON.stringify({ enabled: toggle.checked }) }); status.textContent = "규칙을 저장했어요."; }
          catch (error) { toggle.checked = rule.enabled; toggle.disabled = false; status.textContent = error.message; }
        };
        var remove = button("삭제", async function () {
          remove.disabled = true;
          try { await change(rule.id, { method: "DELETE" }); status.textContent = "규칙을 삭제했어요."; }
          catch (error) { remove.disabled = false; status.textContent = error.message; }
        });
        actions.append(label, remove); row.append(text, actions);
        if (!rule.valid) row.appendChild(node("p", "dr-muted", "속성이 바뀌어 실행하지 않아요. 삭제 후 다시 만들어 주세요."));
        list.appendChild(row);
      });
      save.disabled = rules.length >= 20 || !target.value;
    }
    var form = node("form", "dr-builder"), when = select("실행 조건", [{ id: "changed", name: "속성이 바뀌면" }, { id: "created", name: "행이 만들어지면" }]);
    var triggers = properties.filter(function (p) { return ["select", "status", "checkbox"].includes(p.type); });
    var source = select("조건 속성", triggers), triggerValue = node("span", "dr-value");
    var target = select("실행 속성", []), action = select("실행 방법", []), actionValue = node("span", "dr-value");
    var triggerRow = node("div", "dr-grid"), actionRow = node("div", "dr-grid"), preview = node("p", "dr-preview");
    triggerRow.append(field("조건 속성", source), triggerValue);
    actionRow.append(field("실행 속성", target), field("실행 방법", action), actionValue);
    var save = node("button", "dr-primary", "규칙 추가"); save.type = "submit";
    var readTrigger, readAction;
    function valueControl(p, parent, label) {
      parent.replaceChildren();
      if (!p) return function () { return null; };
      var input;
      if (["select", "status", "checkbox"].includes(p.type)) {
        input = select(label, p.type === "checkbox" ? [{ id: "true", name: "체크" }, { id: "false", name: "해제" }] : p.config.options || []);
      } else if (p.type === "multi_select") {
        input = select(label, p.config.options || []); input.multiple = true;
      } else {
        input = node("input"); input.setAttribute("aria-label", label);
        input.type = p.type === "date" ? "date" : p.type === "number" ? "number" : "text";
        input.maxLength = 4000;
        if (p.type === "number") input.step = "any";
      }
      parent.appendChild(field(label, input)); input.oninput = updatePreview;
      return function () {
        if (p.type === "checkbox") return input.value === "true";
        if (p.type === "number") return input.value === "" ? null : Number(input.value);
        if (p.type === "multi_select") return Array.from(input.selectedOptions).map(function (o) { return o.value; });
        return input.value;
      };
    }
    function config() {
      return { trigger: when.value === "created" ? { type: "created" } : { type: "changed", property: source.value, value: readTrigger() },
        action: action.value === "today" ? { type: "today", property: target.value } : { type: "set", property: target.value, value: readAction() } };
    }
    function updatePreview() { if (readTrigger && readAction) preview.textContent = summary(config()); }
    function updateActionValue() {
      readAction = valueControl(action.value === "today" ? null : prop(target.value), actionValue, "넣을 값");
      actionValue.hidden = action.value === "today";
      updatePreview();
    }
    function updateAction() {
      action.replaceChildren();
      var p = prop(target.value), choices = [{ id: "set", name: "값 넣기" }];
      if (p && p.type === "date") choices.unshift({ id: "today", name: "오늘로 (UTC)" });
      choices.forEach(function (choice) { var o = node("option", "", choice.name); o.value = choice.id; action.appendChild(o); });
      updateActionValue();
    }
    function updateTrigger() {
      triggerRow.hidden = when.value === "created";
      readTrigger = valueControl(prop(source.value), triggerValue, "바뀐 값");
      var selected = target.value;
      target.replaceChildren();
      properties.filter(function (p) { return ["title", "text", "number", "select", "status", "multi_select", "date", "checkbox", "url", "email", "phone"].includes(p.type) && (when.value === "created" || p.id !== source.value); }).forEach(function (p) {
        var o = node("option", "", p.name); o.value = p.id; target.appendChild(o);
      });
      if (Array.from(target.options).some(function (o) { return o.value === selected; })) target.value = selected;
      else if (properties.some(function (p) { return p.type === "date"; })) target.value = properties.find(function (p) { return p.type === "date"; }).id;
      save.disabled = rules.length >= 20 || !target.value;
      updateAction();
    }
    when.onchange = source.onchange = updateTrigger; target.onchange = updateAction; action.onchange = updateActionValue;
    if (!triggers.length) { when.value = "created"; when.options[0].disabled = true; }
    form.append(node("h3", "", "새 규칙"), field("언제", when), triggerRow, node("h4", "", "그러면"), actionRow, preview, save);
    form.onsubmit = async function (event) {
      event.preventDefault(); save.disabled = true;
      try {
        await editor.api(path, { method: "POST", body: JSON.stringify({ config: config() }) });
        rules = (await editor.api(path)).rules; renderList(); status.textContent = "규칙을 저장했어요. 다음 행 변경부터 실행해요.";
      } catch (error) { status.textContent = error.message; save.disabled = rules.length >= 20; }
    };
    updateTrigger(); renderList();
    content.append(hint, list, form, status, node("p", "dr-muted", "오늘은 UTC 기준이에요. 같은 속성을 바꾸는 규칙은 아래 규칙의 값이 남아요."));
    dialog.append(header, content);
    dialog.addEventListener("close", function () { dialog.remove(); if (anchor.isConnected) anchor.focus(); });
    document.body.appendChild(dialog); dialog.showModal();
  } });
})();
