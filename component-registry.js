// Acard component registry (ds10). A component is a block of type "component" whose text is JSON data and whose
// meta.ui names the component. In markdown it is a fence:
//   ```acard-ui {"ui":"stat"}
//   {"label":"가입 전환율","value":"18.4%","delta":"+12%"}
//   ```
// Components live in components/*.js (one file per family); each calls registerComponent. ONE registration gives a component everything it needs:
//   render(data, h)  -> reader / share / export HTML (server-side, no script, follows tokens.css light/dark)
//   schema           -> JSON-schema-like description agents read through the catalog (list_components)
//   defaults         -> values used at render time when a field is missing or malformed (stored data is never changed)
//   sample           -> example data the catalog, slash menu and gallery insert
//   slash            -> { label, hint, ico, aliases } for the editor's slash / insert menu
// Unknown components and malformed JSON never break a page: they draw a quiet fallback card (renderComponentBlock).
// Used by block-html.js (reader + export), features/share.js (published pages), the editor (window.AcardComponents,
// dist/component-html.js) and the agent catalog. Dependency-free: build.ts and tests/assemble-worker.ts inline it and
// every components/*.js file (sorted) into the worker and the browser copy; bun imports components/index.js.

export const COMPONENT_FENCE = "acard-ui";
export const COMPONENT_ID = /^[a-z][a-z0-9-]{1,39}$/;
const UI_MAX_ITEMS = 24;

function uiEsc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Plain text with **bold** and `code` only; components never take raw HTML from data.
function uiRich(value) {
  return uiEsc(value).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[(MEASURED|CLAIMED|ESTIMATED)\]/g, (_, kind) => '<span class="ev ev-' + kind.toLowerCase() + '">' + kind + "</span>");
}

function uiStr(value, fallback, max = 400) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.slice(0, max) : fallback;
}

function uiOneOf(value, list, fallback) {
  return list.includes(value) ? value : fallback;
}

function uiList(value, max = UI_MAX_ITEMS) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

// Tones every component shares; each maps to tokens.css --color-<tone>-bg/fg.
export const UI_TONES = ["neutral", "info", "success", "warning", "danger", "accent"];

const uiHelpers = { esc: uiEsc, rich: uiRich, str: uiStr, oneOf: uiOneOf, list: uiList, TONES: UI_TONES };

const uiRegistry = new Map();

// def: { id, name, description, schema, defaults, sample, slash: { label, hint, ico, aliases }, css, render(data, h) }
// css is the component's own rules (tokens.css variables only); componentCss() joins them for the page.
export function registerComponent(def) {
  if (!def || !COMPONENT_ID.test(def.id)) throw new Error("component id must be a-z0-9- (2-40 chars): " + (def && def.id));
  if (typeof def.render !== "function") throw new Error("component " + def.id + " needs render(data, h)");
  uiRegistry.set(def.id, Object.freeze({ ...def, defaults: def.defaults || {}, sample: def.sample || def.defaults || {}, slash: def.slash || { label: def.name, hint: def.description, ico: "▦" } }));
  return uiRegistry.get(def.id);
}

export function getComponent(id) {
  return uiRegistry.get(id) || null;
}

export function listComponents() {
  return [...uiRegistry.values()];
}

// The short line agents see in the MCP tool description: names only.
export function componentNames() {
  return listComponents().map((c) => c.id).join(", ");
}

// Catalog entries for agents (list_components / GET /api/v1/components): schema, defaults and a ready-to-paste example.
export function componentCatalog(id) {
  const pick = (c) => ({ id: c.id, name: c.name, description: c.description, schema: c.schema || { type: "object" }, defaults: c.defaults, sample: c.sample, markdown: componentMarkdown(c.id, c.sample) });
  if (id) { const c = getComponent(id); return c ? pick(c) : null; }
  return listComponents().map(pick);
}

export function componentMarkdown(id, data) {
  return "```" + COMPONENT_FENCE + " " + JSON.stringify({ ui: id }) + "\n" + JSON.stringify(data ?? {}, null, 2) + "\n```";
}

// Data for rendering: parsed JSON merged over defaults. Malformed JSON gives { ok: false } and the defaults.
export function componentData(block) {
  const comp = getComponent(String((block && block.meta && block.meta.ui) || ""));
  let parsed = null, ok = true;
  const text = String((block && block.text) || "").trim();
  if (text) {
    try { parsed = JSON.parse(text); } catch { ok = false; }
    if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) { ok = false; parsed = null; }
  }
  return { comp, ok, data: { ...(comp ? comp.defaults : {}), ...(parsed || {}) } };
}

// Fallback card for anything the reader cannot draw: an unknown block type, an unknown component, or a component whose
// renderer throws. It shows what the block is and its text, never raw HTML, so a rollback or a typo never breaks a page.
export function fallbackCardHtml(kind, text) {
  const body = String(text || "").trim();
  return '<div class="ui-fallback" role="note"><span class="ui-fallback-kind">' + uiEsc(kind) + "</span>" +
    (body ? '<pre class="ui-fallback-text">' + uiEsc(body.length > 600 ? body.slice(0, 600) + "…" : body) + "</pre>" : '<span class="ui-fallback-empty">이 블록은 이 화면에서 아직 그릴 수 없어요.</span>') + "</div>";
}

export function renderComponentBlock(block) {
  const { comp, ok, data } = componentData(block);
  const ui = String((block && block.meta && block.meta.ui) || "");
  if (!comp) return fallbackCardHtml(ui ? "컴포넌트 " + ui : "컴포넌트", block && block.text);
  try {
    // Malformed JSON still draws the component with its defaults, flagged for the editor (data-ui-invalid).
    return '<div class="ui ui-' + comp.id + '" data-ui="' + comp.id + '"' + (ok ? "" : ' data-ui-invalid="1"') + ">" + comp.render(data, uiHelpers) + "</div>";
  } catch {
    return fallbackCardHtml("컴포넌트 " + comp.id, block && block.text);
  }
}

export const COMPONENT_BASE_CSS = ".ui{margin:var(--space-4) 0}.ui-fallback{margin:var(--space-3) 0;padding:var(--space-3) var(--space-4);border:1px dashed var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface-soft);color:var(--color-text-dim);font-size:var(--fs-13)}.ui-fallback-kind{display:inline-block;margin-bottom:var(--space-1);padding:0 var(--space-2);border-radius:var(--radius-pill);background:var(--color-neutral-bg);color:var(--color-neutral-fg);font-size:var(--fs-12);font-weight:600}.ui-fallback-text{margin:var(--space-1) 0 0;white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:var(--fs-12);background:none;padding:0}.ui-fallback-empty{display:block}.ui-btn{display:inline-flex;align-items:center;gap:var(--space-2);height:var(--control-h-md);padding:0 var(--space-4);border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:var(--fs-14);font-weight:600;text-decoration:none}.ui-btn.primary{background:var(--color-accent);border-color:var(--color-accent);color:var(--color-on-accent)}";

// Every rule a page with components needs: the base, then each component's css in registration order.
export function componentCss() {
  return COMPONENT_BASE_CSS + listComponents().map((c) => c.css || "").join("");
}
