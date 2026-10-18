(function () {
  if (window.AcardProjects) return;
  window.AcardProjects = true;
  var editor = /^\/edit\//.test(location.pathname);
  var current = decodeURIComponent((location.pathname.match(/^\/(?:edit\/)?([^/]+)\/?$/) || [])[1] || "");
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function href(slug) { return (editor ? "/edit/" : "/") + encodeURIComponent(slug) + "/"; }
  function ago(t) { if (!t) return ""; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? "방금" : m < 60 ? m + "분 전" : m < 1440 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전"; }
  function api(method, path, body) {
    return fetch(path, { method: method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "실패했어요."); return d; }); });
  }
  var COLORS = ["#8b7cf6", "#4f8ef7", "#4cc38a", "#f5a524", "#ef6b8a", "#6b7280"];
  function folder(i, muted) { var s = el("span", "pj-folder"); s.style.background = muted ? "#9ca3af" : COLORS[i % COLORS.length]; s.setAttribute("aria-hidden", "true"); return s; }

  function sidebar(d) {
    var anchor = editor ? document.getElementById("tree") : document.querySelector(".side-ws");
    if (!anchor || document.querySelector(".pj-side")) return;
    var box = el("section", "pj-side");
    box.setAttribute("aria-label", "프로젝트");
    var head = el("div", "pj-side-head");
    head.appendChild(el("span", null, "프로젝트"));
    var set = el("a", "pj-side-set", "설정"); set.href = "/settings/agents/#auto-notes"; head.appendChild(set);
    box.appendChild(head);
    var ul = el("ul", "pj-side-list");
    if (!d.projects.length) ul.appendChild(el("li", "pj-empty", "Claude Code·Codex 대화가 끝나면 여기 생겨요."));
    d.projects.slice(0, 8).forEach(function (p, i) {
      var li = el("li"), a = el("a", "pj-side-row" + ([p.page, p.memoPage, p.journalPage].indexOf(current) >= 0 ? " on" : ""));
      a.href = href(p.memoPage);
      a.appendChild(folder(i, p.muted));
      a.appendChild(el("span", "pj-name", p.name));
      a.appendChild(el("small", null, p.muted ? "꺼둠" : ago(p.last)));
      li.appendChild(a); ul.appendChild(li);
    });
    box.appendChild(ul);
    anchor.parentNode.insertBefore(box, anchor);
  }

  function pageBar(d) {
    var idx = -1, mode = "";
    d.projects.forEach(function (p, i) { if (p.memoPage === current) { idx = i; mode = "memo"; } else if (p.journalPage === current) { idx = i; mode = "journal"; } });
    if (idx < 0 || document.querySelector(".pj-bar")) return;
    var p = d.projects[idx];
    var target = document.querySelector("#article .blocks") || document.getElementById("blocks") || document.getElementById("article");
    if (!target) return;
    var bar = el("div", "pj-bar");
    var sel = el("select", "pj-switch"); sel.setAttribute("aria-label", "프로젝트 바꾸기");
    d.projects.forEach(function (q) { var o = el("option", null, q.name); o.value = mode === "memo" ? q.memoPage : q.journalPage; if (q.key === p.key) o.selected = true; sel.appendChild(o); });
    sel.addEventListener("change", function () { location.href = href(sel.value); });
    var tabs = el("div", "pj-tabs"); tabs.setAttribute("role", "tablist");
    [["memo", "메모", p.memoPage], ["journal", "작업 기록", p.journalPage]].forEach(function (t) {
      var a = el("a", "pj-tab" + (t[0] === mode ? " on" : ""), t[1]); a.href = href(t[2]); a.setAttribute("role", "tab"); a.setAttribute("aria-selected", t[0] === mode ? "true" : "false"); tabs.appendChild(a);
    });
    var st = el("small", "pj-status", (!d.settings.enabled ? "자동 메모 꺼짐" : p.muted ? "이 프로젝트 꺼둠" : "자동 메모 켜짐") + " · 마지막 기록 " + (ago(p.last) || "없음"));
    bar.appendChild(sel); bar.appendChild(tabs); bar.appendChild(st);
    target.parentNode.insertBefore(bar, target);
  }

  function settingsPanel(root, d) {
    root.textContent = "";
    var card = el("div", "ag-card pj-card");
    var row = el("label", "pj-row");
    row.appendChild(el("b", null, "자동 메모 켜기"));
    var sw = el("input", "pj-sw"); sw.type = "checkbox"; sw.checked = d.settings.enabled; sw.setAttribute("role", "switch"); sw.id = "pj-enabled";
    sw.addEventListener("change", function () { api("PUT", "/api/projects/settings", { enabled: sw.checked }).then(load); });
    row.appendChild(sw); card.appendChild(row);
    var scope = el("div", "pj-row"); scope.setAttribute("role", "radiogroup"); scope.setAttribute("aria-label", "기록 범위");
    scope.appendChild(el("b", null, "기록 범위"));
    var pills = el("div", "pj-pills");
    [["memo", "메모만"], ["memo+journal", "메모+작업 기록"]].forEach(function (s) {
      var l = el("label", "pj-pill" + (d.settings.scope === s[0] ? " on" : "")), r = el("input"); r.type = "radio"; r.name = "pj-scope"; r.value = s[0]; r.checked = d.settings.scope === s[0];
      r.addEventListener("change", function () { api("PUT", "/api/projects/settings", { scope: s[0] }).then(load); });
      l.appendChild(r); l.appendChild(el("span", null, s[1])); pills.appendChild(l);
    });
    scope.appendChild(pills); card.appendChild(scope); root.appendChild(card);

    var pc = el("div", "ag-card pj-card"); pc.appendChild(el("h3", null, "프로젝트"));
    if (!d.projects.length) pc.appendChild(el("p", "ag-help", "아직 프로젝트가 없어요. acard hooks install 뒤 Claude Code·Codex 로 대화하면 저장소마다 생겨요."));
    d.projects.forEach(function (p, i) {
      var r = el("div", "pj-prow");
      r.appendChild(folder(i, p.muted));
      var a = el("a", "pj-name", p.name); a.href = "/" + encodeURIComponent(p.memoPage) + "/"; r.appendChild(a);
      r.appendChild(el("small", null, "메모 " + p.memos + "개 · " + (ago(p.last) || "기록 없음")));
      var l = el("label", "pj-mute"), m = el("input", "pj-sw"); m.type = "checkbox"; m.checked = !p.muted; m.setAttribute("role", "switch"); m.setAttribute("aria-label", p.name + " 자동 메모");
      m.addEventListener("change", function () { api("PATCH", "/api/projects/" + encodeURIComponent(p.key), { muted: !m.checked }).then(load); });
      l.appendChild(m); l.appendChild(el("span", null, p.muted ? "꺼둠" : "켜짐")); r.appendChild(l);
      pc.appendChild(r);
    });
    root.appendChild(pc);

    var bc = el("div", "ag-card pj-card pj-back");
    var txt = el("div"); txt.appendChild(el("h3", null, "예전 기록 정리")); txt.appendChild(el("p", "ag-help", "프로젝트가 생기기 전 작업 기록을 저장소 이름대로 프로젝트에 옮겨요. 언제든 되돌릴 수 있어요."));
    var out = el("p", "pj-out"); out.setAttribute("role", "status");
    var btns = el("div", "pj-btns"), dry = el("button", "ag-btn", "미리 보기"), go = el("button", "ag-btn ag-primary", "적용");
    dry.type = go.type = "button";
    dry.addEventListener("click", function () { api("POST", "/api/projects/backfill", {}).then(function (r) { out.textContent = r.count ? "옮길 기록 " + r.count + "개 → " + r.projects.join(", ") + (r.skipped ? " (프로젝트를 모르는 " + r.skipped + "개는 그대로)" : "") : "옮길 기록이 없어요."; }); });
    go.addEventListener("click", function () {
      api("POST", "/api/projects/backfill", { apply: true }).then(function (r) {
        out.textContent = r.moved + "개를 옮겼어요. ";
        if (r.moved) { var u = el("button", "ag-btn", "되돌리기"); u.type = "button"; u.addEventListener("click", function () { api("POST", "/api/projects/backfill", { undo: r.batch }).then(function (x) { out.textContent = x.restored + "개를 되돌렸어요."; load(); }); }); out.appendChild(u); }
        load();
      });
    });
    btns.appendChild(dry); btns.appendChild(go);
    bc.appendChild(txt); bc.appendChild(btns); bc.appendChild(out);
    root.appendChild(bc);
  }

  var panel = document.getElementById("auto-notes-panel");
  function load() {
    return api("GET", "/api/projects").then(function (d) {
      if (panel) { settingsPanel(panel, d); return; }
      sidebar(d); pageBar(d);
    }).catch(function () {});
  }
  load();
})();
