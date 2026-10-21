// 데이터베이스 모델: 속성 종류, 셀 값, 필터·정렬·그룹, 계산(footer).
// 이 파일은 세 곳에서 같은 코드로 쓰인다.
//   1) 워커(gate/_worker.js) — 빌드가 //__DB_MODEL__ 자리에 그대로 인라인한다.
//   2) 브라우저(dist/db-model.js) — 빌드가 `export ` 접두사만 떼어 정적 파일로 낸다.
//   3) 테스트(bun test) — 그대로 import 한다.
// 그래서 import 도 DOM 도 쓰지 않는다. 순수 함수만 둔다.

export const PROPERTY_TYPES = [
  { type: "title", label: "제목", kind: "text" },
  { type: "text", label: "텍스트", kind: "text" },
  { type: "number", label: "숫자", kind: "number" },
  { type: "select", label: "선택", kind: "options" },
  { type: "multi_select", label: "다중 선택", kind: "options" },
  { type: "status", label: "상태", kind: "options" },
  { type: "date", label: "날짜", kind: "date" },
  { type: "checkbox", label: "체크박스", kind: "checkbox" },
  { type: "url", label: "URL", kind: "text" },
  { type: "email", label: "이메일", kind: "text" },
  { type: "phone", label: "전화번호", kind: "text" },
  { type: "files", label: "파일과 미디어", kind: "files" },
  { type: "formula", label: "수식", kind: "computed" },
  { type: "relation", label: "관계", kind: "relation" },
  { type: "person", label: "사람", kind: "options" },
  { type: "rollup", label: "롤업", kind: "computed" },
  { type: "created_time", label: "생성 시간", kind: "computed" },
  { type: "updated_time", label: "수정 시간", kind: "computed" },
  { type: "unique_id", label: "ID", kind: "computed" },
  { type: "button", label: "버튼", kind: "computed" },
];

export const PROPERTY_TYPE_NAMES = PROPERTY_TYPES.map((entry) => entry.type);

export const OPTION_COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export const VIEW_TYPES = [
  { type: "table", label: "표" },
  { type: "board", label: "보드" },
  { type: "gallery", label: "갤러리" },
  { type: "list", label: "목록" },
  { type: "calendar", label: "캘린더" },
  { type: "timeline", label: "타임라인" },
  { type: "chart", label: "차트" },
];

export const VIEW_TYPE_NAMES = VIEW_TYPES.map((entry) => entry.type);

export const NUMBER_FORMATS = [
  { id: "number", label: "숫자" },
  { id: "number_with_commas", label: "숫자 (쉼표)" },
  { id: "percent", label: "퍼센트" },
  { id: "dollar", label: "달러" },
  { id: "won", label: "원" },
  { id: "euro", label: "유로" },
  { id: "yen", label: "엔" },
  { id: "rupee", label: "루피" },
  { id: "ruble", label: "루블" },
];

export const NUMBER_DISPLAYS = [
  { id: "number", label: "숫자" },
  { id: "bar", label: "막대" },
  { id: "ring", label: "링" },
];

export function isPropertyType(type) {
  return PROPERTY_TYPE_NAMES.indexOf(type) >= 0;
}

export function propertyKind(type) {
  const found = PROPERTY_TYPES.find((entry) => entry.type === type);
  return found ? found.kind : "text";
}

export function propertyLabel(type) {
  const found = PROPERTY_TYPES.find((entry) => entry.type === type);
  return found ? found.label : String(type || "");
}

export function defaultConfig(type) {
  if (type === "select" || type === "multi_select" || type === "status") {
    const options = type === "status"
      ? [
        { id: "o1", name: "시작 전", color: "gray" },
        { id: "o2", name: "진행 중", color: "blue" },
        { id: "o3", name: "완료", color: "green" },
      ]
      : [];
    return { options };
  }
  if (type === "number") return { number_format: "number", display: "number" };
  if (type === "formula") return { expression: "" };
  // synced: 상대 DB에 짝 속성(pair = 그 속성 id)이 있고 연결이 양쪽에 같이 저장된다. limit 1 = 연결 하나만(상위 항목).
  if (type === "relation") return { database: "", synced: false, pair: "", limit: null };
  if (type === "rollup") return { relation_property: "", target_property: "", function: "count" };
  // 번호 자체는 db_counters 표에서 원자적으로 받는다(config 에 두면 전체 저장이 되돌릴 수 있다).
  if (type === "unique_id") return { prefix: "" };
  if (type === "person") return { limit: null };
  if (type === "button") return { label: "", actions: [] };
  return {};
}

export function normaliseConfig(type, config) {
  const base = defaultConfig(type);
  if (!config || typeof config !== "object") return base;
  const out = Object.assign({}, base, config);
  if (type === "select" || type === "multi_select" || type === "status") {
    const raw = Array.isArray(config.options) ? config.options : base.options;
    const seen = new Set();
    out.options = raw
      .filter((option) => option && typeof option === "object")
      .map((option, index) => {
        let id = typeof option.id === "string" && option.id ? option.id.slice(0, 40) : "o" + (index + 1);
        while (seen.has(id)) id = id + "x";
        seen.add(id);
        return {
          id,
          name: String(option.name ?? "").slice(0, 80) || "옵션 " + (index + 1),
          color: OPTION_COLORS.indexOf(option.color) >= 0 ? option.color : OPTION_COLORS[(index % (OPTION_COLORS.length - 1)) + 1],
        };
      })
      .slice(0, 200);
  }
  if (type === "number") {
    out.number_format = NUMBER_FORMATS.some((entry) => entry.id === out.number_format) ? out.number_format : "number";
    out.display = NUMBER_DISPLAYS.some((entry) => entry.id === out.display) ? out.display : "number";
  }
  if (type === "formula") out.expression = typeof out.expression === "string" ? out.expression.slice(0, 2000) : "";
  if (type === "relation") {
    out.database = typeof out.database === "string" ? out.database.slice(0, 200) : "";
    out.synced = out.synced === true;
    out.pair = typeof out.pair === "string" ? out.pair.slice(0, 40) : "";
    out.limit = out.limit === 1 ? 1 : null;
  }
  if (type === "rollup") {
    out.relation_property = typeof out.relation_property === "string" ? out.relation_property.slice(0, 80) : "";
    out.target_property = typeof out.target_property === "string" ? out.target_property.slice(0, 80) : "";
    out.function = ROLLUP_FUNCTIONS.some((entry) => entry.id === out.function) ? out.function : "count";
  }
  if (type === "person") out.limit = out.limit === 1 ? 1 : null;
  if (type === "unique_id") out.prefix = typeof out.prefix === "string" ? out.prefix.replace(/[\u0000-\u001f]/g, "").slice(0, 20) : "";
  // 버튼 속성(notion-parity C4): 값은 없고 라벨과 동작 목록만 있다. 동작 모양은 서버가 저장·실행 때 검사한다.
  if (type === "button") {
    out.label = typeof out.label === "string" ? out.label.slice(0, 80) : "";
    out.icon = typeof out.icon === "string" ? out.icon.slice(0, 8) : "";
    out.color = typeof out.color === "string" ? out.color.slice(0, 20) : "";
    out.actions = Array.isArray(out.actions) ? out.actions.slice(0, 10) : [];
  }
  return out;
}

