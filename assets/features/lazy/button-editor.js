// Action list editor for button blocks (C3) and button properties (C4): label, icon, color and an ordered list of
// confirm / add a row / open / change this row / change related rows. Values are fixed text, or 오늘, 지금, 이 행.
(function () {
  "use strict";
  if (window.AcardButtonEditor) return;
  var COLORS = [["", "기본"], ["gray", "회색"], ["brown", "갈색"], ["orange", "주황"], ["yellow", "노랑"], ["green", "초록"], ["blue", "파랑"], ["purple", "보라"], ["pink", "분홍"], ["red", "빨강"]];
  var KINDS = [["confirm", "확인 창"], ["create_row", "데이터베이스에 행 추가"], ["open", "열기"], ["update_row", "이 행 바꾸기"], ["update_related", "관계 행 바꾸기"]];
  var box = null;
  var schemaCache = Object.create(null);
  function json(path) { return fetch("/api" + path, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); }
  function schema(slug) { return schemaCache[slug] || (schemaCache[slug] = json("/db/" + encodeURIComponent(slug))); }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function select(options, value, onChange) {
    var s = el("select");
    options.forEach(function (o) { var opt = el("option", { value: o[0] }, o[1]); if (o[0] === value) opt.selected = true; s.appendChild(opt); });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function close() {
    if (!box) return;
    box.remove(); box = null;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function outside(ev) { if (box && !box.contains(ev.target) && !ev.target.closest("select")) close(); }
  function onKey(ev) { if (ev.key === "Escape") close(); }
  function valueEditor(props, values, allowRow, changed) {
    var wrap = el("div", { class: "be-values" });
    function draw() {
      wrap.textContent = "";
      Object.keys(values).forEach(function (key) {
        var prop = props.find(function (p) { return p.id === key; });
        var line = el("div", { class: "be-value" });
        line.appendChild(el("span", { class: "be-pname" }, prop ? prop.name : key));
        var v = values[key];
        var mode = v && typeof v === "object" && !Array.isArray(v) ? (v.relative || (v.ref ? "row" : "fixed")) : "fixed";
        var modes = [["fixed", "값"]];
        if (prop && prop.type === "date") modes.push(["today", "오늘"], ["now", "지금"]);
        if (allowRow && prop && prop.type === "relation") modes.push(["row", "이 행"]);
        line.appendChild(select(modes, mode, function (m) {
          values[key] = m === "today" ? { relative: "today" } : m === "now" ? { relative: "now" } : m === "row" ? { ref: "row" } : (prop && prop.type === "checkbox" ? true : "");
          draw(); changed();
        }));
        if (mode === "fixed") {
          var input;
          if (prop && prop.type === "checkbox") {
            input = el("input", { type: "checkbox" }); input.checked = v === true;
            input.addEventListener("change", function () { values[key] = input.checked; changed(); });
          } else if (prop && (prop.type === "select" || prop.type === "status")) {
            input = select([["", "비우기"]].concat((prop.config.options || []).map(function (o) { return [o.id, o.name]; })), v || "", function (x) { values[key] = x || null; changed(); });
          } else {
            input = el("input", { type: prop && prop.type === "number" ? "number" : prop && prop.type === "date" ? "date" : "text" });
            input.value = v === null || v === undefined ? "" : (typeof v === "object" && v.start ? v.start : String(v));
            input.addEventListener("input", function () { values[key] = prop && prop.type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value; changed(); });
          }
          line.appendChild(input);
        }
        var del = el("button", { type: "button", class: "minibtn", "aria-label": "값 지우기" }, "×");
        del.addEventListener("click", function () { delete values[key]; draw(); changed(); });
        line.appendChild(del);
        wrap.appendChild(line);
      });
      var free = props.filter(function (p) { return !(p.id in values) && ["formula", "rollup", "created_time", "updated_time", "unique_id", "button", "files", "person"].indexOf(p.type) < 0; });
      if (free.length) {
        wrap.appendChild(select([["", "+ 값 넣을 속성"]].concat(free.map(function (p) { return [p.id, p.name]; })), "", function (id) {
          var p = props.find(function (x) { return x.id === id; });
          if (p) values[id] = p.type === "checkbox" ? true : p.type === "date" ? { relative: "today" } : "";
          draw(); changed();
        }));
      }
    }
    draw();
    return wrap;
  }
  function actionRow(action, ctx, list, index, redraw, changed) {
    var row = el("div", { class: "be-action" });
    var head = el("div", { class: "be-head" });
    head.appendChild(el("span", { class: "be-num" }, String(index + 1)));
    head.appendChild(el("strong", {}, (KINDS.find(function (k) { return k[0] === action.type; }) || ["", action.type])[1]));
    [["↑", -1], ["↓", 1]].forEach(function (m) {
      var b = el("button", { type: "button", class: "minibtn", "aria-label": m[1] < 0 ? "위로" : "아래로" }, m[0]);
      b.disabled = index + m[1] < 0 || index + m[1] >= list.length;
      b.addEventListener("click", function () { var t = list[index]; list[index] = list[index + m[1]]; list[index + m[1]] = t; redraw(); changed(); });
      head.appendChild(b);
    });
    var del = el("button", { type: "button", class: "minibtn", "aria-label": "동작 지우기" }, "삭제");
    del.addEventListener("click", function () { list.splice(index, 1); redraw(); changed(); });
    head.appendChild(del);
    row.appendChild(head);
    var body = el("div", { class: "be-body" });
    row.appendChild(body);
    if (action.type === "confirm") {
      var msg = el("input", { type: "text", placeholder: "확인 창에 보일 글" }); msg.value = action.message || "";
      msg.addEventListener("input", function () { action.message = msg.value; changed(); });
      body.appendChild(msg);
    } else if (action.type === "open") {
      body.appendChild(select([["created", "방금 만든 행"], ["url", "주소"]], action.target || "created", function (t) { action.target = t; redraw(); changed(); }));
      if (action.target === "url") {
        var url = el("input", { type: "text", placeholder: "https://… 또는 /페이지/" }); url.value = action.url || "";
        url.addEventListener("input", function () { action.url = url.value.trim(); changed(); });
        body.appendChild(url);
      }
    } else if (action.type === "create_row") {
      action.values = action.values || {};
      body.appendChild(select([["", "데이터베이스 고르기"]].concat(ctx.databases.map(function (d) { return [d.slug, d.title || d.slug]; })), action.database || "", function (slug) { action.database = slug; action.values = {}; delete action.template; redraw(); changed(); }));
      if (action.database) {
        var slot = el("div", { class: "be-slot" }, "불러오는 중…");
        body.appendChild(slot);
        schema(action.database).then(function (data) {
          slot.textContent = "";
          slot.appendChild(select([["", "템플릿 없이"]].concat((data.templates || []).map(function (t) { return [t.id, t.name]; })), action.template || "", function (t) { if (t) action.template = t; else delete action.template; changed(); }));
          slot.appendChild(valueEditor(data.properties, action.values, !!ctx.row, changed));
        }, function () { slot.textContent = "이 데이터베이스를 읽지 못했어요."; });
      }
    } else if (action.type === "update_row") {
      action.values = action.values || {};
      body.appendChild(valueEditor(ctx.properties || [], action.values, false, changed));
    } else if (action.type === "update_related") {
      action.values = action.values || {};
      var rels = (ctx.properties || []).filter(function (p) { return p.type === "relation"; });
      body.appendChild(select([["", "관계 속성 고르기"]].concat(rels.map(function (p) { return [p.id, p.name]; })), action.relation || "", function (id) { action.relation = id; action.values = {}; redraw(); changed(); }));
      var rel = rels.find(function (p) { return p.id === action.relation; });
      if (rel && rel.config && rel.config.database) {
        var slot2 = el("div", { class: "be-slot" }, "불러오는 중…");
        body.appendChild(slot2);
        schema(rel.config.database).then(function (data) { slot2.textContent = ""; slot2.appendChild(valueEditor(data.properties, action.values, false, changed)); }, function () { slot2.textContent = "이 데이터베이스를 읽지 못했어요."; });
      }
    }
    return row;
  }
  // target: { label, icon, color, actions } (edited in place). ctx.row = true for a button property (enables 이 행 and row actions).
  function open(anchor, target, ctx, changed) {
    close();
    box = el("div", { class: "be-panel", role: "dialog", "aria-label": "버튼 동작" });
    target.actions = Array.isArray(target.actions) ? target.actions : [];
    var head = el("div", { class: "be-top" });
    var label = el("input", { type: "text", placeholder: "버튼 글자" }); label.value = target.label || "";
    label.addEventListener("input", function () { target.label = label.value; changed(); });
    var icon = el("input", { type: "text", class: "be-icon", placeholder: "아이콘", maxlength: "4" }); icon.value = target.icon || "";
    icon.addEventListener("input", function () { target.icon = icon.value.trim(); changed(); });
    head.appendChild(label); head.appendChild(icon);
    head.appendChild(select(COLORS, target.color || "", function (c) { target.color = c; changed(); }));
    box.appendChild(head);
    var listBox = el("div", { class: "be-list" });
    box.appendChild(listBox);
    var kinds = KINDS.filter(function (k) { return ctx.row || (k[0] !== "update_row" && k[0] !== "update_related"); });
    function redraw() {
      listBox.textContent = "";
      target.actions.forEach(function (a, i) { listBox.appendChild(actionRow(a, ctx, target.actions, i, redraw, changed)); });
      if (target.actions.length < 10) listBox.appendChild(select([["", "+ 동작 추가"]].concat(kinds), "", function (k) {
        if (!k) return;
        target.actions.push(k === "open" ? { type: "open", target: "created" } : k === "confirm" ? { type: "confirm", message: "실행할까요?" } : { type: k, values: {} });
        redraw(); changed();
      }));
    }
    var done = el("button", { type: "button", class: "be-done" }, "완료");
    done.addEventListener("click", close);
    box.appendChild(done);
    document.body.appendChild(box);
    var rect = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8)) + "px";
    box.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - box.offsetHeight - 8)) + "px";
    (ctx.databases ? Promise.resolve() : json("/db/list").then(function (d) { ctx.databases = d.databases || []; }, function () { ctx.databases = []; })).then(redraw);
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", onKey, true); }, 0);
  }
  function property(anchor, prop, properties, save) {
    var target = { label: prop.config.label || "", icon: prop.config.icon || "", color: prop.config.color || "", actions: JSON.parse(JSON.stringify(prop.config.actions || [])) };
    var timer = null;
    open(anchor, target, { row: true, properties: properties }, function () {
      clearTimeout(timer);
      timer = setTimeout(function () { save(prop.id, { config: Object.assign({}, prop.config, target) }); }, 600);
    });
  }
  window.AcardButtonEditor = { open: open, close: close, property: property };
  if (window.AcardEditor) {
    window.AcardEditor.provide("button-editor", {
      open: function (anchor, block, changed) {
        var meta = Object.assign({}, block.meta || {});
        var target = { label: block.text || "", icon: meta.icon || "", color: meta.color || "", actions: meta.actions || [] };
        open(anchor, target, {}, function () {
          block.text = target.label;
          var next = Object.assign({}, block.meta || {});
          if (target.icon) next.icon = target.icon; else delete next.icon;
          if (target.color) next.color = target.color; else delete next.color;
          if (target.actions.length) next.actions = target.actions; else delete next.actions;
          block.meta = next;
          changed();
        });
      },
    });
  }
})();
