// 부품 갤러리 (#38 stage 2): a modal that lists the five default parts and this workspace's parts (GET /api/parts) with a
// search box, a card grid and a live preview, and puts the picked part after a block (parts.insertPart). A workspace
// part's "···" menu renames it (PATCH), shares it by link (POST share) or deletes it (DELETE); every server sentence is
// shown as is and the dialog stays open. Loaded with lazy("part-gallery") from the '/' menu's "모든 부품 보기" row.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var dialog, parts = null, rows = [], listError = "", selected = null, insertAt = -1, mode = "view", shareUrl = "";
  var MINE_SUFFIX = /\s*(?:- r|R)egistered from an HTML block.*$/;
  var EMPTY = "아직 등록한 부품이 없어요.";
  var EMPTY_HINT = "HTML 블록 메뉴에서 '부품으로 등록'을 누르면 여기에 모여요.";
  var NEUTRAL = '<svg class="acp-thumb" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="3" class="t-soft"/><path d="M7 11h9M7 15h6M7 19h11" class="t-ln"/></svg>';

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function button(text, cls, fn) { var b = el("button", cls, text); b.type = "button"; b.addEventListener("click", fn); return b; }
  function entryFor(id) {
    var list = parts && parts.slashItems ? parts.slashItems() : [];
    return list.filter(function (e) { return e.part === id; })[0] || null;
  }
  // One gallery row: the server row plus the '/' menu's label, blurb, thumbnail and preview for the same part.
  function describe(p) {
    var e = entryFor(p.id), own = !p.builtin;
    return { id: p.id, builtin: !!p.builtin, owner: own && typeof p.owner === "string", version: p.version || 1, sample: p.sample || {}, shared: !!p.shared,
      name: own ? p.name || p.id : (e && e.label) || p.name || p.id,
      description: own ? String(p.description || "").replace(MINE_SUFFIX, "").trim() || (e && e.desc) || "" : (e && e.desc) || p.description || "",
      ico: e ? e.ico : NEUTRAL, preview: e ? e.preview : null };
  }
  function message(error) { return (error && error.message) || "잠시 뒤 다시 해 주세요."; }

  function load() {
    var chunk = editor.lazy("parts").then(function (p) { parts = p; return (p.reload || p.load)(editor.api); }).then(function () {}, function () {});
    return Promise.all([editor.api("/parts"), chunk]).then(function (got) {
      listError = "";
      rows = ((got[0] && got[0].parts) || []).map(describe);
    }, function (error) {
      // Guests get 401 "멤버만 볼 수 있어요.": the defaults still show from the parts chunk, without the owner menu.
      listError = message(error);
      rows = (parts && parts.slashItems ? parts.slashItems() : []).filter(function (e) { return !e.mine; }).map(function (e) {
        return { id: e.part, builtin: true, owner: false, version: e.v || 1, sample: {}, name: e.label, description: e.desc || "", ico: e.ico, preview: e.preview };
      });
    });
  }

  function visibleCards() { return Array.prototype.filter.call(dialog.querySelectorAll(".pg-card"), function (c) { return !c.hidden && !c.closest("[hidden]"); }); }
  function select(id) {
    selected = rows.filter(function (r) { return r.id === id; })[0] || null;
    mode = "view"; shareUrl = "";
    dialog.querySelectorAll(".pg-card").forEach(function (c) {
      var on = !!selected && c.dataset.id === selected.id;
      c.classList.toggle("sel", on);
      c.querySelector(".pg-pick").setAttribute("aria-pressed", on ? "true" : "false");
      c.querySelector(".pg-pick").tabIndex = on ? 0 : -1;
    });
    if (!selected) { var first = visibleCards()[0]; if (first) first.querySelector(".pg-pick").tabIndex = 0; }
    drawPreview();
  }
  function closeMenu() { var m = dialog.querySelector(".pg-menu"); if (!m) return false; var owner = m.parentNode.querySelector(".pg-more"); m.remove(); if (owner) { owner.setAttribute("aria-expanded", "false"); owner.focus(); } return true; }
  function openMenu(card, part) {
    if (closeMenu() && card.querySelector(".pg-menu")) return;
    var menu = el("div", "pg-menu"), more = card.querySelector(".pg-more");
    menu.setAttribute("role", "menu");
    function item(text, cls, fn) { var b = button(text, "pg-menu-item" + (cls ? " " + cls : ""), function () { menu.remove(); more.setAttribute("aria-expanded", "false"); fn(); }); b.setAttribute("role", "menuitem"); return b; }
    menu.append(
      item("이름·설명 바꾸기", "", function () { select(part.id); mode = "edit"; drawPreview(); var f = dialog.querySelector(".pg-edit input"); if (f) f.focus(); }),
      item("링크 공유", "", function () { select(part.id); share(part, true); }),
      item("삭제", "pg-danger", function () { remove(part); })
    );
    more.setAttribute("aria-expanded", "true");
    card.appendChild(menu);
    menu.firstChild.focus();
  }

  function card(part) {
    var c = el("div", "pg-card"), pick = el("button", "pg-pick"), ico = el("span", "pg-ico"), txt = el("span", "pg-txt"), head = el("span", "pg-head");
    c.dataset.id = part.id;
    pick.type = "button";
    pick.tabIndex = -1;
    pick.setAttribute("aria-pressed", "false");
    ico.innerHTML = part.ico || NEUTRAL;
    head.appendChild(el("strong", "pg-name", part.name));
    if (!part.builtin) head.appendChild(el("span", "pg-chip", "v" + part.version));
    txt.append(head, el("span", "pg-desc", part.description));
    pick.append(ico, txt);
    pick.addEventListener("click", function () { select(part.id); });
    c.appendChild(pick);
    if (part.owner && !listError) {
      var more = button("···", "pg-more", function () { openMenu(c, part); });
      more.setAttribute("aria-label", part.name + " 더 보기");
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      c.appendChild(more);
    }
    return c;
  }
  function group(key, title, list) {
    var sec = el("section", "pg-group pg-" + key), grid = el("div", "pg-grid");
    sec.appendChild(el("h3", "", title));
    sec.setAttribute("aria-label", title);
    list.forEach(function (p) { grid.appendChild(card(p)); });
    sec.appendChild(grid);
    if (key === "mine" && !list.length) {
      var empty = el("div", "pg-empty");
      empty.append(el("p", "pg-empty-main", EMPTY), el("p", "pg-empty-hint", EMPTY_HINT));
      sec.appendChild(empty);
    }
    return sec;
  }
  function drawCatalog() {
    var catalog = dialog.querySelector(".pg-catalog"), none = catalog.querySelector(".pg-none");
    catalog.replaceChildren();
    var builtin = rows.filter(function (r) { return r.builtin; }), mine = rows.filter(function (r) { return !r.builtin; });
    if (builtin.length) catalog.appendChild(group("builtin", "기본 부품", builtin));
    if (!listError) catalog.appendChild(group("mine", "내 부품", mine));
    catalog.appendChild(none);
    filter();
    if (!selected || !rows.some(function (r) { return r.id === selected.id; })) select(rows.length ? rows[0].id : "");
    else select(selected.id);
  }
  // Search: name and description, case-insensitive. A group with nothing left hides; the empty 내 부품 note stays only without a query.
  function filter() {
    var q = dialog.querySelector(".pg-search").value.trim().toLowerCase();
    dialog.querySelectorAll(".pg-group").forEach(function (sec) {
      var shown = 0;
      sec.querySelectorAll(".pg-card").forEach(function (c) {
        var r = rows.filter(function (x) { return x.id === c.dataset.id; })[0];
        var hit = !q || !r || (r.name + " " + r.description + " " + r.id).toLowerCase().indexOf(q) >= 0;
        c.hidden = !hit;
        if (hit) shown += 1;
      });
      var empty = sec.querySelector(".pg-empty");
      sec.hidden = !shown && !(empty && !q);
    });
    var none = dialog.querySelector(".pg-none");
    none.hidden = !q || visibleCards().length > 0;
    if (q && selected && !visibleCards().some(function (c) { return c.dataset.id === selected.id; })) { var first = visibleCards()[0]; select(first ? first.dataset.id : ""); }
  }

  function alertLine(text) { var a = dialog.querySelector(".pg-alert"); a.textContent = text || ""; a.hidden = !text; }
  function drawPreview() {
    var aside = dialog.querySelector(".pg-preview");
    aside.replaceChildren();
    alertLine("");
    if (!selected) { aside.appendChild(el("p", "pg-preview-empty", "왼쪽에서 부품을 골라 보세요.")); return; }
    var art = el("div", "pg-art");
    if (selected.preview) art.innerHTML = '<div class="sx-pv-ui sx-pv-part">' + selected.preview() + "</div>";
    else { art.classList.add("pg-art-plain"); art.innerHTML = selected.ico || NEUTRAL; }
    aside.appendChild(art);
    if (mode === "edit") {
      var form = el("form", "pg-edit"), name = el("input", "pg-in"), desc = el("input", "pg-in"), ln = el("label", "pg-field"), ld = el("label", "pg-field");
      name.value = selected.name; name.maxLength = 60; name.required = true;
      desc.value = selected.description; desc.maxLength = 200;
      ln.append(el("span", "pg-label", "이름"), name);
      ld.append(el("span", "pg-label", "설명"), desc);
      var save = el("button", "pg-primary", "저장"), cancel = button("취소", "pg-secondary", function () { mode = "view"; drawPreview(); });
      save.type = "submit";
      var tools = el("div", "pg-tools"); tools.append(save, cancel);
      form.append(ln, ld, tools);
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var part = selected;
        save.disabled = true;
        editor.api("/parts/" + encodeURIComponent(part.id), { method: "PATCH", body: JSON.stringify({ name: name.value.trim(), description: desc.value.trim() }) }).then(function (row) {
          part.name = row.name || name.value.trim();
          part.description = String(row.description || "").replace(MINE_SUFFIX, "").trim();
          var c = dialog.querySelector('.pg-card[data-id="' + CSS.escape(part.id) + '"]');
          if (c) { c.querySelector(".pg-name").textContent = part.name; c.querySelector(".pg-desc").textContent = part.description; }
          if (parts && parts.reload) parts.reload(editor.api);
          mode = "view";
          drawPreview();
        }, function (error) { save.disabled = false; alertLine(message(error)); });
      });
      aside.appendChild(form);
    } else {
      aside.append(el("h3", "pg-title", selected.name), el("p", "pg-blurb", selected.description));
    }
    if (mode === "share") {
      var box = el("div", "pg-share"), url = el("input", "pg-in pg-url"), row = el("div", "pg-tools");
      url.readOnly = true; url.value = shareUrl; url.setAttribute("aria-label", "공유 링크");
      row.append(button("복사", "pg-secondary", function () {
        url.select();
        var done = function () { alertLine(""); var s = dialog.querySelector(".pg-status"); s.textContent = "링크를 복사했어요."; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareUrl).then(done, function () { document.execCommand("copy"); done(); });
        else { document.execCommand("copy"); done(); }
      }), button("링크 끄기", "pg-secondary", function () { share(selected, false); }));
      box.append(el("p", "pg-label", "링크를 아는 사람은 이 부품을 가져갈 수 있어요."), url, row);
      aside.appendChild(box);
    }
    var use = button("이 부품 넣기", "pg-use", insert);
    aside.appendChild(use);
  }

  function share(part, on) {
    editor.api("/parts/" + encodeURIComponent(part.id) + "/share", { method: "POST", body: JSON.stringify({ link: on }) }).then(function (row) {
      part.shared = !!row.shared;
      if (on && row.url) { mode = "share"; shareUrl = location.origin + row.url; }
      else { mode = "view"; shareUrl = ""; }
      drawPreview();
      var s = dialog.querySelector(".pg-status"); s.textContent = on ? "" : "링크를 껐어요.";
      var u = dialog.querySelector(".pg-url"); if (u) u.focus();
    }, function (error) { alertLine(message(error)); });
  }
  function remove(part) {
    if (!window.confirm("'" + part.name + "' 부품을 지울까요? 이 부품을 쓰는 블록은 데이터만 남아요.")) return;
    editor.api("/parts/" + encodeURIComponent(part.id), { method: "DELETE" }).then(function () {
      rows = rows.filter(function (r) { return r.id !== part.id; });
      if (parts && parts.reload) parts.reload(editor.api);
      if (selected && selected.id === part.id) selected = null;
      drawCatalog();
      dialog.querySelector(".pg-status").textContent = "'" + part.name + "' 부품을 지웠어요.";
    }, function (error) { alertLine(message(error)); });
  }
  // Puts the chosen part after the block the menu was opened on. parts.insertPart owns the block shape; without it the
  // gallery adds the block itself (sample data, meta {part, v}) so an older parts chunk still inserts.
  function insert() {
    if (!selected) return;
    var part = selected, index = insertAt;
    if (parts && typeof parts.insertPart === "function") {
      var done = parts.insertPart(editor, index, part.id);
      if (done === false) { alertLine("이 부품을 넣지 못했어요."); return; }
    } else {
      var blocks = editor.state.blocks, at = index < 0 || index >= blocks.length ? blocks.length : index + 1;
      blocks.splice(at, 0, { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: "part", text: JSON.stringify(part.sample, null, 2), indent: 0, checked: false, meta: { part: part.id, v: part.version } });
      editor.render();
      editor.scheduleSave();
    }
    dialog.close();
  }

  function moveFocus(from, key) {
    var picks = visibleCards().map(function (c) { return c.querySelector(".pg-pick"); }), i = picks.indexOf(from);
    if (i < 0 || !picks.length) return null;
    if (key === "ArrowRight") return picks[Math.min(i + 1, picks.length - 1)];
    if (key === "ArrowLeft") return picks[Math.max(i - 1, 0)];
    // Up/Down: the card in the previous/next row whose horizontal centre is closest.
    var me = from.getBoundingClientRect(), best = null, bestDist = Infinity, dir = key === "ArrowDown" ? 1 : -1;
    picks.forEach(function (p) {
      var r = p.getBoundingClientRect();
      if (dir * (r.top - me.top) <= 1) return;
      var dist = Math.abs(r.top - me.top) * 10000 + Math.abs(r.left + r.width / 2 - (me.left + me.width / 2));
      if (dist < bestDist) { bestDist = dist; best = p; }
    });
    return best || picks[Math.max(0, Math.min(picks.length - 1, i + dir))];
  }
  function keys(ev) {
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); if (!closeMenu()) dialog.close(); return; }
    var t = ev.target;
    if (/^Arrow(Left|Right|Up|Down)$/.test(ev.key) && t.classList && t.classList.contains("pg-pick")) {
      var next = moveFocus(t, ev.key);
      if (next) { ev.preventDefault(); next.focus(); }
    } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && t.closest && t.closest(".pg-menu")) {
      var items = Array.prototype.slice.call(t.closest(".pg-menu").querySelectorAll("[role=menuitem]")), i = items.indexOf(t);
      ev.preventDefault();
      items[(i + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    }
  }

  function build() {
    dialog = el("dialog", "pg");
    var header = el("header", "pg-header"), h = el("h2", "", "부품 갤러리");
    h.id = "pg-heading";
    dialog.setAttribute("aria-labelledby", h.id);
    var close = button("", "pg-close", function () { dialog.close(); });
    close.setAttribute("aria-label", "닫기");
    close.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
    header.append(h, close);
    var searchWrap = el("div", "pg-search-wrap"), search = el("input", "pg-search");
    search.type = "search"; search.placeholder = "부품 찾기"; search.setAttribute("aria-label", "부품 찾기"); search.autocomplete = "off";
    search.addEventListener("input", filter);
    searchWrap.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13.5 13.5L17 17"/></svg>';
    searchWrap.appendChild(search);
    var status = el("p", "pg-status"), alertEl = el("p", "pg-alert"), none = el("p", "pg-none", "맞는 부품이 없어요");
    status.setAttribute("role", "status");
    alertEl.setAttribute("role", "alert"); alertEl.hidden = true;
    none.hidden = true;
    var layout = el("div", "pg-layout"), catalog = el("div", "pg-catalog"), aside = el("aside", "pg-preview");
    aside.setAttribute("aria-label", "부품 미리보기");
    catalog.appendChild(none);
    layout.append(catalog, aside);
    dialog.append(header, searchWrap, status, alertEl, layout);
    dialog.addEventListener("keydown", keys);
    dialog.addEventListener("click", function (ev) { if (dialog.querySelector(".pg-menu") && !ev.target.closest(".pg-menu,.pg-more")) closeMenu(); });
    dialog.addEventListener("close", function () { closeMenu(); });
    document.body.appendChild(dialog);
  }

  function open(index) {
    if (!dialog) build();
    insertAt = typeof index === "number" ? index : -1;
    mode = "view"; shareUrl = ""; selected = null;
    dialog.querySelector(".pg-search").value = "";
    dialog.querySelector(".pg-status").textContent = "불러오는 중...";
    alertLine("");
    dialog.querySelector(".pg-catalog").querySelectorAll(".pg-group").forEach(function (g) { g.remove(); });
    dialog.querySelector(".pg-preview").replaceChildren();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".pg-search").focus();
    return load().then(function () {
      dialog.querySelector(".pg-status").textContent = listError;
      drawCatalog();
    });
  }

  editor.provide("part-gallery", { open: open });
})();
