/* 에이전트 연결 설정 페이지.
   서버가 준 값은 전부 textContent / DOM 으로만 그린다 (innerHTML 없음).
   API: GET/POST /api/agents/tokens, DELETE /api/agents/tokens/{id},
        GET /api/agents/grants, DELETE /api/agents/grants/{id}, GET /api/agents/connect */
(function () {
  "use strict";
  var root = document.documentElement;
  var THEME_KEY = "dori-notes-theme";

  function $(id) { return document.getElementById(id); }

  // ----- 테마: app.js 와 같은 규칙 (auto -> light -> dark -> auto, 같은 저장 키) -----
  var stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (e) { stored = null; }
  root.setAttribute("data-theme", stored === "light" || stored === "dark" ? stored : "auto");
  function themeLabel(mode) { return mode === "light" ? "라이트" : mode === "dark" ? "다크" : "시스템"; }
  function paintTheme() {
    var mode = root.getAttribute("data-theme") || "auto";
    var btn = $("theme");
    if (!btn) return;
    btn.title = "테마: " + themeLabel(mode) + " (클릭해서 바꾸기)";
    btn.setAttribute("aria-label", "테마 " + themeLabel(mode));
  }
  paintTheme();
  var themeBtn = $("theme");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") || "auto";
      var next = current === "auto" ? "light" : current === "dark" ? "auto" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      paintTheme();
    });
  }

  // ----- 사이드바 서랍 (모바일) -----
  var menuBtn = $("menu");
  var sidebar = $("sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", function () {
      var open = !sidebar.classList.contains("open");
      sidebar.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // ----- DOM 도우미 -----
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "className") node.className = v;
        else if (k === "text") node.textContent = v;
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ----- 서버 호출: 실패하면 서버가 준 error 문장을 그대로 던진다 -----
  function api(method, path, body) {
    var opts = { method: method, headers: { "Accept": "application/json" }, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) {
          var msg = data && typeof data.error === "string" && data.error
            ? data.error
            : res.status === 401 ? "로그인이 풀렸어요. 페이지를 새로 고친 뒤 다시 해 보세요."
            : "요청이 실패했어요 (" + res.status + ")";
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return data || {};
      });
    }, function () {
      throw new Error("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
    });
  }

  // ----- 날짜 -----
  function fmtDate(ms) {
    if (!ms) return "모름";
    var d = new Date(ms);
    var s = (d.getMonth() + 1) + "월 " + d.getDate() + "일";
    return d.getFullYear() === new Date().getFullYear() ? s : d.getFullYear() + "년 " + s;
  }
  function fmtAgo(ms) {
    var diff = Date.now() - ms;
    if (diff < 60e3) return "방금 전";
    var m = Math.floor(diff / 60e3);
    if (m < 60) return m + "분 전";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "시간 전";
    var d = Math.floor(h / 24);
    if (d < 30) return d + "일 전";
    return fmtDate(ms);
  }
  function hasWrite(scopes) { return Array.isArray(scopes) && scopes.indexOf("write") >= 0; }
  function scopeLabel(scopes) { return hasWrite(scopes) ? "읽기·쓰기" : "읽기만"; }

  // ----- 복사 · 알림 -----
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2200);
  }
  function flash(btn, label) {
    var original = btn.getAttribute("data-label") || btn.textContent;
    btn.setAttribute("data-label", original);
    btn.textContent = label;
    if (btn._flashTimer) clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(function () { btn.textContent = original; }, 1600);
  }
  function copyText(text, btn) {
    function done() { flash(btn, "복사됨"); toast("복사했어요."); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done();
      else toast("복사가 안 됐어요. 글자를 직접 선택해서 복사해 주세요.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }
  function copyButton(getText, small) {
    var btn = el("button", { type: "button", className: "ag-btn" + (small ? " ag-small" : ""), text: "복사" });
    btn.addEventListener("click", function () { copyText(getText(), btn); });
    return btn;
  }

  // ----- 상태 -----
  var state = {
    tokens: null,
    grants: null,
    connect: null,     // { endpoints, clients }
    clientId: null,
    freshToken: null,  // 이 페이지에서 방금 만든 토큰 (화면 안에서만 쓴다)
    fillToken: false
  };

  function loadError(container, prefix, err, retry) {
    clear(container);
    var row = el(container.tagName === "UL" ? "li" : "div", { className: "ag-row" });
    row.appendChild(el("p", { className: "ag-error", text: prefix + " " + err.message }));
    var btn = el("button", { type: "button", className: "ag-btn ag-small", text: "다시 시도" });
    btn.addEventListener("click", retry);
    row.appendChild(btn);
    container.appendChild(row);
  }
  function rowError(row, msg) {
    var old = row.querySelector(".ag-error");
    if (old) old.parentNode.removeChild(old);
    row.appendChild(el("p", { className: "ag-error", role: "alert", text: msg }));
  }

  // ===== 1. 에이전트 토큰 =====
  function loadTokens() {
    var list = $("token-list");
    clear(list);
    list.appendChild(el("li", { className: "ag-loading", text: "불러오는 중…" }));
    return api("GET", "/api/agents/tokens").then(function (data) {
      state.tokens = Array.isArray(data.tokens) ? data.tokens : [];
      renderTokens();
    }, function (err) {
      loadError(list, "토큰 목록을 불러오지 못했어요:", err, loadTokens);
    });
  }
  function renderTokens() {
    var list = $("token-list");
    clear(list);
    if (!state.tokens.length) {
      list.appendChild(el("li", { className: "ag-empty", text: "아직 만든 토큰이 없어요. 아래에서 하나 만들어 보세요." }));
      return;
    }
    var items = state.tokens.slice().sort(function (a, b) {
      var ra = a.revoked ? 1 : 0, rb = b.revoked ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return (b.created || 0) - (a.created || 0);
    });
    items.forEach(function (t) {
      var off = !!t.revoked;
      var li = el("li", { className: "ag-row" + (off ? " off" : ""), "data-id": t.id });
      var main = el("div", { className: "ag-main" });
      var name = el("div", { className: "ag-name" });
      name.appendChild(el("span", { text: t.name || "(이름 없음)" }));
      name.appendChild(el("span", { className: "ag-badge" + (hasWrite(t.scopes) ? " accent" : ""), text: scopeLabel(t.scopes) }));
      main.appendChild(name);
      var meta = "만든 날 " + fmtDate(t.created) + " · 마지막 사용 " + (t.lastUsed ? fmtAgo(t.lastUsed) : "아직 없음");
      if (off) meta += " · " + fmtDate(t.revoked) + "에 끊음";
      main.appendChild(el("div", { className: "ag-meta", text: meta }));
      li.appendChild(main);
      li.appendChild(el("span", { className: "ag-status" + (off ? " off" : ""), text: off ? "끊김" : "사용 중" }));
      if (!off) {
        var btn = el("button", { type: "button", className: "ag-btn ag-small", text: "끊기", "aria-label": (t.name || "토큰") + " 끊기" });
        btn.addEventListener("click", function () { revokeToken(t, btn, li); });
        li.appendChild(btn);
      }
      list.appendChild(li);
    });
  }
  function revokeToken(t, btn, li) {
    if (!window.confirm("이 에이전트는 더 이상 노트에 들어올 수 없어요. 끊을까요?")) return;
    btn.disabled = true;
    btn.textContent = "끊는 중…";
    api("DELETE", "/api/agents/tokens/" + encodeURIComponent(t.id)).then(function () {
      toast("'" + (t.name || "토큰") + "' 연결을 끊었어요.");
      return loadTokens();
    }, function (err) {
      btn.disabled = false;
      btn.textContent = "끊기";
      rowError(li, "끊지 못했어요: " + err.message);
    });
  }

  var form = $("token-form");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var nameInput = $("token-name");
    var name = nameInput.value.trim();
    var errBox = $("token-form-error");
    errBox.hidden = true;
    errBox.textContent = "";
    if (!name) {
      errBox.textContent = "이름을 적어 주세요. 어떤 에이전트인지 알아볼 수 있는 이름이면 돼요.";
      errBox.hidden = false;
      nameInput.focus();
      return;
    }
    var picked = form.querySelector('input[name="scope"]:checked');
    var scopes = picked && picked.value === "read" ? ["read"] : ["read", "write"];
    var btn = $("token-create");
    btn.disabled = true;
    btn.textContent = "만드는 중…";
    api("POST", "/api/agents/tokens", { name: name, scopes: scopes }).then(function (data) {
      if (!data || typeof data.token !== "string" || !data.token) throw new Error("서버가 토큰을 돌려주지 않았어요.");
      showFreshToken(data.token, data.record && data.record.name ? data.record.name : name);
      nameInput.value = "";
      return loadTokens();
    }).catch(function (err) {
      errBox.textContent = "만들지 못했어요: " + err.message;
      errBox.hidden = false;
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "만들기";
    });
  });

  function showFreshToken(token, name) {
    state.freshToken = token;
    var box = $("token-box");
    $("token-box-title").textContent = "'" + name + "' 토큰이 만들어졌어요";
    $("token-raw").value = token;
    box.hidden = false;
    renderDetail();
    $("token-copy").focus();
  }
  $("token-copy").addEventListener("click", function () { copyText($("token-raw").value, this); });
  $("token-raw").addEventListener("focus", function () { this.select(); });

  // ===== 2. 로그인으로 연결된 앱 =====
  function loadGrants() {
    var list = $("grant-list");
    clear(list);
    list.appendChild(el("li", { className: "ag-loading", text: "불러오는 중…" }));
    return api("GET", "/api/agents/grants").then(function (data) {
      state.grants = Array.isArray(data.grants) ? data.grants : [];
      renderGrants();
    }, function (err) {
      loadError(list, "연결된 앱 목록을 불러오지 못했어요:", err, loadGrants);
    });
  }
  function renderGrants() {
    var list = $("grant-list");
    clear(list);
    if (!state.grants.length) {
      list.appendChild(el("li", { className: "ag-empty", text: "로그인으로 연결된 앱이 아직 없어요. Claude Desktop 같은 앱에서 이 노트 주소로 로그인하면 여기에 나타나요." }));
      return;
    }
    state.grants.slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); }).forEach(function (g) {
      var li = el("li", { className: "ag-row", "data-id": g.id });
      var main = el("div", { className: "ag-main" });
      var name = el("div", { className: "ag-name" });
      name.appendChild(el("span", { text: g.clientName || "(이름 없는 앱)" }));
      name.appendChild(el("span", { className: "ag-badge" + (hasWrite(g.scopes) ? " accent" : ""), text: scopeLabel(g.scopes) }));
      main.appendChild(name);
      main.appendChild(el("div", { className: "ag-meta", text: fmtDate(g.created) + "에 연결" }));
      li.appendChild(main);
      li.appendChild(el("span", { className: "ag-status", text: "연결됨" }));
      var btn = el("button", { type: "button", className: "ag-btn ag-small", text: "끊기", "aria-label": (g.clientName || "앱") + " 끊기" });
      btn.addEventListener("click", function () { revokeGrant(g, btn, li); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }
  function revokeGrant(g, btn, li) {
    if (!window.confirm("이 앱은 더 이상 노트에 들어올 수 없어요. 끊을까요?")) return;
    btn.disabled = true;
    btn.textContent = "끊는 중…";
    api("DELETE", "/api/agents/grants/" + encodeURIComponent(g.id)).then(function () {
      toast("'" + (g.clientName || "앱") + "' 연결을 끊었어요.");
      return loadGrants();
    }, function (err) {
      btn.disabled = false;
      btn.textContent = "끊기";
      rowError(li, "끊지 못했어요: " + err.message);
    });
  }

  // ===== 3. 연결 방법 =====
  function loadConnect() {
    var picker = $("client-picker");
    var detail = $("client-detail");
    clear(picker);
    clear(detail);
    detail.appendChild(el("p", { className: "ag-loading", text: "불러오는 중…" }));
    return api("GET", "/api/agents/connect").then(function (data) {
      state.connect = {
        endpoints: data.endpoints && typeof data.endpoints === "object" ? data.endpoints : {},
        clients: Array.isArray(data.clients) ? data.clients : []
      };
      if (!findClient(state.clientId)) {
        var first = state.connect.clients.filter(function (c) { return c.status === "verified"; })[0] || state.connect.clients[0];
        state.clientId = first ? first.id : null;
      }
      renderPicker();
      renderDetail();
      renderEndpoints();
    }, function (err) {
      loadError(detail, "연결 방법을 불러오지 못했어요:", err, loadConnect);
      var grid = $("endpoint-cards");
      clear(grid);
      grid.appendChild(el("p", { className: "ag-error", text: "주소를 불러오지 못했어요: " + err.message }));
    });
  }
  function findClient(id) {
    if (!state.connect || !id) return null;
    return state.connect.clients.filter(function (c) { return c.id === id; })[0] || null;
  }
  function selectClient(id, focusTab) {
    state.clientId = id;
    renderPicker();
    renderDetail();
    if (focusTab) {
      var tab = document.getElementById("tab-" + id);
      if (tab) tab.focus();
    }
  }
  function renderPicker() {
    var picker = $("client-picker");
    clear(picker);
    if (!state.connect) return;
    var clients = state.connect.clients;
    clients.forEach(function (c) {
      var on = c.id === state.clientId;
      var tab = el("button", {
        type: "button", className: "ag-chip", role: "tab", id: "tab-" + c.id,
        "aria-selected": on ? "true" : "false", "aria-controls": "client-detail", tabindex: on ? "0" : "-1",
        text: c.name || c.id
      });
      tab.addEventListener("click", function () { selectClient(c.id, false); });
      tab.addEventListener("keydown", function (e) {
        var idx = clients.indexOf(c);
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = clients[(idx + 1) % clients.length];
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = clients[(idx - 1 + clients.length) % clients.length];
        else if (e.key === "Home") next = clients[0];
        else if (e.key === "End") next = clients[clients.length - 1];
        if (next) { e.preventDefault(); selectClient(next.id, true); }
      });
      picker.appendChild(tab);
    });
  }
  function substituted(code) {
    return state.fillToken && state.freshToken ? String(code).split("<TOKEN>").join(state.freshToken) : String(code);
  }
  function codeBlock(code) {
    var pre = el("pre", { className: "ag-code" });
    var c = el("code");
    String(code).split("<TOKEN>").forEach(function (part, i) {
      if (i > 0) c.appendChild(el("mark", { text: state.fillToken && state.freshToken ? state.freshToken : "<TOKEN>" }));
      if (part) c.appendChild(document.createTextNode(part));
    });
    pre.appendChild(c);
    return pre;
  }
  function renderDetail() {
    var detail = $("client-detail");
    if (!state.connect) return;
    clear(detail);
    var c = findClient(state.clientId);
    if (!c) {
      detail.appendChild(el("p", { className: "ag-empty", text: "아직 안내할 수 있는 앱이 없어요." }));
      return;
    }
    detail.setAttribute("aria-labelledby", "tab-" + c.id);
    var verified = c.status === "verified";
    var head = el("div", { className: "ag-detail-head" });
    head.appendChild(el("h3", { text: c.name || c.id }));
    head.appendChild(el("span", { className: "ag-badge" + (verified ? " filled" : ""), text: verified ? "검증됨" : "미검증" }));
    if (c.docUrl) head.appendChild(el("a", { className: "ag-doc", href: c.docUrl, target: "_blank", rel: "noopener noreferrer", text: "공식 안내 보기 ↗" }));
    detail.appendChild(head);
    detail.appendChild(el("p", {
      className: "ag-status-note",
      text: verified ? "검증됨: Acard 팀이 직접 연결해 보고 되는 걸 확인했어요." : "미검증: 공식 문서대로 적었지만 직접 연결해 보진 않았어요. 안 되면 공식 안내를 봐 주세요."
    }));
    if (c.note) detail.appendChild(el("p", { className: "ag-note", text: c.note }));

    var methods = Array.isArray(c.methods) ? c.methods : [];
    var usesToken = false;
    methods.forEach(function (m) {
      var code = typeof m.code === "string" ? m.code : "";
      if (code.indexOf("<TOKEN>") >= 0) usesToken = true;
      var wrap = el("div", { className: "ag-method" });
      var mh = el("div", { className: "ag-method-head" });
      mh.appendChild(el("span", { className: "ag-label", text: m.label || (m.kind === "file" ? "설정 파일에 넣기" : "터미널에서 실행") }));
      if (m.kind === "file" && m.path) mh.appendChild(el("code", { className: "ag-path", text: m.path }));
      mh.appendChild(copyButton(function () { return substituted(code); }, true));
      wrap.appendChild(mh);
      wrap.appendChild(codeBlock(code));
      detail.appendChild(wrap);
    });
    if (!methods.length) detail.appendChild(el("p", { className: "ag-empty", text: "이 앱은 아직 설정 방법이 준비되지 않았어요." }));

    if (usesToken) {
      detail.appendChild(el("p", {
        className: "ag-hint",
        text: state.fillToken && state.freshToken
          ? "방금 만든 토큰이 들어간 상태예요. 이 화면 안에서만 바꿔 보여 주고, 어디에도 보내지 않아요."
          : "<TOKEN> 자리에 위에서 만든 토큰을 넣어 주세요. 토큰은 비밀번호처럼 아무 데나 올리지 마세요."
      }));
    }
    if (state.freshToken && usesToken) {
      var fill = el("div", { className: "ag-fill" });
      var label = el("label", { className: "ag-switch" });
      var input = el("input", { type: "checkbox", id: "fill-token" });
      input.checked = state.fillToken;
      input.addEventListener("change", function () {
        state.fillToken = input.checked;
        renderDetail();
        var again = $("fill-token");
        if (again) again.focus();
      });
      label.appendChild(input);
      label.appendChild(el("span", { className: "track", "aria-hidden": "true" }));
      label.appendChild(el("span", { text: "방금 만든 토큰 넣어서 보기" }));
      fill.appendChild(label);
      detail.appendChild(fill);
    }
  }

  // ===== 4. 다른 방법 =====
  function renderEndpoints() {
    var grid = $("endpoint-cards");
    clear(grid);
    var ep = state.connect ? state.connect.endpoints : {};
    var cards = [
      { key: "mcp", title: "원격 MCP 주소", desc: "가장 간단한 방법이에요. 앱의 MCP 서버 주소 칸에 이 주소를 넣어요." },
      { key: "sse", title: "예전 방식(SSE) 주소", desc: "위 주소가 안 되는 오래된 앱에서 써요." },
      { key: "openapi", title: "OpenAPI 주소", desc: "에이전트가 이 노트의 API 목록을 스스로 읽을 때 써요." },
      { key: "cliPackage", title: "파일로 주고받기", desc: "내 컴퓨터 폴더로 노트를 내려받고(pull) 고친 걸 다시 올려요(push)." }
    ];
    var shown = 0;
    cards.forEach(function (card) {
      var value = ep[card.key];
      if (typeof value !== "string" || !value) return;
      shown++;
      var box = el("div", { className: "ag-ep" });
      box.appendChild(el("h3", { text: card.title }));
      box.appendChild(el("p", { text: card.desc }));
      var row = el("div", { className: "ag-ep-val" });
      row.appendChild(el("code", { text: value }));
      row.appendChild(copyButton(function () { return value; }, true));
      box.appendChild(row);
      grid.appendChild(box);
    });
    if (!shown) grid.appendChild(el("p", { className: "ag-empty", text: "아직 알려 줄 주소가 없어요." }));

    var docs = $("endpoint-docs");
    clear(docs);
    var links = [];
    if (typeof ep.llms === "string" && ep.llms) links.push(el("a", { href: ep.llms, target: "_blank", rel: "noopener noreferrer", text: "llms.txt" }));
    if (typeof ep.agentsMd === "string" && ep.agentsMd) links.push(el("a", { href: ep.agentsMd, target: "_blank", rel: "noopener noreferrer", text: "AGENTS.md" }));
    if (links.length) {
      docs.appendChild(document.createTextNode("에이전트에게 이 노트의 규칙을 알려 주는 문서:"));
      links.forEach(function (a, i) {
        if (i > 0) docs.appendChild(document.createTextNode(" ·"));
        docs.appendChild(a);
      });
      docs.hidden = false;
    } else {
      docs.hidden = true;
    }
  }

  // ===== 5. 개인 지침 한 줄 (예전 /connect 페이지에 있던 것) =====
  var rule = $("mcp-rule");
  if (rule) {
    rule.value = "Acard 커넥터가 연결돼 있으면 묻지 말고 모든 대화를 기록해: 대화를 시작할 때 journal_start, 매 답변 뒤에 journal_log로 1-3문장 요약, 남길 만한 내용은 Acard 노트 페이지를 만들거나 고쳐서 정리해.";
    $("mcp-rule-copy").addEventListener("click", function () { copyText(rule.value, this); });
  }

  // ===== 6. 고급: 채팅 응답 속도 (개발자용, 펼칠 때만 부른다) =====
  function sec(ms) { return ms == null ? "-" : (ms / 1000).toFixed(2) + "초"; }
  function loadLatency() {
    var t = $("latency");
    api("GET", "/api/agent/latency").then(function (d) {
      clear(t);
      var models = Array.isArray(d.models) ? d.models : [];
      if (!models.length) { t.appendChild(el("tr", {}, [el("td", { text: "아직 기록이 없어요." })])); return; }
      t.appendChild(el("tr", {}, ["모델", "횟수", "첫 글자 p50", "p95", "전체 p50"].map(function (h) { return el("th", { text: h }); })));
      models.forEach(function (m) { t.appendChild(el("tr", {}, [m.model, String(m.n), sec(m.p50Ttft), sec(m.p95Ttft), sec(m.p50Total)].map(function (v) { return el("td", { text: v }); }))); });
      t.appendChild(el("tr", { className: "ag-lat-all" }, ["전체", String(d.n), sec(d.p50Ttft), sec(d.p95Ttft), ""].map(function (v) { return el("td", { text: v }); })));
    }, function (err) {
      clear(t);
      t.appendChild(el("tr", {}, [el("td", { className: "ag-error", text: "불러오지 못했어요: " + err.message })]));
    });
  }
  var advanced = $("advanced");
  if (advanced) {
    var latencyLoaded = false;
    advanced.addEventListener("toggle", function () {
      if (advanced.open && !latencyLoaded) { latencyLoaded = true; loadLatency(); }
    });
  }

  // ----- 시작 -----
  loadTokens();
  loadGrants();
  loadConnect();
})();
