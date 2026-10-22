// Badges (배지): a row of pastel status pills with a tone dot. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const BADGE_TONES = ["neutral", "info", "success", "warning", "danger", "accent"];
const BADGES_MAX = 24;

registerComponent({
  id: "badges", name: "배지",
  description: "Row of pastel pills, items: [{text, tone}] with tone neutral|info|success|warning|danger|accent (unknown tones draw neutral). Up to 24.",
  schema: { type: "object", properties: { items: { type: "array", maxItems: BADGES_MAX, items: { type: "object", properties: { text: { type: "string" }, tone: { enum: BADGE_TONES } }, required: ["text"] } } }, required: ["items"] },
  defaults: { items: [{ text: "배지", tone: "neutral" }] },
  sample: { items: [
    { text: "완료", tone: "success" }, { text: "진행 중", tone: "info" }, { text: "결정 필요", tone: "accent" },
    { text: "높음", tone: "danger" }, { text: "보통", tone: "warning" }, { text: "낮음", tone: "neutral" },
  ] },
  slash: { label: "배지", hint: "상태·태그 알약", ico: "◉", aliases: "배지 태그 상태 라벨 우선순위 badge badges tag tags status label pill chip" },
  css: "ul.ui-badges{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:0;padding:0;list-style:none}" +
    ".ui-badges-item{display:inline-flex;align-items:center;gap:var(--space-2);height:var(--control-h-sm);padding:0 var(--space-3);border-radius:var(--radius-pill);background:var(--bd-bg);color:var(--bd-fg);font-size:var(--fs-13);font-weight:600;white-space:nowrap}" +
    ".ui-badges-item::before{content:\"\";flex:none;width:8px;height:8px;border-radius:var(--radius-pill);background:currentColor}" +
    BADGE_TONES.map((t) => ".ui-badges-item.is-" + t + "{--bd-bg:var(--color-" + (t === "accent" ? "accent-soft" : t + "-bg") + ");--bd-fg:var(--color-" + (t === "accent" ? "accent-strong" : t + "-fg") + ")}").join(""),
  render(d, h) {
    const items = h.list(d.items, BADGES_MAX).filter((it) => it && typeof it === "object" && h.str(it.text, ""));
    return '<ul class="ui-badges">' + items.map((it) => '<li class="ui-badges-item is-' + h.oneOf(it.tone, BADGE_TONES, "neutral") + '">' + h.esc(h.str(it.text, "", 40)) + "</li>").join("") + "</ul>";
  },
});
