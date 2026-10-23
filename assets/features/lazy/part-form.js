// Part fill screen (#38): the editor form for a part block's data, loaded with lazy("part-form") by the parts chunk.
// The form is drawn from the part's JSON schema: a grid for tables (columns x rows), matrices (heatmap rows x cols) and
// series (chart labels x series), rows of fields for lists of objects, plain fields for the rest, and a JSON box for
// anything the form cannot show. Every edit is checked with the same validatePartData that set_part_data uses; data
// that does not fit is shown as an error and not saved, so the page keeps the last data the part can draw.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var LABELS = {
    title: "제목", note: "메모", unit: "단위", type: "모양", label: "이름", value: "값", of: "전체", badge: "배지", state: "상태", name: "이름", data: "값",
    desc: "설명", gate: "넘김 조건", items: "항목", tags: "태그", numbered: "번호 붙이기", columns: "열 이름", labels: "가로축", cols: "열", rows: "행", values: "값",
    sum: "합계 열", avg: "평균 열 (번호)", ratio: "비중 열 (번호)", unitCols: "단위 붙일 열 (번호)", edges: "화살표", callout: "아래 메모", text: "내용", nodes: "단계", series: "계열"
  };
  var ENUMS = { ok: "좋음", warn: "주의", stop: "멈춤", wait: "대기", info: "정보", bar: "막대", line: "선", done: "끝남", doing: "하는 중", todo: "할 일", agent: "에이전트", api: "API", lib: "라이브러리", person: "사람" };
  var ADVANCED = { ratio: 1, avg: 1, unitCols: 1 };
  var HINT = "숫자만 채우면 모양과 합계는 부품이 해요";

  function types(s) { return !s ? [] : Array.isArray(s.type) ? s.type : s.type ? [s.type] : []; }
  function has(s, t) { return types(s).indexOf(t) >= 0; }
  function scalar(s) { return !!s && (Array.isArray(s.enum) || (types(s).length > 0 && !has(s, "array") && !has(s, "object"))); }
  function scalarList(s) { return !!s && has(s, "array") && scalar(s.items); }
  function grid2(s) { return !!s && has(s, "array") && !!s.items && has(s.items, "array") && scalar(s.items.items); }
  function objList(s) { return !!s && has(s, "array") && !!s.items && has(s.items, "object") && !!s.items.properties; }
  var extraLabels = null;
  function label(key) { return (extraLabels && extraLabels[key]) || LABELS[key] || key; }
  function show(v) { return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); }
  // Text typed into a field becomes the value its schema accepts: numbers (1,200 too) where a number may go, null for an
  // empty cell that may be empty, otherwise the text. A value the schema refuses stays as typed so the check can name it.
  function coerce(text, s) {
    var v = String(text).trim();
    if (s && Array.isArray(s.enum)) return v === "" && s.enum.indexOf("") < 0 ? undefined : v;
    if (v === "") return has(s, "null") ? null : has(s, "string") || !types(s).length ? "" : undefined;
    var n = v.replace(/,/g, "");
    if ((has(s, "number") || has(s, "integer")) && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n)) return Number(n);
    if (has(s, "boolean") && (v === "true" || v === "false")) return v === "true";
    return v;
  }
  function blank(s, key, list) {
    if (key === "id") { var n = list.length + 1; while (list.some(function (x) { return x && x.id === "n" + n; })) n += 1; return "n" + n; }
    if (Array.isArray(s.enum)) return s.enum[0];
    return has(s, "string") ? "" : has(s, "number") ? 0 : has(s, "array") ? [] : has(s, "object") ? {} : has(s, "boolean") ? false : null;
  }
  function newItem(s, list) {
    var item = {};
    (s.required || []).forEach(function (key) { item[key] = blank((s.properties || {})[key] || {}, key, list); });
    return item;
  }
  function el(doc, tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function mount(host, o) {
    var doc = host.ownerDocument, block = o.block, schema = o.schema || {}, P = schema.properties || {}, timer = 0, data, json = false;
    extraLabels = o.labels || null;
    function parse() { return o.parse(block.text) || {}; }
    data = parse();
    host.className = "acv-editor acp-editor pf";
    host.replaceChildren();
    var head = el(doc, "div", "pf-head"), chip = el(doc, "span", "pf-chip"), mode = el(doc, "button", "pf-mode", "JSON");
    chip.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6.5h12M6.5 6.5v7"/></svg>';
    chip.append(el(doc, "span", "", o.kind || "부품 ·"), " ", el(doc, "span", "", o.name), o.version ? " v" + o.version : "");
    mode.type = "button";
    mode.setAttribute("aria-pressed", "false");
    mode.title = "데이터를 JSON 으로 보고 고치기";
    head.append(chip, mode);
    var body = el(doc, "div", "pf-body"), area = el(doc, "textarea", "pf-json acv-source"), err = el(doc, "p", "pf-err"), hint = el(doc, "p", "pf-hint", o.hint || HINT), preview = el(doc, "div", "pf-preview acv-preview");
    err.setAttribute("role", "alert");
    err.hidden = true;
    area.spellcheck = false;
    area.hidden = true;
    area.setAttribute("aria-label", "부품 데이터 (JSON)");
    host.append(head, body, area, err, hint, preview);
    host.addEventListener("keydown", function (ev) { ev.stopPropagation(); });

    var inputs = [];
    function bind(input, path) { input.dataset.path = path; inputs.push(input); return input; }
    // One control for one value: select for an enum, checkbox for a boolean, comma list for a list of plain values,
    // text box for the rest. Values the form cannot show (objects inside a list) are read-only here and edited as JSON.
    function control(s, get, set, path, name) {
      var input;
      if (Array.isArray(s.enum)) {
        input = el(doc, "select", "pf-in");
        var cur = get(), opts = s.enum.slice();
        if (opts.indexOf("") < 0) opts.unshift("");
        if (cur != null && opts.indexOf(cur) < 0) opts.push(cur);
        opts.forEach(function (v) { var opt = el(doc, "option", "", v === "" ? "-" : ENUMS[v] || String(v)); opt.value = v; input.appendChild(opt); });
        input.value = cur == null ? "" : cur;
        input.addEventListener("change", function () { set(coerce(input.value, s)); commit(); });
      } else if (has(s, "boolean") && types(s).length === 1) {
        input = el(doc, "input", "pf-check");
        input.type = "checkbox";
        input.checked = get() === true;
        input.addEventListener("change", function () { set(input.checked); commit(); });
      } else if (scalarList(s)) {
        input = el(doc, "input", "pf-in");
        input.value = (get() || []).map(show).join(", ");
        input.placeholder = "쉼표로 나눠 적어요";
        input.addEventListener("input", function () {
          var v = input.value.trim();
          set(v === "" ? [] : v.split(",").map(function (x) { var c = coerce(x, s.items); return c === undefined ? "" : c; }));
          commit();
        });
      } else if (scalar(s) || !types(s).length && !s.properties) {
        input = el(doc, "input", "pf-in" + (has(s, "number") && !has(s, "string") ? " pf-num" : ""));
        input.value = show(get());
        if (has(s, "number") && !has(s, "string")) input.inputMode = "decimal";
        if (s.maxLength) input.maxLength = s.maxLength;
        input.addEventListener("input", function () { set(coerce(input.value, s)); commit(); });
      } else {
        input = el(doc, "span", "pf-ro", summary(get()));
        input.title = "JSON 에서 고쳐요";
        input.tabIndex = 0;
        return bind(input, path);
      }
      input.setAttribute("aria-label", name);
      return bind(input, path);
    }
    function summary(v) {
      if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === "object" ? x.text || x.label || x.id || "…" : show(x); }).join(", ") || "-";
      return v && typeof v === "object" ? Object.keys(v).length + "칸 · JSON" : show(v);
    }
    function setKey(obj, key) { return function (v) { if (v === undefined) delete obj[key]; else obj[key] = v; }; }
    function field(key, s, obj, path, wrap) {
      var row = el(doc, "label", "pf-field"), name = el(doc, "span", "pf-name", label(key));
      row.append(name, control(s, function () { return obj[key]; }, setKey(obj, key), path + "." + key, label(key)));
      (wrap || body).appendChild(row);
    }

    // A grid: cols [{head, setHead?, s, get(i), set(i, v), path(i)}], an optional editable row head, row add/remove,
    // optional column add, optional footer. Enter in a cell goes to the same cell one row down (a new row at the end).
    function table(title, g) {
      var wrap = el(doc, "div", "pf-grid"), scroll = el(doc, "div", "pf-scroll"), t = el(doc, "table", "pf-table"), thead = el(doc, "thead"), tbody = el(doc, "tbody"), hr = el(doc, "tr");
      if (title) wrap.appendChild(el(doc, "p", "pf-name", title));
      if (g.rowHead) hr.appendChild(el(doc, "th", "pf-rh", g.rowHead.title));
      g.cols.forEach(function (c, j) {
        var th = el(doc, "th", c.s && has(c.s, "number") && !has(c.s, "string") ? "pf-n" : "");
        if (c.setHead) {
          var hin = bind(el(doc, "input", "pf-in pf-hin"), c.headPath);
          hin.value = show(c.head);
          hin.setAttribute("aria-label", (j + 1) + "번째 열 이름");
          hin.addEventListener("input", function () { c.setHead(hin.value); commit(); });
          th.appendChild(hin);
        } else th.textContent = c.head;
        hr.appendChild(th);
      });
      hr.appendChild(el(doc, "th", "pf-x"));
      thead.appendChild(hr);
      for (var i = 0; i < g.count(); i += 1) (function (i) {
        var tr = el(doc, "tr");
        if (g.rowHead) {
          var th = el(doc, "th", "pf-rh");
          th.appendChild(control(g.rowHead.s, function () { return g.rowHead.get(i); }, function (v) { g.rowHead.set(i, v); }, g.rowHead.path(i), (i + 1) + "번째 행 이름"));
          tr.appendChild(th);
        }
        g.cols.forEach(function (c, j) {
          var td = el(doc, "td", c.s && has(c.s, "number") && !has(c.s, "string") ? "pf-n" : "");
          var input = control(c.s || {}, function () { return c.get(i); }, function (v) { c.set(i, v); }, c.path(i), (i + 1) + "행 " + (c.head || j + 1));
          input.dataset.cell = i + ":" + j;
          td.appendChild(input);
          tr.appendChild(td);
        });
        var td = el(doc, "td", "pf-x"), del = el(doc, "button", "pf-del", "×");
        del.type = "button";
        del.title = del.ariaLabel = (i + 1) + "번째 행 지우기";
        del.setAttribute("aria-label", del.title);
        del.addEventListener("click", function () { g.del(i); redraw(); });
        td.appendChild(del);
        tr.appendChild(td);
        tbody.appendChild(tr);
      })(i);
      t.append(thead, tbody);
      if (g.foot) t.appendChild(g.foot());
      t.addEventListener("keydown", function (ev) {
        var cell = ev.target.dataset && ev.target.dataset.cell;
        if (ev.key !== "Enter" || !cell || ev.isComposing) return;
        ev.preventDefault();
        var at = cell.split(":"), next = +at[0] + 1;
        if (next >= g.count()) { g.add(); redraw(); }
        var to = host.querySelector('[data-cell="' + next + ":" + at[1] + '"]');
        if (to) to.focus();
      });
      scroll.appendChild(t);
      var tools = el(doc, "div", "pf-tools"), add = el(doc, "button", "pf-add", "+ 행 추가");
      add.type = "button";
      add.addEventListener("click", function () { g.add(); redraw(); var cells = host.querySelectorAll("[data-cell]"); if (cells.length) cells[cells.length - g.cols.length].focus(); });
      tools.appendChild(add);
      if (g.addCol) {
        var addc = el(doc, "button", "pf-add", "+ 열 추가");
        addc.type = "button";
        addc.addEventListener("click", function () { g.addCol(); redraw(); });
        tools.appendChild(addc);
      }
      wrap.append(scroll, tools);
      body.appendChild(wrap);
    }
    function nulls(n) { var out = []; for (var i = 0; i < n; i += 1) out.push(null); return out; }
    function arr(key) { if (!Array.isArray(data[key])) data[key] = []; return data[key]; }

    function draw() {
      inputs = [];
      body.replaceChildren();
      var used = { note: 1 }, later = [], more = [], line = el(doc, "div", "pf-line");
      Object.keys(P).forEach(function (key) { if (scalar(P[key]) && !used[key] && !ADVANCED[key]) { used[key] = 1; field(key, P[key], data, "data", line); } });
      if (line.firstChild) body.appendChild(line);
      // Table: column names on top, rows below, a 합계 row whose checkboxes pick the columns the part totals.
      if (scalarList(P.columns) && grid2(P.rows)) {
        used.columns = used.rows = 1;
        var cs = P.rows.items.items, cols = arr("columns"), rows = arr("rows");
        if (P.sum) used.sum = 1;
        table("", {
          cols: cols.map(function (h, j) {
            return { head: h, headPath: "data.columns[" + j + "]", setHead: function (v) { cols[j] = v; }, s: cs, get: function (i) { return rows[i][j]; },
              set: function (i, v) { rows[i][j] = v === undefined ? null : v; }, path: function (i) { return "data.rows[" + i + "][" + j + "]"; } };
          }),
          count: function () { return rows.length; },
          add: function () { rows.push(nulls(cols.length)); },
          del: function (i) { rows.splice(i, 1); },
          addCol: P.columns.maxItems && cols.length >= P.columns.maxItems ? null : function () { cols.push("열 " + (cols.length + 1)); rows.forEach(function (r) { r.push(null); }); },
          foot: P.sum ? function () {
            var tf = el(doc, "tfoot"), tr = el(doc, "tr"), sum = Array.isArray(data.sum) ? data.sum : [];
            cols.forEach(function (h, j) {
              var td = el(doc, "td", j ? "pf-n" : "");
              if (!j) td.textContent = "합계";
              else {
                var box = el(doc, "label", "pf-auto"), c = el(doc, "input", "pf-check");
                c.type = "checkbox";
                c.checked = sum.indexOf(j) >= 0;
                c.setAttribute("aria-label", (h || j + 1) + " 열 합계 자동 계산");
                c.addEventListener("change", function () {
                  var next = (Array.isArray(data.sum) ? data.sum : []).filter(function (x) { return x !== j; });
                  if (c.checked) next.push(j);
                  next.sort(function (a, b) { return a - b; });
                  if (next.length) data.sum = next; else delete data.sum;
                  box.classList.toggle("on", c.checked);
                  commit();
                });
                box.classList.toggle("on", c.checked);
                box.append(c, doc.createTextNode("자동 계산"));
                td.appendChild(box);
              }
              tr.appendChild(td);
            });
            tr.appendChild(el(doc, "td", "pf-x"));
            tf.appendChild(tr);
            return tf;
          } : null
        });
      } else if (scalarList(P.rows) && scalarList(P.cols) && grid2(P.values)) {
        // Matrix (heatmap): row names down the side, column names on top.
        used.rows = used.cols = used.values = 1;
        var mrows = arr("rows"), mcols = arr("cols"), vals = arr("values"), vs = P.values.items.items;
        mrows.forEach(function (r, i) { if (!Array.isArray(vals[i])) vals[i] = nulls(mcols.length); });
        table("", {
          rowHead: { title: label("rows"), s: P.rows.items, get: function (i) { return mrows[i]; }, set: function (i, v) { mrows[i] = v == null ? "" : v; }, path: function (i) { return "data.rows[" + i + "]"; } },
          cols: mcols.map(function (h, j) {
            return { head: h, headPath: "data.cols[" + j + "]", setHead: function (v) { mcols[j] = v; }, s: vs, get: function (i) { return vals[i][j]; },
              set: function (i, v) { vals[i][j] = v === undefined ? null : v; }, path: function (i) { return "data.values[" + i + "][" + j + "]"; } };
          }),
          count: function () { return mrows.length; },
          add: function () { mrows.push(""); vals.push(nulls(mcols.length)); },
          del: function (i) { mrows.splice(i, 1); vals.splice(i, 1); },
          addCol: function () { mcols.push(""); vals.forEach(function (r) { r.push(null); }); }
        });
      } else if (scalarList(P.labels) && objList(P.series) && P.series.items.properties.data) {
        // Series (chart): one row per label, one column per series.
        used.labels = used.series = 1;
        var labels = arr("labels"), series = arr("series"), ds = P.series.items.properties.data.items || {};
        series.forEach(function (s) { if (!Array.isArray(s.data)) s.data = []; });
        table("", {
          rowHead: { title: label("labels"), s: P.labels.items, get: function (i) { return labels[i]; }, set: function (i, v) { labels[i] = v == null ? "" : v; }, path: function (i) { return "data.labels[" + i + "]"; } },
          cols: series.map(function (s, j) {
            return { head: s.name || "", headPath: "data.series[" + j + "].name", setHead: function (v) { if (v) s.name = v; else delete s.name; }, s: ds,
              get: function (i) { return s.data[i]; }, set: function (i, v) { while (s.data.length < i) s.data.push(null); s.data[i] = v === undefined ? null : v; }, path: function (i) { return "data.series[" + j + "].data[" + i + "]"; } };
          }),
          count: function () { return labels.length; },
          add: function () { labels.push(""); series.forEach(function (s) { s.data.push(null); }); },
          del: function (i) { labels.splice(i, 1); series.forEach(function (s) { s.data.splice(i, 1); }); },
          addCol: P.series.maxItems && series.length >= P.series.maxItems ? null : function () { series.push({ name: "계열 " + (series.length + 1), data: nulls(labels.length) }); }
        });
      }
      Object.keys(P).forEach(function (key) {
        var s = P[key];
        if (used[key]) return;
        if (scalar(s)) more.push(key);
        else if (objList(s)) {
          // A list of objects (badge items, dag nodes): one row per object, one column per field.
          var list = arr(key), keys = Object.keys(s.items.properties);
          table(label(key), {
            cols: keys.map(function (k) {
              var ks = s.items.properties[k];
              return { head: label(k), s: ks, get: function (i) { return list[i][k]; }, set: function (i, v) { setKey(list[i], k)(v); }, path: function (i) { return "data." + key + "[" + i + "]." + k; } };
            }),
            count: function () { return list.length; },
            add: function () { list.push(newItem(s.items, list)); },
            del: function (i) { list.splice(i, 1); }
          });
        } else if (grid2(s)) {
          // A list of short lists (dag edges): numbered columns, or from/to/label for edges.
          var g = arr(key), width = Math.min(6, s.items.maxItems || Math.max(2, g.reduce(function (m, r) { return Math.max(m, (r || []).length); }, 0)));
          var heads = key === "edges" ? ["시작 id", "끝 id", "라벨"] : [];
          table(label(key), {
            cols: nulls(width).map(function (x, j) {
              return { head: heads[j] || String(j + 1), s: s.items.items, get: function (i) { return g[i][j]; },
                set: function (i, v) { var r = g[i]; while (r.length < j) r.push(""); if (v === undefined || v === "" && j === r.length - 1) r.length = Math.min(r.length, j); else r[j] = v; }, path: function (i) { return "data." + key + "[" + i + "][" + j + "]"; } };
            }),
            count: function () { return g.length; },
            add: function () { g.push(nulls(Math.min(2, width)).map(function () { return ""; })); },
            del: function (i) { g.splice(i, 1); }
          });
        } else if (scalarList(s)) more.push(key);
        else if (s && s.properties) later.push(key);
      });
      later.forEach(function (key) {
        var box = el(doc, "fieldset", "pf-set"), obj = data[key] && typeof data[key] === "object" ? data[key] : {};
        box.appendChild(el(doc, "legend", "", label(key)));
        Object.keys(P[key].properties).forEach(function (k) { if (scalar(P[key].properties[k])) field(k, P[key].properties[k], obj, "data." + key, box); });
        box.addEventListener("input", function () { if (Object.keys(obj).length) data[key] = obj; else delete data[key]; }, true);
        body.appendChild(box);
      });
      if (P.note) field("note", P.note, data, "data");
      if (more.length) {
        var det = el(doc, "details", "pf-more");
        det.appendChild(el(doc, "summary", "", "더 보기"));
        more.forEach(function (key) { field(key, P[key], data, "data", det); });
        body.appendChild(det);
      }
      if (!Object.keys(P).length) body.appendChild(el(doc, "p", "pf-hint", "이 부품은 칸이 정해져 있지 않아 JSON 으로 채워요."));
    }
    function redraw() { draw(); commit(); }

    function mark(errors) {
      var paths = errors.map(function (e) { return e.slice(0, e.indexOf(": ")); });
      inputs.forEach(function (input) {
        var p = input.dataset.path, bad = paths.some(function (q) { return q === p || q.indexOf(p + ".") === 0 || q.indexOf(p + "[") === 0; });
        if (bad) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      });
    }
    function commit() {
      var errors = o.validate(schema, data);
      mark(errors);
      err.hidden = !errors.length;
      hint.hidden = !!errors.length;
      if (errors.length) { err.textContent = errors.slice(0, 3).join(" · ") + " — 고칠 때까지 저장하지 않아요."; return false; }
      var text = JSON.stringify(data, null, 2);
      if (text !== block.text) { block.text = text; o.save(); clearTimeout(timer); timer = setTimeout(function () { o.preview(preview); }, 250); }
      return true;
    }
    area.addEventListener("input", function () {
      var next = o.parse(area.value), errors = next ? o.validate(schema, next) : ["JSON 객체가 아니에요"];
      err.hidden = !errors.length;
      hint.hidden = !!errors.length;
      if (errors.length) { err.textContent = errors.slice(0, 3).join(" · ") + " — 고칠 때까지 저장하지 않아요."; return; }
      data = next;
      block.text = JSON.stringify(data, null, 2);
      o.save();
      clearTimeout(timer);
      timer = setTimeout(function () { o.preview(preview); }, 250);
    });
    function setMode(on) {
      json = on;
      mode.setAttribute("aria-pressed", on ? "true" : "false");
      mode.textContent = on ? "칸으로 보기" : "JSON";
      area.hidden = !on;
      body.hidden = on;
      if (on) { area.value = block.text; area.rows = Math.min(16, Math.max(4, block.text.split("\n").length + 1)); }
      else { data = parse(); redraw(); }
    }
    mode.addEventListener("click", function () { setMode(!json); });

    draw();
    o.preview(preview);
    if (!o.parse(block.text) || !Object.keys(P).length) setMode(true);
    else commit();
    if (o.focus) { var first = host.querySelector(".pf-body input,.pf-body select,.pf-json:not([hidden])"); if (first) first.focus(); }
  }

  editor.provide("part-form", { mount: mount, coerce: coerce });
})();
