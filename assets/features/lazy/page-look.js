// Page icon and cover in 고치기: the icon opens the
// emoji picker (icon-picker chunk: search, recent picks) with 이미지 올리기 under it; the cover opens a panel with the
// built-in gradient covers, 이미지 올리기 and 링크로 넣기. Uploads go to POST /api/upload?kind=icon|cover, which checks
// type, 10 MB and the workspace quota on the server; the checks here only save a pointless upload.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
  var LIMIT = 10 * 1024 * 1024;
  var box = null, back = null;

  function close() {
    if (!box) return;
    box.remove(); box = null;
    document.removeEventListener("pointerdown", outside, true);
    if (back && back.focus) back.focus();
  }
  function outside(ev) { if (box && !box.contains(ev.target) && !(ev.target.closest && ev.target.closest(".icon-picker"))) close(); }
  function node(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(cls, text, fn) { var b = node("button", cls, text); b.type = "button"; b.addEventListener("click", fn); return b; }
  function place(anchor) {
    var rect = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8)) + "px";
    box.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - box.offsetHeight - 8)) + "px";
  }
  function shell(anchor, label) {
    close();
    back = anchor;
    box = node("div", "pl-pop"); box.setAttribute("role", "dialog"); box.setAttribute("aria-label", label);
    box.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); } });
    document.body.appendChild(box);
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); }, 0);
    return box;
  }

  function upload(kind, page, status) {
    return new Promise(function (resolve, reject) {
      var input = document.createElement("input");
      input.type = "file"; input.accept = TYPES.join(",");
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) return reject(null);
        if (TYPES.indexOf(file.type) < 0) return reject(new Error("png, jpg, webp, gif, avif 이미지만 올릴 수 있어요."));
        if (file.size > LIMIT) return reject(new Error("이미지가 너무 커요. 10MB 까지 올릴 수 있어요."));
        var form = new FormData();
        form.append("file", file); form.append("page", page);
        status.textContent = "올리는 중…";
        fetch("/api/upload?kind=" + kind, { method: "POST", body: form }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (!res.ok || !body.url) throw new Error(body.error || "올리지 못했어요.");
            resolve(body.url);
          });
        }).catch(reject);
      });
      input.click();
    });
  }
  function failed(status) { return function (error) { status.textContent = error ? error.message : ""; status.classList.toggle("err", !!error); }; }

  function openIcon(anchor, current, page, done) {
    var pop = shell(anchor, "페이지 아이콘");
    var status = node("p", "pl-status"); status.setAttribute("aria-live", "polite");
    var row = node("div", "pl-row");
    row.appendChild(button("pl-btn", "이모지 고르기", function () {
      editor.lazy("icon-picker").then(function (picker) {
        close();
        picker.open(anchor, current, function (icon) { done(icon || null); });
      });
    }));
    row.appendChild(button("pl-btn", "이미지 올리기", function () {
      upload("icon", page, status).then(function (url) { close(); done(url); }, failed(status));
    }));
    if (current) row.appendChild(button("pl-btn pl-quiet", "아이콘 없애기", function () { close(); done(null); }));
    pop.appendChild(node("p", "pl-title", "페이지 아이콘"));
    pop.appendChild(row);
    pop.appendChild(node("p", "pl-hint", "이미지: png, jpg, webp, gif, avif · 10MB 까지"));
    pop.appendChild(status);
    place(anchor);
    pop.querySelector("button").focus();
  }

  function openCover(anchor, current, page, done) {
    var pop = shell(anchor, "페이지 표지");
    var status = node("p", "pl-status"); status.setAttribute("aria-live", "polite");
    pop.appendChild(node("p", "pl-title", "기본 표지"));
    var gallery = node("div", "pl-gallery");
    for (var i = 1; i <= 6; i += 1) (function (key) {
      var b = button("pl-cover grad g" + i.toString() + (current === key ? " on" : ""), "", function () { close(); done(key); });
      b.setAttribute("aria-label", "기본 표지 " + key.slice(1));
      gallery.appendChild(b);
    })("g" + i);
    pop.appendChild(gallery);
    var row = node("div", "pl-row");
    row.appendChild(button("pl-btn", "이미지 올리기", function () {
      upload("cover", page, status).then(function (url) { close(); done(url); }, failed(status));
    }));
    if (current) row.appendChild(button("pl-btn pl-quiet", "표지 없애기", function () { close(); done(null); }));
    pop.appendChild(row);
    var link = node("form", "pl-link");
    var input = node("input"); input.type = "url"; input.placeholder = "https:// 이미지 주소"; input.setAttribute("aria-label", "표지 이미지 주소");
    if (current && /^https:/.test(current)) input.value = current;
    link.appendChild(input);
    link.appendChild(button("pl-btn", "링크로 넣기", function () { link.requestSubmit(); }));
    link.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var value = input.value.trim();
      if (!/^https:\/\/\S+$/.test(value)) { failed(status)(new Error("https:// 로 시작하는 주소를 넣어 주세요.")); return; }
      close(); done(value);
    });
    pop.appendChild(link);
    pop.appendChild(node("p", "pl-hint", "이미지: png, jpg, webp, gif, avif · 10MB 까지"));
    pop.appendChild(status);
    place(anchor);
    pop.querySelector("button").focus();
  }

  var MEDIA = /^\/media\/[0-9a-f]{16}$/;
  function paint(cover, iconButton, settings) {
    var grad = /^g[1-6]$/.test(settings.cover || "");
    var tile = cover.nextElementSibling && cover.nextElementSibling.classList.contains("pl-grad") ? cover.nextElementSibling : null;
    if (grad && !tile) { tile = node("div", "page-cover pl-grad"); tile.setAttribute("aria-hidden", "true"); cover.after(tile); }
    if (tile) { tile.hidden = !grad; tile.style.backgroundImage = grad ? "var(--grad-glow),var(--grad-" + settings.cover.slice(1) + ")" : ""; }
    if (grad) { cover.hidden = true; cover.removeAttribute("src"); }
    else if (MEDIA.test(settings.cover || "")) cover.src = settings.cover + "?w=1600";
    if (MEDIA.test(settings.icon || "")) {
      var img = node("img", "pl-icon"); img.src = settings.icon + "?w=400"; img.alt = "페이지 아이콘";
      iconButton.replaceChildren(img);
    }
  }
  function open(kind, anchor, current, page, done) {
    return kind === "icon" ? openIcon(anchor, current, page, done) : openCover(anchor, current, page, done);
  }

  editor.provide("page-look", { open: open, paint: paint, close: close });
})();
