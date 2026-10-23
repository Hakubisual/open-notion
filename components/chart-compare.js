import { registerComponent } from "../component-registry.js";

const chcmpSeriesSchema = { type: "array", items: { type: "object", properties: { name: { type: "string" }, data: { type: "array", items: { type: ["number", "null"] } } }, required: ["data"] } };
const chcmpProps = {
  title: { type: "string" }, subtitle: { type: "string" }, caption: { type: "string" }, source: { type: "string" }, unit: { type: "string" },
  figure: { type: "boolean" }, palette: { enum: ["acard", "colorblind", "mono"] }, height: { enum: ["s", "m", "l"] }, preset: { enum: ["report", "friendly", "paper", "showcase"] },
  labels: { type: "array", items: { type: "string" } }, series: chcmpSeriesSchema, values: { type: "array", items: { type: ["number", "null"] } },
  xTitle: { type: "string" }, yTitle: { type: "string" },
};

function chcmpStack(series, labels) {
  const positive = labels.map(() => 0), negative = labels.map(() => 0);
  const layers = series.map((s) => s.data.map((v, i) => {
    if (v === null) return null;
    const base = v < 0 ? negative : positive, start = base[i];
    base[i] += v;
    return { start, end: base[i], value: v };
  }));
  return { layers, positive, negative, totals: labels.map((_, i) => series.some((s) => s.data[i] !== null) ? positive[i] + negative[i] : null) };
}

function chcmpLabel(C, x, y, label, width, opts) {
  let clipped = label;
  while (C.textW(clipped, 12) > width && [...clipped].length > 1) clipped = C.clip(label, [...clipped].length - 1);
  return '<g><title>' + C.esc(label) + '</title>' + C.text(x, y, clipped, 12, opts) + '</g>';
}

function chcmpAxes(C, labels, lo, hi, d, h, W, H) {
  const ax = C.axes(labels.map(() => ""), lo, hi, { unit: h.str(d.unit, "", 8), w: W, h: H, xTitle: h.str(d.xTitle, "", 40) });
  const labelWidth = Math.max(...labels.map((l) => C.textW(l, 12)), 1);
  const every = Math.max(1, Math.ceil(Math.min(labelWidth, W < 520 ? 60 : 96) / Math.max(1, ax.step - 8)));
  labels.forEach((label, i) => {
    if (i % every === 0) ax.svg += chcmpLabel(C, ax.x(i), ax.bottom + 16, label, Math.max(12, Math.min(ax.step * every - 8, 2 * (W - ax.right - ax.x(i)))), { anchor: "middle", cls: "vk-tick" });
  });
  return ax;
}

function chcmpFigure(kind, label, d, h, body) {
  const wide = body(d, h, 640, 320), narrow = body(d, h, 360, 300);
  return h.chart.figure(kind, d, h, wide ? { ...wide, narrow, label } : { empty: h.chart.EMPTY });
}

