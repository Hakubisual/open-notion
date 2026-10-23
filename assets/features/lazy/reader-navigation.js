// Reader navigation primitives are DOM-independent so the routing and privacy boundary can be tested directly.
(function () {
  function eligible(href, base, event, link) {
    event = event || {}; link = link || {};
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.download || link.target && link.target !== "_self") return false;
    try {
      var u = new URL(href, base), here = new URL(base);
      return u.origin === here.origin && /^https?:$/.test(u.protocol) &&
        (u.pathname === "/" || /^\/(?!edit\/|p\/|s\/|api\/|__|login\/|signup\/|onboarding\/|settings\/|connect\/|admin\/|import\/)[^/.]+\/$/.test(u.pathname)) &&
        !(u.pathname === here.pathname && u.search === here.search && u.hash);
    } catch (e) { return false; }
  }
  function lru(max) {
    var entries = new Map();
    return {
      get: function (key) { var value = entries.get(key); if (entries.has(key)) { entries.delete(key); entries.set(key, value); } return value; },
      set: function (key, value) { entries.delete(key); entries.set(key, value); if (entries.size > max) entries.delete(entries.keys().next().value); },
      clear: function () { entries.clear(); },
      delete: function (key) { entries.delete(key); },
    };
  }
  function missingAssets(loaded, wanted) { var have = new Set(loaded); return Array.from(new Set(wanted)).filter(function (url) { return !have.has(url); }); }
  function mustReload(status, current, next) { return status === 401 || status === 403 || status === 404 || current !== next; }
  function storageKey(name, id) { return id ? name + ":" + id : null; }
  window.AcardNavigation = { eligible: eligible, lru: lru, missingAssets: missingAssets, mustReload: mustReload, storageKey: storageKey };
})();
// One reader document owns the sidebar, history, and prefetched responses. Cached DOM is always cloned before use.
(function () {
  if (!document.body.classList.contains("reader") || !document.getElementById("main")) return;
  var nav = window.AcardNavigation, reader = window.AcardReader;
  function identity(doc) { return (doc.querySelector('meta[name="acard-id"]') || {}).content || ""; }
  var id = identity(document), pages = nav.lru(20), inflight = new Map(), prefetched = new Set();
  var generation = 0, active = key(location.href), deferredFresh = false;
  function key(url) { var u = new URL(url, location.href); return u.origin + u.pathname + u.search; }
  function slug(url) { var s = decodeURIComponent(new URL(url, location.href).pathname.split("/")[1] || "index"); return s === "home" ? "index" : s; }
  function assets(doc) { return Array.from(doc.querySelectorAll('script[src],link[href]')).map(function (el) { return new URL(el.getAttribute("src") || el.getAttribute("href"), location.href).href; }); }
  function snapshot(doc) {
    var main = doc.getElementById("main").cloneNode(true);
    main.querySelectorAll(".dbbrowser[data-live]").forEach(function (el) { el.removeAttribute("data-live"); });
    var home = main.querySelector("#acard-home");
    if (home) home.remove();
    return { main: main, title: doc.title, id: identity(doc), assets: assets(doc), scripts: Array.from(doc.querySelectorAll('#main script:not([src]),body > script:not([src])')).filter(function (s) { return !s.type || s.type === "module" || /javascript/.test(s.type); }).map(function (s) { return { text: s.textContent, type: s.type }; }) };
  }
  function full(url, page) {
    generation++; pages.clear(); inflight.clear();
    // A rejected identity/permission must not leave the old private content visible during document navigation.
    // A page of the same identity that only needs assets this document has not loaded stays visible while it loads.
    if (!page || nav.mustReload(200, id, page.id)) document.querySelectorAll("#main,#sidebar").forEach(function (el) { el.style.visibility = "hidden"; });
    location.assign(url);
  }
  function databaseScript(url, loaded) {
    var next = new URL(url);
    return next.origin === location.origin && /^\/db(?:-model|-views)?\.js$/.test(next.pathname) &&
      !loaded.some(function (url) { return new URL(url).pathname === next.pathname; });
  }
  function allowed(page) {
    var loaded = assets(document);
    return !nav.mustReload(200, id, page.id) && nav.missingAssets(loaded, page.assets).every(function (url) { return databaseScript(url, loaded); });
  }
  var databaseLoading;
  function mountDatabase(page) {
    databaseLoading = (databaseLoading || Promise.resolve()).then(function () {
      if (!allowed(page)) throw Error("reader assets changed");
      return nav.missingAssets(assets(document), page.assets).reduce(function (ready, url) {
        return ready.then(function () { return new Promise(function (resolve, reject) {
          var script = document.createElement("script");
          script.src = url; script.onload = resolve; script.onerror = reject;
          document.head.appendChild(script);
        }); });
      }, Promise.resolve());
    });
    return databaseLoading.then(function () { return window.DoriDB && window.DoriDB.mountAll(); });
  }
  function readPage(url, fresh) {
    var k = key(url);
    if (!fresh && inflight.has(k)) return inflight.get(k);
    var request = new URL(k);
    // Explicit refreshes bypass SWR; ordinary navigation and prefetch share exactly the same request.
    if (fresh) request.searchParams.set("acard-revalidate", String(Date.now()));
    var run = fetch(request.href, { credentials: "same-origin", headers: { "x-acard-nav": "1" }, cache: fresh ? "no-store" : "default" }).then(function (r) {
      if (nav.mustReload(r.status, id, r.headers.get("x-acard-id") || "") || !r.ok || r.redirected) throw Error("reader navigation rejected");
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc.body.classList.contains("reader") || !doc.getElementById("main") || nav.mustReload(200, id, identity(doc))) throw Error("reader identity or shell changed");
      var page = snapshot(doc);
      if (!allowed(page)) throw Object.assign(Error("reader assets changed"), { page: page });
      if (id && !id.startsWith("g-")) pages.set(k, page);
      return page;
    });
    if (!fresh) { inflight.set(k, run); run.finally(function () { if (inflight.get(k) === run) inflight.delete(k); }).catch(function () {}); }
    return run;
  }
  function selecting() { var s = window.getSelection(); return s && !s.isCollapsed || document.activeElement && document.activeElement.isContentEditable; }
  function position(url, y, focus) {
    var main = document.getElementById("main");
    if (focus) { main.tabIndex = -1; main.focus({ preventScroll: true }); }
    var hash = new URL(url, location.href).hash, target;
    try { target = hash && document.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) {}
    if (y == null && target) {
      for (var p = target.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
      target.scrollIntoView();
    } else window.scrollTo({ top: y == null ? 0 : y, behavior: "instant" });
  }
  function swap(page, url, y, focus) {
    if (!allowed(page)) { full(url, page); return false; }
    focus = focus || document.activeElement === document.getElementById("main");
    var main = page.main.cloneNode(true);
    document.getElementById("main").replaceWith(main);
    document.title = page.title; reader.slug = slug(url); active = key(url);
    document.querySelectorAll('#sidebar a[href]').forEach(function (a) {
      var on = key(a.href) === active;
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    window.acardFont && window.acardFont(main.dataset.font);
    // Parsed inline code is inert. Replay page init code, not the external singleton bundles/sidebar mounts.
    main.querySelectorAll('script:not([src])').forEach(function (s) { if (!s.type || s.type === "module" || /javascript/.test(s.type)) s.remove(); });
    page.scripts.forEach(function (s) { var el = document.createElement("script"); if (s.type) el.type = s.type; el.textContent = s.text; main.appendChild(el); el.remove(); });
    prefetched.clear();
    document.dispatchEvent(new CustomEvent("acard:navigated", { detail: { slug: reader.slug } }));
    document.dispatchEvent(new CustomEvent("acard:page-fresh"));
    // The home module retains its mounted root for live refresh; do not let that root follow a note navigation.
    var home = document.getElementById("acard-home");
    if (reader.slug !== "index" && home) home.remove();
    document.body.classList.toggle("home-custom", reader.slug === "index" && !!document.querySelector("#acard-home .home-top"));
    position(url, y, focus);
    // Keep the server-rendered rows visible while the optional DB bundles load in dependency order.
    // Other missing assets and changed versions still require a full document navigation.
    mountDatabase(page).catch(function () { if (key(url) === active) full(url, page); });
    return true;
  }
  function savePosition() { history.replaceState(Object.assign({}, history.state, { acardReader: true, y: window.scrollY }), "", location.href); }
  function navigate(url, options) {
    options = options || {}; url = new URL(url, location.href).href;
    if (!nav.eligible(url, location.href) && key(url) !== active) { full(url); return Promise.resolve(); }
    document.dispatchEvent(new CustomEvent("acard:before-navigate"));
    if (!options.pop) savePosition();
    var turn = ++generation, cached = id && !id.startsWith("g-") && pages.get(key(url));
    var y = options.pop ? options.y || 0 : null, shown = false, last;
    function show(page) {
      if (turn !== generation) return;
      // An unchanged revalidation would only re-run page scripts and remount listeners over identical content.
      if (shown && page.main.outerHTML === last.main.outerHTML) return;
      if (!options.pop && !shown) history.pushState({ acardReader: true, y: 0 }, "", url);
      var keep = shown ? window.scrollY : y;
      shown = swap(page, url, keep, !shown); last = page;
    }
    if (cached) show(cached);
    return readPage(url, !!cached).then(show).catch(function (e) { if (turn === generation) full(url, e && e.page); });
  }
  function refresh(authorize) {
    if (!authorize && selecting()) { deferredFresh = true; return Promise.resolve(); }
    deferredFresh = false;
    var turn = generation, url = location.href;
    // A page whose main holds state of its own (the import screen's progress and result) is not replaced by a live
    // refresh; its sidebar still follows through the tree reload.
    var mainNow = document.getElementById("main");
    if (!authorize && mainNow && mainNow.hasAttribute("data-live-keep")) return Promise.resolve();
    return readPage(url, true).then(function (page) {
      if (turn !== generation || key(url) !== active) return;
      if (!authorize && selecting()) { deferredFresh = true; return; }
      swap(page, url, window.scrollY, false);
    }).catch(function (e) { if (turn === generation) full(url, e && e.page); });
  }
  reader.navigate = navigate; reader.refresh = refresh;
  reader.prefetch = function (url) {
    var k = key(url);
    if (!id || id.startsWith("g-") || !nav.eligible(url, location.href) || k === active || prefetched.has(k) || prefetched.size >= 8) return false;
    prefetched.add(k); readPage(url, false).catch(function () {}); return true;
  };
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || !nav.eligible(a.href, location.href, e, { target: a.target, download: a.hasAttribute("download") })) return;
    e.preventDefault(); navigate(a.href);
  });
  history.scrollRestoration = "manual"; savePosition();
  // The saved y is read only on popstate, and navigate() saves it again right before leaving, so the scroll handler
  // records the position once the scrolling settles instead of calling replaceState (a long task on a slow phone) per event.
  var positionTimer = null;
  window.addEventListener("scroll", function () {
    if (key(location.href) !== active) return;
    clearTimeout(positionTimer); positionTimer = setTimeout(savePosition, 150);
  }, { passive: true });
  window.addEventListener("popstate", function (e) {
    if (key(location.href) === active) return;
    navigate(location.href, { pop: true, y: e.state && e.state.y });
  });
  document.addEventListener("selectionchange", function () { if (deferredFresh && !selecting()) refresh(); });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.type === "acard-fresh" && m.url && key(m.url) === active) refresh();
  });
  // Hide a persisted document until a network authorization check has completed on its return.
  window.addEventListener("pagehide", function (e) { if (e.persisted) document.documentElement.style.visibility = "hidden"; });
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    pages.clear();
    refresh(true).then(function () { document.documentElement.style.visibility = ""; });
  });
  reader.on("ready", function () { if (id && !id.startsWith("g-")) pages.set(active, snapshot(document)); });
})();
