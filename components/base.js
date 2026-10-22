// Base components: stat (지표 카드) and empty (빈 상태). Contract: component-registry.js.
import { registerComponent, UI_TONES } from "../component-registry.js";

registerComponent({
  id: "stat", name: "지표 카드",
  description: "One key number with a label, an optional delta (\"+12%\" green, \"-3%\" red) and a short note.",
  schema: { type: "object", properties: { label: { type: "string" }, value: { type: ["string", "number"] }, delta: { type: "string" }, note: { type: "string" }, tone: { enum: UI_TONES } }, required: ["label", "value"] },
  defaults: { label: "지표", value: "—", tone: "neutral" },
  sample: { label: "가입 전환율", value: "18.4%", delta: "+12%", note: "지난주 대비" },
  slash: { label: "지표 카드", hint: "숫자 하나 크게", ico: "#", aliases: "지표 숫자 통계 kpi stat metric" },
  css: ".ui-stat{display:inline-flex;flex-direction:column;gap:var(--space-1);min-width:min(200px,100%);max-width:100%;padding:var(--space-4) var(--space-5);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);box-shadow:var(--shadow-sm);transition:border-color var(--dur-base),box-shadow var(--dur-base),transform var(--dur-base)}" +
    // Fluid width: in a column cell the card fills the cell, and as the cell's last block it reaches the row height.
    ".col>:is(.ui-stat){display:flex}.col:has(>.ui-stat:last-child){display:flex;flex-direction:column}.col:has(>.ui-stat:last-child)>*{margin-bottom:0}.col>.ui-stat:last-child{flex:1 0 auto}" +
    "@media (hover:hover){.ui-stat:hover{border-color:color-mix(in srgb,var(--color-accent) 45%,var(--color-border));box-shadow:var(--shadow-md)}}@media (hover:hover) and (prefers-reduced-motion:no-preference){.ui-stat:hover{transform:translateY(-1px)}}" +
    ".ui-stat-label{color:var(--color-text-dim);font-size:var(--fs-13)}.ui-stat-value{font-size:var(--fs-28);font-weight:750;letter-spacing:var(--ls-heading);line-height:var(--lh-tight)}.ui-stat-note{color:var(--color-text-dim);font-size:var(--fs-12)}.ui-delta{align-self:flex-start;padding:2px var(--space-2);border-radius:var(--radius-pill);font-size:var(--fs-12);font-weight:650;background:var(--color-neutral-bg);color:var(--color-neutral-fg)}.ui-delta.up{background:var(--color-success-bg);color:var(--color-success-fg)}.ui-delta.down{background:var(--color-danger-bg);color:var(--color-danger-fg)}",
  render(d, h) {
    const delta = h.str(d.delta, "");
    const dir = /^\s*[-−↓]/.test(delta) ? "down" : delta ? "up" : "";
    return '<div class="ui-stat-label">' + h.rich(h.str(d.label, "지표", 80)) + '</div><div class="ui-stat-value">' + h.esc(h.str(d.value, "—", 40)) + "</div>" +
      (delta ? '<span class="ui-delta ' + dir + '">' + h.esc(delta.slice(0, 16)) + "</span>" : "") +
      (h.str(d.note, "") ? '<div class="ui-stat-note">' + h.rich(h.str(d.note, "", 160)) + "</div>" : "");
  },
});

registerComponent({
  id: "empty", name: "빈 상태",
  description: "Friendly empty state: a title, one line of help and an optional link button {label, href}.",
  schema: { type: "object", properties: { title: { type: "string" }, text: { type: "string" }, icon: { type: "string" }, action: { type: "object", properties: { label: { type: "string" }, href: { type: "string" } } } } },
  defaults: { title: "아직 내용이 없어요", icon: "📄" },
  sample: { title: "아직 페이지가 없어요", text: "새 페이지를 만들어 문서를 시작해 보세요.", icon: "📄", action: { label: "새 페이지", href: "/new" } },
  slash: { label: "빈 상태", hint: "비어 있을 때 안내", ico: "○", aliases: "빈상태 empty 안내 비어있음" },
  css: ".ui-empty{display:flex;flex-direction:column;align-items:center;gap:var(--space-2);padding:var(--space-8) var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);text-align:center}.ui-empty-ico{display:grid;place-items:center;width:48px;height:48px;border-radius:var(--radius-pill);background:var(--color-surface-soft);font-size:var(--fs-21)}.ui-empty-title{font-weight:700;font-size:var(--fs-17)}.ui-empty-text{margin:0;color:var(--color-text-dim);font-size:var(--fs-14)}",
  render(d, h) {
    const a = d.action && typeof d.action === "object" ? d.action : null;
    const href = a && /^(https?:\/\/|\/)/.test(String(a.href || "")) ? String(a.href) : "";
    return '<div class="ui-empty-ico" aria-hidden="true">' + h.esc([...h.str(d.icon, "📄", 16)].slice(0, 2).join("")) + "</div>" +
      '<div class="ui-empty-title">' + h.rich(h.str(d.title, "아직 내용이 없어요", 80)) + "</div>" +
      (h.str(d.text, "") ? '<p class="ui-empty-text">' + h.rich(h.str(d.text, "", 200)) + "</p>" : "") +
      (a && href ? '<a class="ui-btn primary" href="' + h.esc(href) + '">' + h.esc(h.str(a.label, "열기", 40)) + "</a>" : "");
  },
});
