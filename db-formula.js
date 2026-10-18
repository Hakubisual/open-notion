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
      if (s[j] === ".") { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
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
    if ("+-*/%()<>,!".indexOf(c) >= 0) {
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
    return parsePrimary();
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
    if (t.t === "id") {
      p++;
      const low = t.v.toLowerCase();
      if (isOp("(")) {
        p++;
        const args = [];
        if (!isOp(")")) {
          args.push(parseOr());
          while (isOp(",")) { p++; args.push(parseOr()); }
        }
        expect(")");
        return { k: "call", name: low, args };
      }
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

const F_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function fDateParts(v) {
  if (typeof v !== "string") return null;
  const m = F_DATE_RE.exec(v.trim());
  if (!m) return null;
  const parts = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  parts.ms = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s);
  if (isNaN(parts.ms)) return null;
  return parts;
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

function fToStr(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(fToStr).join(", ");
  return String(v);
}

function fToNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return isNaN(n) ? NaN : n;
  }
  return NaN;
}

function fTruthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function fEmpty(v) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
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
  if (Array.isArray(a) || Array.isArray(b)) return fToStr(a) === fToStr(b);
  if (typeof a === typeof b) return a === b;
  return fCompare(a, b) === 0;
}

function fCall(name, argNodes, ev, ctx) {
  if (name === "if") {
    if (argNodes.length < 2) throw new Error("if 인자 부족");
    return fTruthy(ev(argNodes[0])) ? ev(argNodes[1]) : argNodes[2] ? ev(argNodes[2]) : null;
  }
  if (name === "prop") {
    if (!argNodes.length) throw new Error("prop 인자 부족");
    const key = fToStr(ev(argNodes[0]));
    if (ctx.has(key)) {
      const v = ctx.get(key);
      return v === undefined ? null : v;
    }
    return argNodes.length > 1 ? ev(argNodes[1]) : null;
  }
  const a = argNodes.map(ev);
  switch (name) {
    case "concat": return a.map(fToStr).join("");
    case "join": return (Array.isArray(a[0]) ? a[0] : [a[0]]).map(fToStr).join(a[1] === undefined ? ", " : fToStr(a[1]));
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
    case "min": { const n = fFlat(a).map(fToNum); return n.length ? Math.min.apply(null, n) : null; }
    case "max": { const n = fFlat(a).map(fToNum); return n.length ? Math.max.apply(null, n) : null; }
    case "sum": return fFlat(a).map(fToNum).reduce((x, y) => x + y, 0);
    case "length": return Array.isArray(a[0]) ? a[0].length : fToStr(a[0]).length;
    case "empty": return fEmpty(a[0]);
    case "lower": return fToStr(a[0]).toLowerCase();
    case "upper": return fToStr(a[0]).toUpperCase();
    case "trim": return fToStr(a[0]).trim();
    case "replace": return fToStr(a[0]).split(fToStr(a[1])).join(fToStr(a[2]));
    case "contains":
      return Array.isArray(a[0]) ? a[0].some((x) => fEquals(x, a[1])) : fToStr(a[0]).indexOf(fToStr(a[1])) >= 0;
    case "tonumber": { const n = fToNum(a[0]); return isNaN(n) ? null : n; }
    case "now": return ctx.now;
    default: throw new Error("알 수 없는 함수: " + name);
  }
}

function fEval(node, ctx) {
  const ev = (n) => fEval(n, ctx);
  switch (node.k) {
    case "lit": return node.v;
    case "neg": return -fToNum(ev(node.e));
    case "not": return !fTruthy(ev(node.e));
    case "call": return fCall(node.name, node.args, ev, ctx);
    case "bin": {
      if (node.op === "and") return fTruthy(ev(node.l)) && fTruthy(ev(node.r));
      if (node.op === "or") return fTruthy(ev(node.l)) || fTruthy(ev(node.r));
      const l = ev(node.l), r = ev(node.r);
      switch (node.op) {
        case "+":
          if (typeof l === "string" || typeof r === "string") return fToStr(l) + fToStr(r);
          return fToNum(l) + fToNum(r);
        case "-": return fToNum(l) - fToNum(r);
        case "*": return fToNum(l) * fToNum(r);
        case "/": { const d = fToNum(r); if (d === 0) throw new Error("0으로 나눌 수 없습니다"); return fToNum(l) / d; }
        case "%": { const d = fToNum(r); if (d === 0) throw new Error("0으로 나눌 수 없습니다"); return fToNum(l) % d; }
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

export function evaluateFormula(expression, ctx) {
  try {
    const ast = fParse(expression);
    const v = fEval(ast, ctx);
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (v === undefined) return null;
    if (Array.isArray(v)) return fToStr(v);
    return v;
  } catch (e) {
    return null;
  }
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
