// 데이터베이스를 서버에서 HTML 로 그린다. 읽기 화면(/<슬러그>/)은 자바스크립트 없이도
// 표를 보여 줘야 하므로, 이 렌더러가 워커 안에서 돈다(빌드가 //__DB_HTML__ 자리에 인라인).
// 워커는 db-model.js 도 같은 방식으로 인라인하므로 그 함수들을 그대로 쓴다.

function dbEscape(value) {
  return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The payload must be the same authorized object as GET /api/db/<slug>.
export function dbBootTag(slug, body) {
  const json = JSON.stringify(body).replace(/[<>&\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return '<script type="application/json" class="acard-db-boot" data-slug="' + dbEscape(slug) + '">' + json + '</script>';
}

// 허용: http(s), 같은 출처 상대 경로(/로 시작, //·\ 제외). mailto/tel 은 호출자가 허용할 때만.
function dbSafeUrl(value, allow) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return "";
  if (/^\/(?![\/\\])/.test(text)) return text;
  if (/^https?:\/\/[^\s]+$/i.test(text)) return text;
  if (allow === "mailto" && /^mailto:[^\s<>"]+$/i.test(text)) return text;
  if (allow === "tel" && /^tel:[+\d\s().#*;=,-]+$/i.test(text)) return text;
  return "";
}

function dbRowHref(row) {
  return row && typeof row.page === "string" && row.page ? "/edit/" + encodeURIComponent(row.page) + "/" : "";
}

// 선택된 뷰의 필터·정렬을 적용한 행 목록.
function dbViewRows(properties, rows, view, context) {
  const config = (view && view.config) || {};
  const valuesOf = (row) => row.values || {};
  let out = Array.isArray(rows) ? rows : [];
  if (config.filter) out = out.filter((row) => matchesFilter(properties, valuesOf(row), config.filter, { now: context && context.now }));
  if (Array.isArray(config.sorts) && config.sorts.length) out = sortRows(properties, out, config.sorts, valuesOf);
  return out;
}

function dbTag(prop, value, options) {
  const found = optionById(prop, value);
  if (!found) return "";
  const status = prop.type === "status" || prop.name === "상태";
  const tone = status ? ({ 완료: "green", 마무리: "green", 진행: "blue", "진행 중": "blue", 대기: "purple", "결정 필요": "purple" })[found.name] : null;
  return '<span class="tag ' + dbEscape(tone || found.color) + (status ? " table-status" : "") + (/결정/.test(found.name) ? " decide" : "") + '">' + dbEscape(found.name) + "</span>";
}

function dbNumberCell(prop, value) {
  const config = (prop && prop.config) || {};
  const text = formatNumber(value, config);
  if (text === "") return "";
  const num = typeof value === "number" ? value : Number(value);
  const display = config.display || "number";
  const maximum = Number(config.max) > 0 ? Number(config.max) : config.number_format === "percent" ? 1 : 100;
  const pct = Number.isFinite(num) ? Math.max(0, Math.min(100, num / maximum * 100)) : 0;
  if (display === "bar") {
    return '<span class="numwrap' + (pct === 100 ? ' complete' : '') + '"><span class="numtext">' + dbEscape(text) + '</span><span class="numbartrack"><span class="numbar" style="width:' + pct + '%"></span></span></span>';
  }
  if (display === "ring") {
    return '<span class="numwrap"><span class="numring" style="background:conic-gradient(var(--accent) ' + pct + '%, var(--line) 0)"><span class="numringhole"></span></span><span class="numtext">' + dbEscape(text) + "</span></span>";
  }
  return '<span class="numtext">' + dbEscape(text) + "</span>";
}

function dbImageAttributes(entry, url) {
  const iw = entry.iw ?? entry.width, ih = entry.ih ?? entry.height;
  const dimensions = Number.isFinite(iw) && iw > 0 && Number.isFinite(ih) && ih > 0 ? ' width="' + iw + '" height="' + ih + '"' : "";
  const media = /^\/media\/[^/?#]+$/.test(url) && !/\.(svg|gif)$/i.test(url) && !/^image\/(svg|gif)/i.test(entry.type || entry.mime || "");
  const responsive = media ? ' srcset="' + [400, 800, 1600].map((w) => dbEscape(url) + '?w=' + w + ' ' + w + 'w').join(', ') + '" sizes="(max-width: 760px) 100vw, 760px"' : "";
  return dimensions + responsive + ' decoding="async" loading="lazy"';
}

function dbFileCell(value) {
  const files = Array.isArray(value) ? value : [];
  const out = [];
  files.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const url = dbSafeUrl(entry.url);
    if (!url) return;
    const name = String(entry.name || decodeURIComponent((url.split(/[?#]/)[0].split("/").pop() || "")) || "파일");
    const isImage = /^image\//.test(entry.type || "") || /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(url);
    const svg = /^image\/svg/.test(entry.type || "") || /\.svg(\?|#|$)/i.test(url);
    if (isImage && !svg) {
      out.push('<a class="filethumb" href="' + dbEscape(url) + '" target="_blank" rel="noopener"><img src="' + dbEscape(url) + '" alt="' + dbEscape(name) + '"' + dbImageAttributes(entry, url) + '></a>');
    } else {
      out.push('<a class="filelink" href="' + dbEscape(url) + '" target="_blank" rel="noopener">' + dbEscape(name) + "</a>");
    }
  });
  return out.join(" ");
}

function dbDateCell(prop, value) {
  const text = formatDate(value);
  if (!text) return prop && prop.name === "마감일" ? '<span class="dbnodate">마감일 없음</span>' : "";
  const date = normaliseDate(value);
  const overdue = date && date.start.slice(0, 10) < new Date().toISOString().slice(0, 10) ? ' class="overdue"' : "";
  return "<span" + overdue + ">" + (date && !date.end && !date.time ? tableDateHtml(date.start) : dbEscape(text)) + "</span>";
}

function dbRelationCell(prop, value, context) {
  const ids = Array.isArray(value) ? value : [];
  if (!ids.length) return "";
  const lookup = context && context.rowTitles ? context.rowTitles : {};
  return ids.map((id) => {
    const title = lookup[id];
    if (!title) return "";
    const page = context && context.rowPages ? context.rowPages[id] : "";
    if (!page) return '<span class="relchip">' + dbEscape(title) + "</span>";
    return '<a class="relchip" href="/edit/' + encodeURIComponent(page) + '/">' + dbEscape(title) + "</a>";
  }).join("");
}

function dbCellHtml(prop, value, context) {
  const type = prop.type;
  if (prop.name === "담당자" && type === "select") {
    const person = optionById(prop, value);
    return person ? tablePersonHtml(person.name) : "";
  }
  if ((prop.name === "담당" || prop.name === "담당자") && typeof value === "string" && value && (type === "text" || type === "rich_text")) return tablePersonHtml(value);
  if (type === "number") return dbNumberCell(prop, value);
  if (type === "checkbox") return value === true ? '<span class="check on" aria-label="체크됨">✓</span>' : '<span class="check" aria-label="체크 안 됨"></span>';
  if (type === "select" || type === "status") return dbTag(prop, value);
  if (type === "multi_select") return (Array.isArray(value) ? value : []).map((id) => dbTag(prop, id)).join(" ");
  if (type === "person") return (Array.isArray(value) ? value : []).map((email) => '<span class="dbperson" title="' + dbEscape(email) + '"><span class="dbavatar" aria-hidden="true">' + dbEscape(personInitial(email)) + '</span><span class="dbpersonname">' + dbEscape(email) + "</span></span>").join(" ");
  if (type === "date") return dbDateCell(prop, value);
  if (type === "files") return dbFileCell(value);
  if (type === "url") {
    const href = dbSafeUrl(value);
    return !value ? "" : href ? '<a href="' + dbEscape(href) + '" target="_blank" rel="noopener">' + dbEscape(value) + "</a>" : dbEscape(value);
  }
  if (type === "email") {
    const href = value && /^[^\s<>"@]+@[^\s<>"@]+$/.test(String(value)) ? dbSafeUrl("mailto:" + value, "mailto") : "";
    return !value ? "" : href ? '<a href="' + dbEscape(href) + '">' + dbEscape(value) + "</a>" : dbEscape(value);
  }
  if (type === "phone") {
    const href = value ? dbSafeUrl("tel:" + String(value).trim(), "tel") : "";
    return !value ? "" : href ? '<a href="' + dbEscape(href) + '">' + dbEscape(value) + "</a>" : dbEscape(value);
  }
  if (type === "relation") return dbRelationCell(prop, value, context);
  if (type === "unique_id") return value === null || value === undefined || value === "" ? "" : '<span class="idcell">' + dbEscape(displayValue(prop, value)) + "</span>";
  if (type === "button") return '<button type="button" class="dbbtn" disabled>' + dbEscape(((prop.config && prop.config.icon) ? prop.config.icon + " " : "") + ((prop.config && prop.config.label) || prop.name)) + "</button>";
  if (type === "created_time" || type === "updated_time") return "<span class=\"stampcell\">" + dbEscape(formatRelativeTime(value, context && context.now)) + "</span>";
  if (type === "formula" || type === "rollup") {
    if (value === null || value === undefined || value === "") return "";
    if (isRichValue(value)) return richValue(value).map((seg) => seg.classes.length ? '<span class="' + seg.classes.join(" ") + '">' + dbEscape(seg.text) + "</span>" : dbEscape(seg.text)).join("");
    if (typeof value === "number") return dbNumberCell(prop, value);
    if (Array.isArray(value)) return dbEscape(value.join(", "));
    return dbEscape(String(value));
  }
  return value ? dbEscape(String(value)) : "";
}

function dbTitleCell(prop, value, row) {
  const text = value ? String(value) : "제목 없음";
  const icon = row && row.icon ? '<span class="rowicon">' + dbEscape(row.icon) + "</span>" : '<span class="rowicon docicon" aria-hidden="true">📄</span>';
  const href = dbRowHref(row);
  if (!href) return '<span class="rowtitle">' + icon + "<span>" + dbEscape(text) + "</span></span>";
  return '<a class="rowtitle" href="' + href + '">' + icon + "<span>" + dbEscape(text) + "</span></a>";
}

function dbCellFor(prop, row, context) {
  const value = row.values ? row.values[prop.id] : undefined;
  if (prop.name === "진행률" && prop.type === "number" && value !== null && value !== undefined) return tableProgressHtml(value, context && context.complete);
  if (prop.type === "title") return dbTitleCell(prop, value, row);
  const error = prop.type === "formula" && row.errors ? row.errors[prop.id] : "";
  if (error && (value === null || value === undefined || value === "")) return '<span class="fxerror" title="' + dbEscape(error) + '">' + dbEscape(error) + "</span>";
  return dbCellHtml(prop, value, context);
}

export function databaseTableHtml(properties, allRows, view, context) {
  const rows = dbViewRows(properties, allRows, view, context);
  const columns = visibleProperties(properties, view);
  if (!columns.length) return '<p class="dbempty">속성이 없어요.</p>';
  const config = (view && view.config) || {};
  const calculations = config.calculations || {};
  const widths = config.widths || {};

  const head = columns.map((prop) => {
    const width = widths[prop.id] || columnWidth(prop, view);
    return '<th scope="col" style="min-width:' + width + 'px"><span class="thname">' + tableHeaderIcon(prop.name, prop.type) + dbEscape(prop.name) + "</span></th>";
  }).join("");
  // #34: the leftmost box shows a status 완료 row, so it only exists when a status property has a 완료 option.
  const status = properties.find((prop) => prop.type === "status");
  const doneColumn = !!(status && ((status.config && status.config.options) || []).some((option) => option.name === "완료"));

  const body = rows.map((row) => {
    const complete = status && optionById(status, row.values[status.id])?.name === "완료";
    const cells = columns.map((prop) => '<td class="c-' + dbEscape(prop.type) + '">' + dbCellFor(prop, row, Object.assign({}, context, { complete })) + "</td>").join("");
    return '<tr>' + (doneColumn ? '<td class="table-select"><span class="table-check' + (complete ? ' on' : '') + '" aria-hidden="true"></span></td>' : "") + cells + "</tr>";
  }).join("");

  const foot = columns.map((prop) => {
    const calc = calculations[prop.id];
    const text = calc && calc !== "none" ? formatCalculation(calc, computeCalculation(properties, rows, prop.id, calc, (row) => row.values || {}), prop) : "";
    return "<td>" + dbEscape(text) + "</td>";
  }).join("");
  const hasFooter = columns.some((prop) => calculations[prop.id] && calculations[prop.id] !== "none");

  return [
    '<div class="dbtablewrap" tabindex="0" role="region" aria-label="작업 표">',
    '<table class="dbtable"><thead><tr>' + (doneColumn ? '<th class="table-select" scope="col" aria-label="완료"></th>' : "") + head + "</tr></thead>",
    "<tbody>" + body + "</tbody>",
    hasFooter ? '<tfoot><tr>' + (doneColumn ? '<td class="table-select"></td>' : "") + foot + "</tr></tfoot>" : "",
    "</table>",
    "</div>",
    rows.length ? "" : '<p class="dbempty">아직 행이 없어요.</p>',
  ].join("");
}

function dbCardHtml(properties, row, context, groupProp, view) {
  const columns = visibleProperties(properties, { config: {} }).filter((prop) => prop.type !== "files");
  const titleProp = properties.find((prop) => prop.type === "title") || columns[0];
  const coverProp = properties.find((prop) => prop.type === "files");
  const card = view && view.config && view.config.card ? normaliseCard(view.config.card) : null;
  let cover;
  if (!card) cover = dbFileCell(coverProp && row.values ? row.values[coverProp.id] : null);
  else {
    const src = dbSafeUrl(cardPreview(properties, view, row, row.values || {}));
    const file = cardPreviewFile(properties, view, row, row.values || {}) || {};
    cover = src ? '<img src="' + dbEscape(src) + '" alt=""' + dbImageAttributes(file, src) + ' style="object-fit:' + card.fit + ';height:' + CARD_SIZES[card.size].cover + 'px;width:100%">' : "";
  }
  const icon = card && card.icon && row.pageIcon ? '<span class="dbcardicon">' + (/^\/media\/[0-9a-f]{16}$/.test(row.pageIcon) ? '<img src="' + dbEscape(row.pageIcon) + '?w=400" alt="" width="18" height="18" style="border-radius:3px;object-fit:cover;vertical-align:-3px">' : dbEscape(row.pageIcon)) + "</span>" : "";
  const sub = columns
    .filter((prop) => prop !== titleProp && prop !== coverProp && prop !== groupProp)
    .slice(0, 4)
    .map((prop) => '<div class="dbcardrow"><span class="dbcardkey">' + dbEscape(prop.name) + "</span>" + dbCellHtml(prop, row.values ? row.values[prop.id] : null, context) + "</div>")
    .join("");
  return [
    card ? '<article class="dbcard dbcard-' + card.size + '">' : '<article class="dbcard">',
    cover ? '<div class="dbcardcover">' + cover + "</div>" : "",
    '<div class="dbcardbody">',
    icon,
    titleProp ? dbTitleCell(titleProp, row.values ? row.values[titleProp.id] : "", row) : "",
    sub,
    "</div>",
    "</article>",
  ].join("");
}

export function databaseGalleryHtml(properties, allRows, view, context) {
  const rows = dbViewRows(properties, allRows, view, context);
  const cards = rows.map((row) => dbCardHtml(properties, row, context, null, view)).join("");
  if (!rows.length) return '<p class="dbempty">아직 행이 없어요.</p>';
  const card = view && view.config && view.config.card ? normaliseCard(view.config.card) : null;
  return card ? '<div class="dbgallery" style="grid-template-columns:repeat(auto-fill,minmax(' + CARD_SIZES[card.size].min + 'px,1fr))">' + cards + "</div>" : '<div class="dbgallery">' + cards + "</div>";
}

export function databaseListHtml(properties, allRows, view, context) {
  const rows = dbViewRows(properties, allRows, view, context);
  const columns = visibleProperties(properties, view);
  const titleProp = columns.find((prop) => prop.type === "title") || columns[0];
  const others = columns.filter((prop) => prop !== titleProp);
  if (!rows.length) return '<p class="dbempty">아직 행이 없어요.</p>';
  const items = rows.map((row) => {
    const meta = others.slice(0, 5).map((prop) => {
      const html = dbCellHtml(prop, row.values ? row.values[prop.id] : null, context);
      if (!html) return "";
      return '<span class="dblistcell"><span class="dbcardkey">' + dbEscape(prop.name) + "</span>" + html + "</span>";
    }).join("");
    return '<div class="dblistrow">' + (titleProp ? dbTitleCell(titleProp, row.values ? row.values[titleProp.id] : "", row) : "") + '<span class="dblistmeta">' + meta + "</span></div>";
  }).join("");
  return '<div class="dblist">' + items + "</div>";
}

export function databaseBoardHtml(properties, allRows, view, context) {
  const rows = dbViewRows(properties, allRows, view, context);
  const config = (view && view.config) || {};
  const groupProp = properties.find((prop) => prop.id === config.group_by || prop.name === config.group_by)
    || properties.find((prop) => prop.type === "status")
    || properties.find((prop) => prop.type === "select");
  if (!groupProp) return '<p class="dbempty">보드로 보려면 선택 또는 상태 속성이 필요해요.</p>';
  const grouped = groupRows(properties, rows, groupProp.id, (row) => row.values);
  if (!grouped) return '<p class="dbempty">보드로 보려면 선택 또는 상태 속성이 필요해요.</p>';
  const columns = grouped.groups.map((group) => [
    '<section class="dbboardcol">',
    '<header class="dbboardhead"><span class="dot ' + dbEscape(group.color) + '"></span>' + dbEscape(group.label) + '<span class="dbcount">' + group.rows.length + "</span></header>",
    '<div class="dbboardcards">' + group.rows.map((row) => dbCardHtml(properties, row, context, groupProp, view)).join("") + "</div>",
    "</section>",
  ].join("")).join("");
  return '<div class="dbboard">' + columns + "</div>";
}

export function databaseCalendarHtml(properties, allRows, view, context) {
  const rows = dbViewRows(properties, allRows, view, context);
  const config = (view && view.config) || {};
  const dateProp = properties.find((prop) => prop.id === config.group_by && prop.type === "date")
    || properties.find((prop) => prop.type === "date");
  if (!dateProp) return '<p class="dbempty">캘린더로 보려면 날짜 속성이 필요해요.</p>';
  const now = new Date((context && context.now) || Date.now());
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = new Map();
  rows.forEach((row) => {
    const date = normaliseDate(row.values ? row.values[dateProp.id] : null);
    if (!date) return;
    const key = date.start.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  });

  const titleProp = properties.find((prop) => prop.type === "title") || properties[0];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const grid = weeks.map((week) => "<tr>" + week.map((day) => {
    if (day === null) return '<td class="dbday out"></td>';
    const key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    const items = byDay.get(key) || [];
    const chips = items.map((row) => {
      const href = dbRowHref(row);
      const label = dbEscape(titleProp && row.values ? row.values[titleProp.id] : "");
      return href ? '<a class="dbchip" href="' + href + '">' + label + "</a>" : '<span class="dbchip">' + label + "</span>";
    }).join("");
    return '<td class="dbday' + (items.length ? " has" : "") + '"><span class="dbdaynum">' + day + "</span>" + chips + "</td>";
  }).join("") + "</tr>").join("");

  return [
    '<div class="dbcalendar">',
    '<div class="dbcalhead">' + year + "년 " + (month + 1) + "월</div>",
    '<table class="dbcalgrid"><thead><tr>' + ["일", "월", "화", "수", "목", "금", "토"].map((label) => "<th>" + label + "</th>").join("") + "</tr></thead><tbody>" + grid + "</tbody></table>",
    "</div>",
  ].join("");
}

function dbTlLink(cls, row, attrs, inner) {
  const href = dbRowHref(row);
  return href ? '<a class="' + cls + '" href="' + href + '"' + attrs + ">" + inner + "</a>" : '<span class="' + cls + '"' + attrs + ">" + inner + "</span>";
}

export function databaseTimelineHtml(properties, allRows, view, context) {
  const rows = dbViewRows(properties, allRows, view, context);
  const config = (view && view.config) || {};
  const dateProp = properties.find((prop) => prop.id === config.group_by && prop.type === "date")
    || properties.find((prop) => prop.type === "date");
  if (!dateProp) return '<p class="dbempty">타임라인으로 보려면 날짜 속성이 필요해요.</p>';
  const titleProp = properties.find((prop) => prop.type === "title") || properties[0];
  const dated = [];
  const undated = [];
  rows.forEach((row) => {
    const date = normaliseDate(row.values ? row.values[dateProp.id] : null);
    if (!date) { undated.push(row); return; }
    const start = Date.parse(date.start.slice(0, 10));
    const end = date.end ? Date.parse(date.end.slice(0, 10)) : start;
    dated.push({ row, start, end: Math.max(start, end) });
  });
  if (!dated.length) return '<p class="dbempty">날짜가 있는 행이 없어요.</p>';
  const min = Math.min(...dated.map((entry) => entry.start));
  const max = Math.max(...dated.map((entry) => entry.end));
  const span = Math.max(86400000, max - min);
  const pad = Math.max(86400000 * 3, span * 0.06);
  const lo = min - pad;
  const hi = max + pad;
  const total = hi - lo;
  const pos = (stamp) => Math.round(((stamp - lo) / total) * 10000) / 100;

  const ticks = [];
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i += 1) {
    const stamp = lo + (total * i) / tickCount;
    ticks.push('<span class="dbtick" style="left:' + pos(stamp) + '%">' + new Date(stamp).toISOString().slice(0, 10) + "</span>");
  }
  const bars = dated.map((entry) => {
    const left = pos(entry.start);
    const width = Math.max(1.2, pos(entry.end) - left);
    const label = titleProp && entry.row.values ? entry.row.values[titleProp.id] : "";
    return [
      '<div class="dbtlrow">',
      dbTlLink("dbtlname", entry.row, "", dbEscape(label)),
      '<div class="dbtltrack">' + dbTlLink("dbtlbar", entry.row, ' style="left:' + left + "%;width:" + width + '%"', dbEscape(label)) + "</div>",
      "</div>",
    ].join("");
  }).join("");
  const none = undated.length
    ? '<div class="dbtlnone"><span class="dbcardkey">날짜 없음</span>' + undated.map((row) => dbTlLink("dbtlname", row, "", dbEscape(titleProp && row.values ? row.values[titleProp.id] : ""))).join("") + "</div>"
    : "";

  return '<div class="dbtimeline"><div class="dbtlaxis">' + ticks.join("") + "</div>" + bars + none + "</div>";
}

export function databaseHtml(properties, rows, views, options) {
  const context = Object.assign({ now: Date.now(), rowTitles: {} }, options || {});
  const list = Array.isArray(views) && views.length ? views : [normaliseView({ id: "default", name: "표", type: "table" }, 0)];
  const first = list.find((view) => view.id === context.viewId) || list[0];
  const body = first.type === "board" ? databaseBoardHtml(properties, rows, first, context)
    : first.type === "gallery" ? databaseGalleryHtml(properties, rows, first, context)
      : first.type === "list" ? databaseListHtml(properties, rows, first, context)
        : first.type === "calendar" ? databaseCalendarHtml(properties, rows, first, context)
          : first.type === "timeline" ? databaseTimelineHtml(properties, rows, first, context)
            : databaseTableHtml(properties, rows, first, context);
  const tabs = list.map((view) => '<button type="button" role="tab" aria-selected="' + (view === first) + '" class="dbtab' + (view === first ? " on" : "") + '" data-view="' + dbEscape(view.type) + '">' + ico(({ table: "table", board: "layout-panel-left", calendar: "calendar", gallery: "layout-grid", timeline: "list-checks", list: "list-checks" })[view.type] || "table") + dbEscape(view.name) + "</button>").join("");
  return [
    '<div class="dbbrowser" data-db="' + dbEscape(context.slug || "") + '">',
    '<template class="db-reader-assets">' + tableHeadingHtml() + properties.map((prop) => '<span data-table-property="' + dbEscape(prop.id) + '">' + tableHeaderIcon(prop.name, prop.type) + '</span>').join('') + Object.entries({ table: "table", board: "layout-panel-left", calendar: "calendar", gallery: "layout-grid", plus: "plus", chevron: "chevron-down" }).map(([name, line]) => '<span data-table-icon="' + name + '">' + ico(line) + '</span>').join('') + ['도리', '오너'].map((name) => '<span data-table-person="' + name + '">' + tablePersonHtml(name) + '</span>').join('') + '</template>',
    tableHeadingHtml(),
    '<div class="dbbar"><div class="dbviewbar dbtabs" aria-label="보기">' + tabs + '<span class="dbcount-badge">' + dbViewRows(properties, rows, first, context).length + '행</span><span class="dbtab" aria-hidden="true">' + ico("plus") + '</span></div>' + (context.slug ? tableNewHtml(context.slug) : '') + '</div>',
    body.replace(/(<img\b[^>]*\b)loading="lazy"/, '$1loading="eager" fetchpriority="high"'),
    "</div>",
  ].join("");
}
