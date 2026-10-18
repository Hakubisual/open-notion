(function () {
  if (window.AcardLive || !window.WebSocket) return;
  var editor = /^\/edit\//.test(location.pathname);
  var slug = decodeURIComponent((location.pathname.match(/^\/(?:edit\/)?([^/]+)\/?$/) || [])[1] || "index");
  var last = Number(sessionStorage.getItem("acard-live-id") || 0);
  var socket = null, retry = 0, timer = null, hideTimer = null, lastInput = 0, bar = null, pending = false;
  var channel = window.BroadcastChannel ? new BroadcastChannel("acard-live") : null;
  var CID = "c" + Math.random().toString(36).slice(2, 12);
  var api = { events: [], status: "idle", client: CID };
  window.AcardLive = api;

  document.addEventListener("input", function () { lastInput = Date.now(); }, true);
  document.addEventListener("keydown", function () { lastInput = Date.now(); }, true);

  function dropCachedViews() {
    if (!window.caches) return Promise.resolve();
    return caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return /^acard-pages-/.test(n); }).map(function (n) {
        return caches.open(n).then(function (cache) {
          return cache.keys().then(function (keys) {
            return Promise.all(keys.filter(function (r) { return !/\/api\/page\//.test(r.url); }).map(function (r) { return cache.delete(r); }));
          });
        });
      }));
    }).catch(function () {});
  }

  var treeBusy = null, treeAgain = false;
  function reloadFolders() {
    if (!window.AcardFolders || !window.AcardFolders.reload) { document.dispatchEvent(new CustomEvent("acard:tree-fresh")); return; }
    if (treeBusy) { treeAgain = true; return; }
    treeBusy = Promise.resolve(window.AcardFolders.reload()).catch(function () {}).then(function () {
      treeBusy = null;
      if (treeAgain) { treeAgain = false; reloadFolders(); }
    });
  }
  function refreshTree() {
    reloadFolders();
    if (editor && window.AcardEditor && window.AcardEditor.loadTree) window.AcardEditor.loadTree();
    document.dispatchEvent(new CustomEvent("acard:live-home"));
    if (!window.AcardFolders && !editor && document.getElementById("side-tree")) {
      fetch(location.pathname + "?live=" + Date.now(), { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.text() : null; }).then(function (html) {
        var fresh = html && new DOMParser().parseFromString(html, "text/html").getElementById("side-tree");
        var side = document.getElementById("side-tree");
        if (fresh && side && fresh.innerHTML !== side.innerHTML) side.innerHTML = fresh.innerHTML;
      }).catch(function () {});
    }
  }

  function swapReader() {
    if (document.activeElement && document.activeElement.isContentEditable) return;
    fetch(location.pathname + "?live=" + Date.now(), { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.text() : null; }).then(function (html) {
      if (!html) return;
      var next = new DOMParser().parseFromString(html, "text/html");
      var main = document.getElementById("main"), fresh = next.getElementById("main");
      if (main && fresh && main.innerHTML !== fresh.innerHTML) {
        var y = window.scrollY;
        main.innerHTML = fresh.innerHTML;
        window.scrollTo(0, y);
        if (next.title) document.title = next.title;
        document.dispatchEvent(new CustomEvent("acard:page-fresh"));
      }
    }).catch(function () {});
  }

  function editorState() { return window.AcardEditor && window.AcardEditor.state; }
  function snapshot(state) { return JSON.stringify({ t: state.title, b: state.blocks }); }

  function applyEditor(data) {
    var ed = window.AcardEditor, state = editorState();
    if (!ed || !state || !data || !data.page) return;
    state.title = data.page.title;
    state.blocks = (data.blocks || []).length ? data.blocks : state.blocks;
    var title = document.getElementById("title");
    if (title && document.activeElement !== title) title.value = state.title;
    ed.render();
    hideBar();
  }

  function refreshEditor() {
    var state = editorState();
    if (!state) return;
    fetch("/api/page/" + encodeURIComponent(slug), { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data || !data.page) return;
      var now = editorState();
      if (snapshot({ title: data.page.title, blocks: data.blocks || [] }) === snapshot(now)) { hideBar(); return; }
      var idle = Date.now() - lastInput > 3000;
      if (!now.dirty && !now.saving && idle) applyEditor(data);
      else showBar(data);
    }).catch(function () {});
  }

  function showBar(data) {
    pending = data;
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "acard-live-bar";
      bar.setAttribute("role", "status");
      bar.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:60;display:flex;gap:10px;align-items:center;padding:8px 10px 8px 14px;border-radius:999px;background:var(--fg,#202733);color:var(--bg,#fff);font:500 var(--fs-14,14px)/1.4 inherit;box-shadow:0 6px 24px rgba(0,0,0,.18)";
      var text = document.createElement("span");
      text.textContent = "새 내용이 있어요";
      var view = document.createElement("button");
      view.type = "button";
      view.textContent = "보기";
      view.style.cssText = "border:0;border-radius:999px;padding:4px 12px;background:var(--accent,#7c5cff);color:#fff;font:inherit;cursor:pointer";
      view.onclick = function () {
        var state = editorState();
        if (state && state.dirty && !window.confirm("아직 저장되지 않은 내 수정이 있어요. 새 내용으로 바꿀까요?")) return;
        if (state) state.dirty = false;
        fetch("/api/page/" + encodeURIComponent(slug), { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : pending; }, function () { return pending; }).then(applyEditor);
      };
      bar.append(text, view);
      document.body.appendChild(bar);
    }
    bar.hidden = false;
  }
  function hideBar() { if (bar) bar.hidden = true; pending = null; }

  function handle(event, local) {
    api.events.push({ id: event.id, t: event.t, at: Date.now(), kinds: event.kinds, slugs: event.slugs });
    if (api.events.length > 100) api.events.shift();
    document.dispatchEvent(new CustomEvent("acard:live", { detail: event }));
    var mine = (event.slugs || []).indexOf(slug) >= 0 && event.src !== CID;
    var kinds = event.kinds || [];
    var treeish = kinds.some(function (k) { return k === "tree" || k === "title" || k === "tags" || k === "journal" || k === "deleted"; });
    dropCachedViews();
    if (treeish || kinds.indexOf("page") >= 0) refreshTree();
    if (!mine && !(kinds.indexOf("page") >= 0 && !(event.slugs || []).length)) return;
    if (editor) refreshEditor(); else swapReader();
    if (!local && channel) channel.postMessage(event);
  }

  if (channel) channel.onmessage = function (m) { if (m.data && m.data.id > last) { last = m.data.id; sessionStorage.setItem("acard-live-id", String(last)); } handle(m.data || {}, true); };

  function catchUp() {
    handle({ id: last, t: Date.now(), kinds: ["tree", "page"], slugs: [slug] }, true);
  }

  function open() {
    clearTimeout(timer);
    if (socket || document.hidden) return;
    api.status = "connecting";
    var url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/live?since=" + last;
    var ws;
    try { ws = new WebSocket(url); } catch (e) { schedule(); return; }
    socket = ws;
    var reconnecting = retry > 0;
    ws.onmessage = function (m) {
      if (m.data === "pong") return;
      var msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (msg.type === "hello") {
        retry = 0;
        api.status = "open";
        var gap = msg.reset || (reconnecting && !msg.missed.length && msg.id > last);
        last = msg.id;
        sessionStorage.setItem("acard-live-id", String(last));
        if (gap) catchUp();
        (msg.missed || []).forEach(function (e) { handle(e); });
        return;
      }
      if (msg.type === "change") {
        if (msg.id <= last) return;
        last = msg.id;
        sessionStorage.setItem("acard-live-id", String(last));
        handle(msg);
      }
    };
    ws.onclose = function () { if (socket === ws) { socket = null; api.status = "closed"; schedule(); } };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function schedule() {
    if (document.hidden) return;
    retry += 1;
    var wait = Math.min(30000, 500 * Math.pow(2, Math.min(retry, 6))) * (0.7 + Math.random() * 0.6);
    timer = setTimeout(open, wait);
  }

  function close() {
    clearTimeout(timer);
    var ws = socket; socket = null;
    if (ws) try { ws.close(1000, "background"); } catch (e) {}
    api.status = "paused";
  }

  document.addEventListener("visibilitychange", function () {
    clearTimeout(hideTimer);
    if (document.hidden) hideTimer = setTimeout(close, 30000);
    else if (!socket) { retry = 1; open(); }
  });
  window.addEventListener("online", function () { if (!socket) { retry = 1; open(); } });
  window.addEventListener("offline", close);
  setInterval(function () { if (socket && socket.readyState === 1) try { socket.send("ping"); } catch (e) {} }, 45000);

  if (window.AcardEditor && window.AcardEditor.transport) {
    window.AcardEditor.transport = function (pageSlug, payload) {
      return fetch("/api/page/" + encodeURIComponent(pageSlug), { method: "PUT", headers: { "content-type": "application/json", "x-acard-client": CID }, body: JSON.stringify(payload) });
    };
  }
  if (window.AcardEditor && window.AcardEditor.on) window.AcardEditor.on("saved", function () {
    if (channel) channel.postMessage({ id: 0, t: Date.now(), kinds: ["page", "title"], slugs: [slug] });
  });

  api.open = open;
  api.close = close;
  open();
})();
