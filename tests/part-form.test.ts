import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { blocksToMarkdown, markdownToBlocks } from "../markdown-blocks.ts";
import { PART_DEFAULTS, parsePartData, validatePartData } from "../part-html.js";

// #38 fill screen: the part-form chunk draws a form from the part's schema, writes data only when it passes the same
// check set_part_data uses, and shows the check's error otherwise. Runs the shipped chunk in a real WebView.
const chunk = readFileSync(new URL("../assets/features/lazy/part-form.js", import.meta.url), "utf8");
const helpers = [parsePartData, validatePartData].map(String).join("\n") + "\n" + readFileSync(new URL("../part-html.js", import.meta.url), "utf8").match(/function partTypeOf[\s\S]*?\n}\n/)![0];
let view: InstanceType<typeof Bun.WebView>;

beforeAll(async () => {
  view = new Bun.WebView({ width: 1000, height: 900 });
  await view.navigate("about:blank");
  await view.evaluate(`(() => {
    ${helpers}
    window.AcardEditor = { provide(name, api) { window.form = api; } };
    ${chunk}
    window.mountPart = (id, text) => {
      const def = ${JSON.stringify(PART_DEFAULTS)}.find(p => p.id === id);
      document.body.innerHTML = '<div id="h"></div>';
      window.block = { id: 'b1', type: 'part', text, meta: { part: id, v: 1 } };
      window.saves = 0;
      form.mount(document.getElementById('h'), { block, schema: def.schema, name: def.name, version: 1, focus: true, parse: parsePartData, validate: validatePartData,
        save() { saves++; }, preview(el) { el.textContent = 'preview'; } });
    };
    window.type = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  })()`);
});
afterAll(() => view?.close());

const json = async (expr: string) => JSON.parse(await view.evaluate(`JSON.stringify(${expr})`) as string);

test("a table part fills as a grid: cells, + 행 추가, 합계 자동 계산, and the data round-trips through the markdown fence", async () => {
  const sample = PART_DEFAULTS.find((p) => p.id === "table")!.sample;
  await view.evaluate(`mountPart('table', ${JSON.stringify(JSON.stringify(sample, null, 2))})`);
  expect(await json(`[document.querySelector('.pf-chip').textContent, document.activeElement.dataset.path]`)).toEqual(["부품 · 표 v1", "data.title"]);
  expect(await json(`document.querySelectorAll('.pf-table tbody tr').length`)).toBe(3);
  await view.evaluate(`type('[data-path="data.rows[0][1]"]', '1,200')`);
  await view.evaluate(`document.querySelectorAll('.pf-add')[0].click()`);
  await view.evaluate(`type('[data-path="data.rows[3][0]"]', 'o3'), type('[data-path="data.rows[3][2]"]', '0.5')`);
  await view.evaluate(`type('[data-path="data.columns[2]"]', '금액')`);
  const data = parsePartData(await view.evaluate("block.text") as string)!;
  expect(data.rows).toEqual([["gpt-5.5", 1200, 3.2], ["claude", 80, 2.1], ["gemini", 40, 0.7], ["o3", null, 0.5]]);
  expect(data.columns).toEqual(["모델", "호출", "금액"]);
  expect(data.sum).toEqual([1, 2]);
  expect(await json("document.querySelector('.pf-err').hidden")).toBe(true);
  expect(await json("saves")).toBeGreaterThan(0);
  const [back] = markdownToBlocks(blocksToMarkdown([{ id: "b1", type: "part", text: await view.evaluate("block.text") as string, indent: 0, checked: false, meta: { part: "table", v: 1 } } as any]));
  expect(back.type).toBe("part");
  expect(back.meta).toMatchObject({ part: "table", v: 1 });
  expect(parsePartData(back.text)).toEqual(data);
  expect(validatePartData(PART_DEFAULTS.find((p) => p.id === "table")!.schema, data)).toEqual([]);
});

test("data the schema refuses shows the check's error on the field and is not saved", async () => {
  const sample = PART_DEFAULTS.find((p) => p.id === "chart")!.sample;
  await view.evaluate(`mountPart('chart', ${JSON.stringify(JSON.stringify(sample))})`);
  const before = await view.evaluate("block.text");
  await view.evaluate(`type('[data-path="data.series[0].data[1]"]', '여덟')`);
  expect(await json(`[document.querySelector('.pf-err').hidden, document.querySelector('.pf-err').textContent]`)).toEqual([false, expect.stringContaining("data.series[0].data[1]: number|null 이어야 해요 (지금 string)")]);
  expect(await json(`document.querySelector('[data-path="data.series[0].data[1]"]').getAttribute('aria-invalid')`)).toBe("true");
  expect(await view.evaluate("block.text")).toBe(before);
  await view.evaluate(`type('[data-path="data.series[0].data[1]"]', '12')`);
  expect(await json("document.querySelector('.pf-err').hidden")).toBe(true);
  expect(parsePartData(await view.evaluate("block.text") as string)!.series).toEqual([{ name: "작업", data: [5, 12, 3, 9, 6] }]);
});

test("every default part opens as a form whose untouched sample saves unchanged; JSON mode refuses bad JSON", async () => {
  for (const part of PART_DEFAULTS) {
    await view.evaluate(`mountPart(${JSON.stringify(part.id)}, ${JSON.stringify(JSON.stringify(part.sample, null, 2))})`);
    expect(await json(`[document.querySelector('.pf-body').hidden, document.querySelectorAll('.pf-body input, .pf-body select').length > 2]`), part.id).toEqual([false, true]);
    expect(parsePartData(await view.evaluate("block.text") as string), part.id).toEqual(part.sample);
  }
  await view.evaluate(`document.querySelector('.pf-mode').click(), type('.pf-json', '{"nodes": 3}')`);
  expect(await json(`document.querySelector('.pf-err').textContent`)).toContain("data.nodes: array 이어야 해요");
  expect(parsePartData(await view.evaluate("block.text") as string)).toEqual(PART_DEFAULTS.find((p) => p.id === "dag")!.sample);
});
