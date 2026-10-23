// Basic charts (visual kit P0): chart-bar, chart-line, chart-donut, chart-kpi, chart-sparkline. Engine: _chart-core.js.
import { registerComponent } from "../component-registry.js";

const CHB_SERIES_SCHEMA = { type: "array", items: { type: "object", properties: { name: { type: "string" }, data: { type: "array", items: { type: ["number", "null"] } } }, required: ["data"] } };

function chbBars(d, h, kind) {
  const C = h.chart;
  const wide = chbBarsBody(d, h, 640, 320), narrow = chbBarsBody(d, h, 360, 300);
  if (!wide) return C.figure(kind, d, h, { empty: C.EMPTY });
  return C.figure(kind, d, h, { ...wide, narrow, label: "막대 그래프" });
}
function chbBarsBody(d, h, W, H) {
  const C = h.chart;
  const { labels, series, ok } = C.series(d, h, 6);
  if (!ok) return null;
  const stacked = d.stacked === true;
  const { lo, hi } = C.minMax(series, stacked);
  const unit = h.str(d.unit, "", 8);
  const ax = C.axes(labels, lo, hi, { unit, w: W, h: H, xTitle: h.str(d.xTitle, "", 40), yTitle: h.str(d.yTitle, "", 40) });
  const pal = C.palette(d.palette);
  const multi = series.length > 1;
  const group = ax.step * 0.68, bw = stacked || !multi ? group : group / series.length;
  let body = ax.svg;
  const base = labels.map(() => [0, 0]);
  series.forEach((s, si) => {
    s.data.forEach((v, i) => {
      if (v === null) return;
      let y0, y1;
      if (stacked) { const slot = v >= 0 ? 0 : 1; y0 = base[i][slot]; y1 = y0 + v; base[i][slot] = y1; } else { y0 = 0; y1 = v; }
      const x = ax.x(i) - group / 2 + (stacked || !multi ? 0 : bw * si);
      const top = Math.min(ax.y(y0), ax.y(y1)), height = Math.max(1, Math.abs(ax.y(y1) - ax.y(y0)));
      const fill = multi ? C.color(pal, s.color) : C.color(pal, d.colorBy === "label" ? i : 0);
      body += '<rect class="vk-draw" x="' + C.round(x + 1) + '" y="' + C.round(top) + '" width="' + C.round(Math.max(2, bw - 3)) + '" height="' + C.round(height) + '" rx="' + Math.min(5, bw / 4) + '" fill="' + fill + '"><title>' + C.esc(labels[i] + " · " + s.name + ": " + C.fmt(v, unit)) + "</title></rect>";
      if (d.values !== false && !stacked && bw >= 22) body += C.text(x + bw / 2, ax.y(y1) + (v < 0 ? 12 : -10), C.fmt(v, unit), 12, { anchor: "middle", cls: "vk-val" });
    });
  });
  const table = C.table(h.str(d.title, "막대 그래프", 80), ["항목", ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => C.fmt(s.data[i], unit))]));
  return { w: ax.W, h: ax.H, body, desc: C.finding(labels, series[0], unit), table, legend: C.legend(series.map((s) => s.name), pal) };
}

registerComponent({
  id: "chart-bar", family: "chart", name: "막대 그래프",
  description: "Vertical bar chart for comparing categories (one or more series, optional stacked). labels: [..], series: [{name, data:[numbers]}] (or values: [..] for one series), unit, xTitle, yTitle, stacked, figure (numbered figure), caption, source, palette acard|colorblind|mono.",
  schema: { type: "object", properties: { labels: { type: "array", items: { type: "string" } }, series: CHB_SERIES_SCHEMA, values: { type: "array", items: { type: ["number", "null"] } }, stacked: { type: "boolean" }, xTitle: { type: "string" }, yTitle: { type: "string" }, colorBy: { enum: ["series", "label"] } }, required: ["labels"] },
  presets: { paper: { palette: "mono", figure: true }, report: { compact: true }, friendly: {}, showcase: { height: "l" } },
  defaults: { labels: [], series: [] },
  sample: { title: "분기별 매출", subtitle: "분기별로 발생한 매출을 비교합니다.", labels: ["1분기", "2분기", "3분기"], series: [{ name: "제품 A", data: [1200, 1560, 1820] }, { name: "제품 B", data: [800, 1100, 1430] }], unit: "", caption: "분기별 매출 (단위: 만원)" },
  slash: { label: "막대 그래프", hint: "항목끼리 크기 비교", ico: "▥", aliases: "막대 그래프 차트 막대그래프 bar chart column graph 비교 매출" },
  css: "",
  render(d, h) { return chbBars(d, h, "bar"); },
});

