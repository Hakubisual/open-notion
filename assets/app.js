(function(d,w){function c(h){if(!d.querySelector('[href="'+h+'"]')){var l=d.createElement("link");l.rel="stylesheet";l.href=h;d.head.append(l)}}w.acardFont=function(f){f=="serif"&&c("/fonts/serif.css")};d.querySelector('[data-font="serif"]')&&c("/fonts/serif.css");w.addEventListener("load",function(){setTimeout(c,99,"/fonts/fonts.css")})})(document,window);
(function () {
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (new URL(form.action).pathname !== "/__logout" || !window.caches || !navigator.locks) return;
    event.preventDefault();
    localStorage.setItem("acard-cache-epoch", String(Date.now()));
    navigator.locks.request("acard-recent-cache", function () {
      return caches.delete("acard-recent-cache");
    }).then(function () { form.submit(); });
  }, true);
  var ready = document.readyState !== "loading";
  var listeners = [];
  var slug = decodeURIComponent(location.pathname.replace(/^\//, "").replace(/\/$/, "")) || "index";
  function notify(fn) {
    try { fn(window.AcardReader); } catch (error) { console.error("Reader feature listener failed", error); }
  }
  window.AcardReader = {
    slug: slug === "home" ? "index" : slug,
    on: function (event, fn) {
      if (event !== "ready") return function () {};
      if (ready) notify(fn); else listeners.push(fn);
      return function () { var at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); };
    }
  };
  if (!ready) document.addEventListener("DOMContentLoaded", function () {
    ready = true;
    listeners.splice(0).forEach(notify);
  }, { once: true });
})();
(function () {
  var root = document.documentElement;
  var KEY = "dori-notes-theme";
  var SIDE_KEY = "dori-notes-sidebar";
  var RECENT_KEY = "dori-notes-recent";
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) { stored = null; }
  root.setAttribute("data-theme", stored === "light" || stored === "dark" ? stored : "auto");

  // 테마: auto -> light -> dark -> auto (시스템 설정을 따르는 상태 포함)
  function themeLabel(mode) {
    return mode === "light" ? "라이트" : mode === "dark" ? "다크" : "시스템";
  }
  function paintTheme() {
    var mode = root.getAttribute("data-theme") || "auto";
    var btn = document.getElementById("theme");
    if (!btn) return;
    btn.title = "테마: " + themeLabel(mode) + " (클릭해서 바꾸기)";
    btn.setAttribute("aria-label", "테마 " + themeLabel(mode));
  }
  paintTheme();
  var themeBtn = document.getElementById("theme");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") || "auto";
      var next = current === "auto" ? "light" : current === "dark" ? "auto" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      paintTheme();
    });
  }

  // 사이드바 접기 (데스크톱). 모바일 드로어는 그대로 남겨 둔다.
  var collapsed = null;
  try { collapsed = localStorage.getItem(SIDE_KEY); } catch (e) { collapsed = null; }
  function paintCollapse() {
    var btn = document.getElementById("collapse");
    if (!btn) return;
    var isCollapsed = collapsed === "1";
    root.classList.toggle("side-collapsed", isCollapsed);
    btn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    btn.setAttribute("aria-label", isCollapsed ? "사이드바 펴기" : "사이드바 접기");
    btn.title = isCollapsed ? "사이드바 펴기 (Ctrl+B)" : "사이드바 접기 (Ctrl+B)";
    btn.textContent = isCollapsed ? "⟩" : "⟨";
  }
  function toggleCollapse() {
    collapsed = collapsed === "1" ? "0" : "1";
    try { localStorage.setItem(SIDE_KEY, collapsed); } catch (e) {}
    paintCollapse();
  }
  paintCollapse();
  var collapseBtn = document.getElementById("collapse");
  if (collapseBtn) collapseBtn.addEventListener("click", toggleCollapse);

  // 열어 본 페이지 기록 (빠른 검색 팔레트에 쓴다)
  var here = location.pathname.replace(/^\//, "").replace(/\/$/, "") || "index";
  var title = (document.querySelector("#article h1") || {}).textContent || here;
  var recents = [];
  try { recents = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) { recents = []; }
  recents = recents.filter(function (r) { return r && r.slug && r.slug !== here; });
  recents.unshift({ slug: here, title: String(title).trim() || here });
  recents = recents.slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recents)); } catch (e) {}

  function openOverlay(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    el.hidden = false;
    var input = el.querySelector("input, button");
    if (input) input.focus();
    return el;
  }
  function closeOverlay(el) {
    if (typeof el === "string") el = document.getElementById(el);
    if (el) el.hidden = true;
  }

  var palette = document.getElementById("palette");
  var paletteInput = document.getElementById("palette-q");
  var paletteList = document.getElementById("palette-list");
  var paletteItems = [];
  var paletteSel = 0;
  var paletteTree = null, searchSeq = 0, timer = null;
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function itemHtml(item, selected) {
    return '<a role="option" href="/' + (item.slug === "index" ? "" : encodeURIComponent(item.slug) + "/") + '"' +
      (item.slug === "index" ? ' href="/"' : "") +
      (selected ? ' class="on"' : "") + ">" +
      "<span class=\"pt\">" + (item.title || item.slug) + "</span>" +
      (item.kind === "db" ? '<span class=\"dbmark\">표</span>' : "") +
      (item.snippet ? '<span class=\"ps\">' + item.snippet + "</span>" : "") +
      "</a>";
  }
  function renderPalette() {
    if (!paletteList) return;
    paletteList.innerHTML = paletteItems.map(function (item, i) { return itemHtml(item, i === paletteSel); }).join("");
  }
  function markRecents(list) {
    var seen = {};
    recents.forEach(function (r) { seen[r.slug] = true; });
    return list.map(function (item) { return { slug: item.slug, title: item.title, kind: item.kind, snippet: item.snippet, recent: seen[item.slug] }; });
  }
  function search(q, remote) {
    var query = q.trim().toLowerCase();
    if (!query) {
      searchSeq++;
      paletteItems = markRecents(recents.map(function (r) { return { slug: r.slug, title: r.title }; }));
      paletteItems.forEach(function (item, i) { if (i === 0) item.snippet = "최근 본 페이지"; });
      paletteSel = 0;
      renderPalette();
      return;
    }
    var words = query.split(/\s+/).filter(Boolean), asked = remote ? searchSeq : ++searchSeq;
    var match = function (text) { var hay = String(text || "").toLowerCase(); return words.every(function (w) { return hay.indexOf(w) >= 0; }); };
    // Titles filter at once from the page tree; body matches from the server are appended when they arrive.
    var local = (paletteTree || []).filter(function (p) { return match(p.title); }).slice(0, 8).map(function (p) { return { slug: p.slug, title: p.title, kind: p.kind }; });
    paletteItems = markRecents(local);
    paletteSel = 0;
    renderPalette();
    paletteList.insertAdjacentHTML("beforeend", '<p class="pnone" data-pending>본문에서 찾는 중…</p>');
    if (!paletteTree) fetch("/api/tree").then(function (r) { return r.ok ? r.json() : { pages: [] }; }).then(function (d) { paletteTree = d.pages || []; if (asked === searchSeq) search(q, true); }).catch(function () { paletteTree = []; });
    if (timer) clearTimeout(timer);
    if (!remote) { timer = setTimeout(function () { if (asked === searchSeq) search(q, true); }, 150); return; }
    fetch("/api/search?q=" + encodeURIComponent(q)).then(function (r) { return r.ok ? r.json() : { results: [] }; }).then(function (data) {
      if (asked !== searchSeq) return;
      var seen = {};
      paletteItems.forEach(function (item) { seen[item.slug] = true; });
      var hits = (data.results || []).filter(function (hit) { return !seen[hit.slug] && match((hit.title || "") + " " + (hit.hit || "")); }).map(function (hit) {
        var text = hit.hit || "";
        return { slug: hit.slug, title: hit.title, snippet: text.length > 90 ? text.slice(0, 90) + "…" : text };
      });
      paletteItems = paletteItems.concat(markRecents(hits));
      if (!paletteItems.length) {
        paletteList.innerHTML = '<p class="pnone">"' + esc(q) + '" 결과가 없어요.</p>';
        return;
      }
      renderPalette();
    }).catch(function () {
      if (asked !== searchSeq) return;
      var pending = paletteList.querySelector("[data-pending]");
      if (pending) pending.textContent = "본문 검색을 못 했어요. 잠시 뒤 다시 시도해 주세요.";
    });
  }
  function openPalette() {
    if (!palette) return;
    palette.hidden = false;
    if (!paletteTree) fetch("/api/tree").then(function (r) { return r.ok ? r.json() : { pages: [] }; }).then(function (d) { paletteTree = paletteTree || d.pages || []; }).catch(function () {});
    if (paletteInput) {
      paletteInput.value = "";
      paletteInput.focus();
    }
    search("");
  }
  function closePalette() {
    closeOverlay(palette);
    paletteItems = [];
    if (paletteList) paletteList.innerHTML = "";
  }
  function followSelected() {
    var item = paletteItems[paletteSel];
    if (!item) return;
    location.href = "/" + (item.slug === "index" ? "" : encodeURIComponent(item.slug) + "/");
  }
  var paletteOpenBtn = document.getElementById("palette-open");
  if (paletteOpenBtn) paletteOpenBtn.addEventListener("click", openPalette);
  var thumbSearch = document.querySelector('.thumbbar [data-open="palette"]');
  if (thumbSearch) thumbSearch.addEventListener("click", openPalette);
  if (paletteInput) {
    paletteInput.addEventListener("input", function () { search(paletteInput.value); });
    paletteInput.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") { ev.preventDefault(); paletteSel = Math.min(paletteSel + 1, paletteItems.length - 1); renderPalette(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); paletteSel = Math.max(paletteSel - 1, 0); renderPalette(); }
      else if (ev.key === "Enter") { ev.preventDefault(); followSelected(); }
      else if (ev.key === "Escape") { ev.preventDefault(); closePalette(); }
    });
  }
  if (paletteList) paletteList.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a") : null;
    if (!a) return;
    ev.preventDefault();
    location.href = a.getAttribute("href");
  });
  if (palette) palette.addEventListener("mousedown", function (ev) {
    if (ev.target === palette) closePalette();
  });

  // 더보기 메뉴
  var moreBtn = document.getElementById("more");
  var moreMenu = document.getElementById("more-menu");
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener("click", function () {
      var open = moreMenu.hidden;
      moreMenu.hidden = !open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    moreBtn.parentNode.addEventListener("keydown", function (ev) {
      var k = ev.key, items = [].slice.call(moreMenu.children), i = items.indexOf(document.activeElement);
      if (moreMenu.hidden) return;
      if (k == "Escape") { moreBtn.click(); moreBtn.focus(); }
      if (k == "ArrowDown" || k == "ArrowUp") { ev.preventDefault(); items[(i + (k == "ArrowUp" ? items.length - 1 : 1)) % items.length].focus(); }
    });
    document.addEventListener("click", function (ev) {
      if (moreMenu.hidden) return;
      if (!moreBtn.contains(ev.target) && !moreMenu.contains(ev.target)) {
        moreMenu.hidden = true;
        moreBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  var shortcutsEl = document.getElementById("shortcuts");
  var shortcutsOpen = document.getElementById("shortcuts-open");
  var shortcutsClose = document.getElementById("shortcuts-close");
  if (shortcutsOpen) shortcutsOpen.addEventListener("click", function () {
    if (moreMenu) moreMenu.hidden = true;
    openOverlay("shortcuts");
  });
  if (shortcutsClose) shortcutsClose.addEventListener("click", function () { closeOverlay("shortcuts"); });
  if (shortcutsEl) shortcutsEl.addEventListener("mousedown", function (ev) {
    if (ev.target === shortcutsEl) closeOverlay("shortcuts");
  });

  // 전역 단축키 (편집 화면에서는 editor.js 가 자기 몫을 처리한다)
  document.addEventListener("keydown", function (ev) {
    if (document.body.classList.contains("editing")) return;
    var mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key === "k" || ev.key === "K")) {
      ev.preventDefault();
      if (palette && !palette.hidden) closePalette(); else openPalette();
      return;
    }
    if (mod && ev.key === "/") {
      ev.preventDefault();
      if (shortcutsEl && !shortcutsEl.hidden) closeOverlay("shortcuts"); else openOverlay("shortcuts");
      return;
    }
    if (mod && (ev.key === "b" || ev.key === "B")) {
      ev.preventDefault();
      toggleCollapse();
      return;
    }
    if (ev.key === "Escape") {
      closePalette();
      closeOverlay("shortcuts");
    }
  });

  var menu = document.getElementById("menu");
  var sidebar = document.getElementById("sidebar");
  if (menu && sidebar && document.body.classList.contains("reader")) {
    var phone = window.matchMedia("(max-width: 899px)");
    var thumbPages = document.querySelector('.thumbbar [data-open="pages"]');
    var backdrop = document.createElement("button");
    backdrop.className = "drawer-backdrop";
    backdrop.type = "button";
    backdrop.hidden = true;
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", "메뉴 닫기");
    document.body.appendChild(backdrop);
    var drawerClose = document.createElement("button");
    drawerClose.className = "icon drawer-close";
    drawerClose.type = "button";
    drawerClose.textContent = "×";
    drawerClose.setAttribute("aria-label", "메뉴 닫기");
    sidebar.querySelector(".side-brand").appendChild(drawerClose);
    var behindDrawer = document.querySelectorAll(".reader .mbar, .reader .shell > main, .reader .thumbbar");
    var drawerScroll = 0;
    var drawerOpener = menu;
    function setDrawer(open, restoreFocus) {
      open = open && phone.matches;
      var wasOpen = sidebar.classList.contains("open");
      if (open && !wasOpen) {
        drawerScroll = window.scrollY;
        drawerOpener = document.activeElement;
        document.body.style.setProperty("--drawer-scroll-top", -drawerScroll + "px");
      }
      sidebar.classList.toggle("open", open);
      sidebar.inert = phone.matches && !open;
      backdrop.hidden = !open;
      root.classList.toggle("drawer-open", open);
      document.body.classList.toggle("drawer-open", open);
      menu.setAttribute("aria-expanded", String(open));
      if (thumbPages) thumbPages.setAttribute("aria-expanded", String(open));
      behindDrawer.forEach(function (el) { el.inert = open; });
      if (open) drawerClose.focus({ preventScroll: true });
      else if (wasOpen) {
        document.body.style.removeProperty("--drawer-scroll-top");
        window.scrollTo({ top: drawerScroll, behavior: "instant" });
        if (restoreFocus) drawerOpener.focus({ preventScroll: true });
      }
    }
    function toggleDrawer(ev) {
      setDrawer(!sidebar.classList.contains("open"), true);
      if (sidebar.classList.contains("open")) drawerOpener = ev.currentTarget;
    }
    menu.addEventListener("click", toggleDrawer);
    if (thumbPages) {
      thumbPages.setAttribute("aria-controls", "sidebar");
      thumbPages.addEventListener("click", toggleDrawer);
    }
    backdrop.addEventListener("click", function () { setDrawer(false, true); });
    drawerClose.addEventListener("click", function () { setDrawer(false, true); });
    sidebar.addEventListener("click", function (ev) {
      if (ev.target.closest("a, #palette-open, [data-act]")) setDrawer(false, false);
    });
    document.addEventListener("keydown", function (ev) {
      if (!sidebar.classList.contains("open")) return;
      if (ev.key === "Escape") { ev.preventDefault(); setDrawer(false, true); }
      if (ev.key !== "Tab") return;
      var items = Array.prototype.filter.call(sidebar.querySelectorAll("a[href], button:not([disabled])"), function (el) { return el.getClientRects().length > 0; });
      var first = items[0], last = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    phone.addEventListener("change", function () { setDrawer(false, false); });
    setDrawer(false, false);
  } else if (menu && sidebar) {
    var toggleSidebar = function () {
      var open = sidebar.classList.toggle("open");
      menu.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menu.addEventListener("click", toggleSidebar);
    var thumbPages = document.querySelector('.thumbbar [data-open="pages"]');
    if (thumbPages) thumbPages.addEventListener("click", toggleSidebar);
    sidebar.addEventListener("click", function (ev) {
      if (ev.target && ev.target.tagName === "A") {
        sidebar.classList.remove("open");
        menu.setAttribute("aria-expanded", "false");
      }
    });
  }
  var input = document.getElementById("q");
  var panel = document.getElementById("results");
  if (!input || !panel) return;
  var index = null;
  var loading = false;
  function load() {
    if (index || loading) return;
    loading = true;
    fetch("/search-index.json").then(function (r) { return r.json(); }).then(function (data) {
      index = data; loading = false;
    }).catch(function () { index = []; loading = false; });
  }
  function snippet(text, q) {
    var lower = text.toLowerCase();
    var at = lower.indexOf(q);
    if (at < 0) return text.slice(0, 90) + "…";
    var start = Math.max(0, at - 30);
    var end = Math.min(text.length, at + q.length + 60);
    return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  }
  function render(q) {
    var query = q.trim().toLowerCase();
    if (!query) { panel.hidden = true; panel.innerHTML = ""; return; }
    if (!index) {
      panel.hidden = false;
      panel.innerHTML = "<h2>검색</h2><p class=\"rnone\">찾는 중…</p>";
      load();
      setTimeout(function () { if (index) render(input.value); }, 250);
      return;
    }
    var words = query.split(/\s+/).filter(Boolean);
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var p = index[i];
      var hay = (p.t + " " + (p.h || []).join(" ") + " " + p.b).toLowerCase();
      var ok = true;
      for (var w = 0; w < words.length; w++) { if (hay.indexOf(words[w]) < 0) { ok = false; break; } }
      if (!ok) continue;
      var inTitle = p.t.toLowerCase().indexOf(words[0]) >= 0;
      hits.push({ p: p, score: (inTitle ? 100 : 0) + (p.g === "project" ? 5 : 0) });
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    panel.hidden = false;
    if (!hits.length) { panel.innerHTML = "<h2>검색</h2><p class=\"rnone\">\"" + q + "\" 결과가 없어요.</p>"; return; }
    var html = "<h2>검색 " + hits.length + "건</h2><ul>";
    for (var k = 0; k < Math.min(hits.length, 12); k++) {
      var it = hits[k].p;
      html += "<li><a class=\"rt\" href=\"" + it.u + "\">" + it.t + "</a>";
      html += "<div class=\"rs\">" + snippet(it.b, words[0]) + "</div></li>";
    }
    html += "</ul>";
    panel.innerHTML = html;
  }
  input.addEventListener("focus", load);
  input.addEventListener("input", function () { render(input.value); });
  input.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { input.value = ""; render(""); input.blur(); } });
})();
(function () {
  var bar = document.querySelector('.home-tasks [role="tablist"]');
  if (!bar) return;
  // AcardReaderTools is set later in this file: defer so a /?view= load does not call it too early.
  function go(tab, push) { setTimeout(function () { AcardReaderTools(function (t) { t.homeTab(bar, tab, push); }); }); }
  bar.addEventListener("click", function (ev) { var tab = ev.target.closest('[role="tab"]'); if (tab && tab.getAttribute("aria-selected") !== "true") go(tab, true); });
  var wanted = new URLSearchParams(location.search).get("view");
  var start = wanted && bar.querySelector('[data-view="' + wanted.replace(/\W/g, "") + '"]');
  if (start && start.getAttribute("aria-selected") !== "true") go(start, false);
})();
(function () {
  var box = document.getElementById("backlinks");
  if (!box) return;
  var slug = location.pathname.replace(/^\//, "").replace(/\/$/, "") || "index";
  fetch("/api/backlinks?slug=" + encodeURIComponent(slug)).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    var list = data && data.backlinks ? data.backlinks : [];
    if (!list.length) return;
    box.innerHTML = "<h3>이 페이지를 가리키는 곳</h3>" + list.map(function (b) {
      return '<a href="/' + b.slug + '/">' + (b.title || b.slug) + "</a>";
    }).join("");
    box.hidden = false;
  }).catch(function () {});
})();
(function () {
  var overlay = null;
  document.addEventListener("click", function (ev) {
    var link = ev.target.closest ? ev.target.closest("a.imgview") : null;
    if (!link) return;
    var img = link.querySelector("img");
    if (!img) return;
    ev.preventDefault();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "lightbox";
      overlay.addEventListener("click", function () { overlay.classList.remove("on"); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") overlay.classList.remove("on"); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = "";
    var big = document.createElement("img");
    big.src = img.src;
    big.alt = img.alt || "";
    overlay.appendChild(big);
    overlay.classList.add("on");
  });
})();

(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  if (!links.length || !("IntersectionObserver" in window)) return;
  var byId = {};
  var targets = [];
  links.forEach(function (a) {
    var id = decodeURIComponent((a.getAttribute("href") || "").slice(1));
    var el = id ? document.getElementById(id) : null;
    if (!el) return;
    byId[id] = a;
    targets.push(el);
  });
  if (!targets.length) return;
  var visible = {};
  function paint() {
    var current = null;
    for (var i = 0; i < targets.length; i++) { if (visible[targets[i].id]) { current = targets[i].id; break; } }
    links.forEach(function (a) { a.classList.remove("on"); });
    if (current && byId[current]) byId[current].classList.add("on");
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
    paint();
  }, { rootMargin: "-80px 0px -65% 0px", threshold: 0 });
  targets.forEach(function (t) { io.observe(t); });
})();

(function () {
  var side = document.getElementById("sidebar");
  if (!side || !document.body.classList.contains("reader")) return;
  side.addEventListener("click", function (ev) {
    var tw = ev.target.closest ? ev.target.closest(".tw") : null;
    if (tw && tw.tagName === "BUTTON") {
      var li = tw.closest("li, .side-root");
      if (li) li.classList.toggle("open");
      ev.preventDefault();
    }
  });
  var panel = document.getElementById("sidepanel");
  var title = document.getElementById("sidepanel-title");
  var list = document.getElementById("sidepanel-list");
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function href(slug) { return slug === "index" ? "/" : "/" + encodeURIComponent(slug) + "/"; }
  function show(name, items, empty) {
    if (!panel) return;
    title.textContent = name;
    list.innerHTML = items.length ? items.map(function (p) {
      return '<a href="' + (p.href || href(p.slug)) + '"><span class="pt">' + esc(p.title || p.slug) + "</span>" + (p.note ? '<span class="ps">' + esc(p.note) + "</span>" : "") + "</a>";
    }).join("") : '<p class="pnone">' + esc(empty) + "</p>";
    panel.hidden = false;
  }
  function tree() { return fetch("/api/tree").then(function (r) { return r.ok ? r.json() : { pages: [] }; }).then(function (d) { return d.pages || []; }); }
  var sideMore = document.getElementById("side-more"), sideMenu = document.getElementById("side-menu");
  function setSideMenu(open) {
    if (!sideMenu) return;
    sideMenu.hidden = !open;
    sideMore.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { var first = sideMenu.querySelector("button"); if (first) first.focus(); }
  }
  if (sideMore && sideMenu) {
    sideMore.addEventListener("click", function (ev) { ev.stopPropagation(); setSideMenu(sideMenu.hidden); });
    document.addEventListener("click", function (ev) { if (!sideMenu.hidden && !sideMenu.contains(ev.target)) setSideMenu(false); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !sideMenu.hidden) { setSideMenu(false); sideMore.focus(); } });
  }
  function when(ms) { var d = new Date(Number(ms) || 0); return d.getFullYear() > 2000 ? (d.getMonth() + 1) + "월 " + d.getDate() + "일" : ""; }
  side.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    ev.preventDefault();
    if (sideMenu && sideMenu.contains(btn)) setSideMenu(false);
    var F = window.AcardFolders;
    if (act === "all") {
      if (F && F.allPages) F.allPages();
      else tree().then(function (pages) { show("모든 페이지", pages, "페이지가 없어요."); });
    }
    else if (act === "suggest") { if (F && F.suggest) F.suggest(); }
    else if (act === "recent") tree().then(function (pages) {
      pages.sort(function (x, y) { return (Number(y.updated) || 0) - (Number(x.updated) || 0); });
      show("최근 편집됨", pages.slice(0, 12).map(function (p) { return { slug: p.slug, title: p.title, note: when(p.updated) }; }), "아직 고친 페이지가 없어요.");
    });
    else if (act === "favorites") tree().then(function (pages) {
      show("즐겨찾기", pages.filter(function (p) { return p.favorite; }), "즐겨찾기한 페이지가 없어요. 페이지 오른쪽 위 별을 눌러 추가해요.");
    });
    else if (act === "trash") tools(function (t) { t.trash(show, list, esc, when); });
    else if (act === "new") {
      // Untitled page, cursor in the title field - no blocking window.prompt (#18).
      fetch("/api/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "제목 없음" }) })
        .then(function (r) { return r.json(); }).then(function (p) { if (p && p.slug) location.href = "/edit/" + encodeURIComponent(p.slug) + "/?new"; });
    }
  });
  // Trash actions and the home view tabs live in /lazy/reader-tools.js and load on first use.
  function tools(fn) {
    if (window.AcardTools) return fn(window.AcardTools);
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/lazy/reader-tools.css?v=__READER_TOOLS_CSS__" }));
    document.head.append(Object.assign(document.createElement("script"), { src: "/lazy/reader-tools.js?v=__READER_TOOLS__", onload: function () { fn(window.AcardTools); } }));
  }
  window.AcardReaderTools = tools;
  setTimeout(function () { document.head.append(Object.assign(document.createElement("script"), { src: "/lazy/scrollbars.js?v=__SCROLLBARS__" })); }, 600);
  var close = document.getElementById("sidepanel-close");
  if (close) close.addEventListener("click", function () { panel.hidden = true; });
  if (panel) panel.addEventListener("mousedown", function (ev) { if (ev.target === panel) panel.hidden = true; });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && panel) panel.hidden = true; });

  var share = document.getElementById("share");
  // The build stamps the lazy share dialog's content hash into __SHARE_DIALOG__.
  if (share) share.onclick = function () {
    window.AcardShare ? AcardShare.open(AcardReader.slug) : document.head.append(Object.assign(document.createElement("script"), { src: "/lazy/share-dialog.js?v=__SHARE_DIALOG__", onload: share.onclick }));
  };
  var fav = document.getElementById("fav");
  if (fav) {
    var slug = fav.getAttribute("data-slug");
    var base = "/api/page/" + encodeURIComponent(slug) + "/settings";
    var paint = function (on) { fav.setAttribute("aria-pressed", on ? "true" : "false"); fav.title = on ? "즐겨찾기 해제" : "즐겨찾기"; };
    fetch(base).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && d.settings) paint(d.settings.favorite); }).catch(function () {});
    fav.addEventListener("click", function () {
      var next = fav.getAttribute("aria-pressed") !== "true";
      paint(next);
      fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ favorite: next }) }).then(function (r) { if (!r.ok) paint(!next); }).catch(function () { paint(!next); });
    });
  }
})();
