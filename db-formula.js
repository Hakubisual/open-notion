// Formula / rollup engine. Plain JS, no imports, no DOM, no Node APIs.

function fTokenize(src) {
  const toks = [];
  const s = String(src);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] || ""))) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      if (s[j] === "." && /[0-9]/.test(s[j + 1] || "")) { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      toks.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) {
          const n = s[j + 1];
          out += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
          continue;
        }
        if (s[j] === c) { closed = true; j++; break; }
        out += s[j++];
      }
      if (!closed) throw new Error("문자열이 닫히지 않았습니다");
      toks.push({ t: "str", v: out });
      i = j;
      continue;
    }
    if (/[A-Za-z_\u00c0-\uffff]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_\u00c0-\uffff]/.test(s[j])) j++;
      toks.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].indexOf(two) >= 0) {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%()<>,!.[]^".indexOf(c) >= 0) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error("알 수 없는 문자: " + c);
  }
  return toks;
}

function fParse(src) {
  const toks = fTokenize(src);
  if (!toks.length) throw new Error("수식이 비어 있습니다");
  let p = 0;
  // Names bound by let/lets around the current position; a bare name outside them is a parse error.
  const scope = [];
  // Depth of lambda arguments (map/filter/...) around the current position: current and index exist only inside one.
  let lambdaDepth = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].t === "op" && toks[p].v === v;
  const isWord = (v) => toks[p] && toks[p].t === "id" && toks[p].v.toLowerCase() === v;
  function expect(v) {
    if (!isOp(v)) throw new Error("'" + v + "'가 필요합니다");
    p++;
  }
  function parseOr() {
    let l = parseAnd();
    while (isOp("||") || isWord("or")) { p++; l = { k: "bin", op: "or", l, r: parseAnd() }; }
    return l;
  }
  function parseAnd() {
    let l = parseEq();
    while (isOp("&&") || isWord("and")) { p++; l = { k: "bin", op: "and", l, r: parseEq() }; }
    return l;
  }
  function parseEq() {
    let l = parseCmp();
    while (isOp("==") || isOp("!=")) { const op = toks[p++].v; l = { k: "bin", op, l, r: parseCmp() }; }
    return l;
  }
  function parseCmp() {
    let l = parseAdd();
    while (isOp(">") || isOp(">=") || isOp("<") || isOp("<=")) { const op = toks[p++].v; l = { k: "bin", op, l, r: parseAdd() }; }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (isOp("+") || isOp("-")) { const op = toks[p++].v; l = { k: "bin", op, l, r: parseMul() }; }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (isOp("*") || isOp("/") || isOp("%")) { const op = toks[p++].v; l = { k: "bin", op, l, r: parseUnary() }; }
    return l;
  }
  function parseUnary() {
    if (isOp("-")) { p++; return { k: "neg", e: parseUnary() }; }
    if (isOp("!") || isWord("not")) {
      const wasWord = toks[p].t === "id";
      p++;
      if (wasWord && isOp("(") === false && !peek()) throw new Error("not 뒤에 값이 필요합니다");
      return { k: "not", e: parseUnary() };
    }
    return parsePow();
  }
  // a ^ b binds tighter than * and unary minus on the left (-2^2 = -4), and is right-associative (2^3^2 = 512).
  function parsePow() {
    const base = parsePostfix();
    if (!isOp("^")) return base;
    p++;
    return { k: "bin", op: "^", l: base, r: parseUnary() };
  }
  // first: arguments already parsed before "(" (the receiver of a method call); lambda arguments come after the list.
  function parseArgs(name, first) {
    const args = [];
    const lambda = F_LAMBDA_FNS.indexOf(name) >= 0;
    const arg = () => {
      const isLambda = lambda && first + args.length >= 1;
      if (isLambda) lambdaDepth++;
      try { args.push(parseOr()); } finally { if (isLambda) lambdaDepth--; }
    };
    if (!isOp(")")) {
      arg();
      while (isOp(",")) { p++; arg(); }
    }
    expect(")");
    return args;
  }
  // let(name, value, body) / lets(n1, v1, n2, v2, ..., body): each value sees the names before it.
  function parseLet(low) {
    const names = [], values = [];
    const mark = scope.length;
    for (;;) {
      const t = toks[p];
      if (!t || t.t !== "id" || (toks[p + 1] && toks[p + 1].t === "op" && toks[p + 1].v === "(")) throw new Error(low + " 의 이름 자리에는 변수 이름이 필요합니다");
      p++;
      expect(",");
      const value = parseOr();
      expect(",");
      names.push(t.v);
      values.push(value);
      scope.push(t.v);
      if (low === "let") break;
      // lets: another name follows when the next two tokens are "name ,"
      const n = toks[p], n2 = toks[p + 1];
      if (!(n && n.t === "id" && n2 && n2.t === "op" && n2.v === ",")) break;
    }
    const body = parseOr();
    expect(")");
    scope.length = mark;
    return { k: "let", names, values, body };
  }
  // a.f(b) is f(a, b); a.f (no parentheses) is f(a). Binds tighter than unary minus.
  function parsePostfix() {
    let e = parsePrimary();
    while (isOp(".")) {
      p++;
      const t = toks[p];
      if (!t || t.t !== "id") throw new Error("'.' 뒤에 함수 이름이 필요합니다");
      p++;
      let args = [e];
      const name = t.v.toLowerCase();
      if (isOp("(")) {
        p++;
        args = args.concat(parseArgs(name, 1));
      }
      e = { k: "call", name, args, method: true };
    }
    return e;
  }
  function parsePrimary() {
    const t = toks[p];
    if (!t) throw new Error("수식이 갑자기 끝났습니다");
    if (t.t === "num" || t.t === "str") { p++; return { k: "lit", v: t.v }; }
    if (t.t === "op" && t.v === "(") {
      p++;
      const e = parseOr();
      expect(")");
      return e;
    }
    if (t.t === "op" && t.v === "[") {
      p++;
      const items = [];
      if (!isOp("]")) {
        items.push(parseOr());
        while (isOp(",")) { p++; items.push(parseOr()); }
      }
      expect("]");
      return { k: "list", items };
    }
    if (t.t === "id") {
      p++;
      const low = t.v.toLowerCase();
      if (isOp("(")) {
        p++;
        if (low === "let" || low === "lets") return parseLet(low);
        return { k: "call", name: low, args: parseArgs(low, 0) };
      }
      if (scope.lastIndexOf(t.v) >= 0) return { k: "var", name: t.v };
      if ((low === "current" || low === "index") && lambdaDepth > 0) return { k: "var", name: "\u0000" + low };
      if (low === "true") return { k: "lit", v: true };
      if (low === "false") return { k: "lit", v: false };
      if (low === "null") return { k: "lit", v: null };
      throw new Error("알 수 없는 이름: " + t.v);
    }
    throw new Error("예상치 못한 기호: " + t.v);
  }
  const ast = parseOr();
  if (p < toks.length) throw new Error("수식 끝에 불필요한 내용이 있습니다");
  return ast;
}