export const ROLLUP_FUNCTIONS = [
  { id: "count", label: "개수" },
  { id: "count_values", label: "값 개수" },
  { id: "sum", label: "합계" },
  { id: "average", label: "평균" },
  { id: "median", label: "중앙값" },
  { id: "min", label: "최솟값" },
  { id: "max", label: "최댓값" },
  { id: "range", label: "범위" },
  { id: "percent_checked", label: "체크된 비율" },
  { id: "percent_not_empty", label: "채워진 비율" },
  { id: "count_unique", label: "고유값 개수" },
  { id: "empty", label: "비어 있음" },
  { id: "not_empty", label: "비어 있지 않음" },
  { id: "unique", label: "고유값" },
  { id: "show_original", label: "원본 보기" },
  { id: "earliest_date", label: "가장 이른 날짜" },
  { id: "latest_date", label: "가장 늦은 날짜" },
];

export const CALCULATIONS = [
  { id: "none", label: "없음" },
  { id: "count_all", label: "전체 개수" },
  { id: "count_values", label: "값 개수" },
  { id: "count_empty", label: "비어 있음" },
  { id: "count_not_empty", label: "채워짐" },
  { id: "count_unique", label: "고유값" },
  { id: "percent_empty", label: "비어 있음 %" },
  { id: "percent_not_empty", label: "채워짐 %" },
  { id: "percent_checked", label: "체크된 비율" },
  { id: "percent_unchecked", label: "체크 안 된 비율" },
  { id: "percent_per_option", label: "옵션별 비율" },
  { id: "sum", label: "합계" },
  { id: "average", label: "평균" },
  { id: "median", label: "중앙값" },
  { id: "min", label: "최솟값" },
  { id: "max", label: "최댓값" },
  { id: "range", label: "범위" },
  { id: "earliest_date", label: "가장 이른 날짜" },
  { id: "latest_date", label: "가장 늦은 날짜" },
  { id: "show_original", label: "원본 보기" },
];

const CALCULATION_IDS = CALCULATIONS.map((entry) => entry.id);

export function calculationsFor(type) {
  const shared = ["none", "count_all", "count_values", "count_empty", "count_not_empty", "count_unique", "percent_empty", "percent_not_empty"];
  if (type === "checkbox") return shared.concat(["percent_checked", "percent_unchecked"]);
  if (type === "number") return shared.concat(["sum", "average", "median", "min", "max", "range"]);
  if (type === "select" || type === "multi_select" || type === "status") return shared.concat(["percent_per_option"]);
  if (type === "date" || type === "created_time" || type === "updated_time") return shared.concat(["earliest_date", "latest_date"]);
  return shared.concat(["show_original"]);
}

export function isCalculation(id) {
  return CALCULATION_IDS.indexOf(id) >= 0;
}

export function optionById(prop, id) {
  const config = (prop && prop.config) || {};
  const options = Array.isArray(config.options) ? config.options : [];
  return options.find((option) => option.id === id) || null;
}

export function optionByName(prop, name) {
  const config = (prop && prop.config) || {};
  const options = Array.isArray(config.options) ? config.options : [];
  const wanted = String(name ?? "").trim().toLowerCase();
  return options.find((option) => option.name.toLowerCase() === wanted) || null;
}

export function optionColor(prop, value) {
  if (Array.isArray(value)) {
    const first = value.map((id) => optionById(prop, id)).find(Boolean);
    return first ? first.color : "default";
  }
  const found = optionById(prop, value);
  return found ? found.color : "default";
}

export function normaliseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return null;
    const hasTime = /\d{2}:\d{2}/.test(text);
    return { start: hasTime ? text.slice(0, 16) : text.slice(0, 10), end: null };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { start: new Date(value).toISOString().slice(0, 10), end: null };
  }
  if (typeof value === "object") {
    const start = normaliseDate(value.start);
    const end = normaliseDate(value.end);
    if (!start) return null;
    return { start: start.start, end: end ? end.start : null };
  }
  return null;
}

export function normaliseFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? "").slice(0, 200),
      url: String(entry.url ?? "").slice(0, 2000),
      type: String(entry.type ?? "").slice(0, 60),
      ...(Number.isFinite(entry.iw ?? entry.width) && (entry.iw ?? entry.width) > 0 &&
          Number.isFinite(entry.ih ?? entry.height) && (entry.ih ?? entry.height) > 0
        ? { iw: entry.iw ?? entry.width, ih: entry.ih ?? entry.height } : {}),
    }))
    .filter((entry) => entry.url)
    .slice(0, 40);
}

