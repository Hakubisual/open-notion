const titles = [...document.querySelectorAll(".ex-card [data-type]")];
const still = matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window);
if (titles.length && !still) {
  const type = (el) => {
    const text = el.textContent;
    const chars = [...text];
    el.style.minHeight = el.offsetHeight + "px";
    el.setAttribute("aria-label", text);
    el.textContent = "";
    el.classList.add("typing");
    let i = 0;
    const step = () => {
      i += 1;
      el.textContent = chars.slice(0, i).join("");
      if (i < chars.length) setTimeout(step, 34);
      else { el.classList.remove("typing"); el.removeAttribute("aria-label"); el.style.minHeight = ""; }
    };
    step();
  };
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      seen.unobserve(entry.target);
      entry.target.closest(".ex-card").classList.add("in");
      type(entry.target);
    }
  }, { threshold: 0.6 });
  for (const el of titles) {
    const box = el.getBoundingClientRect();
    if (box.top < innerHeight && box.bottom > 0) el.closest(".ex-card").classList.add("in");
    else { el.closest(".ex-card").classList.add("wait"); seen.observe(el); }
  }
}
