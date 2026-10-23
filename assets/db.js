// 데이터베이스 화면과 인라인 셀 편집. db-model.js · db-formula.js 를 먼저 읽어야 한다.
// 마운트 하나당 인스턴스 하나: 모든 상태는 createInstance 클로저 안에만 있다.
// DoriDB.load(slug, { initial, mountId, titleInput }) -> Promise<database payload>.
// initial is GET /api/db/<slug>'s object (or GET /api/page/<slug>.database).
// A valid initial wins; otherwise use a matching .acard-db-boot, then GET.
// DoriDB.loadRow(slug, rowId, mountId, { initial }) uses the same contract.
// DoriDB.reload(mountId) always GETs; mountAll() mounts newly replaced reader nodes.
(function () {
  "use strict";
  // Network seam (open-notion-acard #1): a host page can set window.AcardEditorProvider = { fetch(url, options) } before
  // this script loads to route the editor's requests elsewhere. Without it every call is the browser fetch to /api.
  function net(url, options) {
    var provider = window.AcardEditorProvider;
    return provider && typeof provider.fetch === "function" ? provider.fetch(url, options) : fetch(url, options);
  }

  var MODEL = window.DoriDBModel || {};
  var VIEWS = window.DoriDBViews || {};
  var NUMBER_FORMATS = MODEL.NUMBER_FORMATS || [{ id: "number", label: "숫자" }, { id: "percent", label: "퍼센트" }];
  var NUMBER_DISPLAYS = MODEL.NUMBER_DISPLAYS || [{ id: "number", label: "숫자" }, { id: "bar", label: "막대" }, { id: "ring", label: "링" }];
  var registry = {};
  var lastMount = null;

  function api(path, options) {
    return net("/api" + path, Object.assign({ headers: { "content-type": "application/json" } }, options || {})).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || String(res.status));
        return body;
      });
    });
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key === "style") node.setAttribute("style", value);
        else if (key === "dataset") Object.keys(value).forEach(function (name) { node.dataset[name] = value[name]; });
        else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value === true ? "" : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function icon(name) {
    var glyphs = {
      table: "▦", board: "▤", gallery: "▥", list: "☰", calendar: "▦", timeline: "▭",
      filter: "⌥", sort: "↕", group: "⊞", search: "⌕", settings: "⚙", plus: "+",
      trash: "✕", copy: "⧉", open: "↗", eye: "◉", eyeOff: "◌", chevron: "▾", grip: "⋮⋮"
    };
    return glyphs[name] || "";
  }

  // file/url 셀 전용. javascript:, data:text/html 등은 거부하고 http(s)·mailto·tel·상대경로·data:image(svg 제외)만 허용.
  function safeUrl(raw, allowMail) {
    var text = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!text) return "";
    if (/[\u0000-\u001f]/.test(text)) return null;
    var probe = text.replace(/[\s\u0000-\u001f]/g, "");
    var match = /^([a-z][a-z0-9+.\-]*):/i.exec(probe);
    if (!match) return text;
    var scheme = match[1].toLowerCase();
    if (scheme === "http" || scheme === "https") return text;
    if (allowMail && (scheme === "mailto" || scheme === "tel")) return text;
    if (scheme === "data" && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(probe)) return text;
    return null;
  }

  function pageUrl(slug) {
    return String(slug).split("/").map(encodeURIComponent).join("/");
  }

  function validInitial(data, slug) {
    return data && data.database && data.database.slug === slug &&
      ["properties", "rows", "views", "templates"].every(function (key) { return Array.isArray(data[key]); });
  }

  function bootData(slug) {
    var tags = document.querySelectorAll('script.acard-db-boot[type="application/json"]');
    for (var i = 0; i < tags.length; i += 1) {
      if (tags[i].dataset.slug !== slug) continue;
      try {
        var data = JSON.parse(tags[i].textContent);
        if (validInitial(data, slug)) return data;
      } catch (_) { /* An invalid bootstrap falls back to the API. */ }
    }
    return null;
  }

  function createInstance(slug, opts) {
    var mountNode = document.getElementById(opts.mountId || "db-root");
    var reader = !!(mountNode && mountNode.matches(".reader .dbbrowser"));
    var readerTemplate = reader && mountNode.querySelector(".db-reader-assets").cloneNode(true);
    var readerAssets = reader && readerTemplate.content;
    function readerIcon(name) {
      var source = readerAssets && readerAssets.querySelector('[data-table-icon="' + name + '"]');
      return source ? source.firstChild.cloneNode(true) : el("span", { text: icon(name) });
    }
    function isComplete(row) {
      var prop = state.properties.find(function (entry) { return entry.type === "status"; });
      var option = prop && MODEL.optionById(prop, values(row)[prop.id]);
      return option && option.name === "완료";
    }
    var state = {
      slug: slug,
      mountId: opts.mountId || "db-root",
      titleInput: opts.titleInput || null,
      rowId: opts.rowId || null,
      statusNode: null,
      bodyNode: null,
      database: null,
      properties: [],
      rows: [],
      views: [],
      templates: [],
      viewId: null,
      query: "",
      relationTitles: {},
      collapsed: null,
    };
    var base = "/db/" + encodeURIComponent(slug);

    function applyData(data) {
      state.database = data.database;
      state.properties = (data.properties || []).map(function (prop, index) { return { prop: prop, index: index }; })
        .sort(function (a, b) { return ((a.prop.ord || 0) - (b.prop.ord || 0)) || (a.index - b.index); })
        .map(function (entry) { return entry.prop; });
      state.rows = data.rows || [];
      state.views = data.views || [];
      state.templates = data.templates || [];
      if (reader && !state.viewId) {
        var wanted = new URLSearchParams(location.search).get("view");
        var pick = wanted && state.views.find(function (view) { return view.id === wanted || view.type === wanted; });
        if (pick) state.viewId = pick.id;
      }
      if (!state.views.some(function (view) { return view.id === state.viewId; })) state.viewId = (state.views[0] || {}).id;
    }

    function values(row) {
      var out = {};
      var computed = row.computed || {};
      state.properties.forEach(function (prop) {
        out[prop.id] = prop.type === "title" ? (row.pageTitle || "")
          : (computed[prop.id] !== undefined ? computed[prop.id] : (row.props || {})[prop.id]);
      });
      return out;
    }

    function currentView() {
      return state.views.find(function (view) { return view.id === state.viewId; }) || state.views[0];
    }

    function visibleProps() {
      return MODEL.visibleProperties(state.properties, currentView());
    }

    function filteredRows() {
      var view = currentView();
      var query = (state.query || "").trim().toLowerCase();
      var rows = state.rows.filter(function (row) {
        if (query) {
          var hit = state.properties.some(function (prop) {
            return String(MODEL.displayValue(prop, values(row)[prop.id], { relative: false })).toLowerCase().indexOf(query) >= 0;
          });
          if (!hit) return false;
        }
        return MODEL.matchesFilter(state.properties, values(row), view.config.filter);
      });
      return MODEL.sortRows(state.properties, rows, view.config.sorts, values);
    }

    function subitems() {
      var sub = state.database && state.database.config && state.database.config.subitems;
      if (!sub) return null;
      var parent = state.properties.find(function (prop) { return prop.id === sub.parent; });
      var children = state.properties.find(function (prop) { return prop.id === sub.children; });
      return parent && children ? { parent: parent, children: children } : null;
    }

    function collapsedSet() {
      if (state.collapsed) return state.collapsed;
      var saved = [];
      try { saved = JSON.parse(localStorage.getItem("acard-subitems-" + slug + "-" + (currentView().id || "")) || "[]"); } catch (error) { saved = []; }
      state.collapsed = new Set(Array.isArray(saved) ? saved : []);
      return state.collapsed;
    }

    function toggleCollapsed(rowId) {
      var set = collapsedSet();
      if (set.has(rowId)) set.delete(rowId); else set.add(rowId);
      try { localStorage.setItem("acard-subitems-" + slug + "-" + (currentView().id || ""), JSON.stringify(Array.from(set))); } catch (error) { /* 저장 공간이 없으면 이 탭에서만 유지 */ }
      paintBody();
    }

    // 표 뷰가 중첩일 때 [{row, depth, dim, hasChildren, collapsed}], 아니면 null.
    function nestedRows(rows) {
      var sub = subitems();
      var view = currentView();
      if (!sub || view.type !== "table" || view.config.subitems === "flat" || view.config.group_by) return null;
      var parentOf = function (row) { var ids = (row.props || {})[sub.parent.id]; return Array.isArray(ids) && ids.length ? ids[0] : null; };
      return MODEL.nestRows(state.rows, rows, parentOf, collapsedSet());
    }

    function addSubitem(parentRow) {
      var sub = subitems();
      if (!sub) return Promise.resolve();
      var props = {}; props[sub.parent.id] = [parentRow.id];
      collapsedSet().delete(parentRow.id);
      return api(base + "/rows", { method: "POST", body: JSON.stringify({ props: props }) })
        .then(function () { return reloadWithStatus("하위 항목 추가됨"); })
        .catch(function (error) { setStatus("하위 항목 추가 실패: " + error.message, true); });
    }

    function switchSubitems(on) {
      return api(base, { method: "PATCH", body: JSON.stringify({ subitems: on }) })
        .then(function () { return reloadWithStatus(on ? "하위 항목 켜짐" : "하위 항목 꺼짐"); })
        .catch(function (error) { setStatus("하위 항목 설정 실패: " + error.message, true); });
    }

    function setStatus(text, bad) {
      var node = state.statusNode;
      if (!node) return;
      node.textContent = text || "";
      node.classList.toggle("bad", !!bad);
    }

    // 뷰 저장 실패 시 설정을 되돌리고 오류를 보여 준다. 항상 resolve(ok 여부).
    function saveView(patch) {
      var view = currentView();
      var previous = view.config;
      view.config = Object.assign({}, previous, patch || {});
      return api(base + "/views/" + encodeURIComponent(view.id), {
        method: "PATCH",
        body: JSON.stringify({ config: view.config }),
      }).then(function () { return true; }, function (error) {
        view.config = previous;
        setStatus("뷰 저장 실패: " + error.message, true);
        return false;
      });
    }

    function loadRelationTitles(initial) {
      var targets = [];
      state.properties.forEach(function (prop) {
        if (prop.type === "relation" && prop.config && prop.config.database && targets.indexOf(prop.config.database) < 0) targets.push(prop.config.database);
      });
      var changed = false;
      var failure = null;
      return Promise.all(targets.map(function (target) {
        var seed = initial && (target === slug || target === state.database.id ? { rows: state.rows } : bootData(target));
        return (seed ? Promise.resolve(seed) : api("/db/" + encodeURIComponent(target))).then(function (data) {
          data.rows.forEach(function (entry) {
            var title = entry.pageTitle || entry.id;
            if (state.relationTitles[entry.id] !== title) { state.relationTitles[entry.id] = title; changed = true; }
          });
        }, function (error) { failure = error; });
      })).then(function () {
        if (changed) render();
        if (failure) setStatus("연결된 DB 제목을 불러오지 못했어요: " + failure.message, true);
      });
    }

    function reload(then) {
      return api(base).then(function (data) {
        applyData(data);
        render();
        if (then) then();
        return loadRelationTitles();
      }).catch(function (error) { setStatus("불러오기 실패: " + error.message, true); });
    }

    function reloadWithStatus(text, bad) {
      return reload().then(function () { setStatus(text, bad); });
    }

    function patchRow(rowId, props) {
      return api(base + "/rows/" + encodeURIComponent(rowId), {
        method: "PATCH",
        body: JSON.stringify({ props: props }),
      });
    }

    // 실패하면 렌더하지 않아 편집 중인 입력값이 남는다.
    function setCell(rowId, propId, value) {
      var payload = {};
      payload[propId] = value;
      return patchRow(rowId, payload).then(function () {
        if (reader) document.getElementById("db-pop")?.remove();
        return reloadWithStatus("저장됨");
      }, function (error) { setStatus("저장 실패: " + error.message, true); });
    }

    function setProp(propId, patch) {
      return api(base + "/properties/" + encodeURIComponent(propId), {
        method: "PATCH",
        body: JSON.stringify(patch),
      }).then(function (body) {
        return reloadWithStatus("속성 저장됨" + (body.unlinked ? " · 예전 값 보관 " + body.unlinked : "")).then(function () { return true; });
      }, function (error) { setStatus("속성 저장 실패: " + error.message, true); return false; });
    }

    function addProperty(afterId) {
      var prop = { name: "새 속성", type: "text" };
      if (afterId) {
        var index = state.properties.findIndex(function (entry) { return entry.id === afterId; });
        if (index >= 0) prop.ord = state.properties[index].ord + 5;
      }
      return api(base + "/properties", { method: "POST", body: JSON.stringify(prop) })
        .then(function () { return reload(); })
        .catch(function (error) { setStatus("속성 추가 실패: " + error.message, true); });
    }

    function moveColumn(prop, delta) {
      var columns = visibleProps();
      var at = columns.indexOf(prop);
      var other = columns[at + delta];
      if (at < 0 || !other) return Promise.resolve();
      var order = state.properties.slice();
      order.splice(order.indexOf(prop), 1);
      order.splice(order.indexOf(other) + (delta > 0 ? 1 : 0), 0, prop);
      var changes = [];
      order.forEach(function (entry, index) {
        if (entry.ord !== index * 10) changes.push({ id: entry.id, ord: index * 10 });
      });
      var failed = null;
      return Promise.all(changes.map(function (change) {
        return api(base + "/properties/" + encodeURIComponent(change.id), { method: "PATCH", body: JSON.stringify({ ord: change.ord }) })
          .catch(function (error) { failed = error; });
      })).then(function () {
        return failed ? reloadWithStatus("열 순서 저장 실패: " + failed.message, true) : reloadWithStatus("열 순서 저장됨");
      });
    }

    function addRow(templateId) {
      var defaults = {};
      if (slug === "board") state.properties.forEach(function (prop) {
        var label = ({ 담당자: "AI", 상태: "진행 중", 우선순위: "보통" })[prop.name];
        var option = label && (prop.config.options || []).find(function (entry) { return entry.name === label; });
        if (option) defaults[prop.id] = option.id;
        if (prop.type === "title") defaults[prop.id] = "새 작업";
        if (prop.type === "number" && prop.name === "진행률") defaults[prop.id] = 0;
      });
      return api(base + "/rows", {
        method: "POST",
        body: JSON.stringify(templateId ? { template: templateId } : { props: defaults }),
      }).then(function (data) {
        return reload(function () {
          if (data && data.row) {
            if (!reader) openRow(data.row.id);
            else {
              var input = document.querySelector('[data-row="' + data.row.id + '"] .dbtitle');
              if (input) { input.focus(); input.select(); }
            }
          }
        });
      }).catch(function (error) { setStatus("행 추가 실패: " + error.message, true); });
    }

    function openRow(rowId) {
      var row = state.rows.find(function (entry) { return entry.id === rowId; });
      if (row && row.page) location.href = "/edit/" + encodeURIComponent(row.page) + "/";
    }

    function menu(anchor, title, items) {
      var existing = document.getElementById("db-menu");
      if (existing) existing.remove();
      var box = el("div", { class: "dbmenu", id: "db-menu" });
      box.appendChild(el("h4", { text: title }));
      items.forEach(function (item) {
        if (!item) return;
        if (item.separator) { box.appendChild(el("hr")); return; }
        var button = el("button", { type: "button", class: item.on ? "on" : "" }, [
          el("span", { class: "ico", text: item.ico || "" }),
          el("span", { text: item.label }),
        ]);
        if (item.aria) button.setAttribute("aria-label", item.aria);
        button.addEventListener("click", function (ev) {
          ev.preventDefault();
          box.remove();
          item.run();
        });
        box.appendChild(button);
      });
      document.body.appendChild(box);
      var rect = anchor.getBoundingClientRect();
      box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 12)) + "px";
      box.style.top = Math.min(rect.bottom + 4, window.innerHeight - box.offsetHeight - 12) + "px";
      setTimeout(function () {
        document.addEventListener("click", function close(ev) {
          if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("click", close); }
        });
      }, 0);
    }

    function popover(anchor, content) {
      var existing = document.getElementById("db-pop");
      if (existing) existing.remove();
      var box = el("div", { class: "dbpop", id: "db-pop" }, [content]);
      document.body.appendChild(box);
      var rect = anchor.getBoundingClientRect();
      box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 12)) + "px";
      box.style.top = Math.min(rect.bottom + 4, window.innerHeight - box.offsetHeight - 12) + "px";
      setTimeout(function () {
        document.addEventListener("click", function close(ev) {
          if (!box.contains(ev.target) && ev.target !== anchor) { box.remove(); document.removeEventListener("click", close); }
        });
      }, 0);
      return box;
    }

    function optionSelect(prop, row, value, onPick) {
      var box = el("div", { class: "dboptbox" });
      var search = el("input", { class: "dboptsearch", placeholder: "옵션 찾기", type: "text" });
      var list = el("div", { class: "dboptlist" });
      var options = (prop.config.options || []).slice();
      function paint() {
        var query = search.value.trim().toLowerCase();
        list.innerHTML = "";
        options.filter(function (option) { return !query || option.name.toLowerCase().indexOf(query) >= 0; }).forEach(function (option) {
          var on = Array.isArray(value) ? value.indexOf(option.id) >= 0 : value === option.id;
          var button = el("button", { type: "button", class: "dbopt" + (on ? " on" : "") }, [
            el("span", { class: "tag " + option.color + (/결정/.test(option.name) ? " decide" : ""), text: option.name }),
          ]);
          button.addEventListener("click", function (ev) {
            ev.preventDefault();
            if (Array.isArray(value)) {
              var next = value.slice();
              var at = next.indexOf(option.id);
              if (at >= 0) next.splice(at, 1); else next.push(option.id);
              value = next;
              onPick(next);
              paint();
            } else {
              box.remove();
              onPick(option.id);
            }
          });
          list.appendChild(button);
        });
      }
      search.addEventListener("input", paint);
      search.addEventListener("keydown", function (ev) { if (ev.key === "Escape") box.remove(); });
      box.appendChild(search);
      box.appendChild(list);
      var create = el("input", { class: "dboptnew", placeholder: "새 옵션 만들고 Enter", type: "text" });
      create.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        var name = create.value.trim();
        if (!name) return;
        var next = (prop.config.options || []).concat([{ id: "o" + Date.now().toString(36), name: name, color: "blue" }]);
        setProp(prop.id, { config: Object.assign({}, prop.config, { options: next }) }).then(function (ok) {
          if (!ok) return;
          var created = next[next.length - 1];
          onPick(Array.isArray(value) ? value.concat([created.id]) : created.id);
        });
      });
      if (!(slug === "board" && prop.name === "담당자")) box.appendChild(create);
      paint();
      return box;
    }

    // 숫자 서식·표시 방식(숫자/막대/링). 막대·링의 눈금은 percent 서식이면 0~1, 아니면 0~max(기본 100).
    function numberVisual(prop, value) {
      var config = prop.config || {};
      if (value === null || value === undefined || value === "") return null;
      var num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num)) return null;
      var display = config.display || "number";
      var format = config.number_format || "number";
      if (display === "number" && format === "number") return null;
      var text = MODEL.formatNumber(value, config);
      var wrap = el("span", { class: "numwrap" });
      if (display === "bar" || display === "ring") {
        var max = Number(config.max);
        var fraction = isFinite(max) && max > 0 ? num / max : (format === "percent" ? num : num / 100);
        var pct = Math.max(0, Math.min(100, Math.round(fraction * 10000) / 100));
        if (display === "bar") {
          wrap.appendChild(el("span", { class: "numbartrack" }, [el("span", { class: "numbar", style: "width:" + pct + "%" })]));
        } else {
          wrap.appendChild(el("span", { class: "numring", style: "background:conic-gradient(var(--accent) " + pct + "%, var(--line) 0)" }, [el("span", { class: "numringhole" })]));
        }
      }
      wrap.appendChild(el("span", { class: "numtext", text: text }));
      return wrap;
    }

    function titleDecor(wrap, row) {
      wrap.appendChild(el("span", { class: "rowicon" + (row.icon ? "" : " docicon"), "aria-hidden": "true", text: row.icon || "📄" }));
      if (row.page && !state.rowId) {
        var open = el("button", { type: "button", class: "dbopen", text: icon("open"), "aria-label": "페이지로 열기", title: "페이지로 열기" });
        open.addEventListener("click", function (ev) { ev.preventDefault(); openRow(row.id); });
        wrap.appendChild(open);
      }
    }

    function richSpan(value, className) {
      var out = el("span", { class: className });
      MODEL.richValue(value).forEach(function (seg) {
        out.appendChild(seg.classes.length ? el("span", { class: seg.classes.join(" "), text: seg.text }) : document.createTextNode(seg.text));
      });
      return out;
    }

    function cellEditor(prop, row) {
      var value = values(row)[prop.id];
      var wrap = el("div", { class: "dbcell c-" + prop.type });
      var fxError = prop.type === "formula" && row.errors ? row.errors[prop.id] : "";
      if (fxError && (value === null || value === undefined || value === "")) {
        wrap.appendChild(el("span", { class: "fxerror", title: fxError, text: fxError }));
        return wrap;
      }
      if (prop.type === "formula" && MODEL.isRichValue(value)) {
        wrap.appendChild(richSpan(value, "dbro"));
        return wrap;
      }
      if (prop.type === "formula" || prop.type === "rollup" || prop.type === "created_time" || prop.type === "updated_time" || prop.type === "unique_id") {
        wrap.appendChild(el("span", { class: "dbro", text: MODEL.displayValue(prop, value) }));
        return wrap;
      }
      if (prop.type === "button") {
        wrap.appendChild(buttonCell(prop, row));
        return wrap;
      }
      if (prop.type === "checkbox") {
        var box = el("button", { type: "button", class: "check" + (value === true ? " on" : ""), "aria-label": "체크", text: value === true ? "✓" : "" });
        box.addEventListener("click", function () { setCell(row.id, prop.id, value !== true); });
        wrap.appendChild(box);
        return wrap;
      }
      if (prop.type === "select" || prop.type === "status" || prop.type === "multi_select") {
        var multi = prop.type === "multi_select";
        var shown = multi ? (Array.isArray(value) ? value : []) : value;
        var button = el("button", { type: "button", class: "dbtagbutton" });
        var paintTags = function () {
          button.innerHTML = "";
          var ids = multi ? shown : (shown ? [shown] : []);
          if (!ids.length) button.appendChild(el("span", { class: "dbempty2", text: "비어 있음" }));
          ids.forEach(function (id) {
            var option = MODEL.optionById(prop, id);
            if (option) {
              var person = reader && prop.name === "담당자" && readerAssets.querySelector('[data-table-person="' + option.name + '"]');
              button.appendChild(person ? person.firstChild.cloneNode(true) : el("span", { class: "tag " + option.color + (prop.type === "status" ? " table-status" : "") + (/결정/.test(option.name) ? " decide" : ""), text: option.name }));
            }
          });
        };
        paintTags();
        button.addEventListener("click", function () {
          var pop = popover(button, optionSelect(prop, row, shown, function (next) {
            shown = next;
            if (multi) paintTags();
            setCell(row.id, prop.id, next);
          }));
          pop.querySelector("input").focus();
        });
        wrap.appendChild(button);
        return wrap;
      }
      if (prop.type === "date") {
        var start = el("input", { type: "date", class: "dbinput dbdatestart", "aria-label": "시작일", value: value && value.start ? value.start.slice(0, 10) : "" });
        var end = el("input", { type: "date", class: "dbinput dbdateend", "aria-label": "종료일", value: value && value.end ? value.end.slice(0, 10) : "" });
        var commitDate = function () {
          if (!start.value) {
            if (end.value) { setStatus("시작일을 먼저 골라 주세요.", true); return; }
            setCell(row.id, prop.id, null);
            return;
          }
          if (end.value && end.value < start.value) { setStatus("종료일이 시작일보다 빠를 수 없어요.", true); return; }
          setCell(row.id, prop.id, { start: start.value, end: end.value || null });
        };
        start.addEventListener("change", commitDate);
        end.addEventListener("change", commitDate);
        if (reader) {
          var dateButton = el("button", { type: "button", class: "dbdatebutton", "aria-label": prop.name + " 편집", text: value && value.start ? value.start.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, function (_, y, m, d) { return y + "년 " + Number(m) + "월 " + Number(d) + "일"; }) : (prop.name === "마감일" ? "마감일 없음" : "날짜 없음") });
          if (!(value && value.start)) dateButton.classList.add("dbnodate");
          dateButton.addEventListener("click", function () { popover(dateButton, start); start.focus(); });
          wrap.appendChild(dateButton);
          return wrap;
        }
        wrap.appendChild(start);
        wrap.appendChild(el("span", { class: "dbdatesep", text: "→" }));
        wrap.appendChild(end);
        return wrap;
      }
      if (prop.type === "files") {
        var files = Array.isArray(value) ? value : [];
        files.forEach(function (file) {
          var url = safeUrl(file.url, false);
          var isImage = url && (/^image\//.test(file.type || "") || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url) || /^data:image\//i.test(url));
          var item = el("span", { class: "dbfile" }, [
            isImage ? el("img", Object.assign({ src: url, alt: file.name || "" }, VIEWS.imageAttributes(file, url))) : el("span", { class: "dbdoc", text: "📄" }),
          ]);
          var remove = el("button", { type: "button", class: "dbfiledel", text: "✕", "aria-label": "파일 지우기" });
          remove.addEventListener("click", function () {
            setCell(row.id, prop.id, files.filter(function (entry) { return entry !== file; }));
          });
          item.appendChild(remove);
          wrap.appendChild(item);
        });
        var addFile = el("button", { type: "button", class: "dbaddfile", text: "+", "aria-label": "파일 추가" });
        addFile.addEventListener("click", function () {
          var pop = popover(addFile, el("div", { class: "dbaddbox" }, [
            el("input", { class: "dburl", placeholder: "이미지·파일 주소(URL)", type: "text" }),
            el("input", { class: "dbname", placeholder: "이름(선택)", type: "text" }),
          ]));
          var url = pop.querySelector(".dburl");
          var name = pop.querySelector(".dbname");
          url.focus();
          var commit = function () {
            var raw = url.value.trim();
            if (!raw) return;
            var safe = safeUrl(raw, false);
            if (!safe) { setStatus("허용되지 않는 주소예요. http(s) 또는 상대 경로만 쓸 수 있어요.", true); return; }
            var entry = { name: name.value.trim() || raw.split("/").pop(), url: safe, type: /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(safe) ? "image/png" : "" };
            pop.remove();
            setCell(row.id, prop.id, files.concat([entry]));
          };
          url.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); commit(); } });
          name.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); commit(); } });
        });
        wrap.appendChild(addFile);
        return wrap;
      }
      if (prop.type === "person") {
        var people = Array.isArray(value) ? value : [];
        var personWrap = el("div", { class: "dbrelwrap dbpeople" });
        people.forEach(function (email) { personWrap.appendChild(personChip(email)); });
        var pick = el("button", { type: "button", class: "dbaddfile", text: "+", "aria-label": "사람 지정" });
        pick.addEventListener("click", function () { openPersonPicker(pick, prop, row, people); });
        personWrap.appendChild(pick);
        wrap.appendChild(personWrap);
        return wrap;
      }
      if (prop.type === "relation") {
        var ids = Array.isArray(value) ? value : [];
        var chipWrap = el("div", { class: "dbrelwrap" });
        ids.forEach(function (id) {
          chipWrap.appendChild(el("span", { class: "relchip", text: state.relationTitles[id] || id }));
        });
        var relButton = el("button", { type: "button", class: "dbaddfile", text: "+", "aria-label": "행 연결" });
        relButton.addEventListener("click", function () { openRelationPicker(relButton, prop, row, ids); });
        chipWrap.appendChild(relButton);
        wrap.appendChild(chipWrap);
        return wrap;
      }
      if (prop.type === "title") titleDecor(wrap, row);
      var textValue = value === null || value === undefined ? "" : String(value);
      var text = el("input", {
        class: "dbinput" + (prop.type === "title" ? " dbtitle" : ""),
        type: prop.type === "number" ? "number" : "text",
        step: prop.type === "number" ? "any" : null,
        value: textValue,
        "aria-label": prop.name + " 편집",
        min: slug === "board" && prop.name === "진행률" ? "0" : null,
        max: slug === "board" && prop.name === "진행률" ? "100" : null,
        placeholder: prop.type === "number" ? "" : (prop.type === "url" ? "https://" : prop.type === "email" ? "name@example.com" : prop.type === "phone" ? "010-0000-0000" : "비어 있음"),
      });
      var commitText = function () {
        if (text.value === textValue) return;
        if (!text.checkValidity()) { setStatus("진행률은 0부터 100까지 입력해 주세요.", true); return; }
        if (prop.type === "url" && text.value.trim() && !safeUrl(text.value, true)) {
          text.classList.add("bad");
          setStatus("허용되지 않는 주소예요. http(s) 주소만 쓸 수 있어요.", true);
          return;
        }
        text.classList.remove("bad");
        var next = prop.type === "number" ? (text.value === "" ? null : Number(text.value)) : text.value;
        textValue = text.value;
        setCell(row.id, prop.id, next);
      };
      text.addEventListener("blur", commitText);
      text.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); commitText(); text.blur(); }
        if (ev.key === "Escape") { text.value = textValue; text.blur(); }
      });
      wrap.appendChild(text);
      if (prop.type === "number") {
        var visual = numberVisual(prop, value);
        if (visual) {
          if (reader) {
            visual.classList.toggle("complete", !!isComplete(row));
            visual.querySelector(".numtext").textContent = textValue + (prop.name === "진행률" ? "%" : "");
            var numberButton = el("button", { type: "button", class: "dbnumberbutton", "aria-label": prop.name + " 편집" }, [visual]);
            text.remove();
            numberButton.addEventListener("click", function () { numberButton.replaceWith(text); text.focus(); text.select(); });
            wrap.appendChild(numberButton);
          } else wrap.appendChild(visual);
        }
      }
      if (prop.type === "url") {
        var href = safeUrl(textValue, true);
        if (href) wrap.appendChild(el("a", { class: "dbopen", href: href, target: "_blank", rel: "noopener noreferrer", text: icon("open"), "aria-label": "링크 열기" }));
      }
      return wrap;
    }

    function personChip(email) {
      return el("span", { class: "dbperson", title: email }, [el("span", { class: "dbavatar", text: MODEL.personInitial(email), "aria-hidden": "true" }), el("span", { class: "dbpersonname", text: email })]);
    }

    // 후보는 서버가 권한에 맞춰 준다(GET /api/db/<slug>/people). 목록 밖 이메일은 직접 넣을 수 없다.
    function openPersonPicker(anchor, prop, row, current) {
      api(base + "/people").then(function (data) {
        var chosen = current.slice();
        var search = el("input", { class: "dboptsearch", type: "search", placeholder: "사람 찾기", "aria-label": "사람 찾기" });
        var list = el("div", { class: "dboptlist" });
        var paint = function () {
          list.innerHTML = "";
          var q = search.value.trim().toLowerCase();
          var shown = (data.people || []).filter(function (entry) { return !q || entry.email.indexOf(q) >= 0; });
          if (!shown.length) list.appendChild(el("p", { class: "dbhint", text: "지정할 수 있는 사람이 없어요. 이 페이지를 공유하면 여기에 나와요." }));
          shown.forEach(function (entry) {
            var on = chosen.indexOf(entry.email) >= 0;
            var button = el("button", { type: "button", class: "dbopt dbpersonopt" + (on ? " on" : "") }, [personChip(entry.email), entry.owner ? el("span", { class: "dbhint", text: "소유자" }) : null]);
            button.dataset.email = entry.email;
            button.addEventListener("click", function () {
              var at = chosen.indexOf(entry.email);
              if (at >= 0) chosen.splice(at, 1); else if (prop.config.limit === 1) chosen = [entry.email]; else chosen.push(entry.email);
              list.querySelectorAll(".dbpersonopt").forEach(function (node) { node.classList.toggle("on", chosen.indexOf(node.dataset.email) >= 0); });
            });
            list.appendChild(button);
          });
        };
        search.addEventListener("input", paint);
        paint();
        var pop = popover(anchor, el("div", { class: "dboptbox" }, [el("h4", { text: "사람 지정" }), search, list]));
        var done = el("button", { type: "button", class: "dbprimary", text: "확인" });
        done.addEventListener("click", function () { pop.remove(); setCell(row.id, prop.id, chosen); });
        pop.appendChild(done);
        search.focus();
      }).catch(function (error) { setStatus("사람 목록 불러오기 실패: " + error.message, true); });
    }

    function openRelationPicker(anchor, prop, row, ids) {
      var targetSlug = prop.config.database;
      if (!targetSlug) {
        setStatus("관계 속성에 연결할 데이터베이스를 먼저 고르세요.", true);
        return;
      }
      api("/db/" + encodeURIComponent(targetSlug)).then(function (data) {
        var chosen = ids.slice();
        var list = el("div", { class: "dboptlist" });
        data.rows.forEach(function (entry) {
          var title = entry.pageTitle || entry.id;
          var on = chosen.indexOf(entry.id) >= 0;
          state.relationTitles[entry.id] = title;
          var button = el("button", { type: "button", class: "dbopt" + (on ? " on" : ""), text: title });
          button.addEventListener("click", function () {
            var at = chosen.indexOf(entry.id);
            if (at >= 0) chosen.splice(at, 1); else chosen.push(entry.id);
            button.classList.toggle("on");
          });
          list.appendChild(button);
        });
        var pop = popover(anchor, el("div", { class: "dboptbox" }, [el("h4", { text: "연결할 행 고르기" }), list]));
        var done = el("button", { type: "button", class: "dbprimary", text: "확인" });
        done.addEventListener("click", function () { pop.remove(); setCell(row.id, prop.id, chosen); });
        pop.appendChild(done);
      }).catch(function (error) { setStatus("관계 불러오기 실패: " + error.message, true); });
    }

    function columnMenu(anchor, prop, index) {
      var view = currentView();
      var sort = (view.config.sorts || []).find(function (entry) { return entry.property === prop.id; });
      var columns = visibleProps();
      var at = columns.indexOf(prop);
      var items = [
        { label: "오름차순 정렬", ico: "↑", on: sort && sort.direction === "ascending", run: function () { saveView({ sorts: [{ property: prop.id, direction: "ascending" }] }).then(render); } },
        { label: "내림차순 정렬", ico: "↓", on: sort && sort.direction === "descending", run: function () { saveView({ sorts: [{ property: prop.id, direction: "descending" }] }).then(render); } },
        sort ? { label: "정렬 지우기", ico: "↕", run: function () { saveView({ sorts: (view.config.sorts || []).filter(function (entry) { return entry.property !== prop.id; }) }).then(render); } } : null,
        { separator: true },
        { label: "이름 바꾸기", ico: "✎", run: function () { renameProperty(anchor, prop); } },
        { label: "종류 바꾸기", ico: "⇄", run: function () { typeMenu(anchor, prop); } },
        at > 0 ? { label: "왼쪽으로 옮기기", ico: "←", run: function () { moveColumn(prop, -1); } } : null,
        at >= 0 && at < columns.length - 1 ? { label: "오른쪽으로 옮기기", ico: "→", run: function () { moveColumn(prop, 1); } } : null,
        { label: "왼쪽에 속성 추가", ico: "+", run: function () { addProperty(index > 0 ? state.properties[index - 1].id : null); } },
        { label: "오른쪽에 속성 추가", ico: "+", run: function () { addProperty(prop.id); } },
        { separator: true },
        { label: "이 열 숨기기", ico: "◌", run: function () {
          var visible = (Array.isArray(view.config.visible) ? view.config.visible : state.properties.map(function (entry) { return entry.id; }))
            .filter(function (id) { return id !== prop.id; });
          saveView({ visible: visible }).then(render);
        } },
        { label: "속성 지우기", ico: "✕", run: function () {
          if (!window.confirm(prop.name + " 속성을 지울까요? 값도 함께 사라져요.")) return;
          api(base + "/properties/" + encodeURIComponent(prop.id), { method: "DELETE" })
            .then(function () { return reload(); })
            .catch(function (error) { setStatus("속성 삭제 실패: " + error.message, true); });
        } },
      ];
      if (prop.type === "number") items.push({ separator: true }, { label: "숫자 서식·표시", ico: "#", run: function () { numberEditor(anchor, prop); } });
      if (prop.type === "formula") items.push({ separator: true }, { label: "수식 편집", ico: "ƒ", run: function () { formulaEditor(anchor, prop); } });
      if (prop.type === "rollup") items.push({ separator: true }, { label: "롤업 설정", ico: "∑", run: function () { rollupEditor(anchor, prop); } });
      if (prop.type === "relation") items.push({ separator: true }, { label: "연결 DB 고르기", ico: "⇢", run: function () { relationEditor(anchor, prop); } });
      if (prop.type === "unique_id") items.push({ separator: true }, { label: "ID 접두어", ico: "#", run: function () { prefixEditor(anchor, prop); } });
      if (prop.type === "button") items.push({ separator: true }, { label: "버튼 동작", ico: "▶", run: function () { buttonEditor(anchor, prop); } });
      menu(anchor, prop.name, items);
    }

    function buttonCell(prop, row) {
      var b = el("button", { type: "button", class: "dbbtn", text: (prop.config.icon ? prop.config.icon + " " : "") + (prop.config.label || prop.name) });
      b.disabled = !prop.config.actions.length || document.body.dataset.readonly == "1";
      b.onclick = function (ev) {
        ev.stopPropagation();
        chunk("buttons", "__BUTTONS_JS__", "__BUTTONS_CSS__").then(function () { return AcardButtons.pressCell(slug, row.id, prop, b); }).then(function (d) { if (d && !d.open) reload(); });
      };
      return b;
    }

    function buttonEditor(anchor, prop) {
      chunk("button-editor", "__BUTTON_EDITOR_JS__", "__BUTTON_EDITOR_CSS__").then(function () { AcardButtonEditor.property(anchor, prop, state.properties, setProp); });
    }

    function prefixEditor(anchor, prop) {
      var input = el("input", { class: "dburl", value: (prop.config && prop.config.prefix) || "", placeholder: "예: TASK-", maxlength: "20" });
      var wrap = el("div", { class: "dbaddbox" }, [el("label", { class: "dblabel", text: "번호 앞에 붙일 글자" }), input]);
      var box = popover(anchor, wrap);
      input.focus();
      var save = el("button", { type: "button", class: "dbprimary", text: "저장" });
      save.addEventListener("click", function () {
        box.remove();
        setProp(prop.id, { config: Object.assign({}, prop.config, { prefix: input.value }) });
      });
      box.appendChild(save);
    }

    function renameProperty(anchor, prop) {
      var input = el("input", { class: "dbrename", value: prop.name });
      var box = popover(anchor, input);
      input.focus();
      input.select();
      var done = false;
      function commit() {
        if (done) return;
        done = true;
        var name = input.value.trim();
        box.remove();
        if (!name || name === prop.name) return;
        setProp(prop.id, { name: name });
      }
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        if (ev.key === "Escape") { done = true; box.remove(); }
      });
    }

    function typeMenu(anchor, prop) {
      menu(anchor, "종류 바꾸기", MODEL.PROPERTY_TYPES.map(function (entry) {
        return {
          label: entry.label, ico: entry.type === prop.type ? "✓" : "", on: entry.type === prop.type,
          run: function () { setProp(prop.id, { type: entry.type, config: MODEL.defaultConfig(entry.type) }); },
        };
      }));
    }

    function numberEditor(anchor, prop) {
      var config = prop.config || {};
      var wrap = el("div", { class: "dbaddbox" });
      var formatSelect = el("select", { class: "dbselect" });
      NUMBER_FORMATS.forEach(function (entry) {
        formatSelect.appendChild(el("option", { value: entry.id, text: entry.label, selected: entry.id === (config.number_format || "number") }));
      });
      var displaySelect = el("select", { class: "dbselect" });
      NUMBER_DISPLAYS.forEach(function (entry) {
        displaySelect.appendChild(el("option", { value: entry.id, text: entry.label, selected: entry.id === (config.display || "number") }));
      });
      var maxInput = el("input", { class: "dburl", type: "number", step: "any", min: "0", placeholder: "비워 두면 기본 눈금", value: config.max === undefined || config.max === null ? "" : String(config.max) });
      wrap.appendChild(el("label", { class: "dblabel", text: "서식" }));
      wrap.appendChild(formatSelect);
      wrap.appendChild(el("label", { class: "dblabel", text: "표시 방식" }));
      wrap.appendChild(displaySelect);
      wrap.appendChild(el("label", { class: "dblabel", text: "막대·링 최댓값 (percent 는 1, 그 외 100)" }));
      wrap.appendChild(maxInput);
      var box = popover(anchor, wrap);
      var save = el("button", { type: "button", class: "dbprimary", text: "저장" });
      save.addEventListener("click", function () {
        var next = Object.assign({}, config, { number_format: formatSelect.value, display: displaySelect.value });
        var max = maxInput.value.trim();
        if (max !== "" && !(Number(max) > 0)) { setStatus("최댓값은 0보다 커야 해요.", true); return; }
        if (max === "") delete next.max; else next.max = Number(max);
        box.remove();
        setProp(prop.id, { config: next });
      });
      box.appendChild(save);
    }

    function formulaEditor(anchor, prop) {
      var examples = el("div", { class: "dbhint dbformulaexamples" }, [el("span", { text: "예:" })]);
      (MODEL.FORMULA_EXAMPLES || []).forEach(function (example) { examples.appendChild(el("code", { text: example })); });
      var wrap = el("div", { class: "dbaddbox" }, [examples]);
      var input = el("input", { class: "dburl", value: prop.config.expression || "", placeholder: "수식" });
      var preview = el("p", { class: "dbhint" });
      wrap.appendChild(input);
      wrap.appendChild(preview);
      var box = popover(anchor, wrap);
      input.focus();
      var done = false;
      // Parse errors first; then a preview on the first row's values (its relations stay as loaded, so a list
      // lambda over a relation is checked for syntax here and computed by the server on save).
      function paint() {
        var F = window.DoriFormula;
        var error = F ? F.formulaError(input.value) : null;
        if (!error && F && F.evaluateFormulaDetailed && state.rows.length) {
          var row0 = state.rows[0];
          var vals = values(row0);
          var find = function (key) { return state.properties.find(function (entry) { return entry.id === key || entry.name === key; }); };
          var ctx = {
            get: function (key) { var found = find(key); return found ? vals[found.id] : null; },
            has: function (key) { return !!find(key); },
            typeOf: function (key) { var found = find(key); return found ? found.type : "text"; },
            now: Date.now(),
          };
          error = F.evaluateFormulaDetailed(input.value, ctx).error;
        }
        preview.textContent = error ? "오류: " + error : "수식이 올바릅니다.";
        preview.classList.toggle("bad", !!error);
      }
      input.addEventListener("input", paint);
      paint();
      // A formula that does not parse is never saved: Enter keeps the box open on its error, leaving the box keeps
      // the formula that was there. An evaluation error (one row's data) still saves and shows in that row's cell.
      function parses() {
        return !(window.DoriFormula && window.DoriFormula.formulaError(input.value));
      }
      function commit() {
        if (done) return;
        done = true;
        box.remove();
        if (parses()) setProp(prop.id, { config: Object.assign({}, prop.config, { expression: input.value }) });
      }
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        if (parses()) commit();
        else paint();
      });
    }

    function rollupEditor(anchor, prop) {
      var relationProps = state.properties.filter(function (entry) { return entry.type === "relation"; });
      var wrap = el("div", { class: "dbaddbox" });
      var relSelect = el("select", { class: "dbselect" });
      relationProps.forEach(function (entry) {
        relSelect.appendChild(el("option", { value: entry.id, text: entry.name, selected: entry.id === prop.config.relation_property }));
      });
      var targetSelect = el("select", { class: "dbselect" });
      var fnSelect = el("select", { class: "dbselect" });
      MODEL.ROLLUP_FUNCTIONS.forEach(function (entry) {
        fnSelect.appendChild(el("option", { value: entry.id, text: entry.label, selected: entry.id === prop.config.function }));
      });
      function loadTargets() {
        targetSelect.innerHTML = "";
        var relProp = relationProps.find(function (entry) { return entry.id === relSelect.value; });
        if (!relProp || !relProp.config.database) return;
        api("/db/" + encodeURIComponent(relProp.config.database)).then(function (data) {
          data.properties.forEach(function (entry) {
            targetSelect.appendChild(el("option", { value: entry.id, text: entry.name, selected: entry.id === prop.config.target_property }));
          });
        }).catch(function (error) { setStatus("대상 속성 불러오기 실패: " + error.message, true); });
      }
      relSelect.addEventListener("change", loadTargets);
      loadTargets();
      wrap.appendChild(el("label", { class: "dblabel", text: "관계 속성" }));
      wrap.appendChild(relSelect);
      wrap.appendChild(el("label", { class: "dblabel", text: "가져올 속성" }));
      wrap.appendChild(targetSelect);
      wrap.appendChild(el("label", { class: "dblabel", text: "계산" }));
      wrap.appendChild(fnSelect);
      var box = popover(anchor, wrap);
      var save = el("button", { type: "button", class: "dbprimary", text: "저장" });
      save.addEventListener("click", function () {
        box.remove();
        setProp(prop.id, { config: { relation_property: relSelect.value, target_property: targetSelect.value, function: fnSelect.value } });
      });
      box.appendChild(save);
    }

    function relationEditor(anchor, prop) {
      var wrap = el("div", { class: "dbaddbox" });
      var input = el("input", { class: "dburl", value: prop.config.database || "", placeholder: "연결할 데이터베이스 슬러그" });
      wrap.appendChild(el("label", { class: "dblabel", text: "데이터베이스 슬러그" }));
      wrap.appendChild(input);
      var list = el("div", { class: "dboptlist" });
      api("/db/list").then(function (data) {
        (data.databases || []).forEach(function (entry) {
          var button = el("button", { type: "button", class: "dbopt", text: entry.title + " (" + entry.slug + ")" });
          button.addEventListener("click", function () { input.value = entry.slug; });
          list.appendChild(button);
        });
      }).catch(function (error) { setStatus("데이터베이스 목록 불러오기 실패: " + error.message, true); });
      var wasSynced = !!(prop.config.synced && prop.config.pair);
      var synced = el("input", { type: "checkbox", class: "dbrelsync", "aria-label": "상대 DB에도 표시" });
      synced.checked = wasSynced;
      wrap.appendChild(el("label", { class: "dbrecurday" }, [synced, el("span", { text: "상대 DB에도 표시" })]));
      var pairName = el("input", { class: "dbname dbrelpair", value: state.database ? state.database.title || "" : "", placeholder: "상대 DB에 생길 속성 이름", "aria-label": "상대 DB에 생길 속성 이름" });
      var pairLabel = el("label", { class: "dblabel", text: "상대 DB에 생길 속성 이름" });
      var showPair = function () { var on = synced.checked && !wasSynced; pairLabel.hidden = !on; pairName.hidden = !on; };
      synced.addEventListener("change", showPair);
      wrap.appendChild(pairLabel);
      wrap.appendChild(pairName);
      wrap.appendChild(list);
      showPair();
      var box = popover(anchor, wrap);
      var save = el("button", { type: "button", class: "dbprimary", text: "저장" });
      save.addEventListener("click", function () {
        var patch = { config: Object.assign({}, prop.config, { database: input.value.trim(), synced: synced.checked }) };
        if (synced.checked && !wasSynced) patch.pairName = pairName.value.trim();
        if (wasSynced && !synced.checked) patch.dropPair = window.confirm("상대 DB의 짝 속성도 지울까요? 취소를 누르면 짝 속성은 한쪽 방향 관계로 남아요.");
        box.remove();
        setProp(prop.id, patch);
      });
      box.appendChild(save);
    }

    function cardMenu(anchor, view, key) {
      var card = MODEL.normaliseCard(view.config.card || {});
      var set = function (patch) { saveView({ card: Object.assign({}, card, patch) }).then(render); };
      if (key === "preview") {
        var items = [
          { label: "없음", on: card.preview === "none", run: function () { set({ preview: "none" }); } },
          { label: "페이지 커버", on: card.preview === "page_cover", run: function () { set({ preview: "page_cover" }); } },
          { label: "페이지 첫 이미지", on: card.preview === "page_content", run: function () { set({ preview: "page_content" }); } },
        ];
        state.properties.filter(function (prop) { return prop.type === "files"; }).forEach(function (prop) {
          items.push({ label: prop.name, on: card.preview === "property" && card.property === prop.id, run: function () { set({ preview: "property", property: prop.id }); } });
        });
        items.forEach(function (item) { item.ico = item.on ? "✓" : ""; });
        menu(anchor, "카드 미리보기", items);
        return;
      }
      if (key === "size") {
        menu(anchor, "카드 크기", [["s", "작게"], ["m", "중간"], ["l", "크게"]].map(function (pair) {
          return { label: pair[1], ico: card.size === pair[0] ? "✓" : "", on: card.size === pair[0], run: function () { set({ size: pair[0] }); } };
        }));
        return;
      }
      menu(anchor, "이미지 맞춤", [["cover", "채우기"], ["contain", "맞추기"]].map(function (pair) {
        return { label: pair[1], ico: card.fit === pair[0] ? "✓" : "", on: card.fit === pair[0], run: function () { set({ fit: pair[0] }); } };
      }));
    }

    function viewMenu(anchor) {
      var view = currentView();
      var cards = view.type === "gallery" || view.type === "board";
      var card = cards ? MODEL.normaliseCard(view.config.card || {}) : null;
      menu(anchor, view.name, [
        { label: "뷰 이름 바꾸기", ico: "✎", run: function () { renameView(anchor, view); } },
        cards ? { separator: true } : null,
        cards ? { label: "카드 미리보기", ico: "▣", run: function () { cardMenu(anchor, view, "preview"); } } : null,
        cards ? { label: "카드 크기", ico: "↔", run: function () { cardMenu(anchor, view, "size"); } } : null,
        cards ? { label: "이미지 맞춤", ico: "⤢", run: function () { cardMenu(anchor, view, "fit"); } } : null,
        cards ? { label: "아이콘 보이기", ico: card.icon ? "✓" : "", on: card.icon, run: function () { saveView({ card: Object.assign({}, card, { icon: !card.icon }) }).then(render); } } : null,
        cards ? { separator: true } : null,
        { label: subitems() ? "하위 항목 끄기" : "하위 항목 켜기", ico: "↳", run: function () { switchSubitems(!subitems()); } },
        subitems() && view.type === "table" ? { label: "하위 항목: " + (view.config.subitems === "flat" ? "평평" : "중첩"), ico: "≡", run: function () { saveView({ subitems: view.config.subitems === "flat" ? null : "flat" }).then(render); } } : null,
        { separator: true },
        state.views.length > 1 ? { label: "뷰 삭제", ico: "✕", run: function () {
          if (!window.confirm(view.name + " 뷰를 지울까요?")) return;
          api(base + "/views/" + encodeURIComponent(view.id), { method: "DELETE" })
            .then(function () { state.viewId = null; return reload(); })
            .catch(function (error) { setStatus("뷰 삭제 실패: " + error.message, true); });
        } } : null,
      ]);
    }

    function renameView(anchor, view) {
      var input = el("input", { class: "dbrename", value: view.name, "aria-label": "뷰 이름" });
      var box = popover(anchor, input);
      input.focus();
      input.select();
      var done = false;
      function commit() {
        if (done) return;
        var name = input.value.trim();
        done = true;
        box.remove();
        if (!name || name === view.name) return;
        api(base + "/views/" + encodeURIComponent(view.id), { method: "PATCH", body: JSON.stringify({ name: name }) })
          .then(function () { return reloadWithStatus("뷰 이름 저장됨"); })
          .catch(function (error) { setStatus("뷰 이름 저장 실패: " + error.message, true); });
      }
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        if (ev.key === "Escape") { done = true; box.remove(); }
      });
    }

    function templateEditor(anchor) {
      var wrap = el("div", { class: "dbaddbox" });
      var nameInput = el("input", { class: "dburl", placeholder: "템플릿 이름", type: "text" });
      var iconInput = el("input", { class: "dbname", placeholder: "아이콘(선택)", type: "text", maxlength: "8" });
      var rowSelect = el("select", { class: "dbselect" });
      rowSelect.appendChild(el("option", { value: "", text: "빈 템플릿" }));
      state.rows.forEach(function (row) {
        rowSelect.appendChild(el("option", { value: row.id, text: row.pageTitle || row.id }));
      });
      var message = el("p", { class: "dbhint" });
      wrap.appendChild(el("label", { class: "dblabel", text: "이름" }));
      wrap.appendChild(nameInput);
      wrap.appendChild(iconInput);
      wrap.appendChild(el("label", { class: "dblabel", text: "기본값과 본문을 가져올 행" }));
      wrap.appendChild(rowSelect);
      wrap.appendChild(message);
      var box = popover(anchor, wrap);
      nameInput.focus();
      var save = el("button", { type: "button", class: "dbprimary", text: "템플릿 저장" });
      var busy = false;
      function fail(text) {
        message.textContent = text;
        message.classList.add("bad");
        setStatus(text, true);
        busy = false;
        save.disabled = false;
      }
      save.addEventListener("click", function () {
        if (busy) return;
        var name = nameInput.value.trim();
        if (!name) { fail("템플릿 이름을 입력하세요."); return; }
        busy = true;
        save.disabled = true;
        var row = state.rows.find(function (entry) { return entry.id === rowSelect.value; });
        var props = {};
        if (row) {
          state.properties.forEach(function (prop) {
            if (prop.type === "title" || prop.type === "formula" || prop.type === "rollup" || prop.type === "created_time" || prop.type === "updated_time" || prop.type === "unique_id" || prop.type === "button") return;
            var v = (row.props || {})[prop.id];
            if (v !== undefined && v !== null) props[prop.id] = v;
          });
        }
        var blocksReady = row && row.page
          ? api("/page/" + pageUrl(row.page)).then(function (data) {
            return data.blocks || (data.page && data.page.blocks) || [];
          })
          : Promise.resolve([]);
        blocksReady.then(function (blocks) {
          return api(base + "/templates", { method: "POST", body: JSON.stringify({ name: name, icon: iconInput.value.trim(), props: props, blocks: blocks }) });
        }).then(function () {
          box.remove();
          return reloadWithStatus("템플릿 저장됨");
        }).catch(function (error) { fail("템플릿 저장 실패: " + error.message); });
      });
      box.appendChild(save);
    }

    function recurrenceEditor(anchor, template) {
      var rec = template.recurrence || { freq: "day", interval: 1, weekdays: [1], monthday: 1, hour: 0, minute: 0, tz: "Asia/Seoul" };
      var wrap = el("div", { class: "dbaddbox dbrecur" });
      var freq = el("select", { class: "dbselect", "aria-label": "주기" });
      [["day", "매일"], ["week", "매주"], ["month", "매월"]].forEach(function (pair) {
        freq.appendChild(el("option", { value: pair[0], text: pair[1], selected: rec.freq === pair[0] }));
      });
      var days = el("div", { class: "dbrecurdays" });
      ["일", "월", "화", "수", "목", "금", "토"].forEach(function (name, index) {
        var box = el("input", { type: "checkbox", value: String(index), "aria-label": name + "요일" });
        box.checked = (rec.weekdays || []).indexOf(index) >= 0;
        days.appendChild(el("label", { class: "dbrecurday" }, [box, el("span", { text: name })]));
      });
      var monthday = el("input", { class: "dbname", type: "number", min: "1", max: "31", value: String(rec.monthday || 1), "aria-label": "날짜" });
      var time = el("input", { class: "dbname", type: "time", step: "300", value: String(rec.hour).padStart(2, "0") + ":" + String(rec.minute).padStart(2, "0"), "aria-label": "시각" });
      var tz = el("input", { class: "dburl", value: rec.tz || "Asia/Seoul", "aria-label": "시간대" });
      var next = el("p", { class: "dbhint", text: template.recurrence && template.recurrence.next_run ? "다음: " + new Date(template.recurrence.next_run).toLocaleString() : "" });
      wrap.appendChild(el("label", { class: "dblabel", text: "주기" }));
      wrap.appendChild(freq);
      var dayLabel = el("label", { class: "dblabel", text: "요일" });
      var dateLabel = el("label", { class: "dblabel", text: "날짜(없는 달은 말일)" });
      wrap.appendChild(dayLabel);
      wrap.appendChild(days);
      wrap.appendChild(dateLabel);
      wrap.appendChild(monthday);
      wrap.appendChild(el("label", { class: "dblabel", text: "시각" }));
      wrap.appendChild(time);
      wrap.appendChild(el("label", { class: "dblabel", text: "시간대" }));
      wrap.appendChild(tz);
      wrap.appendChild(next);
      var paint = function () {
        dayLabel.hidden = days.hidden = freq.value !== "week";
        dateLabel.hidden = monthday.hidden = freq.value !== "month";
      };
      freq.addEventListener("change", paint);
      paint();
      var box = popover(anchor, wrap);
      var send = function (value) {
        box.remove();
        api(base + "/templates/" + encodeURIComponent(template.id), { method: "PATCH", body: JSON.stringify({ recurrence: value }) })
          .then(function () { return reloadWithStatus(value ? "반복 저장됨" : "반복 꺼짐"); })
          .catch(function (error) { setStatus("반복 저장 실패: " + error.message, true); });
      };
      var save = el("button", { type: "button", class: "dbprimary", text: "저장" });
      save.addEventListener("click", function () {
        var parts = (time.value || "00:00").split(":");
        var weekdays = [];
        days.querySelectorAll("input").forEach(function (input) { if (input.checked) weekdays.push(Number(input.value)); });
        send({ freq: freq.value, interval: 1, weekdays: weekdays, monthday: Number(monthday.value) || 1, hour: Number(parts[0]) || 0, minute: Number(parts[1]) || 0, tz: tz.value.trim() || "Asia/Seoul" });
      });
      box.appendChild(save);
      if (template.recurrence) {
        var off = el("button", { type: "button", class: "dbsecondary", text: "반복 끄기" });
        off.addEventListener("click", function () { send(null); });
        box.appendChild(off);
      }
    }

    function templateMenu(anchor) {
      var items = [{ label: "새 템플릿 만들기", ico: "+", run: function () { templateEditor(anchor); } }];
      if (state.templates.length) items.push({ separator: true });
      var view = currentView();
      state.templates.forEach(function (template) {
        var isDefault = view.config.default_template === template.id;
        items.push({
          label: template.name + " - 이 뷰의 기본값으로", ico: isDefault ? "✓" : "", on: isDefault, aria: template.name + " 템플릿을 이 뷰의 새 행 기본값으로",
          run: function () {
            saveView({ default_template: isDefault ? null : template.id }).then(function () { return reloadWithStatus(isDefault ? "기본 템플릿 해제됨" : "기본 템플릿 설정됨"); });
          },
        });
        if (template.notice) items.push({ label: template.notice, run: function () { recurrenceEditor(anchor, template); } });
        items.push({
          label: template.name + " 반복…", ico: template.recurrence ? "↻" : "◷", aria: template.name + " 템플릿 반복 설정",
          run: function () { recurrenceEditor(anchor, template); },
        });
        items.push({
          label: template.name + " 삭제", ico: "✕", aria: template.name + " 템플릿 삭제",
          run: function () {
            if (!window.confirm(template.name + " 템플릿을 지울까요?")) return;
            api(base + "/templates/" + encodeURIComponent(template.id), { method: "DELETE" })
              .then(function () { return reloadWithStatus("템플릿 삭제됨"); })
              .catch(function (error) { setStatus("템플릿 삭제 실패: " + error.message, true); });
          },
        });
      });
      menu(anchor, "템플릿", items);
    }

    function toolbar() {
      var view = currentView();
      var bar = el("div", { class: "dbbar" });
      var tabs = el("div", { class: "dbtabs", role: "tablist", "aria-label": "보기" });
      state.views.forEach(function (entry) {
        var tab = el("button", { type: "button", role: "tab", class: "dbtab" + (entry.id === view.id ? " on" : ""), text: entry.name, dataset: { view: entry.type }, "aria-selected": String(entry.id === view.id) });
        if (reader) tab.prepend(readerIcon(entry.type));
        tab.addEventListener("click", function () {
          state.viewId = entry.id;
          state.collapsed = null;
          if (reader) {
            var url = new URL(location.href);
            if (entry.id === (state.views[0] || {}).id) url.searchParams.delete("view"); else url.searchParams.set("view", entry.type);
            history.pushState({ dbView: entry.id }, "", url);
          }
          render();
          var next = document.getElementById(state.mountId).querySelector('[role="tab"][aria-selected="true"]');
          if (next) next.focus();
        });
        tabs.appendChild(tab);
      });
      var viewOptions = el("button", { type: "button", class: "dbtab dbtabmenu", text: "⋯", "aria-label": "뷰 이름 바꾸기·삭제" });
      viewOptions.addEventListener("click", function () { viewMenu(viewOptions); });
      if (!reader) tabs.appendChild(viewOptions);
      var addView = el("button", { type: "button", class: "dbtab dbtabadd", text: "+", "aria-label": "새 뷰" });
      addView.addEventListener("click", function () {
        menu(addView, "새 뷰", MODEL.VIEW_TYPES.map(function (entry) {
          return {
            label: entry.label, ico: icon(entry.type),
            run: function () {
              api(base + "/views", { method: "POST", body: JSON.stringify({ name: entry.label, type: entry.type, config: Object.assign({}, view.config) }) })
                .then(function (data) { state.viewId = data.view.id; return reload(); })
                .catch(function (error) { setStatus("뷰 만들기 실패: " + error.message, true); });
            },
          };
        }));
      });
      tabs.appendChild(addView);
      bar.appendChild(tabs);
      if (reader) {
        var split = el("div", { class: "table-new dbnew-split" });
        var create = el("button", { type: "button", class: "dbnew-main" }, [readerIcon("plus"), el("span", { text: "새 작업" })]);
        create.addEventListener("click", function () { create.disabled = true; addRow(null).finally(function () { create.disabled = false; }); });
        var tail = el("button", { type: "button", class: "table-new-tail", "aria-label": "새 작업 옵션" }, [readerIcon("chevron")]);
        tail.addEventListener("click", function () { menu(tail, "새 작업", [{ label: "빈 작업 만들기", run: function () { addRow(null); } }].concat(state.templates.map(function (template) { return { label: template.name, run: function () { addRow(template.id); } }; }))); });
        split.appendChild(create); split.appendChild(tail); bar.appendChild(split);
        return bar;
      }

      var tools = el("div", { class: "dbtools" });
      var search = el("input", { class: "dbsearch", type: "search", placeholder: "검색", value: state.query || "" });
      search.addEventListener("input", function () { state.query = search.value; paintBody(); });
      tools.appendChild(search);

      var filterButton = el("button", { type: "button", class: "dbtool" + (view.config.filter ? " on" : "") }, [el("span", { class: "ico", text: icon("filter") }), el("span", { text: "필터" })]);
      filterButton.addEventListener("click", function () { filterEditor(filterButton); });
      tools.appendChild(filterButton);

      var sortButton = el("button", { type: "button", class: "dbtool" + ((view.config.sorts || []).length ? " on" : "") }, [el("span", { class: "ico", text: icon("sort") }), el("span", { text: "정렬" })]);
      sortButton.addEventListener("click", function () { sortEditor(sortButton); });
      tools.appendChild(sortButton);

      var groupButton = el("button", { type: "button", class: "dbtool" + (view.config.group_by ? " on" : "") }, [el("span", { class: "ico", text: icon("group") }), el("span", { text: "묶기" })]);
      groupButton.addEventListener("click", function () {
        var items = [{ label: "묶지 않음", on: !view.config.group_by, run: function () { saveView({ group_by: null }).then(render); } }];
        state.properties.forEach(function (prop) {
          items.push({ label: prop.name, on: view.config.group_by === prop.id, run: function () { saveView({ group_by: prop.id }).then(render); } });
        });
        menu(groupButton, "묶기", items);
      });
      tools.appendChild(groupButton);

      var propButton = el("button", { type: "button", class: "dbtool" }, [el("span", { class: "ico", text: icon("settings") }), el("span", { text: "속성" })]);
      propButton.addEventListener("click", function () {
        var visible = Array.isArray(view.config.visible) ? view.config.visible.slice() : state.properties.map(function (entry) { return entry.id; });
        menu(propButton, "보이는 속성", state.properties.map(function (prop) {
          return {
            label: prop.name, on: visible.indexOf(prop.id) >= 0, ico: visible.indexOf(prop.id) >= 0 ? "✓" : "",
            run: function () {
              var next = visible.slice();
              var at = next.indexOf(prop.id);
              if (at >= 0) next.splice(at, 1); else next.push(prop.id);
              saveView({ visible: next }).then(render);
            },
          };
        }).concat([{ separator: true }, { label: "모두 보기", run: function () { saveView({ visible: null }).then(render); } }, { label: "새 속성", ico: "+", run: function () { addProperty(null); } }]));
      });
      tools.appendChild(propButton);

      var templateButton = el("button", { type: "button", class: "dbtool" }, [el("span", { class: "ico", text: "▤" }), el("span", { text: "템플릿" })]);
      templateButton.addEventListener("click", function () { templateMenu(templateButton); });
      tools.appendChild(templateButton);

      var newRow = el("button", { type: "button", class: "dbprimary", text: "+ 새 행" });
      newRow.addEventListener("click", function () {
        var preset = view.config.default_template && state.templates.find(function (template) { return template.id === view.config.default_template; });
        if (preset) { addRow(preset.id); return; }
        if (!state.templates.length) { addRow(null); return; }
        menu(newRow, "새 행", [{ label: "빈 행", ico: "＋", run: function () { addRow(null); } }].concat(state.templates.map(function (template) {
          return { label: template.name, ico: template.icon || "▤", run: function () { addRow(template.id); } };
        })));
      });
      tools.appendChild(newRow);
      bar.appendChild(tools);
      return bar;
    }

    function filterEditor(anchor) {
      var view = currentView();
      var draft = view.config.filter && view.config.filter.property ? view.config.filter : null;
      var wrap = el("div", { class: "dbaddbox" });
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
      var box = popover(anchor, wrap);
      var row = el("div", { class: "dbrow2" });
      var apply = el("button", { type: "button", class: "dbprimary", text: "적용" });
      apply.addEventListener("click", function () {
        var prop = currentProp();
        var value = valueInput.value;
        if (prop.type === "number") value = value === "" ? null : Number(value);
        if (prop.type === "date") value = value || null;
        if (opSelect.value === "is_within") value = { relative: /_days$/.test(periodSelect.value) ? periodSelect.value + ":" + Math.max(1, Math.min(3650, Math.trunc(Number(daysInput.value) || 7))) : periodSelect.value };
        box.remove();
        saveView({ filter: { property: propSelect.value, operator: opSelect.value, value: value } }).then(render);
      });
      var clear = el("button", { type: "button", class: "dbtool", text: "지우기" });
      clear.addEventListener("click", function () { box.remove(); saveView({ filter: null }).then(render); });
      row.appendChild(apply);
      row.appendChild(clear);
      box.appendChild(row);
    }

    function sortEditor(anchor) {
      var view = currentView();
      var current = (view.config.sorts || [])[0] || null;
      var wrap = el("div", { class: "dbaddbox" });
      var propSelect = el("select", { class: "dbselect" });
      state.properties.forEach(function (prop) {
        propSelect.appendChild(el("option", { value: prop.id, text: prop.name, selected: current && current.property === prop.id }));
      });
      var dirSelect = el("select", { class: "dbselect" });
      [["ascending", "오름차순"], ["descending", "내림차순"]].forEach(function (pair) {
        dirSelect.appendChild(el("option", { value: pair[0], text: pair[1], selected: current && current.direction === pair[0] }));
      });
      wrap.appendChild(el("label", { class: "dblabel", text: "속성" }));
      wrap.appendChild(propSelect);
      wrap.appendChild(el("label", { class: "dblabel", text: "방향" }));
      wrap.appendChild(dirSelect);
      var box = popover(anchor, wrap);
      var row = el("div", { class: "dbrow2" });
      var apply = el("button", { type: "button", class: "dbprimary", text: "적용" });
      apply.addEventListener("click", function () {
        box.remove();
        saveView({ sorts: [{ property: propSelect.value, direction: dirSelect.value }] }).then(render);
      });
      var clear = el("button", { type: "button", class: "dbtool", text: "지우기" });
      clear.addEventListener("click", function () { box.remove(); saveView({ sorts: [] }).then(render); });
      row.appendChild(apply);
      row.appendChild(clear);
      box.appendChild(row);
    }

    function calculationMenu(anchor, prop) {
      var view = currentView();
      var current = (view.config.calculations || {})[prop.id] || "none";
      menu(anchor, prop.name + " 계산", MODEL.calculationsFor(prop.type).map(function (entry) {
        var label = (MODEL.CALCULATIONS.find(function (item) { return item.id === entry; }) || {}).label || entry;
        return {
          label: label, on: current === entry, ico: current === entry ? "✓" : "",
          run: function () {
            var calculations = Object.assign({}, view.config.calculations);
            if (entry === "none") delete calculations[prop.id]; else calculations[prop.id] = entry;
            saveView({ calculations: calculations }).then(render);
          },
        };
      }));
    }

    function rowMenu(anchor, row) {
      menu(anchor, "행", [
        { label: "페이지로 열기", ico: "↗", run: function () { openRow(row.id); } },
        subitems() ? { label: "하위 항목 추가", ico: "↳", run: function () { addSubitem(row); } } : null,
        { label: "복제", ico: "⧉", run: function () {
          var props = {};
          state.properties.forEach(function (prop) { props[prop.id] = values(row)[prop.id]; });
          api(base + "/rows", { method: "POST", body: JSON.stringify({ props: props }) })
            .then(function () { return reload(); })
            .catch(function (error) { setStatus("행 복제 실패: " + error.message, true); });
        } },
        { label: "행 지우기", ico: "✕", run: function () {
          api(base + "/rows/" + encodeURIComponent(row.id), { method: "DELETE" })
            .then(function () { return reload(); })
            .catch(function (error) { setStatus("행 삭제 실패: " + error.message, true); });
        } },
      ]);
    }

    function tableBody() {
      var view = currentView();
      var columns = visibleProps();
      var rows = filteredRows();
      var calculations = view.config.calculations || {};
      var table = el("table", { class: "dbtable" });

      var headRow = el("tr");
      // #34: the reader's leftmost box marks a row 완료, so it only exists when a status property has a 완료 option.
      var doneStatus = state.properties.find(function (prop) { return prop.type === "status"; });
      var doneColumn = !reader || !!(doneStatus && (doneStatus.config.options || []).some(function (entry) { return entry.name === "완료"; }));
      if (doneColumn) headRow.appendChild(el("th", { class: reader ? "table-select" : "dbgutter", "aria-label": "완료" }));
      columns.forEach(function (prop, index) {
        var width = MODEL.columnWidth(prop, view);
        var th = el("th", { class: "dbcol", style: "width:" + width + "px;min-width:" + width + "px" });
        var nameButton = el("button", { type: "button", class: "dbthname", text: prop.name });
        nameButton.addEventListener("click", function (ev) { columnMenu(ev.currentTarget, prop, state.properties.indexOf(prop)); });
        var inner = el("div", { class: "dbth" }, [
          el("span", { class: "dbtype", text: (MODEL.PROPERTY_TYPES.find(function (entry) { return entry.type === prop.type; }) || {}).label || "" }),
          nameButton,
        ]);
        if (reader) {
          inner.querySelector(".dbtype").remove();
          var headerIcon = readerAssets.querySelector('[data-table-property="' + prop.id + '"]');
          if (headerIcon) nameButton.prepend(headerIcon.firstChild.cloneNode(true));
        }
        if (!reader && index > 0) {
          var left = el("button", { type: "button", class: "dbmove dbmoveleft", text: "◂", "aria-label": prop.name + " 열을 왼쪽으로" });
          left.addEventListener("click", function () { moveColumn(prop, -1); });
          inner.appendChild(left);
        }
        if (!reader && index < columns.length - 1) {
          var right = el("button", { type: "button", class: "dbmove dbmoveright", text: "▸", "aria-label": prop.name + " 열을 오른쪽으로" });
          right.addEventListener("click", function () { moveColumn(prop, 1); });
          inner.appendChild(right);
        }
        th.appendChild(inner);
        var handle = el("span", { class: "dbresize", title: "너비 조절" });
        handle.addEventListener("mousedown", function (ev) {
          ev.preventDefault();
          var startX = ev.clientX;
          var startWidth = width;
          function move(moveEvent) {
            var next = Math.max(60, Math.min(800, startWidth + (moveEvent.clientX - startX)));
            th.style.width = next + "px";
            th.style.minWidth = next + "px";
          }
          function up(upEvent) {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            var next = Math.max(60, Math.min(800, startWidth + (upEvent.clientX - startX)));
            var widths = Object.assign({}, view.config.widths);
            widths[prop.id] = next;
            saveView({ widths: widths }).then(render);
          }
          document.addEventListener("mousemove", move);
          document.addEventListener("mouseup", up);
        });
        th.appendChild(handle);
        headRow.appendChild(th);
      });
      if (!reader) headRow.appendChild(el("th", { class: "dbgutter" }));
      table.appendChild(el("thead", null, [headRow]));

      var tbody = el("tbody");
      var nested = nestedRows(rows);
      var entries = nested || rows.map(function (row) { return { row: row, depth: 0 }; });
      entries.forEach(function (entry) {
        var row = entry.row;
        var tr = el("tr", { dataset: { row: row.id }, class: nested ? "dbsub d" + entry.depth + (entry.dim ? " dim" : "") : null });
        var gutter = el("td", { class: reader ? "table-select" : "dbgutter" });
        var grip = el("button", { type: "button", class: "dbgrip", text: icon("grip"), "aria-label": "행 메뉴" });
        grip.addEventListener("click", function (ev) { rowMenu(ev.currentTarget, row); });
        if (reader) {
          var complete = el("input", { type: "checkbox", class: "table-check", "aria-label": (row.pageTitle || "새 작업") + " 완료", checked: isComplete(row) });
          complete.addEventListener("change", function () {
            var status = state.properties.find(function (prop) { return prop.type === "status"; });
            var progress = state.properties.find(function (prop) { return prop.name === "진행률" && prop.type === "number"; });
            var option = status && status.config.options.find(function (entry) { return entry.name === (complete.checked ? "완료" : "진행 중"); });
            if (!option) return;
            var props = {}; props[status.id] = option.id;
            if (progress) props[progress.id] = complete.checked ? 100 : 0;
            complete.disabled = true;
            patchRow(row.id, props).then(function () { return reloadWithStatus("저장됨"); }, function (error) { complete.checked = !complete.checked; complete.disabled = false; setStatus("저장 실패: " + error.message, true); });
          });
          gutter.appendChild(complete);
        } else gutter.appendChild(grip);
        if (doneColumn) tr.appendChild(gutter);
        columns.forEach(function (prop) {
          var cell = cellEditor(prop, row);
          if (nested && prop.type === "title") {
            var toggle = entry.hasChildren
              ? el("button", { type: "button", class: "dbsubtoggle" + (entry.collapsed ? "" : " open"), text: "▸", "aria-label": entry.collapsed ? "하위 항목 펼치기" : "하위 항목 접기", "aria-expanded": String(!entry.collapsed) })
              : el("span", { class: "dbsubtoggle none" });
            if (entry.hasChildren) toggle.addEventListener("click", function () { toggleCollapsed(row.id); });
            cell.prepend(toggle);
          }
          tr.appendChild(el("td", { class: "dbcellhost" }, [cell]));
        });
        if (!reader) tr.appendChild(el("td", { class: "dbgutter" }));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      var footRow = el("tr", { class: "dbfoot" });
      if (doneColumn) footRow.appendChild(el("td", { class: "dbgutter" }));
      columns.forEach(function (prop) {
        var kind = calculations[prop.id];
        var text = kind && kind !== "none" ? MODEL.formatCalculation(kind, MODEL.computeCalculation(state.properties, rows, prop.id, kind, values), prop) : "";
        var cell = el("td", { class: "dbcalc" }, text ? [el("span", { text: text })] : []);
        var button = el("button", { type: "button", class: "dbcalcbtn", text: "∑", "aria-label": prop.name + " 계산" });
        button.addEventListener("click", function (ev) { calculationMenu(ev.currentTarget, prop); });
        cell.appendChild(button);
        footRow.appendChild(cell);
      });
      footRow.appendChild(el("td", { class: "dbgutter" }));
      if (!reader) table.appendChild(el("tfoot", null, [footRow]));

      var wrap = el("div", { class: "dbtablewrap", tabindex: "0", role: "region", "aria-label": "작업 표" }, [table]);
      var addRowButton = el("button", { type: "button", class: "dbaddrow", text: "+ 새 행" });
      addRowButton.addEventListener("click", function () { addRow(null); });
      if (!reader) wrap.appendChild(addRowButton);
      return wrap;
    }

    function groupSection(prop, groups) {
      var wrap = el("div", { class: "dbgroups" });
      groups.forEach(function (group) {
        var section = el("section", { class: "dbgroup" });
        section.appendChild(el("header", { class: "dbgrouphead" }, [
          el("span", { class: "dot " + group.color }),
          el("span", { text: group.label }),
          el("span", { class: "dbcount", text: String(group.rows.length) }),
        ]));
        if (group.rows.length) section.appendChild(rowsTable(group.rows, true));
        wrap.appendChild(section);
      });
      return wrap;
    }

    function rowsTable(rows, compact) {
      var view = currentView();
      var columns = visibleProps();
      var table = el("table", { class: "dbtable" + (compact ? " compact" : "") });
      var headRow = el("tr");
      columns.forEach(function (prop) {
        var width = MODEL.columnWidth(prop, view);
        var th = el("th", { class: "dbcol", style: "width:" + width + "px;min-width:" + width + "px" }, [
          el("button", { type: "button", class: "dbthname", text: prop.name }),
        ]);
        th.querySelector(".dbthname").addEventListener("click", function (ev) { columnMenu(ev.currentTarget, prop, state.properties.indexOf(prop)); });
        headRow.appendChild(th);
      });
      table.appendChild(el("thead", null, [headRow]));
      var tbody = el("tbody");
      rows.forEach(function (row) {
        var tr = el("tr", { dataset: { row: row.id } });
        columns.forEach(function (prop) {
          tr.appendChild(el("td", { class: "dbcellhost" }, [cellEditor(prop, row)]));
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      return table;
    }

    function hostFor(view) {
      var host = el("div", { class: "dbhost" });
      var renderer = VIEWS[view.type];
      if (view.type === "table" || !renderer) {
        if (view.config.group_by) {
          var prop = state.properties.find(function (entry) { return entry.id === view.config.group_by || entry.name === view.config.group_by; });
          var grouped = prop ? MODEL.groupRows(state.properties, filteredRows(), prop.id, values) : null;
          host.appendChild(grouped ? groupSection(prop, grouped.groups) : tableBody());
        } else {
          host.appendChild(tableBody());
        }
        return host;
      }
      host.appendChild(renderer({
        doc: document,
        db: { id: state.database.id, slug: state.database.slug, title: state.database.title, icon: state.database.icon },
        properties: view.type === "chart" ? state.properties : visibleProps(),
        rows: filteredRows(),
        view: view,
        values: values,
        display: function (prop, value) { return MODEL.displayValue(prop, value); },
        option: function (prop, value) { return MODEL.optionById(prop, value); },
        statusOptions: function (prop) { return (prop.config.options || []); },
        createCell: function (prop, row) { return cellEditor(prop, row); },
        setValue: function (rowId, propId, value) { setCell(rowId, propId, value); },
        openRow: openRow,
        groupBy: view.config.group_by,
        saveView: saveView,
        cardPreview: function (row, vals) { return MODEL.cardPreviewFile(state.properties, view, row, vals); },
      }));
      return host;
    }

    function paintBody() {
      var body = state.bodyNode;
      if (!body) return;
      body.innerHTML = "";
      var count = filteredRows().length;
      if (!reader) body.appendChild(el("p", { class: "dbmeta", text: state.properties.length + "개 속성 · " + count + " / " + state.rows.length + "행" }));
      body.appendChild(hostFor(currentView()));
      prioritizeImages();
    }

    function prioritizeImages() {
      if (!reader) return;
      document.querySelectorAll('.reader .blocks figure.img img, .reader .dbbrowser .filethumb img, .reader .dbbrowser .dbfile img, .reader .dbbrowser .dbv-cover').forEach(function (img, index) {
        img.setAttribute('loading', index ? 'lazy' : 'eager');
        if (index) img.removeAttribute('fetchpriority');
        else img.setAttribute('fetchpriority', 'high');
      });
    }

    function renderRowPanel(root) {
      var status = el("p", { class: "dbstatus" });
      state.statusNode = status;
      root.appendChild(status);
      var row = state.rows.find(function (entry) { return entry.id === state.rowId; });
      if (!row) {
        root.appendChild(el("p", { class: "dbhint bad", text: "행을 찾을 수 없어요." }));
        return;
      }
      var table = el("table", { class: "dbtable dbproptable" });
      var tbody = el("tbody");
      state.properties.forEach(function (prop) {
        var tr = el("tr");
        tr.appendChild(el("th", { class: "dbpropname", text: prop.name }));
        tr.appendChild(el("td", { class: "dbcellhost" }, [cellEditor(prop, row)]));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      root.appendChild(table);
    }

    function render() {
      var root = document.getElementById(state.mountId);
      if (!root) return;
      root.innerHTML = "";
      if (state.rowId) { renderRowPanel(root); return; }
      if (reader) root.appendChild(readerTemplate.cloneNode(true));
      if (reader) root.appendChild(readerAssets.querySelector(".table-heading").cloneNode(true));
      root.appendChild(toolbar());
      var status = el("p", { class: "dbstatus", role: "status", "aria-live": "polite" });
      state.statusNode = status;
      root.appendChild(status);
      var body = el("div", { class: "dbbody" });
      state.bodyNode = body;
      root.appendChild(body);
      if (!reader) root.appendChild(el("p", { class: "dbhint", text: "열 이름을 누르면 정렬·이름·종류·숨기기를 고를 수 있어요. 칸을 눌러 바로 고치고, 아래 ∑ 로 합계·평균·비율을 봅니다." }));
      if (state.titleInput) state.titleInput.value = state.database.title;
      paintBody();
    }

    function init() {
      var errorText = state.rowId ? "속성을 불러오지 못했어요: " : "데이터베이스를 불러오지 못했어요: ";
      var initial = validInitial(opts.initial, slug) ? opts.initial : bootData(slug);
      return (initial ? Promise.resolve(initial) : api(base)).then(function (data) {
        applyData(data);
        render();
        return loadRelationTitles(true).then(function () { return data; });
      }).catch(function (error) {
        var root = document.getElementById(state.mountId);
        if (root) root.appendChild(el("p", { class: "dbhint bad", text: errorText + error.message }));
        throw error;
      });
    }

    return { init: init, state: state, render: render, reload: reload };
  }

  var chunks = Object.create(null);
  function chunk(name, js, css) {
    return chunks[name] || (chunks[name] = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[href^="/lazy/' + name + '.css"]')) document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/lazy/" + name + ".css?v=" + css }));
      var script = document.createElement("script");
      script.src = "/lazy/" + name + ".js?v=" + js;
      script.onload = resolve; script.onerror = function () { delete chunks[name]; reject(new Error(name)); };
      document.head.appendChild(script);
    }));
  }

  function mount(slug, opts) {
    var instance = createInstance(slug, opts);
    registry[instance.state.mountId] = instance;
    lastMount = instance.state.mountId;
    return instance.init();
  }

  function load(slug, options) {
    var opts = options || {};
    return mount(slug, { mountId: opts.mountId, titleInput: opts.titleInput, initial: opts.initial });
  }

  function loadRow(slug, rowId, mountId, options) {
    return mount(slug, { mountId: mountId, rowId: rowId, initial: options && options.initial });
  }

  window.DoriDB = {
    load: load,
    loadRow: loadRow,
    mountAll: mountReaders,
    reload: function (mountId) {
      var entry = registry[mountId || lastMount];
      return entry ? entry.reload() : Promise.resolve();
    },
    state: function (mountId) {
      var entry = registry[mountId || lastMount];
      return entry ? entry.state : null;
    },
  };
  // #15: a live/SW refresh swaps <main> for the server copy (acard:page-fresh), which drops the live board and leaves
  // its unstyled fallback; mount the fresh nodes again so the board keeps its look and the newest order.
  function mountReaders() { return Promise.all(Array.from(document.querySelectorAll(".reader .dbbrowser[data-db]:not([data-live])")).map(function (node, index) {
    node.dataset.live = "1";
    node.id = node.id || "db-reader-" + index;
    // Until the live tabs replace the server-drawn ones, a tab click opens its view by URL (the server draws ?view=).
    if (node.id != "db-home") node.onclick = function (ev) { var tab = ev.target.closest("[data-view]"); if (tab) location.search = "?view=" + tab.dataset.view; };
    return load(node.dataset.db, { mountId: node.id }).then(function () { node.onclick = null; }, function () {});
  })); }
  mountReaders();
  document.addEventListener("acard:page-fresh", mountReaders);
  window.addEventListener("popstate", function () {
    var wanted = new URLSearchParams(location.search).get("view");
    Object.keys(registry).forEach(function (id) {
      var entry = registry[id], views = entry.state.views, node = document.querySelector(".reader #" + id);
      if (!node) return;
      // Data still loading: move the server-drawn selection so the tabs match the URL until the live view renders.
      if (!views.length) return node.querySelectorAll('[role="tab"][data-view]').forEach(function (tab, i, all) {
        var on = wanted ? tab.dataset.view === wanted : i === 0;
        tab.setAttribute("aria-selected", on); tab.classList.toggle("on", on);
      });
      var pick = wanted && views.find(function (view) { return view.id === wanted || view.type === wanted; });
      entry.state.viewId = (pick || views[0]).id;
      entry.render();
    });
  });
})();
