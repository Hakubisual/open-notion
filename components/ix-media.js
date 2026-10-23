import { registerComponent } from "../component-registry.js";

const ixmPresets = { report: { compact: true }, friendly: {}, paper: {}, showcase: {} };
const ixmProps = { title: { type: "string" }, subtitle: { type: "string" }, caption: { type: "string" }, preset: { type: "string", enum: ["report", "friendly", "paper", "showcase"] } };

function ixmFrame(d, h, title, body) {
  return '<figure class="ixm-frame" role="group" aria-label="' + h.esc(h.str(d.title, title, 80)) + '"><header class="ixm-head"><strong>' + h.esc(h.str(d.title, title, 80)) + '</strong>' + (h.str(d.subtitle, "", 160) ? '<p>' + h.esc(h.str(d.subtitle, "", 160)) + '</p>' : '') + '</header>' + body + (h.str(d.caption, "", 240) ? '<figcaption>' + h.esc(h.str(d.caption, "", 240)) + '</figcaption>' : '') + '</figure>';
}

function ixmCss(id) {
  const s = '.ui-' + id;
  return s + '{container-type:inline-size;min-width:0}' + s + ' .ixm-frame{margin:0;padding:var(--space-5);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-text);box-shadow:var(--shadow-sm);overflow-wrap:anywhere;font-variant-numeric:tabular-nums;break-inside:avoid}' +
    s + ' .ixm-head{margin-bottom:var(--space-4)}' + s + ' .ixm-head strong{font-size:var(--fs-17);line-height:1.35}' + s + ' .ixm-head p,' + s + ' figcaption{margin:var(--space-1) 0 0;color:var(--color-text-dim);font-size:var(--fs-13);line-height:1.6}' + s + ' figcaption{margin-top:var(--space-3)}' + s + ' .ixm-empty{padding:var(--space-5);margin:0;text-align:center;color:var(--color-text-dim);font-size:var(--fs-14)}' +
    s + '[data-preset=report] .ixm-frame{padding:var(--space-4)}' + s + '[data-preset=paper] .ixm-frame{box-shadow:none}' + s + '[data-preset=showcase] .ixm-frame{padding:var(--space-6)}' +
    '@container (max-width:389px){' + s + ' .ixm-frame{padding:var(--space-4)}}@media print{' + s + ' .ixm-frame{box-shadow:none;print-color-adjust:exact}}';
}

// Deliberately accept local, unambiguous path segments only: no traversal, scheme, encoding or backslash.
function ixmImage(value, h) {
  const path = h.str(value, "", 600);
  return /^\/(media|kit)\/[A-Za-z0-9_./-]+$/.test(path) && path.split('/').slice(2).every((part) => part && part !== '.' && part !== '..') ? path : '';
}

function ixmPane(raw, h, after) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const label = h.str(d.label, after ? '후' : '전', 40), image = ixmImage(d.image, h);
  const color = h.oneOf(d.color, ['neutral', 'accent', 'info', 'success', 'warning', 'danger'], after ? 'accent' : 'neutral');
  return '<section class="ixm-pane ixm-tone-' + color + '"><span class="ixm-pane-label">' + h.esc(label) + '</span>' + (image ? '<img src="' + h.esc(image) + '" alt="' + h.esc(h.str(d.alt, label, 160)) + '" loading="lazy">' : '<div class="ixm-pane-text"><span aria-hidden="true">' + (after ? '✦' : '◇') + '</span><strong>' + h.esc(h.str(d.text, after ? '새로운 모습' : '이전 모습', 240)) + '</strong></div>') + '</section>';
}

const ixmPaneSchema = { type: 'object', properties: { label: { type: 'string' }, image: { type: 'string', description: 'Local /media/ or /kit/ image path without query strings or encoded segments.' }, alt: { type: 'string' }, text: { type: 'string' }, color: { type: 'string', enum: ['neutral', 'accent', 'info', 'success', 'warning', 'danger'] } } };

