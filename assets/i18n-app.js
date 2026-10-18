(() => {
  const lang = window.ACARD_LANG;
  if (!lang || lang === "ko") return;
  // Page content written by the user never goes through the dictionary: reader article, editor blocks, editable areas.
  const SKIP = '#article, #blocks, [contenteditable], [translate="no"], script, style, textarea, code, pre';
  const CHROME = 'button, [role="tab"], [role="menuitem"], .table-toolbar, .table-tabs, .crumbs, .dbempty, .tempty, .backlinks h2, .byline';
  const ATTRS = ["placeholder", "title", "aria-label", "alt", "data-tip"];
  const blocked = (el) => { const s = el.closest(SKIP); return !!s && !(el.closest(CHROME) && s.contains(el.closest(CHROME)) && !el.closest('[contenteditable], [translate="no"], textarea')); };
  let map = null;
  const pending = [];
  const tr = (s) => {
    const key = s.trim();
    let hit = key && map[key];
    if (!hit && /\d/.test(key)) {
      const nums = key.match(/\d[\d,.]*/g);
      const tpl = map[key.replace(/\d[\d,.]*/g, "{n}")];
      if (tpl) { let i = 0; hit = tpl.replace(/\{n\}/g, () => nums[i++] ?? ""); }
    }
    if (!hit || hit === key) return null;
    const out = s.replace(key, hit);
    return out === s ? null : out;
  };
  const visit = (root) => {
    if (root.nodeType === 3) {
      const p = root.parentElement;
      if (p && !blocked(p)) { const v = tr(root.nodeValue); if (v) root.nodeValue = v; }
      return;
    }
    if (root.nodeType !== 1) return;
    if (!blocked(root)) for (const a of ATTRS) { const v = root.getAttribute(a); if (v) { const t = tr(v); if (t) root.setAttribute(a, t); } }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches('script, style, textarea, [contenteditable], [translate="no"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) { if (!blocked(n.parentElement)) { const v = tr(n.nodeValue); if (v) n.nodeValue = v; } }
      else if (!blocked(n)) for (const a of ATTRS) { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t) n.setAttribute(a, t); } }
    }
  };
  const origAlert = window.alert, origConfirm = window.confirm, origPrompt = window.prompt;
  const msg = (s) => (map && typeof s === "string" ? tr(s) ?? s : s);
  window.alert = (s) => origAlert.call(window, msg(s));
  window.confirm = (s) => origConfirm.call(window, msg(s));
  window.prompt = (s, d) => origPrompt.call(window, msg(s), d);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") { if (map) visit(m.target); else pending.push(m.target); continue; }
      if (m.type === "attributes") { if (map) visit(m.target); continue; }
      for (const n of m.addedNodes) map ? visit(n) : pending.push(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  fetch("/i18n/app-" + lang + ".json").then((r) => r.json()).then((m) => {
    map = m;
    visit(document.body);
    for (const n of pending.splice(0)) visit(n);
    document.title = tr(document.title) ?? document.title;
  }).catch(() => undefined);
})();
