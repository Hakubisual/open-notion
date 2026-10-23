import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const chflIds = ["chart-heatmap", "chart-treemap", "chart-sunburst", "chart-waterfall", "chart-gantt"];
const chflRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", meta: { ui }, text: typeof data === "string" ? data : JSON.stringify(data) });
const chflWide = (html: string) => html.split("</svg>")[0];
const chflRects = (html: string, cls: string) => [...chflWide(html).matchAll(new RegExp('<rect class="' + cls + '"[^>]+>', "g"))].map(([tag]) => Object.fromEntries([...tag.matchAll(/\s(x|y|width|height)="([\d.-]+)"/g)].map(([, key, value]) => [key, Number(value)])));
const chflRows = (html: string) => (html.split("<tbody>")[1]?.split("</tbody>")[0].match(/<tr>/g) || []).length;

describe("flow and hierarchy charts", () => {
  test("all five register their contracts and accessible responsive samples", () => {
    for (const [i, id] of chflIds.entries()) {
      const c = getComponent(id)!;
      expect(c.family).toBe("chart");
      for (const field of c.schema.required) expect(c.defaults[field]).toBeDefined();
      expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      expect(c.slash.ico).toBeTruthy();
      expect(Object.keys(c.presets).sort()).toEqual(["friendly", "paper", "report", "showcase"]);
      const html = chflRender(id, c.sample);
      expect(html).toContain('data-ui="' + id + '"');
      expect(html).not.toContain("ui-fallback");
      expect(html).toContain('role="img"');
      expect(html).toContain("<title id=");
      expect(html).toContain("<desc id=");
      expect(html).toContain('viewBox="0 0 640 320"');
      expect(html).toContain('viewBox="0 0 360 300"');
      expect(chflRows(html)).toBe([35, 6, 6, 6, 5][i]);
      expect(c.css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|border-radius:\s*\d+px/i);
      for (const preset of Object.keys(c.presets)) expect(chflRender(id, { ...c.sample, preset })).not.toContain("ui-fallback");
    }
  });

  test("empty, malformed and wrong-shaped data stay calm", () => {
    for (const id of chflIds) {
      for (const data of [{}, "{broken", { rows: [null], cols: false, values: {}, items: [null, false], tree: { children: [null] }, steps: [null, {}], tasks: [null, { start: "bad" }] }]) {
        const html = chflRender(id, data);
        expect(html).toContain('class="vk-empty"');
        expect(html).not.toContain("ui-fallback");
        expect(html).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  test("all string fields escape hostile HTML and repeated samples have unique ids", () => {
    const poison = (value: unknown): unknown => typeof value === "string" ? '"><script>alert(1)</script><img onerror=x>' : Array.isArray(value) ? value.map(poison) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "start" || key === "end" ? item : poison(item)])) : value;
    for (const id of chflIds) {
      const sample = getComponent(id)!.sample;
      const html = chflRender(id, { ...(poison(sample) as object), title: "<script>", source: "<img onerror=x>", unit: '"><img>' });
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("ui-fallback");
      const pair = chflRender(id, sample) + chflRender(id, sample);
      const ids = [...pair.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("heatmap has one cell per matrix point, distinct intensity steps and missing values", () => {
    const html = chflRender("chart-heatmap", { rows: ["A", "B"], cols: ["a", "b", "c"], values: [[0, 10, 20], [30, 40, 50]] });
    expect(chflRects(html, "chfl-cell")).toHaveLength(6);
    const fills = [...chflWide(html).matchAll(/class="chfl-cell"[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(fills).size).toBe(6);
    expect(fills[0]).toContain("12%");
    expect(fills[5]).toContain("72%");
    expect(chflRows(html)).toBe(6);
    const missing = chflRender("chart-heatmap", { rows: ["A"], cols: ["a", "b"], values: [[0, null]] });
    expect(missing).toContain('fill="var(--color-surface-soft)"');
    expect(chflRects(missing, "chfl-cell")).toHaveLength(2);
  });

  test("squarified areas preserve shares, tile the frame, and never overlap", () => {
    for (const grouped of [false, true]) {
      const values = [6, 4, 3, 2, 1, 0.5];
      const html = chflRender("chart-treemap", { items: values.map((value, i) => ({ label: "item " + i, value, ...(grouped ? { group: i < 3 ? "A" : "B" } : {}) })) });
      const cells = chflRects(html, "chfl-tile"), area = 636 * 316;
      expect(cells).toHaveLength(6);
      expect(Math.abs(cells.reduce((sum, c) => sum + c.width * c.height, 0) - area)).toBeLessThan(100);
      cells.forEach((cell, i) => {
        expect(Math.abs(cell.width * cell.height / area - values[i] / 16.5)).toBeLessThan(0.001);
        expect(cell.x).toBeGreaterThanOrEqual(2);
        expect(cell.y).toBeGreaterThanOrEqual(2);
        expect(cell.x + cell.width).toBeLessThanOrEqual(638.1);
        expect(cell.y + cell.height).toBeLessThanOrEqual(318.1);
        for (const other of cells.slice(i + 1)) {
          const dx = Math.min(cell.x + cell.width, other.x + other.width) - Math.max(cell.x, other.x);
          const dy = Math.min(cell.y + cell.height, other.y + other.height) - Math.max(cell.y, other.y);
          expect(dx <= 0.11 || dy <= 0.11).toBe(true);
        }
      });
    }
  });

  test("sunburst root angles sum to a full turn and third-ring hierarchy renders", () => {
    const tree = { label: "root", children: [1, 2, 3].map((value, i) => ({ label: "group" + i, children: [{ label: "middle", children: [{ label: "leaf", value }] }] })) };
    const html = chflRender("chart-sunburst", { tree });
    const arcs = [...chflWide(html).matchAll(/class="chfl-ring-1" d="M([\d.-]+) ([\d.-]+) A[\d.]+ [\d.]+ 0 ([01]) 1 ([\d.-]+) ([\d.-]+)/g)];
    expect(arcs).toHaveLength(3);
    const angles = arcs.map(([, sx, sy, , ex, ey]) => {
      const start = Math.atan2(Number(sy) - 160, Number(sx) - 320), end = Math.atan2(Number(ey) - 160, Number(ex) - 320);
      return (end - start + Math.PI * 2) % (Math.PI * 2);
    });
    expect(angles.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.PI * 2, 2);
    angles.forEach((angle, i) => expect(angle / (Math.PI * 2)).toBeCloseTo((i + 1) / 6, 3));
    expect(chflWide(html).match(/class="chfl-ring-3"/g)).toHaveLength(3);
    expect(chflRows(html)).toBe(3);
    const many = chflRender("chart-sunburst", { tree: { children: Array.from({ length: 9 }, (_, i) => ({ label: String(i), value: 1 })) } });
    expect(chflWide(many).match(/class="chfl-ring-1"/g)).toHaveLength(6);
    expect(chflRows(many)).toBe(9);
  });

  test("waterfall totals reset rather than add, and negative changes connect at the running level", () => {
    const html = chflRender("chart-waterfall", { steps: [{ label: "start", value: 100, kind: "total" }, { label: "down", value: -30 }, { label: "up", value: 10 }, { label: "end", value: 80, kind: "total" }] });
    const bars = chflRects(html, "chfl-bar");
    expect(bars).toHaveLength(4);
    expect(bars[0].y + bars[0].height).toBeCloseTo(bars[3].y + bars[3].height, 1);
    expect(bars[1].y).toBeCloseTo(bars[0].y, 1);
    expect(bars[1].y + bars[1].height).toBeCloseTo(bars[2].y + bars[2].height, 1);
    expect(bars[3].height / bars[0].height).toBeCloseTo(0.8, 3);
    expect(chflWide(html).match(/chfl-connector/g)).toHaveLength(3);
    expect(html).toContain('fill="var(--viz-down)"');
    expect(html).toContain('fill="var(--viz-up)"');
  });

  test("gantt uses UTC inclusive days, rejects invalid dates and only marks in-range today", () => {
    const tasks = [{ label: "one", start: "2024-02-28", end: "2024-02-28", done: true }, { label: "three", start: "2024-02-28", end: "2024-03-01" }, { label: "invalid", start: "2023-02-29", end: "2023-03-01" }, { label: "backward", start: "2024-03-02", end: "2024-03-01" }];
    const html = chflRender("chart-gantt", { tasks, today: "2024-02-29" });
    const bars = chflRects(html, "chfl-task");
    expect(bars).toHaveLength(2);
    expect(bars[1].width / bars[0].width).toBeCloseTo(3, 2);
    expect(chflRows(html)).toBe(2);
    expect(chflWide(html)).toContain('class="chfl-today"');
    expect(chflWide(chflRender("chart-gantt", { tasks, today: "2024-03-02" }))).not.toContain('class="chfl-today"');
  });
});
