(function () {
  var mounted = new WeakSet();
  function mount() {
    var page = document.getElementById("import-page");
    if (!page || mounted.has(page)) return;
    mounted.add(page);
    var drop = document.getElementById("import-drop");
    var pick = document.getElementById("import-pick");
    var input = document.getElementById("import-files");
    var status = document.getElementById("import-status");
    var results = document.getElementById("import-results");
    var list = document.getElementById("import-pages");
    var busy = false, depth = 0;

    function text(tag, value, className) {
      var node = document.createElement(tag);
      node.textContent = value;
      if (className) node.className = className;
      return node;
    }
    function message(value, error) {
      status.replaceChildren(text("span", value));
      status.hidden = false;
      status.classList.toggle("is-error", !!error);
    }
    function show(body) {
      (body.pages || []).forEach(function (p) {
        var row = document.createElement("li");
        var title = text("span", p.title || p.slug, "import-page-name");
        title.setAttribute("translate", "no");
        var open = text("a", "열기", "import-open");
        open.href = "/" + encodeURIComponent(p.slug) + "/";
        row.append(title, open);
        list.appendChild(row);
      });
      results.hidden = !list.children.length;
      if (body.imported) document.dispatchEvent(new CustomEvent("acard:tree-fresh"));
    }
    async function send(url, options) {
      var response = await fetch(url, options);
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(body.error || String(response.status));
      show(body);
      return body;
    }
    async function upload(files) {
      if (busy || !files.length) return;
      for (var f of files) {
        if (!/\.(zip|md)$/i.test(f.name)) { message("zip 또는 .md 파일을 골라 주세요.", true); return; }
        var zip = /\.zip$/i.test(f.name);
        if (f.size > (zip ? 30 : 2) * 1024 * 1024) {
          message(zip ? "파일이 너무 커요. 30MB 아래로 나눠 주세요." : "파일이 너무 커요. 2MB 아래로 나눠 주세요.", true);
          return;
        }
      }
      busy = true;
      pick.disabled = input.disabled = true;
      drop.setAttribute("aria-busy", "true");
      message("가져오는 중…");
      var imported = 0, warnings = [], skipped = 0;
      try {
        var markdown = files.filter(function (f) { return /\.md$/i.test(f.name); });
        var archives = files.filter(function (f) { return /\.zip$/i.test(f.name); });
        function count(body) {
          imported += body.imported || 0;
          warnings = warnings.concat(body.warnings || []);
          skipped += (body.skipped || []).length;
        }
        for (var archive of archives) {
          count(await send("/api/import", { method: "POST", headers: { "content-type": "application/zip" }, body: await archive.arrayBuffer() }));
        }
        if (markdown.length) {
          var form = new FormData();
          markdown.forEach(function (f) { form.append("file", f); });
          count(await send("/api/import/md", { method: "POST", body: form }));
        }
        message(imported ? "가져왔어요." : "가져올 페이지를 찾지 못했어요.");
        if (imported) status.appendChild(text("span", String(imported), "import-count"));
        if (skipped) status.append(text("span", "건너뛴 파일"), text("span", String(skipped), "import-count"));
        if (warnings.length) {
          status.appendChild(text("span", "알림:"));
          warnings.forEach(function (warning) { status.appendChild(text("span", warning)); });
        }
      } catch (error) {
        message("가져오기 실패:", true);
        status.appendChild(text("span", error.message));
      } finally {
        busy = false;
        pick.disabled = input.disabled = false;
        drop.setAttribute("aria-busy", "false");
        input.value = "";
      }
    }
    pick.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () { return upload(Array.from(input.files || [])); });
    drop.addEventListener("dragenter", function (event) { event.preventDefault(); depth++; if (!busy) drop.classList.add("is-dragging"); });
    drop.addEventListener("dragover", function (event) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy"; });
    drop.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; drop.classList.remove("is-dragging"); } });
    drop.addEventListener("drop", function (event) {
      event.preventDefault(); depth = 0; drop.classList.remove("is-dragging");
      return upload(Array.from(event.dataTransfer.files || []));
    });
  }
  mount();
  document.addEventListener("acard:navigated", mount);
})();