registerComponent({
  id: "chart-line", family: "chart", name: "선 그래프",
  description: "Line chart for change over time; area: true fills under the line. labels: [..] (time order), series: [{name, data:[numbers]}], unit, highlight (label to mark with a tooltip bubble), xTitle, yTitle, figure, caption, source, palette.",
  schema: { type: "object", properties: { labels: { type: "array", items: { type: "string" } }, series: CHB_SERIES_SCHEMA, values: { type: "array", items: { type: ["number", "null"] } }, area: { type: "boolean" }, highlight: { type: "string" }, xTitle: { type: "string" }, yTitle: { type: "string" } }, required: ["labels"] },
  presets: { paper: { palette: "mono", figure: true, area: false }, report: { compact: true }, friendly: { area: true }, showcase: { height: "l", area: true } },
  defaults: { labels: [], series: [] },
  sample: { title: "월별 방문자", subtitle: "월별 웹사이트 방문자 수 추이입니다.", labels: ["1월", "2월", "3월", "4월", "5월", "6월"], series: [{ name: "방문자 수", data: [1200, 2300, 3200, 2400, 1900, 3000] }], unit: "명", area: true, highlight: "3월" },
  slash: { label: "선 그래프", hint: "시간에 따른 변화", ico: "⟋", aliases: "선 그래프 꺾은선 라인 추이 line chart trend area 영역" },
  css: ".vk-line .vk-tip rect{fill:var(--color-text)}.vk-line .vk-tip text{fill:var(--color-bg);font-weight:650}",
  render(d, h) {
    const C = h.chart;
    const wide = chbLineBody(d, h, 640, 320), narrow = chbLineBody(d, h, 360, 300);
    if (!wide) return C.figure("line", d, h, { empty: C.EMPTY });
    return C.figure("line", d, h, { ...wide, narrow, label: "선 그래프" });
  },
});

function chbLineBody(d, h, W, H) {
    const C = h.chart;
    const { labels, series, ok } = C.series(d, h, 6);
    if (!ok) return null;
    const unit = h.str(d.unit, "", 8);
    const { lo, hi } = C.minMax(series, false);
    const ax = C.axes(labels, lo, hi, { unit, w: W, h: H, xTitle: h.str(d.xTitle, "", 40), yTitle: h.str(d.yTitle, "", 40) });
    const pal = C.palette(d.palette);
    let body = ax.svg;
    series.forEach((s, si) => {
      const color = C.color(pal, s.color);
      const pts = s.data.map((v, i) => (v === null ? null : [ax.x(i), ax.y(v)]));
      const runs = [];
      let run = [];
      pts.forEach((p) => { if (p) run.push(p); else if (run.length) { runs.push(run); run = []; } });
      if (run.length) runs.push(run);
      for (const r of runs) {
        if (d.area === true && series.length === 1 && r.length > 1) body += '<path class="vk-draw" d="M' + C.round(r[0][0]) + " " + C.round(ax.zero) + r.map((p) => " L" + C.round(p[0]) + " " + C.round(p[1])).join("") + " L" + C.round(r[r.length - 1][0]) + " " + C.round(ax.zero) + ' Z" fill="' + color + '" fill-opacity=".16"/>';
        body += '<polyline class="vk-draw" points="' + r.map((p) => C.round(p[0]) + "," + C.round(p[1])).join(" ") + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"' + C.dash(pal, si) + "/>";
      }
      s.data.forEach((v, i) => { if (v !== null) body += '<circle cx="' + C.round(ax.x(i)) + '" cy="' + C.round(ax.y(v)) + '" r="4" fill="var(--color-surface)" stroke="' + color + '" stroke-width="2"><title>' + C.esc(labels[i] + " · " + s.name + ": " + C.fmt(v, unit)) + "</title></circle>"; });
    });
    const hi0 = labels.indexOf(h.str(d.highlight, "", 40));
    const hv = hi0 >= 0 ? series[0].data[hi0] : null;
    if (hv !== null) {
      const text = labels[hi0] + " · " + C.fmt(hv, unit), tw = C.textW(text, 12) + 18, tx = Math.min(Math.max(ax.x(hi0) - tw / 2, ax.left), ax.W - ax.right - tw), ty = ax.y(hv) - 38;
      body += '<g class="vk-tip"><rect x="' + C.round(tx) + '" y="' + C.round(Math.max(0, ty)) + '" width="' + C.round(tw) + '" height="24" rx="6"/>' + C.text(tx + tw / 2, Math.max(0, ty) + 12, text, 12, { anchor: "middle" }) + "</g>";
      body += '<circle cx="' + C.round(ax.x(hi0)) + '" cy="' + C.round(ax.y(hv)) + '" r="6" fill="' + C.color(pal, 0) + '" stroke="var(--color-surface)" stroke-width="2"/>';
    }
    const table = C.table(h.str(d.title, "선 그래프", 80), ["항목", ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => C.fmt(s.data[i], unit))]));
    return { w: ax.W, h: ax.H, body, desc: C.finding(labels, series[0], unit), table, legend: C.legend(series.map((s) => s.name), pal) };
}

