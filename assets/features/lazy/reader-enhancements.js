(function () {
  function openSharedPage() {
    var button = document.getElementById("share"), url = new URL(location.href);
    if (!button || url.searchParams.get("share") !== "1") return;
    url.searchParams.delete("share");
    history.replaceState(history.state, "", url.href);
    button.click();
  }
  openSharedPage();
  document.addEventListener("acard:page-fresh", openSharedPage);
})();
(function () {
  var tocLoaded = false;
  function loadReaderToc() {
    if (tocLoaded || document.querySelectorAll("#article .blocks h2[id],#article .blocks h3[id],#article .blocks h4[id],#article .blocks h5[id]").length < 2) return;
    tocLoaded = true;
    document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/lazy/toc.css?v=__TOC_CSS__" }));
    document.head.appendChild(Object.assign(document.createElement("script"), { src: "/lazy/toc.js?v=__TOC_JS__" }));
  }
  loadReaderToc();
  document.addEventListener("acard:page-fresh", loadReaderToc);
})();
(function () {
  function mountHomeTabs() {
  var bar = document.querySelector('.home-tasks [role="tablist"]');
  if (!bar) return;
  // AcardReaderTools is set later in this file: defer so a /?view= load does not call it too early.
  function go(tab, push) { setTimeout(function () { AcardReaderTools(function (t) { t.homeTab(bar, tab, push); }); }); }
  bar.addEventListener("click", function (ev) { var tab = ev.target.closest('[role="tab"]'); if (tab && tab.getAttribute("aria-selected") !== "true") go(tab, true); });
  var wanted = new URLSearchParams(location.search).get("view");
  var start = wanted && bar.querySelector('[data-view="' + wanted.replace(/\W/g, "") + '"]');
  if (start && start.getAttribute("aria-selected") !== "true") go(start, false);
  }
  mountHomeTabs();
  document.addEventListener("acard:page-fresh", mountHomeTabs);
})();
(function () {
  function mountBacklinks() {
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
  }
  mountBacklinks();
  document.addEventListener("acard:page-fresh", mountBacklinks);
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
  var io;
  function mountToc() {
  if (io) io.disconnect();
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
  io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
    paint();
  }, { rootMargin: "-80px 0px -65% 0px", threshold: 0 });
  targets.forEach(function (t) { io.observe(t); });
  }
  mountToc();
  document.addEventListener("acard:page-fresh", mountToc);
})();