// Dates are read and shown in the workspace time zone, Asia/Seoul (UTC+9, no daylight saving since 1988).
const F_TZ = 9 * 3600000;
const F_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?/;

function fMkDate(ms, allDay, end) {
  const d = { __date: true, ms, allDay: !!allDay };
  if (end) d.end = end;
  return d;
}

function fIsDate(v) {
  return !!(v && typeof v === "object" && (v.__date || (typeof v.start === "string" && v.start)));
}

// Internal date value from a date property ({start, end}), a YYYY-MM-DD / YYYY-MM-DDTHH:mm string, or ms.
function fDate(v) {
  if (v && v.__date) return v;
  if (typeof v === "number") return isFinite(v) ? fMkDate(v, false) : null;
  if (v && typeof v === "object" && typeof v.start === "string") {
    const s = fDate(v.start);
    if (!s) return null;
    const e = v.end ? fDate(v.end) : null;
    return e ? fMkDate(s.ms, s.allDay, e) : s;
  }
  if (typeof v !== "string") return null;
  const m = F_ISO_RE.exec(v.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (m[4] === undefined) return fMkDate(Date.UTC(y, mo - 1, d) - F_TZ, true);
  let off = F_TZ;
  if (m[7]) off = m[7] === "Z" ? 0 : (m[7][0] === "-" ? -1 : 1) * (+m[7].slice(1, 3) * 3600000 + +m[7].slice(-2) * 60000);
  const ms = Date.UTC(y, mo - 1, d, +m[4], +m[5], +(m[6] || 0)) - off;
  return isNaN(ms) ? null : fMkDate(ms, false);
}

function fWall(ms) {
  const t = new Date(ms + F_TZ);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), wd: t.getUTCDay() };
}