export function normaliseCellValue(prop, value) {
  const type = prop ? prop.type : "text";
  switch (type) {
    case "number": {
      if (value === null || value === undefined || value === "") return null;
      const num = typeof value === "number" ? value : Number(String(value).replace(/[, %]/g, ""));
      return Number.isFinite(num) ? num : null;
    }
    case "checkbox":
      return value === true || value === 1 || value === "true";
    case "select":
    case "status": {
      if (value === null || value === undefined || value === "") return null;
      const id = String(value);
      return optionById(prop, id) ? id : null;
    }
    case "multi_select": {
      const list = Array.isArray(value) ? value : value ? [value] : [];
      const ids = list.map((entry) => String(entry)).filter((id) => optionById(prop, id));
      return [...new Set(ids)];
    }
    case "date":
      return normaliseDate(value);
    case "files":
      return normaliseFiles(value);
    case "relation": {
      const list = Array.isArray(value) ? value : value ? [value] : [];
      return [...new Set(list.map((entry) => String(entry)).filter(Boolean))];
    }
    case "person": {
      // 값은 이메일 목록(소문자). 후보 밖 이메일은 서버가 저장 전에 거른다(gate/_worker.js personGuard).
      const list = Array.isArray(value) ? value : value ? [value] : [];
      const emails = [...new Set(list.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => PERSON_EMAIL.test(entry)))];
      return prop && prop.config && prop.config.limit === 1 ? emails.slice(-1) : emails.slice(0, 50);
    }
    case "unique_id": {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isInteger(num) && num > 0 ? num : null;
    }
    case "button":
      return null;
    default:
      return value === null || value === undefined ? "" : String(value).slice(0, 4000);
  }
}

export const PERSON_EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,24}$/;

// 사람 셀의 이니셜(아바타 원 안 글자): 이메일 앞부분의 첫 글자.
export function personInitial(email) {
  const local = String(email || "").split("@")[0];
  const first = [...local.replace(/[^\p{L}\p{N}]/gu, "")][0] || "?";
  return first.toUpperCase();
}

export function emptyValue(prop) {
  const type = prop ? prop.type : "text";
  if (type === "number" || type === "unique_id" || type === "button") return null;
  if (type === "checkbox") return false;
  if (type === "multi_select" || type === "files" || type === "relation" || type === "person") return [];
  if (type === "select" || type === "status" || type === "date") return null;
  return "";
}

export function isEmptyValue(prop, value) {
  const type = prop ? prop.type : "text";
  if (type === "number" || type === "unique_id") return value === null || value === undefined || value === "";
  if (type === "checkbox") return value !== true;
  if (type === "multi_select" || type === "files" || type === "relation" || type === "person") return !Array.isArray(value) || value.length === 0;
  if (type === "date") return !value || !value.start;
  if (isRichValue(value)) return displayValue(prop, value).trim() === "";
  return value === null || value === undefined || String(value).trim() === "";
}

