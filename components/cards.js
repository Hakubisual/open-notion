// Card grid (카드 그리드): 2-4 columns of icon + title + text cards, optionally linked. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const CARDS_MAX = 12;

registerComponent({
  id: "card-grid", name: "카드 그리드",
  description: "Grid of small cards, each {icon (emoji), title, text, href (https:// or /path, optional)}. columns 2-4 (default 3); phones show one or two columns. Up to 12 items.",
  schema: { type: "object", properties: { columns: { enum: [2, 3, 4] }, items: { type: "array", maxItems: CARDS_MAX, items: { type: "object", properties: { icon: { type: "string" }, title: { type: "string" }, text: { type: "string" }, href: { type: "string" } }, required: ["title"] } } }, required: ["items"] },
  defaults: { columns: 3, items: [{ icon: "✨", title: "카드 제목", text: "짧은 설명을 적어 주세요." }] },
  sample: { columns: 3, items: [
    { icon: "🚀", title: "빠른 시작", text: "몇 분 만에 시작할 수 있어요.", href: "/new" },
    { icon: "👥", title: "협업", text: "함께 더 좋은 결과를 만들어요." },
    { icon: "✨", title: "생산성", text: "작은 일이 만드는 큰 변화예요." },
  ] },
  slash: { label: "카드 그리드", hint: "아이콘 카드 2~4열", ico: "▦", aliases: "카드 그리드 카드목록 기능소개 특징 바로가기 card grid cards features tiles links" },
  // Fluid width: columns follow the grid's own width (at most `columns`, each card at least 160px), not the screen.
  css: ".ui-card-grid{container-type:inline-size}.ui-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,max(160px,calc((100% - (var(--cg-cols) - 1) * var(--space-3)) / var(--cg-cols) - 1px))),1fr));gap:var(--space-3)}" +
    ".ui-cards-item{display:flex;flex-direction:column;gap:var(--space-1);min-width:0;padding:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);box-shadow:var(--shadow-sm);color:var(--color-text);text-decoration:none;transition:border-color var(--dur-base),box-shadow var(--dur-base),transform var(--dur-base)}" +
    "@media (hover:hover){.ui-cards-item:hover{border-color:color-mix(in srgb,var(--color-accent) 45%,var(--color-border))}a.ui-cards-item:hover{border-color:var(--color-accent);box-shadow:var(--shadow-md)}}" +
    "a.ui-cards-item:hover{text-decoration:none}a.ui-cards-item:focus-visible{outline:none;box-shadow:var(--focus-ring)}" +
    "@media (hover:hover) and (prefers-reduced-motion:no-preference){a.ui-cards-item:hover{transform:translateY(-2px)}}a.ui-cards-item:active{transform:none;box-shadow:var(--shadow-sm)}" +
    ".ui-cards-ico{display:grid;place-items:center;width:36px;height:36px;margin-bottom:var(--space-2);border-radius:var(--radius-sm);background:var(--color-accent-soft);font-size:var(--fs-19);line-height:1}" +
    ".ui-cards-title{font-size:var(--fs-15);font-weight:700;line-height:var(--lh-tight);overflow-wrap:anywhere}" +
    ".ui-cards-text{margin:0;color:var(--color-text-dim);font-size:var(--fs-13);line-height:var(--lh-ui);overflow-wrap:anywhere}" +
    "@container (max-width:419px){.ui-cards{grid-template-columns:minmax(0,1fr)}.ui-cards-item{flex-direction:row;flex-wrap:wrap;align-items:center;column-gap:var(--space-3)}.ui-cards-ico{margin-bottom:0}.ui-cards-title{flex:1}.ui-cards-text{flex-basis:100%}}",
  render(d, h) {
    const cols = h.oneOf(Number(d.columns), [2, 3, 4], 3);
    const items = h.list(d.items, CARDS_MAX).filter((it) => it && typeof it === "object");
    return '<div class="ui-cards" style="--cg-cols:' + cols + '">' + items.map((it) => {
      const href = /^(https?:\/\/|\/(?!\/))/.test(String(it.href || "")) ? String(it.href) : "";
      const icon = h.str(it.icon, "", 8);
      const body = (icon ? '<span class="ui-cards-ico" aria-hidden="true">' + h.esc(icon) + "</span>" : "") +
        '<span class="ui-cards-title">' + h.rich(h.str(it.title, "제목 없음", 80)) + "</span>" +
        (h.str(it.text, "") ? '<p class="ui-cards-text">' + h.rich(h.str(it.text, "", 240)) + "</p>" : "");
      return href ? '<a class="ui-cards-item" href="' + h.esc(href) + '">' + body + "</a>" : '<div class="ui-cards-item">' + body + "</div>";
    }).join("") + "</div>";
  },
});
