// Accordion (아코디언): FAQ-style sections on native details/summary, so they open without scripts. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const ACC_UI_CHEVRON = '<svg class="ui-acc-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

registerComponent({
  id: "accordion", name: "아코디언",
  description: "Collapsible sections (FAQ). items: [{title, text, open}]; open: true shows that answer expanded at first. text may hold several paragraphs separated by a blank line.",
  schema: { type: "object", properties: { items: { type: "array", maxItems: 24, items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" }, open: { type: "boolean" } }, required: ["title"] } } }, required: ["items"] },
  defaults: { items: [] },
  sample: { items: [
    { title: "자주 묻는 질문이 있나요?", text: "Acard는 팀의 생각을 정리하고, AI와 함께 더 나은 문서를 만드는 생산성 도구예요.", open: true },
    { title: "요금제는 어떻게 되나요?", text: "개인은 무료로 시작할 수 있어요.\n\n팀 요금제는 멤버 수에 맞춰 정해져요." },
  ] },
  slash: { label: "아코디언", hint: "접고 펼치는 질문·답", ico: "≡", aliases: "아코디언 faq 자주묻는질문 접기 펼치기 accordion collapse" },
  css: ".ui-acc{display:flex;flex-direction:column;gap:var(--space-2)}" +
    ".ui-acc-i{border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);transition:background var(--dur-fast),border-color var(--dur-fast)}.ui-acc-i[open]{border-color:var(--color-accent-soft);background:var(--color-surface-soft)}" +
    ".ui-acc-i>summary{display:flex;align-items:flex-start;gap:var(--space-3);min-height:var(--control-h-lg);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);list-style:none;cursor:pointer;font-size:var(--fs-15);font-weight:600;line-height:20px}.ui-acc-i>summary::-webkit-details-marker{display:none}" +
    ".ui-acc-i>summary:focus-visible{outline:none;box-shadow:var(--focus-ring)}.ui-acc-chev{flex:0 0 auto;height:20px;color:var(--color-text-dim);transition:transform var(--dur-base)}.ui-acc-i[open] .ui-acc-chev{transform:rotate(90deg);color:var(--color-accent)}" +
    ".ui-acc-body{padding:0 var(--space-4) var(--space-4) calc(var(--space-4) + 16px + var(--space-3));color:var(--color-text-dim);font-size:var(--fs-14);line-height:var(--lh-body);overflow-wrap:anywhere}.ui-acc-body>p{margin:0 0 var(--space-2)}.ui-acc-body>p:last-child{margin-bottom:0}",
  render(d, h) {
    const items = h.list(d.items).filter((it) => it && typeof it === "object");
    if (!items.length) return '<p class="ui-acc-body">항목을 items에 적어 주세요.</p>';
    return '<div class="ui-acc">' + items.map((it, i) => {
      const text = h.str(it.text, "", 2000);
      const body = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => "<p>" + h.rich(p).replace(/\n/g, "<br>") + "</p>").join("");
      return '<details class="ui-acc-i"' + (it.open === true ? " open" : "") + "><summary>" + ACC_UI_CHEVRON + "<span>" + h.rich(h.str(it.title, "항목 " + (i + 1), 160)) + "</span></summary>" +
        '<div class="ui-acc-body">' + (body || "<p>내용이 없어요.</p>") + "</div></details>";
    }).join("") + "</div>";
  },
});
