import { equationHtml } from "./equation-html.js";
import { visualBlockHtml } from "./visual-html.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function blockInline(block) {
  if (block.meta && Array.isArray(block.meta.richText) && globalThis.EditorModel) return globalThis.EditorModel.richHtml(block.meta.richText, block.text);
  return inline(block.text);
}

export function inline(text) {
  return escapeHtml(text)
    .replace(/\[\[([^\]\s]+)\]\]/g, (_m, slug) => '<a href="/' + escapeHtml(slug) + '/">' + escapeHtml(slug) + "</a>")
    .replace(/\[([^\]]+)\]\((\/[^)\s]+)\)/g, (_m, label, href) => '<a href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label, href) => '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(label) + "</a>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function legacyDatabaseHtml(meta, ctx) {
  const columns = Array.isArray(meta && meta.columns) ? meta.columns : [];
  const rows = Array.isArray(meta && meta.rows) ? meta.rows : [];
  return renderBlocks([{ type: "table", meta: { columns, rows: rows.map((row) => columns.map((name) => row && row[name])) } }], ctx);
}

function headingSlug(text) {
  const s = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().replace(/\s+/g, "-");
  return s.slice(0, 60) || "section";
}

const EMBED_HOSTS = [
  "youtube.com", "youtube-nocookie.com", "youtu.be", "vimeo.com", "player.vimeo.com",
  "codepen.io", "codesandbox.io", "gist.github.com", "docs.google.com", "figma.com",
  "soundcloud.com", "spotify.com", "open.spotify.com", "maps.google.com",
];