function groupThousands(text) {
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatNumber(value, config) {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "";
  const format = (config && config.number_format) || "number";
  const rounded = Math.round(num * 1000) / 1000;
  const plain = String(rounded);
  switch (format) {
    case "percent":
      return groupThousands(String(Math.round(num * 10000) / 100)) + "%";
    case "number_with_commas":
      return groupThousands(plain);
    case "dollar":
      return "$" + groupThousands(plain);
    case "won":
      return groupThousands(plain) + "원";
    case "euro":
      return groupThousands(plain) + "€";
    case "yen":
      return groupThousands(plain) + "¥";
    case "rupee":
      return groupThousands(plain) + "₹";
    case "ruble":
      return groupThousands(plain) + "₽";
    default:
      return plain;
  }
}

export function formatDate(value) {
  const date = normaliseDate(value);
  if (!date) return "";
  const hasTime = /\d{2}:\d{2}/.test(date.start);
  const start = date.start.replace(/-/g, ".");
  const text = hasTime ? start.replace("T", " ") : start;
  if (date.end && date.end !== date.start) return text + " → " + date.end.replace(/-/g, ".");
  return text;
}

export function formatRelativeTime(stamp, now) {
  if (!stamp) return "";
  const diff = Math.max(0, (now || Date.now()) - Number(stamp));
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "방금";
  if (diff < hour) return Math.floor(diff / minute) + "분 전";
  if (diff < day) return Math.floor(diff / hour) + "시간 전";
  if (diff < 7 * day) return Math.floor(diff / day) + "일 전";
  return new Date(Number(stamp)).toISOString().slice(0, 10).replace(/-/g, ".");
}

export function displayValue(prop, value, options) {
  const opts = options || {};
  const type = prop ? prop.type : "text";
  if (type === "number") return formatNumber(value, prop.config);
  if (type === "date") return formatDate(value);
  if (type === "checkbox") return value === true ? "체크됨" : "체크 안 됨";
  if (type === "select" || type === "status") {
    const found = optionById(prop, value);
    return found ? found.name : "";
  }
  if (type === "multi_select") {
    return (Array.isArray(value) ? value : []).map((id) => {
      const found = optionById(prop, id);
      return found ? found.name : "";
    }).filter(Boolean).join(", ");
  }
  if (type === "files") return (Array.isArray(value) ? value : []).map((entry) => entry.name).filter(Boolean).join(", ");
  if (type === "created_time" || type === "updated_time") {
    return opts.relative === false ? formatDate(String(value)) : formatRelativeTime(value, opts.now);
  }
  if (type === "relation") return (Array.isArray(value) ? value : []).length + "개 연결";
  if (type === "person") return (Array.isArray(value) ? value : []).join(", ");
  if (type === "unique_id") return value === null || value === undefined || value === "" ? "" : String((prop.config && prop.config.prefix) || "") + value;
  if (isRichValue(value)) return value.__rich.map((seg) => String(seg.text ?? "")).join("");
  return value === null || value === undefined ? "" : String(value);
}

// Shown under the formula box in the editor so the date and style functions can be found.
export const FORMULA_EXAMPLES = [
  'if(prop("진행") > 50, "순조로움", "느림")',
  'formatDate(dateAdd(prop("시작"), 7, "days"), "M월 D일")',
  'if(prop("마감") < today(), "지남".style("red", "b"), "남음")',
];

// A formula style() result: {__rich: [{text, color?, bg?, b?, i?, u?, s?, c?}]} (db-formula.js fStyle).
export function isRichValue(value) {
  return !!(value && typeof value === "object" && Array.isArray(value.__rich));
}

const RICH_FLAGS = ["b", "i", "u", "s", "c"];

// Segments of a formula value with the fx-* class names for each one; plain values give one unstyled segment.
export function richValue(value) {
  if (!isRichValue(value)) {
    const text = value === null || value === undefined ? "" : String(value);
    return text ? [{ text, classes: [] }] : [];
  }
  return value.__rich.map((seg) => {
    const classes = [];
    if (seg.color && seg.color !== "default" && OPTION_COLORS.indexOf(seg.color) >= 0) classes.push("fx-" + seg.color);
    if (seg.bg && seg.bg !== "default" && OPTION_COLORS.indexOf(seg.bg) >= 0) classes.push("fx-" + seg.bg + "_background");
    for (const flag of RICH_FLAGS) if (seg[flag]) classes.push("fx-" + flag);
    return { text: String(seg.text ?? ""), classes };
  });
}

export const FILTER_OPERATORS = [
  { id: "contains", label: "포함" },
  { id: "does_not_contain", label: "포함하지 않음" },
  { id: "is", label: "같음" },
  { id: "is_not", label: "같지 않음" },
  { id: "starts_with", label: "시작함" },
  { id: "ends_with", label: "끝남" },
  { id: "is_empty", label: "비어 있음" },
  { id: "is_not_empty", label: "비어 있지 않음" },
  { id: "equals", label: "=" },
  { id: "not_equals", label: "≠" },
  { id: "greater_than", label: ">" },
  { id: "less_than", label: "<" },
  { id: "greater_or_equal", label: "≥" },
  { id: "less_or_equal", label: "≤" },
  { id: "is_before", label: "이전" },
  { id: "is_after", label: "이후" },
  { id: "is_on_or_before", label: "같거나 이전" },
  { id: "is_on_or_after", label: "같거나 이후" },
  { id: "is_within", label: "기간 안" },
  { id: "is_checked", label: "체크됨" },
  { id: "is_not_checked", label: "체크되지 않음" },
];

const FILTER_OPERATOR_IDS = FILTER_OPERATORS.map((entry) => entry.id);

export function filterOperatorsFor(type) {
  const textish = ["contains", "does_not_contain", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"];
  const numbers = ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal", "is_empty", "is_not_empty"];
  if (type === "number" || type === "unique_id") return numbers;
  if (type === "checkbox") return ["is_checked", "is_not_checked"];
  if (type === "date" || type === "created_time" || type === "updated_time") {
    return ["is", "is_before", "is_after", "is_on_or_before", "is_on_or_after", "is_within", "is_empty", "is_not_empty"];
  }
  if (type === "select" || type === "status") return ["is", "is_not", "is_empty", "is_not_empty"];
  if (type === "multi_select" || type === "relation" || type === "person") return ["contains", "does_not_contain", "is_empty", "is_not_empty"];
  if (type === "files") return ["is_empty", "is_not_empty"];
  return textish;
}

function asText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(" ");
  if (isRichValue(value)) return displayValue(null, value);
  if (typeof value === "object") return value.start ? formatDate(value) : "";
  return String(value);
}

function asNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(/[, %]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function asStamp(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  const date = normaliseDate(value);
  if (!date) return null;
  const parsed = Date.parse(date.start);
  return Number.isNaN(parsed) ? null : parsed;
}

export const RELATIVE_DATES = [
  { id: "today", label: "오늘" },
  { id: "this_week", label: "이번 주" },
  { id: "this_month", label: "이번 달" },
  { id: "this_year", label: "올해" },
  { id: "past_days", label: "지난 N일" },
  { id: "next_days", label: "다음 N일" },
];

const REL_SEOUL_MS = 9 * 3600000;
const REL_DAY_MS = 86400000;

// The Seoul calendar day of a date value, as the UTC ms of that day's 00:00 (date-only and Seoul wall-clock times).
function seoulDayStamp(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.floor((value + REL_SEOUL_MS) / REL_DAY_MS) * REL_DAY_MS : null;
  const date = normaliseDate(value);
  if (!date) return null;
  const day = Date.parse(date.start.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(day) ? null : day;
}

// {relative: today|this_week|this_month|this_year|past_days:N|next_days:N} (or {relative: "past_days", days: N}) as [from, to) in Seoul days; a week starts on Monday.
export function relativeDateRange(target, now) {
  const [relative, count] = (target && typeof target === "object" ? String(target.relative || "") : "").split(":");
  const today = Math.floor(((Number.isFinite(now) ? now : Date.now()) + REL_SEOUL_MS) / REL_DAY_MS) * REL_DAY_MS;
  const t = new Date(today);
  const y = t.getUTCFullYear(), m = t.getUTCMonth();
  const days = Math.max(0, Math.min(3650, Math.trunc(Number(count !== undefined ? count : target && target.days) || 0)));
  if (relative === "today") return [today, today + REL_DAY_MS];
  if (relative === "this_week") { const from = today - ((t.getUTCDay() + 6) % 7) * REL_DAY_MS; return [from, from + 7 * REL_DAY_MS]; }
  if (relative === "this_month") return [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)];
  if (relative === "this_year") return [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
  if (relative === "past_days") return [today - days * REL_DAY_MS, today + REL_DAY_MS];
  if (relative === "next_days") return [today, today + (days + 1) * REL_DAY_MS];
  return null;
}

export function matchesCondition(prop, value, cond, options) {
  const opts = options || {};
  const operator = cond && cond.operator ? cond.operator : "is_not_empty";
  const target = cond ? cond.value : undefined;
  const empty = isEmptyValue(prop, value);
  const type = prop ? prop.type : "text";

  if (operator === "is_empty") return empty;
  if (operator === "is_not_empty") return !empty;
  if (operator === "is_checked") return value === true;
  if (operator === "is_not_checked") return value !== true;

  if (type === "checkbox") return value === true;

  if (type === "select" || type === "status") {
    const wanted = target === null || target === undefined ? "" : String(target);
    if (operator === "is_not") return String(value ?? "") !== wanted;
    return String(value ?? "") === wanted;
  }

  if (type === "multi_select" || type === "relation" || type === "person") {
    const fold = type === "person" ? (entry) => String(entry).trim().toLowerCase() : (entry) => String(entry);
    const list = (Array.isArray(value) ? value : []).map(fold);
    const wanted = Array.isArray(target) ? target.map(fold) : [fold(target ?? "")];
    const hit = wanted.some((entry) => list.indexOf(entry) >= 0);
    if (operator === "does_not_contain") return !hit;
    return hit;
  }

  if (type === "files") {
    const list = Array.isArray(value) ? value : [];
    const hit = list.some((entry) => String(entry.name || entry.url || "").toLowerCase().indexOf(String(target ?? "").toLowerCase()) >= 0);
    if (operator === "does_not_contain") return !hit;
    return hit;
  }

  if (type === "number" || type === "unique_id") {
    const left = asNumber(value);
    const right = asNumber(target);
    if (left === null) return false;
    switch (operator) {
      case "equals": return right === null ? false : left === right;
      case "not_equals": return right === null ? true : left !== right;
      case "greater_than": return right === null ? false : left > right;
      case "less_than": return right === null ? false : left < right;
      case "greater_or_equal": return right === null ? false : left >= right;
      case "less_or_equal": return right === null ? false : left <= right;
      default: return false;
    }
  }

  if (type === "date" || type === "created_time" || type === "updated_time") {
    if (operator === "is_within") {
      const range = relativeDateRange(target, opts.now);
      const day = seoulDayStamp(value);
      return !!range && day !== null && day >= range[0] && day < range[1];
    }
    const left = asStamp(value);
    const right = asStamp(target);
    if (left === null) return false;
    if (right === null) return operator === "is_not";
    switch (operator) {
      case "is": return new Date(left).toISOString().slice(0, 10) === new Date(right).toISOString().slice(0, 10);
      case "is_before": return left < right;
      case "is_after": return left > right;
      case "is_on_or_before": return left <= right;
      case "is_on_or_after": return left >= right;
      default: return false;
    }
  }

  const left = asText(value).toLowerCase();
  const right = asText(target).toLowerCase();
  switch (operator) {
    case "contains": return left.indexOf(right) >= 0;
    case "does_not_contain": return left.indexOf(right) < 0;
    case "is": return left === right;
    case "is_not": return left !== right;
    case "starts_with": return left.startsWith(right);
    case "ends_with": return left.endsWith(right);
    default: return false;
  }
}

export function matchesFilter(props, values, filter, options) {
  if (!filter) return true;
  const opts = options || {};
  const list = Array.isArray(filter) ? filter : null;
  if (list) return list.every((cond) => matchesFilter(props, values, cond, opts));
  if (filter.and) return filter.and.every((cond) => matchesFilter(props, values, cond, opts));
  if (filter.or) return filter.or.some((cond) => matchesFilter(props, values, cond, opts));
  if (!filter.property) return true;
  const prop = props.find((entry) => entry.id === filter.property || entry.name === filter.property);
  if (!prop) return true;
  return matchesCondition(prop, values[prop.id], filter, opts);
}

function sortKey(prop, value) {
  const type = prop ? prop.type : "text";
  if (type === "number" || type === "unique_id") {
    const num = asNumber(value);
    return { kind: 0, value: num === null ? Number.NEGATIVE_INFINITY : num };
  }
  if (type === "date" || type === "created_time" || type === "updated_time") {
    const stamp = asStamp(value);
    return { kind: 0, value: stamp === null ? Number.NEGATIVE_INFINITY : stamp };
  }
  if (type === "checkbox") return { kind: 0, value: value === true ? 1 : 0 };
  if (type === "select" || type === "status") {
    const found = optionById(prop, value);
    const config = (prop && prop.config) || {};
    const options = Array.isArray(config.options) ? config.options : [];
    const index = found ? options.findIndex((option) => option.id === found.id) : -1;
    return { kind: 0, value: index };
  }
  return { kind: 1, value: asText(value).toLowerCase() };
}

export function sortRows(props, rows, sorts, valuesOf) {
  const list = (Array.isArray(sorts) ? sorts : []).filter((sort) => sort && sort.property);
  if (!list.length) return rows.slice();
  const out = rows.slice();
  out.sort((a, b) => {
    for (const sort of list) {
      const prop = props.find((entry) => entry.id === sort.property || entry.name === sort.property);
      if (!prop) continue;
      const left = sortKey(prop, valuesOf(a)[prop.id]);
      const right = sortKey(prop, valuesOf(b)[prop.id]);
      let cmp = 0;
      if (left.kind !== right.kind) cmp = left.kind - right.kind;
      else if (left.value < right.value) cmp = -1;
      else if (left.value > right.value) cmp = 1;
      if (cmp !== 0) return sort.direction === "descending" ? -cmp : cmp;
    }
    return (a.ord || 0) - (b.ord || 0);
  });
  return out;
}

export function groupRows(props, rows, groupBy, valuesOf) {
  const prop = props.find((entry) => entry.id === groupBy || entry.name === groupBy);
  if (!prop) return null;
  const groups = [];
  const index = new Map();
  const add = (key, label, color, optionId) => {
    if (!index.has(key)) {
      const group = { key, label, color, optionId, rows: [] };
      index.set(key, group);
      groups.push(group);
    }
    return index.get(key);
  };
  const config = prop.config || {};
  const options = Array.isArray(config.options) ? config.options : [];
  if (prop.type === "select" || prop.type === "status") {
    options.forEach((option) => add(option.id, option.name, option.color, option.id));
    add("__none", "옵션 없음", "default", null);
  } else if (prop.type === "multi_select") {
    options.forEach((option) => add(option.id, option.name, option.color, option.id));
    add("__none", "옵션 없음", "default", null);
  }
  rows.forEach((row) => {
    const value = valuesOf(row)[prop.id];
    if (prop.type === "select" || prop.type === "status") {
      const key = value ? String(value) : "__none";
      const found = optionById(prop, value);
      const group = add(key, found ? found.name : "옵션 없음", found ? found.color : "default", found ? found.id : null);
      group.rows.push(row);
      return;
    }
    if (prop.type === "multi_select") {
      const list = Array.isArray(value) ? value : [];
      if (!list.length) {
        add("__none", "옵션 없음", "default", null).rows.push(row);
        return;
      }
      list.forEach((id) => {
        const found = optionById(prop, id);
        add(String(id), found ? found.name : "옵션 없음", found ? found.color : "default", found ? found.id : null).rows.push(row);
      });
      return;
    }
    const text = asText(value).trim();
    const key = text ? text.toLowerCase() : "__none";
    add(key, text || "없음", "default", null).rows.push(row);
  });
  return { property: prop, groups };
}

export function computeCalculation(props, rows, propId, kind, valuesOf) {
  const prop = props.find((entry) => entry.id === propId || entry.name === propId);
  const total = rows.length;
  if (kind === "count_all") return total;
  if (!prop) return null;
  const values = rows.map((row) => valuesOf(row)[prop.id]);
  const present = values.filter((value) => !isEmptyValue(prop, value));
  const type = prop.type;

  const numbers = present.map((value) => asNumber(value)).filter((value) => value !== null);
  const sum = numbers.reduce((acc, num) => acc + num, 0);

  switch (kind) {
    case "count_values": return present.length;
    case "count_empty": return total - present.length;
    case "count_not_empty": return present.length;
    case "count_unique": return new Set(present.map((value) => asText(value).toLowerCase())).size;
    case "percent_empty": return total ? Math.round(((total - present.length) / total) * 1000) / 10 : 0;
    case "percent_not_empty": return total ? Math.round((present.length / total) * 1000) / 10 : 0;
    case "percent_checked": return total ? Math.round((values.filter((value) => value === true).length / total) * 1000) / 10 : 0;
    case "percent_unchecked": return total ? Math.round((values.filter((value) => value !== true).length / total) * 1000) / 10 : 0;
    case "percent_per_option": {
      const config = prop.config || {};
      const options = Array.isArray(config.options) ? config.options : [];
      return options.map((option) => {
        const hits = values.filter((value) => Array.isArray(value) ? value.indexOf(option.id) >= 0 : value === option.id).length;
        return { id: option.id, name: option.name, color: option.color, count: hits, percent: total ? Math.round((hits / total) * 1000) / 10 : 0 };
      });
    }
    case "sum": return numbers.length ? Math.round(sum * 1000) / 1000 : null;
    case "average": return numbers.length ? Math.round((sum / numbers.length) * 1000) / 1000 : null;
    case "median": {
      if (!numbers.length) return null;
      const sorted = numbers.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 1000) / 1000;
    }
    case "min": return numbers.length ? Math.min(...numbers) : null;
    case "max": return numbers.length ? Math.max(...numbers) : null;
    case "range": return numbers.length ? Math.max(...numbers) - Math.min(...numbers) : null;
    case "earliest_date": {
      const stamps = present.map((value) => asStamp(value)).filter((value) => value !== null);
      return stamps.length ? new Date(Math.min(...stamps)).toISOString().slice(0, 10) : null;
    }
    case "latest_date": {
      const stamps = present.map((value) => asStamp(value)).filter((value) => value !== null);
      return stamps.length ? new Date(Math.max(...stamps)).toISOString().slice(0, 10) : null;
    }
    case "show_original": {
      if (type === "number") return formatNumber(sum, prop.config);
      if (type === "select" || type === "status") return displayValue(prop, present[0]);
      return present.length ? String(displayValue(prop, present[0])) : "";
    }
    default: return null;
  }
}

export function formatCalculation(kind, value, prop) {
  if (kind === "percent_per_option") {
    if (!Array.isArray(value)) return "";
    return value.map((entry) => entry.name + " " + entry.percent + "%").join(" · ");
  }
  if (value === null || value === undefined || value === "") return "";
  const type = prop ? prop.type : "text";
  if (type === "number" && typeof value === "number" && kind !== "count_values" && kind !== "count_unique") {
    return formatNumber(value, prop.config);
  }
  if (typeof value === "number" && /^percent_/.test(kind)) return value + "%";
  if (typeof value === "number") return groupThousands(String(value));
  return String(value);
}

export function normaliseProperty(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const type = isPropertyType(source.type) ? source.type : "text";
  return {
    id: typeof source.id === "string" && source.id ? source.id.slice(0, 40) : "p" + (index + 1),
    name: String(source.name ?? "").slice(0, 120) || propertyLabel(type) + " " + (index + 1),
    type,
    config: normaliseConfig(type, source.config),
    ord: Number.isFinite(source.ord) ? Math.trunc(source.ord) : index * 10,
    width: Number.isFinite(source.width) ? Math.max(60, Math.min(800, Math.trunc(source.width))) : null,
    hidden: source.hidden === true,
  };
}

export function normaliseRow(raw, properties, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const props = {};
  const incoming = source.props && typeof source.props === "object" ? source.props : {};
  properties.forEach((prop) => {
    const value = Object.prototype.hasOwnProperty.call(incoming, prop.id)
      ? incoming[prop.id]
      : (Object.prototype.hasOwnProperty.call(incoming, prop.name) ? incoming[prop.name] : undefined);
    props[prop.id] = value === undefined ? emptyValue(prop) : normaliseCellValue(prop, value);
  });
  return {
    id: typeof source.id === "string" && source.id ? source.id.slice(0, 40) : "r" + (index + 1),
    ord: Number.isFinite(source.ord) ? Math.trunc(source.ord) : index * 10,
    props,
    page: typeof source.page === "string" ? source.page.slice(0, 200) : null,
    created: Number.isFinite(source.created) ? Number(source.created) : Date.now(),
    updated: Number.isFinite(source.updated) ? Number(source.updated) : Date.now(),
  };
}

export function normaliseView(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const type = VIEW_TYPE_NAMES.indexOf(source.type) >= 0 ? source.type : "table";
  const config = source.config && typeof source.config === "object" ? source.config : {};
  const sorts = Array.isArray(config.sorts)
    ? config.sorts
      .filter((sort) => sort && typeof sort === "object" && sort.property)
      .map((sort) => ({ property: String(sort.property).slice(0, 80), direction: sort.direction === "descending" ? "descending" : "ascending" }))
      .slice(0, 8)
    : [];
  const visible = Array.isArray(config.visible) ? config.visible.map((entry) => String(entry).slice(0, 40)) : null;
  const widths = config.widths && typeof config.widths === "object" ? config.widths : {};
  const calculations = config.calculations && typeof config.calculations === "object" ? config.calculations : {};
  return {
    id: typeof source.id === "string" && source.id ? source.id.slice(0, 40) : "v" + (index + 1),
    name: String(source.name ?? "").slice(0, 80) || VIEW_TYPES.find((entry) => entry.type === type).label,
    type,
    ord: Number.isFinite(source.ord) ? Math.trunc(source.ord) : index * 10,
    config: {
      filter: config.filter || null,
      sorts,
      group_by: config.group_by ? String(config.group_by).slice(0, 80) : null,
      visible,
      widths,
      calculations,
      ...(type === "chart" ? { chart: {
        kind: ["bar", "hbar", "line", "donut", "number"].includes(config.chart?.kind) ? config.chart.kind : "bar",
        category: typeof config.chart?.category === "string" ? config.chart.category.slice(0, 80) : "",
        aggregation: ["sum", "avg"].includes(config.chart?.aggregation) ? config.chart.aggregation : "count",
        value: typeof config.chart?.value === "string" ? config.chart.value.slice(0, 80) : "",
        bucket: config.chart?.bucket === "month" ? "month" : "day",
      } } : {}),
      ...(config.card && typeof config.card === "object" ? { card: normaliseCard(config.card) } : {}),
      ...(typeof config.default_template === "string" && config.default_template ? { default_template: config.default_template.slice(0, 40) } : {}),
      ...(config.subitems === "flat" ? { subitems: "flat" } : {}),
    },
  };
}

// 하위 항목(C12): DB 설정 {subitems: {parent, children}} 은 같은 DB 자기 참조 양방향 관계 한 쌍(상위 항목 limit 1, 하위 항목)을 가리킨다.
export function normaliseDatabaseConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sub = source.subitems && typeof source.subitems === "object" ? source.subitems : null;
  return sub && typeof sub.parent === "string" && sub.parent && typeof sub.children === "string" && sub.children
    ? { subitems: { parent: sub.parent.slice(0, 40), children: sub.children.slice(0, 40) } }
    : {};
}

export const SUBITEM_DEPTH = 3;

// 표 뷰의 중첩 순서: 보이는 행(필터·정렬 끝난 순서) 아래에 자식을 들여 넣는다. 필터에 맞는 자식의 부모는 흐리게(dim) 같이
// 보이고, 접힌(collapsed) 부모의 자손은 빠진다. 들여쓰기는 SUBITEM_DEPTH 에서 멈추고 그 아래는 같은 깊이로 그린다.
// allRows 는 필터 전 전체 행, shown 은 필터·정렬을 통과한 행(순서 그대로), parentOf(row) 는 부모 id 또는 null.
export function nestRows(allRows, shown, parentOf, collapsed) {
  const byId = new Map(allRows.map((row) => [row.id, row]));
  const visible = new Set(shown.map((row) => row.id));
  const keep = new Set(visible);
  const dim = new Set();
  // 흐린 부모는 자기 아래 처음 보이는 행의 자리에 선다.
  const order = new Map(shown.map((row, index) => [row.id, index]));
  shown.forEach((row, index) => {
    let parent = parentOf(row);
    const seen = new Set([row.id]);
    while (parent && byId.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      if (!keep.has(parent)) { keep.add(parent); dim.add(parent); }
      if (!order.has(parent) || order.get(parent) > index) order.set(parent, index);
      parent = parentOf(byId.get(parent));
    }
  });
  const rank = (row) => order.get(row.id);
  const children = new Map();
  const roots = [];
  for (const row of allRows) {
    if (!keep.has(row.id)) continue;
    const parent = parentOf(row);
    if (parent && keep.has(parent) && parent !== row.id) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(row);
    } else roots.push(row);
  }
  const sort = (list) => list.sort((a, b) => rank(a) - rank(b));
  const out = [];
  const walk = (row, depth, path) => {
    const kids = sort(children.get(row.id) || []);
    out.push({ row, depth: Math.min(depth, SUBITEM_DEPTH), dim: dim.has(row.id), hasChildren: kids.length > 0, collapsed: !!(collapsed && collapsed.has(row.id)) });
    if (collapsed && collapsed.has(row.id)) return;
    for (const kid of kids) if (!path.has(kid.id)) walk(kid, depth + 1, new Set([...path, kid.id]));
  };
  for (const row of sort(roots)) walk(row, 0, new Set([row.id]));
  // 데이터에 남은 고리(서로가 부모)는 뿌리에 닿지 않아 위에서 빠진다: 그런 행만 뿌리로 그린다(접힌 자손은 그대로 숨김).
  const reachesRoot = (row) => {
    const seen = new Set();
    let at = row;
    while (at && !seen.has(at.id)) {
      seen.add(at.id);
      const parent = parentOf(at);
      if (!parent || !keep.has(parent) || parent === at.id) return true;
      at = byId.get(parent);
    }
    return false;
  };
  const drawn = new Set(out.map((entry) => entry.row.id));
  for (const row of sort(allRows.filter((entry) => keep.has(entry.id) && !drawn.has(entry.id) && !reachesRoot(entry)))) {
    if (drawn.has(row.id)) continue;
    const before = out.length;
    walk(row, 0, new Set([row.id]));
    out.slice(before).forEach((entry) => drawn.add(entry.row.id));
  }
  return out;
}