function chcmpStackedBody(d, h, W, H) {
  const C = h.chart, { labels, series, ok } = C.series(d, h, 6);
  if (!ok) return null;
  const stack = chcmpStack(series, labels), unit = h.str(d.unit, "", 8), pal = C.palette(d.palette);
  const { lo, hi } = C.minMax(series, true);
  const ax = chcmpAxes(C, labels, lo, hi + (hi - lo) * 0.05, d, h, W, H);
  const bw = ax.step * 0.68;
  let body = ax.svg;
  stack.layers.forEach((layer, si) => layer.forEach((p, i) => {
    if (!p) return;
    const y = Math.min(ax.y(p.start), ax.y(p.end)), height = Math.abs(ax.y(p.end) - ax.y(p.start));
    body += '<rect class="chcmp-segment" x="' + C.round(ax.x(i) - bw / 2) + '" y="' + C.round(y) + '" width="' + C.round(bw) + '" height="' + C.round(height) + '" fill="' + C.color(pal, si) + '"><title>' + C.esc(labels[i] + " · " + series[si].name + ": " + C.fmt(p.value, unit)) + '</title></rect>';
    const text = C.fmt(p.value, unit);
    if (d.segmentLabels === true && height >= 22 && C.textW(text, 12) + 8 <= bw) body += C.text(ax.x(i), y + height / 2, text, 12, { anchor: "middle", fill: "var(--color-surface)", weight: 650 });
  }));
  const totalWidth = Math.max(...stack.totals.map((v) => C.textW(C.fmt(v, unit), 12))) + 8;
  const every = Math.max(1, Math.ceil(totalWidth / ax.step));
  stack.totals.forEach((v, i) => {
    if (v !== null && i % every === 0) body += C.text(ax.x(i), ax.y(stack.positive[i]) - 12, C.fmt(v, unit), 12, { anchor: "middle", cls: "vk-val chcmp-total" });
  });
  return { w: W, h: H, body, desc: C.finding(labels, { name: "합계", data: stack.totals }, unit), legend: C.legend(series.map((s) => s.name), pal),
    table: C.table(h.str(d.title, "누적 막대 그래프", 80), ["항목", ...series.map((s) => s.name), "합계"], labels.map((l, i) => [l, ...series.map((s) => C.fmt(s.data[i], unit)), C.fmt(stack.totals[i], unit)])) };
}

registerComponent({
  id: "chart-stacked", family: "chart", name: "누적 막대 그래프",
  description: "Stacked vertical bars compare category totals and their series contributions: labels, series [{name, data}], optional segmentLabels, unit, caption and source; positive and negative values stack separately.",
  schema: { type: "object", properties: { ...chcmpProps, segmentLabels: { type: "boolean" } }, required: ["labels"] },
  presets: { paper: { palette: "mono", figure: true }, report: { compact: true }, friendly: {}, showcase: { height: "l" } },
  defaults: { labels: [], series: [], segmentLabels: false },
  sample: { title: "누적 사용 시간", subtitle: "월별 기능별 사용 시간을 비교합니다.", labels: ["1월", "2월", "3월", "4월", "5월", "6월"], series: [{ name: "문서 작성", data: [30, 50, 65, 75, 90, 85] }, { name: "데이터베이스", data: [25, 40, 45, 50, 60, 50] }, { name: "캘린더", data: [25, 30, 35, 35, 35, 35] }], caption: "기능별 사용 시간 (단위: 시간)" },
  slash: { label: "누적 막대 그래프", hint: "합계와 구성 비교", ico: "▥", aliases: "누적 막대 합계 구성 stacked bar column chart" },
  css: "",
  render(d, h) { return chcmpFigure("stacked", "누적 막대 그래프", d, h, chcmpStackedBody); },
});

