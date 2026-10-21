import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { normaliseView } from "../db-model.js";

// Evaluate the exact classic-script model registered by the lazy chunk.
let chart: any;
new Function("window", readFileSync(new URL("../assets/features/lazy/chart.js", import.meta.url), "utf8"))({ AcardEditor: { provide(name: string, api: any) { chart = api; } } });
const properties = [
  { id: "category", name: "분류", type: "select", config: { options: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] } },
  { id: "number", name: "값", type: "number" },
  { id: "date", name: "날짜", type: "date" },
  { id: "text", name: "텍스트", type: "text" },
];
const rows = [
  { props: { category: "a", number: 4, date: { start: "2026-01-02T10:00" } } },
  { props: { category: "a", number: 8, date: { start: "2026-01-02" } } },
  { props: { category: "b", number: 0, date: { start: "2026-01-15" } } },
  { props: { category: "b", number: -2, date: { start: "2026-02-01" } } },
  { props: { category: "b", number: null, date: { start: "2026-02-30" } } },
];
const model = (config = {}, data: { props: Record<string, unknown> }[] = rows) => chart.model(properties, data, { category: "category", value: "number", ...config });

describe("chart aggregation", () => {
  test("counts every row and uses option labels", () => {
    expect(model().points.map(({ label, value }: any) => [label, value])).toEqual([["Alpha", 2], ["Beta", 3]]);
  });
  test("sum and average include zero and negative values but exclude missing values", () => {
    expect(model({ aggregation: "sum" }).points.map((p: any) => p.value)).toEqual([12, -2]);
    expect(model({ aggregation: "avg" }).points.map((p: any) => p.value)).toEqual([6, -1]);
  });
  test("date groups are chronological days or months and invalid dates are excluded", () => {
    expect(model({ category: "date" }, rows.slice().reverse()).points.map((p: any) => [p.key, p.value])).toEqual([["2026-01-02", 2], ["2026-01-15", 1], ["2026-02-01", 1]]);
    expect(model({ category: "date", bucket: "month", aggregation: "avg" }).points.map((p: any) => [p.key, p.value])).toEqual([["2026-01", 4], ["2026-02", -2]]);
  });
  test("missing text groups cannot collide with user text and values adapter is honored", () => {
    const data = [{ values: { text: "__proto__" } }, { values: { text: "" } }, { values: { text: "없음" } }];
    expect(chart.model(properties, data, { category: "text" }, (row: any) => row.values).points).toHaveLength(3);
  });
  test("invalid numeric values and removed properties yield no points", () => {
    const bad = [null, "", "4", NaN, Infinity, false].map(number => ({ props: { category: "a", number } }));
    expect(model({ aggregation: "sum" }, bad).points).toEqual([]);
    expect(model({ category: "removed" }).points).toEqual([]);
    expect(model({ aggregation: "avg", value: "text" }).points).toEqual([]);
    expect(model({}, []).points).toEqual([]);
  });
});

describe("chart SVG", () => {
  test("bar and line output contains one mark per category and accessible titles", () => {
    const bar = chart.svg(model({ aggregation: "sum" }));
    expect(bar.match(/class="ac-chart-bar"/g)).toHaveLength(2);
    expect(bar).toContain('<title>Alpha: 12</title>');
    expect(bar).toContain('role="img"');
    expect(bar).not.toMatch(/NaN|Infinity/);
    const line = chart.svg(model({ kind: "line" }));
    expect(line.match(/class="ac-chart-point"/g)).toHaveLength(2);
    expect(line.match(/<polyline/g)).toHaveLength(1);
  });
  test("donut has one arc per positive category including a complete single-category ring", () => {
    expect(chart.svg(model({ kind: "donut" })).match(/class="ac-chart-arc"/g)).toHaveLength(2);
    const one = chart.svg(model({ kind: "donut" }, rows.slice(0, 1)));
    expect(one.match(/class="ac-chart-arc"/g)).toHaveLength(1);
    expect(one.match(/A 120 120/g)).toHaveLength(2);
  });
  test("empty and unusable donut data have status text instead of misleading geometry", () => {
    for (const kind of ["bar", "line", "donut"]) {
      const html = chart.svg(model({ kind }, []));
      expect(html).not.toContain("<svg");
      expect(html).toContain('role="status"');
    }
    expect(chart.svg(model({ kind: "donut", aggregation: "sum" }))).not.toContain("<svg");
    expect(chart.svg(model({ kind: "donut", aggregation: "sum" }, [rows[2]]))).not.toContain("<svg");
  });
  test("labels are escaped and large finite values do not create invalid geometry", () => {
    const m = chart.model(properties, [{ props: { text: '<img src=x onerror="alert(1)">', number: 1e308 } }, { props: { text: "b", number: -1e308 } }], { category: "text", value: "number", aggregation: "sum" });
    const html = chart.svg(m);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

describe("horizontal bar and number charts", () => {
  test("hbar bars start at the same x and their widths follow the values", () => {
    const svg = chart.svg(model({ kind: "hbar", aggregation: "sum" }, rows.slice(0, 3)));
    const bars = [...svg.matchAll(/<rect class="ac-chart-bar" x="([\d.]+)"[^>]*width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(bars).toHaveLength(2);
    expect(bars[0][0]).toBe(bars[1][0]);
    expect(bars[0][1]).toBeGreaterThan(0);
    expect(bars[1][1]).toBe(0);
    const counts = [...chart.svg(model({ kind: "hbar" })).matchAll(/<rect class="ac-chart-bar" x="([\d.]+)"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[2]));
    expect(counts[0] / counts[1]).toBeCloseTo(2 / 3);
    expect(svg).toContain("<title>Alpha: 12</title>");
  });
  test("number is one aggregate over every row: count, sum and the mean of all rows", () => {
    expect(chart.model(properties, rows, { kind: "number" }).points.map((p: any) => p.value)).toEqual([5]);
    expect(chart.model(properties, rows, { kind: "number", aggregation: "sum", value: "number" }).points.map((p: any) => p.value)).toEqual([10]);
    expect(chart.model(properties, rows, { kind: "number", aggregation: "avg", value: "number" }).points.map((p: any) => p.value)).toEqual([2.5]);
    const html = chart.svg(chart.model(properties, rows, { kind: "number", aggregation: "sum", value: "number" }));
    expect(html).toContain("<strong>10</strong>");
    expect(html).toContain("값 합계");
  });
  test("number with sum and no number property says there is nothing to show", () => {
    const html = chart.svg(chart.model([properties[0]], rows, { kind: "number", aggregation: "sum" }));
    expect(html).toContain("표시할 숫자 데이터가 없어요.");
    expect(html).not.toContain("<strong>");
  });
  test("normaliseView keeps hbar and number", () => {
    for (const kind of ["hbar", "number"]) expect(normaliseView({ type: "chart", config: { chart: { kind } } }, 0).config.chart?.kind).toBe(kind);
  });
});

test("chart configuration survives the same normalizer used by API writes and reads", () => {
  const config = { chart: { kind: "donut", category: "category", aggregation: "avg", value: "number", bucket: "month" } };
  const view = normaliseView({ type: "chart", config }, 0);
  expect(view.type).toBe("chart");
  expect(view.config.chart).toEqual(config.chart);
  expect(normaliseView(JSON.parse(JSON.stringify(view)), 0)).toEqual(view);
  expect(normaliseView({ type: "chart", config: { chart: { kind: "pie", aggregation: "script", bucket: "year" } } }, 0).config.chart).toEqual({ kind: "bar", aggregation: "count", category: "", value: "", bucket: "day" });
});
