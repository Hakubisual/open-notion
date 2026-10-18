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
  { type: "rollup", label: "롤업", kind: "computed" },
  { type: "created_time", label: "생성 시간", kind: "computed" },
  { type: "updated_time", label: "수정 시간", kind: "computed" },
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
  if (type === "relation") return { database: "", synced: false };
  if (type === "rollup") return { relation_property: "", target_property: "", function: "count" };
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
  }
  if (type === "rollup") {
    out.relation_property = typeof out.relation_property === "string" ? out.relation_property.slice(0, 80) : "";
    out.target_property = typeof out.target_property === "string" ? out.target_property.slice(0, 80) : "";
    out.function = ROLLUP_FUNCTIONS.some((entry) => entry.id === out.function) ? out.function : "count";
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
    default:
      return value === null || value === undefined ? "" : String(value).slice(0, 4000);
  }
}

export function emptyValue(prop) {
  const type = prop ? prop.type : "text";
  if (type === "number") return null;
  if (type === "checkbox") return false;
  if (type === "multi_select" || type === "files" || type === "relation") return [];
  if (type === "select" || type === "status" || type === "date") return null;
  return "";
}

export function isEmptyValue(prop, value) {
  const type = prop ? prop.type : "text";
  if (type === "number") return value === null || value === undefined || value === "";
  if (type === "checkbox") return value !== true;
  if (type === "multi_select" || type === "files" || type === "relation") return !Array.isArray(value) || value.length === 0;
  if (type === "date") return !value || !value.start;
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
  return value === null || value === undefined ? "" : String(value);
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
  { id: "is_checked", label: "체크됨" },
  { id: "is_not_checked", label: "체크되지 않음" },
];

const FILTER_OPERATOR_IDS = FILTER_OPERATORS.map((entry) => entry.id);

export function filterOperatorsFor(type) {
  const textish = ["contains", "does_not_contain", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"];
  const numbers = ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal", "is_empty", "is_not_empty"];
  if (type === "number") return numbers;
  if (type === "checkbox") return ["is_checked", "is_not_checked"];
  if (type === "date" || type === "created_time" || type === "updated_time") {
    return ["is", "is_before", "is_after", "is_on_or_before", "is_on_or_after", "is_empty", "is_not_empty"];
  }
  if (type === "select" || type === "status") return ["is", "is_not", "is_empty", "is_not_empty"];
  if (type === "multi_select" || type === "relation") return ["contains", "does_not_contain", "is_empty", "is_not_empty"];
  if (type === "files") return ["is_empty", "is_not_empty"];
  return textish;
}

function asText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(" ");
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

  if (type === "multi_select" || type === "relation") {
    const list = (Array.isArray(value) ? value : []).map((entry) => String(entry));
    const wanted = Array.isArray(target) ? target.map((entry) => String(entry)) : [String(target ?? "")];
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

  if (type === "number") {
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
  if (type === "number") {
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
        kind: ["bar", "line", "donut"].includes(config.chart?.kind) ? config.chart.kind : "bar",
        category: typeof config.chart?.category === "string" ? config.chart.category.slice(0, 80) : "",
        aggregation: ["sum", "avg"].includes(config.chart?.aggregation) ? config.chart.aggregation : "count",
        value: typeof config.chart?.value === "string" ? config.chart.value.slice(0, 80) : "",
        bucket: config.chart?.bucket === "month" ? "month" : "day",
      } } : {}),
    },
  };
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
  };
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
