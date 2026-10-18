(() => {
  if (window.AcardScrollbars) return;
  window.AcardScrollbars = true;
  const css = `
:root { --sb-thumb: color-mix(in srgb, var(--fg) 28%, transparent); --sb-thumb-hover: color-mix(in srgb, var(--fg) 45%, transparent); }
@supports (scrollbar-color: red blue) {
  html, html * { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  html.sb-on, html .sb-on { scrollbar-color: var(--sb-thumb) transparent; }
}
@supports not (scrollbar-color: red blue) {
  ::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 10px; background: transparent padding-box; }
  .sb-on::-webkit-scrollbar-thumb, html.sb-on::-webkit-scrollbar-thumb { background-color: var(--sb-thumb); }
  .sb-on::-webkit-scrollbar-thumb:hover { background-color: var(--sb-thumb-hover); }
}
.sb-more { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }
`;
  document.head.append(Object.assign(document.createElement("style"), { textContent: css, id: "acard-scrollbars" }));

  const root = document.documentElement;
  const NEAR = 28;
  const timers = new WeakMap();
  const scrollable = (el) => {
    if (el === root || el === document.body) return root;
    const style = getComputedStyle(el);
    return (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
      (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1);
  };
  const show = (el, ms) => {
    el.classList.add("sb-on");
    clearTimeout(timers.get(el));
    if (ms) timers.set(el, setTimeout(() => el.classList.remove("sb-on"), ms));
  };
  const hide = (el) => { clearTimeout(timers.get(el)); timers.set(el, setTimeout(() => el.classList.remove("sb-on"), 1000)); };

  let near = null, pending = null;
  const check = () => {
    const ev = pending; pending = null;
    let el = ev.target instanceof Element ? ev.target : root, hit = null;
    for (; el && el !== root; el = el.parentElement) if (scrollable(el) === true) {
      const r = el.getBoundingClientRect();
      if (r.right - ev.clientX <= NEAR || r.bottom - ev.clientY <= NEAR) { hit = el; break; }
    }
    if (!hit && innerWidth - ev.clientX <= NEAR && root.scrollHeight > innerHeight) hit = root;
    if (hit === near) return;
    if (near) hide(near);
    near = hit;
    if (hit) show(hit, 0);
  };
  addEventListener("pointermove", (ev) => { if (!pending) requestAnimationFrame(check); pending = ev; }, { passive: true });
  root.addEventListener("pointerleave", () => { if (near) hide(near); near = null; }, { passive: true });
  addEventListener("scroll", (ev) => {
    const el = ev.target === document ? root : ev.target;
    if (!(el instanceof Element)) return;
    if (el === near) return;
    show(el, 1000);
    if (el.classList.contains("sb-x")) edge(el);
  }, { passive: true, capture: true });

  const edge = (el) => el.classList.toggle("sb-more", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  const WIDE = ".dbtable, .editable-table, .board, .blocks pre, .table-wrap, .tablewrap";
  const scan = () => document.querySelectorAll(WIDE).forEach((el) => {
    if (el.scrollWidth > el.clientWidth + 2) { el.classList.add("sb-x"); edge(el); }
    else el.classList.remove("sb-x", "sb-more");
  });
  scan();
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; scan(); }, 400); }).observe(document.body, { childList: true, subtree: true });
  addEventListener("resize", () => { if (!queued) { queued = true; setTimeout(() => { queued = false; scan(); }, 200); } }, { passive: true });
})();