registerComponent({
  id: "ix-compare", family: "interactive", name: "전후 비교",
  description: "Script-free horizontally scrolling before/after comparison with before and after objects containing label, local image path or text and semantic color; narrow screens and print show both sides together.",
  schema: { type: 'object', properties: { ...ixmProps, before: ixmPaneSchema, after: ixmPaneSchema }, required: ['before', 'after'] },
  defaults: { before: {}, after: {} }, presets: ixmPresets,
  sample: { title: '비교 슬라이더', subtitle: '가로로 스크롤하여 전후를 비교합니다.', before: { label: '전', text: '흩어진 생각', color: 'neutral' }, after: { label: '후', text: '한눈에 정리된 노트', color: 'accent' } },
  slash: { label: '전후 비교', hint: '이미지나 텍스트 나란히 비교', ico: '◧', aliases: '전후 비교 이미지 compare before after split' },
  css: ixmCss('ix-compare') + '.ui-ix-compare .ixm-scroll{overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;border-radius:var(--radius-sm);outline-offset:4px}.ui-ix-compare .ixm-scroll:focus-visible{outline:2px solid var(--color-accent)}.ui-ix-compare .ixm-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:120%;position:relative}.ui-ix-compare .ixm-pane{position:relative;min-width:0;min-height:210px;scroll-snap-align:start;display:grid;overflow:hidden}.ui-ix-compare .ixm-pane:last-of-type{scroll-snap-align:end}.ui-ix-compare .ixm-pane-label{position:absolute;top:var(--space-3);left:var(--space-3);z-index:1;padding:var(--space-1) var(--space-3);border-radius:var(--radius-xs);background:var(--color-text);color:var(--color-bg);font-size:var(--fs-12)}.ui-ix-compare .ixm-pane:last-of-type .ixm-pane-label{left:auto;right:var(--space-3)}.ui-ix-compare .ixm-pane img{width:100%;height:100%;min-height:210px;object-fit:cover}.ui-ix-compare .ixm-pane-text{padding:var(--space-7) var(--space-4) var(--space-5);display:grid;align-content:center;justify-items:center;gap:var(--space-3);text-align:center;font-size:var(--fs-17)}.ui-ix-compare .ixm-pane-text>span{font-size:var(--fs-44)}.ui-ix-compare .ixm-tone-neutral{background:var(--color-neutral-bg);color:var(--color-neutral-fg)}.ui-ix-compare .ixm-tone-accent{background:var(--color-accent-soft);color:var(--color-accent-strong)}.ui-ix-compare .ixm-tone-info{background:var(--color-info-bg);color:var(--color-info-fg)}.ui-ix-compare .ixm-tone-success{background:var(--color-success-bg);color:var(--color-success-fg)}.ui-ix-compare .ixm-tone-warning{background:var(--color-warning-bg);color:var(--color-warning-fg)}.ui-ix-compare .ixm-tone-danger{background:var(--color-danger-bg);color:var(--color-danger-fg)}.ui-ix-compare .ixm-divider{position:absolute;left:50%;top:0;bottom:0;border-left:2px solid var(--color-surface);pointer-events:none}.ui-ix-compare .ixm-divider span{position:absolute;top:50%;left:0;transform:translate(-50%,-50%);display:grid;place-items:center;width:36px;height:36px;border:2px solid var(--color-accent);border-radius:var(--radius-pill);background:var(--color-surface);color:var(--color-accent-strong);box-shadow:var(--shadow-sm);font-size:var(--fs-14)}@container (max-width:519px){.ui-ix-compare .ixm-split{width:100%}.ui-ix-compare .ixm-scroll{overflow:visible}.ui-ix-compare .ixm-pane{min-height:180px}.ui-ix-compare .ixm-pane-text{font-size:var(--fs-14)}}@media print{.ui-ix-compare .ixm-scroll{overflow:visible}.ui-ix-compare .ixm-split{width:100%}.ui-ix-compare .ixm-pane{break-inside:avoid}}',
  render(d, h) { return ixmFrame(d, h, '전후 비교', '<div class="ixm-scroll" tabindex="0" role="region" aria-label="전후 비교, 넓은 화면에서 좌우 방향키로 스크롤"><div class="ixm-split">' + ixmPane(d.before, h, false) + ixmPane(d.after, h, true) + '<span class="ixm-divider" aria-hidden="true"><span>◀▶</span></span></div></div>'); },
});

