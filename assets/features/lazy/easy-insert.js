// Insert-while-typing helpers, lazy so the editor first screen stays under its budget:
// Korean slash search with aliases and recent items, markdown shortcuts, and "|a|b|" + Enter -> table.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var SLASH_ALIASES = {
    paragraph: "글 문단 본문 text p", heading1: "제목 h1 헤딩 큰제목", heading2: "제목 h2 소제목", heading3: "제목 h3", heading4: "제목 h4 가장작은제목",
    bulleted: "목록 글머리 리스트 불릿 ul -", numbered: "번호 순서 목록 ol 1.", to_do: "할일 체크 체크박스 todo 투두 할 일",
    toggle: "토글 접기 펼치기", toggle_heading1: "토글 제목 접히는 제목 h1", toggle_heading2: "토글 제목 접히는 제목 h2", toggle_heading3: "토글 제목 접히는 제목 h3", callout: "콜아웃 강조 박스 메모 주의", quote: "인용 따옴표 quote", code: "코드 code 프로그램",
    diagram: "다이어그램 흐름 흐름도 순서 단계 타임라인 마인드맵 조직도 플로우 diagram flow mermaid 그림", chart: "차트 그래프 막대 선 원 파이 통계 chart graph",
    visual: "시각 애니메이션 svg", html: "html 웹 데모", divider: "구분선 줄 선 hr ---", database: "표 데이터베이스 db 보드 칸반",
    image: "이미지 사진 그림 img 사진첨부", video: "영상 동영상 비디오 유튜브", audio: "오디오 소리 음악", file: "파일 첨부 문서",
    embed: "임베드 삽입 지도", bookmark: "북마크 링크 카드", columns: "열 나누기 단 컬럼", table: "표 테이블 간단표 엑셀 시트 table grid",
    equation: "수식 수학 latex", subpage: "하위 페이지", toc: "목차", breadcrumb: "경로", button: "버튼", progress: "진행률 진행 퍼센트", db_ref: "데이터베이스 연결 db"
  };
  var RECENT_KEY = "acard-slash-recent";
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) { return []; } }
  function matches(BLOCK_TYPES, query) {
    var q = String(query || "").trim().toLowerCase().replace(/\s+/g, "");
    var recents = recent();
    var list = BLOCK_TYPES.filter(function (entry) {
      if (!q) return true;
      var hay = (entry.label + " " + entry.hint + " " + (SLASH_ALIASES[entry.type] || entry.aliases || "") + " " + entry.type).toLowerCase();
      return hay.replace(/\s+/g, "").indexOf(q) >= 0 || hay.split(/\s+/).some(function (word) { return word && word.indexOf(q) === 0; });
    });
    return list.map(function (entry, i) {
      var r = recents.indexOf(entry.type);
      var label = entry.label.toLowerCase();
      var score = (r >= 0 ? 100 - r : 0) + (q && label.indexOf(q) === 0 ? 200 : q && label.indexOf(q) > 0 ? 150 : 0) + (q && label === q ? 300 : 0);
      return { entry: entry, score: score, i: i };
    }).sort(function (a, b) { return b.score - a.score || a.i - b.i; }).map(function (x) { return x.entry; });
  }


  function remember(type) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([type].concat(recent().filter(function (t) { return t !== type; })).slice(0, 6))); } catch (e) {}
  }
  var MD_SHORTCUTS = [
    [/^####$/, "heading4"], [/^###$/, "heading3"], [/^##$/, "heading2"], [/^#$/, "heading1"], [/^[-*+]$/, "bulleted"], [/^1[.)]$/, "numbered"],
    [/^\[[ xX]?\]$/, "to_do"], [/^>$/, "quote"], [/^```[\w-]*$/, "code"]
  ];
  // contenteditable turns the typed trailing space into U+00A0.
  function focusText(id) {
    var t = document.querySelector('.blk[data-id="' + CSS.escape(id) + '"] .text[contenteditable]');
    if (t) { t.focus(); var r = document.createRange(); r.selectNodeContents(t); r.collapse(false); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
  var api = {
    toType: function (block, type, meta, checked) { block.type = type; block.text = ""; block.meta = meta || null; block.checked = !!checked; document.getElementById("slash").hidden = true; editor.render(); focusText(block.id); editor.scheduleSave(); },
    divider: function (block, index) { block.type = "divider"; block.text = ""; block.meta = null; var next = { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: "paragraph", text: "", checked: false, indent: 0, meta: null }; editor.state.blocks.splice(index + 1, 0, next); editor.render(); focusText(next.id); editor.scheduleSave(); }
  };
  function shortcut(raw, block, index) {
    if (block.type !== "paragraph") return false;
    if (raw === "---") { api.divider(block, index); return true; }
    var m = /^(\S+)[ \u00a0]$/.exec(raw);
    if (!m) return false;
    for (var i = 0; i < MD_SHORTCUTS.length; i += 1) {
      if (!MD_SHORTCUTS[i][0].test(m[1])) continue;
      var type = MD_SHORTCUTS[i][1];
      api.toType(block, type, type === "code" && m[1].length > 3 ? { lang: m[1].slice(3) } : null, type === "to_do" && /x/i.test(m[1]));
      return true;
    }
    return false;
  }
  function pipeTable(raw, block) {
    if (block.type !== "paragraph") return false;
    if (!/^\s*\|(.+\|)+\s*$/.test(raw)) return false;
    var cells = raw.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
    if (cells.length < 2) return false;
    block.type = "table"; block.text = "";
    block.meta = { columns: cells, rows: [cells.map(function () { return ""; })], header: true };
    return true;
  }
  function decorate(menu, query, items) {
    var title = menu.querySelector("h3"), list = recent();
    if (query) title.textContent = "‘" + query + "’ 찾는 중";
    if (!items.length) { var none = document.createElement("p"); none.className = "slash-empty"; none.textContent = "맞는 블록이 없어요"; menu.appendChild(none); }
    if (!query) items.forEach(function (entry, i) {
      var at = list.indexOf(entry.type), k = menu.querySelectorAll("button .k")[i];
      if (k && at >= 0 && at < 3) k.textContent = "최근 · " + k.textContent;
    });
  }
  (function (e) {
  function go(f) { e.lazy("ai-write").then(f, function () {}); }
  function block(n) { n = n && (n.nodeType === 1 ? n : n.parentElement); n = n && n.closest(".blk[data-id]"); return n && n.dataset.id; }
  document.addEventListener("keydown", function (v) {
    var t = v.target, id = t.closest && t.matches(".text[contenteditable]") && block(t);
    if (!id) return;
    if ((v.ctrlKey || v.metaKey) && v.key.toLowerCase() === "j") { v.preventDefault(); v.stopImmediatePropagation(); var s = getSelection().toString(); go(function (a) { a.open(id, s); }); }
    else if (v.key === " " && !t.textContent && !v.isComposing) { v.preventDefault(); go(function (a) { a.open(id, ""); }); }
    else if (v.key === "Enter") go(function (a) { setTimeout(function () { a.suggest(id); }, 0); });
  }, true);
  document.addEventListener("paste", function (v) { var id = v.target.closest && v.target.closest(".text[contenteditable]") && !v.target.closest(".easy-table") && block(v.target); if (id && /\t/.test(v.clipboardData.getData("text/plain"))) { var p = v.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n+$/, ""); if (p.indexOf("\n") > 0) { var b = e.state.blocks.find(function (x) { return x.id === id; }); if (b) { v.preventDefault(); v.stopImmediatePropagation(); b.text = p.split("\n")[0]; b.meta = Object.assign({}, b.meta, { tsv: p }); delete b.meta.richText; e.render(); e.scheduleSave(); go(function (a) { a.suggest(id); }); } } } }, true);
  var ask = document.createElement("button");
  ask.type = "button"; ask.className = "ai-polish-trigger ai-ask-trigger"; ask.textContent = "✦ AI에게 묻기"; ask.hidden = true;
  document.body.appendChild(ask);
  ask.addEventListener("pointerdown", function (v) { v.preventDefault(); });
  ask.addEventListener("click", function () { var s = getSelection(), id = block(s.anchorNode), t = s.toString(); ask.hidden = true; if (id) go(function (a) { a.open(id, t); }); });
  var polish = document.querySelector(".ai-polish-trigger:not(.ai-ask-trigger)");
  if (polish) new MutationObserver(function () {
    ask.hidden = polish.hidden;
    if (!ask.hidden) { ask.style.left = "calc(" + polish.style.left + " + " + (polish.offsetWidth + 8) + "px)"; ask.style.top = polish.style.top; }
  }).observe(polish, { attributes: true, attributeFilter: ["hidden", "style"] });
  })(editor);
  function imageHandles() {
    document.querySelectorAll("#blocks .mb-image figure.img:not([data-handles])").forEach(function (fig) {
      fig.dataset.handles = "1";
      var id = fig.closest(".blk[data-id]") && fig.closest(".blk[data-id]").dataset.id;
      ["l", "r"].forEach(function (side) {
        var h = document.createElement("span");
        h.className = "img-resize img-resize-" + side;
        h.setAttribute("aria-hidden", "true");
        h.addEventListener("pointerdown", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var box = fig.parentElement.getBoundingClientRect(), start = ev.clientX, w0 = fig.getBoundingClientRect().width;
          h.setPointerCapture(ev.pointerId);
          function move(e) {
            var w = w0 + (side === "r" ? 1 : -1) * (e.clientX - start) * 2;
            var pct = Math.max(10, Math.min(100, Math.round(w / box.width * 20) * 5));
            fig.style.width = pct + "%"; fig.dataset.pct = pct;
          }
          function up() {
            h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up);
            var b = editor.state.blocks.find(function (x) { return x.id === id; });
            if (b && fig.dataset.pct) { b.meta = Object.assign({}, b.meta, { width: Number(fig.dataset.pct) }); editor.render(); editor.scheduleSave(); }
          }
          h.addEventListener("pointermove", move); h.addEventListener("pointerup", up);
        });
        fig.appendChild(h);
      });
    });
  }
  new MutationObserver(imageHandles).observe(document.getElementById("blocks"), { childList: true });
  imageHandles();
  editor.provide("easy-insert", { decorate: decorate, matches: matches, recent: recent, remember: remember, shortcut: shortcut, pipeTable: pipeTable });
})();
