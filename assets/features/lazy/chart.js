(function () {
  "use strict";

  var colors = ["#86dfe3", "#c4b2f4", "#94bff4", "#a4dcb9", "#f1c692", "#eab1cd"];
  var kinds = { bar: "막대", line: "선", donut: "도넛" };
  var aggregates = { count: "행 개수", sum: "합계", avg: "평균" };

  function chartModel(properties, rows, config, valuesOf) {
    var cfg = config || {};
    var categories = properties.filter(function (p) { return ["select", "status", "text", "title", "date"].indexOf(p.type) >= 0; });
    var category = categories.find(function (p) { return p.id === cfg.category; }) || (!cfg.category ? categories[0] : null);
    var number = properties.find(function (p) { return p.id === cfg.value && p.type === "number"; });
    var aggregation = aggregates[cfg.aggregation] ? cfg.aggregation : "count";
    var model = { kind: kinds[cfg.kind] ? cfg.kind : "bar", title: (category ? category.name : "분류") + "별 " + (aggregation === "count" ? aggregates.count : (number ? number.name + " " : "") + aggregates[aggregation]), points: [], category: category, number: number };
    if (!category || (aggregation !== "count" && !number)) return model;
    var groups = new Map();
    rows.forEach(function (row) {
      var values = valuesOf ? valuesOf(row) : (row.props || {});
      var value = values[category.id], key = value == null || value === "" ? "" : String(value), label = key || "없음";
      if (category.type === "date") {
        var day = typeof value === "object" && value ? value.start : value;
        var match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(String(day || ""));
        if (!match || !Number.isFinite(Date.parse(match[1])) || new Date(match[1]).toISOString().slice(0, 10) !== match[1]) return;
        key = match[1].slice(0, cfg.bucket === "month" ? 7 : 10);
        label = key;
      } else if (category.type === "select" || category.type === "status") {
        var option = ((category.config || {}).options || []).find(function (o) { return o.id === value; });
        label = option ? option.name : label;
      }
      var n = aggregation === "count" ? 1 : values[number.id];
      if (typeof n !== "number" || !Number.isFinite(n)) return;
      if (!groups.has(key)) groups.set(key, { key: key, label: label, value: 0, count: 0 });
      var group = groups.get(key);
      group.value += n;
      group.count++;
    });
    model.points = Array.from(groups.values()).map(function (g) {
      if (aggregation === "avg") g.value /= g.count;
      return g;
    }).filter(function (g) { return Number.isFinite(g.value); });
    if (category.type === "date") model.points.sort(function (a, b) { return a.key.localeCompare(b.key); });
    return model;
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; });
  }
  function format(value) { return Math.abs(value) >= 1e9 || (value !== 0 && Math.abs(value) < .001) ? value.toExponential(2) : Number(value.toPrecision(6)).toLocaleString("ko-KR", { maximumFractionDigits: 3 }); }

  function chartSvg(model) {
    var points = model.points, donut = model.kind === "donut";
    if (!points.length) return '<p class="ac-chart-empty" role="status">표시할 숫자 데이터가 없어요.</p>';
    if (donut && (points.some(function (p) { return p.value < 0; }) || !points.some(function (p) { return p.value > 0; }))) return '<p class="ac-chart-empty" role="status">도넛은 양수 합계가 필요해요. 음수는 막대나 선으로 보세요.</p>';
    var width = donut ? 400 : Math.max(400, points.length * 88 + 80);
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + escape(model.title) + '"' + (!donut && points.length > 6 ? ' style="min-width:' + width + 'px"' : '') + ' viewBox="0 0 ' + width + ' 340"><title>' + escape(model.title) + '</title>'];
    function tip(p) { return '<title>' + escape(p.label + ': ' + format(p.value)) + '</title>'; }
    if (donut) {
      var total = points.reduce(function (sum, p) { return sum + p.value; }, 0), angle = -Math.PI / 2;
      // Scale by the largest value so a finite collection cannot overflow its total.
      var max = Math.max.apply(null, points.map(function (p) { return p.value; }));
      var scaledTotal = points.reduce(function (sum, p) { return sum + p.value / max; }, 0);
      points.forEach(function (p, i) {
        if (!p.value) return;
        var span = (p.value / max) / scaledTotal * Math.PI * 2;
        var end = angle + span, mid = angle + span / 2;
        function pos(r, a) { return (200 + r * Math.cos(a)) + ' ' + (170 + r * Math.sin(a)); }
        var d = 'M ' + pos(120, angle) + ' A 120 120 0 0 1 ' + pos(120, mid) + ' A 120 120 0 0 1 ' + pos(120, end) + ' L ' + pos(78, end) + ' A 78 78 0 0 0 ' + pos(78, mid) + ' A 78 78 0 0 0 ' + pos(78, angle) + ' Z';
        out.push('<path class="ac-chart-arc" d="' + d + '" fill="' + colors[i % colors.length] + '">' + tip(p) + '</path>');
        angle = end;
      });
      if (Number.isFinite(total)) out.push('<text x="200" y="178" text-anchor="middle" font-size="24">' + escape(format(total)) + '</text>');
    } else {
      var lo = Math.min.apply(null, [0].concat(points.map(function (p) { return p.value; })));
      var hi = Math.max.apply(null, [0].concat(points.map(function (p) { return p.value; }))) || 1;
      var scale = Math.max(Math.abs(lo), Math.abs(hi));
      function y(v) { return 280 - ((v / scale - lo / scale) / (hi / scale - lo / scale)) * 230; }
      var step = (width - 80) / points.length;
      function x(i) { return 60 + step * (i + 0.5); }
      for (var tick = 0; tick <= 4; tick++) {
        var v = lo * (1 - tick / 4) + hi * (tick / 4), yy = y(v);
        out.push('<line x1="60" x2="' + (width - 20) + '" y1="' + yy + '" y2="' + yy + '" stroke="currentColor" opacity=".12"/><text x="52" y="' + (yy + 4) + '" text-anchor="end" font-size="11">' + escape(format(v)) + '</text>');
      }
      out.push('<line x1="60" x2="' + (width - 20) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="currentColor" opacity=".3"/>');
      if (model.kind === "line") out.push('<polyline fill="none" stroke="#7b68ee" stroke-width="3" points="' + points.map(function (p, i) { return x(i) + ',' + y(p.value); }).join(' ') + '"/>');
      points.forEach(function (p, i) {
        if (model.kind === "line") out.push('<circle class="ac-chart-point" cx="' + x(i) + '" cy="' + y(p.value) + '" r="5" fill="#7b68ee">' + tip(p) + '</circle>');
        else out.push('<rect class="ac-chart-bar" x="' + (x(i) - step * .3) + '" y="' + Math.min(y(0), y(p.value)) + '" width="' + step * .6 + '" height="' + Math.abs(y(p.value) - y(0)) + '" rx="4" fill="' + colors[i % colors.length] + '">' + tip(p) + '</rect>');
        out.push('<text x="' + x(i) + '" y="' + (y(p.value) + (p.value < 0 ? 17 : -12)) + '" text-anchor="middle" font-size="13">' + escape(format(p.value)) + '</text><text x="' + x(i) + '" y="312" text-anchor="middle" font-size="12">' + tip(p) + escape(p.label.length > 10 ? p.label.slice(0, 9) + '…' : p.label) + '</text>');
      });
    }
    out.push('</svg>');
    return out.join('');
  }

  function render(ctx) {
    var doc = ctx.doc, root = doc.createElement('section'), cfg = Object.assign({ kind: 'bar', aggregation: 'count', bucket: 'day' }, ctx.view.config.chart || {});
    root.className = 'ac-chart';
    var controls = doc.createElement('div');
    controls.className = 'ac-chart-controls';
    var output = doc.createElement('div');
    var status = doc.createElement('p');
    status.className = 'ac-chart-status';
    status.setAttribute('role', 'status');
    var categories = ctx.properties.filter(function (p) { return ['select', 'status', 'text', 'title', 'date'].indexOf(p.type) >= 0; });
    if (!cfg.category && categories.length) cfg.category = categories[0].id;
    var numbers = ctx.properties.filter(function (p) { return p.type === 'number'; });
    if (!cfg.value && numbers.length) cfg.value = numbers[0].id;
    function select(label, key, options) {
      var wrap = doc.createElement('label'), name = doc.createElement('span'), input = doc.createElement('select');
      name.textContent = label;
      input.setAttribute('aria-label', label);
      options.forEach(function (o) { var option = doc.createElement('option'); option.value = o[0]; option.textContent = o[1]; input.appendChild(option); });
      input.value = cfg[key];
      input.addEventListener('change', function () {
        var previous = Object.assign({}, cfg);
        cfg[key] = input.value;
        controls.querySelectorAll('select').forEach(function (s) { s.disabled = true; });
        status.textContent = '저장 중…';
        ctx.saveView({ chart: Object.assign({}, cfg) }).then(function (ok) {
          if (!ok) cfg = previous;
          status.textContent = ok ? '저장됨' : '차트 설정을 저장하지 못했어요.';
          draw();
        });
      });
      wrap.appendChild(name); wrap.appendChild(input); controls.appendChild(wrap);
    }
    function draw() {
      controls.replaceChildren();
      select('차트 종류', 'kind', Object.keys(kinds).map(function (k) { return [k, kinds[k]]; }));
      select('분류', 'category', categories.map(function (p) { return [p.id, p.name]; }));
      select('값', 'aggregation', Object.keys(aggregates).map(function (k) { return [k, aggregates[k]]; }));
      if (cfg.aggregation !== 'count') select('숫자 속성', 'value', numbers.map(function (p) { return [p.id, p.name]; }));
      if (categories.some(function (p) { return p.id === cfg.category && p.type === 'date'; })) select('날짜 단위', 'bucket', [['day', '일'], ['month', '월']]);
      var model = chartModel(ctx.properties, ctx.rows, cfg, ctx.values);
      output.replaceChildren();
      var title = doc.createElement('h3'); title.textContent = model.title; output.appendChild(title);
      var plot = doc.createElement('div'); plot.className = 'ac-chart-plot' + (cfg.kind === 'donut' ? ' is-donut' : ''); plot.tabIndex = 0;
      plot.setAttribute('role', 'region'); plot.setAttribute('aria-label', model.title);
      plot.innerHTML = chartSvg(model); output.appendChild(plot);
      if (cfg.kind === 'donut' && model.points.length) {
        var legend = doc.createElement('ul'); legend.className = 'ac-chart-legend';
        model.points.forEach(function (p, i) {
          var li = doc.createElement('li'), dot = doc.createElement('span'); dot.style.background = colors[i % colors.length]; dot.setAttribute('aria-hidden', 'true');
          li.appendChild(dot); li.appendChild(doc.createTextNode(p.label + ': ' + format(p.value))); legend.appendChild(li);
        });
        output.appendChild(legend);
      }
    }
    root.appendChild(controls); root.appendChild(output); root.appendChild(status); draw();
    return root;
  }
  if (window.AcardEditor) window.AcardEditor.provide("chart", { model: chartModel, svg: chartSvg, render: render });
})();
