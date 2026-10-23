import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const chstIds = ["chart-scatter", "chart-bubble", "chart-histogram", "chart-boxplot"];
const chstRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const chstWide = (html: string) => html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)![0];
const chstMarks = (html: string, cls: string) => [...chstWide(html).matchAll(new RegExp('<[^>]+class="' + cls + '"[^>]*>', "g"))].map((m) => m[0]);
const chstAttr = (mark: string, key: string) => Number(mark.match(new RegExp('\\b' + key + '="([^"]+)"'))![1]);
const chstRows = (html: string) => [...html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<(?:td|th)\b[^>]*>(.*?)<\/(?:td|th)>/g)].map((c) => c[1]));

describe("statistical charts", () => {
  test("catalog, presets, accessibility and responsive bodies", () => {
    for (const id of chstIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("chart");
      expect(c.schema.required.length).toBeGreaterThan(0);
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
      expect(c.css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius:\s*\d+px/);
      for (const preset of ["report", "friendly", "paper", "showcase"]) {
        const html = chstRender(id, { ...c.sample, preset });
        expect(html).not.toContain("ui-fallback");
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).toContain('data-preset="' + preset + '"');
        expect(html).toContain('viewBox="0 0 640 320"');
        expect(html).toContain('viewBox="0 0 360 300"');
        expect(html).toMatch(/role="img" aria-labelledby="[^"]+"/);
        expect(html).toMatch(/<title id="[^"]+">.+?<\/title><desc id="[^"]+">.+?<\/desc>/);
        const n = c.sample.points?.length ?? c.sample.values?.length ?? c.sample.groups.reduce((sum: number, g: any) => sum + g.values.length, 0);
        expect(chstRows(html)).toHaveLength(n);
      }
    }
  });

  test("empty, malformed and invalid point data remain calm", () => {
    for (const id of chstIds) for (const data of [{}, "{ broken", { points: [null, {}, { x: 2, y: "bad", r: 2 }], values: [null, "bad"], groups: [null, {}] }]) {
      const html = chstRender(id, data);
      expect(html).toContain('class="vk-empty"');
      expect(html).not.toContain("ui-fallback");
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });

  test("every string field is escaped and repeated charts have unique ids", () => {
    const poison = (v: any): any => typeof v === "string" ? '<script>1</script>\"><img onerror="x">' : Array.isArray(v) ? v.map(poison) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, poison(x)])) : v;
    for (const id of chstIds) {
      const data = { ...poison(getComponent(id)!.sample), title: '<script>x</script>', source: '\"><img onerror="x">', caption: '<script>x</script>', xUnit: '<script>x</script>', yUnit: '<script>x</script>' };
      const html = chstRender(id, data) + chstRender(id, data);
      expect(html).not.toMatch(/<script|<img|ui-fallback/);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("least squares uses all observations, colors groups and omits a vertical fit", () => {
    const html = chstRender("chart-scatter", { trend: true, points: [{ x: 0, y: 1, group: "A" }, { x: 1, y: 4, group: "B" }, { x: 2, y: 3, group: "A" }] });
    const dots = chstMarks(html, "vk-chst-point"), line = chstMarks(html, "vk-chst-trend")[0];
    const y = (v: number) => chstAttr(dots[0], "cy") + (v - 1) * (chstAttr(dots[2], "cy") - chstAttr(dots[0], "cy")) / 2;
    expect(chstAttr(line, "x1")).toBe(chstAttr(dots[0], "cx"));
    expect(chstAttr(line, "x2")).toBe(chstAttr(dots[2], "cx"));
    expect(Math.abs(chstAttr(line, "y1") - y(5 / 3))).toBeLessThan(0.15);
    expect(Math.abs(chstAttr(line, "y2") - y(11 / 3))).toBeLessThan(0.15);
    expect(dots[0]).toContain('fill="var(--viz-1)"');
    expect(dots[1]).toContain('fill="var(--viz-2)"');
    expect(line).toContain('stroke-dasharray="6 4"');
    expect(chstMarks(chstRender("chart-scatter", { trend: true, points: [{ x: 2, y: 1 }, { x: 2, y: 4 }] }), "vk-chst-trend")).toHaveLength(0);
  });

  test("bubble area, not radius, is proportional to r and zero stays zero", () => {
    const html = chstRender("chart-bubble", { points: [1, 4, 9, 0].map((r, i) => ({ x: i, y: i, r, label: "제품 " + i })) });
    const radii = chstMarks(html, "vk-chst-point").map((m) => chstAttr(m, "r")).sort((a, b) => a - b);
    expect(radii[0]).toBe(0);
    expect(radii[2] ** 2 / radii[1] ** 2).toBeCloseTo(4, 8);
    expect(radii[3] ** 2 / radii[1] ** 2).toBeCloseTo(9, 8);
    expect(chstRows(html)).toHaveLength(4);
  });

  test("histogram keeps all observations, bins boundary values correctly and touches adjacent edges", () => {
    const html = chstRender("chart-histogram", { values: [0, 1, 2, 3, 4], bins: 2 });
    const bars = chstMarks(html, "vk-chst-bin");
    expect(bars).toHaveLength(2);
    expect(chstAttr(bars[0], "height") / chstAttr(bars[1], "height")).toBeCloseTo(2 / 3, 2);
    expect(chstAttr(bars[0], "x") + chstAttr(bars[0], "width")).toBeCloseTo(chstAttr(bars[1], "x"), 6);
    expect(chstRows(html).map((r) => r.slice(1))).toEqual([["0", "0", "2"], ["1", "0", "2"], ["2", "2", "4"], ["3", "2", "4"], ["4", "2", "4"]]);
    expect(chstMarks(chstRender("chart-histogram", { values: [1, 2, 3, 4, 5, 6, 7, 8] }), "vk-chst-bin")).toHaveLength(4);
    expect(chstMarks(chstRender("chart-histogram", { values: [7, 7, 7] }), "vk-chst-bin")).toHaveLength(1);
  });

  test("boxplot interpolates quartiles, uses observed whiskers and identifies outliers", () => {
    const html = chstRender("chart-boxplot", { groups: [{ label: "A", values: [100, 4, 1, 3, 2] }, { label: "B", values: [0, 10, 20, 30] }, { label: "C", values: [8] }] });
    const rows = chstRows(html);
    expect(rows[0].slice(2, 7)).toEqual(["1", "2", "3", "4", "4"]);
    expect(rows[4].slice(1)).toEqual(["100", "1", "2", "3", "4", "4", "예"]);
    expect(rows[5].slice(2, 7)).toEqual(["0", "7.5", "15", "22.5", "30"]);
    expect(rows[9].slice(2, 7)).toEqual(["8", "8", "8", "8", "8"]);
    expect(chstMarks(html, "vk-chst-outlier")).toHaveLength(1);
    expect(chstMarks(html, "vk-chst-median")).toHaveLength(3);
  });

  test("precomputed boxplots preserve supplied statistics and reject unordered summaries", () => {
    const html = chstRender("chart-boxplot", { groups: [{ label: "A", min: 1, q1: 3, median: 5, q3: 7, max: 9 }, { label: "invalid", min: 4, q1: 3, median: 5, q3: 7, max: 9 }] });
    expect(chstRows(html)).toHaveLength(1);
    expect(chstRows(html)[0].slice(2, 7)).toEqual(["1", "3", "5", "7", "9"]);
    expect(chstMarks(html, "vk-chst-box")).toHaveLength(1);
  });
});
