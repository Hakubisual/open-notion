import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Exercise the actual concatenated core without adding a test component to the shared registry.
let dgc: any, dgcCss = "";
new Function("registerComponent", "registerHelpers", "registerFamilyCss", readFileSync(new URL("../components/_diagram-core.js", import.meta.url), "utf8").replace(/^import .*;$/m, ""))(
  () => { throw new Error("A family core must not register components"); },
  (name: string, helpers: any) => { expect(name).toBe("diagram"); dgc = helpers; },
  (name: string, css: string) => { expect(name).toBe("diagram"); dgcCss = css; },
);
const dgcH = {
  str: (v: unknown, fallback: string, max: number) => typeof v === "string" && v.trim() ? v.slice(0, max) : fallback,
  rich: (v: unknown) => dgc.esc(v),
  oneOf: (v: unknown, values: unknown[], fallback: string) => values.includes(v) ? v : fallback,
};
const dgcPart = () => ({ w: 300, h: 100, label: "순서도", desc: "시작에서 완료로 이어집니다.", body: (id: string) => dgc.marker(id + "-a") + dgc.arrow(100, 50, 200, 50, { marker: id + "-a" }), table: dgc.table("단계", ["순서", "내용"], [[1, "시작"], [2, "완료"]]) });

describe("diagram core", () => {
  test("Korean width is stable for composed and decomposed text", () => {
    expect(dgc.textW("한글", 14)).toBe(28);
    expect(dgc.textW("한글".normalize("NFD"), 14)).toBe(28);
    expect(dgc.textW("ABC", 14)).toBeCloseTo(24.36);
    expect(dgc.textW("é", 14)).toBe(dgc.textW("e\u0301", 14));
    expect(dgc.textW(null)).toBe(0);
  });

  test("wrapped labels respect width, explicit breaks, and line limits", () => {
    expect(dgc.wrap("자료 수집 검토", 60, 14, 3)).toEqual(["자료", "수집", "검토"]);
    expect(dgc.wrap("가나다라마바사", 42, 14, 2)).toEqual(["가나다", "라마…"]);
    expect(dgc.wrap("첫째\n둘째", 100, 14, 2)).toEqual(["첫째", "둘째"]);
    for (const width of [1, 12, 28, 56, 120]) {
      const lines = dgc.wrap("기획부터 사용자 경험 검토까지 LongerIdentifier", width, 14, 3);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const line of lines) expect(dgc.textW(line, 14)).toBeLessThanOrEqual(width + 0.001);
    }
    for (const args of [["", 30], ["가나다", 0], ["가나다", -1], ["가나다", 30, 14, 0]]) expect(dgc.wrap(...args)).toEqual([]);
    expect(dgc.clip("가나다", 0)).toBe("");
    expect(dgc.clip("가나다", 1)).toBe("…");
  });

  test("node label geometry fits the box and preserves the complete title", () => {
    const html = dgc.node(10, 20, 100, 64, "아주 긴 한국어 단계 이름", { subtitle: "담당자", size: 14 });
    expect(html).toContain('<title>아주 긴 한국어 단계 이름 · 담당자</title>');
    expect(html).toContain('x="10" y="20" width="100" height="64"');
    const labels = [...html.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(.*?)<\/text>/g)];
    expect(labels.length).toBe(2);
    for (const [, x, y, text] of labels) {
      expect(Number(x)).toBe(60);
      expect(Number(y)).toBeGreaterThan(30);
      expect(Number(y)).toBeLessThan(74);
      expect(dgc.textW(text, 14)).toBeLessThanOrEqual(80);
    }
    expect(dgc.node(0, 0, 100, 40, "시작", { subtitle: "숨김" })).toContain('>시작</text>');
    expect(dgc.node(0, 0, 8, 8, "작은 상자")).not.toContain('<text');
    expect(dgc.text(0, 0, "작은 글자", 8)).toContain('font-size="11"');
  });

  test("arrows use unique marker IDs and correct endpoints", () => {
    const a = dgc.arrow(10, 20, 90, 50), b = dgc.arrow(10, 20, 90, 50);
    const id = a.match(/<marker id="([^"]+)"/)![1];
    expect(a).toContain('d="M10 20 L90 50"');
    expect(a).toContain('marker-end="url(#' + id + ')"');
    expect(b).not.toContain('id="' + id + '"');
    expect(dgc.arrow(10, 20, 10, 20)).toBe("");
    expect(dgc.arrow(0, 0, 10, 10, { marker: "shared", dashed: true })).not.toContain('<defs>');
  });

  test("figure IDs stay unique across repeated and responsive renders", () => {
    const data = { title: "업무 순서도", subtitle: "업무 단계", figure: true, caption: "진행 순서", source: "팀" };
    const part = { ...dgcPart(), narrow: dgcPart() };
    const html = dgc.figure("flow", data, dgcH, part) + dgc.figure("flow", data, dgcH, part);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, refs] of html.matchAll(/aria-labelledby="([^"]+)"/g)) for (const ref of refs.split(" ")) expect(ids).toContain(ref);
    for (const [, ref] of html.matchAll(/marker-end="url\(#([^)]+)\)"/g)) expect(ids).toContain(ref);
    expect((html.match(/role="img"/g) || []).length).toBe(4);
    expect((html.match(/<desc /g) || []).length).toBe(4);
    expect(html).toContain('vk-numbered');
    expect(html).toContain('<figcaption');
    expect((html.match(/<tbody><tr>/g) || []).length).toBe(2);
  });

  test("empty state and escaped accessible alternatives are safe", () => {
    const evil = '"><img src=x onerror=alert(1)><script>';
    const html = dgc.figure("flow", { title: evil, subtitle: evil, caption: evil, source: evil }, dgcH, { ...dgcPart(), desc: evil, body: dgc.node(0, 0, 160, 70, evil), table: dgc.table(evil, [evil], [[evil]]) });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
    expect(dgc.list(evil, [evil])).not.toContain('<img');
    expect(dgc.figure("flow", {}, dgcH, {})).toContain('vk-empty');
    expect(dgc.figure("flow", {}, dgcH, { ...dgcPart(), table: undefined })).toContain('<ul class="vk-sr dgc-sr"');
    expect(dgc.num(null)).toBeNull();
    expect(dgc.num(Infinity)).toBeNull();
    expect(dgc.num("1,200")).toBe(1200);
    expect(dgc.color("mono", -1)).toBe("var(--viz-ink-4)");
    expect(dgc.color("bad", NaN)).toBe("var(--viz-1)");
    expect(Object.keys(dgc.PRESETS).sort()).toEqual(["friendly", "paper", "report", "showcase"]);
  });

  test("family CSS supplies tokens, responsive layouts, and printable data", () => {
    expect(dgcCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|border-radius:\s*[\d.]+px|font-size:\s*[\d.]+px/);
    expect(dgcCss).toContain('container-type:inline-size');
    expect(dgcCss).toContain('@container (max-width:519px)');
    expect(dgcCss).toContain('rx:var(--radius-sm)');
    expect(dgcCss).toContain('@media print');
    expect(dgcCss).toContain('position:static;width:auto;height:auto');
    for (const rule of dgcCss.replace(/@[a-z-]+[^{]*\{/g, "").split("}")) {
      const selector = rule.split("{")[0].trim();
      if (selector) for (const part of selector.split(",")) expect(part.trim()).toMatch(/(\.ui|\.vk|\[data-preset|\.rp |\.col)/);
    }
  });
});