function chcmpHbarBody(d, h, W, H) {
  const C = h.chart;
  const data = Array.isArray(d.items) ? { labels: h.list(d.items, 48).map((it, i) => h.str(it && it.label, "항목 " + (i + 1), 40)), values: h.list(d.items, 48).map((it) => C.num(it && it.value)) } : d;
  const { labels, series, ok } = C.series(data, h, 1);
  if (!ok) return null;
  const points = labels.map((label, i) => ({ label, value: series[0].data[i], index: i }));
  if (d.sort !== "none") points.sort((a, b) => a.value === null ? (b.value === null ? 0 : 1) : b.value === null ? -1 : b.value - a.value);
  const unit = h.str(d.unit, "", 8), pal = C.palette(d.palette), values = points.map((p) => p.value).filter((v) => v !== null);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const ticks = C.ticks(lo, hi === lo ? hi + 1 : hi, W < 520 ? 3 : 4);
  const valueWidth = Math.max(...values.map((v) => C.textW(C.fmt(v, unit), 12))) + 10;
  const labelWidth = W < 520 ? 86 : 140, left = labelWidth + 12 + (lo < 0 ? valueWidth : 0), right = valueWidth + 8;
  H = Math.max(H, points.length * 28 + 52);
  const top = 14, bottom = H - (d.xTitle ? 52 : 34), step = (bottom - top) / points.length;
  const x = C.scale(ticks[0], ticks[ticks.length - 1], left, W - right), zero = x(0);
  let body = "";
  const tickEvery = Math.max(1, Math.ceil((Math.max(...ticks.map((v) => C.textW(C.fmt(v, unit), 12))) + 10) / ((W - right - left) / Math.max(1, ticks.length - 1))));
  ticks.forEach((v, i) => {
    body += '<line class="vk-grid" x1="' + C.round(x(v)) + '" x2="' + C.round(x(v)) + '" y1="' + top + '" y2="' + bottom + '"/>';
    if (i % tickEvery === 0) body += C.text(x(v), bottom + 16, C.fmt(v, unit), 12, { anchor: "middle", cls: "vk-tick" });
  });
  body += '<line class="vk-base" x1="' + C.round(zero) + '" x2="' + C.round(zero) + '" y1="' + top + '" y2="' + bottom + '"/>';
  points.forEach((p, i) => {
    const cy = top + step * (i + 0.5), bh = Math.min(28, step * 0.65);
    body += chcmpLabel(C, labelWidth, cy, p.label, labelWidth, { anchor: "end", cls: "vk-tick" });
    if (p.value === null) { body += C.text(zero + 6, cy, C.fmt(null), 12, { cls: "vk-tick" }); return; }
    const end = x(p.value);
    body += '<rect class="chcmp-hbar" x="' + C.round(Math.min(zero, end)) + '" y="' + C.round(cy - bh / 2) + '" width="' + C.round(Math.abs(end - zero)) + '" height="' + C.round(bh) + '" rx="4" fill="' + C.color(pal, d.colorBy === "label" ? p.index : 0) + '"><title>' + C.esc(p.label + ": " + C.fmt(p.value, unit)) + '</title></rect>';
    body += C.text(end + (p.value < 0 ? -6 : 6), cy, C.fmt(p.value, unit), 12, { anchor: p.value < 0 ? "end" : "start", cls: "vk-val" });
  });
  if (d.xTitle) body += C.text((left + W - right) / 2, H - 12, h.str(d.xTitle, "", 40), 12, { anchor: "middle", cls: "vk-axis-title" });
  return { w: W, h: H, body, desc: C.finding(labels, series[0], unit), table: C.table(h.str(d.title, "가로 막대 그래프", 80), ["항목", series[0].name], points.map((p) => [p.label, C.fmt(p.value, unit)])) };
}

registerComponent({
  id: "chart-hbar", family: "chart", name: "가로 막대 그래프",
  description: "Horizontal bars rank categories descending by default: labels and values (or one series, or items [{label, value}]), sort: none preserves input order, colorBy: label, unit and xTitle.",
  schema: { type: "object", properties: { ...chcmpProps, items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: ["number", "null"] } }, required: ["label", "value"] } }, sort: { enum: ["desc", "none"] }, colorBy: { enum: ["series", "label"] } }, required: ["labels"] },
  presets: { paper: { palette: "mono", figure: true }, report: { compact: true }, friendly: {}, showcase: { height: "l" } },
  defaults: { labels: [], values: [], sort: "desc" },
  sample: { title: "팀별 진행률", subtitle: "각 팀의 프로젝트 진행 상황입니다.", labels: ["기획팀", "디자인팀", "개발팀", "마케팅팀", "운영팀"], values: [92, 76, 64, 48, 32], unit: "%", colorBy: "label", caption: "팀별 진행률 (단위: %)" },
  slash: { label: "가로 막대 그래프", hint: "긴 항목 이름과 순위", ico: "☰", aliases: "가로 막대 순위 비교 horizontal bar hbar ranking chart" },
  css: ".ui-chart-hbar .vk-svg{max-height:none}",
  render(d, h) { return chcmpFigure("hbar", "가로 막대 그래프", d, h, chcmpHbarBody); },
});

