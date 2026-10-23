import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// #103 phone layout (390px): static checks on the CSS that keeps the reader, drawer, menus and dialogs inside the
// viewport and every primary control at a 44px touch target. Measured numbers live in the issue report.
const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const mobile = read("assets/acard-mobile.css");
const style = read("assets/style.css");

// Rules inside the first @media block whose query matches `query`, as [selector, body] pairs.
function mediaRules(css: string, query: RegExp): [string, string][] {
  const start = css.search(query);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0, i = css.indexOf("{", start), end = i;
  for (; end < css.length; end++) { if (css[end] === "{") depth++; else if (css[end] === "}" && --depth === 0) break; }
  return [...css.slice(i + 1, end).matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}
const phone = mediaRules(mobile, /@media \(max-width: 899px\)/);
const decl = (body: string, prop: string) => new RegExp("(?:^|;)\\s*" + prop + ":\\s*([^;]+)").exec(body)?.[1].trim();
// Every phone rule that names `selector` (exact compound, or inside :is()).
function rulesFor(selector: string) {
  return phone.filter(([sel]) => sel.split(/,(?![^(]*\))/).some((part) => {
    const s = part.trim();
    if (s === ".reader " + selector) return true;
    const is = /^\.reader :is\((.*)\)(::?[a-z-]+)?$/.exec(s);
    return !!is && !is[2] && is[1].split(",").map((x) => x.trim()).includes(selector);
  }));
}
const px = (v?: string) => (v && /^\d+px$/.test(v) ? Number.parseInt(v) : 0);
const heightOf = (selector: string) => Math.max(0, ...rulesFor(selector).flatMap(([, b]) => [px(decl(b, "min-height")), px(decl(b, "height"))]));

test("thumb bar buttons are at least 44px tall (#103)", () => {
  const body = /\.thumbbar a, \.thumbbar button \{([^}]*)\}/.exec(style)?.[1] ?? "";
  expect(px(decl(body, "min-height"))).toBeGreaterThanOrEqual(44);
});

test("drawer, page menu and share dialog controls reach 44px on phones (#103)", () => {
  for (const selector of ["#side-more", ".side-add", ".fd-ib", ".fd-more", ".side-root > .row > a", ".fd-link", ".fd-sh", ".seg button", ".shd-tab", ".shd-help", ".ui-btn", "button.tw", ".fd-tw", ".mbar #menu", ".drawer-close", ".page-actions .icon", ".menu a"]) {
    expect({ selector, height: heightOf(selector) >= 44 }).toEqual({ selector, height: true });
  }
  for (const selector of ["#side-more", ".side-add", ".fd-ib", ".fd-more"]) expect(rulesFor(selector).some(([, b]) => px(decl(b, "min-width")) >= 44)).toBe(true);
});

test("narrow twisties and the tag chip get a larger hit area without changing their look (#103)", () => {
  const pseudo = phone.filter(([sel]) => /::(before|after)/.test(sel));
  expect(pseudo.some(([sel, b]) => sel.includes(".fd-tw") && sel.includes("button.tw") && decl(b, "position") === "absolute" && /-\d+px/.test(decl(b, "inset") ?? ""))).toBe(true);
  expect(pseudo.some(([sel, b]) => sel === ".reader .fd-addtag::after" && /^-\d+px/.test(decl(b, "inset") ?? ""))).toBe(true);
  expect(rulesFor(".fd-addtag").some(([, b]) => decl(b, "position") === "relative")).toBe(true);
});

test("wide content scrolls inside its own box, never the page (#103)", () => {
  expect(decl(/(?:^|\})\s*pre \{([^}]*)\}/.exec(style)?.[1] ?? "", "overflow-x")).toBe("auto");
  expect(decl(/(?:^|\})\s*table \{([^}]*)\}/.exec(style)?.[1] ?? "", "overflow-x")).toBe("auto");
  expect(read("assets/acard-table.css")).toMatch(/\.reader \.stable, \.reader \.dbtablewrap \{[^}]*overflow-x: auto/);
});

test("menus and the drawer fit a phone viewport (#103)", () => {
  expect(rulesFor(".menu").some(([, b]) => /calc\(100vw - \d+px\)/.test(decl(b, "max-width") ?? ""))).toBe(true);
  expect(rulesFor(".menu").some(([, b]) => /100dvh/.test(decl(b, "max-height") ?? "") && decl(b, "overflow-y") === "auto")).toBe(true);
  expect(phone.some(([sel, b]) => sel.includes(".reader .sidebar") && /min\(320px, calc\(100vw - \d+px\)\)/.test(decl(b, "width") ?? ""))).toBe(true);
  expect(rulesFor(".mbar .brand").some(([, b]) => decl(b, "min-width") === "0" && decl(b, "overflow") === "hidden")).toBe(true);
});

test("phone form fields use at least 16px text so iOS does not zoom on focus (#103)", () => {
  const field = phone.find(([sel]) => sel.startsWith(".reader :is(input"));
  expect(field?.[0]).toContain("select");
  expect(field?.[0]).toContain("textarea");
  expect(decl(field?.[1] ?? "", "font-size")).toBe("var(--fs-16)");
  expect(read("assets/tokens.css")).toMatch(/--fs-16:\s*16px/);
});
