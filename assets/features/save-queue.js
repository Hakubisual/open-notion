(function (root) {
  "use strict";
  var PREFIX = "acard-save-queue:";
  var copy = function (value) { return JSON.parse(JSON.stringify(value)); };
  function delay(attempt) { return Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5))); }

  // A synchronous journal closes the gap between an edit and IndexedDB commit.
  // Tombstones prevent an older IndexedDB copy from resurrecting a saved edit.
  function storage(local, indexed) {
    var database = indexed ? new Promise(function (resolve) {
      var request;
      try { request = indexed.open("acard-save-queue", 1); } catch (_) { resolve(null); return; }
      request.onupgradeneeded = function () { request.result.createObjectStore("pages", { keyPath: "slug" }); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = request.onblocked = function () { resolve(null); };
    }) : Promise.resolve(null);
    function journal() {
      var records = [];
      if (local) for (var i = 0; i < local.length; i++) {
        var key = local.key(i);
        if (key && key.indexOf(PREFIX) === 0) records.push(JSON.parse(local.getItem(key)));
      }
      return records;
    }
    return {
      read: function () {
        return database.then(function (db) {
          if (!db) return journal();
          return new Promise(function (resolve, reject) {
            var request = db.transaction("pages").objectStore("pages").getAll();
            request.onsuccess = function () { try { resolve(request.result.concat(journal())); } catch (error) { reject(error); } };
            request.onerror = function () { try { resolve(journal()); } catch (error) { reject(error); } };
          });
        });
      },
      write: function (entry) {
        var durable = false;
        try { if (local) { local.setItem(PREFIX + entry.slug, JSON.stringify(entry)); durable = true; } } catch (_) {}
        return database.then(function (db) {
          if (!db) { if (!durable) throw new Error("기기에 변경을 보관할 수 없어요. 이 탭을 닫지 마세요."); return; }
          return new Promise(function (resolve, reject) {
            var tx = db.transaction("pages", "readwrite");
            tx.objectStore("pages").put(entry);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = tx.onabort = function () { if (durable) resolve(); else reject(tx.error || new Error("기기 저장 공간을 확인해 주세요.")); };
          });
        });
      }
    };
  }

  function create(options) {
    var records = new Map(), active = new Map(), writes = new Map(), sequence = 0;
    var now = options.now || Date.now;
    function changed() { if (options.changed) options.changed(); }
    function persist(entry) {
      records.set(entry.slug, entry);
      var pending = Promise.resolve(options.storage.write(copy(entry)));
      writes.set(entry.slug, pending);
      // Expose errors to the UI without creating an unhandled rejected promise.
      pending.catch(function (error) { if (options.error) options.error(error); });
      changed();
      return pending;
    }
    function next() { sequence = Math.max(sequence + 1, now() * 1000); return sequence; }
    function entries() { return Array.from(records.values()).filter(function (entry) { return entry.payload; }); }
    function enqueue(slug, payload) {
      var old = records.get(slug);
      if (old && old.payload && JSON.stringify(old.payload) === JSON.stringify(payload)) return old;
      var entry = { slug: slug, payload: copy(payload), sequence: next(), updated: now(), attempts: 0, nextAt: 0, blocked: 0 };
      persist(entry);
      return entry;
    }
    function remove(entry) {
      return persist({ slug: entry.slug, sequence: next(), payload: null });
    }
    function attempt(slug, force) {
      if (active.has(slug)) return active.get(slug);
      var entry = records.get(slug);
      if (!entry || !entry.payload || entry.blocked || (!force && entry.nextAt > now())) return Promise.resolve(null);
      var run = Promise.resolve(writes.get(slug)).then(function () {
        return options.send(slug, copy(entry.payload));
      }).then(async function (response) {
        if (records.get(slug).sequence !== entry.sequence) return response;
        if (response.ok) await remove(entry);
        else if (response.status >= 400 && response.status < 500) {
          await persist(Object.assign({}, entry, { blocked: response.status }));
        } else {
          await persist(Object.assign({}, entry, { attempts: entry.attempts + 1, nextAt: now() + delay(entry.attempts) }));
        }
        return response;
      }, async function (error) {
        if (records.get(slug).sequence === entry.sequence) {
          await persist(Object.assign({}, entry, { attempts: entry.attempts + 1, nextAt: now() + delay(entry.attempts) }));
        }
        throw error;
      }).finally(function () { active.delete(slug); changed(); });
      active.set(slug, run);
      changed();
      return run;
    }
    return {
      ready: Promise.resolve(options.storage.read()).then(function (stored) {
        stored.forEach(function (entry) {
          sequence = Math.max(sequence, entry.sequence);
          var current = records.get(entry.slug);
          if (!current || entry.sequence >= current.sequence) records.set(entry.slug, entry);
        });
        changed();
      }),
      enqueue: enqueue, entries: entries, attempt: attempt, remove: remove,
      get: function (slug) { return records.get(slug); },
      busy: function () { return active.size > 0; },
      block: function (entry) { return persist(Object.assign({}, entry, { blocked: 409 })); },
      flush: function (force) {
        return Promise.all(entries().map(function (entry) { return attempt(entry.slug, force).catch(function () {}); }));
      }
    };
  }
  root.AcardSaveQueue = { create: create, storage: storage, delay: delay };
  var editor = root.AcardEditor;
  if (!editor) return;
  var previous = editor.transport, timer, initialized = false, recovering = false, storageError = "", edited = false, notBefore = 0;
  var local;
  try { local = root.localStorage; } catch (_) {}
  var queue = create({
    storage: storage(local, root.indexedDB),
    send: function (slug, payload) { return previous.call(editor, slug, payload); },
    changed: function () { if (queue) update(); },
    error: function (error) { storageError = error.message; update(); }
  });
  function update() {
    if (!queue || !initialized) return;
    clearTimeout(timer);
    var pending = queue.entries();
    var blocked = pending.find(function (entry) { return entry.blocked; });
    var text = storageError || (blocked ? (blocked.blocked === 409
      ? "저장 충돌 - 기기에 보관했어요. 서버 내용을 확인해 주세요."
      : "저장 중단 (" + blocked.blocked + ") - 기기에 보관했어요. 로그인과 권한을 확인해 주세요.")
      : pending.length ? (navigator.onLine === false ? "오프라인 - " + pending.length + "개 대기 중" : recovering || pending.some(function (entry) { return entry.attempts; }) ? "저장 안 된 변경을 다시 보내는 중" : "저장 중…") : "저장됨");
    var element = document.getElementById("save-state");
    if (element && ((element.dataset && element.dataset.text) ?? element.textContent) !== text) editor.setSave(text, !!pending.length || !!storageError);
    if (!pending.length && !editor.state.saving && JSON.stringify({ title: editor.state.title, blocks: editor.state.blocks }) === acknowledged) editor.state.dirty = false;
    var due = pending.filter(function (entry) { return !entry.blocked; });
    if (due.length && !queue.busy() && navigator.onLine !== false) {
      timer = setTimeout(function () { queue.flush(false).then(settled); }, Math.max(0, Math.max(notBefore, Math.min.apply(null, due.map(function (entry) { return entry.nextAt; }))) - Date.now()));
    }
  }
  var acknowledged = "";
  function settled() {
    if (!queue.get(editor.slug) || !queue.get(editor.slug).payload) {
      acknowledged = JSON.stringify({ title: editor.state.title, blocks: editor.state.blocks });
    }
    recovering = false;
    update();
  }
  function capture(payload) {
    edited = true;
    queue.enqueue(editor.slug, payload);
  }
  editor.on("change", function (payload) { notBefore = Date.now() + 750; capture(payload); });
  editor.on("beforeSave", capture);
  editor.transport = function (slug, payload) {
    queue.enqueue(slug, payload);
    return queue.ready.then(function () { return queue.attempt(slug, false); }).then(function (response) {
      if (!response) {
        var entry = queue.get(slug);
        return new Response(JSON.stringify({ error: "저장 중단 - 기기에 보관했어요." }), { status: entry && entry.blocked || 503 });
      }
      return response.clone();
    }).finally(settled);
  };
  editor.on("saved", settled);
  editor.on("saveFailed", function () { recovering = false; update(); });
  editor.on("ready", function () {
    queue.ready.then(async function () {
      var entry = queue.get(editor.slug);
      if (entry && entry.payload && !edited) {
        editor.state.title = entry.payload.title;
        editor.state.blocks = copy(entry.payload.blocks);
        editor.render();
        var server = await editor.api("/page/" + encodeURIComponent(editor.slug)).catch(function () { return null; });
        if (!edited) {
          if (server && JSON.stringify(entry.payload) === JSON.stringify({ title: server.page.title, blocks: server.blocks })) await queue.remove(entry);
          else {
            if (server && entry.updated < Number(server.page.updated)) await queue.block(entry);
            else recovering = !entry.blocked;
          }
        }
      }
      initialized = true;
      update();
      if (navigator.onLine !== false) await queue.flush(false);
      settled();
    }).catch(function (error) { storageError = error.message; initialized = true; update(); });
  });
  // Core callers also write status after rejecting save(); keep the durable state visible.
  var status = document.getElementById("save-state");
  if (status) new MutationObserver(function () { if (initialized && queue.entries().length) update(); }).observe(status, { childList: true });
  function flush() {
    if (!initialized) return;
    if (editor.state.dirty) capture({ title: editor.state.title, blocks: editor.state.blocks });
    queue.flush(true).then(settled);
  }
  root.addEventListener("online", flush);
  document.addEventListener("visibilitychange", flush);
})(typeof window === "undefined" ? globalThis : window);
