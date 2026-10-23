import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const chshIds = ["chart-pie", "chart-radar", "chart-gauge", "chart-funnel"];
const chshRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const chshWide = (html: string) => html.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)![1];
const chshRows = (html: string) => [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0][1].match(/<tr>/g)?.length || 0;

describe("shape charts", () => {
  test("registered Korean samples and every preset render accessible figures", () => {
    for (const id of chshIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("chart");
      expect(c.schema.required.length).toBeGreaterThan(0);
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      expect(c.css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|border-radius:\s*\d+px/i);
      for (const preset of ["report", "friendly", "paper", "showcase"]) {
        const html = chshRender(id, { ...c.sample, preset });
        expect(html).not.toContain("ui-fallback");
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).toContain('role="img"');
        expect(html).toMatch(/<title id="[^"]+">/);
        expect(html).toMatch(/<desc id="[^"]+">/);
        expect(html).toContain('class="vk-sr"');
      }
      const expected = id === "chart-pie" ? c.sample.items.length : id === "chart-radar" ? c.sample.labels.length : id === "chart-funnel" ? c.sample.stages.length : 1;
      expect(chshRows(chshRender(id, c.sample))).toBe(expected);
    }
  });

  test("empty, malformed, and unusable data remain calm without nonfinite coordinates", () => {
    for (const id of chshIds) for (const data of [{}, "{broken", { items: [null, {}, { value: -5 }], stages: [null], labels: {}, series: [null], value: "no" }]) {
      const html = chshRender(id, data);
      expect(html).toContain('class="vk-empty"');
      expect(html).not.toMatch(/ui-fallback|NaN|Infinity/);
    }
    expect(chshRender("chart-gauge", { value: 4, min: 10, max: 5 })).toContain('class="vk-empty"');
    expect(chshRender("chart-funnel", { stages: [{ value: 1 }, { value: 2 }] })).toContain('class="vk-empty"');
  });

  test("all user strings are escaped and repeated renders have unique ids", () => {
    const evil = '\"><img onerror=alert(1)><script>alert(1)</script>';
    const replace = (v: any): any => typeof v === "string" ? evil : Array.isArray(v) ? v.map(replace) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)])) : v;
    for (const id of chshIds) {
      const html = chshRender(id, { ...replace(getComponent(id)!.sample), title: evil, subtitle: evil, caption: evil, source: evil, unit: evil });
      expect(html).not.toMatch(/<img|<script|ui-fallback/);
      const two = chshRender(id, getComponent(id)!.sample) + chshRender(id, getComponent(id)!.sample);
      const ids = [...two.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("pie closes a full turn, groups extras, and preserves every original data row", () => {
    const html = chshRender("chart-pie", { items: Array.from({ length: 8 }, (_, i) => ({ label: "채널 " + i, value: i + 1 })) });
    const paths = [...chshWide(html).matchAll(/class="chsh-slice" d="M([\d. -]+) A124 124 0 ([01]) 1 ([\d. -]+) L320 160 Z"/g)];
    expect(paths.length).toBe(6);
    let sum = 0;
    for (const p of paths) {
      const [sx, sy] = p[1].split(" ").map(Number), [ex, ey] = p[3].split(" ").map(Number);
      let angle = Math.atan2(ey - 160, ex - 320) - Math.atan2(sy - 160, sx - 320);
      if (angle <= 0) angle += Math.PI * 2;
      sum += angle;
    }
    expect(sum).toBeCloseTo(Math.PI * 2, 4);
    expect(chshRows(html)).toBe(8);
    expect(html).toContain("기타: 21");
    expect(chshWide(html)).toContain("<polyline");
  });

  test("radar scales all polygons against the same maximum and caps at three", () => {
    const html = chshWide(chshRender("chart-radar", { labels: ["가", "나", "다", "라"], max: 100, series: Array.from({ length: 4 }, (_, i) => ({ name: "팀 " + i, data: [50, 100, 0, 25] })) }));
    const polygons = [...html.matchAll(/class="chsh-radar-series" points="([^"]+)"/g)];
    expect(polygons.length).toBe(3);
    expect(polygons[0][1]).toBe("320,101 438,160 320,160 290.5,160");
    expect(html.match(/<polygon class="vk-grid"/g)?.length).toBe(4);
    expect(chshRender("chart-radar", { labels: ["가", "나", "다"], series: [{ data: [1, null, 3] }] })).toContain('class="vk-empty"');
  });

  test("gauge half-range ends at the apex, target uses the same scale, and colors follow thresholds", () => {
    const half = chshWide(chshRender("chart-gauge", { value: 50, target: 50 }));
    expect(half).toContain('class="chsh-gauge-value" d="M28 188 A152 152 0 0 1 180 36');
    expect(half).toContain('class="chsh-gauge-target" x1="180" y1="72" x2="180" y2="30"');
    expect(chshRender("chart-gauge", { value: 10 })).toContain('fill="var(--viz-down)"');
    expect(chshRender("chart-gauge", { value: 90 })).toContain('fill="var(--viz-up)"');
    expect(chshRender("chart-gauge", { value: 50, thresholds: [60, 80] })).toContain('fill="var(--viz-down)"');
    expect(chshRender("chart-gauge", { value: 0 })).not.toContain('class="chsh-gauge-value"');
  });

  test("funnel conversion is previous-stage based and zero denominators are undefined", () => {
    const html = chshRender("chart-funnel", { stages: [{ label: "가", value: 200 }, { label: "나", value: 100 }, { label: "다", value: 25 }, { label: "라", value: 0 }, { label: "마", value: 0 }] });
    expect(html).toContain('<th scope="row">나</th><td>100</td><td>50%</td>');
    expect(html).toContain('<th scope="row">다</th><td>25</td><td>25%</td>');
    expect(html).toContain('<th scope="row">마</th><td>0</td><td>—</td>');
    const polygons = [...chshWide(html).matchAll(/class="chsh-funnel-stage" points="([^"]+)"/g)].map((m) => m[1].split(/[ ,]/).map(Number));
    expect(polygons.length).toBe(5);
    for (const p of polygons) expect(p[2] - p[0]).toBeGreaterThanOrEqual(p[4] - p[6]);
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