function chcmpAreaBody(d, h, W, H) {
  const C = h.chart, { labels, series, ok } = C.series(d, h, 6);
  if (!ok) return null;
  const stacked = d.stacked !== false, unit = h.str(d.unit, "", 8), pal = C.palette(d.palette);
  const stack = chcmpStack(series, labels), { lo, hi } = C.minMax(series, stacked);
  const ax = chcmpAxes(C, labels, lo, hi, d, h, W, H);
  let body = ax.svg;
  series.forEach((s, si) => {
    const points = s.data.map((v, i) => v === null || (stacked && series.some((other) => other.data[i] === null)) ? null : { x: ax.x(i), start: stacked ? stack.layers[si][i].start : 0, end: stacked ? stack.layers[si][i].end : v, value: v, index: i });
    const runs = [];
    let run = [];
    points.forEach((p) => {
      // A missing observation or a diverging stack switching sides must not bridge unrelated baselines.
      if (!p || (stacked && run.length && (p.value < 0) !== (run[run.length - 1].value < 0))) { if (run.length) runs.push(run); run = []; }
      if (p) run.push(p);
    });
    if (run.length) runs.push(run);
    const color = C.color(pal, si);
    runs.forEach((r) => {
      const upper = r.map((p) => C.round(p.x) + "," + C.round(ax.y(p.end)));
      if (r.length > 1) {
        const lower = [...r].reverse().map((p) => C.round(p.x) + "," + C.round(ax.y(p.start)));
        body += '<path class="chcmp-area" d="M' + upper.join(" L") + " L" + lower.join(" L") + ' Z" fill="' + color + '" fill-opacity="' + (stacked ? ".72" : ".2") + '"/>';
        body += '<polyline points="' + upper.join(" ") + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"' + C.dash(pal, si) + '/>';
      }
      r.forEach((p) => { body += '<circle cx="' + C.round(p.x) + '" cy="' + C.round(ax.y(p.end)) + '" r="3" fill="var(--color-surface)" stroke="' + color + '" stroke-width="2"><title>' + C.esc(labels[p.index] + " · " + s.name + ": " + C.fmt(p.value, unit)) + '</title></circle>'; });
    });
  });
  return { w: W, h: H, body, desc: C.finding(labels, stacked ? { name: "합계", data: stack.totals.map((v, i) => series.some((s) => s.data[i] === null) ? null : v) } : series[0], unit), legend: C.legend(series.map((s) => s.name), pal),
    table: C.table(h.str(d.title, "영역 그래프", 80), ["항목", ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => C.fmt(s.data[i], unit))])) };
}

registerComponent({
  id: "chart-area", family: "chart", name: "영역 그래프",
  description: "Multi-series area chart over ordered time labels: labels, series [{name, data}], stacked: true by default or false for overlapping areas, missing values leave gaps, unit and xTitle.",
  schema: { type: "object", properties: { ...chcmpProps, stacked: { type: "boolean" } }, required: ["labels"] },
  presets: { paper: { palette: "mono", figure: true }, report: { compact: true }, friendly: {}, showcase: { height: "l" } },
  defaults: { labels: [], series: [], stacked: true },
  sample: { title: "월별 유입 추이", subtitle: "채널별 방문자 수와 전체 성장 추이입니다.", labels: ["1월", "2월", "3월", "4월", "5월", "6월"], series: [{ name: "검색", data: [400, 600, 720, 680, 900, 1100] }, { name: "직접 방문", data: [240, 320, 380, 420, 480, 560] }, { name: "SNS", data: [160, 180, 240, 300, 320, 440] }], caption: "월별 방문자 수 (단위: 명)" },
  slash: { label: "영역 그래프", hint: "시간별 구성과 변화", ico: "◩", aliases: "영역 면적 누적 추이 area stacked overlap trend chart" },
  css: "",
  render(d, h) { return chcmpFigure("area", "영역 그래프", d, h, chcmpAreaBody); },
});
