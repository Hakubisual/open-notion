import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// #95: buttons, fields, menus and dialogs share one token-driven look. Every rule that styles a primitive in kit.css or
// editor.css takes its color, radius and shadow from tokens.css variables, and the documented variant classes exist.
const ROOT = join(import.meta.dir, "..");
const PRIMITIVE = /\.(ui-btn|ui-input|ui-select|ui-textarea|ui-menu|ui-dialog|mini|minibtn|slash|ctxmenu|editor-panel|format-toolbar|murl|eqsrc)\b/;
const CHECKED = /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|border-radius|box-shadow|outline(-color)?)$/;
const KEYWORD = /^(none|0|transparent|inherit|currentColor|0 \d+px|\d+px solid transparent|1px solid transparent)$/;

async function rules(file: string) {
  const css = (await readFile(join(ROOT, file), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].replace(/^[\s\S]*\{/, "").trim(), body: m[2] }));
}

function offenders(file: string, list: { selector: string; body: string }[]) {
  const out: string[] = [];
  for (const { selector, body } of list) {
    // The modal scrim is the one theme-independent dim and has no token yet.
    if (!PRIMITIVE.test(selector) || selector.includes("::backdrop")) continue;
    for (const decl of body.split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const prop = decl.slice(0, at).trim(), value = decl.slice(at + 1).replace("!important", "").trim();
      if (!CHECKED.test(prop)) continue;
      if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value) || !(value.includes("var(--") || KEYWORD.test(value))) out.push(file + " " + selector + " { " + prop + ": " + value + " }");
    }
  }
  return out;
}

test("primitive rules in kit.css and editor.css use only tokens for color, radius and shadow", async () => {
  const bad = [...offenders("assets/ui/kit.css", await rules("assets/ui/kit.css")), ...offenders("assets/editor.css", await rules("assets/editor.css"))];
  expect(bad).toEqual([]);
});

test("the button, field, menu and dialog variant classes exist and sizes come from --control-h-*", async () => {
  const kit = await rules("assets/ui/kit.css");
  const body = (selector: string) => kit.filter((r) => r.selector.split(",").map((s) => s.trim()).includes(selector)).map((r) => r.body).join(";");
  for (const name of [".ui-btn", ".ui-btn-sm", ".ui-btn-md", ".ui-btn-lg", ".ui-btn-primary", ".ui-btn-secondary", ".ui-btn-ghost", ".ui-btn-danger", ".ui-input", ".ui-select", ".ui-textarea", ".ui-menu", ".ui-menu-item", ".ui-dialog", ".ui-dialog-head", ".ui-dialog-foot"]) expect(body(name)).not.toBe("");
  expect(body(".ui-btn-sm")).toContain("var(--control-h-sm)");
  expect(body(".ui-btn-md")).toContain("var(--control-h-md)");
  expect(body(".ui-btn-lg")).toContain("var(--control-h-lg)");
  expect(body(".ui-input")).toContain("var(--control-h-md)");
  expect(body(".ui-input:focus")).toContain("var(--focus-ring)");
  expect(body(".ui-menu")).toContain("var(--shadow-lg)");
  expect(body(".ui-dialog")).toContain("var(--radius-xl)");
  const editor = (await rules("assets/editor.css")).filter((r) => /^\.editor-panel \{?$|^\.editor-panel$/.test(r.selector)).map((r) => r.body).join(";");
  expect(editor).toContain("var(--radius-xl)");
  expect(editor).toContain("var(--shadow-lg)");
});
