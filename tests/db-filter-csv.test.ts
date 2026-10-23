import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as model from "../db-model.js";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const clientModel = source("db-model.js").replace(/^export /gm, "") + "\nwindow.DoriDBModel = {" + Object.keys(model).join(",") + "};";
const payload = {
  database: { id: "db1", slug: "tasks", title: "Tasks" },
  properties: [
    { id: "t", name: "Title", type: "title", config: {}, ord: 0 },
    { id: "s", name: "Status", type: "status", config: { options: [{ id: "open", name: "Open" }, { id: "done", name: "Done" }] }, ord: 1 },
    { id: "n", name: "Note", type: "text", config: {}, ord: 2 },
    { id: "x", name: "Hidden", type: "text", config: {}, ord: 3 },
  ],
  rows: [
    { id: "r1", page: "a", pageTitle: "Alpha", props: { s: "open", n: 'say "hi", ok', x: "h" } },
    { id: "r2", page: "b", pageTitle: "Beta", props: { s: "done", n: "line1\nline2", x: "h" } },
    { id: "r3", page: "c", pageTitle: "Gamma", props: { s: "done", n: "drop", x: "h" } },
  ],
  views: [{ id: "v1", name: "Table", type: "table", config: { visible: ["n", "t", "s"], filter: { property: "n", operator: "is_not", value: "drop" }, sorts: [{ property: "t", direction: "descending" }] } }],
  templates: [],
};

let browser: Bun.WebView;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: () => new Response("<!doctype html><html><body><main></main></body></html>", { headers: { "content-type": "text/html" } }) });
  browser = new Bun.WebView();
  await browser.navigate(server.url.href);
  await browser.evaluate("(() => {\n" + clientModel + "\n" + source("assets/db-views.js") + "\n" + source("assets/db.js") + "\n" + source("assets/features/lazy/db-tools.js") + "\n})()");
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

async function mount(filter: unknown) {
  const data = structuredClone(payload) as any;
  data.views[0].config.filter = filter;
  await browser.evaluate(`(async () => {
    document.querySelector('main').innerHTML = '<div id="db-root"></div>';
    window.saved = [];
    window.fetch = async (url, options) => { if (options && options.method === 'PATCH') saved.push(JSON.parse(options.body)); return { ok: true, json: async () => structuredClone(${JSON.stringify(data)}) }; };
    await DoriDB.load('tasks', { initial: ${JSON.stringify(data)} });
  })()`);
}

const openFilter = "(() => { [...document.querySelectorAll('.dbtool')].find(b => b.textContent.includes('필터')).click(); })()";
const conditions = "document.querySelectorAll('#db-pop .dbfiltercond').length";

describe("database filter groups and CSV export", () => {
  test("an old single filter opens as one condition", async () => {
    await mount({ property: "s", operator: "is", value: "done" });
    await browser.evaluate(openFilter);
    expect(await browser.evaluate(`({ count: ${conditions}, prop: document.querySelector('#db-pop .dbfiltercond select').value, value: document.querySelector('#db-pop .dbfiltercond input.dburl').value })`)).toEqual({ count: 1, prop: "s", value: "done" });
  });

  test("two conditions joined by or are saved as an or group and filter the rows", async () => {
    await mount(null);
    await browser.evaluate(openFilter);
    const result = await browser.evaluate(`(async () => {
      const pop = document.getElementById('db-pop');
      const set = (node, value) => { node.value = value; node.dispatchEvent(new Event('change')); };
      [...pop.querySelectorAll('button')].find(b => b.textContent.includes('조건 추가')).click();
      const conds = pop.querySelectorAll('.dbfiltercond');
      [[conds[0], 't', 'Alpha'], [conds[1], 't', 'Gamma']].forEach(([cond, prop, value]) => {
        const selects = cond.querySelectorAll('select');
        set(selects[0], prop); set(selects[1], 'is');
        cond.querySelector('input.dburl').value = value;
      });
      set(pop.querySelector('select.dbfilterjoin'), 'or');
      [...pop.querySelectorAll('button')].find(b => b.textContent === '적용').click();
      await new Promise(r => setTimeout(r, 0));
      return { filter: saved[saved.length - 1].config.filter, rows: [...document.querySelectorAll('.dbtable tbody input.dbtitle')].map(input => input.value) };
    })()`) as any;
    expect(result.filter).toEqual({ or: [{ property: "t", operator: "is", value: "Alpha" }, { property: "t", operator: "is", value: "Gamma" }] });
    expect(result.rows.sort()).toEqual(["Alpha", "Gamma"]);
  });

  test("CSV export downloads visible properties in view order, filtered and sorted, with BOM and quoting", async () => {
    await mount({ property: "n", operator: "is_not", value: "drop" });
    const result = await browser.evaluate(`(async () => {
      let blob = null, name = null;
      URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
      URL.revokeObjectURL = () => {};
      const click = HTMLAnchorElement.prototype.click;
      let clicked;
      const done = new Promise((resolve) => { clicked = resolve; });
      HTMLAnchorElement.prototype.click = function () { name = this.download; clicked(); };
      try {
        document.querySelector('.dbtabmenu').click();
        [...document.querySelectorAll('#db-menu button')].find(b => b.textContent.includes('CSV로 내보내기')).click();
        await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('no download')), 3000))]);
      } finally { HTMLAnchorElement.prototype.click = click; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { name, type: blob.type, bom: [...bytes.slice(0, 3)], text: new TextDecoder().decode(bytes.slice(3)) };
    })()`) as any;
    expect(result.name).toBe("Tasks.csv");
    expect(result.type).toContain("text/csv");
    expect(result.bom).toEqual([0xef, 0xbb, 0xbf]);
    expect(result.text).toBe('Title,Status,Note\r\nBeta,Done,"line1\nline2"\r\nAlpha,Open,"say ""hi"", ok"\r\n');
  });
});
