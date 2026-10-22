// Stat row (지표 묶음): 2-4 key numbers side by side, stacked on phones. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const STATROW_MAX = 4;

registerComponent({
  id: "stat-row", name: "지표 묶음",
  description: "2-4 key numbers in one row (stacked on phones). items: [{label, value, delta (\"+12%\" green, \"-3%\" red), note}], at most 4.",
  schema: { type: "object", properties: { items: { type: "array", minItems: 1, maxItems: STATROW_MAX, items: { type: "object", properties: { label: { type: "string" }, value: { type: ["string", "number"] }, delta: { type: "string" }, note: { type: "string" } }, required: ["label", "value"] } } }, required: ["items"] },
  defaults: { items: [{ label: "지표", value: "—" }, { label: "지표", value: "—" }] },
  sample: { items: [
    { label: "가입 전환율", value: "18.4%", delta: "+12%", note: "지난주 대비" },
    { label: "첫 문서까지", value: "2분 10초", delta: "-3%" },
    { label: "7일 재방문", value: "41%", delta: "+12%" },
  ] },
  slash: { label: "지표 묶음", hint: "숫자 2~4개 한 줄", ico: "▥", aliases: "지표묶음 지표 숫자 통계 대시보드 성과 kpi stats metrics numbers dashboard row" },
  // Fluid width: as many of the items side by side as the row's own width allows (each at least 160px).
  css: ".ui-stat-row{container-type:inline-size}.ui-statrow{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,max(160px,calc((100% - (var(--sr-n) - 1) * var(--space-3)) / var(--sr-n) - 1px))),1fr));gap:var(--space-3)}" +
    ".ui-statrow-item{display:flex;flex-direction:column;gap:var(--space-1);min-width:0;padding:var(--space-4) var(--space-5);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);box-shadow:var(--shadow-sm);transition:border-color var(--dur-base),box-shadow var(--dur-base)}" +
    "@media (hover:hover){.ui-statrow-item:hover{border-color:color-mix(in srgb,var(--color-accent) 45%,var(--color-border));box-shadow:var(--shadow-md)}}" +
    ".ui-statrow-label{color:var(--color-text-dim);font-size:var(--fs-13)}" +
    ".ui-statrow-line{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-2)}" +
    ".ui-statrow-value{font-size:var(--fs-28);font-weight:750;letter-spacing:var(--ls-heading);line-height:var(--lh-tight);overflow-wrap:anywhere}" +
    ".ui-statrow-delta{flex:none;padding:2px var(--space-2);border-radius:var(--radius-pill);font-size:var(--fs-12);font-weight:650;background:var(--color-neutral-bg);color:var(--color-neutral-fg)}" +
    ".ui-statrow-delta.up{background:var(--color-success-bg);color:var(--color-success-fg)}.ui-statrow-delta.down{background:var(--color-danger-bg);color:var(--color-danger-fg)}" +
    ".ui-statrow-note{color:var(--color-text-dim);font-size:var(--fs-12)}" +
    "@container (max-width:519px){.ui-statrow-value{font-size:var(--fs-24)}}",
  render(d, h) {
    const items = h.list(d.items, STATROW_MAX).filter((it) => it && typeof it === "object");
    return '<div class="ui-statrow" style="--sr-n:' + Math.max(items.length, 1) + '">' + items.map((it) => {
      const delta = h.str(it.delta, "", 16);
      const dir = /^\s*[-−↓]/.test(delta) ? "down" : /^\s*[+↑]/.test(delta) ? "up" : "";
      const note = h.str(it.note, "", 160);
      return '<div class="ui-statrow-item"><div class="ui-statrow-label">' + h.rich(h.str(it.label, "지표", 80)) + "</div>" +
        '<div class="ui-statrow-line"><span class="ui-statrow-value">' + h.esc(h.str(it.value, "—", 40)) + "</span>" +
        (delta ? '<span class="ui-statrow-delta' + (dir ? " " + dir : "") + '">' + h.esc(delta) + "</span>" : "") + "</div>" +
        (note ? '<div class="ui-statrow-note">' + h.rich(note) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  },
});
