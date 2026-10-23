import { registerComponent } from "../component-registry.js";

// File-local frame until the interactive family core is available; no dependency on chart CSS.
const ixcPresets = { report: { compact: true }, friendly: {}, paper: { palette: "mono", figure: true }, showcase: { height: "l" } };
const ixcProps = { title: { type: "string" }, subtitle: { type: "string" }, caption: { type: "string" }, preset: { type: "string", enum: ["report", "friendly", "paper", "showcase"] } };
let ixcSeq = 0;
function ixcUid(data) {
  let hash = 2166136261;
  const text = JSON.stringify(data);
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  ixcSeq += 1;
  return "vkixc-" + (hash >>> 0).toString(36) + ixcSeq.toString(36);
}
function ixcFrame(d, h, label, body) {
  const id = ixcUid(d), title = h.str(d.title, label, 80), subtitle = h.str(d.subtitle, "", 180), caption = h.str(d.caption, "", 240);
  return '<figure class="vk-fig ui-ixc-frame' + (d.compact === true ? " ui-ixc-compact" : "") + '" role="group" aria-labelledby="' + id + '-title"><header class="ui-ixc-head"><div class="ui-ixc-title" id="' + id + '-title">' + h.esc(title) + '</div>' + (subtitle ? '<p class="ui-ixc-sub">' + h.esc(subtitle) + '</p>' : '') + '</header>' + body + (caption ? '<figcaption class="ui-ixc-caption">' + h.esc(caption) + '</figcaption>' : '') + '</figure>';
}
function ixcItems(value, h, max = 24) { return h.list(value, max).filter((item) => item && typeof item === "object" && !Array.isArray(item)); }
function ixcEmpty() { return '<p class="ui-ixc-empty">항목을 넣으면 여기에 표시돼요.</p>'; }
function ixcHref(value, h) {
  const href = h.str(value, "", 2000).trim();
  if (/[\u0000-\u0020\u007f\\]/.test(href)) return "";
  if (/^\/(?!\/)/.test(href)) return href;
  if (!/^https:\/\//i.test(href)) return "";
  try { return new URL(href).hostname ? href : ""; } catch { return ""; }
}
const ixcFrameCss = ".ui-ixc-frame{container-type:inline-size;box-sizing:border-box;min-width:0;margin:0;padding:var(--space-5);border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-sm);color:var(--color-text);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;break-inside:avoid}.ui-ixc-frame *{box-sizing:border-box}.ui-ixc-frame.ui-ixc-compact{padding:var(--space-4)}.ui-ixc-head{margin-bottom:var(--space-4)}.ui-ixc-title{font-size:var(--fs-17);font-weight:700;line-height:1.4}.ui-ixc-sub,.ui-ixc-caption{margin:var(--space-1) 0 0;color:var(--color-text-dim);font-size:var(--fs-13);line-height:1.6}.ui-ixc-caption{margin-top:var(--space-4)}.ui-ixc-empty{margin:0;padding:var(--space-4);border:1px dashed var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-dim);font-size:var(--fs-14)}.ui-ixc-frame :focus-visible{outline:2px solid var(--color-accent);outline-offset:3px}.ui[data-preset=paper] .ui-ixc-frame{--color-accent:var(--color-text);--color-accent-strong:var(--color-text);--color-on-accent:var(--color-surface);box-shadow:none}.ui[data-preset=showcase] .ui-ixc-frame{padding:var(--space-6)}@media print{.ui-ixc-frame{box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}}";

registerComponent({
  id: "ix-button", family: "interactive", name: "버튼",
  description: "A group of styled links from buttons [{label, href, variant, size, icon, arrow}], accepting only HTTPS or root-relative paths and displaying invalid links as disabled spans.",
  schema: { type: "object", properties: { ...ixcProps, buttons: { type: "array", maxItems: 24, items: { type: "object", properties: { label: { type: "string" }, href: { type: "string" }, variant: { type: "string", enum: ["primary", "accent", "secondary", "ghost", "danger"] }, size: { type: "string", enum: ["s", "m", "l"] }, icon: { type: "string" }, arrow: { type: "boolean" } }, required: ["label"] } } }, required: ["buttons"] },
  defaults: { buttons: [] }, presets: ixcPresets,
  sample: { title: "버튼", subtitle: "다양한 타입과 크기의 버튼입니다.", buttons: ["l", "m", "s"].flatMap((size) => [
    { label: "시작하기", href: "/new", variant: "primary", size, arrow: true }, { label: "저장", href: "/notes", variant: "accent", size }, { label: "둘러보기", href: "/explore", variant: "secondary", size }, { label: "더 보기", href: "/guide", variant: "ghost", size }, { label: "휴지통", href: "/trash", variant: "danger", size }, { label: "준비 중", size },
  ]) },
  slash: { label: "버튼", hint: "여러 스타일의 링크 버튼", ico: "↗", aliases: "버튼 링크 액션 button link action" },
  css: ixcFrameCss + ".ui-ix-button .ui-ixc-buttons{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3) var(--space-2)}.ui-ix-button .ui-ixc-button{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);max-width:100%;min-width:0;min-height:36px;padding:var(--space-2) var(--space-4);border:1px solid transparent;border-radius:var(--radius-pill);background:var(--color-text);color:var(--color-bg);font-size:var(--fs-13);font-weight:650;line-height:1.4;text-decoration:none;text-align:center}.ui-ix-button .ui-ixc-size-s{min-height:30px;padding:var(--space-1) var(--space-3);font-size:var(--fs-12)}.ui-ix-button .ui-ixc-size-l{min-height:42px;padding:var(--space-3) var(--space-4);font-size:var(--fs-14)}.ui-ix-button .ui-ixc-accent{background:var(--color-accent);color:var(--color-on-accent)}.ui-ix-button .ui-ixc-secondary{background:var(--color-surface);color:var(--color-text);border-color:var(--color-border)}.ui-ix-button .ui-ixc-ghost{background:transparent;color:var(--color-accent)}.ui-ix-button .ui-ixc-danger{background:var(--color-danger-bg);color:var(--color-danger-fg);border-color:var(--color-danger-fg)}.ui-ix-button a.ui-ixc-button:hover{outline:2px solid var(--color-accent);outline-offset:2px}.ui-ix-button .ui-ixc-button[aria-disabled=true]{background:var(--color-surface-soft);color:var(--color-text-dim);border-color:transparent;opacity:.65}.ui-ix-button .ui-ixc-button>span{min-width:0}@container (max-width:359px){.ui-ix-button .ui-ixc-buttons{gap:var(--space-2)}.ui-ix-button .ui-ixc-button{flex:1 1 110px}}",
  render(d, h) {
    const buttons = ixcItems(d.buttons, h);
    const body = buttons.map((button) => {
      const href = ixcHref(button.href, h), variant = h.oneOf(button.variant, ["primary", "accent", "secondary", "ghost", "danger"], "primary"), size = h.oneOf(button.size, ["s", "m", "l"], "m"), icon = h.str(button.icon, "", 24);
      const content = (icon ? '<span aria-hidden="true">' + h.esc(icon) + '</span>' : '') + '<span>' + h.esc(h.str(button.label, "버튼", 80)) + '</span>' + (button.arrow === true ? '<span aria-hidden="true">→</span>' : '');
      return '<' + (href ? 'a' : 'span') + ' class="ui-ixc-button ui-ixc-' + variant + ' ui-ixc-size-' + size + '"' + (href ? ' href="' + h.esc(href) + '"' : ' aria-disabled="true"') + '>' + content + '</' + (href ? 'a' : 'span') + '>';
    }).join("");
    return ixcFrame(d, h, "버튼", buttons.length ? '<div class="ui-ixc-buttons">' + body + '</div>' : ixcEmpty());
  },
});

function ixcSegmentCss() {
  let css = "";
  for (let i = 1; i <= 8; i += 1) {
    const radio = ".ui-ix-segmented .ui-ixc-radio:nth-of-type(" + i + ")";
    css += radio + ":checked~.ui-ixc-segments>.ui-ixc-segment:nth-child(" + i + "){background:var(--color-text);color:var(--color-bg);box-shadow:var(--shadow-sm)}" + radio + ":checked~.ui-ixc-panels>.ui-ixc-panel:nth-child(" + i + "){display:block}" + radio + ":focus-visible~.ui-ixc-segments>.ui-ixc-segment:nth-child(" + i + "){outline:2px solid var(--color-accent);outline-offset:2px}";
  }
  return css;
}
registerComponent({
  id: "ix-segmented", family: "interactive", name: "세그먼트 컨트롤",
  description: "Script-free radio segments switch between options [{label, text}] with blank-line-separated paragraphs and a zero-based selected index.",
  schema: { type: "object", properties: { ...ixcProps, options: { type: "array", maxItems: 8, items: { type: "object", properties: { label: { type: "string" }, text: { type: "string" } }, required: ["label"] } }, selected: { type: "integer", minimum: 0, maximum: 7 } }, required: ["options"] },
  defaults: { options: [], selected: 0 }, presets: ixcPresets,
  sample: { title: "세그먼트 컨트롤", subtitle: "데이터의 기간을 전환할 때 사용합니다.", options: [{ label: "월간", text: "이번 달의 기록과 성장을 확인해요." }, { label: "분기", text: "세 달 동안의 흐름을 한눈에 살펴봐요.\n\n다음 분기의 목표도 함께 정리해요." }, { label: "연간", text: "올해의 성과와 소중한 순간을 모아봐요." }], selected: 0 },
  slash: { label: "세그먼트 컨트롤", hint: "선택에 따라 내용 전환", ico: "▤", aliases: "세그먼트 선택 기간 segmented radio panel toggle" },
  css: ixcFrameCss + ".ui-ix-segmented .ui-ixc-selector{position:relative;min-width:0}.ui-ix-segmented .ui-ixc-radio{position:absolute;width:1px;height:1px;opacity:0;margin:0}.ui-ix-segmented .ui-ixc-segments{display:flex;flex-wrap:wrap;gap:var(--space-1);padding:var(--space-1);border:1px solid var(--color-border);border-radius:var(--radius-pill);background:var(--color-surface-soft)}.ui-ix-segmented .ui-ixc-segment{display:flex;flex:1 1 60px;min-width:0;align-items:center;justify-content:center;min-height:32px;padding:var(--space-2) var(--space-3);border-radius:var(--radius-pill);color:var(--color-text-dim);font-size:var(--fs-13);text-align:center;cursor:pointer}.ui-ix-segmented .ui-ixc-panel{display:none;margin-top:var(--space-4);font-size:var(--fs-14);line-height:1.7}.ui-ix-segmented .ui-ixc-panel p{margin:0 0 var(--space-2)}.ui-ix-segmented .ui-ixc-panel p:last-child{margin:0}" + ixcSegmentCss() + "@container (max-width:359px){.ui-ix-segmented .ui-ixc-segments{border-radius:var(--radius-lg)}.ui-ix-segmented .ui-ixc-segment{padding-inline:var(--space-2)}}@media print{.ui-ix-segmented .ui-ixc-segments,.ui-ix-segmented .ui-ixc-radio{display:none}.ui-ix-segmented .ui-ixc-panels>.ui-ixc-panel{display:block}.ui-ix-segmented .ui-ixc-panel::before{content:attr(aria-label);display:block;font-weight:700}}",
  render(d, h) {
    const options = ixcItems(d.options, h, 8);
    if (!options.length) return ixcFrame(d, h, "세그먼트 컨트롤", ixcEmpty());
    const id = ixcUid(options), selected = Number.isInteger(d.selected) && d.selected >= 0 && d.selected < options.length ? d.selected : 0;
    const labels = options.map((option, i) => h.str(option.label, "선택 " + (i + 1), 60));
    const radios = options.map((option, i) => '<input class="ui-ixc-radio" type="radio" name="' + id + '" id="' + id + '-' + i + '" aria-controls="' + id + '-panel-' + i + '"' + (i === selected ? ' checked' : '') + '>').join("");
    const bar = labels.map((label, i) => '<label class="ui-ixc-segment" for="' + id + '-' + i + '">' + h.esc(label) + '</label>').join("");
    const panels = options.map((option, i) => {
      const text = h.str(option.text, "내용이 없어요.", 4000);
      return '<div class="ui-ixc-panel" id="' + id + '-panel-' + i + '" role="region" aria-label="' + h.esc(labels[i]) + '" tabindex="0">' + text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => '<p>' + h.rich(p).replace(/\n/g, '<br>') + '</p>').join("") + '</div>';
    }).join("");
    return ixcFrame(d, h, "세그먼트 컨트롤", '<div class="ui-ixc-selector" role="group" aria-label="' + h.esc(h.str(d.title, "내용 선택", 80)) + '">' + radios + '<div class="ui-ixc-segments">' + bar + '</div><div class="ui-ixc-panels">' + panels + '</div></div>');
  },
});

