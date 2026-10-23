import { registerComponent, registerHelpers, registerFamilyCss } from "../component-registry.js";

// Manifest allowlists and intrinsic dimensions from assets/kit/index.json.
// This family is deliberately self-contained in its single lazy chunk.
const asaHeaders = ["desk", "books", "design", "growth"];
const asaEmpty = ["folder", "search", "sleep", "inbox"];
const asaPatterns = ["dots", "waves", "plus", "diagonal"];
const asaIcons = ["chart", "doc", "calendar", "check", "idea", "rocket", "book", "palette", "code", "cap", "briefcase", "target", "users", "clock", "star", "flag", "search", "folder", "link", "chat", "heart", "bolt", "map", "gift"];
const asaHeaderSizes = { desk: [640, 561], books: [640, 521], design: [640, 620], growth: [640, 596] };
const asaEmptySizes = { folder: [640, 555], search: [640, 622], sleep: [640, 568], inbox: [640, 591] };
const asaPresets = { report: { tone: "neutral" }, friendly: { tone: "accent" }, paper: { tone: "neutral" }, showcase: { tone: "info" } };
const asaProps = { title: { type: "string" }, text: { type: "string" }, tone: { type: "string", enum: ["neutral", "info", "success", "warning", "danger", "accent"] }, preset: { type: "string", enum: ["report", "friendly", "paper", "showcase"] } };