export const CARD_PREVIEWS = ["none", "page_cover", "page_content", "property"];
export const CARD_SIZES = { s: { min: 180, cover: 100 }, m: { min: 240, cover: 140 }, l: { min: 320, cover: 200 } };

// 갤러리·보드 카드 설정(C8). 설정이 없는 뷰는 card 키가 없고 예전처럼 첫 파일 속성을 커버로 쓴다.
export function normaliseCard(raw) {
  const card = raw && typeof raw === "object" ? raw : {};
  return {
    preview: CARD_PREVIEWS.indexOf(card.preview) >= 0 ? card.preview : "property",
    property: typeof card.property === "string" ? card.property.slice(0, 80) : "",
    size: Object.prototype.hasOwnProperty.call(CARD_SIZES, card.size) ? card.size : "m",
    fit: card.fit === "contain" ? "contain" : "cover",
    icon: card.icon !== false,
  };
}

function firstFileUrl(value) {
  const first = Array.isArray(value) ? value[0] : value;
  const url = first && typeof first === "object" ? (first.url || first.src || first.path) : first;
  return typeof url === "string" && url ? url : null;
}

// 카드 이미지 주소. row 는 cover·firstImage(서버 readRows)를, values 는 속성 값을 담는다.
export function cardPreview(properties, view, row, values) {
  return firstFileUrl(cardPreviewFile(properties, view, row, values));
}