const F_UNITS = { years: "y", year: "y", quarters: "q", quarter: "q", months: "m", month: "m", weeks: "w", week: "w", days: "d", day: "d", hours: "h", hour: "h", minutes: "n", minute: "n" };

// Calendar units move the Seoul wall clock; a month step that lands past the month end stops at its last day.
function fDateAdd(value, n, unit) {
  const d = fDate(value);
  const u = F_UNITS[fToStr(unit).toLowerCase()];
  if (!d || !u || !isFinite(n)) return null;
  if (u === "h" || u === "n") return fMkDate(d.ms + n * (u === "h" ? 3600000 : 60000), false);
  if (u === "d" || u === "w") return fMkDate(d.ms + n * (u === "w" ? 7 : 1) * 86400000, d.allDay);
  const w = fWall(d.ms);
  const months = n * (u === "y" ? 12 : u === "q" ? 3 : 1);
  const target = w.mo - 1 + months;
  const y = w.y + Math.floor(target / 12), mo = ((target % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return fMkDate(Date.UTC(y, mo, Math.min(w.d, last), w.h, w.mi, w.s) - F_TZ, d.allDay);
}

const F_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function fFormatDate(d, format) {
  const w = fWall(d.ms);
  return format.replace(/YYYY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm/g, (token) => ({
    YYYY: String(w.y), MMMM: w.mo + "월", MMM: w.mo + "월", MM: fPad(w.mo), M: String(w.mo), DD: fPad(w.d), D: String(w.d),
    dddd: F_WEEKDAYS[w.wd] + "요일", ddd: F_WEEKDAYS[w.wd], HH: fPad(w.h), H: String(w.h), mm: fPad(w.mi),
  })[token]);
}

function fIsoWeek(d) {
  const w = fWall(d.ms);
  const t = new Date(Date.UTC(w.y, w.mo - 1, w.d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

// A pattern with regex syntax is a regular expression (an invalid one falls back to literal text); "." alone stays literal.
const F_REGEX_META = /[\\^$*+?[\]{}()|]/;

function fReplace(text, pattern, replacement, all) {
  if (F_REGEX_META.test(pattern)) {
    try { return text.replace(new RegExp(pattern, all ? "g" : ""), replacement); } catch (e) { /* literal below */ }
  }
  return text.split(pattern).join(replacement);
}

function fPad(n) {
  return String(n).padStart(2, "0");
}

function fShowDate(d) {
  const w = fWall(d.ms);
  const day = w.y + "-" + fPad(w.mo) + "-" + fPad(w.d);
  return d.allDay ? day : day + " " + fPad(w.h) + ":" + fPad(w.mi);
}

function fDateParts(v) {
  const d = fDate(v);
  if (!d) return null;
  const parts = fWall(d.ms);
  parts.ms = d.ms;
  return parts;
}

// style() results: {__rich: [{text, color?, bg?, b?, i?, u?, s?, c?}]}.
const F_COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const F_FLAGS = ["b", "i", "u", "s", "c"];

function fIsRich(v) {
  return !!(v && typeof v === "object" && Array.isArray(v.__rich));
}

function fSegments(v) {
  if (fIsRich(v)) return v.__rich;
  const text = fToStr(v);
  return text ? [{ text }] : [];
}

function fRich(segments) {
  return { __rich: segments };
}

function fStyle(value, styles) {
  const out = fSegments(value).map((seg) => Object.assign({}, seg));
  for (const raw of styles) {
    const key = fToStr(raw).trim().toLowerCase().replace(/^grey/, "gray");
    for (const seg of out) {
      if (F_FLAGS.indexOf(key) >= 0) seg[key] = true;
      else if (/_background$/.test(key) && F_COLORS.indexOf(key.slice(0, -11)) >= 0) seg.bg = key.slice(0, -11);
      else if (F_COLORS.indexOf(key) >= 0) seg.color = key;
    }
  }
  return fRich(out);
}

function fWholeMonths(a, b) {
  // a <= b
  let m = (b.y - a.y) * 12 + (b.mo - a.mo);
  const ra = [a.d, a.h, a.mi, a.s];
  const rb = [b.d, b.h, b.mi, b.s];
  for (let i = 0; i < 4; i++) {
    if (rb[i] > ra[i]) break;
    if (rb[i] < ra[i]) { m--; break; }
  }
  return m;
}

function fDateBetween(d1, d2, unit) {
  const a = fDateParts(d1);
  const b = fDateParts(d2);
  if (!a || !b) return null;
  const u = String(unit).toLowerCase();
  const sign = a.ms > b.ms ? -1 : 1;
  const lo = sign > 0 ? a : b;
  const hi = sign > 0 ? b : a;
  let n;
  if (u === "years" || u === "year") n = Math.floor(fWholeMonths(lo, hi) / 12);
  else if (u === "quarters" || u === "quarter") n = Math.floor(fWholeMonths(lo, hi) / 3);
  else if (u === "months" || u === "month") n = fWholeMonths(lo, hi);
  else {
    const per = { weeks: 604800000, week: 604800000, days: 86400000, day: 86400000, hours: 3600000, hour: 3600000, minutes: 60000, minute: 60000, seconds: 1000, second: 1000 }[u];
    if (!per) return null;
    n = Math.floor((hi.ms - lo.ms) / per);
  }
  return n === 0 ? 0 : sign * n;
}

// A related row in a formula: {__row, id, title, props: {name: value}}. Shown as its title.
function fIsRow(v) {
  return !!(v && typeof v === "object" && v.__row);
}

// Functions whose arguments after the list are evaluated per element with current / index bound.
const F_LAMBDA_FNS = ["map", "filter", "some", "every", "find", "findindex"];

function fToStr(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(fToStr).join(", ");
  if (fIsRow(v)) return v.title == null ? "" : String(v.title);
  if (fIsRich(v)) return v.__rich.map((seg) => seg.text).join("");
  if (fIsDate(v)) { const d = fDate(v); return d ? fShowDate(d) : ""; }
  return String(v);
}

function fToNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined || v === "") return 0;
  if (v && v.__date) return v.ms;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return isNaN(n) ? NaN : n;
  }
  return NaN;
}

function fTruthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (fIsRich(v)) return fToStr(v) !== "";
  return !!v;
}

function fEmpty(v) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (fIsRich(v) && fToStr(v) === "");
}

