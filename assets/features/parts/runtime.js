// Renderer of the five default parts (#38). It only ever runs inside a part frame: scripts/build-parts.ts turns this file
// into the PART_RUNTIME string in part-runtime.js. It is kept as text so no bundler can rewrite it (the worker bundle adds
// __name() calls that do not exist inside the frame). Every data string reaches the DOM through esc().
(function () {
  var css = "@font-face{font-family:'Acard Part';src:local('Pretendard Variable'),local('Pretendard'),local('Malgun Gothic'),local('Apple SD Gothic Neo'),local('Noto Sans KR');size-adjust:94.2%}:root{--font:'Acard Part',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--mono:ui-monospace,Consolas,monospace;--radius:10px;--radius-s:3px;--fs-12:12px;--fs-13:13px;--fs-14:14px;--fs-15:15px;--fs-21:21px;--fg:#26252c;--dim:#5f5d69;--line:#ececf0;--card:#fff;--soft:#f6f6f8;--acc:#6450dc;--bar:#86c5e8;--hi:#e0a63c;--ok-b:#e3f5ec;--ok-f:#1d7550;--warn-b:#fdf3d8;--warn-f:#7f590b;--stop-b:#fdeaec;--stop-f:#b13443;--wait-b:#efe9fd;--wait-f:#7048d6;--info-b:#e5f0fd;--info-f:#2563b8;color-scheme:light}"
    + ":root[data-theme=dark]{--fg:#ecebf2;--dim:#a3a1ad;--line:#31313a;--card:#1b1b20;--soft:#26262d;--acc:#a597ff;--bar:#5fa8d3;--hi:#f2c66b;--ok-b:#1f3a2e;--ok-f:#8ee0b5;--warn-b:#3f3520;--warn-f:#f2d38a;--stop-b:#45252b;--stop-f:#ffadb6;--wait-b:#322a52;--wait-f:#c7b6ff;--info-b:#1e3149;--info-f:#9cc6fb;color-scheme:dark}"
    + "@media (prefers-color-scheme:dark){:root:not([data-theme]){--fg:#ecebf2;--dim:#a3a1ad;--line:#31313a;--card:#1b1b20;--soft:#26262d;--acc:#a597ff;--bar:#5fa8d3;--hi:#f2c66b;--ok-b:#1f3a2e;--ok-f:#8ee0b5;--warn-b:#3f3520;--warn-f:#f2d38a;--stop-b:#45252b;--stop-f:#ffadb6;--wait-b:#322a52;--wait-f:#c7b6ff;--info-b:#1e3149;--info-f:#9cc6fb;color-scheme:dark}}"
    + "html,body{margin:0;background:var(--card);color:var(--fg);font-size:var(--fs-14);line-height:1.5;font-family:var(--font)}body{padding:2px 2px 4px}"
    + ".ap h4{margin:0 0 10px;font-size:var(--fs-15)}.cap{color:var(--dim);font-size:var(--fs-12);margin-top:8px}.row{display:flex;gap:10px;flex-wrap:wrap}"
    + ".cd{flex:1 1 140px;border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px;background:var(--soft)}.cd b{display:block;font-weight:650;font-size:var(--fs-21);line-height:1.3;font-family:var(--mono);margin:4px 0 2px}.cd span.l{color:var(--dim);font-size:var(--fs-13)}"
    + ".bd{display:inline-block;padding:1px 8px;border-radius:99px;font-size:var(--fs-12);background:var(--info-b);color:var(--info-f)}.bd.ok{background:var(--ok-b);color:var(--ok-f)}.bd.warn{background:var(--warn-b);color:var(--warn-f)}.bd.stop{background:var(--stop-b);color:var(--stop-f)}.bd.wait{background:var(--wait-b);color:var(--wait-f)}"
    + ".tw{overflow-x:auto}table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}td:not(.n){white-space:normal;min-width:5em;word-break:keep-all;overflow-wrap:break-word}th{color:var(--dim);font-weight:600;font-size:var(--fs-13)}.n{text-align:right;font-family:var(--mono)}tfoot td{font-weight:650;border-bottom:0}"
    + "svg{width:100%;height:auto;display:block}.hm{display:grid;gap:3px;align-items:center}.hm i{display:block;height:18px;border-radius:var(--radius-s)}.hm span{font-size:var(--fs-12);color:var(--dim);white-space:nowrap}"
    + ".nd rect{fill:var(--soft);stroke:var(--line)}.nd.done rect{fill:var(--ok-b);stroke:var(--ok-f)}.nd.doing rect{fill:var(--info-b);stroke:var(--info-f)}.nd.stop rect{fill:var(--stop-b);stroke:var(--stop-f)}.nd text{fill:var(--fg);font-size:var(--fs-13)}.ed{stroke:var(--dim);fill:none}"
    // dag (#58): step cards in dependency columns, arrows drawn over them after layout; stacked top-down when narrow.
    + ".fw{position:relative}.fl{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);column-gap:var(--gx,40px);align-items:stretch}.fl.st{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:minmax(0,1fr);row-gap:34px}"
    + ".fc{display:flex;flex-direction:column;gap:14px;min-width:0}.fl.st .fc{flex-direction:row;flex-wrap:wrap}.fl.st .fn{flex:1 1 150px}"
    + ".fn{flex:1 1 auto;position:relative;z-index:1;min-width:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--soft);padding:12px 13px;display:flex;flex-direction:column;gap:7px;font-size:var(--fs-13);line-height:1.5;word-break:keep-all;overflow-wrap:break-word}"
    + ".fn.done{border-color:var(--ok-f)}.fn.doing{border-color:var(--info-f);box-shadow:0 0 0 1px var(--info-f)}.fn.stop{border-color:var(--stop-f)}"
    + ".fn .no{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:99px;background:var(--acc);color:var(--card);font-weight:700;font-size:var(--fs-12);font-family:var(--mono)}"
    + ".fn b{display:block;font-size:var(--fs-15);font-weight:700;line-height:1.35;color:var(--fg)}.fn p{margin:0;color:var(--dim)}.fn ul{margin:0;padding-left:16px;color:var(--dim)}"
    + ".fn .tg{display:flex;flex-wrap:wrap;gap:4px}.fn .gt{margin-top:auto;padding-top:8px;border-top:1px solid var(--line);color:var(--fg);font-size:var(--fs-12)}.fn .gt:before{content:'\\2691  ';color:var(--acc)}"
    + ".t{display:inline-block;padding:1px 8px;border-radius:99px;font-size:var(--fs-12);line-height:1.6;background:var(--line);color:var(--fg)}.t.agent{background:var(--wait-b);color:var(--wait-f)}.t.api{background:var(--info-b);color:var(--info-f)}.t.lib{background:var(--ok-b);color:var(--ok-f)}.t.person{background:var(--warn-b);color:var(--warn-f)}.t.stop{background:var(--stop-b);color:var(--stop-f)}"
    + ".fe{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.fe path{stroke:var(--dim);stroke-width:1.5;fill:none}.fe .hd{fill:var(--dim);stroke:none}"
    + ".el{position:absolute;z-index:2;transform:translate(-50%,-50%);max-width:86px;padding:1px 4px;background:var(--card);color:var(--dim);font-size:var(--fs-12);line-height:1.3;text-align:center}"
    + ".co{margin-top:14px;border:1px dashed var(--hi);border-radius:var(--radius);padding:10px 14px;font-size:var(--fs-13);color:var(--fg)}.co:before{content:'\\21BB  ';color:var(--hi);font-weight:700}.co b{color:var(--hi)}";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nums(a) { return (a || []).filter(function (v) { return typeof v === "number" && isFinite(v); }); }
  function sum(a) { return nums(a).reduce(function (x, y) { return x + y; }, 0); }
  function avg(a) { var n = nums(a); return n.length ? sum(n) / n.length : 0; }
  function fmt(v, unit) { if (typeof v !== "number") return esc(v); var r = Math.round(v * 100) / 100; var s = r.toLocaleString("ko-KR", { maximumFractionDigits: 2 }); return unit === "$" ? "$" + s : esc(s + (unit || "")); }
  function pct(a, b) { return b ? (Math.round((a / b) * 1000) / 10) + "%" : "-"; }
  var parts = {
    badge: function (d) {
      return '<div class="row">' + (d.items || []).map(function (c) {
        var ratio = typeof c.of === "number" && typeof c.value === "number" ? '<span class="l"> / ' + fmt(c.of, c.unit) + " · " + pct(c.value, c.of) + "</span>" : "";
        return '<div class="cd">' + (c.badge ? '<span class="bd ' + esc(c.state || "info") + '">' + esc(c.badge) + "</span>" : "") + "<b>" + fmt(c.value, c.unit) + ratio + '</b><span class="l">' + esc(c.label) + "</span></div>";
      }).join("") + "</div>";
    },
    table: function (d) {
      var cols = d.columns || [], rows = d.rows || [], sums = d.sum || [], avgs = d.avg || [], ratio = typeof d.ratio === "number" ? d.ratio : -1;
      var col = function (i) { return rows.map(function (r) { return r[i]; }); };
      var total = ratio >= 0 ? sum(col(ratio)) : 0;
      var isNum = cols.map(function (_, i) { return i > 0 && nums(col(i)).length > 0; });
      var unitCols = d.unitCols || (ratio >= 0 ? [ratio] : []), unitCol = function (i) { return unitCols.indexOf(i) >= 0 ? d.unit : ""; };
      var head = "<tr>" + cols.map(function (c, i) { return '<th class="' + (isNum[i] ? "n" : "") + '">' + esc(c) + "</th>"; }).join("") + (ratio >= 0 ? '<th class="n">비중</th>' : "") + "</tr>";
      var body = rows.map(function (r) { return "<tr>" + cols.map(function (_, i) { return '<td class="' + (isNum[i] ? "n" : "") + '">' + fmt(r[i], unitCol(i)) + "</td>"; }).join("") + (ratio >= 0 ? '<td class="n">' + pct(typeof r[ratio] === "number" ? r[ratio] : 0, total) + "</td>" : "") + "</tr>"; }).join("");
      var foot = function (label, list, fn) { return list.length ? "<tr><td>" + label + "</td>" + cols.slice(1).map(function (_, k) { var i = k + 1; return '<td class="n">' + (list.indexOf(i) >= 0 ? fmt(fn(col(i)), unitCol(i)) : "") + "</td>"; }).join("") + (ratio >= 0 ? '<td class="n">' + (label === "합계" ? "100%" : "") + "</td>" : "") + "</tr>" : ""; };
      return '<div class="tw"><table><thead>' + head + "</thead><tbody>" + body + "</tbody><tfoot>" + foot("합계", sums, sum) + foot("평균", avgs, avg) + "</tfoot></table></div>";
    },
    chart: function (d) {
      var labels = d.labels || [], series = (d.series || []).slice(0, 4), all = [];
      series.forEach(function (s) { all = all.concat(nums(s.data)); });
      var max = Math.max.apply(null, all.concat([0])) || 1, w = 600, h = 180, top = 10, n = Math.max(1, labels.length), step = w / n;
      var colors = ["var(--bar)", "var(--acc)", "var(--hi)", "var(--ok-f)"];
      var y = function (v) { return top + h - (v / max) * h; };
      var out = '<svg viewBox="0 0 ' + w + " " + (h + top + 22) + '" role="img" aria-label="' + esc(d.title || "차트") + '">';
      for (var g = 0; g <= 4; g++) out += '<line x1="0" x2="' + w + '" y1="' + y((max * g) / 4) + '" y2="' + y((max * g) / 4) + '" stroke="var(--line)"/>';
      series.forEach(function (s, si) {
        var data = s.data || [];
        if (d.type === "line") {
          var pts = []; data.forEach(function (v, i) { if (typeof v === "number") pts.push((i * step + step / 2) + "," + y(v)); });
          out += '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + colors[si] + '" stroke-width="3" stroke-linejoin="round"/>';
        } else {
          var bw = (step * 0.7) / series.length;
          data.forEach(function (v, i) { if (typeof v !== "number") return; var x = i * step + step * 0.15 + bw * si; out += '<rect x="' + x + '" y="' + Math.min(y(v), y(0)) + '" width="' + Math.max(1, bw - 2) + '" height="' + Math.abs(y(0) - y(v)) + '" rx="3" fill="' + (series.length === 1 && v === max ? "var(--hi)" : colors[si]) + '"><title>' + esc(labels[i]) + ": " + fmt(v, d.unit) + "</title></rect>"; });
        }
      });
      var every = Math.ceil(n / 12);
      labels.forEach(function (l, i) { if (i % every === 0) out += '<text x="' + (i * step + step / 2) + '" y="' + (h + top + 16) + '" font-size="12" text-anchor="middle" fill="var(--dim)">' + esc(l) + "</text>"; });
      out += "</svg>";
      var first = series[0] ? series[0].data || [] : [], peak = first.indexOf(Math.max.apply(null, nums(first).concat([-Infinity])));
      var cap = series.map(function (s) { return (series.length > 1 ? esc(s.name || "") + " " : "") + "합계 " + fmt(sum(s.data), d.unit) + " · 평균 " + fmt(avg(s.data), d.unit); }).join(" / ");
      if (peak >= 0) cap += " · 최고 " + esc(labels[peak]) + " " + fmt(first[peak], d.unit);
      return out + '<div class="cap">' + cap + "</div>";
    },
    heatmap: function (d) {
      var rows = d.rows || [], cols = d.cols || [], values = d.values || [], all = [];
      values.forEach(function (r) { all = all.concat(nums(r)); });
      var max = Math.max.apply(null, all.concat([0])) || 1, best = { v: -Infinity, r: 0, c: 0 };
      var cell = function (v) { if (typeof v !== "number") return "repeating-linear-gradient(45deg,var(--line) 0 3px,transparent 3px 6px)"; var a = Math.max(0.12, v / max); return "color-mix(in srgb,var(--acc) " + Math.round(a * 100) + "%,var(--soft))"; };
      var out = '<div class="hm" style="grid-template-columns:auto repeat(' + cols.length + ',minmax(10px,1fr)) auto"><span></span>' + cols.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + '<span class="n">합계</span>';
      rows.forEach(function (r, ri) {
        var vals = values[ri] || [];
        out += "<span>" + esc(r) + "</span>" + cols.map(function (_, ci) { var v = vals[ci]; if (typeof v === "number" && v > best.v) best = { v: v, r: ri, c: ci }; return '<i style="background:' + cell(v) + '" title="' + esc(r + " " + cols[ci] + ": " + (typeof v === "number" ? v : "없음")) + '"></i>'; }).join("") + '<span class="n">' + fmt(sum(vals), d.unit) + "</span>";
      });
      out += "</div>";
      return out + (best.v > -Infinity ? '<div class="cap">전체 ' + fmt(sum(all), d.unit) + " · 가장 많은 칸 " + esc(rows[best.r] + " " + cols[best.c]) + " " + fmt(best.v, d.unit) + "</div>" : "");
    },
    // dag: each node is a card (number, label, desc, items, tags, gate) in the column of its dependency depth; edges
    // [from, to, label?] become arrows drawn by wire() once the cards are laid out. Narrow frames stack the columns.
    dag: function (d) {
      var nodes = d.nodes || [], edges = (d.edges || []).filter(function (e) { return e && e.length >= 2; }), rank = {};
      nodes.forEach(function (n) { rank[n.id] = 0; });
      for (var pass = 0; pass < nodes.length; pass++) { var moved = false; edges.forEach(function (e) { if (e[0] in rank && e[1] in rank && rank[e[1]] < rank[e[0]] + 1 && rank[e[0]] < nodes.length) { rank[e[1]] = rank[e[0]] + 1; moved = true; } }); if (!moved) break; }
      // A start node sits right before the first step it feeds (Houdini next to TouchDesigner, both feeding Unreal), so no
      // arrow has to cross a column of cards.
      nodes.forEach(function (n) {
        if (edges.some(function (e) { return e[1] === n.id; })) return;
        var next = edges.filter(function (e) { return e[0] === n.id && e[1] in rank; }).map(function (e) { return rank[e[1]]; });
        if (next.length) rank[n.id] = Math.max(rank[n.id], Math.min.apply(null, next) - 1);
      });
      var layers = []; nodes.forEach(function (n) { (layers[rank[n.id]] = layers[rank[n.id]] || []).push(n); });
      layers = layers.filter(Boolean);
      var labelled = edges.some(function (e) { return e[2]; });
      var card = function (n) {
        var tags = (n.tags || []).map(function (t) { var o = typeof t === "string" ? { text: t } : t || {}; return '<span class="t ' + esc(o.kind || "") + '">' + esc(o.text) + "</span>"; }).join("");
        return '<div class="fn ' + esc(n.state || "") + '" data-id="' + esc(n.id) + '">'
          + (d.numbered ? '<span class="no">' + (nodes.indexOf(n) + 1) + "</span>" : "")
          + "<b>" + esc(n.label || n.id) + "</b>"
          + (n.desc ? "<p>" + esc(n.desc) + "</p>" : "")
          + (n.items && n.items.length ? "<ul>" + n.items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>" : "")
          + (tags ? '<div class="tg">' + tags + "</div>" : "")
          + (n.gate ? '<div class="gt">' + esc(n.gate) + "</div>" : "") + "</div>";
      };
      var out = '<div class="fw" role="group" aria-label="' + esc(d.title || "흐름") + '" data-edges="' + esc(JSON.stringify(edges.map(function (e) { return [String(e[0]), String(e[1]), e[2] ? String(e[2]) : ""]; }))) + '"><div class="fl" data-cols="' + layers.length + '" style="--gx:' + (labelled ? 56 : 36) + 'px">'
        + layers.map(function (l) { return '<div class="fc">' + l.map(card).join("") + "</div>"; }).join("") + '</div><svg class="fe" aria-hidden="true"></svg></div>';
      if (d.callout && (d.callout.title || d.callout.text)) out += '<div class="co">' + (d.callout.title ? "<b>" + esc(d.callout.title) + "</b>: " : "") + esc(d.callout.text) + "</div>";
      var states = nodes.filter(function (n) { return n.state; }).length, done = nodes.filter(function (n) { return n.state === "done"; }).length;
      return out + (states ? '<div class="cap">완료 ' + done + " / " + nodes.length + " 단계 · " + pct(done, nodes.length) + "</div>" : "");
    },
  };
  var el = document.getElementById("acp-data"), box = document.getElementById("acp");
  var style = document.createElement("style"); style.textContent = css + ((typeof window !== "undefined" && window.acardPartTheme) || ""); document.head.appendChild(style);
  var d = {}; try { d = JSON.parse(el.textContent) || {}; } catch (e) { d = null; }
  var draw = parts[box.getAttribute("data-part")];
  if (!d || !draw) { box.innerHTML = '<p class="cap">이 부품을 그리지 못했어요.</p>'; return; }
  box.className = "ap";
  box.innerHTML = (d.title ? "<h4>" + esc(d.title) + "</h4>" : "") + draw(d) + (d.note ? '<div class="cap">' + esc(d.note) + "</div>" : "");
  if (box.querySelector && box.querySelector(".fw")) wire(box.querySelector(".fw"));

  // Arrows between dag cards, measured from the laid-out cards: right edge -> left edge across columns, bottom -> top when
  // the columns are stacked (a column needs about 120 px). Redrawn whenever the frame width changes.
  function wire(fw) {
    var fl = fw.querySelector(".fl"), svg = fw.querySelector(".fe"), list = [], lastW = -1;
    try { list = JSON.parse(fw.getAttribute("data-edges")) || []; } catch (e) { list = []; }
    var cols = +fl.getAttribute("data-cols") || 1, NS = "http://www.w3.org/2000/svg";
    function node(id) { var all = fl.querySelectorAll(".fn"); for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-id") === id) return all[i]; return null; }
    function draw() {
      var w = fw.clientWidth, gap = parseFloat(getComputedStyle(fl).getPropertyValue("--gx")) || 40;
      fl.classList.toggle("st", cols > 1 && w < cols * 120 + (cols - 1) * gap);
      var key = w + "x" + fw.clientHeight; if (key === lastW) return; lastW = key;
      var stacked = fl.classList.contains("st"), base = fw.getBoundingClientRect();
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      Array.prototype.forEach.call(fw.querySelectorAll(".el"), function (l) { l.remove(); });
      list.forEach(function (e) {
        var a = node(e[0]), b = node(e[1]); if (!a || !b) return;
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), x1, y1, x2, y2, path, hd;
        var o = function (r) { return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top }; };
        ra = o(ra); rb = o(rb);
        if (!stacked && rb.l >= ra.r - 1) {
          x1 = ra.r; y1 = (ra.t + ra.b) / 2; x2 = rb.l - 1; y2 = (rb.t + rb.b) / 2;
          if (Math.abs(y1 - y2) < 2) y2 = y1;
          var mx = (x1 + x2) / 2;
          path = "M" + x1 + " " + y1 + " C" + mx + " " + y1 + " " + mx + " " + y2 + " " + (x2 - 6) + " " + y2;
          hd = "M" + x2 + " " + y2 + " l-7 -4.5 v9 z";
        } else {
          x1 = (ra.l + ra.r) / 2; y1 = ra.b; x2 = (rb.l + rb.r) / 2; y2 = rb.t - 1;
          if (y2 <= y1) { y1 = ra.t; y2 = rb.b + 1; var my2 = (y1 + y2) / 2; path = "M" + x1 + " " + y1 + " C" + x1 + " " + my2 + " " + x2 + " " + my2 + " " + x2 + " " + (y2 + 6); hd = "M" + x2 + " " + y2 + " l-4.5 7 h9 z"; }
          else { var my = (y1 + y2) / 2; path = "M" + x1 + " " + y1 + " C" + x1 + " " + my + " " + x2 + " " + my + " " + x2 + " " + (y2 - 6); hd = "M" + x2 + " " + y2 + " l-4.5 -7 h9 z"; }
        }
        var p = document.createElementNS(NS, "path"); p.setAttribute("d", path); svg.appendChild(p);
        var h = document.createElementNS(NS, "path"); h.setAttribute("d", hd); h.setAttribute("class", "hd"); svg.appendChild(h);
        if (e[2]) { var l = document.createElement("div"); l.className = "el"; l.textContent = e[2]; l.style.left = (x1 + x2) / 2 + "px"; l.style.top = (stacked && y2 > y1 ? y2 - 15 : (y1 + y2) / 2) + "px"; fw.appendChild(l); }
      });
    }
    draw();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(function () { draw(); }).observe(fw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { lastW = -1; draw(); });
  }
})();