// Keep the selected file's intrinsic geometry through server and client card rendering.
export function cardPreviewFile(properties, view, row, values) {
  const card = view && view.config && view.config.card ? normaliseCard(view.config.card) : null;
  const files = properties.filter((prop) => prop.type === "files");
  if (card?.preview === "none") return null;
  if (card?.preview === "page_cover") return (row && row.cover) || null;
  if (card?.preview === "page_content") return (row && (row.firstImageMeta || row.firstImage)) || null;
  const chosen = (card && files.find((prop) => prop.id === card.property || prop.name === card.property)) || files[0];
  const value = chosen ? values[chosen.id] : null;
  return Array.isArray(value) ? value[0] || null : value;
}

export function normaliseTemplate(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: typeof source.id === "string" && source.id ? source.id.slice(0, 40) : "t" + (index + 1),
    name: String(source.name ?? "").slice(0, 120) || "템플릿 " + (index + 1),
    icon: typeof source.icon === "string" ? source.icon.slice(0, 8) : "",
    props: source.props && typeof source.props === "object" ? source.props : {},
    blocks: Array.isArray(source.blocks) ? source.blocks : [],
    ord: Number.isFinite(source.ord) ? Math.trunc(source.ord) : index * 10,
    recurrence: normaliseRecurrence(source.recurrence),
  };
}