registerComponent({
  id: "ix-toggle", family: "interactive", name: "스위치 토글",
  description: "A read-only documentation list of switch states from items [{label, on, note}], with accessible switch roles and explicit on/off text.",
  schema: { type: "object", properties: { ...ixcProps, items: { type: "array", maxItems: 24, items: { type: "object", properties: { label: { type: "string" }, on: { type: "boolean" }, note: { type: "string" } }, required: ["label"] } } }, required: ["items"] },
  defaults: { items: [] }, presets: ixcPresets,
  sample: { title: "스위치 토글", subtitle: "설정의 활성화 여부를 보여줍니다.", items: [{ label: "알림", on: true, note: "새 소식을 받아요." }, { label: "자동 공유", on: false, note: "내 기록을 비공개로 보관해요." }] },
  slash: { label: "스위치 토글", hint: "설정 상태를 문서에 표시", ico: "◐", aliases: "스위치 토글 설정 상태 switch toggle settings" },
  css: ixcFrameCss + ".ui-ix-toggle .ui-ixc-toggles{display:flex;flex-wrap:wrap;gap:var(--space-5);list-style:none;margin:0;padding:0}.ui-ix-toggle .ui-ixc-toggle-item{flex:1 1 130px;min-width:0}.ui-ix-toggle .ui-ixc-switch-row{display:flex;align-items:center;gap:var(--space-3)}.ui-ix-toggle .ui-ixc-switch{display:inline-flex;align-items:center;width:56px;height:30px;padding:3px;flex:none;border:1px solid var(--color-border);border-radius:var(--radius-pill);background:color-mix(in srgb,var(--color-text-dim) 35%,var(--color-surface-soft))}.ui-ix-toggle .ui-ixc-switch::after{content:'';display:block;width:22px;height:22px;border-radius:var(--radius-pill);background:var(--color-surface);box-shadow:var(--shadow-sm)}.ui-ix-toggle .ui-ixc-switch[aria-checked=true]{background:var(--color-accent);border-color:var(--color-accent);justify-content:flex-end}.ui-ix-toggle .ui-ixc-setting{font-size:var(--fs-14);font-weight:600}.ui-ix-toggle .ui-ixc-state{color:var(--color-text-dim);font-size:var(--fs-12)}.ui-ix-toggle .ui-ixc-note{margin:var(--space-2) 0 0;font-size:var(--fs-13);line-height:1.6;color:var(--color-text-dim)}@container (max-width:359px){.ui-ix-toggle .ui-ixc-toggles{gap:var(--space-4)}}",
  render(d, h) {
    const items = ixcItems(d.items, h), id = ixcUid(items);
    const body = items.map((item, i) => {
      const on = item.on === true, note = h.str(item.note, "", 240);
      return '<li class="ui-ixc-toggle-item"><div class="ui-ixc-switch-row"><span class="ui-ixc-switch" role="switch" aria-checked="' + on + '" aria-readonly="true" tabindex="0" aria-labelledby="' + id + '-label-' + i + '"' + (note ? ' aria-describedby="' + id + '-note-' + i + '"' : '') + '></span><div><div class="ui-ixc-setting" id="' + id + '-label-' + i + '">' + h.esc(h.str(item.label, "설정 " + (i + 1), 80)) + '</div><span class="ui-ixc-state">' + (on ? '켜짐' : '꺼짐') + '</span></div></div>' + (note ? '<p class="ui-ixc-note" id="' + id + '-note-' + i + '">' + h.esc(note) + '</p>' : '') + '</li>';
    }).join("");
    return ixcFrame(d, h, "스위치 토글", items.length ? '<ul class="ui-ixc-toggles">' + body + '</ul>' : ixcEmpty());
  },
});