function asaImage(kind, value, h) {
  const names = kind === "headers" ? asaHeaders : asaEmpty;
  const name = h.oneOf(value, names, names[0]);
  const size = (kind === "headers" ? asaHeaderSizes : asaEmptySizes)[name];
  return '<img class="vk-asset-art" src="/kit/' + kind + '/' + name + '.webp" alt="" loading="lazy" decoding="async" width="' + size[0] + '" height="' + size[1] + '">';
}
function asaMask(value, h) {
  const name = h.oneOf(value, asaPatterns, asaPatterns[0]);
  return '<span class="vk-asset-mask" aria-hidden="true" style="mask-image:url(/kit/patterns/' + name + '.svg);-webkit-mask-image:url(/kit/patterns/' + name + '.svg)"></span>';
}
function asaTone(value, h) { return ' vk-asset-tone-' + h.oneOf(value, h.TONES, "accent"); }
function asaHref(value, h) {
  const href = h.str(value, "", 2048);
  if (!href || /[\s\\\u0000-\u001f\u007f]/.test(href)) return "";
  if (/^\/(?!\/)/.test(href)) return href;
  if (!/^https:\/\//i.test(href)) return "";
  try { const url = new URL(href); return url.protocol === "https:" && url.hostname ? href : ""; } catch { return ""; }
}
registerHelpers("asset", { image: asaImage, mask: asaMask, tone: asaTone, href: asaHref });
registerFamilyCss("asset",
  '.ui[data-ui^="asset-"]{container-type:inline-size;min-width:0;color:var(--color-text)}' +
  '.vk-asset-card{position:relative;isolation:isolate;box-sizing:border-box;min-width:0;padding:var(--space-6);border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-sm);overflow-wrap:anywhere;break-inside:avoid;--asa-bg:var(--color-accent-soft);--asa-fg:var(--color-accent)}' +
  '.vk-asset-tone-neutral{--asa-bg:var(--color-neutral-bg);--asa-fg:var(--color-neutral-fg)}.vk-asset-tone-info{--asa-bg:var(--color-info-bg);--asa-fg:var(--color-info-fg)}.vk-asset-tone-success{--asa-bg:var(--color-success-bg);--asa-fg:var(--color-success-fg)}.vk-asset-tone-warning{--asa-bg:var(--color-warning-bg);--asa-fg:var(--color-warning-fg)}.vk-asset-tone-danger{--asa-bg:var(--color-danger-bg);--asa-fg:var(--color-danger-fg)}' +
  '.vk-asset-mask{position:absolute;z-index:-1;inset:0;border-radius:inherit;pointer-events:none;background:var(--asa-fg);mask-repeat:repeat;-webkit-mask-repeat:repeat}' +
  '.vk-asset-copy{min-width:0}.vk-asset-title{margin:0;font-size:var(--fs-21);font-weight:750;line-height:1.35;letter-spacing:-.025em;color:var(--color-text)}.vk-asset-text{margin:var(--space-2) 0 0;color:var(--color-text-dim);font-size:var(--fs-14);line-height:1.7}' +
  '.vk-asset-art{display:block;max-width:100%;height:auto;object-fit:contain}.ui[data-ui^="asset-"][data-preset=paper] .vk-asset-card{box-shadow:none}.ui[data-ui^="asset-"][data-preset=paper] .vk-asset-art{filter:grayscale(1)}' +
  '@media print{.vk-asset-card{box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}}');

registerComponent({
  id: "asset-header", family: "asset", name: "일러스트 배너",
  description: "Illustrated banner with left-aligned title and subtitle, a static header art name, a repeating pattern name, and an optional semantic tone.",
  schema: { type: "object", properties: { ...asaProps, subtitle: { type: "string" }, art: { type: "string", enum: asaHeaders }, pattern: { type: "string", enum: asaPatterns } }, required: [] },
  presets: asaPresets,
  defaults: { title: "오늘의 아이디어를 펼쳐 보세요", subtitle: "작은 기록이 모여 새로운 가능성이 됩니다.", art: "desk", pattern: "dots", tone: "accent" },
  sample: { title: "나만의 작업 공간", subtitle: "생각을 기록하고, 아이디어를 하나씩 완성해 보세요.", art: "desk", pattern: "dots", tone: "accent" },
  slash: { label: "일러스트 배너", hint: "그림과 함께 여는 페이지", ico: "▧", aliases: "배너 헤더 일러스트 그림 asset header illustration banner" },
  css: '.ui-asset-header .vk-asset-card{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);align-items:center;gap:var(--space-4);background:var(--asa-bg);min-height:240px}.ui-asset-header .vk-asset-art{width:100%;max-height:260px}.ui-asset-header .vk-asset-copy{padding:var(--space-2) 0}.ui-asset-header .vk-asset-text{color:var(--color-text)}@container (max-width:400px){.ui-asset-header .vk-asset-card{grid-template-columns:minmax(0,1fr);gap:var(--space-3)}.ui-asset-header .vk-asset-art{width:min(100%,240px);justify-self:center}}',
  render(d, h) {
    return '<section class="vk-asset-card' + h.asset.tone(d.tone, h) + '">' + h.asset.mask(d.pattern, h) + '<div class="vk-asset-copy"><h3 class="vk-asset-title">' + h.esc(h.str(d.title, "오늘의 아이디어를 펼쳐 보세요", 160)) + '</h3><p class="vk-asset-text">' + h.esc(h.str(d.subtitle, "작은 기록이 모여 새로운 가능성이 됩니다.", 400)) + '</p></div>' + h.asset.image("headers", d.art, h) + '</section>';
  },
});

registerComponent({
  id: "asset-empty", family: "asset", name: "빈 상태 안내",
  description: "Empty-state card with a static empty art name, title, text, and an optional action containing a label and an HTTPS or root-relative href.",
  schema: { type: "object", properties: { ...asaProps, art: { type: "string", enum: asaEmpty }, action: { type: "object", properties: { label: { type: "string" }, href: { type: "string" } }, required: ["label", "href"] } }, required: [] },
  presets: asaPresets,
  defaults: { art: "folder", title: "아직 기록이 없어요", text: "첫 번째 기록을 남기면 이곳에 차곡차곡 모여요." },
  sample: { art: "folder", title: "새로운 이야기를 기다려요", text: "작은 생각도 좋아요. 첫 번째 기록을 남겨 보세요.", action: { label: "첫 기록 만들기", href: "/notes/new" } },
  slash: { label: "빈 상태 안내", hint: "시작을 돕는 그림 카드", ico: "▱", aliases: "빈상태 빈 상태 안내 폴더 empty state illustration asset" },
  css: '.ui-asset-empty .vk-asset-card{display:flex;flex-direction:column;align-items:center;text-align:center;gap:var(--space-4)}.ui-asset-empty .vk-asset-art{width:180px;max-height:175px}.ui-asset-empty .vk-asset-title{font-size:var(--fs-19)}.ui-asset-empty .vk-asset-action{display:inline-flex;justify-content:center;align-items:center;box-sizing:border-box;max-width:100%;min-height:44px;padding:var(--space-2) var(--space-4);border-radius:var(--radius-sm);background:var(--color-accent);color:var(--color-on-accent);font-size:var(--fs-14);font-weight:650;text-decoration:none}.ui-asset-empty .vk-asset-action:hover{background:var(--color-accent-strong)}.ui-asset-empty .vk-asset-action:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px}',
  render(d, h) {
    const action = d.action && typeof d.action === "object" ? d.action : {};
    const href = h.asset.href(action.href, h), label = h.str(action.label, "", 120);
    return '<section class="vk-asset-card' + h.asset.tone(d.tone, h) + '">' + h.asset.image("empty", d.art, h) + '<div class="vk-asset-copy"><h3 class="vk-asset-title">' + h.esc(h.str(d.title, "아직 기록이 없어요", 160)) + '</h3><p class="vk-asset-text">' + h.esc(h.str(d.text, "첫 번째 기록을 남기면 이곳에 차곡차곡 모여요.", 400)) + '</p></div>' + (href && label ? '<a class="vk-asset-action" href="' + h.esc(href) + '">' + h.esc(label) + '</a>' : '') + '</section>';
  },
});

registerComponent({
  id: "asset-icons", family: "asset", name: "아이콘 모음",
  description: "Responsive icon grid of items with an allowlisted sprite icon name, label, and optional explanatory text, rendered as accessible external SVG symbols.",
  schema: { type: "object", properties: { ...asaProps, items: { type: "array", items: { type: "object", properties: { icon: { type: "string", enum: asaIcons }, label: { type: "string" }, text: { type: "string" } }, required: ["icon", "label"] } } }, required: [] },
  presets: asaPresets,
  defaults: { items: [] },
  sample: { items: [{ icon: "chart", label: "분석", text: "변화를 한눈에" }, { icon: "doc", label: "기록", text: "생각을 차곡차곡" }, { icon: "calendar", label: "계획", text: "하루를 알차게" }, { icon: "idea", label: "아이디어", text: "새로운 가능성" }, { icon: "book", label: "배움", text: "매일 한 걸음" }, { icon: "target", label: "목표", text: "원하는 곳으로" }] },
  slash: { label: "아이콘 모음", hint: "아이콘으로 정리하는 항목", ico: "▦", aliases: "아이콘 모음 목록 그리드 icon icons grid sprite asset" },
  css: '.ui-asset-icons .vk-asset-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-5) var(--space-3);padding:0;margin:0;list-style:none}.ui-asset-icons .vk-asset-item{display:flex;flex-direction:column;align-items:center;min-width:0;text-align:center;gap:var(--space-2)}.ui-asset-icons .vk-asset-icon{display:grid;place-items:center;width:52px;height:52px;border-radius:var(--radius-md);background:var(--color-accent-soft);color:var(--color-accent)}.ui-asset-icons .vk-asset-item:nth-child(3n+2) .vk-asset-icon{background:var(--color-info-bg);color:var(--color-info-fg)}.ui-asset-icons .vk-asset-item:nth-child(3n) .vk-asset-icon{background:var(--color-success-bg);color:var(--color-success-fg)}.ui-asset-icons svg{display:block;width:28px;height:28px}.ui-asset-icons .vk-asset-label{font-size:var(--fs-14);font-weight:700}.ui-asset-icons .vk-asset-text{font-size:var(--fs-12);margin:0}.ui-asset-icons .vk-asset-empty{margin:0;text-align:center}.ui-asset-icons[data-preset=paper] .vk-asset-icon{background:var(--color-neutral-bg);color:var(--color-neutral-fg)}@container (max-width:400px){.ui-asset-icons .vk-asset-list{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  render(d, h) {
    const items = h.list(d.items, 24).filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (!items.length) return '<div class="vk-asset-card"><p class="vk-asset-text vk-asset-empty">항목을 넣으면 아이콘이 함께 보여요.</p></div>';
    return '<div class="vk-asset-card"><ul class="vk-asset-list">' + items.map((item) => {
      const icon = h.oneOf(item.icon, asaIcons, asaIcons[0]), label = h.str(item.label, "항목", 100), text = h.str(item.text, "", 240);
      return '<li class="vk-asset-item"><span class="vk-asset-icon"><svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="' + h.esc(label) + '"><use href="/kit/icons.svg#i-' + icon + '"></use></svg></span><span class="vk-asset-label">' + h.esc(label) + '</span>' + (text ? '<p class="vk-asset-text">' + h.esc(text) + '</p>' : '') + '</li>';
    }).join('') + '</ul></div>';
  },
});

