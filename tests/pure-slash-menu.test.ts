import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Exercise the shipped chunk, not only the pure search and grouping slice.
const chunk = readFileSync(new URL("../dist/lazy/easy-insert.js", import.meta.url), "utf8");
let view: InstanceType<typeof Bun.WebView>;

beforeAll(async () => {
  view = new Bun.WebView({ width: 1440, height: 900 });
  await view.navigate("about:blank");
  await view.evaluate(`(() => {
    document.body.innerHTML = '<div id="blocks"><div id="anchor" contenteditable="true"></div></div><div id="slash" hidden></div>';
    const provided = {};
    window.AcardEditor = {
      state: { blocks: [{ id: "b1", type: "paragraph", text: "" }] },
      render() {}, scheduleSave() {},
      provide(name, api) { provided[name] = api; },
      lazy(name) { return Promise.reject(new Error("no " + name)); },
      api() { return Promise.resolve({}); }
    };
    ${chunk}
    window.drawSlash = (query) => {
      const el = document.getElementById("slash");
      const items = provided["easy-insert"].menu(el, [
        { type: "paragraph", label: "Text", ico: "T" },
        { type: "heading1", label: "Heading", ico: "H" }
      ], query, document.getElementById("anchor"), () => {});
      return JSON.stringify({ count: el.querySelectorAll("button").length, items: items.length, shown: !el.hidden, grouped: el.classList.contains("slash-x") });
    };
  })()`);
});

afterAll(async () => { await view?.close(); });

for (const query of ["", "heading"]) {
  test(`the built slash menu draws buttons for ${query || "an empty query"}`, async () => {
    const result = JSON.parse(await view.evaluate(`drawSlash(${JSON.stringify(query)})`) as string);
    expect(result.count).toBeGreaterThan(0);
    expect(result.items).toBe(result.count);
    expect(result.shown).toBe(true);
    expect(result.grouped).toBe(true);
  });
}
