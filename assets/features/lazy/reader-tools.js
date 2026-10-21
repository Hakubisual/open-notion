(function () {
  "use strict";
  function add(tag, attrs) { return new Promise(function (ok, bad) { document.head.append(Object.assign(document.createElement(tag), attrs, { onload: ok, onerror: bad })); }); }
  // Home shows a static copy of the board table; a view tab swaps in the live board in place.
  function homeTab(bar, tab, push) {
    var url = tab.getAttribute("data-href"), host = bar.closest(".table-section");
    tab.setAttribute("aria-busy", "true");
    // The URL already names this view: show it selected while the live board loads (or if it never does).
    bar.querySelectorAll('[role="tab"]').forEach(function (t) { t.setAttribute("aria-selected", t === tab); t.classList.toggle("on", t === tab); });
    if (push) history.pushState(null, "", "/?view=" + tab.getAttribute("data-view"));
    // Fetch the board HTML, styles and the three db scripts at once; async=false keeps script execution order.
    var page = fetch(url).then(function (r) { return r.text(); });
    var styles = Promise.all([add("link", { rel: "stylesheet", href: "/db.css" }), add("link", { rel: "stylesheet", href: "/acard-table.css" })]);
    Promise.all([page, styles]).then(function (got) {
      var db = new DOMParser().parseFromString(got[0], "text/html").querySelector(".dbbrowser");
      if (!db) throw Error("no board");
      db.id = "db-home";
      host.replaceWith(db);
      return Promise.all(["/db-model.js", "/db-views.js", "/db.js"].map(function (src) { return add("script", { src: src, async: false }); }));
    }).catch(function () { location.href = url; });
  }
  // Trash rows: restore puts the page back, permanent delete asks first. A row goes away only once the server agrees.
  function trash(show, list, esc, when) {
    fetch("/api/editor/trash").then(function (r) { if (!r.ok) throw Error(String(r.status)); return r.json(); }).then(function (d) {
      var pages = d.pages || [];
      show("휴지통", [], "휴지통이 비었어요.");
      if (!pages.length) return;
      // A folder trashed with its contents is one row with the count (#13); 휴지통 비우기 deletes everything for good (#12).
      list.innerHTML = '<div class="trashbar"><button type="button" class="mini danger" data-trash="empty">휴지통 비우기</button></div>' + pages.map(function (p) {
        var day = when(p.deletedAt);
        return '<div class="trashrow" data-slug="' + esc(p.slug) + '"><span class="pt">' + esc(p.title || p.slug) + (p.count ? ' <small class="tcount">+ 안의 페이지 ' + p.count + "개</small>" : "") + '</span><span class="ps">' + (day ? esc(day) + " 삭제" : "") + '</span>' +
          '<button type="button" class="mini" data-trash="restore">복원</button><button type="button" class="mini danger" data-trash="permanent">영구 삭제</button></div>';
      }).join("");
      if (list.dataset.trashBound) return;
      list.dataset.trashBound = "1";
      list.addEventListener("click", function (ev) {
        var btn = ev.target.closest ? ev.target.closest("[data-trash]") : null;
        if (!btn) return;
        if (btn.getAttribute("data-trash") === "empty") {
          var n = list.querySelectorAll(".trashrow").length;
          if (!window.confirm("휴지통의 페이지 " + n + "개(폴더 안의 페이지와 첨부 파일 포함)를 영구 삭제할까요? 되돌릴 수 없어요.")) return;
          btn.disabled = true;
          fetch("/api/editor/trash/empty", { method: "POST" }).then(function (r) {
            if (!r.ok) throw Error(String(r.status));
            list.innerHTML = '<p class="pnone">휴지통이 비었어요.</p>';
            document.dispatchEvent(new CustomEvent("acard:tree-fresh"));
          }).catch(function () { btn.disabled = false; window.alert("휴지통을 비우지 못했어요. 잠시 뒤 다시 시도해 주세요."); });
          return;
        }
        var row = btn.closest(".trashrow"), slug = row.getAttribute("data-slug"), name = row.querySelector(".pt").textContent;
        var restore = btn.getAttribute("data-trash") === "restore";
        if (!restore && !window.confirm("'" + name + "' 페이지를 영구 삭제할까요? 되돌릴 수 없어요.")) return;
        btn.disabled = true;
        fetch("/api/page/" + encodeURIComponent(slug) + (restore ? "/restore" : "/permanent"), { method: restore ? "POST" : "DELETE" }).then(function (r) {
          if (!r.ok) throw Error(String(r.status));
          row.remove();
          if (restore) document.dispatchEvent(new CustomEvent("acard:tree-fresh"));
          if (!list.querySelector(".trashrow")) list.innerHTML = '<p class="pnone">휴지통이 비었어요.</p>';
        }).catch(function () {
          btn.disabled = false;
          window.alert(restore ? "복원하지 못했어요. 잠시 뒤 다시 시도해 주세요." : "영구 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
        });
      });
    }).catch(function () {
      show("휴지통", [], "휴지통을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.");
    });
  }
  // #21 페이지 너비: ⋯ 메뉴의 좁게/보통/넓게. 고르면 바로 적용하고 페이지 설정에 저장한다.
  function width(menu) {
    var box = menu.querySelector(".menu-width"), main = document.getElementById("main");
    if (!box || !main || box.dataset.ready || !window.AcardReader) return;
    box.dataset.ready = "1";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "페이지 너비");
    box.innerHTML = '<span class="menu-label">페이지 너비</span><div class="seg"><button type="button" data-width="default">좁게</button><button type="button" data-width="normal">보통</button><button type="button" data-width="full">넓게</button></div>';
    box.after(document.createElement("hr"));
    function paint(w) {
      main.classList.toggle("full-width", w === "full");
      main.classList.toggle("width-normal", w === "normal");
      box.querySelectorAll("[data-width]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.width === w)); });
    }
    paint(main.classList.contains("full-width") ? "full" : main.classList.contains("width-normal") ? "normal" : "default");
    box.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-width]");
      if (!b) return;
      var before = main.classList.contains("full-width") ? "full" : main.classList.contains("width-normal") ? "normal" : "default";
      paint(b.dataset.width);
      fetch("/api/page/" + encodeURIComponent(AcardReader.slug) + "/settings", { method: "PUT", headers: { "content-type": "application/json", "x-acard-client": (window.AcardLive || {}).client || "" }, body: JSON.stringify({ width: b.dataset.width }) })
        .then(function (r) { if (!r.ok) throw Error(String(r.status)); }).catch(function () { paint(before); });
    });
  }
  window.AcardTools = { homeTab: homeTab, trash: trash, width: width };
})();
