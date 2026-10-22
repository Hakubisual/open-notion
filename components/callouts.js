// Callout box (콜아웃 박스): a toned note with an icon, an optional title and text. Contract: component-registry.js.
import { registerComponent } from "../component-registry.js";

const CALLOUT_TONES = ["info", "success", "warning", "danger", "neutral"];
const CALLOUT_GLYPH = { info: "i", success: "✓", warning: "!", danger: "!", neutral: "•" };
const CALLOUT_TEXT = "여기에 안내할 내용을 적어 주세요.";

registerComponent({
  id: "callout-box", name: "콜아웃 박스",
  description: "Toned note box: tone info|success|warning|danger|neutral (default info), an optional short title, the text (**bold** and `code` allowed) and an optional emoji icon that replaces the tone mark.",
  schema: { type: "object", properties: { tone: { enum: CALLOUT_TONES }, title: { type: "string" }, text: { type: "string" }, icon: { type: "string" } }, required: ["text"] },
  defaults: { tone: "info", text: CALLOUT_TEXT },
  sample: { tone: "info", title: "정보", text: "중요한 정보를 안내합니다. **굵게**와 `코드`도 쓸 수 있어요." },
  slash: { label: "콜아웃 박스", hint: "정보·성공·주의·위험 안내", ico: "ⓘ", aliases: "콜아웃 안내 알림 주의 경고 위험 정보 성공 팁 메모 callout note info tip success warning danger alert notice" },
  css: ".ui-callout{display:flex;align-items:flex-start;gap:var(--space-3);padding:var(--space-3) var(--space-4);border:1px solid color-mix(in srgb,var(--co-fg) 18%,transparent);border-radius:var(--radius-sm);background:var(--co-bg);color:var(--color-text);font-size:var(--fs-14);line-height:20px;transition:border-color var(--dur-base),box-shadow var(--dur-base)}" +
    "@media (hover:hover){.ui-callout:hover{border-color:color-mix(in srgb,var(--co-fg) 40%,transparent);box-shadow:var(--shadow-sm)}}" +
    ".ui-callout-ico{flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:var(--radius-pill);background:var(--co-fg);color:var(--co-bg);font-size:var(--fs-12);font-weight:800;line-height:1}" +
    ".ui-callout.is-warning .ui-callout-ico:not(.emoji){border-radius:var(--radius-xs);clip-path:polygon(50% 4%,100% 96%,0 96%);padding-top:5px;font-size:var(--fs-11)}" +
    ".ui-callout-ico.emoji{width:auto;height:auto;margin-top:0;background:none;color:inherit;font-size:var(--fs-16);font-weight:400;line-height:20px}" +
    ".ui-callout-body{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:var(--space-3);row-gap:2px}" +
    ".ui-callout-title{color:var(--co-fg);font-weight:700}" +
    ".ui-callout-text{margin:0;min-width:0;overflow-wrap:anywhere}.ui-callout-text code{font-size:.92em}" +
    CALLOUT_TONES.map((t) => ".ui-callout.is-" + t + "{--co-bg:var(--color-" + t + "-bg);--co-fg:var(--color-" + t + "-fg)}").join(""),
  render(d, h) {
    const tone = h.oneOf(d.tone, CALLOUT_TONES, "info");
    const icon = h.str(d.icon, "", 8);
    const title = h.str(d.title, "", 80);
    return '<div class="ui-callout is-' + tone + '" role="note">' +
      (icon ? '<span class="ui-callout-ico emoji" aria-hidden="true">' + h.esc(icon) + "</span>" : '<span class="ui-callout-ico" aria-hidden="true">' + CALLOUT_GLYPH[tone] + "</span>") +
      '<div class="ui-callout-body">' + (title ? '<strong class="ui-callout-title">' + h.rich(title) + "</strong>" : "") +
      '<p class="ui-callout-text">' + h.rich(h.str(d.text, CALLOUT_TEXT, 600)) + "</p></div></div>";
  },
});
