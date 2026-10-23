(function () {
  var canvas = document.getElementById("graph-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var search = document.getElementById("graph-q");
  var aroundBox = document.getElementById("graph-around");
  var depthBox = document.getElementById("graph-depth");
  var status = document.getElementById("graph-status");
  var params = new URLSearchParams(location.search);
  var current = params.get("around") || "";
  var nodes = [], edges = [], bySlug = {};
  var LABEL_PX = 14, PAD = 24;
  var view = { x: 0, y: 0, l: 1, r: 1, u: 1, d: 1 }, order = [], pull = { x: 0.01, y: 0.01 }, userMoved = false, frameId = 0;
  var frame = 0, ticks = 0, query = "", colors = {}, font = "sans-serif";
  var pointers = {}, drag = null, pinch = 0, moved = false;

  aroundBox.checked = Boolean(current);
  aroundBox.disabled = depthBox.disabled = !current;
  depthBox.checked = params.get("depth") === "2";

  function token(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function readColors() {
    colors = { text: token("--color-text"), dim: token("--color-text-dim"), line: token("--color-border"), accent: token("--color-accent"), bg: token("--color-surface") };
    font = getComputedStyle(canvas).fontFamily || "sans-serif";
  }

  // On phones the canvas ends above the bottom tab bar, whatever sits above it (a banner, a wrapped toolbar).
  function size() {
    var ratio = window.devicePixelRatio || 1, bar = document.querySelector(".thumbbar");
    canvas.style.height = "";
    var box = canvas.getBoundingClientRect();
    if (bar && getComputedStyle(bar).display !== "none") {
      var room = bar.getBoundingClientRect().top - 12 - box.top;
      if (room >= 300 && room < box.height) { canvas.style.height = room + "px"; box = canvas.getBoundingClientRect(); }
    }
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!userMoved) fit();
    draw();
  }

  function load() {
    var url = "/api/graph";
    if (current && aroundBox.checked) url += "?around=" + encodeURIComponent(current) + "&depth=" + (depthBox.checked ? 2 : 1);
    status.textContent = "불러오는 중…";
    fetch(url, { headers: { accept: "application/json" } }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 404 ? "페이지를 찾지 못했어요." : "그래프를 불러오지 못했어요.");
      return res.json();
    }).then(start, function (error) { status.textContent = error.message; nodes = []; edges = []; draw(); });
  }

  // The current page is pinned at the origin and kept at the canvas centre. Gravity is weaker along the long side of
  // the canvas so the layout takes its shape, and the view keeps fitting until the user pans or zooms: each side of the
  // current page (left, right, up, down) has its own scale, so both halves reach the canvas edge.
  function start(data) {
    var box = canvas.getBoundingClientRect();
    var n = data.nodes.length, aspect = box.height / Math.max(1, box.width);
    bySlug = {};
    nodes = data.nodes.map(function (node) {
      var item = { slug: node.slug, title: node.title, links: node.links, x: 0, y: 0, vx: 0, vy: 0, here: node.slug === current, kids: [] };
      item.r = 4 + Math.min(10, Math.sqrt(node.links) * 2);
      bySlug[node.slug] = item;
      return item;
    });
    edges = data.edges.map(function (edge) { return [bySlug[edge[0]], bySlug[edge[1]]]; }).filter(function (edge) { return edge[0] && edge[1]; });
    seed(aspect);
    order = nodes.slice().sort(function (a, b) { return (b.here - a.here) || (b.links - a.links); });
    pull = { x: 0.01 * Math.sqrt(aspect), y: 0.01 / Math.sqrt(aspect) };
    measure();
    view = { x: box.width / 2, y: box.height / 2, l: 1, r: 1, u: 1, d: 1 };
    userMoved = false;
    status.textContent = n ? "페이지 " + n + "개 · 연결 " + edges.length + "개" : "보여 줄 페이지가 없어요.";
    ticks = 0;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(step);
  }

  // Start as a radial tree: the current page (else the most linked page) in the middle, each page one ring further out
  // than the page it was reached from, inside its parent's slice of the circle (slices sized by subtree), and pages
  // with no path on the outer ring. Linked pages start close, so the forces settle without long crossing links.
  function seed(aspect) {
    var root = bySlug[current] || nodes.slice().sort(function (a, b) { return b.links - a.links; })[0], seen = {}, queue = [root], i, j;
    if (!root) return;
    var next = {};
    for (i = 0; i < edges.length; i++) {
      (next[edges[i][0].slug] || (next[edges[i][0].slug] = [])).push(edges[i][1]);
      (next[edges[i][1].slug] || (next[edges[i][1].slug] = [])).push(edges[i][0]);
    }
    seen[root.slug] = true; root.depth = 0;
    for (i = 0; i < queue.length; i++) {
      var list = next[queue[i].slug] || [];
      for (j = 0; j < list.length; j++) if (!seen[list[j].slug]) { seen[list[j].slug] = true; list[j].depth = queue[i].depth + 1; queue[i].kids.push(list[j]); queue.push(list[j]); }
    }
    for (i = queue.length - 1; i >= 0; i--) { queue[i].size = 1; for (j = 0; j < queue[i].kids.length; j++) queue[i].size += queue[i].kids[j].size; }
    var lone = nodes.filter(function (node) { return !seen[node.slug]; }), outer = queue[queue.length - 1].depth + 1;
    function place(node, from, to) {
      var angle = (from + to) / 2, ring = node.depth * 110;
      node.x = Math.cos(angle) * ring; node.y = Math.sin(angle) * ring * aspect;
      for (var k = 0, at = from; k < node.kids.length; k++) { var span = (to - from) * node.kids[k].size / Math.max(1, node.size - 1); place(node.kids[k], at, at + span); at += span; }
    }
    place(root, 0, Math.PI * 2);
    for (i = 0; i < lone.length; i++) { var a = i * 2.399963; lone[i].x = Math.cos(a) * outer * 110; lone[i].y = Math.sin(a) * outer * 110 * aspect; }
  }

  function measure() {
    ctx.font = LABEL_PX + "px " + font;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      node.label = node.title.length > 24 ? node.title.slice(0, 23) + "…" : node.title;
      node.short = node.title.length > 9 ? node.title.slice(0, 8) + "…" : "";
      node.w = ctx.measureText(node.label).width;
      node.ws = node.short ? ctx.measureText(node.short).width : 0;
    }
  }

  function repel(a, b, alpha) {
    var dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01, f = 3000 / d2 * alpha / Math.sqrt(d2);
    a.vx += dx * f; a.vy += dy * f;
  }

  function tick() {
    var n = nodes.length, alpha = 1 - ticks / 300, i, j, a, b, dx, dy, d, f, here = bySlug[current];
    if (n <= 400) {
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (i !== j) repel(nodes[i], nodes[j], alpha);
    } else {
      var cell = 160, grid = {};
      for (i = 0; i < n; i++) {
        a = nodes[i];
        var key = Math.floor(a.x / cell) + "," + Math.floor(a.y / cell);
        (grid[key] || (grid[key] = [])).push(a);
      }
      for (i = 0; i < n; i++) {
        a = nodes[i];
        var gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
        for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
          var list = grid[(gx + ox) + "," + (gy + oy)];
          if (list) for (j = 0; j < list.length; j++) if (list[j] !== a) repel(a, list[j], alpha);
        }
      }
    }
    for (i = 0; i < edges.length; i++) {
      a = edges[i][0]; b = edges[i][1];
      dx = b.x - a.x; dy = b.y - a.y; d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      f = (d - 110) * 0.04 * alpha / d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (i = 0; i < n; i++) {
      a = nodes[i];
      if (a.here) { a.x = a.y = a.vx = a.vy = 0; continue; }
      a.vx -= a.x * pull.x * alpha; a.vy -= a.y * pull.y * alpha;
      a.vx *= 0.6; a.vy *= 0.6;
      a.x += Math.max(-20, Math.min(20, a.vx)); a.y += Math.max(-20, Math.min(20, a.vy));
      if (here) clear(a, here);
    }
    ticks++;
  }

  // Other nodes keep out of a disc around the current page on screen, big enough for its label under it.
  function clear(a, here) {
    var px = a.x * (a.x > 0 ? view.r : view.l), py = a.y * (a.y > 0 ? view.d : view.u), d = Math.hypot(px, py);
    var room = Math.hypot((here.w || 0) / 2 + 4, here.r + 3 + 3 + LABEL_PX + 4) + a.r;
    if (d >= room) return;
    if (d < 0.01) { a.x = 1; a.y = 0; return; }
    a.x *= room / d; a.y *= room / d;
  }

  function step() {
    for (var i = 0; i < 3 && ticks < 300; i++) tick();
    if (!userMoved) fit();
    draw();
    frame = ticks < 300 ? requestAnimationFrame(step) : 0;
  }

  // Scale so every node (and, in a small graph, its label to the right) stays PAD inside the canvas. With a current
  // page the centre stays on it and each side gets the largest scale that keeps its nodes inside; sides stay within
  // 3x of each other and never above 4x.
  function fit() {
    if (!nodes.length) return;
    var box = canvas.getBoundingClientRect(), W = box.width, H = box.height, i, node;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, centred = Boolean(bySlug[current]);
    for (i = 0; i < nodes.length; i++) {
      node = nodes[i];
      minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x); minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
    }
    var cx = centred ? 0 : (minX + maxX) / 2, cy = centred ? 0 : (minY + maxY) / 2, k = { l: Infinity, r: Infinity, u: Infinity, d: Infinity }, wide = nodes.length <= 60;
    for (i = 0; i < nodes.length; i++) {
      node = nodes[i];
      var dx = node.x - cx, dy = node.y - cy, r = node.r * 1.6 + (node.here ? 3 : 0);
      if (dx > 0.5) k.r = Math.min(k.r, Math.max(1, W / 2 - PAD - r - (wide ? 5 + node.w : 0)) / dx);
      if (dx < -0.5) k.l = Math.min(k.l, Math.max(1, W / 2 - PAD - r) / -dx);
      if (dy > 0.5) k.d = Math.min(k.d, Math.max(1, H / 2 - PAD - r - LABEL_PX) / dy);
      if (dy < -0.5) k.u = Math.min(k.u, Math.max(1, H / 2 - PAD - r) / -dy);
    }
    var low = Math.min(k.l, k.r, k.u, k.d);
    if (low === Infinity) low = 1;
    for (var side in k) view[side] = Math.max(0.05, Math.min(k[side], 3 * low, 4));
    view.x = W / 2 - cx * (cx > 0 ? view.r : view.l);
    view.y = H / 2 - cy * (cy > 0 ? view.d : view.u);
  }

  function sx(node) { return view.x + node.x * (node.x > 0 ? view.r : view.l); }
  function sy(node) { return view.y + node.y * (node.y > 0 ? view.d : view.u); }
  function radius(node) { return node.r * Math.max(0.7, Math.min(1.6, Math.sqrt(Math.min(view.l, view.r) * Math.min(view.u, view.d)))) + (node.here ? 3 : 0); }

  function matches(node) { return query && node.title.toLowerCase().indexOf(query) !== -1; }

  // Labels are LABEL_PX on screen at any zoom. In priority order (current page, search hits, most links) each label
  // takes the first free spot around its node - below right, below left, under, above - that stays inside the canvas
  // and clear of every node and placed label; if the whole title fits nowhere a shortened one is tried, else it is
  // hidden. Zooming in spreads the nodes, so more labels find room. Boxes are kept in a 64 px grid.
  function placeLabels(W, H) {
    var cell = 64, grid = {}, placed = [], i, node;
    function cells(box, add) {
      for (var gx = Math.floor(box[0] / cell); gx <= Math.floor(box[2] / cell); gx++) for (var gy = Math.floor(box[1] / cell); gy <= Math.floor(box[3] / cell); gy++) {
        var key = gx + "," + gy, list = grid[key];
        if (add) (list || (grid[key] = [])).push(box);
        else if (list) for (var j = 0; j < list.length; j++) {
          var o = list[j];
          if (box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]) return true;
        }
      }
      return false;
    }
    function free(box) { return box[0] >= 1 && box[1] >= 1 && box[2] <= W - 1 && box[3] <= H - 1 && !cells(box, false); }
    for (i = 0; i < nodes.length; i++) {
      node = nodes[i];
      node.sx = sx(node); node.sy = sy(node); node.sr = radius(node);
      if (node.sx > -node.sr && node.sx < W + node.sr && node.sy > -node.sr && node.sy < H + node.sr) cells([node.sx - node.sr - 1, node.sy - node.sr - 1, node.sx + node.sr + 1, node.sy + node.sr + 1], true);
    }
    var list = order.filter(matches).concat(order);
    for (i = 0; i < list.length; i++) {
      node = list[i];
      if (node.placed === frameId || node.sx < 0 || node.sx > W || node.sy < 0 || node.sy > H) continue;
      node.placed = frameId;
      var texts = node.short ? [[node.label, node.w], [node.short, node.ws]] : [[node.label, node.w]];
      for (var t = 0; t < texts.length; t++) {
        var w = texts[t][1], r = node.sr, x = node.sx, y = node.sy, half = LABEL_PX / 2 + 1, low = y + r * 0.6 + 3;
        var spots = [[x + r + 4, low], [x - r - 4 - w, low], [x - w / 2, y + r + 3 + half], [x - w / 2, y - r - 3 - half]];
        if (node.here) spots.unshift(spots.splice(2, 1)[0]);
        var hit = null;
        for (var s = 0; s < spots.length && !hit; s++) {
          var box = [spots[s][0] - 1, spots[s][1] - half, spots[s][0] + w + 1, spots[s][1] + half];
          if (free(box)) hit = [spots[s][0], spots[s][1], box];
        }
        if (hit) { cells(hit[2], true); placed.push([node, texts[t][0], hit[0], hit[1]]); break; }
      }
    }
    return placed;
  }

  function draw() {
    var box = canvas.getBoundingClientRect(), i;
    frameId++;
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.line;
    ctx.beginPath();
    for (i = 0; i < edges.length; i++) { ctx.moveTo(sx(edges[i][0]), sy(edges[i][0])); ctx.lineTo(sx(edges[i][1]), sy(edges[i][1])); }
    ctx.stroke();
    ctx.strokeStyle = colors.dim;
    ctx.beginPath();
    for (i = 0; i < edges.length; i++) if (edges[i][0].here || edges[i][1].here) { ctx.moveTo(sx(edges[i][0]), sy(edges[i][0])); ctx.lineTo(sx(edges[i][1]), sy(edges[i][1])); }
    ctx.stroke();
    var labels = placeLabels(box.width, box.height);
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i], hit = matches(node);
      ctx.fillStyle = hit || node.here ? colors.accent : colors.dim;
      ctx.globalAlpha = query && !hit ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(node.sx, node.sy, node.sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = LABEL_PX + "px " + font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = colors.bg;
    for (i = 0; i < labels.length; i++) {
      var item = labels[i], lit = matches(item[0]) || item[0].here;
      ctx.fillStyle = lit ? colors.accent : colors.text;
      ctx.globalAlpha = query && !matches(item[0]) ? 0.35 : 1;
      ctx.strokeText(item[1], item[2], item[3]);
      ctx.fillText(item[1], item[2], item[3]);
    }
    ctx.globalAlpha = 1;
  }

  function local(event) {
    var box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function nodeAt(point) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var dx = sx(nodes[i]) - point.x, dy = sy(nodes[i]) - point.y, d = dx * dx + dy * dy, reach = radius(nodes[i]) + 8;
      if (d < reach * reach && d < bestD) { best = nodes[i]; bestD = d; }
    }
    return best;
  }

  function zoom(point, factor) {
    var big = Math.max(view.l, view.r, view.u, view.d), f = Math.max(0.05, Math.min(6, big * factor)) / big;
    view.x = point.x - (point.x - view.x) * f;
    view.y = point.y - (point.y - view.y) * f;
    view.l *= f; view.r *= f; view.u *= f; view.d *= f;
    userMoved = true;
    draw();
  }

  function spread() {
    var list = Object.keys(pointers).map(function (id) { return pointers[id]; });
    return list.length < 2 ? null : { d: Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y), x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 };
  }

  canvas.addEventListener("pointerdown", function (event) {
    canvas.setPointerCapture(event.pointerId);
    pointers[event.pointerId] = local(event);
    var two = spread();
    if (two) { pinch = two.d; drag = null; } else { drag = pointers[event.pointerId]; moved = false; }
  });
  canvas.addEventListener("pointermove", function (event) {
    if (!pointers[event.pointerId]) return;
    var point = local(event);
    pointers[event.pointerId] = point;
    var two = spread();
    if (two) {
      if (pinch) zoom(two, two.d / pinch);
      pinch = two.d;
      moved = true;
    } else if (drag) {
      if (Math.abs(point.x - drag.x) + Math.abs(point.y - drag.y) > 3) moved = true;
      view.x += point.x - drag.x; view.y += point.y - drag.y;
      if (moved) userMoved = true;
      drag = point;
      draw();
    }
  });
  function release(event) {
    var point = pointers[event.pointerId];
    delete pointers[event.pointerId];
    if (Object.keys(pointers).length) return;
    pinch = 0;
    if (drag && !moved && event.type === "pointerup") {
      var node = nodeAt(point);
      if (node) location.href = "/" + encodeURIComponent(node.slug) + "/";
    }
    drag = null;
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    zoom(local(event), event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  canvas.addEventListener("pointerover", function () { canvas.style.cursor = "grab"; });

  search.addEventListener("input", function () {
    query = search.value.trim().toLowerCase();
    var hit = query && nodes.filter(matches)[0];
    if (hit) {
      var box = canvas.getBoundingClientRect();
      view.x = box.width / 2 - hit.x * (hit.x > 0 ? view.r : view.l);
      view.y = box.height / 2 - hit.y * (hit.y > 0 ? view.d : view.u);
      userMoved = true;
    }
    draw();
  });
  search.addEventListener("keydown", function (event) {
    var hit = event.key === "Enter" && query && nodes.filter(matches)[0];
    if (hit) location.href = "/" + encodeURIComponent(hit.slug) + "/";
  });
  aroundBox.addEventListener("change", function () { depthBox.disabled = !aroundBox.checked; load(); });
  depthBox.addEventListener("change", load);
  window.addEventListener("resize", size);
  if (window.ResizeObserver) new ResizeObserver(function () { size(); }).observe(document.getElementById("main") || document.body);
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { readColors(); draw(); });
  new MutationObserver(function () { readColors(); draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });

  readColors();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); if (!userMoved) fit(); draw(); });
  size();
  load();
})();
