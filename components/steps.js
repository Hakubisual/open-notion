// Steps (진행 단계): a horizontal stepper that stacks vertically in narrow columns. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const STEPS_UI_CHECK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

registerComponent({
  id: "steps", name: "진행 단계",
  description: "Stepper for a process: items [{title, text, date}] (2-8 steps) and current = 0-based index of the step in progress; earlier steps show a check, later ones a grey dot. Horizontal, stacks vertically under 640px.",
  schema: { type: "object", properties: { items: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" }, date: { type: "string" } }, required: ["title"] } }, current: { type: "integer", minimum: 0 } }, required: ["items"] },
  defaults: { items: [], current: 0 },
  sample: { current: 2, items: [
    { title: "조사", date: "2024년 9월 2일" },
    { title: "시안", date: "2024년 9월 23일" },
    { title: "구현", date: "2024년 10월 21일", text: "핵심 기능 개발" },
    { title: "출시", date: "2024년 11월 18일" },
  ] },
  slash: { label: "진행 단계", hint: "단계별 진행 상황", ico: "①", aliases: "단계 진행 스텝 스테퍼 steps stepper progress" },
  css: ".ui-steps{container-type:inline-size}.ui-st{list-style:none;display:flex;margin:0;padding:0}" +
    ".ui-st-i{position:relative;flex:1 1 0;min-width:0;margin:0;padding:0 var(--space-2);text-align:center}" +
    ".ui-st-i:not(:last-child)::after{content:\"\";position:absolute;top:13px;left:calc(50% + 20px);right:calc(-50% + 20px);border-top:2px dashed var(--color-border)}.ui-st-i.ui-st-done:not(:last-child)::after{border-top-style:solid;border-top-color:var(--color-accent)}" +
    ".ui-st-mark{box-sizing:border-box;display:inline-grid;place-items:center;width:28px;height:28px;border-radius:var(--radius-pill);border:2px solid var(--color-border);background:var(--color-surface);color:var(--color-text-dim);font-size:var(--fs-12);font-weight:700;font-variant-numeric:tabular-nums}" +
    ".ui-st-i.ui-st-done .ui-st-mark{border-color:var(--color-accent);background:var(--color-accent);color:var(--color-on-accent)}.ui-st-i.ui-st-now .ui-st-mark{border-color:var(--color-accent);color:var(--color-accent);box-shadow:0 0 0 4px var(--color-accent-soft)}" +
    ".ui-st-body{display:flex;flex-direction:column;gap:2px;margin-top:var(--space-2)}.ui-st-title{font-size:var(--fs-15);font-weight:650;line-height:var(--lh-ui)}.ui-st-i.ui-st-todo .ui-st-title{color:var(--color-text-dim)}.ui-st-i.ui-st-now .ui-st-title{color:var(--color-accent)}" +
    ".ui-st-date{color:var(--color-text-dim);font-size:var(--fs-13);font-variant-numeric:tabular-nums}.ui-st-text{color:var(--color-text-dim);font-size:var(--fs-13);line-height:var(--lh-ui);overflow-wrap:anywhere}" +
    ".ui-st-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}" +
    ".ui-st-mark{transition:border-color var(--dur-base),outline-color var(--dur-base)}@media (hover:hover){.ui-st-i:hover .ui-st-mark{border-color:var(--color-accent);outline:4px solid var(--color-accent-soft)}.ui-st-i.ui-st-todo:hover .ui-st-title{color:var(--color-text)}}" +
    "@container (max-width:639px){.ui-st{flex-direction:column}.ui-st-i{display:grid;grid-template-columns:28px minmax(0,1fr);column-gap:var(--space-3);padding:0 0 var(--space-4);text-align:left}.ui-st-i:last-child{padding-bottom:0}" +
    ".ui-st-i:not(:last-child)::after{top:32px;bottom:4px;left:13px;right:auto;border-top:0;border-left:2px dashed var(--color-border)}.ui-st-i.ui-st-done:not(:last-child)::after{border-left-style:solid;border-left-color:var(--color-accent)}.ui-st-body{margin-top:3px}}",
  render(d, h) {
    const items = h.list(d.items, 8).filter((it) => it && typeof it === "object");
    if (!items.length) return '<p class="ui-st-text">단계를 items에 적어 주세요.</p>';
    const raw = Number(d.current);
    const current = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    return '<ol class="ui-st">' + items.map((it, i) => {
      const state = i < current ? "done" : i === current ? "now" : "todo";
      const date = h.str(it.date, "", 40);
      const text = h.str(it.text, "", 160);
      return '<li class="ui-st-i ui-st-' + state + '"' + (state === "now" ? ' aria-current="step"' : "") + ">" +
        '<span class="ui-st-mark" aria-hidden="true">' + (state === "done" ? STEPS_UI_CHECK : i + 1) + "</span>" +
        '<span class="ui-st-body"><span class="ui-st-title">' + h.rich(h.str(it.title, "단계 " + (i + 1), 60)) +
        '<span class="ui-st-sr">' + (state === "done" ? " (완료)" : state === "now" ? " (진행 중)" : " (예정)") + "</span></span>" +
        (date ? '<span class="ui-st-date">' + h.esc(date) + "</span>" : "") +
        (text ? '<span class="ui-st-text">' + h.rich(text) + "</span>" : "") + "</span></li>";
    }).join("") + "</ol>";
  },
});