registerComponent({
  id: "ix-progress", family: "interactive", name: "진행 표시줄",
  description: "A labelled progress set from items [{label, value, kind, steps}] using clamped 0-100 percentages in linear bars, completed-step markers, or rings.",
  schema: { type: "object", properties: { ...ixcProps, items: { type: "array", maxItems: 24, items: { type: "object", properties: { label: { type: "string" }, value: { type: "number", minimum: 0, maximum: 100 }, kind: { type: "string", enum: ["linear", "steps", "ring"] }, steps: { type: "integer", minimum: 2, maximum: 12 } }, required: ["label", "value"] } } }, required: ["items"] },
  defaults: { items: [] }, presets: ixcPresets,
  sample: { title: "진행 표시줄", subtitle: "다양한 스타일의 진행 표시입니다.", items: [{ label: "선형 (Linear)", value: 72, kind: "linear" }, { label: "단계 (Steps)", value: 72, kind: "steps", steps: 4 }, { label: "원형 (Circular)", value: 72, kind: "ring" }] },
  slash: { label: "진행 표시줄", hint: "막대·단계·원형 진행률", ico: "◔", aliases: "진행 진행률 막대 원형 progress bar steps ring" },
  css: ixcFrameCss + ".ui-ix-progress .ui-ixc-progress-list{display:grid;gap:var(--space-5)}.ui-ix-progress .ui-ixc-progress{display:grid;grid-template-columns:minmax(80px,1fr) minmax(0,1.5fr) auto;align-items:center;gap:var(--space-3);font-size:var(--fs-13)}.ui-ix-progress .ui-ixc-progress-label{color:var(--color-text-dim)}.ui-ix-progress .ui-ixc-percent{font-weight:650;white-space:nowrap}.ui-ix-progress .ui-ixc-track{height:12px;border-radius:var(--radius-pill);background:var(--color-surface-soft);overflow:hidden}.ui-ix-progress .ui-ixc-fill{display:block;height:100%;border-radius:inherit;background:var(--color-accent)}.ui-ix-progress .ui-ixc-steps{display:flex;align-items:center;justify-content:space-between;min-width:0;gap:2px;background:linear-gradient(var(--color-border),var(--color-border)) center/100% 2px no-repeat}.ui-ix-progress .ui-ixc-step{display:flex;align-items:center;justify-content:center;flex:0 1 22px;min-width:0;aspect-ratio:1;border:2px solid var(--color-border);border-radius:var(--radius-pill);background:var(--color-surface);color:var(--color-on-accent);font-size:var(--fs-11)}.ui-ix-progress .ui-ixc-step-done{background:var(--color-accent);border-color:var(--color-accent)}.ui-ix-progress .ui-ixc-step-current{border-color:var(--color-accent)}.ui-ix-progress .ui-ixc-step-current::after{content:'';width:60%;aspect-ratio:1;border-radius:var(--radius-pill);background:var(--color-accent)}.ui-ix-progress .ui-ixc-ring{width:100%;max-width:104px;height:auto;display:block;justify-self:center}.ui-ix-progress .ui-ixc-ring-track{fill:none;stroke:var(--color-surface-soft);stroke-width:12}.ui-ix-progress .ui-ixc-ring-fill{fill:none;stroke:var(--color-accent);stroke-width:12}.ui-ix-progress .ui-ixc-ring text{fill:var(--color-text);font-family:inherit;font-weight:750}@container (max-width:359px){.ui-ix-progress .ui-ixc-progress{grid-template-columns:minmax(0,1fr) auto;gap:var(--space-2)}.ui-ix-progress .ui-ixc-progress-label{grid-column:1/-1}}",
  render(d, h) {
    const items = ixcItems(d.items, h), id = ixcUid(items);
    const body = items.map((item, i) => {
      const value = typeof item.value === "number" && Number.isFinite(item.value) ? Math.round(Math.max(0, Math.min(100, item.value)) * 10) / 10 : 0;
      const kind = h.oneOf(item.kind, ["linear", "steps", "ring"], "linear"), percent = value.toLocaleString("ko-KR") + "%";
      let visual = '<div class="ui-ixc-track" aria-hidden="true"><span class="ui-ixc-fill" style="width:' + value + '%"></span></div>';
      if (kind === "steps") {
        const steps = typeof item.steps === "number" && Number.isFinite(item.steps) ? Math.max(2, Math.min(12, Math.floor(item.steps))) : 4;
        const completed = Math.floor(value * steps / 100);
        visual = '<div class="ui-ixc-steps" aria-hidden="true">' + Array.from({ length: steps }, (_, step) => '<span class="ui-ixc-step' + (step < completed ? ' ui-ixc-step-done' : step === completed && value > 0 ? ' ui-ixc-step-current' : '') + '">' + (step < completed ? '✓' : '') + '</span>').join("") + '</div>';
      } else if (kind === "ring") {
        visual = '<svg class="ui-ixc-ring" viewBox="0 0 104 104" aria-hidden="true"><circle class="ui-ixc-ring-track" cx="52" cy="52" r="44"/><circle class="ui-ixc-ring-fill" cx="52" cy="52" r="44" pathLength="100" stroke-dasharray="' + value + ' 100" transform="rotate(-90 52 52)"/><text x="52" y="53" text-anchor="middle" dominant-baseline="central" font-size="23">' + percent + '</text></svg>';
      }
      return '<div class="ui-ixc-progress" role="progressbar" aria-labelledby="' + id + '-label-' + i + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + value + '"><span class="ui-ixc-progress-label" id="' + id + '-label-' + i + '">' + h.esc(h.str(item.label, "진행 " + (i + 1), 80)) + '</span>' + visual + '<span class="ui-ixc-percent"' + (kind === 'ring' ? ' aria-hidden="true"' : '') + '>' + (kind === 'ring' ? '' : percent) + '</span></div>';
    }).join("");
    return ixcFrame(d, h, "진행 표시줄", items.length ? '<div class="ui-ixc-progress-list">' + body + '</div>' : ixcEmpty());
  },
});
