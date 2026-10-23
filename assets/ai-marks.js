(function (root) {
  "use strict";

  // AI marks (acard-human-edit): what an AI may do with each part of a page, set by a person.
  //   edit  AI may rewrite it (the default; every page that never set a mark behaves exactly as before)
  //   lock  AI never changes it
  //   ref   AI reads it as source material and never changes it
  // A block carries meta.ai; a run of text inside a block carries richText run.ai ("lock" or "ref"). A page default
  // (editor_page_settings.ai) applies to blocks without their own mark; "smart" picks per block (smartMark).
  // People are never limited by a mark: only agent, MCP and in-editor AI writes go through guard().
  // The same file runs in the editor (lazy marks UI), the Worker (inlined like columns-model.js) and the tests.

  var MARKS = ["edit", "lock", "ref"];
  var DEFAULTS = ["edit", "lock", "ref", "smart"];
  var LABELS = { edit: "AI가 바꿔도 됨", lock: "고정", ref: "참고", smart: "자동" };

  function mark(value) { return MARKS.indexOf(value) >= 0 ? value : null; }
  function pageDefault(value) { return DEFAULTS.indexOf(value) >= 0 ? value : "edit"; }
  function runsOf(block) { return block && block.meta && Array.isArray(block.meta.richText) ? block.meta.richText : null; }

  // The "smart" page default: facts a writer quotes stay fixed, notes are material, the rest is draft.
  var REF_START = /^\s*(메모|자료|참고|노트|note|memo|ref|reference)\b|^\s*(메모|자료|참고|노트)/i;
  var SOURCE = /^\s*(출처|참고\s*문헌|source|sources|references?)\s*[:：]/i;
  function smartMark(block) {
    if (!block) return "edit";
    var type = block.type, text = String(block.text || "");
    if ((type === "callout" || type === "toggle") && REF_START.test(text)) return "ref";
    if (/^heading[1-4]$/.test(type) || type === "quote" || type === "table" || type === "database" || type === "equation") return "lock";
    if (SOURCE.test(text) || /https?:\/\/\S/.test(text)) return "lock";
    var runs = runsOf(block);
    if (runs && runs.some(function (run) { return run && run.href; })) return "lock";
    return "edit";
  }

  function effective(block, page) {
    var own = block && block.meta ? mark(block.meta.ai) : null;
    if (own) return own;
    var fallback = pageDefault(page);
    return fallback === "smart" ? smartMark(block) : fallback;
  }

  // [[start, length, mark], ...] in offsets of block.text. Two stored forms: richText runs with run.ai (the editor), or
  // meta.aiSpans [[mark, text], ...] (read from markdown, where runs come back as inline markdown text), matched in order.
  function spans(block) {
    var runs = runsOf(block), out = [], at = 0;
    var marked = runs && runs.some(function (run) { return run && (run.ai === "lock" || run.ai === "ref"); });
    if (!marked) return textSpans(block);
    runs.forEach(function (run) {
      var text = String(run && run.text || "");
      var m = run && (run.ai === "lock" || run.ai === "ref") ? run.ai : null;
      if (m && text) {
        var last = out[out.length - 1];
        if (last && last[2] === m && last[0] + last[1] === at) last[1] += text.length;
        else out.push([at, text.length, m]);
      }
      at += text.length;
    });
    return out;
  }

  function cleanTextSpans(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) { return Array.isArray(s) && (s[0] === "lock" || s[0] === "ref") && typeof s[1] === "string" && s[1] && s[1].length <= 4000; })
      .slice(0, 50).map(function (s) { return [s[0], s[1]]; });
  }
  function textSpans(block) {
    var list = cleanTextSpans(block && block.meta && block.meta.aiSpans), text = String(block && block.text || ""), out = [], from = 0;
    list.forEach(function (s) {
      var at = text.indexOf(s[1], from);
      if (at < 0) return;
      out.push([at, s[1].length, s[0]]);
      from = at + s[1].length;
    });
    return out;
  }

  // [[mark, text], ...] for the markdown meta line. render(run) gives a run's markdown, so a span over bold or linked
  // runs is written as the same characters the block's markdown text has.
  function spanTexts(block, render) {
    var runs = runsOf(block);
    var marked = runs && runs.some(function (run) { return run && (run.ai === "lock" || run.ai === "ref"); });
    if (!marked) return cleanTextSpans(block && block.meta && block.meta.aiSpans);
    var out = [];
    runs.forEach(function (run, i) {
      var m = run && (run.ai === "lock" || run.ai === "ref") ? run.ai : null;
      if (!m || !run.text) return;
      var piece = render ? render(run) : String(run.text);
      var prev = runs[i - 1];
      if (out.length && prev && prev.ai === m) out[out.length - 1][1] += piece;
      else out.push([m, piece]);
    });
    return out;
  }

  function keptTexts(block) {
    var text = String(block && block.text || "");
    return spans(block).map(function (s) { return text.slice(s[0], s[0] + s[1]); });
  }

  function keepsSpans(before, after) {
    var need = keptTexts(before);
    if (!need.length) return true;
    var text = String(after && after.text || ""), from = 0;
    for (var i = 0; i < need.length; i += 1) {
      var at = text.indexOf(need[i], from);
      if (at < 0) return false;
      from = at + need[i].length;
    }
    return true;
  }

  // Puts [[start, length, mark]] spans onto a block's runs (plain runs from block.text when it has none). Spans that do
  // not fit the text are dropped. Returns a new meta object.
  function withSpans(block, list) {
    var text = String(block.text || "");
    var meta = Object.assign({}, block.meta);
    var clean = (Array.isArray(list) ? list : []).filter(function (s) {
      return Array.isArray(s) && Number.isInteger(s[0]) && Number.isInteger(s[1]) && s[0] >= 0 && s[1] > 0 && s[0] + s[1] <= text.length && (s[2] === "lock" || s[2] === "ref");
    }).sort(function (a, b) { return a[0] - b[0]; });
    if (!clean.length) return meta;
    var base = runsOf(block) || [{ text: text }];
    var cuts = [0, text.length];
    clean.forEach(function (s) { cuts.push(s[0], s[0] + s[1]); });
    var at = 0;
    base.forEach(function (run) { at += String(run.text || "").length; cuts.push(at); });
    cuts = cuts.filter(function (c, i, all) { return all.indexOf(c) === i; }).sort(function (a, b) { return a - b; });
    var runs = [], ri = 0, rStart = 0;
    for (var c = 1; c < cuts.length; c += 1) {
      var start = cuts[c - 1], end = cuts[c];
      if (end <= start) continue;
      while (ri < base.length - 1 && rStart + String(base[ri].text || "").length <= start) { rStart += String(base[ri].text || "").length; ri += 1; }
      var piece = Object.assign({}, base[ri], { text: text.slice(start, end) });
      delete piece.ai;
      clean.forEach(function (s) { if (start >= s[0] && end <= s[0] + s[1]) piece.ai = s[2]; });
      runs.push(piece);
    }
    meta.richText = runs;
    return meta;
  }

  // Dice coefficient over character bigrams (whitespace ignored): 1 = same text, 0 = nothing in common.
  function similarity(a, b) {
    var grams = function (s) { s = String(s || "").replace(/\s+/g, ""); var out = []; for (var i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2)); return out; };
    var x = grams(a), y = grams(b);
    if (!x.length || !y.length) return String(a || "").trim() === String(b || "").trim() ? 1 : 0;
    var pool = new Map(), hit = 0;
    x.forEach(function (g) { pool.set(g, (pool.get(g) || 0) + 1); });
    y.forEach(function (g) { var n = pool.get(g) || 0; if (n) { hit += 1; pool.set(g, n - 1); } });
    return 2 * hit / (x.length + y.length);
  }

  function sameBlock(a, b) {
    return a.type === b.type && a.text === b.text && JSON.stringify(strip(a.meta)) === JSON.stringify(strip(b.meta));
  }
  function strip(meta) {
    if (!meta) return null;
    var out = Object.assign({}, meta);
    delete out.richText; delete out.human; delete out.suggest;
    return Object.keys(out).length ? out : null;
  }

  // Runs after every agent / MCP / chat-agent write, before the person-edit guard (#36).
  //  - A block whose effective mark is lock or ref comes back exactly as it was (restored where it stood if removed).
  //  - An edit block whose locked/ref text spans the writer did not keep in order comes back as it was.
  //  - Writers never set or clear marks: existing blocks keep the person's meta.ai, new blocks get none.
  //  - aligned: the ids came from matching a full-page rewrite (humanAlign), not from the writer. There an agent block that
  //    took a marked block's id but shares little text with it is the agent's own new block: it stays, after the restored one.
  // Returns { blocks, locked: [ids restored] }.
  function guard(before, after, page, aligned) {
    var out = after.map(function (block) { return Object.assign({}, block); });
    var old = new Map();
    before.forEach(function (block) { old.set(block.id, block); });
    out.forEach(function (block, i) {
      var prev = old.get(block.id);
      var meta = Object.assign({}, block.meta);
      delete meta.ai; delete meta.aiSpans;
      if (Array.isArray(meta.richText)) meta.richText = meta.richText.map(function (run) { var r = Object.assign({}, run); delete r.ai; return r; });
      if (prev && prev.meta && mark(prev.meta.ai)) meta.ai = prev.meta.ai;
      out[i] = Object.assign(block, { meta: Object.keys(meta).length ? meta : null });
    });
    var locked = [];
    var at = function (id) { for (var k = 0; k < out.length; k += 1) if (out[k].id === id) return k; return -1; };
    before.forEach(function (person, index) {
      var m = effective(person, page);
      var spanned = spans(person).length > 0;
      if (m === "edit" && !spanned) return;
      var pos = at(person.id);
      if (pos >= 0) {
        if (m === "edit" ? keepsSpans(person, out[pos]) && out[pos].type === person.type : sameBlock(out[pos], person)) {
          if (m !== "edit" || spanned) out[pos] = Object.assign({}, out[pos], { meta: m === "edit" ? withSpansKept(out[pos], person) : person.meta });
          return;
        }
        var theirs = out[pos];
        out[pos] = Object.assign({}, person);
        locked.push(person.id);
        if (aligned && similarity(theirs.text, person.text) < 0.3) {
          var fresh = "a" + Math.random().toString(36).slice(2, 10);
          while (at(fresh) >= 0) fresh = "a" + Math.random().toString(36).slice(2, 10);
          out.splice(pos + 1, 0, Object.assign({}, theirs, { id: fresh }));
        }
        return;
      }
      var prev = -1;
      for (var back = index - 1; back >= 0 && prev < 0; back -= 1) prev = at(before[back].id);
      out.splice(prev + 1, 0, Object.assign({}, person));
      locked.push(person.id);
    });
    return { blocks: out, locked: locked };
  }

  // An edit block that kept every marked span: the spans stay marked on the new text (first match in order).
  function withSpansKept(block, person) {
    var need = spans(person), text = String(block.text || ""), list = [], from = 0, ptext = String(person.text || "");
    need.forEach(function (s) {
      var piece = ptext.slice(s[0], s[0] + s[1]);
      var found = text.indexOf(piece, from);
      if (found >= 0) { list.push([found, piece.length, s[2]]); from = found + piece.length; }
    });
    if (runsOf(block)) return withSpans(block, list);
    var meta = Object.assign({}, block.meta);
    meta.aiSpans = list.map(function (s) { return [s[2], text.slice(s[0], s[0] + s[1])]; });
    return meta;
  }

  // Ids (and whole-block marks) an in-editor AI request may not rewrite: targets whose mark is lock or ref, or whose
  // [start, end) range in a block overlaps a lock/ref span.
  function blocked(blocks, page, ids, range) {
    var out = [];
    (ids || []).forEach(function (id) {
      var block = blocks.find(function (b) { return b.id === id; });
      if (!block) return;
      if (effective(block, page) !== "edit") { out.push(id); return; }
      var list = spans(block);
      if (!list.length) return;
      var from = range && ids.length === 1 && Number.isInteger(range[0]) ? range[0] : 0;
      var to = range && ids.length === 1 && Number.isInteger(range[1]) ? range[1] : String(block.text || "").length;
      if (list.some(function (s) { return s[0] < to && s[0] + s[1] > from; })) out.push(id);
    });
    return out;
  }

  // Page text for an AI prompt: lock blocks inside <locked>, ref blocks inside <ref>, the rest as is.
  function promptContext(blocks, page, limit) {
    var parts = [], refs = [], total = 0, max = limit || 12000;
    blocks.forEach(function (block) {
      var text = String(block.text || "").trim();
      if (!text || total > max) return;
      var m = effective(block, page);
      var line = m === "lock" ? "<locked>" + text + "</locked>" : m === "ref" ? "<ref>" + text + "</ref>" : text;
      if (m === "ref") refs.push(text);
      parts.push(line);
      total += line.length;
    });
    return { text: parts.join("\n").slice(0, max), refs: refs };
  }

  // The same blocks without any mark (exports, shares): marks are the editing person's metadata.
  function stripMarks(blocks) {
    return blocks.map(function (block) {
      if (!block.meta || (!("ai" in block.meta) && !("aiSpans" in block.meta) && !runsOf(block))) return block;
      var meta = Object.assign({}, block.meta);
      delete meta.ai; delete meta.aiSpans;
      if (Array.isArray(meta.richText)) meta.richText = meta.richText.map(function (run) { if (!run || !run.ai) return run; var r = Object.assign({}, run); delete r.ai; return r; });
      return Object.assign({}, block, { meta: Object.keys(meta).length ? meta : null });
    });
  }

  function any(blocks, page) {
    if (pageDefault(page) !== "edit") return true;
    return blocks.some(function (block) { return (block.meta && mark(block.meta.ai)) || spans(block).length > 0; });
  }

  root.AiMarks = { MARKS: MARKS, DEFAULTS: DEFAULTS, LABELS: LABELS, mark: mark, pageDefault: pageDefault, smartMark: smartMark,
    effective: effective, spans: spans, spanTexts: spanTexts, cleanTextSpans: cleanTextSpans, keptTexts: keptTexts, keepsSpans: keepsSpans, withSpans: withSpans, guard: guard,
    blocked: blocked, promptContext: promptContext, any: any, similarity: similarity, stripMarks: stripMarks };
})(typeof window !== "undefined" ? window : globalThis);
