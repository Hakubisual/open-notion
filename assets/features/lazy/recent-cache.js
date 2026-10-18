(function (root) {
  "use strict";
  var NAME = "acard-recent-cache", KEY = "/__recent-cache", EPOCH = "acard-cache-epoch";
  var sb = root.document && (root.AcardLazy || {}).scrollbars;
  if (sb) root.document.head.appendChild(Object.assign(root.document.createElement("script"), { src: "/lazy/scrollbars.js?v=" + sb.js }));
  function touch(entries, key, value) {
    var next = entries.filter(function (entry) { return entry.key !== key; });
    next.push({ key: key, value: value });
    var pages = next.filter(function (entry) { return entry.key !== "/tree"; });
    return next.filter(function (entry) { return entry.key === "/tree" || pages.indexOf(entry) >= pages.length - 30; });
  }
  function race(cached, server, show) {
    var finished = false, visible;
    var read = Promise.resolve(cached).catch(function () { return null; }).then(function (value) {
      if (!finished && value) { visible = value; show(value, "loading"); }
    });
    return Promise.resolve(server).then(function (value) {
      finished = true;
      show(value, "ready", JSON.stringify(visible) !== JSON.stringify(value));
      return value;
    }, function (error) {
      return read.then(function () { finished = true; show(visible, "offline"); throw error; });
    });
  }
  var api = { touch: touch, race: race };
  root.AcardRecentCache = api;
  var editor = root.AcardEditor;
  if (!editor) return;
  var epoch = localStorage.getItem(EPOCH), stopped = false;
  function access(change) {
    if (!root.caches || !navigator.locks) return Promise.resolve(null);
    return navigator.locks.request(NAME, async function () {
      if (stopped || localStorage.getItem(EPOCH) !== epoch) return null;
      var cache = await caches.open(NAME), response = await cache.match(KEY);
      var entries = response ? await response.json() : [];
      var result = change(entries);
      if (result.entries) await cache.put(KEY, new Response(JSON.stringify(result.entries)));
      return result.value;
    }).catch(function () { return null; });
  }
  function read(key) {
    return access(function (entries) {
      var entry = entries.find(function (item) { return item.key === key; });
      return { value: entry && entry.value, entries: entry ? touch(entries, key, entry.value) : null };
    });
  }
  function write(key, value) { return access(function (entries) { return { entries: touch(entries, key, value) }; }); }
  var doc = document.getElementById("doc"), side = document.getElementById("sidebar");
  function lock(on) {
    doc.inert = side.inert = on;
    document.getElementById("more").inert = on;
    editor.state.cacheLocked = on;
  }
  // Capture before document keyboard shortcuts can mutate cached state.
  root.addEventListener("keydown", function (event) {
    if (editor.state.cacheLocked && event.key !== "Tab") { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  root.addEventListener("storage", function (event) {
    if (event.key === EPOCH) { stopped = true; lock(true); doc.replaceChildren(); side.replaceChildren(); location.replace("/"); }
  });
  api.load = function (server, preview, tree) {
    lock(true);
    editor.setSave("불러오는 중…", true);
    var treeDone = false;
    read("/tree").then(function (data) { if (data && !treeDone) tree(data); });
    editor.api("/tree").then(function (data) { treeDone = true; if (!stopped) tree(data); return write("/tree", data); }).catch(function () {});
    var key = "/page/" + encodeURIComponent(editor.slug);
    return race(read(key), server, function (data, state) {
      if (stopped) return;
      if (state === "loading") { preview(data); document.documentElement.dataset.recentCache = "loading"; }
      if (state === "ready") { lock(false); document.documentElement.dataset.recentCache = "ready"; }
      if (state === "offline") {
        document.documentElement.dataset.recentCache = "offline";
        editor.setSave(navigator.onLine === false ? "오프라인 · 읽기 전용. 다시 연결한 뒤 새로고침해 주세요." : "불러오지 못했어요 · 읽기 전용. 새로고침해 주세요.", true);
      }
    }).then(function (data) { if (stopped) throw Error("로그아웃됨"); write(key, data); return data; });
  };
  editor.provide("recent-cache", api);
})(typeof window === "undefined" ? globalThis : window);