registerComponent({
  id: "chart-donut", family: "chart", name: "도넛 그래프",
  description: "Donut (or pie with hole: 0) chart of shares of one total; more than 6 slices merge into 기타. items: [{label, value}], center (big text in the middle, default the total), centerLabel, unit, figure, caption, palette.",
  schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } }, required: ["label", "value"] } }, center: { type: "string" }, centerLabel: { type: "string" }, hole: { type: "number", minimum: 0, maximum: 0.85 } }, required: ["items"] },
  presets: { paper: { palette: "mono", figure: true }, report: { compact: true }, friendly: {}, showcase: { height: "l" } },
  defaults: { items: [] },
  sample: { title: "채널 비중", subtitle: "사용자가 유입된 채널의 비중입니다.", items: [{ label: "검색", value: 5242 }, { label: "SNS", value: 3494 }, { label: "광고", value: 2496 }, { label: "기타", value: 1248 }], centerLabel: "전체 방문자" },
  slash: { label: "도넛 그래프", hint: "전체 중 비중", ico: "◔", aliases: "도넛 파이 원그래프 비중 점유율 donut pie share" },
  css: ".vk-donut .vk-dn{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);align-items:center;gap:var(--space-5)}.vk-donut .vk-dn-list{display:grid;gap:var(--space-2);margin:0;padding:0;list-style:none;font-size:var(--fs-14)}" +
    ".vk-donut .vk-dn-list li{display:grid;grid-template-columns:12px 1fr auto;align-items:center;gap:var(--space-2)}.vk-donut .vk-dn-list i{width:10px;height:10px;border-radius:50%}.vk-donut .vk-dn-list b{font-weight:650}" +
    "@container (max-width:439px){.vk-donut .vk-dn{grid-template-columns:minmax(0,1fr)}.vk-donut .vk-dn svg{max-width:240px;margin:0 auto}}",
  render(d, h) {
    const C = h.chart;
    let items = h.list(d.items, 40).filter((it) => it && typeof it === "object").map((it, i) => ({ label: C.clip(h.str(it.label, "항목 " + (i + 1), 30), 30), value: Math.max(0, C.num(it.value) || 0) })).filter((it) => it.value > 0);
    if (items.length > 6) { const rest = items.slice(5).reduce((s, it) => s + it.value, 0); items = items.slice(0, 5).concat([{ label: "기타", value: rest }]); }
    const total = items.reduce((s, it) => s + it.value, 0);
    if (!total) return C.figure("donut", d, h, { empty: C.EMPTY });
    const unit = h.str(d.unit, "", 8), pal = C.palette(d.palette);
    const holeRaw = C.num(d.hole);
    const hole = holeRaw === null ? 0.62 : Math.max(0, Math.min(0.85, holeRaw));
    const R = 120, cx = 130, cy = 130;
    let a = -Math.PI / 2, body = "";
    items.forEach((it, i) => {
      const span = (it.value / total) * Math.PI * 2;
      body += '<path class="vk-draw" d="' + C.arc(cx, cy, R * hole, R, a, a + span) + '" fill="' + C.color(pal, i) + '" stroke="var(--color-surface)" stroke-width="2"><title>' + C.esc(it.label + ": " + C.fmt(it.value, unit) + " (" + Math.round((it.value / total) * 100) + "%)") + "</title></path>";
      const mid = a + span / 2, pct = Math.round((it.value / total) * 100);
      if (pct >= 8) body += C.text(cx + R * (hole ? (1 + hole) / 2 : 0.62) * Math.cos(mid), cy + R * (hole ? (1 + hole) / 2 : 0.62) * Math.sin(mid), pct + "%", 12, { anchor: "middle", fill: "var(--color-surface)", weight: 650 });
      a += span;
    });
    if (hole >= 0.4) {
      body += C.text(cx, cy - 6, h.str(d.center, C.fmt(total, unit), 16), 26, { anchor: "middle", weight: 750 });
      body += C.text(cx, cy + 20, h.str(d.centerLabel, "합계", 16), 12, { anchor: "middle", cls: "vk-tick" });
    }
    const svg = '<svg class="vk-svg" viewBox="0 0 260 260" role="img" aria-hidden="true">' + body + "</svg>";
    const list = '<ul class="vk-dn-list">' + items.map((it, i) => '<li><i style="background:' + C.color(pal, i) + '"></i><span>' + C.esc(it.label) + "</span><b>" + Math.round((it.value / total) * 100) + "%</b></li>").join("") + "</ul>";
    const top = items.reduce((p, c) => (c.value > p.value ? c : p));
    const desc = "전체 " + C.fmt(total, unit) + " 중 " + top.label + "이(가) " + Math.round((top.value / total) * 100) + "%로 가장 커요.";
    const table = C.table(h.str(d.title, "도넛 그래프", 80), ["항목", "값", "비중"], items.map((it) => [it.label, C.fmt(it.value, unit), Math.round((it.value / total) * 100) + "%"]));
    const plot = '<div class="vk-dn" role="img" aria-label="' + C.esc(desc) + '">' + svg + list + "</div>";
    return C.figure("donut", d, h, { plot, desc, table, label: "도넛 그래프" });
  },
});

