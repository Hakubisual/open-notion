(function () {
  if (window.AcardProjects) return;
  window.AcardProjects = true;
  var editor = /^\/edit\//.test(location.pathname);
  var current = decodeURIComponent((location.pathname.match(/^\/(?:edit\/)?([^/]+)\/?$/) || [])[1] || "");
  var identity = (document.querySelector('meta[name="acard-id"]') || {}).content, projects;
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
    var old = document.querySelector(".pj-side, .pj-side-ph");
    if (!anchor && !old) return;
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
      a.dataset.pages = JSON.stringify([p.page, p.memoPage, p.journalPage]);
      a.href = href(p.memoPage);
      a.appendChild(folder(i, p.muted));
      a.appendChild(el("span", "pj-name", p.name));
      var org = d.settings.organize || {};
      if (p.pending && (org.place === "sidebar" || org.place === "both")) { var badge = el("span", "pj-side-pend", String(p.pending)); badge.title = "정리할 것 " + p.pending + "개"; badge.setAttribute("aria-label", "정리할 것 " + p.pending + "개"); a.appendChild(badge); a.href = href(p.page); }
      a.appendChild(el("small", null, p.muted ? "꺼둠" : ago(p.last)));
      li.appendChild(a); ul.appendChild(li);
    });
    box.appendChild(ul);
    if (old) old.replaceWith(box); else anchor.parentNode.insertBefore(box, anchor);
    // The reader's first HTML reserves this height (block-html.js sideNavHtml) so the menu under it never jumps (#35).
    // Only the height is kept, never project names, so another account on this browser sees nothing of them.
    var h = !editor && anchor && Math.round((anchor.getBoundingClientRect().top - box.getBoundingClientRect().top) * 10) / 10;
    if (h > 0 && identity) { try { var key = "acard-projects-side:" + identity, c = JSON.parse(localStorage.getItem(key) || "{}"); c[innerWidth < 900 ? "hm" : "h"] = h; c.epoch = localStorage.getItem("acard-cache-epoch:" + identity) || ""; localStorage.setItem(key, JSON.stringify(c)); } catch (e) {} }
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
    sel.addEventListener("change", function () { if (!editor && window.AcardReader.navigate) window.AcardReader.navigate(href(sel.value)); else location.href = href(sel.value); });
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
    root.appendChild(organizeSettings(d.settings.organize || {}));

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

  var KIND_LABEL = { decision: "결정", todo: "할 일", fact: "알게 된 것", files: "파일", summary: "요약" };
  function toast(text, undo) {
    var old = document.querySelector(".pj-toast"); if (old) old.remove();
    var t = el("div", "pj-toast"); t.setAttribute("role", "status");
    t.appendChild(el("span", "pj-toast-ok", "✓")); t.appendChild(el("span", null, text));
    if (undo) { var u = el("button", "pj-toast-undo", "되돌리기"); u.type = "button"; u.addEventListener("click", function () { t.remove(); undo(); }); t.appendChild(el("span", "pj-toast-dot", "·")); t.appendChild(u); }
    var x = el("button", "pj-toast-x", "×"); x.type = "button"; x.setAttribute("aria-label", "닫기"); x.addEventListener("click", function () { t.remove(); }); t.appendChild(x);
    document.body.appendChild(t);
    setTimeout(function () { if (t.isConnected) t.remove(); }, 8000);
  }
  // Project home: "정리할 것 N개" - drafts from agent conversations, the user picks what goes onto the 메모 page.
  function organizeCard(p, d, mount) {
    var old = document.querySelector(".pj-org"); if (old) old.remove();
    return api("GET", "/api/projects/" + encodeURIComponent(p.key) + "/drafts").then(function (r) {
      if (!r.drafts.length) return;
      var box = el("section", "pj-org"); box.setAttribute("aria-label", "정리할 것");
      var head = el("h2", "pj-org-head"); head.appendChild(el("span", "pj-org-spark", "✦")); head.appendChild(el("span", null, "정리할 것 " + r.drafts.length + "개")); box.appendChild(head);
      var list = el("ul", "pj-org-list"), boxes = [];
      r.drafts.forEach(function (dr) {
        var li = el("li"), lab = el("label", "pj-org-item"), cb = el("input"); cb.type = "checkbox"; cb.value = dr.id; boxes.push(cb);
        lab.appendChild(cb);
        var tx = el("span", "pj-org-text"); tx.appendChild(el("b", "pj-org-kind pj-k-" + dr.kind, KIND_LABEL[dr.kind] || dr.label)); tx.appendChild(document.createTextNode(" " + dr.text)); tx.title = dr.text;
        lab.appendChild(tx); li.appendChild(lab); list.appendChild(li);
      });
      box.appendChild(list);
      var btns = el("div", "pj-org-btns"), go = el("button", "pj-org-go", "선택한 것 정리하기"), later = el("button", "pj-org-later", "나중에");
      go.type = later.type = "button";
      var sync = function () { go.disabled = !boxes.some(function (b) { return b.checked; }); };
      boxes.forEach(function (b) { b.addEventListener("change", sync); }); sync();
      go.addEventListener("click", function () {
        var ids = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
        go.disabled = true;
        api("POST", "/api/projects/" + encodeURIComponent(p.key) + "/drafts/apply", { ids: ids }).then(function (a) {
          toast("정리했어요", a.batch ? function () { api("POST", "/api/projects/" + encodeURIComponent(p.key) + "/drafts/undo", { batch: a.batch }).then(function () { toast("되돌렸어요"); organizeCard(p, d, mount); }); } : null);
          organizeCard(p, d, mount);
        }, function (e) { go.disabled = false; toast(e.message); });
      });
      later.addEventListener("click", function () { box.remove(); try { sessionStorage.setItem("pj-org-later-" + p.key, String(r.drafts.length)); } catch (e) {} });
      btns.appendChild(go); btns.appendChild(later); box.appendChild(btns);
      mount(box);
    }).catch(function () {});
  }
  function homeCard(d) {
    var org = d.settings.organize || {};
    if (org.place === "sidebar") return;
    var p = d.projects.filter(function (q) { return q.page === current; })[0];
    if (!p || !p.pending) return;
    try { if (sessionStorage.getItem("pj-org-later-" + p.key) === String(p.pending)) return; } catch (e) {}
    var target = document.querySelector("#article .blocks") || document.getElementById("blocks") || document.getElementById("article");
    if (!target) return;
    organizeCard(p, d, function (box) { if (target.isConnected) target.parentNode.insertBefore(box, target); });
  }

  function organizeSettings(o) {
    var save = function (patch) { return api("PUT", "/api/projects/settings", { organize: patch }).then(load); };
    var card = el("div", "ag-card pj-card pj-orgset"); card.id = "organize";
    card.appendChild(el("h3", null, "정리 방식"));
    card.appendChild(el("p", "ag-help", "에이전트 대화에서 나온 내용을 바로 페이지에 넣지 않고 '정리할 것'에 모아 둬요. 골라서 정리하면 메모 페이지에 들어가고, 되돌릴 수 있어요."));
    var kinds = [["decision", "결정"], ["todo", "할 일"], ["fact", "알게 된 것"], ["files", "파일"]];
    var tbl = el("div", "pj-orgk"); tbl.setAttribute("role", "group"); tbl.setAttribute("aria-label", "모을 종류");
    var hd = el("div", "pj-orgk-row pj-orgk-hd"); hd.appendChild(el("span", null, "종류")); hd.appendChild(el("span", null, "모으기")); hd.appendChild(el("span", null, "바로 넣기")); tbl.appendChild(hd);
    kinds.forEach(function (k) {
      var row = el("div", "pj-orgk-row"); row.appendChild(el("b", null, k[1]));
      [["kinds", k[1] + " 모으기"], ["direct", k[1] + " 바로 페이지에 넣기"]].forEach(function (f) {
        var sw = el("input", "pj-sw"); sw.type = "checkbox"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-label", f[1]);
        sw.checked = !!(o[f[0]] && o[f[0]][k[0]]);
        if (f[0] === "direct" && o.kinds && o.kinds[k[0]] === false) sw.disabled = true;
        sw.addEventListener("change", function () { var p = {}; p[f[0]] = {}; p[f[0]][k[0]] = sw.checked; save(p); });
        var cell = el("span"); cell.appendChild(sw); row.appendChild(cell);
      });
      tbl.appendChild(row);
    });
    card.appendChild(tbl);
    var place = el("div", "pj-row"); place.setAttribute("role", "radiogroup"); place.setAttribute("aria-label", "정리할 것 보일 곳");
    place.appendChild(el("b", null, "보일 곳"));
    var pills = el("div", "pj-pills");
    [["home", "프로젝트 홈"], ["sidebar", "사이드바"], ["both", "둘 다"]].forEach(function (s) {
      var l = el("label", "pj-pill" + (o.place === s[0] ? " on" : "")), r = el("input"); r.type = "radio"; r.name = "pj-place"; r.value = s[0]; r.checked = o.place === s[0];
      r.addEventListener("change", function () { save({ place: s[0] }); });
      l.appendChild(r); l.appendChild(el("span", null, s[1])); pills.appendChild(l);
    });
    place.appendChild(pills); card.appendChild(place);
    var nrow = el("label", "pj-row"); nrow.appendChild(el("b", null, "알림 기준"));
    var nw = el("span", "pj-orgn"), num = el("input", "pj-num"); num.type = "number"; num.min = "1"; num.max = "99"; num.value = String(o.notifyAt || 5); num.setAttribute("aria-label", "알림 기준 개수");
    num.addEventListener("change", function () { var v = Math.round(Number(num.value)); if (v >= 1 && v <= 99) save({ notifyAt: v }); else num.value = String(o.notifyAt || 5); });
    nw.appendChild(num); nw.appendChild(el("span", null, "개 이상 모이면 알려 주기")); nrow.appendChild(nw); card.appendChild(nrow);
    return card;
  }

  var panel = document.getElementById("auto-notes-panel");
  function load() {
    return api("GET", "/api/projects").then(function (d) {
      projects = d;
      if (panel) { settingsPanel(panel, d); return; }
      sidebar(d); pageBar(d); homeCard(d);
    }).catch(function () { var ph = document.querySelector(".pj-side-ph"); if (ph) ph.remove(); });
  }
  document.addEventListener("acard:navigated", function (e) {
    current = e.detail.slug;
    document.querySelectorAll(".pj-side-row[data-pages]").forEach(function (a) { a.classList.toggle("on", JSON.parse(a.dataset.pages).indexOf(current) >= 0); });
    if (projects) { pageBar(projects); homeCard(projects); }
  });
  load();
})();