function fFlat(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) for (const x of a) out.push(x);
    else out.push(a);
  }
  return out;
}

function fCompare(a, b) {
  if (fIsDate(a) || fIsDate(b)) {
    const x = fDate(a), y = fDate(b);
    if (x && y) return x.ms - y.ms;
  }
  if (fIsRich(a) || fIsRich(b)) {
    const sa = fToStr(a), sb = fToStr(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  const an = typeof a === "number" || typeof a === "boolean";
  const bn = typeof b === "number" || typeof b === "boolean";
  if (an && bn) return Number(a) - Number(b);
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  const x = fToNum(a), y = fToNum(b);
  if (!isNaN(x) && !isNaN(y) && a !== null && b !== null) return x - y;
  const sa = fToStr(a), sb = fToStr(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function fEquals(a, b) {
  if (fEmpty(a) && fEmpty(b)) return true;
  if (Array.isArray(a) || Array.isArray(b) || fIsRich(a) || fIsRich(b)) return fToStr(a) === fToStr(b);
  if (fIsDate(a) || fIsDate(b)) return fCompare(a, b) === 0;
  if (typeof a === typeof b) return a === b;
  return fCompare(a, b) === 0;
}

// Plain text for a list, or rich segments joined by ", " when an element is styled (shown at the result boundary).
function fToRich(v) {
  if (!Array.isArray(v)) return v;
  const flat = fFlatDeep(v);
  if (!flat.some(fIsRich)) return fToStr(v);
  const out = [];
  flat.forEach((x, i) => {
    if (i) out.push({ text: ", " });
    for (const seg of fSegments(x)) out.push(seg);
  });
  return fRich(out);
}

function fFlatDeep(list) {
  const out = [];
  for (const x of list) {
    if (Array.isArray(x)) for (const y of fFlatDeep(x)) out.push(y);
    else out.push(x);
  }
  return out;
}

function fRowProp(row, key) {
  if (!fIsRow(row)) return null;
  const props = row.props || {};
  if (Object.prototype.hasOwnProperty.call(props, key)) return props[key] === undefined ? null : props[key];
  return null;
}

// map/filter/...: the list is evaluated once, the lambda once per element with current and index bound.
function fLambda(name, argNodes, ev, ctx, env) {
  const list = ev(argNodes[0]);
  if (!Array.isArray(list)) return null;
  fCheckList(list);
  const body = argNodes[1];
  if (!body) throw new Error(name + " 인자 부족");
  const each = (x, i) => {
    const inner = Object.create(env || null);
    inner["\u0000current"] = x;
    inner["\u0000index"] = i;
    return fEval(body, ctx, inner);
  };
  switch (name) {
    case "map": return list.map(each);
    case "filter": return list.filter((x, i) => fTruthy(each(x, i)));
    case "some": return list.some((x, i) => fTruthy(each(x, i)));
    case "every": return list.every((x, i) => fTruthy(each(x, i)));
    case "find": { const i = list.findIndex((x, j) => fTruthy(each(x, j))); return i < 0 ? null : list[i]; }
    case "findindex": return list.findIndex((x, i) => fTruthy(each(x, i)));
  }
  return null;
}

function fCall(name, argNodes, ev, ctx, env, method) {
  if (F_LAMBDA_FNS.indexOf(name) >= 0) return fLambda(name, argNodes, ev, ctx, env);
  if (name === "if") {
    if (argNodes.length < 2) throw new Error("if 인자 부족");
    return fTruthy(ev(argNodes[0])) ? ev(argNodes[1]) : argNodes[2] ? ev(argNodes[2]) : null;
  }
  if (name === "ifs") {
    if (argNodes.length < 2) throw new Error("ifs 인자 부족");
    let i = 0;
    for (; i + 1 < argNodes.length; i += 2) if (fTruthy(ev(argNodes[i]))) return ev(argNodes[i + 1]);
    return i < argNodes.length ? ev(argNodes[i]) : null;
  }
  if (name === "prop") {
    if (!argNodes.length) throw new Error("prop 인자 부족");
    // row.prop("name") (method form): the value of a related row, null for anything else.
    if (method) return fRowProp(ev(argNodes[0]), fToStr(argNodes[1] ? ev(argNodes[1]) : ""));
    const key = fToStr(ev(argNodes[0]));
    if (ctx.has(key)) {
      const v = ctx.get(key);
      return v === undefined ? null : v;
    }
    return argNodes.length > 1 ? ev(argNodes[1]) : null;
  }
  const a = argNodes.map(ev);
  switch (name) {
    case "concat":
      if (a.length && a.every(Array.isArray)) return fFlat(a);
      return a.some(fIsRich) ? fRich(fFlat(a.map(fSegments))) : a.map(fToStr).join("");
    case "style": return fStyle(a[0], a.slice(1));
    case "unstyle": return fToStr(a[0]);
    case "join": return (Array.isArray(a[0]) ? a[0] : [a[0]]).map(fToStr).join(a[1] === undefined ? ", " : fToStr(a[1]));
    case "first": return Array.isArray(a[0]) ? (a[0].length ? a[0][0] : null) : null;
    case "last": return Array.isArray(a[0]) ? (a[0].length ? a[0][a[0].length - 1] : null) : null;
    case "at": {
      if (!Array.isArray(a[0]) && typeof a[0] !== "string") return null;
      let i = Math.trunc(fToNum(a[1]));
      if (isNaN(i)) return null;
      if (i < 0) i += a[0].length;
      return i >= 0 && i < a[0].length ? a[0][i] : null;
    }
    case "slice":
    case "substring": {
      const src = Array.isArray(a[0]) ? a[0] : fToStr(a[0]);
      const from = a[1] === undefined ? 0 : fToNum(a[1]);
      return a[2] === undefined ? src.slice(from) : src.slice(from, fToNum(a[2]));
    }
    case "flat": return Array.isArray(a[0]) ? fFlat(a[0]) : null;
    case "reverse": return Array.isArray(a[0]) ? a[0].slice().reverse() : null;
    case "unique": {
      if (!Array.isArray(a[0])) return null;
      const seen = new Set();
      return a[0].filter((x) => { const k = fToStr(x); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    case "sort": return Array.isArray(a[0]) ? a[0].slice().sort(fCompare) : null;
    case "includes":
      return Array.isArray(a[0]) ? a[0].some((x) => fEquals(x, a[1])) : fToStr(a[0]).indexOf(fToStr(a[1])) >= 0;
    case "datebetween": return fDateBetween(a[0], a[1], a[2]);
    case "format": return fToStr(a[0]);
    case "round": {
      const n = a[1] === undefined ? 0 : fToNum(a[1]);
      const f = Math.pow(10, n);
      const x = fToNum(a[0]);
      return Math.sign(x) * Math.round(Math.abs(x) * f) / f;
    }
    case "floor": return Math.floor(fToNum(a[0]));
    case "ceil": return Math.ceil(fToNum(a[0]));
    case "abs": return Math.abs(fToNum(a[0]));
    case "pow": return Math.pow(fToNum(a[0]), fToNum(a[1]));
    case "mod": return fToNum(a[0]) % fToNum(a[1]);
    case "min": { const n = fFlat(a).map(fToNum); return n.length ? Math.min.apply(null, n) : null; }
    case "max": { const n = fFlat(a).map(fToNum); return n.length ? Math.max.apply(null, n) : null; }
    case "sum": return fFlat(a).map(fToNum).reduce((x, y) => x + y, 0);
    case "length": return Array.isArray(a[0]) ? a[0].length : fToStr(a[0]).length;
    case "empty": return fEmpty(a[0]);
    case "lower": return fToStr(a[0]).toLowerCase();
    case "upper": return fToStr(a[0]).toUpperCase();
    case "trim": return fToStr(a[0]).trim();
    case "replace": return fReplace(fToStr(a[0]), fToStr(a[1]), fToStr(a[2]), false);
    case "replaceall": return fReplace(fToStr(a[0]), fToStr(a[1]), fToStr(a[2]), true);
    case "today": { const w = fWall(ctx.now); return fMkDate(Date.UTC(w.y, w.mo - 1, w.d) - F_TZ, true); }
    case "dateadd": return fDateAdd(a[0], fToNum(a[1]), a[2]);
    case "datesubtract": return fDateAdd(a[0], -fToNum(a[1]), a[2]);
    case "formatdate": { const d = fDate(a[0]); return d ? fFormatDate(d, a[1] === undefined ? "YYYY-MM-DD" : fToStr(a[1])) : null; }
    case "year": { const d = fDate(a[0]); return d ? fWall(d.ms).y : null; }
    case "month": { const d = fDate(a[0]); return d ? fWall(d.ms).mo : null; }
    case "date": { const d = fDate(a[0]); return d ? fWall(d.ms).d : null; }
    case "day": { const d = fDate(a[0]); return d ? (fWall(d.ms).wd || 7) : null; }
    case "hour": { const d = fDate(a[0]); return d ? fWall(d.ms).h : null; }
    case "minute": { const d = fDate(a[0]); return d ? fWall(d.ms).mi : null; }
    case "week": { const d = fDate(a[0]); return d ? fIsoWeek(d) : null; }
    case "datestart": { const d = fDate(a[0]); return d ? fMkDate(d.ms, d.allDay) : null; }
    case "dateend": { const d = fDate(a[0]); return d ? (d.end || fMkDate(d.ms, d.allDay)) : null; }
    case "parsedate": return fDate(fToStr(a[0]));
    case "timestamp": { const d = fDate(a[0]); return d ? d.ms : null; }
    case "and": return fFlat(a).every(fTruthy);
    case "or": return fFlat(a).some(fTruthy);
    case "not": return !fTruthy(a[0]);
    case "contains":
      return Array.isArray(a[0]) ? a[0].some((x) => fEquals(x, a[1])) : fToStr(a[0]).indexOf(fToStr(a[1])) >= 0;
    case "tonumber": { const n = fToNum(a[0]); return isNaN(n) ? null : n; }
    case "now": return fMkDate(ctx.now, false);
    default: throw new Error("알 수 없는 함수: " + name);
  }
}

// env holds let/lets bindings (a prototype chain, so an inner let shadows an outer one only inside its body).
// One formula evaluation may visit at most F_MAX_STEPS nodes and build lists of at most F_MAX_LIST elements, so a
// heavy formula becomes an error in its cell instead of freezing the table. The counter restarts per evaluation.
const F_MAX_STEPS = 10000;
const F_MAX_LIST = 10000;
const F_TOO_LONG = "수식이 너무 깁니다";
let fSteps = 0;

function fCheckList(list) {
  if (list.length > F_MAX_LIST) throw new Error("목록이 너무 깁니다(" + F_MAX_LIST + "개까지)");
  return list;
}

function fEval(node, ctx, env) {
  if (++fSteps > F_MAX_STEPS) throw new Error(F_TOO_LONG);
  const ev = (n) => fEval(n, ctx, env);
  switch (node.k) {
    case "lit": return node.v;
    case "list": return fCheckList(node.items.map(ev));
    case "var": {
      if (!env || !(node.name in env)) throw new Error("알 수 없는 이름: " + node.name);
      return env[node.name];
    }
    case "let": {
      let inner = env || Object.create(null);
      for (let i = 0; i < node.names.length; i++) {
        const value = fEval(node.values[i], ctx, inner);
        inner = Object.create(inner);
        inner[node.names[i]] = value;
      }
      return fEval(node.body, ctx, inner);
    }
    case "neg": return -fToNum(ev(node.e));
    case "not": return !fTruthy(ev(node.e));
    case "call": return fCall(node.name, node.args, ev, ctx, env, node.method);
    case "bin": {
      if (node.op === "and") return fTruthy(ev(node.l)) && fTruthy(ev(node.r));
      if (node.op === "or") return fTruthy(ev(node.l)) || fTruthy(ev(node.r));
      const l = ev(node.l), r = ev(node.r);
      switch (node.op) {
        case "+":
          if (fIsRich(l) || fIsRich(r)) return fRich(fSegments(l).concat(fSegments(r)));
          if (typeof l === "string" || typeof r === "string") return fToStr(l) + fToStr(r);
          return fToNum(l) + fToNum(r);
        case "-": return fToNum(l) - fToNum(r);
        case "*": return fToNum(l) * fToNum(r);
        case "^": return Math.pow(fToNum(l), fToNum(r));
        // Dividing by zero (often an empty number) is an empty result, not a formula error.
        case "/": return fToNum(l) / fToNum(r);
        case "%": return fToNum(l) % fToNum(r);
        case "==": return fEquals(l, r);
        case "!=": return !fEquals(l, r);
        case ">": return fCompare(l, r) > 0;
        case ">=": return fCompare(l, r) >= 0;
        case "<": return fCompare(l, r) < 0;
        case "<=": return fCompare(l, r) <= 0;
      }
    }
  }
  throw new Error("평가할 수 없는 노드");
}

export function formulaError(expression) {
  try {
    fParse(expression);
    return null;
  } catch (e) {
    return (e && e.message) || "수식을 해석할 수 없습니다";
  }
}

// {value, error}: error is the message of a parse or evaluation failure (value is then null), otherwise null.
// Parsed formulas by source text: a table evaluates the same few formulas for every row and pass. The tree is never
// mutated by evaluation, so sharing it is safe; the cache is cleared when it grows past F_AST_MAX sources.
const F_AST_MAX = 500;
const fAsts = new Map();
function fParseCached(expression) {
  const key = String(expression);
  let ast = fAsts.get(key);
  if (!ast) {
    ast = fParse(key);
    if (fAsts.size >= F_AST_MAX) fAsts.clear();
    fAsts.set(key, ast);
  }
  return ast;
}

export function evaluateFormulaDetailed(expression, ctx) {
  fSteps = 0;
  try {
    const ast = fParseCached(expression);
    const v = fEval(ast, ctx);
    return { value: fResult(v), error: null };
  } catch (e) {
    return { value: null, error: (e && e.message) || "수식을 계산할 수 없습니다" };
  }
}

function fResult(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (v === undefined) return null;
  if (Array.isArray(v)) return fToRich(v);
  if (fIsDate(v) || fIsRow(v)) return fToStr(v);
  if (fIsRich(v)) return v.__rich.length ? v : "";
  return v;
}

export function evaluateFormula(expression, ctx) {
  return evaluateFormulaDetailed(expression, ctx).value;
}

export function rollupValue(rollup, ctx) {
  try {
    const related = (ctx && ctx.related) || [];
    const tp = rollup.target_property;
    const vals = related.map((r) => r.get(tp));
    const flat = fFlat(vals);
    const nonEmpty = flat.filter((v) => !fEmpty(v));
    const nums = nonEmpty.map(fToNum).filter((n) => !isNaN(n));
    const fn = rollup.function;
    switch (fn) {
      case "count": return related.length;
      case "count_values": return nonEmpty.length;
      case "sum": return nums.reduce((x, y) => x + y, 0);
      case "average": return nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : null;
      case "median": {
        if (!nums.length) return null;
        const s = nums.slice().sort((x, y) => x - y);
        const m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      }
      case "min": return nums.length ? Math.min.apply(null, nums) : null;
      case "max": return nums.length ? Math.max.apply(null, nums) : null;
      case "range": return nums.length ? Math.max.apply(null, nums) - Math.min.apply(null, nums) : null;
      case "percent_checked": {
        if (!vals.length) return 0;
        return (vals.filter((v) => v === true).length / vals.length) * 100;
      }
      case "percent_not_empty": {
        if (!vals.length) return 0;
        return (vals.filter((v) => !fEmpty(v)).length / vals.length) * 100;
      }
      case "count_unique": return new Set(nonEmpty.map(fToStr)).size;
      case "unique": return Array.from(new Set(nonEmpty.map(fToStr))).join(", ");
      case "show_original": return nonEmpty.map(fToStr).join(", ");
      case "empty": return nonEmpty.length === 0;
      case "not_empty": return nonEmpty.length > 0;
      case "earliest_date":
      case "latest_date": {
        const ds = nonEmpty.filter((v) => fDateParts(v));
        if (!ds.length) return null;
        ds.sort((x, y) => fDateParts(x).ms - fDateParts(y).ms);
        return fn === "earliest_date" ? ds[0] : ds[ds.length - 1];
      }
      default: return null;
    }
  } catch (e) {
    return null;
  }
}
