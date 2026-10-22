// Tabs (탭): script-free tabs (radio inputs + labels + :checked CSS), so they work on published pages where scripts are
// stripped. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const TABS_UI_MAX = 8;
// render(data, h) gets no block id, so each render takes a fresh suffix: two tabs blocks on one page (even with
// identical data) never share a radio group or a label target.
let tabsUiSeq = 0;

function tabsUiHash(text) {
  let n = 2166136261;
  for (let i = 0; i < text.length; i += 1) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return (n >>> 0).toString(36);
}

function tabsUiParas(text, h) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => "<p>" + h.rich(p).replace(/\n/g, "<br>") + "</p>").join("");
}

function tabsUiCss() {
  let out = "";
  for (let k = 1; k <= TABS_UI_MAX; k += 1) {
    const r = ".ui-tabs-r:nth-of-type(" + k + ")";
    out += r + ":checked~.ui-tabs-bar>.ui-tabs-l:nth-child(" + k + "){color:var(--color-accent);border-bottom-color:var(--color-accent);font-weight:650}" +
      r + ":checked~.ui-tabs-ps>.ui-tabs-p:nth-child(" + k + "){display:block}" +
      r + ":focus-visible~.ui-tabs-bar>.ui-tabs-l:nth-child(" + k + "){box-shadow:var(--focus-ring)}";
  }
  return out;
}

registerComponent({
  id: "tabs", name: "탭",
  description: "Tabs that switch panels without scripts (also on published pages). tabs: [{label, text, icon}] (2-8), text may hold several paragraphs separated by a blank line; selected = 0-based index of the tab shown first.",
  schema: { type: "object", properties: { tabs: { type: "array", minItems: 1, maxItems: TABS_UI_MAX, items: { type: "object", properties: { label: { type: "string" }, text: { type: "string" }, icon: { type: "string" } }, required: ["label"] } }, selected: { type: "integer", minimum: 0 } }, required: ["tabs"] },
  defaults: { tabs: [], selected: 0 },
  sample: { tabs: [
    { label: "요약", icon: "📝", text: "신규 사용자의 첫 문서 작성 경험을 단순하게 만들어 가입 전환율을 높여요." },
    { label: "위험", icon: "⚠️", text: "템플릿이 많아지면 처음 고르기가 어려워질 수 있어요.\n\n추천 템플릿 3개만 먼저 보여 주세요." },
    { label: "다음 할 일", icon: "✅", text: "**10월 28일**까지 온보딩 시안을 확정해요." },
  ] },
  slash: { label: "탭", hint: "내용을 탭으로 나눠 보기", ico: "⊟", aliases: "탭 탭메뉴 나누기 tabs tab" },
  css: ".ui-tabs-w{position:relative}.ui-tabs-r{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}" +
    ".ui-tabs-bar{display:flex;flex-wrap:wrap;gap:var(--space-1);border-bottom:1px solid var(--color-border)}" +
    ".ui-tabs-l{display:inline-flex;flex:0 0 auto;align-items:center;gap:var(--space-2);min-height:var(--control-h-md);margin-bottom:-1px;padding:0 var(--space-4);border-bottom:2px solid transparent;border-radius:var(--radius-sm) var(--radius-sm) 0 0;color:var(--color-text-dim);font-size:var(--fs-14);font-weight:500;cursor:pointer;user-select:none;transition:color var(--dur-fast),border-color var(--dur-fast)}" +
    ".ui-tabs-l:hover{color:var(--color-text);background:var(--color-surface-soft)}.ui-tabs-ico{font-size:var(--fs-15)}" +
    ".ui-tabs-p{display:none;padding:var(--space-4) var(--space-1) 0;font-size:var(--fs-15);line-height:var(--lh-body);overflow-wrap:anywhere}.ui-tabs-p>p{margin:0 0 var(--space-2)}.ui-tabs-p>p:last-child{margin-bottom:0}.ui-tabs-empty{color:var(--color-text-dim)}" +
    tabsUiCss() +
    "@media print{.ui-tabs-bar{display:none}.ui-tabs-p{display:block;padding-top:var(--space-2)}.ui-tabs-p::before{content:attr(aria-label);display:block;font-weight:650}}",
  render(d, h) {
    const tabs = h.list(d.tabs, TABS_UI_MAX).filter((t) => t && typeof t === "object");
    if (!tabs.length) return '<p class="ui-tabs-empty">탭을 tabs에 적어 주세요.</p>';
    tabsUiSeq = (tabsUiSeq + 1) % 1679616;
    const id = "uitab-" + tabsUiHash(JSON.stringify(tabs)) + "-" + tabsUiSeq.toString(36);
    const raw = Number(d.selected);
    const selected = Number.isInteger(raw) && raw >= 0 && raw < tabs.length ? raw : 0;
    const labels = tabs.map((t, i) => h.str(t.label, "탭 " + (i + 1), 40));
    const radios = tabs.map((t, i) => '<input class="ui-tabs-r" type="radio" name="' + id + '" id="' + id + "-" + i + '"' + (i === selected ? " checked" : "") + ">").join("");
    const bar = tabs.map((t, i) => {
      const icon = [...h.str(t.icon, "", 16)].slice(0, 2).join("");
      return '<label class="ui-tabs-l" for="' + id + "-" + i + '">' + (icon ? '<span class="ui-tabs-ico" aria-hidden="true">' + h.esc(icon) + "</span>" : "") + h.esc(labels[i]) + "</label>";
    }).join("");
    const panels = tabs.map((t, i) => {
      const text = h.str(t.text, "", 2000);
      return '<div class="ui-tabs-p" role="region" aria-label="' + h.esc(labels[i]) + '">' + (text ? tabsUiParas(text, h) : '<p class="ui-tabs-empty">내용이 없어요.</p>') + "</div>";
    }).join("");
    return '<div class="ui-tabs-w">' + radios + '<div class="ui-tabs-bar">' + bar + '</div><div class="ui-tabs-ps">' + panels + "</div></div>";
  },
});
