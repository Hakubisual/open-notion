// Database filter editor (several conditions joined by and/or) and CSV export of the current view. Loaded by db.js on
// first use so the editor first screen does not carry them; db.js passes the instance helpers it closes over.
(function () {
  if (window.AcardDbTools) return;
  window.AcardDbTools = function (api) {
    var currentView = api.currentView, el = api.el, popover = api.popover, saveView = api.saveView, render = api.render;
    var state = api.state, MODEL = api.MODEL, visibleProps = api.visibleProps, filteredRows = api.filteredRows, values = api.values;
    function filterEditor(anchor) {
      var view = currentView();
      var saved = view.config.filter;
      var join = saved && saved.or ? "or" : "and";
      var drafts = (saved ? (Array.isArray(saved) ? saved : saved.and || saved.or || [saved]) : []).filter(function (entry) { return entry && entry.property; });
      var wrap = el("div", { class: "dbaddbox" });
      var joinSelect = el("select", { class: "dbselect dbfilterjoin", "aria-label": "조건 연결" });
      [["and", "모두 만족(그리고)"], ["or", "하나라도(또는)"]].forEach(function (pair) {
        joinSelect.appendChild(el("option", { value: pair[0], text: pair[1], selected: join === pair[0] }));
      });
      var list = el("div", { class: "dbaddbox" });
      var conditions = [];
      function paintJoin() { joinSelect.hidden = conditions.length < 2; }
      function addCondition(draft) {
        var condition = filterCondition(draft);
        var remove = el("button", { type: "button", class: "dbtool", text: "조건 삭제" });
        remove.addEventListener("click", function () {
          conditions.splice(conditions.indexOf(condition), 1);
          condition.node.remove();
          paintJoin();
        });
        condition.node.appendChild(remove);
        conditions.push(condition);
        list.appendChild(condition.node);
        paintJoin();
      }
      (drafts.length ? drafts : [null]).forEach(addCondition);
      var more = el("button", { type: "button", class: "dbtool", text: "+ 조건 추가" });
      more.addEventListener("click", function () { addCondition(null); });
      wrap.appendChild(joinSelect);
      wrap.appendChild(list);
      wrap.appendChild(more);
      var box = popover(anchor, wrap);
      var row = el("div", { class: "dbrow2" });
      var apply = el("button", { type: "button", class: "dbprimary", text: "적용" });
      apply.addEventListener("click", function () {
        var parts = conditions.map(function (condition) { return condition.read(); });
        var filter = null;
        if (parts.length === 1) filter = parts[0];
        else if (parts.length) { filter = {}; filter[joinSelect.value] = parts; }
        box.remove();
        saveView({ filter: filter }).then(render);
      });
      var clear = el("button", { type: "button", class: "dbtool", text: "지우기" });
      clear.addEventListener("click", function () { box.remove(); saveView({ filter: null }).then(render); });
      row.appendChild(apply);
      row.appendChild(clear);
      box.appendChild(row);
    }

    function filterCondition(draft) {
      var wrap = el("div", { class: "dbaddbox dbfiltercond" });
      var propSelect = el("select", { class: "dbselect" });
      state.properties.forEach(function (prop) {
        propSelect.appendChild(el("option", { value: prop.id, text: prop.name, selected: draft && draft.property === prop.id }));
      });
      var opSelect = el("select", { class: "dbselect" });
      var valueInput = el("input", { class: "dburl", placeholder: "값", value: draft ? String(draft.value === undefined || draft.value === null ? "" : draft.value) : "" });
      var valueWrap = el("div", { class: "dboptlist" });
      var draftRelative = draft && draft.value && typeof draft.value === "object" ? String(draft.value.relative || "").split(":") : [];
      var periodSelect = el("select", { class: "dbselect dbperiod", "aria-label": "기간" });
      (MODEL.RELATIVE_DATES || []).forEach(function (entry) {
        periodSelect.appendChild(el("option", { value: entry.id, text: entry.label, selected: draftRelative[0] === entry.id }));
      });
      var daysInput = el("input", { class: "dburl dbperioddays", type: "number", min: "1", max: "3650", "aria-label": "일 수", value: draftRelative[1] || "7" });
      var periodWrap = el("div", { class: "dbrow2 dbperiodrow" }, [periodSelect, daysInput]);
      function paintPeriod() {
        var within = opSelect.value === "is_within";
        periodWrap.hidden = !within;
        valueInput.hidden = within;
        valueWrap.hidden = within;
        daysInput.hidden = !/_days$/.test(periodSelect.value);
      }
      opSelect.addEventListener("change", paintPeriod);
      periodSelect.addEventListener("change", paintPeriod);
      function currentProp() {
        return state.properties.find(function (entry) { return entry.id === propSelect.value; }) || state.properties[0];
      }
      function paintOps() {
        opSelect.innerHTML = "";
        MODEL.filterOperatorsFor(currentProp().type).forEach(function (operator) {
          var label = (MODEL.FILTER_OPERATORS.find(function (entry) { return entry.id === operator; }) || {}).label || operator;
          opSelect.appendChild(el("option", { value: operator, text: label, selected: draft && draft.operator === operator }));
        });
        paintValues();
        paintPeriod();
      }
      function paintValues() {
        valueWrap.innerHTML = "";
        var prop = currentProp();
        var options = (prop.config.options || []);
        if (prop.type === "select" || prop.type === "status" || prop.type === "multi_select") {
          options.forEach(function (option) {
            var button = el("button", { type: "button", class: "dbopt" + (draft && draft.value === option.id ? " on" : ""), text: option.name });
            button.addEventListener("click", function () { valueInput.value = option.id; });
            valueWrap.appendChild(button);
          });
        }
        if (prop.type === "person") {
          var seen = {};
          state.rows.forEach(function (row) { ((row.props || {})[prop.id] || []).forEach(function (email) { seen[email] = true; }); });
          Object.keys(seen).sort().forEach(function (email) {
            var button = el("button", { type: "button", class: "dbopt" + (draft && draft.value === email ? " on" : ""), text: email });
            button.addEventListener("click", function () { valueInput.value = email; });
            valueWrap.appendChild(button);
          });
        }
        if (prop.type === "date" || prop.type === "created_time" || prop.type === "updated_time") {
          var today = new Date().toISOString().slice(0, 10);
          var quick = el("button", { type: "button", class: "dbopt", text: "오늘" });
          quick.addEventListener("click", function () { valueInput.value = today; });
          valueWrap.appendChild(quick);
        }
      }
      propSelect.addEventListener("change", paintOps);
      paintOps();
      wrap.appendChild(el("label", { class: "dblabel", text: "속성" }));
      wrap.appendChild(propSelect);
      wrap.appendChild(el("label", { class: "dblabel", text: "조건" }));
      wrap.appendChild(opSelect);
      wrap.appendChild(el("label", { class: "dblabel", text: "값" }));
      wrap.appendChild(valueInput);
      wrap.appendChild(valueWrap);
      wrap.appendChild(periodWrap);
      function read() {
        var prop = currentProp();
        var value = valueInput.value;
        if (prop.type === "number") value = value === "" ? null : Number(value);
        if (prop.type === "date") value = value || null;
        if (opSelect.value === "is_within") value = { relative: /_days$/.test(periodSelect.value) ? periodSelect.value + ":" + Math.max(1, Math.min(3650, Math.trunc(Number(daysInput.value) || 7))) : periodSelect.value };
        return { property: propSelect.value, operator: opSelect.value, value: value };
      }
      return { node: wrap, read: read };
    }

    function csvCell(text) {
      text = String(text);
      return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    function exportCsv() {
      var columns = visibleProps();
      var lines = [columns.map(function (prop) { return csvCell(prop.name); }).join(",")];
      filteredRows().forEach(function (row) {
        var vals = values(row);
        lines.push(columns.map(function (prop) {
          var value = vals[prop.id];
          var text = prop.type === "relation" ? (Array.isArray(value) ? value : []).map(function (id) { return state.relationTitles[id] || id; }).join(", ") : MODEL.displayValue(prop, value, { relative: false });
          return csvCell(text);
        }).join(","));
      });
      var url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
      var link = el("a", { href: url, download: (state.database.title || "database") + ".csv" });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    }

    return { filterEditor: filterEditor, exportCsv: exportCsv };
  };
})();
