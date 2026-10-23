// Import screen (/import): reads a Notion / Obsidian zip or a vault folder in the browser (lazy/import-engine.js + the reader chunks
// lazy/import-notion.js, lazy/import-obsidian.js, loaded on first use) and sends the plan to features/import.js in steps:
// batches -> files -> chunk -> finish (abort on stop or failure, undo from the result card). A single .md file still goes to /api/import/md.
(() => {
  const MAX_ARCHIVE = 500 * 1024 * 1024, MAX_ASSET = 10 * 1024 * 1024, MAX_MD = 2 * 1024 * 1024;
  const PAGES_PER_CHUNK = 300, CHUNK_BYTES = 2 * 1024 * 1024, PARALLEL = 3, RETRIES = 2;
  const ROW_CHUNK = 2000, ROW_CHUNK_BYTES = 1024 * 1024;
  const IMP_ASSET = "imp-asset:";
  const MIME = { pdf: "application/pdf", txt: "text/plain", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg" };
  const STOP = new Error("stop");
  const SKIP_TEXT = {
    "unsafe-path": "안전하지 않은 위치라서 건너뛰었어요",
    bomb: "압축을 풀면 너무 커져서 건너뛰었어요",
    "too-big": "10MB보다 커서 건너뛰었어요",
    "file-type": "이 형식의 파일은 올릴 수 없어요",
    unreadable: "읽을 수 없는 파일이에요",
    encoding: "글자를 읽지 못했어요",
    empty: "비어 있어요",
    "link-missing": "링크 대상이 내보낸 파일에 없어요",
    "link-ambiguous": "같은 이름이 여러 개라 첫 번째로 연결했어요",
    "relation-outside": "다른 데이터베이스와의 연결은 글자로 남겼어요",
    "embed-as-link": "다른 노트 임베드는 링크로 바꿨어요",
    "plugin-syntax": "플러그인 문법은 글자로 남겼어요",
    canvas: "캔버스는 아직 가져올 수 없어요",
    "duplicate-view": "같은 표의 다른 보기라 한 번만 가져왔어요",
    "limit-pages": "한 번에 가져올 수 있는 양을 넘었어요",
    "limit-rows": "한 번에 가져올 수 있는 양을 넘었어요",
    quota: "파일 저장 공간이 부족해요",
    "script-removed": "스크립트를 지웠어요",
    "unsupported-block": "지원하지 않는 블록은 글자로 남겼어요",
  };
  const ERROR_TEXT = {
    "too-big": "파일이 500MB보다 커요. 노션에서 팀 공간별로 나눠 내보내거나, 받은 zip 안의 Part 파일을 하나씩 올려 주세요.",
    "md-too-big": "파일이 너무 커요. 2MB 아래로 나눠 주세요.",
    "file-type": "zip 파일이나 볼트 폴더를 골라 주세요.",
    empty: "가져올 페이지를 찾지 못했어요. 노션에서 내보낸 zip이나 옵시디언 볼트인지 확인해 주세요.",
    corrupt: "압축 파일이 손상됐어요. 다시 내보내서 올려 주세요.",
    "too-many": "파일이 너무 많아요. 나눠서 가져와 주세요.",
    unreadable: "이 압축 방식은 읽을 수 없어요. 다시 내보내서 올려 주세요.",
    bomb: "압축을 풀면 너무 커지는 파일이 있어서 멈췄어요.",
    quota: "파일 저장 공간이 부족해요. 안 쓰는 파일을 지운 뒤 다시 시도해 주세요.",
    "limit-pages": "한 번에 가져올 수 있는 양을 넘었어요. 나눠서 가져와 주세요.",
    "limit-rows": "한 번에 가져올 수 있는 양을 넘었어요. 나눠서 가져와 주세요.",
    forbidden: "가져오기는 작업 공간 주인만 할 수 있어요.",
    conflict: "이미 끝났거나 멈춘 가져오기예요. 다시 시도해 주세요.",
    "not-found": "가져오기를 찾지 못했어요. 다시 시도해 주세요.",
    busy: "다른 가져오기가 진행 중이에요. 잠시 뒤 다시 시도해 주세요.",
    network: "인터넷 연결이 끊겼어요. 연결을 확인하고 다시 시도해 주세요.",
    other: "가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  };
  const svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  // Notion names every file "<name> <32 hex id>"; the id means nothing to a person, so the list shows the name only.
  const readablePath = (path) => String(path || "").split("/").map((seg) => seg.replace(/ [0-9a-f]{32}(?=(_all)?(\.[a-z0-9]+)?$)/i, "").replace(/_all(?=\.csv$)/i, "")).join("/");
  const ICON = {
    page: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>'),
    db: svg('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'),
    rows: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
    file: svg('<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  };
  const STATS = [["pages", "페이지", "page"], ["databases", "데이터베이스", "db"], ["dbRows", "행", "rows"], ["images", "이미지", "image"], ["attachments", "파일", "file"], ["internalLinks", "링크", "link"]];
  const fmt = (text, ...values) => { let i = 0; return text.replace(/\{n\}/g, () => String(values[i++])); };
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const codeError = (code, message) => Object.assign(new Error(message || code), { code });
  const mounted = new WeakSet();
  const loading = {};

  function mount() {
    const page = document.getElementById("import-page");
    if (!page || mounted.has(page)) return;
    mounted.add(page);
    const $ = (id) => document.getElementById(id);
    const el = {
      drop: $("import-drop"), pick: $("import-pick"), input: $("import-files"), folderPick: $("import-folder-pick"), folder: $("import-folder"),
      status: $("import-status"), progress: $("import-progress"), progressText: $("import-progress-text"), bar: $("import-bar"),
      barFill: $("import-bar-fill"), sub: $("import-progress-sub"), stop: $("import-stop"), result: $("import-result"), error: $("import-error"), dialog: $("import-dialog"),
    };
    let busy = false, stopAsked = false, last = null, depth = 0;

    function node(tag, text, className) {
      const n = document.createElement(tag);
      if (text != null) n.textContent = text;
      if (className) n.className = className;
      return n;
    }
    function icon(name, className) {
      const n = node("span", null, className || "import-icon");
      n.setAttribute("aria-hidden", "true");
      n.innerHTML = ICON[name];
      return n;
    }
    function button(text, className, onClick) {
      const b = node("button", text, "import-btn " + className);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    }
    function setBusy(on) {
      busy = on;
      if (on) stopAsked = false;
      for (const b of [el.pick, el.input, el.folderPick, el.folder]) b.disabled = on;
      el.stop.disabled = !on;
      el.drop.setAttribute("aria-busy", on ? "true" : "false");
    }
    function reset() {
      el.status.hidden = el.progress.hidden = el.result.hidden = el.error.hidden = true;
      el.sub.replaceChildren();
      el.result.replaceChildren();
      el.error.replaceChildren();
    }
    function message(text) {
      el.status.replaceChildren(node("span", text));
      el.status.hidden = false;
    }
    function progress(text, done, total) {
      el.progress.hidden = false;
      el.progressText.textContent = text;
      const max = total || 1, now = total ? done : 0;
      el.bar.setAttribute("aria-valuemax", String(max));
      el.bar.setAttribute("aria-valuenow", String(now));
      el.barFill.style.width = Math.round((now / max) * 100) + "%";
    }
    function guard() { if (stopAsked) throw STOP; }

    function chunk(name, global) {
      if (window[global]) return Promise.resolve(window[global]);
      return (loading[name] ||= new Promise((ok, bad) => {
        const script = document.createElement("script");
        script.src = page.dataset[name];
        script.onload = () => (window[global] ? ok(window[global]) : bad(codeError("network")));
        script.onerror = () => { loading[name] = null; bad(codeError("network")); };
        document.head.appendChild(script);
      }));
    }

    async function send(path, options) {
      let res;
      try { res = await fetch(path, options); } catch { throw codeError("network"); }
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data: data || {} };
    }
    const post = (path, body) => send(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const serverError = (r) => codeError(r.data.code || "other", r.data.error);

    function askDuplicates(count) {
      return new Promise((resolve) => {
        const opener = document.activeElement;
        const card = node("div", null, "import-dialog-card");
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute("aria-labelledby", "import-dialog-title");
        card.setAttribute("aria-describedby", "import-dialog-text");
        const title = node("h2", fmt("이미 가져온 페이지 {n}개가 있어요", count));
        title.id = "import-dialog-title";
        const text = node("p", "건너뛰면 이미 있는 페이지는 그대로 두고 새 것만 가져와요.");
        text.id = "import-dialog-text";
        const close = (choice) => {
          el.dialog.hidden = true;
          el.dialog.replaceChildren();
          if (opener && opener.focus) opener.focus();
          resolve(choice);
        };
        const skip = button("건너뛰고 가져오기", "is-primary", () => close("skip"));
        const copy = button("새 사본으로 가져오기", "is-secondary", () => close("copy"));
        const cancel = button("취소", "is-quiet", () => close(null));
        const order = [skip, copy, cancel];
        card.addEventListener("keydown", (event) => {
          if (event.key === "Escape") { event.preventDefault(); close(null); return; }
          if (event.key !== "Tab") return;
          const at = order.indexOf(document.activeElement);
          const next = event.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at < 0 || at === order.length - 1 ? 0 : at + 1);
          event.preventDefault();
          order[next].focus();
        });
        const actions = node("div", null, "import-dialog-actions");
        actions.append(skip, copy, cancel);
        card.append(title, text, actions);
        el.dialog.replaceChildren(card);
        el.dialog.hidden = false;
        skip.focus();
      });
    }

    function showResult(counts, skipped, first, batch) {
      const head = node("h2", "가져왔어요");
      const stats = node("ul", null, "import-stats");
      for (const [key, label, name] of STATS) {
        const tile = node("li", null, "import-stat");
        const words = node("span", null, "import-stat-text");
        words.append(node("span", label, "import-stat-label"), node("strong", String(Number(counts && counts[key]) || 0), "import-stat-num"));
        tile.append(icon(name, "import-stat-icon"), words);
        stats.appendChild(tile);
      }
      const parts = [head, stats];
      if (skipped.length) {
        const details = node("details", null, "import-skipped");
        details.open = true;
        const summary = node("summary");
        summary.append(icon("chevron", "import-chevron"), node("span", fmt("들어오지 않은 것 {n}개", skipped.length)));
        const list = node("ul", null, "import-skip-list");
        for (const item of skipped) {
          const row = node("li");
          const path = node("span", readablePath(item.path), "import-skip-path");
          path.setAttribute("translate", "no");
          path.title = item.path;
          row.append(icon("page"), path, node("span", SKIP_TEXT[item.code] || SKIP_TEXT.unreadable, "import-skip-reason"));
          list.appendChild(row);
        }
        details.append(summary, list);
        parts.push(details);
      }
      const actions = node("div", null, "import-actions");
      if (first) {
        const open = node("a", "첫 페이지 열기", "import-btn is-primary");
        open.href = "/" + encodeURIComponent(first) + "/";
        actions.appendChild(open);
      }
      if (batch) {
        const undo = button("이번 가져오기 되돌리기", "is-link", async () => {
          undo.disabled = true;
          const note = node("p", null, "import-note");
          try {
            const r = await post("/api/import/batches/" + encodeURIComponent(batch) + "/undo");
            if (!r.ok) throw serverError(r);
            note.textContent = "되돌렸어요. 휴지통에서 다시 꺼낼 수 있어요.";
            actions.replaceChildren(note);
            document.dispatchEvent(new CustomEvent("acard:tree-fresh"));
          } catch (error) {
            undo.disabled = false;
            note.textContent = ERROR_TEXT[error.code] || ERROR_TEXT.other;
            note.classList.add("is-error");
            actions.appendChild(note);
          }
        });
        actions.appendChild(undo);
      }
      parts.push(actions);
      el.result.replaceChildren(...parts);
      el.result.hidden = false;
    }

    function showError(code) {
      const retry = button("다시 시도", "is-primary", () => (last ? begin(last) : el.input.click()));
      el.error.classList.remove("is-info");
      el.error.dataset.code = code;
      el.error.replaceChildren(node("h2", "가져오지 못했어요"), node("p", ERROR_TEXT[code] || ERROR_TEXT.other), retry);
      el.error.hidden = false;
    }
    function showStopped() {
      el.error.classList.add("is-info");
      el.error.dataset.code = "stopped";
      el.error.replaceChildren(node("p", "가져오기를 멈췄어요. 들어온 것은 모두 지웠어요."));
      el.error.hidden = false;
    }

    async function uploadOne(batch, asset, plan) {
      const bytes = await asset.read();
      if (bytes.length > MAX_ASSET) { plan.skipped.push({ path: asset.path, code: "too-big" }); return; }
      for (let attempt = 0; ; attempt++) {
        const form = new FormData();
        form.append("key", asset.key);
        form.append("file", new File([bytes], asset.name, { type: MIME[String(asset.name).split(".").pop().toLowerCase()] || "" }));
        let res = null;
        try { res = await fetch("/api/import/batches/" + encodeURIComponent(batch) + "/files", { method: "POST", body: form }); } catch { res = null; }
        if (res && res.ok) return;
        const data = res ? (await res.json().catch(() => null)) || {} : {};
        if (res && (res.status < 500 || data.code === "quota")) { plan.skipped.push({ path: asset.path, code: SKIP_TEXT[data.code] ? data.code : "unreadable" }); return; }
        // After the retries one bad file is skipped with its reason and the rest keeps coming in (M-36); a dead connection
        // (no response at all) still stops the import, since every later request would fail the same way.
        if (attempt >= RETRIES) {
          if (!res) throw codeError("network");
          plan.skipped.push({ path: asset.path, code: "unreadable" });
          return;
        }
        await wait(400 * 2 ** attempt);
      }
    }

    async function uploadAssets(plan, batch) {
      const used = JSON.stringify(plan.pages.map((p) => p.blocks));
      const list = [];
      for (const asset of plan.assets) {
        if (!used.includes(JSON.stringify(IMP_ASSET + asset.key).slice(1, -1))) continue;
        if (asset.size > MAX_ASSET) plan.skipped.push({ path: asset.path, code: "too-big" });
        else list.push(asset);
      }
      if (!list.length) return;
      let next = 0, done = 0;
      const show = () => progress(fmt("파일 올리는 중 {n} / {n}", done, list.length), done, list.length);
      show();
      const worker = async () => {
        while (next < list.length) {
          guard();
          await uploadOne(batch, list[next++], plan);
          done += 1;
          show();
        }
      };
      const settled = await Promise.allSettled(Array.from({ length: Math.min(PARALLEL, list.length) }, worker));
      const failed = settled.find((s) => s.status === "rejected");
      if (failed) throw failed.reason;
      el.sub.replaceChildren(node("span", el.progressText.textContent), node("span", "완료", "import-done"));
    }

    async function importArchive(input, run) {
      progress("파일 읽는 중…");
      const engine = await chunk("engine", "AcardImportEngine");
      const items = input.collect ? await input.collect() : input.items;
      const read = input.kind === "zip" ? await engine.readZip(input.file) : engine.readFolder(items);
      guard();
      progress("가져올 내용 정리하는 중…");
      const plan = await engine.planFor(read.entries, input.name, (name) => chunk(name, name === "notion" ? "AcardImportNotion" : "AcardImportObsidian"));
      plan.skipped = read.skipped.concat(plan.skipped || []);
      guard();
      const body = {
        format: plan.format, name: plan.name || input.name,
        sources: [
          ...plan.pages.map((p) => ({ key: p.key, source: p.source, kind: p.kind === "db_row" ? "row" : "page", title: p.title })),
          ...plan.databases.map((d) => ({ key: d.key, source: d.source, kind: "db", title: d.title })),
        ],
      };
      let created = await post("/api/import/batches", body);
      if (created.status === 409 && created.data.duplicates) {
        const choice = await askDuplicates(created.data.duplicates);
        if (!choice) { el.progress.hidden = true; message("가져오기를 취소했어요."); return; }
        created = await post("/api/import/batches?duplicates=" + choice, body);
      }
      if (!created.ok) throw serverError(created);
      run.batch = created.data.id;
      const base = "/api/import/batches/" + encodeURIComponent(run.batch);
      await uploadAssets(plan, run.batch);
      const total = plan.pages.length;
      let done = 0;
      progress(fmt("페이지 만드는 중 {n} / {n}", 0, total), 0, total);
      for (const part of planChunks(plan)) {
        guard();
        const r = await post(base + "/chunk", { ...part, map: created.data.map });
        if (!r.ok) throw serverError(r);
        done += part.pages.length;
        progress(fmt("페이지 만드는 중 {n} / {n}", done, total), done, total);
      }
      guard();
      const finished = await post(base + "/finish", { report: { counts: plan.counts, skipped: plan.skipped.slice(0, 500) } });
      if (!finished.ok) throw serverError(finished);
      const batch = run.batch;
      run.batch = null; // finished: nothing to abort any more, only undo from the result card
      el.progress.hidden = true;
      const lost = new Map(plan.assets.map((x) => [x.path, x.kind]));
      const counts = { ...plan.counts };
      for (const item of plan.skipped.slice(read.skipped.length)) {
        const kind = lost.get(item.path);
        if (kind === "image") counts.images = Math.max(0, counts.images - 1);
        else if (kind === "file") counts.attachments = Math.max(0, counts.attachments - 1);
      }
      showResult(counts, plan.skipped.slice(0, 500), finished.data.first, batch);
      document.dispatchEvent(new CustomEvent("acard:tree-fresh"));
    }

    async function importMarkdown(files) {
      if (files.some((f) => f.size > MAX_MD)) throw codeError("md-too-big");
      progress("파일 읽는 중…");
      const form = new FormData();
      files.forEach((f) => form.append("file", f));
      const r = await send("/api/import/md", { method: "POST", body: form });
      if (!r.ok) throw codeError(r.status === 413 ? "md-too-big" : r.data.code || "other");
      const pages = r.data.pages || [];
      el.progress.hidden = true;
      showResult({ pages: r.data.imported || pages.length }, [], pages[0] && pages[0].slug, null);
      document.dispatchEvent(new CustomEvent("acard:tree-fresh"));
    }

    async function begin(input) {
      if (busy) return;
      reset();
      if (!input) { last = null; showError("file-type"); return; }
      if (input.kind === "zip" && input.file.size > MAX_ARCHIVE) { last = null; showError("too-big"); return; }
      last = input;
      setBusy(true);
      const run = { batch: null };
      try {
        if (input.kind === "md") await importMarkdown(input.files);
        else await importArchive(input, run);
      } catch (error) {
        el.progress.hidden = true;
        if (error === STOP) {
          if (run.batch) {
            const r = await post("/api/import/batches/" + encodeURIComponent(run.batch) + "/abort").catch(() => null);
            if (!r || !r.ok) { showError("network"); return; }
          }
          showStopped();
          return;
        }
        if (run.batch) await post("/api/import/batches/" + encodeURIComponent(run.batch) + "/abort").catch(() => null);
        showError(error && error.code ? error.code : "other");
      } finally {
        setBusy(false);
        el.input.value = "";
        el.folder.value = "";
      }
    }

    function fromFiles(files) {
      const zip = files.find((f) => /\.zip$/i.test(f.name));
      if (zip) return { kind: "zip", file: zip, name: zip.name };
      if (files.length && files.every((f) => /\.(md|markdown)$/i.test(f.name))) return { kind: "md", files };
      return null;
    }
    function walk(entry, prefix, out) {
      if (entry.isFile) return new Promise((ok, bad) => entry.file((file) => { out.push({ path: prefix + entry.name, file }); ok(); }, bad));
      return new Promise((ok, bad) => {
        const reader = entry.createReader(), all = [];
        const more = () => reader.readEntries((list) => {
          if (list.length) { all.push(...list); more(); return; }
          Promise.all(all.map((child) => walk(child, prefix + entry.name + "/", out))).then(ok, bad);
        }, bad);
        more();
      });
    }

    el.pick.addEventListener("click", () => el.input.click());
    el.folderPick.addEventListener("click", () => el.folder.click());
    el.input.addEventListener("change", () => begin(fromFiles(Array.from(el.input.files || []))));
    el.folder.addEventListener("change", () => {
      const items = Array.from(el.folder.files || []);
      if (!items.length) return;
      return begin({ kind: "folder", items, name: String(items[0].webkitRelativePath || "").split("/")[0] || "vault" });
    });
    el.stop.addEventListener("click", () => {
      if (!busy || stopAsked) return;
      stopAsked = true;
      el.stop.disabled = true;
      el.progressText.textContent = "멈추는 중…";
    });
    el.drop.addEventListener("dragenter", (event) => { event.preventDefault(); depth++; if (!busy) el.drop.classList.add("is-dragging"); });
    el.drop.addEventListener("dragover", (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy"; });
    el.drop.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; el.drop.classList.remove("is-dragging"); } });
    el.drop.addEventListener("drop", (event) => {
      event.preventDefault();
      depth = 0;
      el.drop.classList.remove("is-dragging");
      if (busy) return;
      const dt = event.dataTransfer || {};
      const entries = Array.from(dt.items || []).map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
      const dir = entries.find((e) => e.isDirectory);
      if (dir) return begin({ kind: "folder", name: dir.name, collect: async () => { const out = []; for (const e of entries) await walk(e, "", out); return out; } });
      return begin(fromFiles(Array.from(dt.files || [])));
    });
  }

  // Same rules as planChunks / rowValues in features/import.js: pages parent-first, <= 300 pages and ~2 MB of JSON per chunk,
  // databases in the first chunk, rows in the last with relations as {database, index} and option names as option ids.
  function planChunks(plan) {
    const order = [];
    const byKey = new Map(plan.pages.map((p) => [p.key, p]));
    const seen = new Set();
    const visit = (p) => { if (seen.has(p.key)) return; seen.add(p.key); if (p.parent && byKey.has(p.parent)) visit(byKey.get(p.parent)); order.push(p); };
    plan.pages.forEach(visit);
    const chunks = [];
    let cur = { pages: [], databases: [], rows: [] }, size = 0;
    for (const p of order) {
      const len = JSON.stringify(p.blocks).length + 200;
      if (cur.pages.length && (cur.pages.length >= PAGES_PER_CHUNK || size + len > CHUNK_BYTES)) { chunks.push(cur); cur = { pages: [], databases: [], rows: [] }; size = 0; }
      cur.pages.push({ key: p.key, title: p.title, parent: p.parent, kind: p.kind, blocks: p.blocks, tags: p.tags, icon: p.icon });
      size += len;
    }
    chunks.push(cur);
    chunks[0].databases = plan.databases.map((d) => ({ key: d.key, title: d.title, parent: d.parent, properties: d.properties }));
    const rowAt = new Map();
    plan.databases.forEach((d) => d.rows.forEach((r, index) => rowAt.set(r.page, { database: d.key, index: index + 1 })));
    // Rows go after every page in chunks of their own (a 20,000-row table is ~12 MB of JSON, over the store's 2 MB string
    // limit in one statement): at most ROW_CHUNK rows and ROW_CHUNK_BYTES of JSON each.
    let rowChunk = null, rowSize = 0;
    for (const d of plan.databases) d.rows.forEach((r, index) => {
      const row = { database: d.key, page: r.page, index: index + 1, values: rowValues(d, r, rowAt) };
      const len = JSON.stringify(row).length;
      if (!rowChunk || rowChunk.rows.length >= ROW_CHUNK || rowSize + len > ROW_CHUNK_BYTES) { rowChunk = { pages: [], databases: [], rows: [] }; rowSize = 0; chunks.push(rowChunk); }
      rowChunk.rows.push(row);
      rowSize += len;
    });
    return chunks;
  }
  function rowValues(database, row, rowAt) {
    const out = {};
    for (const prop of database.properties) {
      let value = row.values[prop.id];
      if (value === undefined) continue;
      const options = prop.config && Array.isArray(prop.config.options) ? prop.config.options : null;
      if ((prop.type === "select" || prop.type === "status") && options) {
        const option = options.find((o) => o.name === value);
        value = option ? option.id : null;
      } else if (prop.type === "relation") {
        value = (Array.isArray(value) ? value : []).map((key) => rowAt.get(key)).filter(Boolean);
      } else if (prop.type === "multi_select" && options) {
        value = (Array.isArray(value) ? value : []).map((name) => (options.find((o) => o.name === name) || {}).id).filter(Boolean);
      }
      out[prop.id] = value;
    }
    return out;
  }

  mount();
  document.addEventListener("acard:navigated", mount);
})();
