(function (root) {
  "use strict";

  function depth(block) { return Math.max(0, Math.trunc(Number(block.indent) || 0)); }
  function endOf(blocks, index) {
    var end = index + 1;
    while (end < blocks.length && depth(blocks[end]) > depth(blocks[index])) end += 1;
    return end;
  }
  function children(blocks) {
    var roots = [], stack = [];
    blocks.forEach(function (block) {
      var node = { block: block, children: [] };
      while (stack.length && depth(stack[stack.length - 1].block) >= depth(block)) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
    });
    return roots;
  }
  function indent(blocks, index, delta) {
    if (index < 0 || index >= blocks.length) return false;
    var current = depth(blocks[index]);
    if (delta > 0 && (index === 0 || current > depth(blocks[index - 1]))) return false;
    if (delta < 0 && current === 0) return false;
    var end = endOf(blocks, index);
    for (var i = index; i < end; i += 1) blocks[i].indent = depth(blocks[i]) + delta;
    return true;
  }
  function move(blocks, index, target, targetDepth) {
    if (index < 0 || index >= blocks.length || target < 0 || target > blocks.length) return false;
    var end = endOf(blocks, index);
    if (target >= index && target <= end) return false;
    var branch = blocks.splice(index, end - index);
    var position = target > index ? target - branch.length : target;
    var maxDepth = position === 0 ? 0 : depth(blocks[position - 1]) + 1;
    var offset = Math.min(Math.max(0, targetDepth || 0), maxDepth) - depth(branch[0]);
    branch.forEach(function (block) { block.indent = depth(block) + offset; });
    blocks.splice.apply(blocks, [position, 0].concat(branch));
    return true;
  }
  function safeHref(value) {
    return typeof value === "string" && /^(https?:|mailto:|\/(?!\/)|#)[^\s\0-\x1f\x7f\\]*(?![^])/i.test(value) ? value : "";
  }
  var colors = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
  function richText(input, fallback) {
    if (!Array.isArray(input)) return [{ text: String(fallback || "") }];
    return input.filter(function (run) { return run && typeof run.text === "string"; }).map(function (run) {
      var out = { text: run.text };
      ["bold", "italic", "underline", "strike", "code"].forEach(function (mark) { if (run[mark] === true) out[mark] = true; });
      var href = safeHref(run.href);
      if (href) out.href = href;
      ["color", "background"].forEach(function (name) { if (colors.indexOf(run[name]) > 0) out[name] = run[name]; });
      if (run.mention && run.mention.type === "page" && typeof run.mention.slug === "string") out.mention = { type: "page", slug: run.mention.slug };
      if (run.mention && run.mention.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(run.mention.date)) out.mention = { type: "date", date: run.mention.date };
      return out;
    });
  }
  function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function richHtml(input, fallback) {
    return richText(input, fallback).map(function (run) {
      var html = escape(run.text).replace(/\n/g, "<br>");
      [["bold", "strong"], ["italic", "em"], ["underline", "u"], ["strike", "s"], ["code", "code"]].forEach(function (pair) {
        if (run[pair[0]]) html = "<" + pair[1] + ">" + html + "</" + pair[1] + ">";
      });
      var attrs = [];
      if (run.color) attrs.push('data-color="' + run.color + '"');
      if (run.background) attrs.push('data-background="' + run.background + '"');
      if (attrs.length) html = "<span " + attrs.join(" ") + ">" + html + "</span>";
      if (run.mention && run.mention.type === "page") html = '<a data-page="' + escape(run.mention.slug) + '" href="/' + encodeURIComponent(run.mention.slug) + '/">' + html + "</a>";
      else if (run.mention && run.mention.type === "date") html = '<time datetime="' + run.mention.date + '">' + html + "</time>";
      else if (run.href) html = '<a href="' + escape(run.href) + '" rel="noopener">' + html + "</a>";
      return html;
    }).join("");
  }
  function readRich(element) {
    var runs = [];
    function walk(node, marks) {
      if (node.nodeType === 3) { if (node.nodeValue) runs.push(Object.assign({ text: node.nodeValue }, marks)); return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === "BR") { runs.push(Object.assign({ text: "\n" }, marks)); return; }
      var next = Object.assign({}, marks);
      var tags = { B: "bold", STRONG: "bold", I: "italic", EM: "italic", U: "underline", S: "strike", STRIKE: "strike", CODE: "code" };
      if (tags[node.tagName]) next[tags[node.tagName]] = true;
      if (node.tagName === "A") next.href = node.getAttribute("href");
      if (node.dataset.color) next.color = node.dataset.color;
      if (node.dataset.background) next.background = node.dataset.background;
      if (node.dataset.page) next.mention = { type: "page", slug: node.dataset.page };
      if (node.tagName === "TIME") next.mention = { type: "date", date: node.getAttribute("datetime") };
      Array.from(node.childNodes).forEach(function (child) { walk(child, next); });
    }
    Array.from(element.childNodes).forEach(function (node) { walk(node, {}); });
    return richText(runs, "");
  }
  root.EditorModel = { depth: depth, endOf: endOf, children: children, indent: indent, move: move, safeHref: safeHref, richText: richText, richHtml: richHtml, readRich: readRich, colors: colors };
})(globalThis);
