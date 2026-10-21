(function (root) {
  "use strict";

  // Columns as blocks (notion-parity C13). A page stays one flat block array:
  //   {type:"columns", indent:d, meta:{widths:[..]}}
  //   {type:"column", indent:d+1}          one per column
  //   ...that column's blocks at indent d+2 and deeper
  // The old form kept only text: {type:"columns", meta:{columns:[{text}]}}. It is converted on read (columnsFromLegacy)
  // and never written. The same rules run in the editor, the reader, markdown and the server.

  var MAX_COLUMNS_DEPTH = 2; // indent is cut to 0..6 on the server: columns 2 + column 3 + child 4, one nested level from 0
  var MAX_BLOCKS = 2000;

  function isBlock(block) { return !!block && typeof block === "object"; }
  function depth(block) { return isBlock(block) ? Math.max(0, Math.trunc(Number(block.indent) || 0)) : 0; }
  function endOf(blocks, index) {
    var end = index + 1;
    while (end < blocks.length && depth(blocks[end]) > depth(blocks[index])) end += 1;
    return end;
  }
  function withIndent(block, indent) {
    if (!isBlock(block) || depth(block) === indent) return block;
    var copy = {};
    Object.keys(block).forEach(function (key) { copy[key] = block[key]; });
    copy.indent = indent;
    return copy;
  }

  function isLegacy(block) {
    return isBlock(block) && block.type === "columns" && !!block.meta && Array.isArray(block.meta.columns);
  }
  function legacyText(column) {
    if (typeof column === "string") return column;
    return isBlock(column) && typeof column.text === "string" ? column.text : "";
  }
  function equalWidths(count) {
    var out = [];
    for (var i = 0; i < count; i += 1) out.push(Math.round(10000 / count) / 10000);
    return out;
  }
  // Deterministic short id: "c" + 12 base36 characters from two 32-bit FNV-1a passes.
  function shortHash(text) {
    var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193) >>> 0;
      b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
      b ^= b >>> 13;
    }
    return ("000000" + a.toString(36)).slice(-6) + ("000000" + (b >>> 0).toString(36)).slice(-6);
  }
  function freshId(seed, taken) {
    var base = "c" + shortHash(seed), id = base, n = 2;
    while (taken.has(id)) { id = base + "-" + n; n += 1; }
    taken.add(id);
    return id;
  }

  // Old text-only columns -> columns + column + paragraph blocks. The columns block keeps its id; every text line
  // becomes one paragraph (lines joined back give the same text). Blocks already under the old columns block move
  // into its last column. If the page would pass 2000 blocks, each column becomes one paragraph holding its whole
  // text; if even that does not fit, the old block stays as it is (the reader still draws it, nothing is lost).
  function columnsFromLegacy(blocks) {
    if (!Array.isArray(blocks) || !blocks.some(isLegacy)) return blocks;
    var taken = new Set();
    blocks.forEach(function (block) { if (isBlock(block) && typeof block.id === "string") taken.add(block.id); });
    var out = [], total = blocks.length;
    for (var index = 0; index < blocks.length; index += 1) {
      var block = blocks[index];
      if (!isLegacy(block)) { out.push(block); continue; }
      var end = endOf(blocks, index);
      var d = depth(block);
      var texts = block.meta.columns.map(legacyText);
      if (!texts.length) texts = ["", ""];
      var perLine = texts.reduce(function (sum, text) { return sum + 1 + (text ? text.split("\n").length : 0); }, 0);
      var perColumn = texts.reduce(function (sum, text) { return sum + 1 + (text ? 1 : 0); }, 0);
      var mode = total + perLine <= MAX_BLOCKS ? "line" : total + perColumn <= MAX_BLOCKS ? "column" : "keep";
      if (mode === "keep") { for (var k = index; k < end; k += 1) out.push(blocks[k]); index = end - 1; continue; }
      total += mode === "line" ? perLine : perColumn;
      var meta = {};
      Object.keys(block.meta).forEach(function (key) { if (key !== "columns") meta[key] = block.meta[key]; });
      if (!Array.isArray(meta.widths) || meta.widths.length !== texts.length) meta.widths = equalWidths(texts.length);
      var head = {};
      Object.keys(block).forEach(function (key) { head[key] = block[key]; });
      head.text = "";
      head.meta = meta;
      out.push(head);
      var seed = String(block.id || "columns-" + index);
      texts.forEach(function (text, ci) {
        out.push({ id: freshId(seed + ":" + ci, taken), type: "column", text: "", checked: false, indent: d + 1, meta: null });
        var lines = !text ? [] : mode === "line" ? text.split("\n") : [text];
        lines.forEach(function (line, li) {
          out.push({ id: freshId(seed + ":" + ci + ":" + li, taken), type: "paragraph", text: line, checked: false, indent: d + 2, meta: null });
        });
      });
      for (var c = index + 1; c < end; c += 1) out.push(withIndent(blocks[c], depth(blocks[c]) + 1));
      index = end - 1;
    }
    return out;
  }

  // The column boundaries of the columns block at index: [{index, start, end}] where start..end are its blocks.
  function columnGroups(blocks, index) {
    var groups = [];
    if (!Array.isArray(blocks) || !isBlock(blocks[index])) return groups;
    var end = endOf(blocks, index), d = depth(blocks[index]);
    for (var i = index + 1; i < end; i = endOf(blocks, i)) {
      if (depth(blocks[i]) === d + 1 && blocks[i].type === "column") groups.push({ index: i, start: i + 1, end: endOf(blocks, i) });
    }
    return groups;
  }

  // Whole-page structure rules, for a complete ordered block list only:
  // 1. a columns block sits at indent 0..2; a deeper one moves up with its whole branch;
  // 2. a block directly under a columns block that is not a column moves into the column before it (a first one
  //    gets a new column), so the reader never hides it;
  // 3. a column whose parent is not a columns block is dropped and its blocks move up one level (never lost).
  // Returns the same array when nothing changes; changed blocks are new objects.
  function clampColumnsDepth(blocks) {
    if (!Array.isArray(blocks)) return blocks;
    var out = null, i, j;
    for (i = 0; i < blocks.length; i += 1) {
      var list = out || blocks;
      var block = list[i];
      if (!isBlock(block) || block.type !== "columns" || depth(block) <= MAX_COLUMNS_DEPTH) continue;
      out = out || blocks.slice();
      var end = endOf(out, i), offset = MAX_COLUMNS_DEPTH - depth(block);
      for (j = i; j < end; j += 1) out[j] = withIndent(out[j], depth(out[j]) + offset);
    }
    for (i = 0; i < (out || blocks).length; i += 1) {
      var host = (out || blocks)[i];
      if (!isBlock(host) || host.type !== "columns") continue;
      var hostEnd = endOf(out || blocks, i), lastColumn = -1;
      for (j = i + 1; j < hostEnd; j = endOf(out || blocks, j)) {
        var direct = (out || blocks)[j];
        if (depth(direct) !== depth(host) + 1) break;
        if (direct.type === "column") { lastColumn = j; continue; }
        out = out || blocks.slice();
        if (lastColumn < 0) {
          var taken = new Set(out.map(function (b) { return isBlock(b) ? b.id : null; }));
          out.splice(j, 0, { id: freshId(String(host.id) + ":col", taken), type: "column", text: "", checked: false, indent: depth(host) + 1, meta: null });
          hostEnd += 1;
          lastColumn = j;
          continue;
        }
        var strayEnd = endOf(out, j);
        for (var s = j; s < strayEnd; s += 1) out[s] = withIndent(out[s], depth(out[s]) + 1);
      }
    }
    for (i = 0; i < (out || blocks).length; i += 1) {
      var cur = out || blocks;
      var col = cur[i];
      if (!isBlock(col) || col.type !== "column") continue;
      var parent = null;
      for (j = i - 1; j >= 0; j -= 1) if (depth(cur[j]) < depth(col)) { parent = cur[j]; break; }
      if (parent && parent.type === "columns" && depth(parent) === depth(col) - 1) continue;
      out = out || blocks.slice();
      var stop = endOf(out, i);
      for (j = i + 1; j < stop; j += 1) out[j] = withIndent(out[j], depth(out[j]) - 1);
      out.splice(i, 1);
      i -= 1;
    }
    return out || blocks;
  }

  function parentOf(blocks, index) {
    for (var i = index - 1; i >= 0; i -= 1) if (depth(blocks[i]) < depth(blocks[index])) return blocks[i];
    return null;
  }

  // Whether Tab (delta 1) or Shift+Tab (delta -1) may change the block's depth without breaking columns: a column and
  // a block directly in a column stay where they are, nothing goes deeper than 6, and nothing becomes a direct child
  // of a columns block or a columns block deeper than 2.
  function canIndent(blocks, index, delta) {
    var block = blocks[index];
    if (!isBlock(block) || block.type === "column") return false;
    var parent = parentOf(blocks, index);
    if (delta < 0) return !(parent && parent.type === "column");
    var end = endOf(blocks, index), deepest = 0;
    for (var i = index; i < end; i += 1) deepest = Math.max(deepest, depth(blocks[i]));
    if (deepest + 1 > 6) return false;
    if (block.type === "columns" && depth(block) + 1 > MAX_COLUMNS_DEPTH) return false;
    for (var j = index - 1; j >= 0; j -= 1) {
      if (depth(blocks[j]) === depth(block)) return blocks[j].type !== "columns";
      if (depth(blocks[j]) < depth(block)) return true;
    }
    return true;
  }

  // Every column holds at least one block: an empty column gets an empty paragraph. Returns the same array when
  // every column already has a block.
  function fillColumns(blocks, makeBlock) {
    var out = null;
    for (var i = blocks.length - 1; i >= 0; i -= 1) {
      if (!isBlock(blocks[i]) || blocks[i].type !== "column" || endOf(blocks, i) > i + 1) continue;
      out = out || blocks.slice();
      var filler = makeBlock();
      filler.indent = depth(blocks[i]) + 1;
      out.splice(i + 1, 0, filler);
    }
    return out || blocks;
  }

  // The column a block sits in directly (its parent is a column), or null.
  function columnOf(blocks, index) {
    var parent = parentOf(blocks, index);
    return parent && parent.type === "column" ? parent : null;
  }

  // A new columns block for depth d: the block itself, n columns and one empty paragraph in each.
  function newColumns(d, n, makeBlock) {
    var top = Math.min(MAX_COLUMNS_DEPTH, Math.max(0, d));
    var head = makeBlock("columns");
    head.indent = top;
    head.meta = { widths: equalWidths(n) };
    var out = [head];
    for (var c = 0; c < n; c += 1) {
      var column = makeBlock("column");
      column.indent = top + 1;
      var para = makeBlock("paragraph");
      para.indent = top + 2;
      out.push(column, para);
    }
    return out;
  }

  // For each block, how many columns blocks it sits inside (markdown and Notion export write column children
  // without the 2 levels each enclosing columns adds).
  function columnsLevels(blocks) {
    var stack = [], out = [];
    blocks.forEach(function (block) {
      while (stack.length && depth(stack[stack.length - 1]) >= depth(block)) stack.pop();
      out.push(stack.filter(function (b) { return b.type === "columns"; }).length);
      stack.push(block);
    });
    return out;
  }

  root.ColumnsModel = {
    columnsLevels: columnsLevels,
    canIndent: canIndent,
    columnOf: columnOf,
    parentOf: parentOf,
    fillColumns: fillColumns,
    newColumns: newColumns,
    MAX_COLUMNS_DEPTH: MAX_COLUMNS_DEPTH,
    isLegacy: isLegacy,
    columnsFromLegacy: columnsFromLegacy,
    columnGroups: columnGroups,
    clampColumnsDepth: clampColumnsDepth,
    equalWidths: equalWidths,
  };
})(globalThis);
