// Timeline (타임라인): dated events on a vertical rail with state dots. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const TL_UI_STATES = ["done", "doing", "todo"];

registerComponent({
  id: "timeline", name: "타임라인",
  description: "Vertical timeline of dated events. items: [{date, title, text, state}] where state is done (filled dot), doing (ringed dot + 진행 중 pill) or todo (grey dot). Up to 24 items, oldest first.",
  schema: { type: "object", properties: { items: { type: "array", maxItems: 24, items: { type: "object", properties: { date: { type: "string" }, title: { type: "string" }, text: { type: "string" }, state: { enum: TL_UI_STATES } }, required: ["title"] } } }, required: ["items"] },
  defaults: { items: [] },
  sample: { items: [
    { date: "2024년 8월 20일", title: "프로젝트 기획 완료", text: "요구사항 수집과 기획을 마쳤어요.", state: "done" },
    { date: "2024년 9월 6일", title: "디자인 시안 확정", text: "주요 화면의 디자인을 확정했어요.", state: "done" },
    { date: "2024년 10월 4일", title: "개발 작업 진행 중", text: "핵심 기능을 개발하고 있어요.", state: "doing" },
    { date: "2024년 11월 15일", title: "정식 출시", text: "", state: "todo" },
  ] },
  slash: { label: "타임라인", hint: "날짜별 진행 기록", ico: "⋮", aliases: "타임라인 연혁 일정 기록 timeline history" },
  css: ".ui-timeline{container-type:inline-size}.ui-tl{list-style:none;margin:0;padding:0}" +
    ".ui-tl-i{position:relative;display:grid;grid-template-columns:minmax(0,8.5em) 20px minmax(0,1fr);grid-template-areas:'date rail body';column-gap:var(--space-3);margin:0;padding:0 0 var(--space-5)}.ui-tl-i:last-child{padding-bottom:0}" +
    ".ui-tl-date{grid-area:date;color:var(--color-text-dim);font-size:var(--fs-13);font-variant-numeric:tabular-nums;line-height:20px;padding-top:2px}" +
    ".ui-tl-rail{grid-area:rail;position:relative;display:flex;justify-content:center}.ui-tl-rail::after{content:\"\";position:absolute;top:20px;bottom:calc(-1 * var(--space-5) + 4px);left:calc(50% - 1px);width:2px;border-radius:var(--radius-pill);background:var(--color-border)}.ui-tl-i:last-child .ui-tl-rail::after{display:none}.ui-tl-i.ui-tl-done .ui-tl-rail::after{background:var(--color-accent-soft)}" +
    ".ui-tl-dot{box-sizing:border-box;width:12px;height:12px;margin-top:6px;border-radius:var(--radius-pill);border:2px solid var(--color-border);background:var(--color-surface)}.ui-tl-i.ui-tl-done .ui-tl-dot{border-color:var(--color-accent);background:var(--color-accent)}.ui-tl-i.ui-tl-doing .ui-tl-dot{border-color:var(--color-accent);background:var(--color-surface);box-shadow:0 0 0 4px var(--color-accent-soft)}" +
    ".ui-tl-body{grid-area:body;min-width:0}.ui-tl-title{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);font-size:var(--fs-15);font-weight:650;line-height:24px}.ui-tl-i.ui-tl-todo .ui-tl-title{color:var(--color-text-dim)}" +
    ".ui-tl-pill{padding:1px var(--space-2);border-radius:var(--radius-pill);background:var(--color-accent-soft);color:var(--color-accent);font-size:var(--fs-12);font-weight:650}" +
    ".ui-tl-text{margin:var(--space-1) 0 0;color:var(--color-text-dim);font-size:var(--fs-14);line-height:var(--lh-body);overflow-wrap:anywhere}" +
    ".ui-tl-dot{transition:border-color var(--dur-base),outline-color var(--dur-base)}@media (hover:hover){.ui-tl-i:hover .ui-tl-dot{border-color:var(--color-accent);outline:4px solid var(--color-accent-soft)}.ui-tl-i.ui-tl-todo:hover .ui-tl-title{color:var(--color-text)}}" +
    "@container (max-width:519px){.ui-tl-i{grid-template-columns:20px minmax(0,1fr);grid-template-areas:'rail date' 'rail body';row-gap:2px}}",
  render(d, h) {
    const items = h.list(d.items).filter((it) => it && typeof it === "object");
    if (!items.length) return '<p class="ui-tl-text">아직 기록이 없어요.</p>';
    return '<ol class="ui-tl">' + items.map((it) => {
      const state = h.oneOf(it.state, TL_UI_STATES, "todo");
      const date = h.str(it.date, "", 40);
      const text = h.str(it.text, "", 400);
      return '<li class="ui-tl-i ui-tl-' + state + '"' + (state === "doing" ? ' aria-current="step"' : "") + ">" +
        '<span class="ui-tl-date">' + h.esc(date) + "</span>" +
        '<span class="ui-tl-rail" aria-hidden="true"><span class="ui-tl-dot"></span></span>' +
        '<div class="ui-tl-body"><div class="ui-tl-title">' + h.rich(h.str(it.title, "제목 없음", 120)) + (state === "doing" ? '<span class="ui-tl-pill">진행 중</span>' : "") + "</div>" +
        (text ? '<p class="ui-tl-text">' + h.rich(text).replace(/\n/g, "<br>") + "</p>" : "") + "</div></li>";
    }).join("") + "</ol>";
  },
});
