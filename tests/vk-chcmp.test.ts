import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const chcmpIds = ["chart-stacked", "chart-hbar", "chart-area"];
const chcmpRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const chcmpWide = (html: string) => html.match(/<svg\b[^>]*vk-wide[^>]*>([\s\S]*?)<\/svg>/)![1];
const chcmpMarks = (svg: string, cls: string) => [...svg.matchAll(new RegExp('<rect class="' + cls + '"[^>]*>', 'g'))].map(([tag]) => Object.fromEntries([...tag.matchAll(/\s(x|y|width|height)="([\d.-]+)"/g)].map((m) => [m[1], Number(m[2])])));
const chcmpAreas = (svg: string) => [...svg.matchAll(/<path class="chcmp-area" d="([^"]+)"/g)].map((m) => [...m[1].matchAll(/([\d.-]+),([\d.-]+)/g)].map((p) => [Number(p[1]), Number(p[2]) ]));

describe("comparison charts", () => {
  test("metadata, samples, presets and accessible responsive figures", () => {
    for (const id of chcmpIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("chart");
      expect(c.schema.required).toContain("labels");
      expect(c.defaults.labels).toEqual([]);
      expect(JSON.stringify(c.sample)).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[가-힣]/);
      expect(c.slash.aliases).toMatch(/[a-z]{3}/);
      expect(c.css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|border-radius:\s*\d+px/i);
      for (const preset of ["report", "friendly", "paper", "showcase"]) {
        const html = chcmpRender(id, { ...c.sample, preset });
        expect(html).toContain('data-ui="' + id + '"');
        expect(html).not.toContain("ui-fallback");
        expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="[^"]+"/);
        expect(html).toMatch(/<title id="[^"]+">.+?<\/title><desc id="[^"]+">.+?<\/desc>/);
        expect(html).toContain('viewBox="0 0 640 320"');
        expect(html).toContain('viewBox="0 0 360 300"');
        expect(html).toContain('class="vk-sr"');
        expect((html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1].match(/<tr>/g) || []).length).toBe(c.sample.labels.length);
      }
      expect(chcmpRender(id, {})).toContain('class="vk-empty"');
      expect(chcmpRender(id, "{broken")).toContain('data-ui-invalid="1"');
    }
  });

  test("all user strings remain escaped", () => {
    const evil = '<script>x</script>\"><img onerror=x>';
    for (const id of chcmpIds) {
      const html = chcmpRender(id, { title: evil, subtitle: evil, caption: evil, source: evil, unit: evil, xTitle: evil, yTitle: evil, labels: [evil, evil], series: [{ name: evil, data: [3, 5] }], palette: evil, sort: evil });
      expect(html).not.toMatch(/<script|<img/);
      expect(html).not.toContain("ui-fallback");
      expect(html).toContain("&lt;");
    }
  });

  test("stacked segments sum from zero, preserve signs, and report net totals", () => {
    const html = chcmpRender("chart-stacked", { labels: ["A"], series: [{ name: "P1", data: [20] }, { name: "P2", data: [30] }, { name: "N1", data: [-10] }, { name: "N2", data: [-15] }] });
    const svg = chcmpWide(html), bars = chcmpMarks(svg, "chcmp-segment");
    const zero = Number(svg.match(/<line class="vk-base"[^>]*y1="([\d.-]+)"/)![1]);
    expect(bars).toHaveLength(4);
    expect(bars[0].y + bars[0].height).toBeCloseTo(zero, 0);
    expect(bars[1].y + bars[1].height).toBeCloseTo(bars[0].y, 0);
    expect(bars[2].y).toBeCloseTo(zero, 0);
    expect(bars[3].y).toBeCloseTo(bars[2].y + bars[2].height, 0);
    expect(bars[1].height / bars[0].height).toBeCloseTo(1.5, 2);
    expect(svg).toMatch(/class="vk-val chcmp-total">25<\/text>/);
    expect(chcmpWide(chcmpRender("chart-stacked", { labels: ["A", "B"], values: [0, null] })).match(/chcmp-total/g)).toHaveLength(1);
  });

  test("horizontal bars sort stably, preserve order on request, and have proportional lengths", () => {
    const data = { labels: ["small", "large", "equal", "missing"], values: [10, 30, 30, null] };
    const svg = chcmpWide(chcmpRender("chart-hbar", data)), bars = chcmpMarks(svg, "chcmp-hbar");
    expect(svg.indexOf("<title>large</title>")).toBeLessThan(svg.indexOf("<title>equal</title>"));
    expect(svg.indexOf("<title>equal</title>")).toBeLessThan(svg.indexOf("<title>small</title>"));
    expect(bars[0].width / bars[2].width).toBeCloseTo(3, 2);
    expect(bars.every((b) => b.x === bars[0].x)).toBe(true);
    const ordered = chcmpWide(chcmpRender("chart-hbar", { ...data, sort: "none" }));
    expect(ordered.indexOf("<title>small</title>")).toBeLessThan(ordered.indexOf("<title>large</title>"));
    const long = "이름이아주긴프로젝트개발팀";
    expect(chcmpWide(chcmpRender("chart-hbar", { items: [{ label: long, value: -12 }] }))).toContain("<title>" + long + "</title>");
    const signed = chcmpWide(chcmpRender("chart-hbar", { labels: ["minus", "plus"], values: [-10, 20], sort: "none" }));
    const signedBars = chcmpMarks(signed, "chcmp-hbar");
    expect(signedBars[0].x + signedBars[0].width).toBeCloseTo(signedBars[1].x, 0);
  });

  test("stacked area boundaries meet and conserve each series thickness", () => {
    const data = { labels: ["A", "B"], series: [{ name: "one", data: [10, 20] }, { name: "two", data: [30, 40] }] };
    const areas = chcmpAreas(chcmpWide(chcmpRender("chart-area", data)));
    expect(areas).toHaveLength(2);
    expect(areas[1][2]).toEqual(areas[0][1]);
    expect(areas[1][3]).toEqual(areas[0][0]);
    const firstThickness = areas[0][3][1] - areas[0][0][1];
    const secondThickness = areas[1][3][1] - areas[1][0][1];
    expect(secondThickness / firstThickness).toBeCloseTo(3, 2);
    const overlap = chcmpAreas(chcmpWide(chcmpRender("chart-area", { ...data, stacked: false })));
    expect(overlap[1].slice(2)).toEqual(overlap[0].slice(2));
    expect(chcmpRender("chart-area", { ...data, preset: "paper" })).toContain('stroke-dasharray="6 4"');
  });

  test("area gaps never imply zero or connect across missing observations", () => {
    const html = chcmpRender("chart-area", { labels: ["A", "B", "C", "D", "E"], series: [{ name: "one", data: [1, 2, null, 4, 5] }, { name: "two", data: [2, 3, 4, 5, 6] }] });
    const svg = chcmpWide(html);
    expect(chcmpAreas(svg)).toHaveLength(4);
    expect((svg.match(/<circle /g) || []).length).toBe(8);
    expect(html).not.toMatch(/NaN|Infinity/);
    const singleton = chcmpWide(chcmpRender("chart-area", { labels: ["A"], values: [0] }));
    expect(singleton).toContain("<circle ");
    expect(chcmpAreas(singleton)).toHaveLength(0);
  });
});