registerComponent({
  id: "chart-kpi", family: "chart", name: "KPI 숫자",
  description: "One headline number with a label, a delta pill (+12% green, -3% red) and an optional sparkline trend. label, value, delta, note, trend: [numbers].",
  schema: { type: "object", properties: { label: { type: "string" }, value: { type: ["string", "number"] }, delta: { type: "string" }, note: { type: "string" }, trend: { type: "array", items: { type: "number" } } }, required: ["value"] },
  presets: { paper: { palette: "mono" }, report: { compact: true }, friendly: {}, showcase: { height: "l" } },
  defaults: { value: "—" },
  sample: { title: "가입 전환율", subtitle: "방문자 대비 가입 완료 비율입니다.", value: "18.4%", delta: "+12%", trend: [12, 13, 12.5, 14, 13.8, 15, 14.6, 16, 15.8, 17, 16.5, 18.4] },
  slash: { label: "KPI 숫자", hint: "큰 숫자 하나와 추세", ico: "#", aliases: "kpi 숫자 지표 핵심지표 전환율 metric number big number sparkline" },
  css: ".vk-kpi .vk-kpi-val{font-size:var(--fs-56);font-weight:780;letter-spacing:-.02em;line-height:1.05;overflow-wrap:anywhere}.vk-kpi.vk-compact .vk-kpi-val{font-size:var(--fs-44)}.vk-kpi .vk-kpi-note{margin-top:var(--space-1);color:var(--color-text-dim);font-size:var(--fs-13)}" +
    ".vk-kpi .vk-svg{margin-top:var(--space-3);max-height:72px}@container (max-width:359px){.vk-kpi .vk-kpi-val{font-size:var(--fs-44)}}",
  render(d, h) {
    const C = h.chart;
    const value = h.str(d.value, "—", 24), delta = h.str(d.delta, "", 16), note = h.str(d.note, "", 160), unit = h.str(d.unit, "", 8);
    const down = /^\s*[-−↓]/.test(delta);
    const badge = delta ? '<span class="vk-badge' + (down ? " down" : "") + '">' + (down ? "↘ " : "↗ ") + C.esc(delta) + "</span>" : "";
    const trend = h.list(d.trend, 60).map(C.num).filter((v) => v !== null);
    let body = "";
    if (trend.length > 1) {
      const lo = Math.min(...trend), hi = Math.max(...trend), x = C.scale(0, trend.length - 1, 4, 396), y = C.scale(lo, hi === lo ? lo + 1 : hi, 66, 6);
      const pts = trend.map((v, i) => C.round(x(i)) + "," + C.round(y(v))).join(" ");
      const color = down ? "var(--viz-down)" : C.palette(d.palette) === "mono" ? "var(--viz-ink-1)" : "var(--viz-1)";
      body = '<polygon class="vk-draw" points="4,70 ' + pts + ' 396,70" fill="' + color + '" fill-opacity=".14"/><polyline class="vk-draw" points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round"/>';
    }
    const label = h.str(d.label, "", 80);
    const desc = (h.str(d.title, label, 80) || "지표") + " " + value + (delta ? ", 변화 " + delta : "");
    const head = '<div class="vk-kpi-val">' + C.esc(value) + (unit ? "<small>" + C.esc(unit) + "</small>" : "") + "</div>" + (label ? '<div class="vk-kpi-note">' + h.rich(label) + "</div>" : "") + (note ? '<div class="vk-kpi-note">' + h.rich(note) + "</div>" : "");
    return C.figure("kpi", { ...d, title: h.str(d.title, label, 80) }, h, { w: 400, h: 72, body, before: head, desc, badge, label: "KPI", table: "", stretch: true });
  },
});

