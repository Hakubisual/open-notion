(function () {
  "use strict";
  var net = window.AcardEditorProvider && window.AcardEditorProvider.fetch ? window.AcardEditorProvider.fetch : fetch;
  var model = window.EditorModel;
  var pageContext;
  var formatContext;
  var selectedIds = new Set();

  var BLOCK_TYPES = [
    { type: "paragraph", label: "글", hint: "그냥 문장", ico: "¶" },
    { type: "heading1", label: "제목 1", hint: "큰 제목", ico: "H1" },
    { type: "heading2", label: "제목 2", hint: "중간 제목", ico: "H2" },
    { type: "heading3", label: "제목 3", hint: "작은 제목", ico: "H3" },
    { type: "bulleted", label: "글머리 목록", hint: "• 항목", ico: "•" },
    { type: "numbered", label: "번호 목록", hint: "1. 항목", ico: "1." },
    { type: "to_do", label: "할 일", hint: "체크박스", ico: "☑" },
    { type: "toggle", label: "토글", hint: "접었다 펴는 목록", ico: "▸" },
    { type: "callout", label: "콜아웃", hint: "강조 상자", ico: "!" },
    { type: "quote", label: "인용", hint: "인용문", ico: "❝" },
    { type: "code", label: "코드", hint: "코드 블록", ico: "{}" },
    { type: "diagram", label: "다이어그램", hint: "흐름·순서 그림", ico: "◇" },
    { type: "chart", label: "차트", hint: "숫자 그래프", ico: "▥" },
    { type: "visual", label: "시각 자료", hint: "HTML 애니메이션", ico: "✦" },
    { type: "html", label: "HTML 블록", hint: "차트·데모·레이아웃", ico: "</>" },
    { type: "divider", label: "구분선", hint: "가로줄", ico: "―" },
    { type: "database", label: "표", hint: "표·보드", ico: "▤" },
    { type: "image", label: "이미지", hint: "올리거나 붙여넣기", ico: "▣" },
    { type: "photo-text", label: "사진에서 글 가져오기", hint: "글 읽기", ico: "▣" },
    { type: "video", label: "영상", hint: "주소나 파일", ico: "▶" },
    { type: "audio", label: "오디오", hint: "소리 파일", ico: "♪" },
    { type: "file", label: "파일", hint: "문서 올리기", ico: "🗎" },
    { type: "embed", label: "임베드", hint: "지도·코드 넣기", ico: "⧉" },
    { type: "bookmark", label: "북마크", hint: "링크 카드", ico: "🔖" },
    { type: "columns", label: "열 나누기", hint: "2~3열", ico: "◫" },
    { type: "table", label: "간단 표", hint: "그냥 표", ico: "☐" },
    { type: "equation", label: "수식", hint: "라텍", ico: "∑" },
    { type: "toc", label: "목차", hint: "제목 목록", ico: "≡" },
    { type: "breadcrumb", label: "이동 경로", hint: "위 계층", ico: "⌂" },
    { type: "button", label: "버튼", hint: "링크 버튼", ico: "◉" },
    { type: "progress", label: "진행률", hint: "막대 표시", ico: "▮" },
    { type: "db_ref", label: "데이터베이스", hint: "연결된 DB 보기", ico: "⛁" }
  ];

  var easy = null;
  function loadEasy() { return lazy("easy-insert").then(function (e) { easy = e; }, function () {}); }
  function slashMatches(query) { return easy ? easy.matches(BLOCK_TYPES, query) : BLOCK_TYPES; }

  var MEDIA_TYPES = { image: 1, video: 1, audio: 1, file: 1, embed: 1, bookmark: 1 };
  var LAYOUT_TYPES = { columns: 1, table: 1, equation: 1, toc: 1, breadcrumb: 1, button: 1, progress: 1 };
  var BLOCK_DEFAULTS = {
    image: function () { return { meta: { src: "", width: 100 } }; },
    video: function () { return { meta: { url: "" } }; },
    audio: function () { return { meta: { url: "" } }; },
    file: function () { return { meta: { url: "", name: "" } }; },
    embed: function () { return { meta: { url: "" } }; },
    bookmark: function () { return { meta: { url: "" } }; },
    columns: function () { return { meta: { columns: [{ text: "" }, { text: "" }] } }; },
    table: function () { return { meta: { columns: ["열1", "열2", "열3"], rows: [["", "", ""], ["", "", ""]], header: true } }; },
    button: function () { return { meta: { url: "" } }; },
    progress: function () { return { meta: { value: 50, color: "blue" } }; }
  };

  var PH = {
    paragraph: "글을 써 보세요. '/' 를 누르면 블록을 고를 수 있어요.",
    heading1: "제목 1",
    heading2: "제목 2",
    heading3: "제목 3",
    bulleted: "목록 항목",
    numbered: "목록 항목",
    to_do: "할 일",
    toggle: "토글 제목",
    callout: "강조할 내용",
    quote: "인용",
    button: "버튼 글자",
    progress: "진행률 라벨"
  };

  var THEME_KEY = "dori-notes-theme";
  try {
    var stored = localStorage.getItem(THEME_KEY);
    document.documentElement.setAttribute("data-theme", stored === "light" || stored === "dark" ? stored : "auto");
  } catch (e) {}

  var slug = decodeURIComponent((location.pathname.match(/^\/edit\/([^/]+)\/?$/) || [])[1] || "index");
  var state = { title: "", blocks: [], pages: [], dirty: false, saving: false, lastSaved: null, kind: "note", dbRow: null };
  var els = {
    tree: document.getElementById("tree"),
    title: document.getElementById("title"),
    blocks: document.getElementById("blocks"),
    save: document.getElementById("save-state"),
    meta: document.getElementById("meta"),
    slash: document.getElementById("slash"),
    ctx: document.getElementById("ctx"),
    backlinks: document.getElementById("backlinks"),
    sidebar: document.getElementById("sidebar"),
    menu: document.getElementById("menu")
  };

  function api(path, options) {
    return net("/api" + path, Object.assign({ headers: { "content-type": "application/json" } }, options || {})).then(apiResponse);
  }

  function apiResponse(res) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      if (!res.ok) throw new Error(body.error || String(res.status));
      return body;
    });
  }

  var lazyPending = Object.create(null), lazyApis = Object.create(null);
  function lazy(name) {
    return lazyPending[name] || (lazyPending[name] = Promise.resolve().then(function () {
      var versions = (window.AcardLazy || {})[name];
      if (!versions || !versions.js) throw Error("Unknown lazy feature: " + name);
      return Promise.all(Object.keys(versions).map(function (ext) {
        return new Promise(function (resolve, reject) {
          var node = document.createElement(ext === "css" ? "link" : "script");
          node.rel = "stylesheet";
          node[ext === "css" ? "href" : "src"] = "/lazy/" + name + "." + ext + "?v=" + versions[ext];
          node.onload = resolve; node.onerror = reject;
          document.head.appendChild(node);
        });
      })).then(function () {
        if (!(name in lazyApis)) throw Error("Unregistered lazy feature: " + name);
        return lazyApis[name];
      });
    }));
  }
  var featureListeners = Object.create(null);
  var featureReady = false;
  function emitFeature(event, value) {
    (featureListeners[event] || []).slice().forEach(function (fn) {
      try { fn(value); } catch (error) { console.error("Editor feature listener failed", error); }
    });
  }
  window.AcardEditor = {
    lazy: lazy,
    provide: function (name, api) { lazyApis[name] = api; },
    on: function (event, fn) {
      var listeners = featureListeners[event] || (featureListeners[event] = []);
      listeners.push(fn);
      if (event === "ready" && featureReady) {
        try { fn(window.AcardEditor); } catch (error) { console.error("Editor feature listener failed", error); }
      }
      return function () { var at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); };
    },
    get state() { return state; },
    api: api, slug: slug, loadTree: function () { return loadTree(); }, scheduleSave: scheduleSave, render: render, setSave: setSave, save: save,
    transport: function (pageSlug, payload) {
      return net("/api/page/" + encodeURIComponent(pageSlug), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    },
    insertBlocksAfter: function (id, blocks) {
      var index = state.blocks.findIndex(function (block) { return block.id === id; });
      if (index < 0) throw new Error("Unknown block: " + id);
      var added = blocks.map(function (block) { return Object.assign(newBlock(), block); });
      state.blocks.splice.apply(state.blocks, [model.endOf(state.blocks, index), 0].concat(added));
      render(); scheduleSave();
      return added.map(function (block) { return block.id; });
    },
    replaceBlockText: function (id, text) {
      var block = state.blocks.find(function (entry) { return entry.id === id; });
      if (!block) throw new Error("Unknown block: " + id);
      block.text = String(text);
      if (block.meta) { block.meta = Object.assign({}, block.meta); delete block.meta.richText; }
      render(); scheduleSave();
    },
    getSelection: function () {
      var selection = window.getSelection();
      var node = selection && selection.anchorNode;
      var element = node && (node.nodeType === 1 ? node : node.parentElement);
      var block = element && element.closest(".blk[data-id]");
      return { text: selection ? selection.toString() : "", blockId: block ? block.dataset.id : null, blockIds: Array.from(selectedIds) };
    }
  };

  function setSave(text, on) {
    // data-text keeps the source string: the English layer (i18n-app.js) rewrites the visible text, and save-queue.js
    // compares against the source so the two do not keep overwriting each other.
    els.save.dataset.text = text;
    els.save.textContent = text;
    els.save.classList.toggle("on", !!on);
  }
  // After a big edit (delete / move) offer one-click undo for 5 s; Ctrl+Z does the same.
  var toastTimer = null;
  function undoToast(text) {
    var box = document.getElementById("undo-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "undo-toast"; box.className = "undo-toast"; box.setAttribute("role", "status");
      box.innerHTML = '<span></span><button type="button">되돌리기</button>';
      box.querySelector("button").addEventListener("click", function () { box.hidden = true; restoreEdit(undoStack, redoStack); });
      document.body.appendChild(box);
    }
    box.firstChild.textContent = text + " · Ctrl+Z";
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 5000);
  }

  var saveTimer = null;
  var activeSave = null;
  var undoStack = [], redoStack = [], previousSnapshot = null, restoring = false;
  function snapshot() { return JSON.stringify({ title: state.title, blocks: state.blocks }); }
  function restoreEdit(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    var value = JSON.parse(from.pop());
    state.title = value.title; state.blocks = value.blocks;
    previousSnapshot = snapshot();
    restoring = true;
    render(); scheduleSave();
    restoring = false;
  }
  function scheduleSave() {
    var current = snapshot();
    if (!restoring && previousSnapshot && current !== previousSnapshot) {
      undoStack.push(previousSnapshot);
      if (undoStack.length > 100) undoStack.shift();
      redoStack = [];
    }
    previousSnapshot = current;
    state.dirty = true;
    emitFeature("change", { title: state.title, blocks: state.blocks });
    setSave("저장 중…", true);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save().catch(function (error) { setSave("저장 실패: " + error.message, true); }); }, 700);
  }

  function save() {
    if (state.saving) return activeSave.then(function () { return state.dirty ? save() : undefined; });
    if (!state.dirty) return Promise.resolve();
    state.saving = true;
    state.dirty = false;
    var payload = { title: state.title, blocks: state.blocks };
    emitFeature("beforeSave", payload);
    var dbTitle = state.kind === "db" && window.DoriDB
      ? net("/api/db/" + encodeURIComponent(slug), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: state.title }) }).catch(function () {})
      : Promise.resolve();
    activeSave = dbTitle.then(function () {
      return window.AcardEditor.transport(slug, payload).then(apiResponse);
    })
      .then(function () {
        state.lastSaved = new Date();
        setSave("저장됨 " + state.lastSaved.toTimeString().slice(0, 5), false);
        loadBacklinks();
        emitFeature("saved", payload);
      })
      .catch(function (error) {
        state.dirty = true;
        setSave("저장 실패: " + error.message, true);
        emitFeature("saveFailed", error);
        throw error;
      })
      .finally(function () { state.saving = false; });
    return activeSave.then(function () { return state.dirty ? save() : undefined; });
  }

  function uid() {
    return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function newBlock(type) {
    return { id: uid(), type: type || "paragraph", text: "", checked: false, indent: 0, meta: null };
  }

  function render() {
    els.title.value = state.title;
    els.blocks.innerHTML = "";
    var parents = [];
    state.blocks.forEach(function (block, index) {
      while (parents.length && model.depth(parents[parents.length - 1].block) >= model.depth(block)) parents.pop();
      var row = blockEl(block, index);
      var parent = parents.length ? parents[parents.length - 1].host : els.blocks;
      parent.appendChild(row);
      var childHost = document.createElement("div");
      childHost.className = "children";
      row.querySelector(".body").appendChild(childHost);
      parents.push({ block: block, host: childHost });
    });
    mountLinkedDatabases();
  }

  function blockEl(block, index) {
    var row = document.createElement("div");
    row.className = "blk " + cls(block.type) + (block.checked ? " on" : "") + (block.indent ? " ind" + block.indent : "");
    row.dataset.id = block.id;
    row.id = "block-" + block.id;
    row.dataset.index = String(index);
    row.classList.toggle("selected", selectedIds.has(block.id));
    if (block.type === "toggle" && !(block.meta && block.meta.open)) row.classList.add("collapsed");

    var gutter = document.createElement("div");
    gutter.className = "gutter";
    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.title = "아래에 블록 추가";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", function () { insertAfter(index, newBlock()); });
    var menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.title = "블록 메뉴";
    menuBtn.textContent = "⋮⋮";
    menuBtn.className = "drag-handle";
    wireDrag(menuBtn, row, block);
    menuBtn.addEventListener("click", function (ev) { ev.stopPropagation(); openCtx(menuBtn, index); });
    gutter.appendChild(addBtn);
    gutter.appendChild(menuBtn);
    var select = document.createElement("input"); select.type = "checkbox"; select.className = "block-select"; select.checked = selectedIds.has(block.id); select.setAttribute("aria-label", "블록 선택");
    select.addEventListener("change", function () { if (select.checked) selectedIds.add(block.id); else selectedIds.delete(block.id); row.classList.toggle("selected", select.checked); });
    var hit = document.createElement("label"); hit.className = "block-hit"; hit.appendChild(select);
    gutter.appendChild(hit);
    row.appendChild(gutter);

    var body = document.createElement("div");
    body.className = "body";

    if (block.type === "bulleted" || block.type === "numbered") {
      var marker = document.createElement("div");
      marker.className = "marker";
      row.appendChild(marker);
    }

    if (block.type === "to_do") {
      var box = document.createElement("button");
      box.type = "button";
      box.className = "todo-box" + (block.checked ? " on" : "");
      box.setAttribute("aria-label", "완료 표시");
      box.textContent = block.checked ? "✓" : "";
      box.addEventListener("click", function () {
        block.checked = !block.checked;
        row.classList.toggle("on", block.checked);
        box.classList.toggle("on", block.checked);
        box.textContent = block.checked ? "✓" : "";
        scheduleSave();
      });
      body.appendChild(box);
    }

    if (block.type === "divider") {
      body.className = "body divider-body";
      row.appendChild(body);
      return row;
    }

    if (block.type === "database") {
      body.appendChild(dbBlock(block, index));
      row.appendChild(body);
      return row;
    }

    if (block.type === "db_ref") {
      body.appendChild(dbRefBlock(block));
      row.appendChild(body);
      return row;
    }

    if (/^(diagram|chart|visual|html)$/.test(block.type)) {
      var vh = document.createElement("div");
      vh.textContent = "불러오는 중…";
      lazy("visuals").then(function (v) { v.mount(vh, block, scheduleSave); }, function () { vh.textContent = "시각 자료 편집기를 불러오지 못했어요."; });
      body.appendChild(vh);
      row.appendChild(body);
      return row;
    }

    if (MEDIA_TYPES[block.type]) {
      body.appendChild(mediaBlock(block, index));
      row.appendChild(body);
      return row;
    }

    if (LAYOUT_TYPES[block.type]) {
      body.appendChild(layoutBlock(block, index));
      row.appendChild(body);
      return row;
    }

    var host = body;
    if (block.type === "toggle") {
      var trow = document.createElement("div");
      trow.className = "trow";
      var twist = document.createElement("button");
      twist.type = "button";
      twist.className = "twist";
      twist.textContent = "▶";
      twist.classList.toggle("open", !!(block.meta && block.meta.open));
      twist.setAttribute("aria-label", "토글 펴기");
      twist.addEventListener("click", function () {
        var open = row.classList.toggle("collapsed");
        twist.classList.toggle("open", !open);
        block.meta = Object.assign({}, block.meta, { open: !open });
        twist.setAttribute("aria-expanded", String(!open));
        scheduleSave();
      });
      trow.appendChild(twist);
      body.appendChild(trow);
      host = trow;
    }

    var text = document.createElement("div");
    text.className = "text";
    text.contentEditable = "true";
    text.spellcheck = false;
    text.dataset.ph = PH[block.type] || "";
    if (block.meta && Array.isArray(block.meta.richText) && block.type !== "code") text.innerHTML = model.richHtml(block.meta.richText, block.text);
    else text.textContent = block.text;
    wireText(text, block, row, index);
    host.appendChild(text);
    row.appendChild(body);
    return row;
  }

  function cls(type) {
    return ({ heading1: "h1", heading2: "h2", heading3: "h3", to_do: "todo" })[type] || type;
  }

  function wireText(text, block, row, index) {
    text.addEventListener("focus", loadEasy, { once: true });
    text.addEventListener("input", function () {
      block.text = text.textContent;
      if (block.type !== "code") block.meta = Object.assign({}, block.meta, { richText: model.readRich(text) });
      if (block.type === "paragraph" && /^\/[^\s/]{0,12}$/.test(text.textContent)) { openSlash(text, index, text.textContent.slice(1)); loadEasy().then(function () { if (slashIndex == index) openSlash(text, index, text.textContent.slice(1)); }); }
      else if (!els.slash.hidden && slashIndex === index) hideSlash();
      if (easy && easy.shortcut(text.textContent, block, index)) return;
      if (formatContext) formatContext.mention(text, block);
      scheduleSave();
    });
    text.addEventListener("paste", function (ev) {
      ev.preventDefault();
      var paste = (ev.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, paste.replace(/\r?\n+/g, " "));
    });
    text.addEventListener("keydown", function (ev) {
      if (!els.slash.hidden && ["Enter", "ArrowUp", "ArrowDown"].indexOf(ev.key) >= 0) return;
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        hideSlash();
        if (easy && easy.pipeTable(text.textContent, block)) { render(); scheduleSave(); return; }
        if (!text.textContent && ["bulleted", "numbered", "to_do"].indexOf(block.type) >= 0) {
          block.type = "paragraph"; render(); focusBlock(block.id); scheduleSave(); return;
        }
        insertAfter(index, newBlock(block.type === "code" ? "code" : (block.type === "bulleted" || block.type === "numbered" || block.type === "to_do" ? block.type : "paragraph")), block.indent);
      } else if (ev.key === "Backspace" && text.textContent === "" && state.blocks.length > 1) {
        ev.preventDefault();
        var prev = state.blocks[index - 1];
        state.blocks.splice(index, model.endOf(state.blocks, index) - index);
        render();
        if (prev) focusBlock(prev.id);
        scheduleSave();
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        model.indent(state.blocks, index, ev.shiftKey ? -1 : 1);
        render();
        focusBlock(block.id);
        scheduleSave();
      } else if (ev.key === "ArrowUp" && !text.textContent) {
        var up = state.blocks[index - 1];
        if (up) { ev.preventDefault(); focusBlock(up.id); }
      } else if (ev.key === "ArrowDown") {
        var down = state.blocks[index + 1];
        if (down) { ev.preventDefault(); focusBlock(down.id); }
      } else if (ev.key === "Escape") {
        hideSlash();
      }
    });
  }

  function focusBlock(id) {
    var row = els.blocks.querySelector('[data-id="' + id + '"]');
    if (!row) return;
    var text = row.querySelector(".text");
    if (!text) return;
    text.focus();
    var range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function insertAfter(index, block, indent) {
    block.indent = typeof indent === "number" ? indent : 0;
    state.blocks.splice(model.endOf(state.blocks, index), 0, block);
    render();
    focusBlock(block.id);
    scheduleSave();
  }

  function dbRefBlock(block) {
    var meta = block.meta || {};
    var wrap = document.createElement("div");
    wrap.className = "dbrefblock";
    var title = document.createElement("div");
    title.className = "dbrefname";
    title.textContent = meta.title || meta.database || "연결된 데이터베이스 없음";
    wrap.appendChild(title);
    if (meta.database) {
      var link = document.createElement("a");
      link.className = "dbreflink";
      link.href = "/edit/" + encodeURIComponent(meta.database) + "/";
      link.textContent = "데이터베이스 열기 ↗";
      wrap.appendChild(link);
      var host = document.createElement("div");
      host.className = "dbrefhost";
      host.id = "db-ref-" + block.id;
      host.dataset.dbref = meta.database;
      wrap.appendChild(host);
    }
    return wrap;
  }

  function mountLinkedDatabases() {
    var hosts = Array.prototype.slice.call(document.querySelectorAll("[data-dbref]"));
    hosts.forEach(function (host) {
      var target = host.getAttribute("data-dbref");
      if (window.DoriDB) {
        window.DoriDB.load(target, { mountId: host.id }).catch(function () {});
        return;
      }
      api("/db/" + encodeURIComponent(target)).then(function (data) {
        var title = document.createElement("div");
        title.className = "dbrefname";
        title.textContent = data.database.title + " · " + data.rows.length + "행";
        host.appendChild(title);
        var table = document.createElement("table");
        table.className = "dbtable compact";
        var columns = window.DoriDBModel ? window.DoriDBModel.visibleProperties(data.properties, data.views[0]) : data.properties;
        var head = document.createElement("tr");
        columns.forEach(function (prop) {
          var th = document.createElement("th");
          th.textContent = prop.name;
          head.appendChild(th);
        });
        table.appendChild(head);
        data.rows.slice(0, 30).forEach(function (row) {
          var tr = document.createElement("tr");
          columns.forEach(function (prop) {
            var td = document.createElement("td");
            var value = prop.type === "title" ? (row.pageTitle || "") : (row.computed && row.computed[prop.id] !== undefined ? row.computed[prop.id] : row.props[prop.id]);
            td.textContent = window.DoriDBModel ? window.DoriDBModel.displayValue(prop, value) : String(value === null || value === undefined ? "" : value);
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        host.appendChild(table);
      }).catch(function () {});
    });
  }

  function dbBlock(block, index) {
    var meta = block.meta || {};
    var columns = Array.isArray(meta.columns) ? meta.columns.slice() : [];
    var rows = Array.isArray(meta.rows) ? meta.rows.slice() : [];
    if (!columns.length) columns = ["상태", "담당", "다음 할 일"];
    var view = meta.view === "board" ? "board" : "table";

    var wrap = document.createElement("div");
    wrap.className = "dbblock";

    var head = document.createElement("div");
    head.className = "dbhead";
    var seg = document.createElement("div");
    seg.className = "seg";
    [["table", "표"], ["board", "보드"]].forEach(function (pair) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = pair[1];
      button.className = view === pair[0] ? "on" : "";
      button.addEventListener("click", function () {
        meta.view = pair[0];
        block.meta = meta;
        render();
        scheduleSave();
      });
      seg.appendChild(button);
    });
    var name = document.createElement("span");
    name.className = "dbname";
    name.textContent = "행 " + rows.length + " · 열 " + columns.length;
    head.appendChild(seg);
    head.appendChild(name);
    wrap.appendChild(head);

    function commit() {
      block.meta = { columns: columns, rows: rows, view: view };
      scheduleSave();
    }

    if (view === "board") {
      var statusCol = columns.indexOf("상태") >= 0 ? "상태" : columns[0];
      var board = document.createElement("div");
      board.className = "board";
      var groups = [];
      rows.forEach(function (row) {
        var key = String(row[statusCol] || "없음");
        if (groups.indexOf(key) < 0) groups.push(key);
      });
      if (!groups.length) groups = ["없음"];
      groups.forEach(function (key) {
        var col = document.createElement("div");
        col.className = "boardcol";
        var h = document.createElement("h4");
        h.textContent = key + " (" + rows.filter(function (row) { return String(row[statusCol] || "없음") === key; }).length + ")";
        col.appendChild(h);
        rows.forEach(function (row) {
          if (String(row[statusCol] || "없음") !== key) return;
          var card = document.createElement("div");
          card.className = "boardcard";
          var titleCol = columns[0] === statusCol && columns.length > 1 ? columns[1] : columns[0];
          var title = document.createElement("div");
          title.className = "cell";
          title.contentEditable = "true";
          title.textContent = row[titleCol] || "";
          title.addEventListener("input", function () { row[titleCol] = title.textContent; commit(); });
          card.appendChild(title);
          var sub = document.createElement("div");
          sub.className = "sub";
          sub.textContent = columns.filter(function (name) { return name !== titleCol && name !== statusCol; })
            .map(function (name) { return name + ": " + (row[name] || "-"); }).join(" · ");
          card.appendChild(sub);
          var move = document.createElement("select");
          move.setAttribute("aria-label", "상태 옮기기");
          groups.forEach(function (option) {
            var o = document.createElement("option");
            o.value = option;
            o.textContent = option;
            if (option === key) o.selected = true;
            move.appendChild(o);
          });
          move.addEventListener("change", function () {
            row[statusCol] = move.value;
            commit();
            render();
          });
          card.appendChild(move);
          col.appendChild(card);
        });
        board.appendChild(col);
      });
      wrap.appendChild(board);
      return wrap;
    }

    var table = document.createElement("table");
    table.className = "dbtable";
    var thead = document.createElement("thead");
    var hrow = document.createElement("tr");
    columns.forEach(function (column, columnIndex) {
      var th = document.createElement("th");
      var cell = document.createElement("div");
      cell.className = "cell";
      cell.contentEditable = "true";
      cell.textContent = column;
      cell.addEventListener("input", function () {
        var value = cell.textContent.trim() || "열";
        var old = columns[columnIndex];
        if (value === old) return;
        columns[columnIndex] = value;
        rows.forEach(function (row) { if (old !== value) { row[value] = row[old] || ""; delete row[old]; } });
        commit();
      });
      th.appendChild(cell);
      hrow.appendChild(th);
    });
    var blank = document.createElement("th");
    hrow.appendChild(blank);
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (row, rowIndex) {
      var tr = document.createElement("tr");
      columns.forEach(function (column) {
        var td = document.createElement("td");
        var cell = document.createElement("div");
        cell.className = "cell";
        cell.contentEditable = "true";
        cell.textContent = row[column] || "";
        cell.addEventListener("input", function () { row[column] = cell.textContent; commit(); });
        td.appendChild(cell);
        tr.appendChild(td);
      });
      var delTd = document.createElement("td");
      var del = document.createElement("button");
      del.type = "button";
      del.className = "rowdel";
      del.textContent = "✕";
      del.setAttribute("aria-label", "행 지우기");
      del.addEventListener("click", function () {
        rows.splice(rowIndex, 1);
        commit();
        render();
      });
      delTd.appendChild(del);
      tr.appendChild(delTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);

    var add = document.createElement("div");
    add.className = "dbadd";
    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ 행 추가";
    addBtn.addEventListener("click", function () {
      var row = {};
      columns.forEach(function (column) { row[column] = ""; });
      rows.push(row);
      commit();
      render();
    });
    var colBtn = document.createElement("button");
    colBtn.type = "button";
    colBtn.textContent = "+ 열 추가";
    colBtn.addEventListener("click", function () {
      var base = "열";
      var n = 2;
      while (columns.indexOf(base + n) >= 0) n += 1;
      columns.push(base + n);
      commit();
      render();
    });
    add.appendChild(addBtn);
    add.appendChild(colBtn);
    wrap.appendChild(add);
    return wrap;
  }

  function openLightbox(src, alt) {
    var overlay = document.createElement("div");
    overlay.className = "lightbox on";
    var img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    overlay.appendChild(img);
    overlay.addEventListener("click", function () { overlay.remove(); });
    document.addEventListener("keydown", function onKey(ev) {
      if (ev.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
    });
    document.body.appendChild(overlay);
  }

  function pickFile(accept, cb) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) cb(input.files[0]);
    });
    input.click();
  }

  function downscaleImage(file, maxSide) {
    if (!/^image\//.test(file.type) || file.type === "image/svg+xml") return Promise.resolve(file);
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1536 * 1024) { resolve(file); return; }
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          resolve(blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file);
        }, "image/jpeg", 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function uploadFile(file) {
    var form = new FormData();
    form.append("file", file, file.name);
    return net("/api/upload", { method: "POST", body: form }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.error || String(res.status));
        return body;
      });
    });
  }

  function uploadInto(block, file) {
    block._busy = true;
    render();
    setSave("올리는 중…", true);
    var ready = /^image\//.test(file.type) ? downscaleImage(file, 1600) : Promise.resolve(file);
    ready.then(function (f) { return uploadFile(f); }).then(function (res) {
      block._busy = false;
      block.meta = Object.assign({}, block.meta, { src: res.url, url: res.url, name: res.name, size: res.size });
      render();
      setSave("저장됨", false);
      scheduleSave();
    }).catch(function (err) {
      block._busy = false;
      render();
      setSave("올리기 실패: " + err.message, true);
    });
  }

  function focusedIndex() {
    var row = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".blk") : null;
    return row && row.dataset && row.dataset.index ? Number(row.dataset.index) : -1;
  }

  function handleIncomingFiles(files) {
    var index = focusedIndex();
    var target = null;
    var nextIndex = index;
    if (index >= 0) {
      var current = state.blocks[index];
      if (current && current.type === "image" && !(current.meta && current.meta.src)) {
        target = current;
      } else {
        target = newBlock("image");
        target.meta = { src: "", width: 100 };
        state.blocks.splice(index + 1, 0, target);
        nextIndex = index + 1;
      }
    } else {
      target = newBlock("image");
      target.meta = { src: "", width: 100 };
      state.blocks.push(target);
      nextIndex = state.blocks.length - 1;
    }
    render();
    scheduleSave();
    var row = els.blocks.querySelector('[data-index="' + nextIndex + '"]');
    if (row) row.scrollIntoView({ block: "nearest" });
    uploadInto(target, files[0]);
  }

  els.blocks.addEventListener("paste", function (ev) {
    var files = ev.clipboardData && ev.clipboardData.files;
    if (files && files.length) { ev.preventDefault(); handleIncomingFiles(files); }
  });
  els.blocks.addEventListener("dragover", function (ev) { ev.preventDefault(); });
  els.blocks.addEventListener("drop", function (ev) {
    var files = ev.dataTransfer && ev.dataTransfer.files;
    if (files && files.length) { ev.preventDefault(); handleIncomingFiles(files); }
  });

  function mediaBlock(block, index) {
    var meta = block.meta || (block.meta = {});
    var wrap = document.createElement("div");
    wrap.className = "mediablock mb-" + block.type;

    if (block._busy) {
      var busy = document.createElement("div");
      busy.className = "mbusy";
      busy.textContent = "올리는 중…";
      wrap.appendChild(busy);
      return wrap;
    }

    if (block.type === "image") {
      if (meta.src) {
        var fig = document.createElement("figure");
        fig.className = "img";
        fig.style.width = (Number(meta.width) || 100) + "%";
        var view = document.createElement("a");
        view.className = "imgview";
        view.href = meta.src;
        var img = document.createElement("img");
        img.src = meta.src;
        img.alt = block.text || "이미지";
        img.loading = "lazy";
        view.appendChild(img);
        view.addEventListener("click", function (ev) { ev.preventDefault(); openLightbox(img.src, img.alt); });
        fig.appendChild(view);
        var cap = document.createElement("figcaption");
        cap.contentEditable = "true";
        cap.spellcheck = false;
        cap.dataset.ph = "캡션 (선택)";
        cap.textContent = block.text || "";
        cap.addEventListener("input", function () { block.text = cap.textContent; scheduleSave(); });
        fig.appendChild(cap);
        var tools = document.createElement("div");
        tools.className = "imgtools";
        var slider = document.createElement("input");
        slider.type = "range";
        slider.min = "10"; slider.max = "100"; slider.step = "5";
        slider.value = String(Number(meta.width) || 100);
        slider.setAttribute("aria-label", "이미지 폭");
        slider.addEventListener("input", function () { meta.width = Number(slider.value); fig.style.width = slider.value + "%"; block.meta = meta; scheduleSave(); });
        tools.appendChild(slider);
        var swap = document.createElement("button");
        swap.type = "button";
        swap.className = "minibtn";
        swap.textContent = "바꾸기";
        swap.addEventListener("click", function () { pickFile("image/*", function (f) { uploadInto(block, f); }); });
        tools.appendChild(swap);
        wrap.appendChild(fig);
        wrap.appendChild(tools);
      } else {
        var tile = document.createElement("button");
        tile.type = "button";
        tile.className = "upload-tile";
        tile.innerHTML = '<span class="big">▣</span><span class="t">이미지 올리기</span><span class="hint">클릭하거나, 끌어다 놓거나 붙여넣기</span>';
        tile.addEventListener("click", function () { pickFile("image/*", function (f) { uploadInto(block, f); }); });
        wrap.appendChild(tile);
      }
      return wrap;
    }

    var row = document.createElement("div");
    row.className = "mbrow";
    var icon = document.createElement("span");
    icon.className = "mico";
    icon.textContent = { video: "▶", audio: "♪", file: "🗎", embed: "⧉", bookmark: "🔖" }[block.type] || "◦";
    row.appendChild(icon);
    var input = document.createElement("input");
    input.type = "text";
    input.className = "murl";
    input.placeholder = { video: "영상 주소 (YouTube·Vimeo·파일)", audio: "소리 파일 주소", file: "파일 주소", embed: "임베드 주소", bookmark: "링크 주소" }[block.type] || "주소";
    input.value = String(meta.url || "");
    input.addEventListener("input", function () { meta.url = input.value.trim(); block.meta = meta; scheduleSave(); });
    row.appendChild(input);
    if (block.type === "video" || block.type === "audio" || block.type === "file") {
      var up = document.createElement("button");
      up.type = "button";
      up.className = "minibtn";
      up.textContent = block.type === "file" ? "파일 올리기" : "파일로 넣기";
      up.addEventListener("click", function () {
        var accept = { video: "video/*", audio: "audio/*", file: "application/pdf,text/plain,image/*" }[block.type] || "*/*";
        pickFile(accept, function (f) { uploadInto(block, f); });
      });
      row.appendChild(up);
    }
    wrap.appendChild(row);
    if (block.type === "bookmark") {
      var note = document.createElement("div");
      note.className = "mbnote";
      note.textContent = meta.title ? String(meta.title) + " · " + String(meta.site || "") : "주소를 넣으면 미리보기 정보를 가져와요.";
      wrap.appendChild(note);
      input.addEventListener("change", function () {
        var url = meta.url;
        if (!/^https?:\/\//.test(url)) return;
        note.textContent = "미리보기를 가져오는 중…";
        net("/api/link-preview?url=" + encodeURIComponent(url))
          .then(function (r) { return r.json(); })
          .then(function (body) {
            meta.title = body.title || "";
            meta.description = body.description || "";
            meta.image = body.image || "";
            meta.site = body.site || "";
            note.textContent = meta.title ? String(meta.title) + " · " + String(meta.site || "") : "미리보기 정보가 없어요.";
            block.meta = meta;
            scheduleSave();
          })
          .catch(function () { note.textContent = "미리보기를 가져올 수 없었어요."; });
      });
    }
    return wrap;
  }

  function layoutBlock(block, index) {
    var meta = block.meta || (block.meta = {});
    var wrap = document.createElement("div");
    wrap.className = "layoutblock lb-" + block.type;

    if (block.type === "columns") {
      var cols = Array.isArray(meta.columns) && meta.columns.length ? meta.columns : (meta.columns = [{ text: "" }, { text: "" }]);
      var grid = document.createElement("div");
      grid.className = "cols cols" + cols.length;
      cols.forEach(function (col, ci) {
        var cell = document.createElement("div");
        cell.className = "col";
        var ed = document.createElement("div");
        ed.className = "text coled";
        ed.contentEditable = "true";
        ed.spellcheck = false;
        ed.dataset.ph = (ci + 1) + "번째 열";
        ed.textContent = col.text || "";
        ed.addEventListener("input", function () { col.text = ed.textContent; block.meta = meta; scheduleSave(); });
        cell.appendChild(ed);
        if (cols.length > 2) {
          var del = document.createElement("button");
          del.type = "button";
          del.className = "minibtn col-del";
          del.textContent = "✕";
          del.setAttribute("aria-label", (ci + 1) + "번째 열 지우기");
          del.addEventListener("click", function () { cols.splice(ci, 1); block.meta = meta; render(); scheduleSave(); });
          cell.appendChild(del);
        }
        grid.appendChild(cell);
      });
      wrap.appendChild(grid);
      if (cols.length < 3) {
        var addCol = document.createElement("button");
        addCol.type = "button";
        addCol.className = "minibtn";
        addCol.textContent = "+ 열";
        addCol.addEventListener("click", function () { cols.push({ text: "" }); block.meta = meta; render(); scheduleSave(); });
        wrap.appendChild(addCol);
      }
      return wrap;
    }

    if (block.type === "table") {
      wrap.textContent = "표를 불러오는 중…";
      var etRows = block.meta && Array.isArray(block.meta.rows) ? block.meta.rows.length : 2;
      wrap.style.minHeight = (159 + 42 * etRows) + "px";
      lazy("easy-table").then(function (t) { wrap.textContent = ""; t.mount(wrap, block, scheduleSave); wrap.style.minHeight = ""; }, function () { wrap.textContent = "표 편집기를 불러오지 못했어요."; });
      return wrap;
    }

    if (block.type === "equation") {
      var src = document.createElement("textarea");
      src.className = "eqsrc";
      src.rows = 2;
      src.spellcheck = false;
      src.placeholder = "E = mc^2";
      src.value = block.text || "";
      var prev = document.createElement("div");
      prev.className = "eqprev";
      var paint = function () {
        prev.innerHTML = window.EquationHtml ? window.EquationHtml.equationHtml(block.text || "") : "";
      };
      src.addEventListener("input", function () { block.text = src.value; paint(); scheduleSave(); });
      paint();
      wrap.appendChild(prev);
      wrap.appendChild(src);
      return wrap;
    }

    if (block.type === "button") {
      var line = document.createElement("div");
      line.className = "btnline";
      var label = document.createElement("div");
      label.className = "text";
      label.contentEditable = "true";
      label.spellcheck = false;
      label.dataset.ph = "버튼 글자";
      label.textContent = block.text || "";
      label.addEventListener("input", function () { block.text = label.textContent; scheduleSave(); });
      var url = document.createElement("input");
      url.type = "text";
      url.className = "murl";
      url.placeholder = "이동할 주소";
      url.value = String(meta.url || "");
      url.addEventListener("input", function () { meta.url = url.value.trim(); block.meta = meta; scheduleSave(); });
      line.appendChild(label);
      line.appendChild(url);
      wrap.appendChild(line);
      return wrap;
    }

    if (block.type === "progress") {
      var box = document.createElement("div");
      box.className = "progress " + String(meta.color || "blue");
      var head = document.createElement("div");
      head.className = "phead";
      var label = document.createElement("div");
      label.className = "text";
      label.contentEditable = "true";
      label.spellcheck = false;
      label.dataset.ph = "진행률 라벨";
      label.textContent = block.text || "";
      label.addEventListener("input", function () { block.text = label.textContent; scheduleSave(); });
      var val = document.createElement("span");
      val.className = "pval";
      val.textContent = (Number(meta.value) || 0) + "%";
      head.appendChild(label);
      head.appendChild(val);
      var bar = document.createElement("div");
      bar.className = "pbar";
      var fill = document.createElement("span");
      fill.style.width = (Number(meta.value) || 0) + "%";
      bar.appendChild(fill);
      var tools = document.createElement("div");
      tools.className = "lbtools";
      var range = document.createElement("input");
      range.type = "range";
      range.min = "0"; range.max = "100"; range.step = "5";
      range.value = String(Number(meta.value) || 0);
      range.setAttribute("aria-label", "진행률 값");
      range.addEventListener("input", function () {
        meta.value = Number(range.value);
        val.textContent = range.value + "%";
        fill.style.width = range.value + "%";
        block.meta = meta;
        scheduleSave();
      });
      var color = document.createElement("select");
      color.setAttribute("aria-label", "진행률 색");
      [["blue", "파랑"], ["red", "빨강"], ["green", "초록"], ["orange", "주황"], ["purple", "보라"]].forEach(function (pair) {
        var o = document.createElement("option");
        o.value = pair[0]; o.textContent = pair[1];
        if (pair[0] === (meta.color || "blue")) o.selected = true;
        color.appendChild(o);
      });
      color.addEventListener("change", function () { meta.color = color.value; box.className = "progress " + color.value; block.meta = meta; scheduleSave(); });
      tools.appendChild(range);
      tools.appendChild(color);
      box.appendChild(head);
      box.appendChild(bar);
      wrap.appendChild(box);
      wrap.appendChild(tools);
      return wrap;
    }

    var note = document.createElement("div");
    note.className = "lbnote";
    note.textContent = block.type === "toc"
      ? "읽기 화면에서 이 페이지의 제목 목차가 여기에 표시돼요."
      : "읽기 화면에서 상위 페이지 경로가 여기에 표시돼요.";
    wrap.appendChild(note);
    return wrap;
  }

  var slashIndex = -1;
  var slashSel = 0;

  var slashItems = [];

  function openSlash(anchor, index, query) {
    slashIndex = index;
    slashSel = 0;
    slashItems = slashMatches(query);
    var rect = anchor.getBoundingClientRect();
    els.slash.style.left = Math.min(rect.left, window.innerWidth - 280) + "px";
    els.slash.style.top = Math.min(rect.bottom + 6, window.innerHeight - 330) + "px";
    els.slash.innerHTML = "<h3>블록 고르기</h3>";
    slashItems.forEach(function (entry, i) {
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.i = String(i);
      if (i === 0) button.className = "sel";
      button.innerHTML = '<span class="ico">' + entry.ico + "</span><span>" + entry.label + "</span><span class=\"k\">" + entry.hint + "</span>";
      button.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
        applySlash(entry.type);
      });
      els.slash.appendChild(button);
    });
    if (easy) easy.decorate(els.slash, query, slashItems);
    els.slash.hidden = false;
  }

  function hideSlash() {
    els.slash.hidden = true;
    slashIndex = -1;
  }

  function applySlash(type) {
    var index = slashIndex;
    hideSlash();
    if (index < 0) return;
    var block = state.blocks[index];
    if (!block) return;
    if (type === "photo-text") {
      lazy("photo-text").then(function (feature) { feature.open(block.id); })
        .catch(function () { window.alert("사진 도구를 불러오지 못했어요. 새로고침해 주세요."); });
      return;
    }
    block.type = type;
    if (type === "db_ref") {
      var target = window.prompt("연결할 데이터베이스 슬러그 (예: mcp-master-facet)");
      if (!target || !target.trim()) { block.type = "paragraph"; return; }
      block.meta = { database: target.trim() };
      block.text = "";
    }
    if (easy) easy.remember(type);
    if (/^\/[^\s/]{0,12}$/.test(block.text)) { block.text = ""; if (block.meta) delete block.meta.richText; }
    if (type === "database") {
      block.meta = { columns: ["상태", "담당", "다음 할 일"], rows: [], view: "table" };
      block.text = "";
    } else if (BLOCK_DEFAULTS[type]) {
      block.meta = BLOCK_DEFAULTS[type]().meta;
    } else if (MEDIA_TYPES[type] || type === "toc" || type === "breadcrumb") {
      block.text = "";
    }
    render();
    if (type !== "divider" && type !== "database" && !MEDIA_TYPES[type] && type !== "toc" && type !== "breadcrumb") focusBlock(block.id);
    scheduleSave();
  }

  document.addEventListener("keydown", function (ev) {
    if (selectedIds.size && (ev.key === "Delete" || ev.key === "Backspace") && !ev.target.closest('[contenteditable="true"],input,textarea')) {
      ev.preventDefault();
      var remove = new Set();
      state.blocks.forEach(function (block, index) { if (selectedIds.has(block.id)) for (var i = index; i < model.endOf(state.blocks, index); i += 1) remove.add(state.blocks[i].id); });
      state.blocks = state.blocks.filter(function (block) { return !remove.has(block.id); }); selectedIds.clear(); render(); scheduleSave(); undoToast("블록 " + remove.size + "개를 지웠어요"); return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) restoreEdit(redoStack, undoStack); else restoreEdit(undoStack, redoStack);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); restoreEdit(redoStack, undoStack); return; }
    if (els.slash.hidden) return;
    var buttons = Array.prototype.slice.call(els.slash.querySelectorAll("button"));
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      slashSel = (slashSel + (ev.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
      buttons.forEach(function (button, i) { button.classList.toggle("sel", i === slashSel); });
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      var entry = slashItems[slashSel];
      if (entry) applySlash(entry.type);
    } else if (ev.key === "Escape") {
      hideSlash();
    }
  });

  var ctxIndex = -1;

  function openCtx(anchor, index) {
    ctxIndex = index;
    var rect = anchor.getBoundingClientRect();
    els.ctx.style.left = Math.min(rect.left, window.innerWidth - 280) + "px";
    els.ctx.style.top = Math.min(rect.bottom + 4, window.innerHeight - 320) + "px";
    var block = state.blocks[index];
    var actions = [
      ["위로 올리기", function () { move(index, -1); undoToast("블록을 옮겼어요"); }],
      ["아래로 내리기", function () { move(index, 1); undoToast("블록을 옮겼어요"); }],
      ["들여쓰기", function () { indent(index, 1); }],
      ["내어쓰기", function () { indent(index, -1); }],
      ["복제", function () { var copies = JSON.parse(JSON.stringify(state.blocks.slice(index, model.endOf(state.blocks, index)))); copies.forEach(function (copy) { copy.id = uid(); }); state.blocks.splice.apply(state.blocks, [model.endOf(state.blocks, index), 0].concat(copies)); render(); scheduleSave(); }],
      ["블록 링크 복사", function () { navigator.clipboard.writeText(location.origin + "/edit/" + encodeURIComponent(slug) + "/#block-" + encodeURIComponent(block.id)).then(function () { setSave("블록 링크 복사됨", false); }).catch(function (error) { setSave("복사 실패: " + error.message, true); }); }],
      ["종류 바꾸기", function () { openSlash(anchor, index); }],
      ["댓글", function () { if (pageContext) pageContext.comments(block.id); }],
      ["삭제", function () { state.blocks.splice(index, model.endOf(state.blocks, index) - index); render(); scheduleSave(); undoToast("블록을 지웠어요"); }]
    ];
    els.ctx.innerHTML = "<h3>블록</h3>";
    actions.forEach(function (pair) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = pair[0];
      if (pair[0] === "삭제") button.className = "danger";
      button.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      button.addEventListener("click", function (ev) { ev.stopPropagation(); els.ctx.hidden = true; pair[1](); });
      els.ctx.appendChild(button);
    });
    els.ctx.hidden = false;
  }

  function move(index, delta) {
    var target = delta < 0 ? index - 1 : model.endOf(state.blocks, index);
    if (target < 0 || target >= state.blocks.length) return;
    if (delta > 0) target = model.endOf(state.blocks, target);
    if (!model.move(state.blocks, index, target, model.depth(state.blocks[index]))) return;
    render();
    scheduleSave();
  }

  function indent(index, delta) {
    if (!model.indent(state.blocks, index, delta)) return;
    render();
    scheduleSave();
  }

  function moveSelection(index, target, targetDepth) {
    if (!selectedIds.has(state.blocks[index].id) || selectedIds.size < 2) return model.move(state.blocks, index, target, targetDepth);
    var roots = [], covered = new Set();
    state.blocks.forEach(function (block, i) {
      if (!selectedIds.has(block.id) || covered.has(i)) return;
      var end = model.endOf(state.blocks, i);
      roots.push({ start: i, end: end, blocks: state.blocks.slice(i, end) });
      for (var n = i; n < end; n += 1) covered.add(n);
    });
    if (covered.has(target)) return false;
    var position = target - Array.from(covered).filter(function (i) { return i < target; }).length;
    var remaining = state.blocks.filter(function (_block, i) { return !covered.has(i); });
    var max = position ? model.depth(remaining[position - 1]) + 1 : 0;
    var depth = Math.min(targetDepth, max), moving = [];
    roots.forEach(function (branch) { var offset = depth - model.depth(branch.blocks[0]); branch.blocks.forEach(function (block) { block.indent = model.depth(block) + offset; moving.push(block); }); });
    remaining.splice.apply(remaining, [position, 0].concat(moving)); state.blocks = remaining; return true;
  }

  function wireDrag(handle, row, block) {
    var start = null, target = null, dragged = false;
    handle.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      start = { x: ev.clientX, y: ev.clientY };
      dragged = false;
      handle.setPointerCapture(ev.pointerId);
    });
    handle.addEventListener("pointermove", function (ev) {
      if (!start || Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      dragged = true;
      row.classList.add("dragging");
      if (target) target.classList.remove("drop-before", "drop-after");
      var hit = document.elementFromPoint(ev.clientX, ev.clientY);
      target = hit && hit.closest(".blk");
      if (!target || target === row || row.contains(target)) { target = null; return; }
      var rect = target.getBoundingClientRect();
      target.classList.add(ev.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
    });
    function finish(ev) {
      row.classList.remove("dragging");
      if (target) {
        var index = state.blocks.findIndex(function (item) { return item.id === block.id; });
        var destination = Number(target.dataset.index);
        var after = target.classList.contains("drop-after");
        var targetDepth = model.depth(state.blocks[destination]);
        target.classList.remove("drop-before", "drop-after");
        if (ev.type !== "pointercancel" && moveSelection(index, after ? model.endOf(state.blocks, destination) : destination, targetDepth)) {
          render(); scheduleSave();
        }
      }
      start = null; target = null;
    }
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("click", function (ev) { if (dragged) { ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);
  }

  document.addEventListener("click", function (ev) {
    if (!els.slash.hidden && !els.slash.contains(ev.target) && !els.ctx.contains(ev.target)) hideSlash();
    if (!els.ctx.hidden && !els.ctx.contains(ev.target)) els.ctx.hidden = true;
  });

  function loadTree() {
    return api("/tree").then(function (data) {
      state.pages = data.pages || [];
      renderTree();
    }).catch(function () {});
  }

  function renderTree() {
    var known = {};
    state.pages.forEach(function (page) { known[page.slug] = true; });
    var roots = state.pages.filter(function (page) { return !page.parent || !known[page.parent]; });
    els.tree.innerHTML = "";
    var favorites = state.pages.filter(function (page) { return page.favorite; });
    if (favorites.length) {
      var heading = document.createElement("h3"); heading.textContent = "즐겨찾기"; els.tree.appendChild(heading);
      els.tree.appendChild(treeList(favorites, true));
    }
    els.tree.appendChild(treeList(roots));
  }

  function treeList(pages, flat) {
    var ul = document.createElement("ul");
    ul.className = "tree";
    pages.forEach(function (page) {
      var li = document.createElement("li");
      var row = document.createElement("div");
      row.className = "row";
      var link = document.createElement("a");
      link.href = "/edit/" + encodeURIComponent(page.slug) + "/";
      link.textContent = (page.icon ? page.icon + " " : "") + page.title;
      if (page.slug === slug) link.className = "on";
      if (page.kind === "db") {
        var mark = document.createElement("span");
        mark.className = "dbmark";
        mark.textContent = "표";
        link.appendChild(mark);
      }
      var more = document.createElement("button");
      more.type = "button";
      more.className = "more";
      more.textContent = "⋯";
      more.setAttribute("aria-label", "페이지 메뉴");
      more.addEventListener("click", function (ev) { ev.preventDefault(); pageMenu(more, page); });
      row.appendChild(link);
      row.appendChild(more);
      li.appendChild(row);
      var children = state.pages.filter(function (child) { return child.parent === page.slug; });
      if (children.length && !flat) li.appendChild(treeList(children));
      ul.appendChild(li);
    });
    return ul;
  }

  function pageMenu(anchor, page) {
    var rect = anchor.getBoundingClientRect();
    els.ctx.style.left = Math.min(rect.left - 180, window.innerWidth - 280) + "px";
    els.ctx.style.top = Math.min(rect.bottom + 4, window.innerHeight - 300) + "px";
    els.ctx.replaceChildren();
    var heading = document.createElement("h3"); heading.textContent = page.title; els.ctx.appendChild(heading);

    function item(label, fn) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("mousedown", function (ev) { ev.preventDefault(); els.ctx.hidden = true; fn(); });
      els.ctx.appendChild(button);
      if (label === "삭제") button.className = "danger";
    }

    item("이름 바꾸기", function () { renameInline(page); });
    item("여기 아래로 옮기기", function () { pickParent(page); });
    if (page.parent) item("맨 위로 옮기기", function () {
      api("/page/" + encodeURIComponent(page.slug) + "/move", { method: "POST", body: JSON.stringify({ parent: null }) }).then(loadTree);
    });
    item("삭제", function () {
      if (!window.confirm(page.title + " 페이지를 지울까요?")) return;
      api("/page/" + encodeURIComponent(page.slug), { method: "DELETE" }).then(function () {
        if (page.slug === slug) location.href = "/";
        else loadTree();
      });
    });
    els.ctx.hidden = false;
  }

  function renameInline(page) {
    var link = els.tree.querySelector('a[href="/edit/' + encodeURIComponent(page.slug) + '/"]');
    if (!link) return;
    var input = document.createElement("input");
    input.className = "rename";
    input.value = page.title;
    link.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      var title = input.value.trim();
      if (!title || title === page.title) { loadTree(); return; }
      api("/page/" + encodeURIComponent(page.slug) + "/rename", { method: "POST", body: JSON.stringify({ title: title }) })
        .then(function () {
          if (page.slug === slug) { state.title = title; els.title.value = title; }
          return loadTree();
        });
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
      if (ev.key === "Escape") { input.value = page.title; input.blur(); }
    });
  }

  function pickParent(page) {
    var select = document.createElement("select");
    select.className = "rename";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "(맨 위)";
    select.appendChild(none);
    state.pages.forEach(function (other) {
      if (other.slug === page.slug) return;
      var option = document.createElement("option");
      option.value = other.slug;
      option.textContent = other.title;
      select.appendChild(option);
    });
    var link = els.tree.querySelector('a[href="/edit/' + encodeURIComponent(page.slug) + '/"]');
    if (!link) return;
    link.replaceWith(select);
    select.focus();
    select.addEventListener("change", function () {
      var move = function (confirmShare) {
        return api("/page/" + encodeURIComponent(page.slug) + "/move", { method: "POST", body: JSON.stringify({ parent: select.value || null, confirmShare: confirmShare }) });
      };
      move(false).catch(function (error) {
        if (!/공유됩니다/.test(error.message) || !window.confirm(error.message + "\n\n그래도 옮길까요?")) throw error;
        return move(true);
      }).then(loadTree, function (error) { setSave(error.message, true); loadTree(); });
    });
    select.addEventListener("blur", function () { loadTree(); });
  }

  function loadBacklinks() {
    return api("/backlinks?slug=" + encodeURIComponent(slug)).then(function (data) {
      var list = data.backlinks || [];
      if (!list.length) { els.backlinks.hidden = true; return; }
      els.backlinks.innerHTML = "<h3>이 페이지를 가리키는 곳</h3>";
      list.forEach(function (entry) { var a = document.createElement("a"); a.href = "/edit/" + encodeURIComponent(entry.slug) + "/"; a.textContent = entry.title || entry.slug; els.backlinks.appendChild(a); });
      els.backlinks.hidden = false;
    }).catch(function () {});
  }

  els.title.addEventListener("input", function () { state.title = els.title.value; scheduleSave(); });

  document.getElementById("add-block").addEventListener("click", function () {
    var block = newBlock();
    state.blocks.push(block);
    render();
    focusBlock(block.id);
    scheduleSave();
  });

  // New pages open untitled with the cursor in the title field (no blocking window.prompt - #18).
  function newPage() {
    api("/pages", { method: "POST", body: JSON.stringify({ title: "제목 없음" }) }).then(function (page) {
      location.href = "/edit/" + encodeURIComponent(page.slug) + "/?new";
    });
  }
  document.getElementById("new-page").addEventListener("click", newPage);

  els.menu.addEventListener("click", function () {
    var open = els.sidebar.classList.toggle("open");
    els.menu.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // --- 더보기 메뉴 + 노션 내보내기 가져오기 ---
  var moreBtn = document.getElementById("more");
  var moreMenu = document.getElementById("more-menu");
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener("click", function () {
      var open = moreMenu.hidden;
      moreMenu.hidden = !open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (ev) {
      if (moreMenu.hidden) return;
      if (!moreBtn.contains(ev.target) && !moreMenu.contains(ev.target)) {
        moreMenu.hidden = true;
        moreBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  var importDialog = document.getElementById("import-dialog");
  var importFile = document.getElementById("import-file");
  var importGo = document.getElementById("import-go");
  var importStatus = document.getElementById("import-status");
  var importOpen = document.getElementById("import-open");
  var importClose = document.getElementById("import-close");

  function setImportStatus(text, busy) {
    if (!importStatus) return;
    importStatus.textContent = text;
    importStatus.classList.toggle("busy", !!busy);
  }

  function runImport() {
    if (!importFile || !importFile.files || !importFile.files[0]) {
      setImportStatus("zip 파일을 골라 주세요.", false);
      return;
    }
    var file = importFile.files[0];
    if (file.size > 30 * 1024 * 1024) {
      setImportStatus("파일이 너무 커요. 30MB 아래로 나눠 주세요.", false);
      return;
    }
    setImportStatus("가져오는 중… (" + Math.round(file.size / 1024) + " KB)", true);
    if (importGo) importGo.disabled = true;
    file.arrayBuffer().then(function (buffer) {
      return net("/api/import", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: buffer,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || String(res.status));
          return body;
        });
      });
    }).then(function (body) {
      var lines = [];
      if (body.imported) lines.push("페이지 " + body.imported + "개를 가져왔어요.");
      if (body.warnings && body.warnings.length) lines.push("알림: " + body.warnings.join(" / "));
      if (body.skipped && body.skipped.length) lines.push("건너뛴 파일 " + body.skipped.length + "개");
      setImportStatus(lines.join(" ") || "가져올 페이지를 찾지 못했어요.", false);
      if (body.imported) {
        loadTree();
        var first = (body.pages || [])[0];
        if (first && first.slug) {
          window.setTimeout(function () {
            location.href = "/edit/" + encodeURIComponent(first.slug) + "/";
          }, 900);
        }
      }
    }).catch(function (error) {
      setImportStatus("가져오기 실패: " + error.message, false);
    }).then(function () {
      if (importGo) importGo.disabled = false;
    });
  }

  if (importOpen) importOpen.addEventListener("click", function () {
    if (moreMenu) moreMenu.hidden = true;
    importDialog.hidden = false;
    setImportStatus("", false);
    if (importFile) importFile.focus();
  });
  if (importClose) importClose.addEventListener("click", function () { importDialog.hidden = true; });
  if (importDialog) importDialog.addEventListener("mousedown", function (ev) {
    if (ev.target === importDialog) importDialog.hidden = true;
  });
  if (importGo) importGo.addEventListener("click", runImport);

  var importMdFile = document.getElementById("import-md-file");
  var importMdGo = document.getElementById("import-md-go");
  function runMarkdownImport() {
    if (!importMdFile || !importMdFile.files || !importMdFile.files.length) {
      setImportStatus("마크다운 파일을 골라 주세요.", false);
      return;
    }
    var form = new FormData();
    var names = [];
    for (var i = 0; i < importMdFile.files.length; i++) {
      var f = importMdFile.files[i];
      if (f.size > 2 * 1024 * 1024) { setImportStatus(f.name + " 이 너무 커요. 2MB 아래로 나눠 주세요.", false); return; }
      form.append("file", f);
      names.push(f.name);
    }
    setImportStatus("가져오는 중… (" + names.length + "개 파일)", true);
    if (importMdGo) importMdGo.disabled = true;
    net("/api/import/md", { method: "POST", body: form })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (body) { if (!res.ok) throw new Error(body.error || String(res.status)); return body; }); })
      .then(function (body) {
        var lines = [];
        if (body.imported) lines.push("페이지 " + body.imported + "개를 가져왔어요.");
        if (body.warnings && body.warnings.length) lines.push("알림: " + body.warnings.join(" / "));
        setImportStatus(lines.join(" ") || "가져올 페이지를 찾지 못했어요.", false);
        if (body.imported) {
          loadTree();
          var first = (body.pages || [])[0];
          if (first && first.slug) window.setTimeout(function () { location.href = "/edit/" + encodeURIComponent(first.slug) + "/"; }, 900);
        }
      })
      .catch(function (error) { setImportStatus("가져오기 실패: " + error.message, false); })
      .then(function () { if (importMdGo) importMdGo.disabled = false; });
  }
  if (importMdGo) importMdGo.addEventListener("click", runMarkdownImport);

  // --- 키보드 단축키 ---
  var shortcutsEl = document.getElementById("shortcuts");
  var shortcutsOpen = document.getElementById("shortcuts-open");
  var shortcutsClose = document.getElementById("shortcuts-close");
  if (shortcutsOpen) shortcutsOpen.addEventListener("click", function () {
    if (moreMenu) moreMenu.hidden = true;
    shortcutsEl.hidden = false;
    var close = document.getElementById("shortcuts-close");
    if (close) close.focus();
  });
  if (shortcutsClose) shortcutsClose.addEventListener("click", function () { shortcutsEl.hidden = true; });
  if (shortcutsEl) shortcutsEl.addEventListener("mousedown", function (ev) {
    if (ev.target === shortcutsEl) shortcutsEl.hidden = true;
  });

  // --- 빠른 검색 팔레트 ---
  var palette = document.getElementById("palette");
  var paletteInput = document.getElementById("palette-q");
  var paletteList = document.getElementById("palette-list");
  var paletteItems = [];
  var paletteSel = 0, pSeq = 0, pWait, pGo;
  var RECENT_KEY = "dori-notes-recent";
  var recents = [];
  try { recents = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) { recents = []; }

  function renderPalette() {
    if (!paletteList) return;
    paletteList.ariaBusy = !!pWait;
    if (!paletteItems.length) { paletteList.innerHTML = pWait ? "" : '<p class="pnone">결과가 없어요.</p>'; return; }
    paletteList.innerHTML = paletteItems.map(function (item, i) {
      var href = "/edit/" + encodeURIComponent(item.slug) + "/";
      return '<a role="option" data-i="' + i + '" href="' + href + '"' + (i === paletteSel ? ' class="on"' : "") + ">" +
        "<span class=\"pt\">" + (item.title || item.slug) + "</span>" +
        (item.kind === "db" ? '<span class=\"dbmark\">표</span>' : "") +
        (item.snippet ? '<span class=\"ps\">' + item.snippet + "</span>" : "") +
        "</a>";
    }).join("");
  }
  function searchPalette(q) {
    var query = q.trim().toLowerCase(), asked = pSeq;
    pWait = query;
    if (!query) {
      paletteItems = recents.map(function (r) { return { slug: r.slug, title: r.title, snippet: "최근 본 페이지" }; }).slice(0, 8);
      paletteSel = 0;
      renderPalette();
      return;
    }
    net("/api/search?q=" + encodeURIComponent(q)).then(function (r) { return r.ok ? r.json() : { results: [] }; }).catch(Object).then(function (data) {
      if (asked != pSeq) return;
      pWait = 0;
      paletteItems = (data.results || []).map(function (hit) {
        var text = hit.hit || "";
        return { slug: hit.slug, title: hit.title, snippet: text.length > 90 ? text.slice(0, 90) + "…" : text, kind: hit.kind };
      }).slice(0, 12);
      paletteSel = 0;
      renderPalette();
      if (pGo) followSelected();
    });
  }
  function openPalette() {
    if (!palette) return;
    palette.hidden = false;
    if (paletteInput) { paletteInput.value = ""; paletteInput.focus(); }
    pSeq++; pGo = 0;
    searchPalette("");
  }
  function followSelected() {
    var item = !(pGo = pWait) && paletteItems[paletteSel];
    if (!item) return;
    location.href = "/edit/" + encodeURIComponent(item.slug) + "/";
  }
  var paletteOpenBtn = document.getElementById("palette-open");
  if (paletteOpenBtn) paletteOpenBtn.addEventListener("click", openPalette);
  if (paletteInput) {
    var ptimer = null;
    paletteInput.addEventListener("input", function () {
      if (ptimer) clearTimeout(ptimer);
      pSeq++; pWait = 1; paletteItems = []; renderPalette();
      ptimer = setTimeout(function () { searchPalette(paletteInput.value); }, 180);
    });
    paletteInput.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") { ev.preventDefault(); paletteSel = Math.min(paletteSel + 1, paletteItems.length - 1); renderPalette(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); paletteSel = Math.max(paletteSel - 1, 0); renderPalette(); }
      else if (ev.key === "Enter") { ev.preventDefault(); followSelected(); }
      else if (ev.key === "Escape") { ev.preventDefault(); palette.hidden = true; pSeq++; }
    });
  }
  if (paletteList) paletteList.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a") : null;
    if (!a) return;
    ev.preventDefault();
    location.href = a.getAttribute("href");
  });
  if (palette) palette.addEventListener("mousedown", function (ev) {
    if (ev.target === palette) palette.hidden = true;
  });

  // --- 전역 단축키 ---
  document.addEventListener("keydown", function (ev) {
    var mod = ev.ctrlKey || ev.metaKey;
    // 블록 서식: Ctrl/Cmd + B(굵게) / I(기울임) / U(밑줄) / Shift+U(취소선) / E(코드)
    var sel = window.getSelection();
    var inText = sel && sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest(".text");
    if (mod && inText && (ev.key === "b" || ev.key === "B" || ev.key === "i" || ev.key === "I" || ev.key === "u" || ev.key === "U" || ev.key === "e" || ev.key === "E")) {
      ev.preventDefault();
      if (ev.key === "b" || ev.key === "B") document.execCommand("bold");
      else if (ev.key === "i" || ev.key === "I") document.execCommand("italic");
      else if (ev.key === "u" || ev.key === "U" && ev.shiftKey) document.execCommand("strikeThrough");
      else if (ev.key === "u" || ev.key === "U") document.execCommand("underline");
      else if (ev.key === "e" || ev.key === "E") document.execCommand("insertHTML", false, "<code>" + (sel.toString() || "코드") + "</code>");
      scheduleSave();
      return;
    }
    // Ctrl/Cmd + N: 새 페이지
    if (mod && (ev.key === "n" || ev.key === "N")) {
      ev.preventDefault();
      newPage();
      return;
    }
    if (mod && (ev.key === "k" || ev.key === "K")) {
      ev.preventDefault();
      if (!palette.hidden) palette.hidden = true; else openPalette();
      return;
    }
    if (mod && ev.key === "/") {
      ev.preventDefault();
      if (!shortcutsEl.hidden) shortcutsEl.hidden = true; else shortcutsEl.hidden = false;
      return;
    }
    if (ev.key === "Escape") {
      palette.hidden = true;
      shortcutsEl.hidden = true;
      importDialog.hidden = true;
      if (moreMenu) moreMenu.hidden = true;
    }
  });

  document.getElementById("theme").addEventListener("click", function () {
    var current = document.documentElement.getAttribute("data-theme") || "auto";
    var next = current === "auto" ? "dark" : current === "dark" ? "light" : "auto";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  window.addEventListener("beforeunload", function (ev) {
    if (!state.dirty) return;
    save().catch(function (error) { setSave("저장 실패: " + error.message, true); });
    ev.preventDefault();
    ev.returnValue = "";
  });

  var previewHash;
  function previewPage(data) {
    previewHash = JSON.stringify(data);
    state.title = data.page.title;
    state.blocks = data.blocks || [];
    els.title.value = state.title;
    render();
  }
  // Seed sync takes seconds and rarely changes anything; load the page now and refetch only if sync imported or updated pages.
  var pageUrl = "/page/" + encodeURIComponent(slug);
  var synced = api("/sync", { method: "POST" }).catch(function () { return null; });
  var serverPage = api(pageUrl);
  loadTree();
  synced.then(function (sync) {
    if (!sync || !(sync.imported || sync.updated)) return;
    loadTree();
    // A seed update can rewrite this page; take the new copy only if the owner has not typed yet.
    serverPage.then(function (first) { return api(pageUrl).then(function (next) { if (!state.dirty && JSON.stringify(next) !== JSON.stringify(first)) location.reload(); }); }).catch(function () {});
  });
  els.title.placeholder = "불러오는 중…";
  els.title.setAttribute("aria-busy", "true");
  serverPage.catch(function () {});
  new Promise(function (resolve) {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  }).then(function () {
    return lazy("recent-cache").then(function (cache) {
      return cache.load(serverPage, previewPage, function (data) { state.pages = data.pages || []; renderTree(); });
    }, function () { return serverPage; });
  })
    .then(function (data) {
      state.title = data.page.title;
      state.kind = data.page.kind;
      state.dbRow = data.dbRow || null;
      var same = previewHash === JSON.stringify(data) && state.blocks.length;
      if (!same) state.blocks = (data.blocks || []).length ? data.blocks : [newBlock()];
      previousSnapshot = snapshot();
      els.title.value = state.title;
      els.title.placeholder = "제목 없음";
      els.title.removeAttribute("aria-busy");
      if (/[?&]new(&|=|$)/.test(location.search) && state.title === "제목 없음") {
        els.title.value = "";
        els.title.focus();
      }
      document.getElementById("viewlink").href = "/" + (slug === "index" ? "" : slug + "/");
      document.title = state.title + " 고치기 · " + window.DoriSite.name;
      els.meta.textContent = (data.page.source === "markdown" ? "AI가 쓴 페이지" : "직접 고친 페이지") + " · 블록 " + state.blocks.length + "개";
      if (!same) render();
      if (state.kind === "db" && window.DoriDB) {
        els.blocks.hidden = true;
        document.getElementById("add-block").hidden = true;
        var dbRoot = document.createElement("div");
        dbRoot.id = "db-root";
        els.blocks.parentNode.insertBefore(dbRoot, els.blocks);
        window.DoriDB.load(slug, { mountId: "db-root", titleInput: els.title });
      } else if (state.dbRow && data.database && window.DoriDB) {
        var rowProps = document.createElement("div");
        rowProps.id = "db-row-props";
        els.blocks.parentNode.insertBefore(rowProps, els.blocks);
        window.DoriDB.loadRow(data.database.database.slug, state.dbRow, "db-row-props");
      }
      pageContext = { api: api, slug: slug, state: state, save: save, setSave: setSave, loadTree: loadTree };
      window.mountEditorPages(pageContext);
      formatContext = { state: state, scheduleSave: scheduleSave };
      window.mountEditorFormat(formatContext);
      if (location.hash.indexOf("#block-") === 0) {
        var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (target) { var parent = target.parentElement; while (parent) { parent.classList.remove("collapsed"); parent = parent.parentElement; } target.scrollIntoView(); }
      }
      loadBacklinks();
      setSave("저장됨", false);
      featureReady = true;
      emitFeature("ready", window.AcardEditor);
    })
    .catch(function (error) {
      setSave(state.cacheLocked && !navigator.onLine ? "오프라인 · 읽기 전용. 다시 연결한 뒤 새로고침해 주세요." : "불러오기 실패: " + error.message, true);
    });
})();