function ixmNumber(value, fallback) {
  return (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

// Dividing before subtracting avoids overflowing when finite endpoints span nearly the entire number range.
function ixmPercent(value, min, max) {
  const scale = Math.max(Math.abs(min), Math.abs(max));
  return Math.max(0, Math.min(100, (value / scale - min / scale) / (max / scale - min / scale) * 100));
}

registerComponent({
  id: "ix-slider", family: "interactive", name: "값 슬라이더",
  description: "Static documentation slider rendered as a labelled meter with min, max, value, label and numeric marks rather than an editable range input.",
  schema: { type: 'object', properties: { ...ixmProps, min: { type: 'number' }, max: { type: 'number' }, value: { type: 'number' }, label: { type: 'string' }, marks: { type: 'array', items: { type: 'number' } } }, required: ['value'] },
  defaults: { min: 0, max: 100, value: 50, marks: [] }, presets: ixmPresets,
  sample: { title: '값 슬라이더', subtitle: '문서에 저장된 값을 보여줍니다.', label: '집중도', min: 0, max: 100, value: 60, marks: [0, 20, 40, 60, 80, 100] },
  slash: { label: '값 슬라이더', hint: '문서용 정적 값 표시', ico: '↔', aliases: '범위 값 슬라이더 slider range meter value' },
  css: ixmCss('ix-slider') + '.ui-ix-slider .ixm-meter-label{display:flex;justify-content:space-between;gap:var(--space-3);font-size:var(--fs-13);color:var(--color-text-dim)}.ui-ix-slider .ixm-meter-label b{color:var(--color-text)}.ui-ix-slider .ixm-meter{padding:var(--space-6) 10px var(--space-4)}.ui-ix-slider .ixm-track{position:relative;height:8px;background:var(--color-surface-soft);border-radius:var(--radius-pill)}.ui-ix-slider .ixm-fill{position:absolute;inset:0 auto 0 0;width:var(--ixm-value);border-radius:inherit;background:var(--color-accent)}.ui-ix-slider .ixm-thumb{position:absolute;left:var(--ixm-value);top:50%;transform:translate(-50%,-50%);width:20px;height:20px;box-sizing:border-box;border:2px solid var(--color-accent);border-radius:var(--radius-pill);background:var(--color-surface);box-shadow:var(--shadow-sm)}.ui-ix-slider .ixm-marks{position:relative;height:26px;margin-top:var(--space-4);font-size:var(--fs-11);color:var(--color-text-dim)}.ui-ix-slider .ixm-mark{position:absolute;left:var(--ixm-mark);transform:translateX(-50%);white-space:nowrap}.ui-ix-slider .ixm-mark:first-child{transform:none}.ui-ix-slider .ixm-mark:last-child{transform:translateX(-100%)}.ui-ix-slider .ixm-values{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:var(--space-2) 0 0;padding:0;list-style:none;font-size:var(--fs-12);color:var(--color-text-dim)}',
  render(d, h) {
    let min = ixmNumber(d.min, 0), max = ixmNumber(d.max, 100);
    if (max < min) [min, max] = [max, min];
    if (max === min) { min = 0; max = 100; }
    const value = Math.max(min, Math.min(max, ixmNumber(d.value, min)));
    const label = h.str(d.label, '값', 80), percent = ixmPercent(value, min, max);
    const marks = [...new Set([min, ...h.list(d.marks, 24).map((v) => ixmNumber(v, NaN)).filter((v) => Number.isFinite(v) && v >= min && v <= max), max])].sort((a, b) => a - b);
    // Only well-separated short labels sit on the track. Every requested mark remains in the wrapped legend.
    const visible = [min];
    for (const mark of marks.slice(1, -1)) if (ixmPercent(mark, min, max) - ixmPercent(visible[visible.length - 1], min, max) >= 19 && ixmPercent(mark, min, max) <= 81) visible.push(mark);
    visible.push(max);
    const fmt = (v) => Math.abs(v) >= 1e6 || v !== 0 && Math.abs(v) < 0.001 ? v.toExponential(1) : v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
    const ticks = visible.map((mark) => '<span class="ixm-mark" style="--ixm-mark:' + ixmPercent(mark, min, max) + '%">' + h.esc(fmt(mark)) + '</span>').join('');
    const legend = marks.some((m) => !visible.includes(m)) || marks.some((m) => fmt(m).length > 6) ? '<ul class="ixm-values" aria-label="눈금">' + marks.map((mark) => '<li>' + h.esc(String(mark)) + '</li>').join('') + '</ul>' : '';
    return ixmFrame(d, h, '값 슬라이더', '<div class="ixm-meter-label"><span>' + h.esc(label) + '</span><b>' + h.esc(String(value)) + '</b></div><div class="ixm-meter" role="meter" aria-label="' + h.esc(label) + '" aria-valuemin="' + min + '" aria-valuemax="' + max + '" aria-valuenow="' + value + '" style="--ixm-value:' + percent + '%"><div class="ixm-track" aria-hidden="true"><span class="ixm-fill"></span><span class="ixm-thumb"></span></div><div class="ixm-marks" aria-hidden="true">' + (marks.some((m) => fmt(m).length > 6) ? '' : ticks) + '</div></div>' + legend);
  },
});

registerComponent({
  id: "ix-scroll-reveal", family: "interactive", name: "스크롤 리빌",
  description: "Cards with icon, title and text progressively fade and rise on view timelines where supported, remaining fully visible with reduced motion, unsupported browsers and print.",
  schema: { type: 'object', properties: { ...ixmProps, cards: { type: 'array', items: { type: 'object', properties: { icon: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } } } } }, required: ['cards'] },
  defaults: { cards: [] }, presets: ixmPresets,
  sample: { title: '스크롤 리빌', subtitle: '스크롤 시 부드럽게 나타나는 카드입니다.', cards: [{ icon: '▤', title: '빠른 기록', text: '생각이 떠오르는 순간 바로 기록할 수 있어요.' }, { icon: '♧', title: '함께 성장', text: '팀과 아이디어를 공유하고 발전시켜요.' }, { icon: '▥', title: '데이터로 확인', text: '쌓인 노트가 만드는 성장을 확인해 보세요.' }] },
  slash: { label: '스크롤 리빌', hint: '스크롤에 따라 드러나는 카드', ico: '▤', aliases: '스크롤 리빌 카드 등장 scroll reveal cards fade' },
  css: ixmCss('ix-scroll-reveal') + '.ui-ix-scroll-reveal .ixm-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-2)}.ui-ix-scroll-reveal .ixm-card{min-width:0;padding:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-sm);opacity:1;transform:none}.ui-ix-scroll-reveal .ixm-icon{display:grid;place-items:center;width:42px;height:42px;margin-bottom:var(--space-3);border-radius:var(--radius-pill);background:var(--color-accent-soft);color:var(--color-accent-strong);font-size:var(--fs-24)}.ui-ix-scroll-reveal .ixm-card:nth-child(3n+2) .ixm-icon{background:var(--color-info-bg);color:var(--color-info-fg)}.ui-ix-scroll-reveal .ixm-card:nth-child(3n) .ixm-icon{background:var(--color-danger-bg);color:var(--color-danger-fg)}.ui-ix-scroll-reveal .ixm-card h3{margin:0;font-size:var(--fs-14);line-height:1.5}.ui-ix-scroll-reveal .ixm-card p{margin:var(--space-2) 0 0;font-size:var(--fs-12);line-height:1.65;color:var(--color-text-dim)}.ui-ix-scroll-reveal .ixm-lines{display:grid;gap:var(--space-1);margin-top:var(--space-3)}.ui-ix-scroll-reveal .ixm-lines::before,.ui-ix-scroll-reveal .ixm-lines::after{content:"";height:6px;width:85%;background:var(--color-surface-soft);border-radius:var(--radius-pill)}.ui-ix-scroll-reveal .ixm-lines::after{width:60%}@container (max-width:389px){.ui-ix-scroll-reveal .ixm-cards{grid-template-columns:minmax(0,1fr)}.ui-ix-scroll-reveal .ixm-card{padding:var(--space-4)}}@supports (animation-timeline:view()){@media (prefers-reduced-motion:no-preference){.ui-ix-scroll-reveal .ixm-card{animation:ixm-rise linear both;animation-timeline:view();animation-range:entry 0% entry 100%}}}@keyframes ixm-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}@media print{.ui-ix-scroll-reveal .ixm-card{animation:none;opacity:1;transform:none;break-inside:avoid}.ui-ix-scroll-reveal .ixm-cards{display:grid}}',
  render(d, h) {
    const cards = h.list(d.cards, 12).filter((card) => card && typeof card === 'object' && !Array.isArray(card));
    const body = cards.length ? '<div class="ixm-cards">' + cards.map((card) => '<article class="ixm-card"><span class="ixm-icon" aria-hidden="true">' + h.esc(h.str(card.icon, '◇', 12)) + '</span><h3>' + h.esc(h.str(card.title, '제목 없음', 80)) + '</h3><p>' + h.esc(h.str(card.text, '', 400)) + '</p><span class="ixm-lines" aria-hidden="true"></span></article>').join('') + '</div>' : '<p class="ixm-empty">카드를 넣으면 여기에 표시돼요.</p>';
    return ixmFrame(d, h, '스크롤 리빌', body);
  },
});

registerComponent({
  id: "ix-sortable", family: "interactive", name: "정렬 목록 예시",
  description: "Static ordered tutorial list of items with label and note, decorative grip handles and one lifted item; data order is preserved and no drag behavior is implied.",
  schema: { type: 'object', properties: { ...ixmProps, items: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, note: { type: 'string' } } } } }, required: ['items'] },
  defaults: { items: [] }, presets: ixmPresets,
  sample: { title: '드래그 정렬 예시', subtitle: '문서용 정렬 예시입니다. 실제 순서는 데이터 순서입니다.', items: [{ label: '프로젝트 기획서', note: '목표와 일정을 정리해요.' }, { label: '레퍼런스 모음', note: '좋은 아이디어를 모아요.' }, { label: '회의 노트', note: '함께 나눈 내용을 기록해요.' }, { label: '아이디어 정리', note: '다음 작업을 준비해요.' }] },
  slash: { label: '정렬 목록 예시', hint: '드래그 정렬의 정적 문서 예시', ico: '☷', aliases: '드래그 정렬 목록 순서 sortable drag ordered list' },
  css: ixmCss('ix-sortable') + '.ui-ix-sortable .ixm-list{display:grid;gap:var(--space-3);margin:0;padding:var(--space-2) 0;list-style:none;counter-reset:ixm-order}.ui-ix-sortable .ixm-item{counter-increment:ixm-order;display:flex;align-items:center;gap:var(--space-3);min-width:0;padding:var(--space-3) var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface-soft)}.ui-ix-sortable .ixm-grip{flex:none;color:var(--color-text-dim);font-size:var(--fs-20);letter-spacing:-.08em}.ui-ix-sortable .ixm-item-content{min-width:0;flex:1}.ui-ix-sortable .ixm-item strong{display:block;font-size:var(--fs-14);line-height:1.5}.ui-ix-sortable .ixm-item strong::before{content:counter(ixm-order) ". ";color:var(--color-text-dim);font-weight:400}.ui-ix-sortable .ixm-item small{display:block;margin-top:var(--space-1);font-size:var(--fs-12);color:var(--color-text-dim);line-height:1.5}.ui-ix-sortable .ixm-lifted{transform:translateY(-2px);border-color:var(--color-accent);background:var(--color-accent-soft);box-shadow:var(--shadow-md)}.ui-ix-sortable .ixm-menu{font-size:var(--fs-20);color:var(--color-text-dim)}@media print{.ui-ix-sortable .ixm-lifted{transform:none;box-shadow:none}.ui-ix-sortable .ixm-item{break-inside:avoid}}',
  render(d, h) {
    const items = h.list(d.items, 24).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    const body = items.length ? '<ol class="ixm-list" role="list">' + items.map((item, i) => '<li class="ixm-item' + (i === Math.min(1, items.length - 1) ? ' ixm-lifted' : '') + '"><span class="ixm-grip" aria-hidden="true">⠿</span><div class="ixm-item-content"><strong>' + h.esc(h.str(item.label, '항목 ' + (i + 1), 120)) + '</strong>' + (h.str(item.note, '', 240) ? '<small>' + h.esc(h.str(item.note, '', 240)) + '</small>' : '') + '</div><span class="ixm-menu" aria-hidden="true">⋮</span></li>').join('') + '</ol>' : '<p class="ixm-empty">항목을 넣으면 순서대로 표시돼요.</p>';
    return ixmFrame(d, h, '정렬 목록 예시', body);
  },
});
