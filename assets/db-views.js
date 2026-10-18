(function () {
  'use strict';

  var CSS = [
    '.dbv{font-size:var(--fs-14,14px);color:inherit}',
    '.dbv-empty{padding:24px;color:#888;text-align:center}',
    '.dbv-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#bbb;margin-right:6px}',
    '.dbv-board{display:flex;gap:12px;overflow-x:auto;align-items:flex-start}',
    '.dbv-col{flex:0 0 260px;background:rgba(127,127,127,.08);border-radius:8px;padding:8px;min-height:80px}',
    '.dbv-col{transition:background-color .18s}.dbv-col.over{outline:2px dashed var(--accent,#888);background:var(--accent-soft,transparent)}',
    '.dbv-card{transition:transform .18s cubic-bezier(.34,1.4,.64,1),box-shadow .18s}.dbv-card.dragging{transform:scale(1.02) rotate(-1deg);box-shadow:0 12px 32px rgba(30,28,50,.18);opacity:.9}',
    '@media (prefers-reduced-motion:reduce){.dbv-col,.dbv-card{transition:none}.dbv-card.dragging{transform:none}}',
    '.dbv-col-h{font-weight:600;padding:4px 6px;display:flex;align-items:center}',
    '.dbv-count{margin-left:6px;color:#888;font-weight:400}',
    '.dbv-card{background:var(--dbv-card,var(--surface,#fff));color:var(--fg,#222);border:1px solid rgba(127,127,127,.3);border-radius:6px;padding:8px;margin-top:8px;cursor:pointer}',
    '.dbv-card-title{font-weight:600;margin-bottom:4px;word-break:break-word}',
    '.dbv-prop{margin-top:4px}',
    '.dbv-move{margin-top:6px;font-size:var(--fs-12,12px);max-width:100%}',
    '.dbv-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}',
    '.dbv-cover{width:100%;height:140px;object-fit:cover;border-radius:4px;margin-bottom:6px;display:block;background:var(--bg-soft,#eee)}',
    '.dbv-list{display:flex;flex-direction:column}',
    '.dbv-li{display:flex;align-items:center;gap:12px;padding:6px 8px;border-bottom:1px solid rgba(127,127,127,.2)}',
    '.dbv-li-title{flex:1 1 auto;cursor:pointer;font-weight:500;background:none;border:0;text-align:left;padding:0;color:inherit;font:inherit}',
    '.dbv-li-props{display:flex;gap:12px;flex:0 1 auto;flex-wrap:wrap;justify-content:flex-end}',
    '.dbv-cal-nav{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '.dbv-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid rgba(127,127,127,.3);border-top:1px solid rgba(127,127,127,.3)}',
    '.dbv-cal-dow{padding:4px;text-align:center;font-weight:600;border-right:1px solid rgba(127,127,127,.3);border-bottom:1px solid rgba(127,127,127,.3)}',
    '.dbv-cal-day{min-height:90px;padding:4px;border-right:1px solid rgba(127,127,127,.3);border-bottom:1px solid rgba(127,127,127,.3);overflow:hidden}',
    '.dbv-cal-day.dim{opacity:.4}',
    '.dbv-cal-num{font-size:var(--fs-12,12px);color:#888}',
    '.dbv-chip{display:block;width:100%;text-align:left;margin-top:2px;padding:1px 6px;border-radius:4px;border:0;background:rgba(80,140,255,.2);color:inherit;font:inherit;font-size:var(--fs-12,12px);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dbv-tl{overflow-x:auto;border:1px solid rgba(127,127,127,.3)}',
    '.dbv-tl-row{display:flex;height:32px;border-bottom:1px solid rgba(127,127,127,.2)}',
    '.dbv-tl-label{flex:0 0 160px;padding:6px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:sticky;left:0;background:var(--dbv-bg,var(--bg,#fff));color:inherit;z-index:1;border-right:1px solid rgba(127,127,127,.3)}',
    '.dbv-tl-track{position:relative;flex:0 0 auto}',
    '.dbv-tl-tick{position:absolute;top:0;font-size:var(--fs-11,11px);color:#888;border-left:1px solid rgba(127,127,127,.2);height:100%;padding-left:2px;box-sizing:border-box}',
    '.dbv-bar{position:absolute;top:5px;height:22px;border-radius:4px;background:rgba(80,140,255,.55);border:0;cursor:pointer;color:inherit;font:inherit;font-size:var(--fs-12,12px);overflow:hidden;white-space:nowrap;text-align:left;padding:0 6px}',
    '.dbv-tl-h{font-weight:600;padding:6px 8px;background:rgba(127,127,127,.1)}'
  ].join('\n');

  var COLORS = {
    default: '#9b9a97', gray: '#9b9a97', brown: '#a0714f', orange: '#d9730d', yellow: '#cb912f',
    green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47'
  };
  var DAY = 86400000;

  function ensureStyle(doc) {
    try {
      if (!doc || !doc.head) return;
      if (doc.getElementById && doc.getElementById('dbv-style')) return;
      var s = doc.createElement('style');
      s.id = 'dbv-style';
      s.textContent = CSS;
      doc.head.appendChild(s);
    } catch (e) { /* styling is best-effort */ }
  }

  function mk(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function root(ctx, cls) {
    var doc = ctx.doc || document;
    ensureStyle(doc);
    return { doc: doc, el: mk(doc, 'div', 'dbv ' + cls) };
  }

  function empty(doc, msg) {
    return mk(doc, 'div', 'dbv dbv-empty', msg);
  }

  function props(ctx) { return Array.isArray(ctx.properties) ? ctx.properties : []; }
  function rows(ctx) { return Array.isArray(ctx.rows) ? ctx.rows : []; }

  function titleProp(ctx) {
    var p = props(ctx);
    for (var i = 0; i < p.length; i++) if (p[i].type === 'title') return p[i];
    return p[0] || null;
  }

  function rowValues(ctx, row) {
    try {
      if (typeof ctx.values === 'function') return ctx.values(row) || {};
    } catch (e) { /* fall through */ }
    return row.props || {};
  }

  function text(ctx, prop, value) {
    if (value == null) return '';
    try {
      if (typeof ctx.display === 'function') {
        var s = ctx.display(prop, value);
        return s == null ? '' : String(s);
      }
    } catch (e) { /* fall through */ }
    if (typeof value === 'object') {
      if (value.start) return String(value.start) + (value.end ? ' → ' + value.end : '');
      return Array.isArray(value) ? value.join(', ') : '';
    }
    return String(value);
  }

  function rowTitle(ctx, row, tp) {
    if (!tp) return '제목 없음';
    var t = text(ctx, tp, rowValues(ctx, row)[tp.id]);
    return t || '제목 없음';
  }

  function cell(ctx, prop, row, vals) {
    var doc = ctx.doc || document;
    if (typeof ctx.createCell === 'function') {
      try {
        var c = ctx.createCell(prop, row);
        if (c) return c;
      } catch (e) { /* fall back */ }
    }
    return mk(doc, 'span', 'dbv-cell', text(ctx, prop, (vals || rowValues(ctx, row))[prop.id]));
  }

  function openRow(ctx, id) {
    if (typeof ctx.openRow === 'function') ctx.openRow(id);
  }

  function otherProps(ctx, tp, max) {
    var out = [];
    var p = props(ctx);
    for (var i = 0; i < p.length; i++) {
      if (tp && p[i].id === tp.id) continue;
      out.push(p[i]);
      if (max && out.length >= max) break;
    }
    return out;
  }

  function optionsFor(ctx, prop) {
    var o = null;
    try {
      if (prop.type === 'status' && typeof ctx.statusOptions === 'function') o = ctx.statusOptions(prop);
    } catch (e) { o = null; }
    if (!o && prop.config && Array.isArray(prop.config.options)) o = prop.config.options;
    return Array.isArray(o) ? o : [];
  }

  function dot(doc, color) {
    var d = mk(doc, 'span', 'dbv-dot');
    d.style.background = COLORS[color] || COLORS.default;
    return d;
  }

  // ---------- board ----------
  function board(ctx) {
    var r = root(ctx, 'dbv-board-wrap');
    var doc = r.doc;
    var p = props(ctx);
    if (!p.length) return empty(doc, '표시할 속성이 없습니다.');
    var gp = null, i;
    if (ctx.groupBy) for (i = 0; i < p.length; i++) if (p[i].id === ctx.groupBy) gp = p[i];
    if (!gp) for (i = 0; i < p.length; i++) if (p[i].type === 'select' || p[i].type === 'status') { gp = p[i]; break; }
    if (!gp) gp = p[0];
    var tp = titleProp(ctx);
    var opts = optionsFor(ctx, gp);
    var cols = opts.map(function (o) { return { opt: o, rows: [] }; });
    var none = { opt: null, rows: [] };
    var all = rows(ctx);
    all.forEach(function (row) {
      var v = rowValues(ctx, row)[gp.id];
      if (Array.isArray(v)) v = v[0];
      var hit = null;
      if (v != null && v !== '') {
        for (var k = 0; k < cols.length; k++) {
          if (cols[k].opt.id === v || cols[k].opt.name === v) { hit = cols[k]; break; }
        }
      }
      (hit || none).rows.push(row);
    });
    cols.push(none);
    if (!all.length && !opts.length) return empty(doc, '표시할 항목이 없습니다.');

    var wrap = mk(doc, 'div', 'dbv dbv-board');
    cols.forEach(function (col) {
      var c = mk(doc, 'div', 'dbv-col');
      var h = mk(doc, 'div', 'dbv-col-h');
      if (col.opt) h.appendChild(dot(doc, col.opt.color));
      h.appendChild(mk(doc, 'span', '', col.opt ? col.opt.name : '옵션 없음'));
      h.appendChild(mk(doc, 'span', 'dbv-count', col.rows.length));
      c.appendChild(h);
      c.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (c.classList) c.classList.add('over');
      });
      c.addEventListener('dragleave', function () { if (c.classList) c.classList.remove('over'); });
      c.addEventListener('drop', function (e) {
        e.preventDefault();
        if (c.classList) c.classList.remove('over');
        var id = e.dataTransfer && e.dataTransfer.getData('text/plain');
        if (id && typeof ctx.setValue === 'function') ctx.setValue(id, gp.id, col.opt ? col.opt.id : null);
      });
      col.rows.forEach(function (row) {
        var vals = rowValues(ctx, row);
        var card = mk(doc, 'div', 'dbv-card');
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', function (e) {
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', String(row.id));
            e.dataTransfer.effectAllowed = 'move';
          }
          if (card.classList) card.classList.add('dragging');
        });
        card.addEventListener('dragend', function () { if (card.classList) card.classList.remove('dragging'); });
        var t = mk(doc, 'div', 'dbv-card-title', rowTitle(ctx, row, tp));
        t.addEventListener('click', function () { openRow(ctx, row.id); });
        card.appendChild(t);
        otherProps(ctx, tp).filter(function (q) { return q.id !== gp.id; }).slice(0, 3).forEach(function (q) {
          var pr = mk(doc, 'div', 'dbv-prop');
          pr.appendChild(cell(ctx, q, row, vals));
          card.appendChild(pr);
        });
        var sel = mk(doc, 'select', 'dbv-move');
        sel.setAttribute('aria-label', '다른 열로 이동');
        var ph = mk(doc, 'option', '', '이동…');
        ph.value = '';
        sel.appendChild(ph);
        cols.forEach(function (target) {
          if (target === col) return;
          var o = mk(doc, 'option', '', target.opt ? target.opt.name : '옵션 없음');
          o.value = target.opt ? 'o:' + target.opt.id : 'none';
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          var v = sel.value;
          if (!v || typeof ctx.setValue !== 'function') return;
          ctx.setValue(row.id, gp.id, v === 'none' ? null : v.slice(2));
        });
        card.appendChild(sel);
        c.appendChild(card);
      });
      wrap.appendChild(c);
    });
    return wrap;
  }

  // ---------- gallery ----------
  function gallery(ctx) {
    var r = root(ctx, 'dbv-gallery');
    var doc = r.doc;
    var all = rows(ctx);
    if (!all.length) return empty(doc, '표시할 항목이 없습니다.');
    var tp = titleProp(ctx);
    var fp = null;
    props(ctx).forEach(function (q) { if (!fp && q.type === 'files') fp = q; });
    var others = otherProps(ctx, tp).filter(function (q) { return !fp || q.id !== fp.id; });
    all.forEach(function (row) {
      var vals = rowValues(ctx, row);
      var card = mk(doc, 'div', 'dbv-card');
      card.addEventListener('click', function (e) {
        var n = e.target;
        while (n && n !== card) {
          if (n.getAttribute && n.getAttribute('data-dbv-cell') === '1') return;
          n = n.parentNode;
        }
        openRow(ctx, row.id);
      });
      if (fp) {
        var f = vals[fp.id];
        var first = Array.isArray(f) ? f[0] : f;
        var url = first && typeof first === 'object' ? (first.url || first.src || first.path) : first;
        if (typeof url === 'string' && url) {
          var img = mk(doc, 'img', 'dbv-cover');
          img.setAttribute('src', url);
          img.setAttribute('alt', '');
          img.setAttribute('loading', 'lazy');
          card.appendChild(img);
        }
      }
      card.appendChild(mk(doc, 'div', 'dbv-card-title', rowTitle(ctx, row, tp)));
      others.forEach(function (q) {
        var pr = mk(doc, 'div', 'dbv-prop');
        pr.setAttribute('data-dbv-cell', '1');
        pr.appendChild(cell(ctx, q, row, vals));
        card.appendChild(pr);
      });
      r.el.appendChild(card);
    });
    return r.el;
  }

  // ---------- list ----------
  function list(ctx) {
    var r = root(ctx, 'dbv-list');
    var doc = r.doc;
    var all = rows(ctx);
    if (!all.length) return empty(doc, '표시할 항목이 없습니다.');
    var tp = titleProp(ctx);
    var others = otherProps(ctx, tp);
    all.forEach(function (row) {
      var vals = rowValues(ctx, row);
      var li = mk(doc, 'div', 'dbv-li');
      var t = mk(doc, 'button', 'dbv-li-title', rowTitle(ctx, row, tp));
      t.setAttribute('type', 'button');
      t.addEventListener('click', function () { openRow(ctx, row.id); });
      li.appendChild(t);
      var box = mk(doc, 'div', 'dbv-li-props');
      others.forEach(function (q) { box.appendChild(cell(ctx, q, row, vals)); });
      li.appendChild(box);
      r.el.appendChild(li);
    });
    return r.el;
  }

  // ---------- date helpers ----------
  function parseDay(s) {
    if (s == null) return null;
    if (typeof s === 'number') return isFinite(s) ? Math.floor(s / DAY) : null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
    var d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }

  function dateRange(v) {
    if (v == null || v === '') return null;
    var a, b;
    if (typeof v === 'object' && !Array.isArray(v)) {
      a = parseDay(v.start);
      b = v.end ? parseDay(v.end) : a;
    } else {
      a = parseDay(v);
      b = a;
    }
    if (a == null) return null;
    if (b == null || b < a) b = a;
    return { start: a, end: b };
  }

  function datePropFor(ctx) {
    var p = props(ctx), i;
    if (ctx.groupBy) for (i = 0; i < p.length; i++) if (p[i].id === ctx.groupBy && p[i].type === 'date') return p[i];
    for (i = 0; i < p.length; i++) if (p[i].type === 'date') return p[i];
    return null;
  }

  // ---------- calendar ----------
  function calendar(ctx) {
    var r = root(ctx, 'dbv-calendar');
    var doc = r.doc;
    var dp = datePropFor(ctx);
    if (!dp) return empty(doc, '날짜 속성이 없어 달력을 표시할 수 없습니다.');
    var tp = titleProp(ctx);
    var byDay = {};
    rows(ctx).forEach(function (row) {
      var rg = dateRange(rowValues(ctx, row)[dp.id]);
      if (!rg) return;
      var end = Math.min(rg.end, rg.start + 60);
      for (var d = rg.start; d <= end; d++) (byDay[d] = byDay[d] || []).push(row);
    });
    var now = new Date();
    var year = now.getFullYear(), month = now.getMonth();

    var nav = mk(doc, 'div', 'dbv-cal-nav');
    var prev = mk(doc, 'button', '', '이전');
    prev.setAttribute('type', 'button');
    var label = mk(doc, 'strong', '');
    var next = mk(doc, 'button', '', '다음');
    next.setAttribute('type', 'button');
    nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next);
    var grid = mk(doc, 'div', 'dbv-cal-grid');
    r.el.appendChild(nav);
    r.el.appendChild(grid);

    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

    function render() {
      clear(grid);
      label.textContent = year + '년 ' + (month + 1) + '월';
      ['일', '월', '화', '수', '목', '금', '토'].forEach(function (n) {
        grid.appendChild(mk(doc, 'div', 'dbv-cal-dow', n));
      });
      var firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
      var startDay = Math.floor(Date.UTC(year, month, 1) / DAY) - firstDow;
      var dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      var weeks = Math.ceil((firstDow + dim) / 7);
      for (var i = 0; i < weeks * 7; i++) {
        var dayNum = startDay + i;
        var dt = new Date(dayNum * DAY);
        var inMonth = dt.getUTCMonth() === month;
        var cellEl = mk(doc, 'div', 'dbv-cal-day' + (inMonth ? '' : ' dim'));
        cellEl.appendChild(mk(doc, 'div', 'dbv-cal-num', dt.getUTCDate()));
        (byDay[dayNum] || []).forEach(function (row) {
          var chip = mk(doc, 'button', 'dbv-chip', rowTitle(ctx, row, tp));
          chip.setAttribute('type', 'button');
          chip.addEventListener('click', function () { openRow(ctx, row.id); });
          cellEl.appendChild(chip);
        });
        grid.appendChild(cellEl);
      }
    }
    prev.addEventListener('click', function () {
      month--; if (month < 0) { month = 11; year--; }
      render();
    });
    next.addEventListener('click', function () {
      month++; if (month > 11) { month = 0; year++; }
      render();
    });
    render();
    return r.el;
  }

  // ---------- timeline ----------
  function timeline(ctx) {
    var r = root(ctx, 'dbv-timeline');
    var doc = r.doc;
    var dp = datePropFor(ctx);
    if (!dp) return empty(doc, '날짜 속성이 없어 타임라인을 표시할 수 없습니다.');
    var all = rows(ctx);
    if (!all.length) return empty(doc, '표시할 항목이 없습니다.');
    var tp = titleProp(ctx);
    var dated = [], undated = [];
    all.forEach(function (row) {
      var rg = dateRange(rowValues(ctx, row)[dp.id]);
      if (rg) dated.push({ row: row, rg: rg }); else undated.push(row);
    });
    var wrap = mk(doc, 'div', 'dbv-tl');
    r.el.appendChild(wrap);

    if (dated.length) {
      var min = Infinity, max = -Infinity;
      dated.forEach(function (d) {
        if (d.rg.start < min) min = d.rg.start;
        if (d.rg.end > max) max = d.rg.end;
      });
      min -= 3; max += 3;
      var span = max - min + 1;
      var DW = 64;
      var width = span * DW;
      var step = span > 60 ? 7 : 1;

      var head = mk(doc, 'div', 'dbv-tl-row');
      head.appendChild(mk(doc, 'div', 'dbv-tl-label', '제목'));
      var ht = mk(doc, 'div', 'dbv-tl-track');
      ht.style.width = width + 'px';
      for (var i = 0; i < span; i += step) {
        var dt = new Date((min + i) * DAY);
        var tick = mk(doc, 'div', 'dbv-tl-tick', (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate());
        tick.style.left = (i * DW) + 'px';
        ht.appendChild(tick);
      }
      head.appendChild(ht);
      wrap.appendChild(head);

      dated.forEach(function (d) {
        var line = mk(doc, 'div', 'dbv-tl-row');
        line.appendChild(mk(doc, 'div', 'dbv-tl-label', rowTitle(ctx, d.row, tp)));
        var tr = mk(doc, 'div', 'dbv-tl-track');
        tr.style.width = width + 'px';
        var bar = mk(doc, 'button', 'dbv-bar', rowTitle(ctx, d.row, tp));
        bar.setAttribute('type', 'button');
        bar.style.left = ((d.rg.start - min) * DW) + 'px';
        bar.style.width = ((d.rg.end - d.rg.start + 1) * DW - 2) + 'px';
        bar.addEventListener('click', function () { openRow(ctx, d.row.id); });
        tr.appendChild(bar);
        line.appendChild(tr);
        wrap.appendChild(line);
      });
    }

    if (undated.length) {
      wrap.appendChild(mk(doc, 'div', 'dbv-tl-h', '날짜 없음'));
      undated.forEach(function (row) {
        var line = mk(doc, 'div', 'dbv-tl-row');
        var lb = mk(doc, 'button', 'dbv-li-title', rowTitle(ctx, row, tp));
        lb.setAttribute('type', 'button');
        lb.addEventListener('click', function () { openRow(ctx, row.id); });
        line.appendChild(lb);
        wrap.appendChild(line);
      });
    }
    return r.el;
  }

  window.DoriDBViews = { board: board, gallery: gallery, list: list, calendar: calendar, timeline: timeline };
})();