function embedAllowed(url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return EMBED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export function tableHeaderIcon(name, type) {
  return ico(({ 상태: "circle-dot", 담당: "users", 담당자: "users", 우선순위: "star", 진행률: "list-checks", 마감일: "calendar", "다음 할 일": "list-checks" })[name] || ({ status: "circle-dot", date: "calendar", number: "list-checks", checkbox: "square", select: "tag", multi_select: "tag" })[type] || "type");
}

export function tablePersonHtml(name) {
  return '<span class="table-person">' + avatarHtml(name) + '<span>' + escapeHtml(name) + '</span></span>';
}

export function tableHeadingHtml() {
  return '<h3 class="table-heading">' + ico("table") + '<span>주요 작업 목록</span></h3>';
}

export function tableDateHtml(value) {
  if (!String(value || "").trim() || /^[-—–]$/.test(String(value).trim())) return '<span class="dbnodate">마감일 없음</span>';
  return escapeHtml(String(value || "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_m, y, m, d) => y + "년 " + Number(m) + "월 " + Number(d) + "일"));
}

export function tableProgressHtml(value, complete) {
  const amount = Math.max(0, Math.min(100, Number(String(value).replace(/%$/, "")) || 0));
  return '<span class="numwrap' + (complete ? ' complete' : '') + '"><span class="numtext">' + amount + '%</span><span class="numbartrack"><span class="numbar" style="width:' + amount + '%"></span></span></span>';
}

export function tableNewHtml(slug) {
  return '<a class="table-new" href="/edit/' + encodeURIComponent(slug) + '/">' + ico("plus") + '<span>새 작업</span><span class="table-new-tail">' + ico("chevron-down") + '</span></a>';
}

// 제목이 이보다 많은 목차는 하위 제목을 접어서 보여 준다.
const TOC_FOLD_AT = 12;

export function renderBlocks(blocks, ctx, headingContext) {
  const out = [];
  let listType = null;
  let listItems = [];

  // 제목 id 는 문서 순서로 한 번만 정한다. 목차 블록이 제목보다 앞에 있어도 같은 id 를 쓴다.
  const seen = new Map();
  const headingIds = headingContext ? headingContext.headingIds : new Map();
  const headings = headingContext ? headingContext.headings : [];
  for (const block of headingContext ? [] : blocks) {
    if (block.type === "heading1" || block.type === "heading2" || block.type === "heading3") {
      const base = headingSlug(block.text);
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      const id = n > 0 ? base + "-" + (n + 1) : base;
      headingIds.set(block.id, id);
      headings.push({ id, text: block.text, level: Number(block.type.slice(-1)) + 1 });
    }
  }

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === "numbered" ? "ol" : "ul";
    out.push("<" + tag + ">" + listItems.join("") + "</" + tag + ">");
    listItems = [];
    listType = null;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    let end = index + 1;
    while (end < blocks.length && (blocks[end].indent || 0) > (block.indent || 0)) end += 1;
    const childHtml = end > index + 1 ? renderBlocks(blocks.slice(index + 1, end), ctx, { headingIds, headings }) : "";
    index = end - 1;
    const type = block.type;
    if (type !== "bulleted" && type !== "numbered") flushList();
    const anchor = block.id ? '<span id="block-' + escapeHtml(block.id) + '"></span>' : "";
    const outputStart = out.length;
    switch (type) {
      case "heading1": out.push('<h2 id="' + headingIds.get(block.id) + '">' + blockInline(block) + "</h2>"); break;
      case "heading2": out.push('<h3 id="' + headingIds.get(block.id) + '">' + blockInline(block) + "</h3>"); break;
      case "heading3": out.push('<h4 id="' + headingIds.get(block.id) + '">' + blockInline(block) + "</h4>"); break;
      case "paragraph": out.push("<p>" + blockInline(block) + "</p>"); break;
      case "bulleted":
      case "numbered": {
        if (listType && listType !== type) flushList();
        listType = type;
        listItems.push("<li>" + anchor + blockInline(block) + childHtml + "</li>");
        break;
      }
      case "to_do":
        out.push('<div class="todo' + (block.checked ? " on" : "") + '"><span class="box" aria-hidden="true">' + (block.checked ? "✓" : "") + "</span><span>" + blockInline(block) + "</span></div>");
        break;
      case "toggle":
        out.push('<details class="toggle"' + (block.meta && block.meta.open ? " open" : "") + "><summary>" + blockInline(block) + "</summary>" + childHtml + "</details>");
        break;
      case "callout":
        out.push('<div class="callout ' + escapeHtml(String((block.meta && block.meta.tone) || "note")) + '">' + ico("sparkles", "callout-ico") + '<div class="callout-body">' + blockInline(block).replace(/\n/g, "<br>") + "</div></div>");
        break;
      case "quote": out.push("<blockquote>" + blockInline(block).replace(/\n/g, "<br>") + "</blockquote>"); break;
      case "code": out.push("<pre><code>" + escapeHtml(block.text) + "</code></pre>"); break;
      case "diagram": case "chart": case "visual": case "html": out.push(visualBlockHtml(block, block.id || String(index))); break;
      case "journal": {
        const meta = block.meta || {};
        const attrs = ["session", "agent", "day", "memory"].filter((k) => typeof meta[k] === "string").map((k) => " data-" + k + '="' + escapeHtml(meta[k]) + '"').join("");
        out.push('<div class="journal-embed"' + attrs + (meta.digest ? ' data-digest="1"' : "") + '><p class="journal-loading">작업 기록을 불러오는 중이에요…</p></div>');
        if (!ctx.journalLoaded) {
          ctx.journalLoaded = true;
          out.push('<link rel="stylesheet" href="/lazy/journal.css?v=__JOURNAL_CSS__"><script src="/lazy/journal.js?v=__JOURNAL_JS__" defer></script>');
        }
        break;
      }
      case "divider": out.push("<hr>"); break;
      case "database": out.push(legacyDatabaseHtml(block.meta, ctx)); break;
      case "image": {
        const meta = block.meta || {};
        const src = String(meta.src || "");
        if (!src) break;
        const width = Number.isFinite(meta.width) ? Math.min(100, Math.max(10, meta.width)) : 100;
        const alt = block.text || "이미지";
        out.push('<figure class="img" style="width:' + width + '%">' +
          '<a class="imgview" href="' + escapeHtml(src) + '"><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" loading="lazy"></a>' +
          (block.text ? "<figcaption>" + inline(block.text) + "</figcaption>" : "") +
          "</figure>");
        break;
      }
      case "video": {
        const url = String((block.meta && block.meta.url) || "");
        if (!url) break;
        const yt = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
        const vm = /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/.exec(url);
        if (yt) out.push('<div class="media16"><iframe src="https://www.youtube-nocookie.com/embed/' + yt[1] + '" title="영상" loading="lazy" allowfullscreen></iframe></div>');
        else if (vm) out.push('<div class="media16"><iframe src="https://player.vimeo.com/video/' + vm[1] + '" title="영상" loading="lazy" allowfullscreen></iframe></div>');
        else out.push('<video controls preload="metadata" src="' + escapeHtml(url) + '"></video>');
        break;
      }
      case "audio": {
        const url = String((block.meta && block.meta.url) || "");
        if (!url) break;
        out.push('<audio controls preload="metadata" src="' + escapeHtml(url) + '"></audio>');
        break;
      }
      case "embed": {
        const url = String((block.meta && block.meta.url) || "");
        if (!url) break;
        if (embedAllowed(url)) out.push('<div class="media16 embed"><iframe src="' + escapeHtml(url) + '" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe></div>');
        else out.push('<div class="callout note">여기에 넣을 수 없는 주소예요. <a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + "</a></div>");
        break;
      }
      case "bookmark": {
        const meta = block.meta || {};
        const url = String(meta.url || "");
        if (!url) break;
        let site = "";
        try { site = new URL(url).hostname.replace(/^www\./, ""); } catch {}
        const title = String(meta.title || site || url);
        out.push('<a class="bookmark" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
          '<span class="bico" aria-hidden="true">🔖</span><span class="bbody"><span class="btitle">' + escapeHtml(title) + "</span>" +
          (meta.description ? '<span class="bdesc">' + escapeHtml(String(meta.description)) + "</span>" : "") +
          '<span class="bsite">' + escapeHtml(site) + "</span></span></a>");
        break;
      }
      case "file": {
        const meta = block.meta || {};
        const url = String(meta.url || "");
        if (!url) break;
        const name = block.text || String(meta.name || "파일");
        out.push('<a class="filecard" href="' + escapeHtml(url) + '" download><span class="fico" aria-hidden="true">📄</span><span class="fname">' + escapeHtml(name) + '</span><span class="fdl">받기 ↓</span></a>');
        break;
      }
      case "columns": {
        const cols = Array.isArray(block.meta && block.meta.columns) ? block.meta.columns : [];
        if (!cols.length) break;
        out.push('<div class="cols cols' + cols.length + '">' + cols.map((c) =>
          '<div class="col">' + String(c.text || "").split("\n").map((l) => l.trim() ? "<p>" + inline(l) + "</p>" : "").join("") + "</div>"
        ).join("") + "</div>");
        break;
      }
      case "table": {
        const meta = block.meta || {};
        const columns = Array.isArray(meta.columns) ? meta.columns : [];
        const rows = Array.isArray(meta.rows) ? meta.rows : [];
        if (!columns.length) break;
        const check = '<span class="table-check" aria-hidden="true"></span>';
        const head = '<th class="table-select" scope="col" aria-label="선택">' + check + '</th>' + columns.map((c) => '<th scope="col"><span class="thname">' + tableHeaderIcon(String(c)) + inline(String(c)) + '</span></th>').join("");
        const body = rows.map((r) => '<tr><td class="table-select"><span class="table-check' + (r[columns.indexOf("상태")] === "완료" ? ' on' : '') + '" aria-hidden="true"></span></td>' + columns.map((c, i) => {
          const value = String((r && r[i]) ?? "");
          const tone = ({ 진행: "blue", "진행 중": "blue", 마무리: "green", 완료: "green", 대기: "purple", "결정 필요": "purple" })[value];
          const cell = c === "상태" && tone ? '<span class="tag table-status ' + tone + '">' + inline(value) + '</span>'
            : c === "우선순위" && value ? '<span class="tag ' + (({ 높음: "pink", 보통: "yellow", 낮음: "gray" })[value] || "gray") + '">' + inline(value) + '</span>'
            : c === "진행률" && value !== "" ? tableProgressHtml(value, r[columns.indexOf("상태")] === "완료")
            : c === "마감일" ? tableDateHtml(value)
            : (c === "담당" || c === "담당자") && value ? tablePersonHtml(value) : inline(value);
          return '<td>' + cell + '</td>';
        }).join("") + '</tr>').join("");
        const isDatabase = ctx && ctx.page && ctx.page.kind === "db";
        const tabs = [["table", "테이블", ""], ["layout-panel-left", "보드", "board"], ["calendar", "캘린더", "calendar"], ["layout-grid", "갤러리", "gallery"]];
        const bar = isDatabase ? tableHeadingHtml() + '<div class="table-toolbar"><div class="table-tabs"' + (ctx.tabHref ? ' role="tablist"' : '') + ' aria-label="보기">' + tabs.map(([icon, label, view], i) => ctx.tabHref ? '<button type="button" role="tab" class="table-tab' + (i === 0 ? ' on' : '') + '" aria-selected="' + (i === 0) + '" data-href="' + ctx.tabHref + (view ? '?view=' + view : '') + '" data-view="' + (view || 'table') + '">' + ico(icon) + label + '</button>' : '<span class="table-tab' + (i === 0 ? ' on' : '') + '">' + ico(icon) + label + '</span>').join("") + (ctx.tabHref ? '' : '<span class="table-tab" aria-hidden="true">' + ico("plus") + '</span>') + '</div>' + tableNewHtml(ctx.page.slug) + '</div>' : '';
        out.push('<div class="table-section">' + bar + '<div class="stable" tabindex="0" role="region" aria-label="작업 표"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>');
        break;
      }
      case "equation": if (block.text) out.push('<div class="mathblock">' + equationHtml(block.text) + "</div>"); break;
      case "toc": {
        const item = (h) => '<li class="lvl' + h.level + '"><a href="#' + h.id + '">' + inline(h.text) + "</a></li>";
        let items = "";
        if (headings.length > TOC_FOLD_AT) {
          // 긴 목차는 맨 윗단계 제목마다 하위 제목을 접어 둔다. 제목 링크를 누르면 이동하고, 화살표를 누르면 펼친다.
          const top = Math.min(...headings.map((h) => h.level));
          for (let i = 0; i < headings.length; ) {
            const h = headings[i];
            let j = i + 1;
            while (j < headings.length && headings[j].level > top) j += 1;
            const kids = h.level === top ? headings.slice(i + 1, j) : [];
            items += kids.length
              ? '<li class="lvl' + h.level + ' tocgrp"><details><summary><a href="#' + h.id + '">' + inline(h.text) + '</a> <span class="tcount">' + kids.length + "</span></summary><ul>" + kids.map(item).join("") + "</ul></details></li>"
              : item(h);
            i = kids.length ? j : i + 1;
          }
        } else {
          items = headings.map(item).join("");
        }
        // The whole TOC folds to a one-line summary (목차 · N); it starts open.
        out.push('<nav class="tocblock"><details open><summary><h3>목차</h3>' + (headings.length ? ' <span class="tcount">' + headings.length + "</span>" : "") + "</summary><ul>" + (items || '<li class="tempty">아래에 제목이 없어요</li>') + "</ul></details></nav>");
        break;
      }
      case "breadcrumb": {
        const chain = [];
        if (ctx && ctx.page) {
          const bySlug = new Map((ctx.pages || []).map((p) => [p.slug, p]));
          let cur = ctx.page;
          const guard = new Set();
          while (cur && !guard.has(cur.slug)) {
            guard.add(cur.slug);
            chain.unshift(cur);
            cur = cur.parent ? bySlug.get(cur.parent) : null;
          }
        }
        if (chain.length) {
          out.push('<nav class="crumbs">' + chain.map((p) =>
            '<a href="/' + (p.slug === "index" ? "" : encodeURIComponent(p.slug) + "/") + '">' + escapeHtml(p.title) + "</a>"
          ).join('<span class="sep" aria-hidden="true">›</span>') + "</nav>");
        }
        break;
      }
      case "button": {
        const meta = block.meta || {};
        const url = String(meta.url || "");
        if (!url) break;
        out.push('<p class="btnrow"><a class="btn" href="' + escapeHtml(url) + '">' + (block.text ? inline(block.text) : "이동") + "</a></p>");
        break;
      }
      case "progress": {
        const meta = block.meta || {};
        const value = Math.min(100, Math.max(0, Math.round(Number(meta.value) || 0)));
        const color = String(meta.color || "blue");
        out.push('<div class="progress ' + escapeHtml(color) + '"><div class="phead"><span>' + inline(block.text || "") + '</span><span class="pval">' + value + '%</span></div>' +
          '<div class="pbar" role="progressbar" aria-valuenow="' + value + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + value + '%"></span></div></div>');
        break;
      }
      case "db_ref": out.push(block.meta && block.meta.html ? block.meta.html : '<div class="db"><p class="dbempty">연결된 데이터베이스를 불러오지 못했어요.</p></div>'); break;
      default: if (block.text) out.push("<p>" + inline(block.text) + "</p>");
    }
    if (out.length > outputStart && type !== "bulleted" && type !== "numbered") out.splice(outputStart, 0, anchor);
    if (childHtml && !["toggle", "bulleted", "numbered"].includes(type)) out.push('<div class="block-children">' + childHtml + '</div>');
  }
  flushList();
  return out.join("\n");
}

// 라인 아이콘은 Lucide(ISC, assets/img/LICENSE-lucide.txt)에서 path 만 옮겨 왔다.
const ICONS = {"house":"<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>","files":"<path d=\"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8\"/><path d=\"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z\"/><path d=\"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1\"/>","clock":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 6v6l4 2\"/>","star":"<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>","trash-2":"<path d=\"M10 11v6\"/><path d=\"M14 11v6\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/><path d=\"M3 6h18\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>","search":"<path d=\"m21 21-4.34-4.34\"/><circle cx=\"11\" cy=\"11\" r=\"8\"/>","plus":"<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>","chevron-down":"<path d=\"m6 9 6 6 6-6\"/>","chevron-right":"<path d=\"m9 18 6-6-6-6\"/>","file-text":"<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/><path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/><path d=\"M10 9H8\"/><path d=\"M16 13H8\"/><path d=\"M16 17H8\"/>","table":"<path d=\"M12 3v18\"/><rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M3 15h18\"/>","share-2":"<circle cx=\"18\" cy=\"5\" r=\"3\"/><circle cx=\"6\" cy=\"12\" r=\"3\"/><circle cx=\"18\" cy=\"19\" r=\"3\"/><line x1=\"8.59\" x2=\"15.42\" y1=\"13.51\" y2=\"17.49\"/><line x1=\"15.41\" x2=\"8.59\" y1=\"6.51\" y2=\"10.49\"/>","message-square":"<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\"/>","ellipsis":"<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/><circle cx=\"5\" cy=\"12\" r=\"1\"/>","notebook-pen":"<path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4\"/><path d=\"M2 6h4\"/><path d=\"M2 10h4\"/><path d=\"M2 14h4\"/><path d=\"M2 18h4\"/><path d=\"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z\"/>","sun":"<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2\"/><path d=\"M12 20v2\"/><path d=\"m4.93 4.93 1.41 1.41\"/><path d=\"m17.66 17.66 1.41 1.41\"/><path d=\"M2 12h2\"/><path d=\"M20 12h2\"/><path d=\"m6.34 17.66-1.41 1.41\"/><path d=\"m19.07 4.93-1.41 1.41\"/>","moon":"<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\"/>","log-out":"<path d=\"m16 17 5-5-5-5\"/><path d=\"M21 12H9\"/><path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"/>","globe":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"/><path d=\"M2 12h20\"/>","tag":"<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>","sparkles":"<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"/><path d=\"M20 2v4\"/><path d=\"M22 4h-4\"/><circle cx=\"4\" cy=\"20\" r=\"2\"/>","users":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>","circle-dot":"<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>","flag":"<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\"/>","list-checks":"<path d=\"M13 5h8\"/><path d=\"M13 12h8\"/><path d=\"M13 19h8\"/><path d=\"m3 17 2 2 4-4\"/><path d=\"m3 7 2 2 4-4\"/>","calendar":"<path d=\"M8 2v3\"/><path d=\"M16 2v3\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/>","type":"<path d=\"M12 4v16\"/><path d=\"M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2\"/><path d=\"M9 20h6\"/>","columns-3":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/><path d=\"M15 3v18\"/>","layout-grid":"<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\"/>","square":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/>","command":"<path d=\"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3\"/>","layout-panel-left":"<rect width=\"7\" height=\"18\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\"/>"};

export function ico(name, cls) {
  return '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
}

// 빌드가 정적 파일 해시를 채운다. 동적으로 고르는 이미지 주소도 캐시를 깨도록 같은 표를 쓴다.
export function assetUrl(path) {
  const versions = globalThis.ACARD_ASSET_VERSIONS || {};
  return versions[path] ? path + "?v=" + versions[path] : path;
}

const PAGE_ICONS = { index: "home", board: "project-status", facetion: "facetion", gravity: "gravity", "motion-native": "motion-native", akanesasu: "akanesasu", vtuber: "vtuber-bg", "real-miku": "real-miku", "text-survival": "text-survival", infra: "infra", decisions: "decision-pending", samples: "block-sample" };
const KNOWN_ICONS = new Set(Object.values(PAGE_ICONS));
const GRADIENTS = 6;

function gradientIndex(slug) {
  let h = 0;
  for (const ch of String(slug || "index")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return slug === "index" ? 1 : (h % GRADIENTS) + 1;
}

function imagePath(value, dir, suffix) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^(\/|https?:)/.test(v)) return v;
  if (/^[\w-]+$/.test(v)) return assetUrl("/img/" + dir + "/" + v + suffix);
  return "";
}

export function pageIconHtml(page, settings, size) {
  const s = settings || {};
  const raw = String(s.icon || (page && page.icon) || "").trim();
  // 시안의 큰 페이지 아이콘 타일 자리에는 Acard A 로고를 둔다(오너 지시 2026-10-16).
  if (!raw && size > 40) return '<img class="mark" src="/logo.svg" alt="" width="' + size + '" height="' + size + '">';
  const name = raw || (page && page.ws === "member" ? "" : PAGE_ICONS[page && page.slug]) || "";
  const path = KNOWN_ICONS.has(name) ? assetUrl("/img/icons/" + name + "-" + (size > 40 ? 256 : 128) + ".webp") : imagePath(name, "icons", "-" + (size > 40 ? 256 : 128) + ".webp");
  if (path) return '<img src="' + escapeHtml(path) + '" alt="" width="' + size + '" height="' + size + '">';
  if (raw) return '<span class="emoji">' + escapeHtml(raw) + "</span>";
  return page && page.kind === "db" ? ico("table") : ico("file-text");
}

export function coverHtml(page, settings) {
  const s = settings || {};
  const chosen = String(s.cover || "").trim();
  if (/^(\/media\/|https?:)/.test(chosen)) return '<div class="pagecover img"><img src="' + escapeHtml(chosen) + '" alt="" fetchpriority="high"></div>';
  // 시안의 사진 커버 자리: 파스텔 그라데이션 위에 A 로고를 은은한 무늬와 큰 워터마크로 깐다.
  const fm = /^g([1-6])$/.exec(String((page && page.cover) || "").trim());
  return '<div class="pagecover grad brandcover g' + (fm ? fm[1] : gradientIndex(page && page.slug)) + '" aria-hidden="true"><img src="/logo.svg" alt="" width="150" height="150"></div>';
}

export function pageActionsHtml(slug, menuHtml) {
  const q = encodeURIComponent(slug || "index");
  return '<div class="page-actions">' +
    '<button type="button" class="pa-share" id="share">공유</button>' +
    '<a class="icon" href="/edit/' + q + '/#comments" aria-label="댓글" title="댓글">' + ico("message-square") + "</a>" +
    '<button type="button" class="icon" id="fav" aria-pressed="false" aria-label="즐겨찾기" title="즐겨찾기" data-slug="' + escapeHtml(slug || "index") + '">' + ico("star") + "</button>" +
    '<a class="icon" id="editlink" href="/edit/' + q + '/" aria-label="이 페이지 고치기" title="고치기">' + ico("notebook-pen") + "</a>" +
    (menuHtml || "") + "</div>";
}

function ownerPageMeta(page) {
  if (page && page.ws === "member") return {};
  return (globalThis.ACARD_PAGE_META || {})[page && page.slug] || {};
}

export function pageHeadHtml(page, settings, actionsHtml) {
  const meta = ownerPageMeta(page);
  page = Object.assign({}, meta, page);
  settings = Object.assign({}, { icon: meta.icon, cover: meta.cover }, settings || {});
  return '<div class="page-head">' + coverHtml(page, settings) +
    '<div class="page-head-row"><div class="pageicon" aria-hidden="true">' + pageIconHtml(page, settings, 88) + "</div>" + (actionsHtml || "") + "</div></div>";
}

const AGENT_NAMES = { markdown: "AI", editor: "오너" };
const AVATARS = { "AI": "dori", "도리": "dori", "오너": "owner" };

function avatarHtml(name) {
  const file = AVATARS[name];
  return file ? '<img src="' + assetUrl("/img/avatars/" + file + "-96.webp") + '" alt="" width="24" height="24">' : '<i>' + escapeHtml(String(name).slice(0, 1)) + "</i>";
}

function whenText(updated) {
  const value = typeof updated === "number" ? new Date(updated) : new Date(String(updated || ""));
  if (Number.isNaN(value.getTime())) return String(updated || "");
  const kst = new Date(value.getTime() + 9 * 3600 * 1000);
  const day = kst.getUTCFullYear() + "년 " + (kst.getUTCMonth() + 1) + "월 " + kst.getUTCDate() + "일";
  const hasTime = typeof updated === "number" || /T\d/.test(String(updated));
  return hasTime ? day + " " + String(kst.getUTCHours()).padStart(2, "0") + ":" + String(kst.getUTCMinutes()).padStart(2, "0") : day;
}

export function parseTags(value) {
  if (Array.isArray(value)) return value.map(String).map((t) => t.trim()).filter(Boolean);
  return String(value || "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

const TAG_ICONS = { "공개": "globe", "비공개": "globe", "표": "table" };

export function bylineHtml(page) {
  page = Object.assign({}, ownerPageMeta(page), page);
  const member = page.ws === "member";
  const agent = page.agent || (member ? "나" : AGENT_NAMES[page.source] || "AI");
  const people = member ? [agent] : [agent].concat(agent === "오너" ? [] : ["오너"]);
  const tags = parseTags(page.tags);
  if (page.kind === "db" && !tags.includes("표")) tags.push("표");
  return '<p class="byline"><span class="who"><span class="avatars">' + people.map(avatarHtml).join("") + "</span>" +
    escapeHtml(agent) + "가 씀</span>" +
    '<span class="when">' + ico("clock") + "<span><time>" + escapeHtml(whenText(page.updated)) + "</time>에 수정됨</span></span>" +
    tags.map((t) => '<span class="chip">' + ico(TAG_ICONS[t] || "tag") + escapeHtml(t) + "</span>").join("") + "</p>";
}

const OVERVIEW = [
  { key: "needs", match: /답|결정|기다리/, title: "내 답이 필요한 것", pill: "decide", label: "결정 필요" },
  { key: "doing", match: /진행/, title: "진행 중", pill: "doing", label: "진행 중" },
  { key: "done", match: /끝난|완료|최근/, title: "AI가 최근 한 일", pill: "done", label: "완료" },
];

export function overviewHtml(blocks) {
  const groups = { needs: [], doing: [], done: [] };
  let current = null;
  for (const block of blocks || []) {
    if (/^heading[123]$/.test(block.type)) {
      const hit = OVERVIEW.find((o) => o.match.test(block.text));
      current = hit ? hit.key : null;
    } else if (current && block.type === "bulleted" && !(block.indent > 0)) {
      groups[current].push(block.text);
    }
  }
  if (!groups.needs.length && !groups.doing.length && !groups.done.length) return "";
  const card = (o, more) => {
    const items = groups[o.key];
    const rows = items.slice(0, 5).map((text) => {
      const m = /^(.*?)\s*\(([^()]*(?:\d+일째|\d{4}-\d{2}-\d{2})[^()]*)\)\s*$/.exec(text);
      return "<li><span class=\"t\">" + inline(m ? m[1] : text) + "</span>" + (m ? '<span class="d">' + escapeHtml(m[2]) + "</span>" : "") + "</li>";
    }).join("");
    return '<section class="card ' + o.key + '" aria-label="' + o.title + '"><h2>' + o.title +
      '<span class="count pill ' + o.pill + '">' + items.length + "</span></h2><ul>" + rows + "</ul>" +
      (more ? '<a class="more" href="' + more + '">모두 보기 →</a>' : "") + "</section>";
  };
  return '<div class="overview">' + card(OVERVIEW[0], "/decisions/") + card(OVERVIEW[1], "") + card(OVERVIEW[2], "") + "</div>";
}

export function thumbBarHtml(slug) {
  const editHref = "/edit/" + encodeURIComponent(slug || "index") + "/";
  return '<nav class="thumbbar" aria-label="빠른 이동">' +
    '<a href="/"' + (slug === "index" ? ' class="on" aria-current="page"' : "") + '><span class="ti" aria-hidden="true">⌂</span>홈</a>' +
    '<button type="button" data-open="palette"><span class="ti" aria-hidden="true">⌕</span>검색</button>' +
    '<a href="' + editHref + '"><span class="ti" aria-hidden="true">✎</span>고치기</a>' +
    '<button type="button" data-open="pages"><span class="ti" aria-hidden="true">☰</span>페이지</button></nav>';
}

export function navTree(pages, current) {
  const known = new Set(pages.map((page) => page.slug));
  const parentOf = (page) => (page.parent && known.has(page.parent) ? page.parent : null);
  const open = new Set();
  for (let cur = pages.find((p) => p.slug === current); cur && !open.has(cur.slug); cur = pages.find((p) => p.slug === parentOf(cur))) open.add(cur.slug);
  const render = (parent) => {
    const items = pages.filter((page) => page.slug !== "index" && parentOf(page) === parent);
    if (!items.length) return "";
    return '<ul class="tree">' + items.map((page) => {
      const kids = render(page.slug);
      const href = "/" + encodeURIComponent(page.slug) + "/";
      return '<li class="' + (kids ? "has-kids" + (open.has(page.slug) ? " open" : "") : "") + '"><div class="row">' +
        (kids ? '<button type="button" class="tw" aria-label="펼치기">' + ico("chevron-right") + "</button>" : '<span class="tw"></span>') +
        '<a href="' + href + '"' + (page.slug === current ? ' class="on" aria-current="page"' : "") + '><span class="pi">' + (page.kind === "db" ? ico("table") : ico("file-text")) + '</span><span class="pt">' + escapeHtml(page.title) + "</span>" + (page.kind === "db" ? ' <span class="dbmark">표</span>' : "") + "</a></div>" + kids + "</li>";
    }).join("") + "</ul>";
  };
  return '<div class="navgroup" id="side-tree">' + render(null) + "</div>";
}


const WORDMARK_SVG = "<svg class=\"wordmark\" viewBox=\"-1.00 -15.63 171.36 109.63\" role=\"img\" aria-label=\"Acard\" focusable=\"false\"><use href=\"/wordmark-symbol.svg#w\"/></svg>";
// The logo mark doubles as the "A" of "Acard"; other site names keep the mark + text.
export function brandMarkHtml(siteName, size) {
  const name = siteName || "Acard";
  if (name === "Acard") return WORDMARK_SVG;
  return '<img src="/logo-small.svg" alt="" width="' + size + '" height="' + size + '">' + escapeHtml(name);
}
export function sideNavHtml(pages, current, siteName) {
  const name = escapeHtml(siteName || "OpenNotion");
  // Home = the wordmark. 모든 페이지 / 최근 / 휴지통 / 정리 제안 live in the ⋯ menu (owner: no nav list at the top).
  return '<div class="side-brand"><a class="brand" href="/" aria-label="홈">' + brandMarkHtml(siteName, 26) + "</a>" +
    '<div class="side-tools"><button type="button" class="icon" id="side-more" aria-label="더 보기" title="더 보기" aria-haspopup="menu" aria-expanded="false" aria-controls="side-menu">' + ico("ellipsis") + "</button>" +
    '<ul class="side-menu" id="side-menu" role="menu" hidden>' +
    '<li><button type="button" role="menuitem" data-act="all">모든 페이지</button></li>' +
    '<li><button type="button" role="menuitem" data-act="recent">최근 편집됨</button></li>' +
    '<li><button type="button" role="menuitem" data-act="trash">휴지통</button></li>' +
    '<li><button type="button" role="menuitem" data-act="suggest">✦ 정리 제안</button></li></ul>' +
    '<button class="icon" id="collapse" aria-label="사이드바 접기" aria-expanded="true" title="사이드바 접기">' + ico("layout-panel-left") + "</button></div></div>" +
    '<button type="button" class="side-search" id="palette-open" aria-label="빠른 검색">' + ico("search") + '<span>검색하기</span><kbd class="kbd">Ctrl K</kbd></button>' +
    '<div class="side-ws"><div class="side-ws-head"><span>작업 공간</span><button type="button" class="icon side-add" data-act="new" aria-label="새 페이지" title="새 페이지">' + ico("plus") + "</button></div>" +
    '<div class="side-root open"><div class="row"><button type="button" class="tw" aria-label="접기">' + ico("chevron-down") + '</button><a href="/"><img src="' + "/logo-16.svg" + '" alt="" width="18" height="18">' + name + "</a></div>" +
    navTree(pages, current) + "</div>" +
    '<button type="button" class="side-new" data-act="new">' + ico("plus") + "새 페이지</button></div>";
}

export function sideImageHtml(page) {
  page = Object.assign({}, ownerPageMeta(page), page);
  const v = String((page && page.side_image) || "").trim();
  if (!v) return "";
  // 시안의 사진 카드 자리: 그라데이션 카드 가운데에 A 로고.
  const fm = /^g([1-6])$/.exec(v);
  return '<figure class="page-side grad brandside g' + (fm ? fm[1] : (gradientIndex(page.slug) % GRADIENTS) + 1) + '" aria-hidden="true"><img src="/logo.svg" alt="" width="132" height="132"></figure>';
}

export function introSplit(blocks) {
  const i = (blocks || []).findIndex((b) => /^heading[123]$/.test(b.type) || b.type === "table" || b.type === "database" || b.type === "db_ref");
  return i < 0 ? [blocks || [], []] : [blocks.slice(0, i), blocks.slice(i)];
}

export function sideFootHtml() {
  return '<div class="side-foot">' +
    '<button class="icon" id="theme" aria-label="테마 바꾸기" title="테마 바꾸기">' + ico("sun", "t-light") + ico("moon", "t-dark") + "</button>" +
    '<a class="icon" href="/settings/agents/" aria-label="에이전트 연결" title="에이전트 연결">' + ico("users") + "</a>" +
    '<form method="POST" action="/__logout" class="side-logout"><button class="icon" type="submit" aria-label="로그아웃" title="로그아웃">' + ico("log-out") + "</button></form></div>";
}

export function mobileBarHtml(siteName) {
  return '<header class="mbar"><button class="icon" id="menu" aria-label="메뉴" aria-expanded="false" aria-controls="sidebar">' + ico("layout-panel-left") + "</button>" +
    '<a class="brand" href="/">' + brandMarkHtml(siteName, 24) + "</a></header>";
}

export function sidePanelHtml() {
  return '<div class="overlay" id="sidepanel" hidden role="dialog" aria-modal="true" aria-label="페이지 목록"><div class="sheet"><h2 id="sidepanel-title"></h2><div id="sidepanel-list" class="palette-list"></div>' +
    '<button type="button" class="close" id="sidepanel-close">닫기</button></div></div>';
}
