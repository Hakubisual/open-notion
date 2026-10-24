// One local search for the Tab palette (and any menu that wants it): every block type, every registered component
// (component-registry slash/aliases metadata, so a new component is found without touching this file) and every
// palette command. Korean and English keywords, synonyms, 초성 (ㅊㅌ -> 차트), half-typed syllables, 1-2 letter typos,
// and recent use. Runs only in the browser, nothing leaves the page. Recipe: research/human-edit/research.md (c).
(function (root) {
  "use strict";
  var CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ", JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ", JONG = "_ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
  // Hangul syllable U+AC00 + (initial*21 + vowel)*28 + final.
  function jamo(s) {
    var out = "";
    for (var i = 0; i < s.length; i += 1) {
      var c = s.charCodeAt(i) - 0xac00;
      out += c < 0 || c > 11171 ? s.charAt(i) : CHO.charAt(Math.floor(c / 588)) + JUNG.charAt(Math.floor(c % 588 / 28)) + (c % 28 ? JONG.charAt(c % 28) : "");
    }
    return out;
  }
  function cho(s) { return s.replace(/[\uac00-\ud7a3]/g, function (ch) { return CHO.charAt(Math.floor((ch.charCodeAt(0) - 0xac00) / 588)); }); }
  function flat(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }

  // Related words: a query for one finds the others (both ways). Keep it to what people actually type.
  var SYNONYMS = [
    ["도표", "표", "테이블", "table", "grid", "시트", "엑셀"],
    ["차트", "그래프", "chart", "graph", "막대", "선그래프", "원그래프", "파이", "통계", "plot"],
    ["다이어그램", "흐름", "흐름도", "순서도", "플로우", "flow", "flowchart", "diagram", "구조도", "프로세스", "단계"],
    ["타임라인", "일정", "연표", "timeline", "로드맵", "roadmap", "간트", "gantt"],
    ["비교", "비교표", "compare", "vs", "대조", "장단점"],
    ["kpi", "지표", "숫자카드", "metric", "stat", "핵심지표", "대시보드"],
    ["이미지", "사진", "그림", "image", "photo", "picture", "img"],
    ["마인드맵", "mindmap", "생각정리", "브레인스토밍"],
    ["조직도", "org", "orgchart", "팀구조"],
    ["할일", "체크", "todo", "체크리스트", "checklist", "task"],
    ["인용", "quote", "인용구"],
    ["코드", "code", "snippet"],
    ["수식", "equation", "latex", "math", "공식"],
    ["목차", "toc", "contents"],
    ["버튼", "button", "cta"],
    ["진행", "진행률", "progress", "퍼센트"],
    ["벤", "벤다이어그램", "venn", "교집합", "겹침"]
  ];
  var SYN = Object.create(null);
  SYNONYMS.forEach(function (group) { group.forEach(function (w) { SYN[flat(w)] = group; }); });

  // Optimal string alignment distance with an early stop at max (Damerau: most typos are one edit).
  function osa(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= a.length; i += 1) { d[i] = [i]; }
    for (j = 0; j <= b.length; j += 1) d[0][j] = j;
    for (i = 1; i <= a.length; i += 1) {
      var low = max + 1;
      for (j = 1; j <= b.length; j += 1) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, d[i - 2][j - 2] + 1);
        d[i][j] = v; if (v < low) low = v;
      }
      if (low > max) return max + 1;
    }
    return d[a.length][b.length];
  }
  function subsequence(q, key) {
    var at = 0, run = 0, score = 0, prev = -2;
    for (var i = 0; i < q.length; i += 1) {
      var found = key.indexOf(q.charAt(i), at);
      if (found < 0) return -1;
      run = found === prev + 1 ? run + 1 : 0;
      score += 10 + run * 15 - (found - at) * 2;
      prev = found; at = found + 1;
    }
    return score;
  }

  function keysOf(item) {
    if (item._keys) return item._keys;
    var words = [item.label, item.hint, item.aliases, item.keywords && item.keywords.join(" "), item.type && String(item.type).replace(/^component:/, ""), item.desc]
      .join(" ").toLowerCase().split(/[\s,·/]+/).filter(Boolean);
    var label = flat(item.label);
    var all = [label].concat(words.map(flat));
    var seen = Object.create(null), keys = [];
    all.forEach(function (w) { if (w && !seen[w]) { seen[w] = 1; keys.push({ raw: w, jamo: jamo(w), cho: cho(w) }); } });
    item._keys = keys;
    return keys;
  }

  // One query against one key: the best tier wins. Tiers are 100 apart so recent use (max 150) only reorders close ones.
  function scoreKey(q, qj, onlyCho, key, isLabel) {
    var bonus = isLabel ? 60 : 0;
    if (onlyCho) {
      if (key.cho === q) return 900 + bonus;
      if (key.cho.indexOf(q) === 0) return 700 + bonus;
      if (key.cho.indexOf(q) > 0) return 450 + bonus;
      return -1;
    }
    if (key.raw === q) return 1000 + bonus;
    if (key.raw.indexOf(q) === 0 || key.jamo.indexOf(qj) === 0) return 800 + bonus - Math.min(60, key.raw.length - q.length);
    var at = key.jamo.indexOf(qj);
    if (at > 0) return 500 + bonus - Math.min(60, at);
    var sub = q.length >= 2 ? subsequence(qj, key.jamo) : -1;
    if (sub >= 0 && sub > qj.length * 8) return 300 + bonus + Math.min(80, sub / 4);
    if (q.length >= 3) {
      var max = q.length <= 5 ? 1 : 2;
      var d = Math.min(osa(qj, key.jamo.slice(0, qj.length), max), osa(qj, key.jamo, max));
      if (d <= max) return 260 + bonus - 60 * d;
    }
    return -1;
  }

  function score(item, query) {
    var q = flat(query);
    if (!q) return 0;
    var onlyCho = /^[\u3131-\u314e]+$/.test(q);
    var qj = jamo(q);
    var keys = keysOf(item), best = -1;
    keys.forEach(function (key, i) { var s = scoreKey(q, qj, onlyCho, key, i === 0); if (s > best) best = s; });
    if (best < 0 && !onlyCho) {
      var group = SYN[q] || Object.keys(SYN).filter(function (w) { return q.length >= 2 && w.indexOf(q) === 0; }).map(function (w) { return SYN[w]; })[0];
      if (group) group.forEach(function (w) { if (w === q) return; var fw = flat(w), wj = jamo(fw); keys.forEach(function (key, i) { var s = scoreKey(fw, wj, false, key, i === 0); if (s > 0) best = Math.max(best, Math.min(s, 1000) - 250); }); });
    }
    return best;
  }

  var RECENT_KEY = "acard-palette-recent";
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") || {}; } catch (_) { return {}; } }
  function remember(id) {
    var r = recent(), now = Date.now();
    var e = r[id] || { n: 0, t: now }; e.n += 1; e.t = now; r[id] = e;
    var ids = Object.keys(r).sort(function (a, b) { return r[b].t - r[a].t; });
    ids.slice(40).forEach(function (k) { delete r[k]; });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (_) {}
  }
  function boost(id, r) {
    var e = r[id]; if (!e) return 0;
    var days = (Date.now() - e.t) / 864e5;
    return Math.min(150, 40 * Math.log2(1 + e.n) * Math.pow(0.5, days / 7));
  }

  // items: [{type|id, label, hint?, aliases?, keywords?, group?}] -> best first, each with .score. Empty query: recent first.
  function search(items, query, limit) {
    var r = recent(), q = flat(query);
    var out = [];
    items.forEach(function (item, i) {
      var s = score(item, query);
      if (q && s < 180) return;
      out.push({ item: item, score: s + boost(item.id || item.type, r), i: i });
    });
    out.sort(function (a, b) { return b.score - a.score || String(a.item.label).length - String(b.item.label).length || a.i - b.i; });
    return out.slice(0, limit || 8).map(function (x) { var item = Object.create(x.item); item.score = x.score; return item; });
  }

  var api = { search: search, score: score, remember: remember, jamo: jamo, cho: cho, osa: osa, SYNONYMS: SYNONYMS };
  root.AcardCommandSearch = api;
  if (root.AcardEditor && root.AcardEditor.provide) root.AcardEditor.provide("command-search", api);
})(typeof window !== "undefined" ? window : globalThis);
