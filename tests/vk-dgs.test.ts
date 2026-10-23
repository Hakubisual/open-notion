import { describe, expect, test } from "bun:test";
import "../components/index.js";
import { getComponent, renderComponentBlock } from "../component-registry.js";

const dgsIds = ["diagram-org", "diagram-erd", "diagram-venn", "diagram-matrix"];
const dgsRender = (ui: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui } });
const dgsCount = (html: string, cls: string) => (html.match(new RegExp('class="' + cls + '"', "g")) || []).length;

describe("structural diagrams", () => {
  test("samples and all presets render with accessible figures and unique ids", () => {
    for (const id of dgsIds) {
      const c = getComponent(id)!;
      expect(c.family).toBe("diagram");
      expect(c.schema.required.length).toBeGreaterThan(0);
      const html = dgsRender(id, c.sample) + dgsRender(id, c.sample);
      expect(html).not.toContain("ui-fallback");
      expect(html).toContain('role="img"');
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const preset of ["report", "friendly", "paper", "showcase"]) expect(dgsRender(id, { ...c.sample, preset })).toContain('data-preset="' + preset + '"');
      for (const input of [{}, "{ broken", { tree: [], tables: [null, 7], sets: [null], items: [null] }]) expect(dgsRender(id, input)).not.toContain("ui-fallback");
    }
  });

  test("organization hierarchy preserves depth and bounds hostile nesting", () => {
    const tree: any = { name: "root", children: [{ name: "left", children: [{ name: "leaf" }] }, { name: "right" }] };
    const html = dgsRender("diagram-org", { tree });
    expect(dgsCount(html, "dgs-person")).toBe(4);
    expect(html).toContain('data-depth="2"');
    expect(html).toContain('<th scope="row">leaf</th><td></td><td>left</td><td>2</td>');
    let deep: any = { name: "end" };
    for (let i = 0; i < 30; i++) deep = { name: "n" + i, children: [deep] };
    expect(dgsCount(dgsRender("diagram-org", { tree: deep }), "dgs-person")).toBe(13);
    expect(dgsCount(dgsRender("diagram-org", { tree: { name: "root", children: Array.from({ length: 24 }, (_, i) => ({ name: i, children: Array.from({ length: 24 }, (_, j) => ({ name: j })) })) } }), "dgs-person")).toBe(80);
  });

  test("ERD endpoints align with fields and carry exact cardinality", () => {
    const tables = [{ name: "a", fields: [{ name: "id", key: "pk" }] }, { name: "b", fields: [{ name: "id" }, { name: "a_id", key: "fk" }] }];
    for (const kind of ["1-1", "1-n", "n-n"]) {
      const html = dgsRender("diagram-erd", { tables, relations: [{ from: "a.id", to: "b.a_id", kind }, { from: "missing.id", to: "b.id" }] });
      expect(dgsCount(html, "dgs-relation")).toBe(2); // desktop and phone
      expect(html).toContain('data-kind="' + kind + '" d="M256 62.5 H276 V87.5 H344"');
      expect(html).not.toMatch(/NaN|Infinity/);
      expect(html).toContain('data-field="b.a_id"');
    }
    const duplicate = dgsRender("diagram-erd", { tables: [...tables, tables[0]] });
    expect(dgsCount(duplicate, "dgs-entity")).toBe(4);
    expect(dgsRender("diagram-erd", { tables: [{ name: "empty", fields: [] }] })).not.toContain("ui-fallback");
  });

  test("ERD same-column routes stay in the gutter and rows clear tall tables", () => {
    const tables = Array.from({ length: 5 }, (_, i) => ({ name: "t" + i, fields: Array.from({ length: i === 0 ? 8 : 1 }, (_, j) => ({ name: "f" + j })) }));
    const html = dgsRender("diagram-erd", { tables, relations: [{ from: "t0.f7", to: "t4.f0", kind: "1-n" }] });
    expect(html).toContain('d="M256 237.5 H276 V419.5 H256"');
    expect(html).toContain('data-table="t2"');
  });

  test("Venn circles intersect and valid regions are deduplicated", () => {
    for (const count of [2, 3]) {
      const html = dgsRender("diagram-venn", { sets: Array.from({ length: count }, (_, i) => ({ label: "set" + i })), overlaps: [{ sets: [1, 0], label: "shared" }, { sets: [0, 1], label: "duplicate" }, { sets: [5, 9], label: "invalid" }] });
      const circles = [...html.matchAll(/class="dgs-set" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
      expect(circles.length).toBe(count);
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) expect(Math.hypot(circles[i][0] - circles[j][0], circles[i][1] - circles[j][1])).toBeLessThan(circles[i][2] + circles[j][2]);
      expect(dgsCount(html, "dgs-overlap")).toBe(1);
    }
    expect(dgsCount(dgsRender("diagram-venn", { sets: ["only"] }), "dgs-set")).toBe(0);
  });

  test("matrix clamps coordinates, assigns boundaries, and honors quadrant overrides", () => {
    const html = dgsRender("diagram-matrix", { items: [{ label: "clamped", x: -9, y: 9 }, { label: "boundary", x: .5, y: .5 }, { label: "override", x: .1, y: .9, quadrant: 3 }, { label: "defaults", quadrant: 2 }] });
    const cells = [...html.matchAll(/<section class="dgs-quadrant"[\s\S]*?<\/section>/g)].map(m => m[0]);
    expect(cells[0]).toContain('data-x="0" data-y="1"');
    expect(cells[1]).toContain('data-x="0.5" data-y="0.5"');
    expect(cells[2]).toContain('data-x="0.25" data-y="0.25"');
    expect(cells[3]).toContain('data-x="0.1" data-y="0.9"');
    expect(dgsCount(html, "dgs-quadrant")).toBe(4);
  });

  test("nested strings never become markup or style values", () => {
    const evil = '\"><img src=x onerror=alert(1)><script>x</script>';
    const poison = (v: any): any => typeof v === "string" ? evil : Array.isArray(v) ? v.map(poison) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, poison(x)])) : v;
    for (const id of dgsIds) {
      const html = dgsRender(id, poison(getComponent(id)!.sample));
      expect(html).not.toMatch(/<img|<script/);
      expect(html).not.toContain("ui-fallback");
      expect(getComponent(id)!.css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|border-radius:\s*\d+px/i);
    }
  });
});