// 반복 템플릿(C5). 없거나 잘못된 값이면 null(반복 없음). next_run 은 다음 회차의 ms.
export const RECURRENCE_FREQS = ["day", "week", "month"];

function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const clampInt = (value, min, max, fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);

export function normaliseRecurrence(raw) {
  if (!raw || typeof raw !== "object" || RECURRENCE_FREQS.indexOf(raw.freq) < 0) return null;
  const weekdays = Array.isArray(raw.weekdays) ? [...new Set(raw.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  return {
    freq: raw.freq,
    interval: clampInt(raw.interval, 1, 30, 1),
    weekdays: raw.freq === "week" ? (weekdays.length ? weekdays : [1]) : [],
    monthday: raw.freq === "month" ? clampInt(raw.monthday, 1, 31, 1) : null,
    hour: clampInt(raw.hour, 0, 23, 0),
    minute: clampInt(raw.minute, 0, 59, 0),
    tz: validTimeZone(raw.tz) ? raw.tz : "Asia/Seoul",
    next_run: Number.isFinite(raw.next_run) ? Math.trunc(raw.next_run) : null,
    anchor: Number.isFinite(raw.anchor) ? Math.trunc(raw.anchor) : null,
  };
}

// tz 기준 벽시계 날짜·시각을 UTC ms 로 바꾼다(DST 있는 시간대도 두 번 보정).
function zonedTime(tz, y, m, d, hour, minute) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const wall = Date.UTC(y, m, d, hour, minute);
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const p = Object.fromEntries(fmt.formatToParts(guess).map((part) => [part.type, part.value]));
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
    guess += wall - seen;
  }
  return guess;
}

