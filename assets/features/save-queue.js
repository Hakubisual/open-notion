(function (root) {
  "use strict";
  var PREFIX = "acard-save-queue:";
  var copy = function (value) { return JSON.parse(JSON.stringify(value)); };
  function delay(attempt) { return Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5))); }

  // Journal first; bounded IndexedDB steps and tombstones preserve pending edits.
  var STEP_MS = 2000;
  function within(promise, fallback) {
    return new Promise(function (resolve) {
      var done = false, timer = setTimeout(function () { finish(fallback); }, STEP_MS);
      function finish(value) { if (!done) { done = true; clearTimeout(timer); resolve(value); } }
      Promise.resolve(promise).then(finish, function () { finish(fallback); });
    });
  }
  function opened(request) {
    return new Promise(function (resolve) {
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () { db.close(); };
        resolve(db);
      };
      request.onerror = function (event) { if (event && event.preventDefault) event.preventDefault(); resolve(null); };
      request.onblocked = function () {};
    });
  }
  function storage(local, indexed, identity) {
    if (!identity) return { read: function () { return []; }, write: function () {} };
    var prefix = PREFIX + identity + ":", name = "acard-save-queue:" + identity;
    function open(version) {
      var request;
      try { request = version ? indexed.open(name, version) : indexed.open(name); } catch (_) { return Promise.resolve(null); }
      request.onupgradeneeded = function () { if (!request.result.objectStoreNames.contains("pages")) request.result.createObjectStore("pages", { keyPath: "slug" }); };
      return opened(request).then(function (db) { if (db) return db; request.onsuccess = function () { request.result.close(); }; return null; });
    }
    function readAll(db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction("pages").objectStore("pages").getAll();
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    }
    function reset(db) {
      return within(readAll(db), []).then(function (rows) {
        try { if (local) rows.forEach(function (row) { if (row && row.acard_id === identity && row.slug && row.payload && !local.getItem(prefix + row.slug)) local.setItem(prefix + row.slug, JSON.stringify(row)); }); } catch (_) {}
        var version = db.version + 1;
        db.close();
        return within(new Promise(function (resolve) {
          var request;
          try { request = indexed.deleteDatabase(name); } catch (_) { resolve(); return; }
          request.onsuccess = request.onerror = request.onblocked = function () { resolve(); };
        }), null).then(function () { return within(open(1), null).then(function (fresh) { return fresh || within(open(version), null); }); });
      });
    }
    function repair(db) {
      if (!db) return null;
      if (!db.objectStoreNames.contains("pages")) { var next = db.version + 1; db.close(); return within(open(next), null); }
      return within(readAll(db).then(function () { return db; }, function () { return reset(db); }), null);
    }
    var database = indexed ? within(open(1).then(function (db) { return db || within(open(0), null); }).then(repair), null) : Promise.resolve(null);
    function journal() {
      var records = [];
      if (local) for (var i = 0; i < local.length; i++) {
        var key = local.key(i);
        if (key && key.indexOf(prefix) === 0) records.push(JSON.parse(local.getItem(key)));
      }
      return records;
    }
    return {
      read: function () {
        return database.then(function (db) {
          if (!db) return journal();
          return within(new Promise(function (resolve, reject) {
            var request;
            try { request = db.transaction("pages").objectStore("pages").getAll(); } catch (_) { resolve(journal()); return; }
            request.onsuccess = function () { try { resolve(request.result.concat(journal())); } catch (error) { reject(error); } };
            request.onerror = function () { try { resolve(journal()); } catch (error) { reject(error); } };
          }), null).then(function (rows) { return rows || journal(); });
        });
      },
      write: function (entry) {
        if (entry.acard_id !== identity) return Promise.resolve();
        var durable = false;
        try { if (local) { local.setItem(prefix + entry.slug, JSON.stringify(entry)); durable = true; } } catch (_) {}
        return database.then(function (db) {
          if (!db) { if (!durable) throw new Error("기기에 변경을 보관할 수 없어요. 이 탭을 닫지 마세요."); return; }
          var stored = new Promise(function (resolve, reject) {
            var tx;
            try { tx = db.transaction("pages", "readwrite"); tx.objectStore("pages").put(entry); } catch (error) { if (durable) resolve(); else reject(error); return; }
            tx.oncomplete = function () { resolve(); };
            tx.onerror = tx.onabort = function () { if (durable) resolve(); else reject(tx.error || new Error("기기 저장 공간을 확인해 주세요.")); };
          });
          return durable ? within(stored, undefined) : stored;
        });
      }
    };
  }

  function create(options) {
    var records = new Map(), active = new Map(), writes = new Map(), texts = new Map(), sequence = 0;
    var identity = options.identity || "";
    var now = options.now || Date.now;
    function changed() { if (options.changed) options.changed(); }
    function persist(entry, text) {
      records.set(entry.slug, entry);
      // The serialized payload of the live record, so a repeat enqueue compares strings instead of re-stringifying.
      if (text) texts.set(entry.slug, text); else texts.delete(entry.slug);
      var pending = Promise.resolve(identity ? options.storage.write(copy(entry)) : undefined);
      writes.set(entry.slug, pending);
      // Expose errors to the UI without creating an unhandled rejected promise.
      pending.catch(function (error) { if (options.error) options.error(error); });
      changed();
      return pending;
    }
    function next() { sequence = Math.max(sequence + 1, now() * 1000); return sequence; }
    function entries() { return Array.from(records.values()).filter(function (entry) { return entry.payload; }); }
    function enqueue(slug, payload) {
      var old = records.get(slug), text = JSON.stringify(payload);
      if (old && old.payload) {
        if (!texts.has(slug)) texts.set(slug, JSON.stringify(old.payload));
        if (texts.get(slug) === text) return old;
      }
      var entry = { slug: slug, acard_id: identity, base_updated: payload.base_updated, payload: JSON.parse(text), sequence: next(), updated: now(), attempts: 0, nextAt: 0,
        blocked: old && old.base_updated === payload.base_updated ? old.blocked : 0 };
      persist(entry, text);
      return entry;
    }
    function remove(entry) {
      return persist({ slug: entry.slug, acard_id: identity, sequence: next(), payload: null });
    }
    function attempt(slug, force) {
      if (active.has(slug)) return active.get(slug);
      var entry = records.get(slug);
      if (!entry || !entry.payload || entry.acard_id !== identity || !Number.isSafeInteger(entry.base_updated) || entry.blocked || (!force && entry.nextAt > now())) return Promise.resolve(null);
      var run = Promise.resolve(writes.get(slug)).then(function () {
        return options.send(slug, copy(entry.payload));
      }).then(async function (response) {
        var current = records.get(slug);
        if (response.ok) {
          var result = await response.clone().json();
          if (Number.isSafeInteger(result.updated)) {
            if (options.saved) options.saved(slug, entry.payload, result.updated);
            current = records.get(slug);
            // Only our acknowledged write can rebase newer typing.
            if (current.sequence !== entry.sequence && current.base_updated === entry.base_updated) {
              await persist(Object.assign({}, current, { base_updated: result.updated, payload: Object.assign({}, current.payload, { base_updated: result.updated }) }));
            }
          }
        }
        if (current.sequence !== entry.sequence) {
          if (response.status === 409 && current.base_updated === entry.base_updated) await persist(Object.assign({}, current, { blocked: 409 }));
          return response;
        }
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
      ready: Promise.resolve(identity ? options.storage.read() : []).then(function (stored) {
        // Recovery may finish after this tab edited or acknowledged a save. Its
        // shared snapshot is never a continuation of those local edits.
        var local = new Set(records.keys());
        stored.forEach(function (entry) {
          if (entry.acard_id !== identity) return;
          sequence = Math.max(sequence, entry.sequence);
          if (local.has(entry.slug)) return;
          var current = records.get(entry.slug);
          if (!current || entry.sequence >= current.sequence) { records.set(entry.slug, entry); texts.delete(entry.slug); }
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
  root.AcardSaveQueue = { create: create, storage: storage, delay: delay, within: within };
  var editor = root.AcardEditor;
  if (!editor) return;
  var previous = editor.transport, timer, initialized = false, recovering = false, storageError = "", edited = false, notBefore = 0;
  var identity = document.querySelector('meta[name="acard-id"]')?.content || "";
  var local;
  try { local = root.localStorage; } catch (_) {}
  var queue = create({
    identity: identity,
    storage: storage(local, root.indexedDB, identity),
    send: function (slug, payload) { return previous.call(editor, slug, payload); },
    saved: function (slug, payload, updated) { if (slug === editor.slug && editor.state.baseUpdated === payload.base_updated) editor.state.baseUpdated = updated; },
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
    var due = pending.filter(function (entry) { return !entry.blocked && Number.isSafeInteger(entry.base_updated); });
    if (due.length && !queue.busy() && navigator.onLine !== false) {
      timer = setTimeout(function () { commit(); queue.flush(false).then(settled); }, Math.max(0, Math.max(notBefore, Math.min.apply(null, due.map(function (entry) { return entry.nextAt; }))) - Date.now()));
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
  // Typing emits "change" per keystroke. The journal takes the first edit at once and later ones at most every
  // CHANGE_MS (the blocks array is live, so the commit holds the newest text); a save, pagehide, visibility
  // change or the queue's own flush timer commits the rest first, so nothing waits on the timer.
  var CHANGE_MS = 300, pendingChange = null, changeTimer = null, captured = 0;
  function capture(payload) {
    edited = true;
    pendingChange = null;
    if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
    captured = Date.now();
    queue.enqueue(editor.slug, Object.assign({}, payload, { base_updated: editor.state.baseUpdated }));
  }
  function commit() { changeTimer = null; if (pendingChange) capture(pendingChange); }
  function captureSoon(payload) {
    edited = true;
    pendingChange = payload;
    if (changeTimer) return;
    var wait = captured + CHANGE_MS - Date.now();
    if (wait <= 0) commit();
    else changeTimer = setTimeout(commit, wait);
  }
  editor.on("change", function (payload) { notBefore = Date.now() + 750; captureSoon(payload); });
  editor.on("beforeSave", capture);
  editor.transport = function (slug, payload) {
    queue.enqueue(slug, payload);
    return queue.ready.then(function () { return queue.attempt(slug, false); }).then(function (response) {
      if (response && response.ok && queue.get(slug).payload) return queue.attempt(slug, true);
      return response;
    }).then(function (response) {
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
    return queue.ready.then(async function () {
      var entry = queue.get(editor.slug);
      if (entry && entry.payload && !edited) {
        editor.state.title = entry.payload.title;
        editor.state.blocks = copy(entry.payload.blocks);
        editor.state.dirty = true;
        editor.state.baseUpdated = entry.base_updated;
        editor.render();
        if (!Number.isSafeInteger(entry.base_updated) || editor.base && entry.base_updated !== editor.base.updated) await queue.block(entry);
        else recovering = !entry.blocked;
      }
      if (edited && editor.state.dirty) capture({ title: editor.state.title, blocks: editor.state.blocks });
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
    commit();
    if (!initialized) return;
    if (editor.state.dirty) capture({ title: editor.state.title, blocks: editor.state.blocks });
    queue.flush(true).then(settled);
  }
  root.addEventListener("online", flush);
  root.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flush);
})(typeof window === "undefined" ? globalThis : window);