registerComponent({
  id: "chart-sparkline", family: "chart", name: "스파크라인",
  description: "Tiny inline trend line for a table cell or a stat row: values [numbers], label, last value shown at the end. No axes.",
  schema: { type: "object", properties: { values: { type: "array", items: { type: "number" } }, label: { type: "string" }, unit: { type: "string" }, kind: { enum: ["line", "bar"] } }, required: ["values"] },
  presets: { paper: { palette: "mono" }, report: {}, friendly: {}, showcase: {} },
  defaults: { values: [] },
  sample: { label: "주간 활성 사용자", values: [320, 340, 310, 380, 420, 410, 460, 520], unit: "명" },
  slash: { label: "스파크라인", hint: "작은 추세선 한 줄", ico: "〰", aliases: "스파크라인 작은그래프 추세 sparkline mini trend inline" },
  css: ".ui-chart-sparkline .vk-spark{display:inline-flex;align-items:center;gap:var(--space-3);max-width:100%;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-pill);background:var(--color-surface);font-size:var(--fs-14);font-variant-numeric:tabular-nums}" +
    ".ui-chart-sparkline .vk-spark svg{width:120px;height:28px;flex:none}.ui-chart-sparkline .vk-spark-l{color:var(--color-text-dim)}.ui-chart-sparkline .vk-spark-v{font-weight:700}",
  render(d, h) {
    const C = h.chart;
    const vals = h.list(d.values, 120).map(C.num).filter((v) => v !== null);
    const label = h.str(d.label, "", 60), unit = h.str(d.unit, "", 8);
    if (vals.length < 2) return '<span class="vk-spark"><span class="vk-spark-l">' + C.esc(label || "추세") + '</span><span class="vk-spark-l">' + C.esc(C.EMPTY) + "</span></span>";
    const lo = Math.min(...vals), hi = Math.max(...vals), x = C.scale(0, vals.length - 1, 2, 118), y = C.scale(lo, hi === lo ? lo + 1 : hi, 26, 2);
    const color = C.palette(d.palette) === "mono" ? "var(--viz-ink-1)" : vals[vals.length - 1] < vals[0] ? "var(--viz-down)" : "var(--viz-1)";
    const shape = d.kind === "bar"
      ? vals.map((v, i) => '<rect x="' + C.round(x(i) - 3) + '" y="' + C.round(y(v)) + '" width="5" height="' + C.round(28 - y(v)) + '" rx="1.5" fill="' + color + '"/>').join("")
      : '<polyline points="' + vals.map((v, i) => C.round(x(i)) + "," + C.round(y(v))).join(" ") + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/><circle cx="' + C.round(x(vals.length - 1)) + '" cy="' + C.round(y(vals[vals.length - 1])) + '" r="2.5" fill="' + color + '"/>';
    const desc = (label || "추세") + ": " + C.fmt(vals[0], unit) + "에서 " + C.fmt(vals[vals.length - 1], unit) + "로 " + (vals[vals.length - 1] >= vals[0] ? "올랐어요" : "내렸어요");
    return '<span class="vk-spark">' + (label ? '<span class="vk-spark-l">' + h.rich(label) + "</span>" : "") + '<svg viewBox="0 0 120 28" role="img" aria-label="' + C.esc(desc) + '">' + shape + '</svg><span class="vk-spark-v">' + C.esc(C.fmt(vals[vals.length - 1], unit)) + "</span></span>";
  },
});