function zonedDate(tz, ms) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" });
  const p = Object.fromEntries(fmt.formatToParts(ms).map((part) => [part.type, part.value]));
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day) };
}

const RECUR_DAY_MS = 86400000;

// after 보다 늦은 첫 회차. interval 은 anchor(처음 저장한 날) 기준 일·주·달 간격이다. 31일이 없는 달은 말일.
export function nextRun(raw, after) {
  const rec = normaliseRecurrence(raw);
  if (!rec) return null;
  const start = zonedDate(rec.tz, after);
  const anchor = zonedDate(rec.tz, rec.anchor ?? after);
  const anchorDay = Math.floor(Date.UTC(anchor.y, anchor.m, anchor.d) / RECUR_DAY_MS);
  for (let i = 0; i < 400; i += 1) {
    const day = new Date(Date.UTC(start.y, start.m, start.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth(), d = day.getUTCDate();
    const index = Math.floor(day.getTime() / RECUR_DAY_MS);
    let hit = false;
    if (rec.freq === "day") hit = (index - anchorDay) % rec.interval === 0;
    else if (rec.freq === "week") hit = rec.weekdays.indexOf(day.getUTCDay()) >= 0 && Math.floor((index - anchorDay + ((new Date(anchorDay * RECUR_DAY_MS).getUTCDay() + 6) % 7)) / 7) % rec.interval === 0;
    else {
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const months = (y - anchor.y) * 12 + (m - anchor.m);
      hit = d === Math.min(rec.monthday, last) && months % rec.interval === 0;
    }
    if (!hit) continue;
    const at = zonedTime(rec.tz, y, m, d, rec.hour, rec.minute);
    if (at > after) return at;
  }
  return null;
}

export function visibleProperties(properties, view) {
  const config = (view && view.config) || {};
  const visible = Array.isArray(config.visible) ? config.visible : null;
  const hidden = properties.filter((prop) => prop.hidden).map((prop) => prop.id);
  const blocked = new Set(hidden);
  return properties.filter((prop) => {
    if (blocked.has(prop.id)) return false;
    if (visible && visible.indexOf(prop.id) < 0) return false;
    return true;
  });
}

export function columnWidth(prop, view) {
  const config = (view && view.config) || {};
  const widths = config.widths || {};
  if (widths[prop.id]) return widths[prop.id];
  if (prop.width) return prop.width;
  const type = prop.type;
  if (type === "title") return 260;
  if (type === "files") return 200;
  if (type === "date" || type === "created_time" || type === "updated_time") return 150;
  if (type === "number") return 120;
  if (type === "checkbox") return 90;
  if (type === "url" || type === "email") return 200;
  return 180;
}

export function sortOptions(prop, value) {
  const config = (prop && prop.config) || {};
  const options = Array.isArray(config.options) ? config.options : [];
  if (!Array.isArray(value)) return value;
  const order = new Map(options.map((option, index) => [option.id, index]));
  return value.slice().sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}