registerComponent({
  id: "asset-pattern", family: "asset", name: "패턴 섹션",
  description: "Decorative section with an allowlisted repeating SVG pattern used as a CSS mask over a semantic tone color, plus a title and explanatory text.",
  schema: { type: "object", properties: { ...asaProps, pattern: { type: "string", enum: asaPatterns } }, required: [] },
  presets: asaPresets,
  defaults: { pattern: "waves", tone: "info", title: "생각이 흐르는 시간", text: "잠시 쉬어 가며 새로운 영감을 발견해 보세요." },
  sample: { pattern: "waves", tone: "info", title: "생각이 흐르는 시간", text: "잠시 쉬어 가며 새로운 영감을 발견해 보세요." },
  slash: { label: "패턴 섹션", hint: "잔잔한 무늬로 나누는 공간", ico: "▤", aliases: "패턴 무늬 배경 섹션 pattern background section asset" },
  css: '.ui-asset-pattern .vk-asset-card{display:flex;align-items:center;min-height:210px;background:var(--asa-bg)}.ui-asset-pattern .vk-asset-copy{padding:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface)}.ui-asset-pattern .vk-asset-title{font-size:var(--fs-19)}',
  render(d, h) {
    return '<section class="vk-asset-card' + h.asset.tone(d.tone, h) + '">' + h.asset.mask(d.pattern, h) + '<div class="vk-asset-copy"><h3 class="vk-asset-title">' + h.esc(h.str(d.title, "생각이 흐르는 시간", 160)) + '</h3><p class="vk-asset-text">' + h.esc(h.str(d.text, "잠시 쉬어 가며 새로운 영감을 발견해 보세요.", 400)) + '</p></div></section>';
  },
});
