// 부품으로 등록 (#38 stage 2): the block menu of an HTML / visual block opens this dialog, which registers the block's code
// as a workspace part (POST /api/parts) and, by default, turns the block itself into a part block that reads the part.
// Loaded with lazy("part-register") from the editor; provides { open(block, index) }. The preview runs the block in the
// same opaque-origin sandbox the page uses (visuals chunk when it is there, a bare sandboxed frame otherwise).
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var dialog = null, sending = false, toastTimer = 0, frameHost = null;
  var TYPE = { string: "글자", number: "숫자", boolean: "예/아니오", array: "목록", object: "묶음" };
  var MARK = { string: "T", number: "#", boolean: "?", array: "[]", object: "{}" };
  var LETTERS = "abcdefghijklmnopqrstuvwxyz";
  var CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";

  function node(tag, text, cls) { var el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
  function button(text, fn, cls) { var el = node("button", text, cls); el.type = "button"; el.addEventListener("click", fn); return el; }
  function kind(v) { return v === null || v === undefined ? "string" : Array.isArray(v) ? "array" : typeof v; }
  function randomId() { var s = "part-"; for (var i = 0; i < 6; i += 1) s += LETTERS[Math.floor(Math.random() * 26)]; return s; }
  // The 주소 이름 (part id) is the ascii slug of the name: a-z, 0-9 and -, starting with a letter, 2-40 chars.
  function slugify(name) {
    var s = String(name || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFKD");
    s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    if (!s) return "";
    if (!/^[a-z]/.test(s)) s = ("part-" + s).slice(0, 40);
    if (s.length < 2) s += "-part";
    return s;
  }
  function decode(html) {
    return String(html).replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, function (m, e) { return { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " }[e]; }).replace(/\s+/g, " ").trim();
  }
  // The first heading or strong text in the block is the name to start from.
  function guessName(code) {
    var re = /<(h[1-6]|strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, m;
    while ((m = re.exec(code))) { var t = decode(m[2]); if (t) return t.slice(0, 60); }
    return "새 부품";
  }
  // Names the code reads from window.acardPartData: .name, ["name"] and { a, b } = acardPartData.
  function detectFields(code) {
    var names = [], m, re = /acardPartData\s*(?:\|\|\s*\{\s*\}\s*\)\s*)?(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"'\]]+)["']\s*\])/g;
    var destructure = /\{([^{}]*)\}\s*=\s*(?:window\s*\.\s*)?acardPartData\b/g;
    function add(n) { if (n && names.indexOf(n) < 0) names.push(n); }
    while ((m = re.exec(code))) add(m[1] || m[2]);
    while ((m = destructure.exec(code))) m[1].split(",").forEach(function (p) { var n = /^\s*([A-Za-z_$][\w$]*)/.exec(p); if (n) add(n[1]); });
    return names;
  }
  function parseObject(text) {
    try { var v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  function toast(text) {
    var box = document.getElementById("pr-toast");
    if (!box) { box = node("div", "", "pr-toast"); box.id = "pr-toast"; box.setAttribute("role", "status"); document.body.appendChild(box); }
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 4000);
  }
  // A frame inside the dialog reports its height like a page frame does (acvH); the dialog sizes it, 120..560 px.
  addEventListener("message", function (e) {
    var frame = frameHost && frameHost.querySelector("iframe"), h = e.data && +e.data.acvH;
    if (frame && e.source === frame.contentWindow && h > 0) frame.style.height = Math.max(120, Math.min(560, h)) + "px";
  });
  function dataScript(sample) { return "<script>window.acardPartData=" + JSON.stringify(sample).replace(/</g, "\\u003c") + ";</scr" + "ipt>\n"; }
  // The preview is the block's HTML in the same sandbox the page uses for HTML blocks: opaque origin, no network, with
  // window.acardPartData set to the sample before the block's own scripts run.
  function drawPreview(host, block, sample) {
    host.replaceChildren();
    var frame = document.createElement("iframe");
    frame.className = "pr-iframe";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.title = "부품 미리보기";
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">'
      + "<style>html{color-scheme:light dark}body{margin:0;font:var(--fs-14,14px)/1.5 system-ui,sans-serif}</style>" + dataScript(sample)
      + '<script>function h(){parent.postMessage({acvH:Math.ceil(document.documentElement.getBoundingClientRect().height)},"*")}addEventListener("load",h);new ResizeObserver(h).observe(document.documentElement)</scr' + "ipt></head><body>" + String(block.text || "") + "</body></html>";
    host.appendChild(frame);
  }

  function open(block, index) {
    if (!block || sending) return;
    if (dialog && dialog.open) dialog.close();
    if (!dialog) { dialog = node("dialog", "", "pr-dialog"); document.body.appendChild(dialog); }
    dialog.replaceChildren();
    var code = String(block.text || "");
    var detected = detectFields(code);
    var sample = {};
    detected.forEach(function (n) { sample[n] = ""; });
    var idTouched = false, previewTimer = 0;

    var head = node("header", "", "pr-head"), title = node("h2", "", "pr-title");
    title.id = "pr-title";
    title.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v3h1a2 2 0 1 1 0 4h-1v3a2 2 0 0 1-2 2h-3v-1a2 2 0 1 0-4 0v1H5a2 2 0 0 1-2-2v-3h1a2 2 0 1 0 0-4H3V8a2 2 0 0 1 2-2h3V5a2 2 0 0 1 2-2z"/></svg>';
    title.appendChild(document.createTextNode("부품으로 등록"));
    dialog.setAttribute("aria-labelledby", title.id);
    var close = button("", function () { dialog.close(); }, "pr-close");
    close.setAttribute("aria-label", "닫기");
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    head.append(title, close, node("p", "이 블록을 재사용 가능한 부품으로 등록합니다.", "pr-sub"));

    var form = node("form", "", "pr-form");
    form.noValidate = true;
    var fields = node("div", "", "pr-fields");
    var nameLabel = node("label", "이름", "pr-label"), nameWrap = node("div", "", "pr-cell"), nameIn = node("input", "", "pr-in pr-name");
    nameLabel.htmlFor = "pr-name"; nameIn.id = "pr-name"; nameIn.type = "text"; nameIn.required = true; nameIn.maxLength = 60; nameIn.autocomplete = "off";
    nameIn.value = guessName(code);
    var idRow = node("div", "", "pr-id-row"), idLabel = node("label", "주소 이름", "pr-id-label"), idIn = node("input", "", "pr-id");
    idLabel.htmlFor = "pr-id"; idIn.id = "pr-id"; idIn.type = "text"; idIn.maxLength = 40; idIn.spellcheck = false; idIn.autocomplete = "off";
    idIn.value = slugify(nameIn.value) || randomId();
    idRow.append(idLabel, idIn);
    nameWrap.append(nameIn, idRow);
    var descLabel = node("label", "설명", "pr-label"), descWrap = node("div", "", "pr-cell"), descIn = node("textarea", "", "pr-in pr-desc");
    descLabel.htmlFor = "pr-desc"; descIn.id = "pr-desc"; descIn.rows = 2; descIn.maxLength = 200; descIn.placeholder = "어디에 쓰는 부품인지 한 줄로 적어요 (선택)";
    descWrap.appendChild(descIn);
    fields.append(nameLabel, nameWrap, descLabel, descWrap);

    var cols = node("div", "", "pr-cols");
    var found = node("section", "", "pr-col pr-found"), foundHead = node("h3", "찾은 데이터 칸", "pr-h3"), help = node("span", "?", "pr-help");
    help.title = "코드가 window.acardPartData 에서 읽는 이름이에요. 예시 데이터의 칸도 함께 보여요.";
    help.setAttribute("aria-label", help.title);
    help.tabIndex = 0;
    foundHead.appendChild(help);
    found.setAttribute("aria-labelledby", "pr-found-h"); foundHead.id = "pr-found-h";
    var list = node("ul", "", "pr-list");
    var details = node("details", "", "pr-json"), summary = node("summary", "예시 데이터 (JSON)"), jsonIn = node("textarea", "", "pr-json-in"), jsonErr = node("p", "", "pr-json-err");
    jsonIn.rows = 5; jsonIn.spellcheck = false; jsonIn.setAttribute("aria-label", "예시 데이터 (JSON)");
    jsonIn.value = JSON.stringify(sample, null, 2);
    jsonErr.hidden = true;
    details.append(summary, jsonIn, jsonErr);
    found.append(foundHead, list, details);
    var pv = node("section", "", "pr-col pr-preview"), pvHead = node("h3", "미리보기", "pr-h3"), frameBox = node("div", "", "pr-frame");
    pvHead.id = "pr-pv-h"; pv.setAttribute("aria-labelledby", pvHead.id);
    pv.append(pvHead, frameBox);
    cols.append(found, pv);
    frameHost = frameBox;

    var checkRow = node("label", "", "pr-check"), replace = node("input", "", "pr-checkbox");
    replace.type = "checkbox"; replace.checked = true; replace.id = "pr-replace";
    checkRow.htmlFor = replace.id;
    checkRow.append(replace, node("span", "이 페이지의 블록도 부품으로 바꾸기"));
    var hint = node("p", "등록과 동시에 현재 블록을 이 부품으로 교체합니다.", "pr-hint");

    var foot = node("footer", "", "pr-foot"), note = node("p", "", "pr-note"), actions = node("div", "", "pr-actions");
    note.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/></svg>';
    note.appendChild(document.createTextNode("부품 코드는 격리된 칸에서만 실행돼요. 외부에 영향을 주지 않아 안전합니다."));
    var cancel = button("취소", function () { dialog.close(); }, "pr-cancel"), submit = node("button", "등록", "pr-submit");
    submit.type = "submit";
    actions.append(cancel, submit);
    foot.append(note, actions);
    var alert = node("p", "", "pr-alert");
    alert.setAttribute("role", "alert");
    form.append(fields, cols, checkRow, hint, foot, alert);
    dialog.append(head, form);

    function currentSample() { return parseObject(jsonIn.value); }
    function drawList() {
      list.replaceChildren();
      var data = currentSample() || sample, names = detected.slice();
      Object.keys(data).forEach(function (k) { if (names.indexOf(k) < 0) names.push(k); });
      if (!names.length) { list.appendChild(node("li", "데이터 칸을 찾지 못했어요. 예시 데이터를 적으면 칸이 생겨요.", "pr-empty")); return; }
      names.forEach(function (n) {
        var k = kind(data[n]), li = node("li", "", "pr-field");
        li.append(node("span", MARK[k] || "·", "pr-mark pr-mark-" + k), node("span", n, "pr-field-name"), node("span", TYPE[k] || "값", "pr-chip pr-chip-" + k));
        list.appendChild(li);
      });
    }
    function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(function () { drawPreview(frameBox, block, currentSample() || sample); }, 300); }
    function fail(text) { alert.textContent = text; }
    function lock(on) { sending = on; dialog.querySelectorAll("button, input, textarea").forEach(function (el) { el.disabled = on; }); dialog.classList.toggle("pr-sending", on); }
    function doSubmit() {
      if (sending) return;
      var name = nameIn.value.trim();
      if (!name) { fail("이름을 적어 주세요."); nameIn.focus(); return; }
      var id = idIn.value.trim() || slugify(name) || randomId();
      var data = currentSample();
      if (!data) { fail("예시 데이터가 JSON 객체가 아니에요."); details.open = true; jsonIn.focus(); return; }
      fail("");
      lock(true);
      editor.api("/parts", { method: "POST", body: JSON.stringify({ id: id, name: name, description: descIn.value.trim(), page: editor.slug, block: block.id, sample: data }) }).then(function (row) {
        var partId = row && typeof row.id === "string" ? row.id : id;
        if (replace.checked) {
          block.type = "part";
          block.meta = { part: partId, v: row && row.version || 1 };
          block.text = JSON.stringify(data, null, 2);
          editor.render();
          editor.scheduleSave();
        }
        if (editor.lazy) editor.lazy("parts").then(function (p) { if (p && p.reload) return p.reload(editor.api); }).catch(function () {});
        lock(false);
        dialog.close();
        toast("부품으로 등록했어요");
      }, function (error) {
        lock(false);
        fail(error && error.message || "등록하지 못했어요.");
        if (/\bid\b|409/.test(error && error.message || "")) idIn.focus(); else nameIn.focus();
      });
    }

    nameIn.addEventListener("input", function () { if (!idTouched) idIn.value = slugify(nameIn.value) || randomId(); });
    idIn.addEventListener("input", function () { idTouched = idIn.value.trim() !== ""; if (!idTouched) idIn.value = slugify(nameIn.value) || randomId(); });
    idIn.addEventListener("blur", function () { var s = slugify(idIn.value); if (s) idIn.value = s; });
    jsonIn.addEventListener("input", function () {
      var ok = !!currentSample();
      jsonErr.hidden = ok;
      jsonErr.textContent = ok ? "" : "JSON 객체가 아니에요. { \"이름\": \"값\" } 꼴로 적어요.";
      jsonIn.setAttribute("aria-invalid", ok ? "false" : "true");
      if (ok) { drawList(); schedulePreview(); }
    });
    nameIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); doSubmit(); } });
    form.addEventListener("submit", function (ev) { ev.preventDefault(); doSubmit(); });
    dialog.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
    dialog.addEventListener("close", function () { clearTimeout(previewTimer); frameBox.replaceChildren(); if (frameHost === frameBox) frameHost = null; if (sending) lock(false); });

    drawList();
    dialog.showModal();
    drawPreview(frameBox, block, sample);
    nameIn.focus();
    nameIn.select();
  }

  editor.provide("part-register", { open: open, slugify: slugify, detectFields: detectFields, guessName: guessName });
})();
