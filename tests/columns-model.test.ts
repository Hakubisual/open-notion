import { describe, expect, test } from "bun:test";
import "../assets/editor-model.js";
import "../assets/columns-model.js";

const C = (globalThis as any).ColumnsModel;
const M = (globalThis as any).EditorModel;
const p = (id: string, text: string, indent = 0) => ({ id, type: "paragraph", text, checked: false, indent, meta: null });
const legacy = (id: string, texts: unknown[], indent = 0) => ({ id, type: "columns", text: "", checked: false, indent, meta: { columns: texts } });
const shape = (blocks: any[]) => blocks.map((b) => b.type + ":" + b.indent + (b.text ? ":" + b.text : ""));
const allText = (blocks: any[]) => blocks.flatMap((b) => b.type === "columns" ? (b.meta?.columns ?? []).map((c: any) => c.text) : b.type === "column" ? [] : [b.text]).join("\n");

describe("columnsFromLegacy", () => {
  test("old two columns become columns, column, paragraphs per line, column", () => {
    const out = C.columnsFromLegacy([legacy("k", [{ text: "a\nb" }, { text: "" }])]);
    expect(shape(out)).toEqual(["columns:0", "column:1", "paragraph:2:a", "paragraph:2:b", "column:1"]);
    expect(out[0].id).toBe("k");
    expect(out[0].meta).toEqual({ widths: [0.5, 0.5] });
    expect(out[0].meta.columns).toBeUndefined();
  });

  test("is idempotent and deterministic", () => {
    const input = [p("x", "before"), legacy("k", [{ text: "a\nb" }, { text: "c" }, { text: "" }]), p("y", "after")];
    const once = C.columnsFromLegacy(input);
    expect(C.columnsFromLegacy(once)).toBe(once);
    expect(C.columnsFromLegacy(input)).toEqual(once);
  });

  test("a column without text, a string column and a null column give empty or plain columns without throwing", () => {
    const out = C.columnsFromLegacy([legacy("k", [{ text: "a" }, {}, null, "s"])]);
    expect(shape(out)).toEqual(["columns:0", "column:1", "paragraph:2:a", "column:1", "column:1", "column:1", "paragraph:2:s"]);
  });

  test("ids from a 60-character columns id stay within 60 characters and never collide", () => {
    const id = "x".repeat(60);
    const texts = Array.from({ length: 4 }, (_, c) => ({ text: Array.from({ length: 30 }, (_, l) => "c" + c + "l" + l).join("\n") }));
    const out = C.columnsFromLegacy([legacy(id, texts), legacy(id.slice(0, 59) + "y", texts)]);
    const ids = out.map((b: any) => b.id);
    expect(ids.every((v: string) => typeof v === "string" && v.length > 0 && v.length <= 60)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a new id that already exists on the page gets a suffix", () => {
    const first = C.columnsFromLegacy([legacy("k", [{ text: "a" }, { text: "" }])]);
    const clash = first[1].id;
    const out = C.columnsFromLegacy([p(clash, "taken"), legacy("k", [{ text: "a" }, { text: "" }])]);
    const ids = out.map((b: any) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(clash + "-2");
  });

  test("a 1,999-block page keeps every letter and stays within 2000 blocks", () => {
    const filler = Array.from({ length: 1998 }, (_, i) => p("f" + i, "f" + i));
    const text = Array.from({ length: 10 }, (_, i) => "line " + i).join("\n");
    const out = C.columnsFromLegacy([...filler, legacy("k", [{ text }, { text: "right" }])]);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(allText(out.slice(1998))).toBe(text + "\nright");
  });

  test("near the limit each column becomes one paragraph with its whole text", () => {
    const filler = Array.from({ length: 1995 }, (_, i) => p("f" + i, "f" + i));
    const text = Array.from({ length: 10 }, (_, i) => "line " + i).join("\n");
    const out = C.columnsFromLegacy([...filler, legacy("k", [{ text }, { text: "right" }])]);
    expect(out.length).toBe(2000);
    expect(shape(out.slice(1995))).toEqual(["columns:0", "column:1", "paragraph:2:" + text, "column:1", "paragraph:2:right"]);
  });

  test("a full page that cannot grow keeps the old block untouched", () => {
    const filler = Array.from({ length: 1999 }, (_, i) => p("f" + i, "f" + i));
    const old = legacy("k", [{ text: "a\nb" }, { text: "c" }]);
    const out = C.columnsFromLegacy([...filler, old]);
    expect(out.length).toBe(2000);
    expect(out[1999]).toBe(old);
  });

  test("blocks under an old columns block move into its last column", () => {
    const out = C.columnsFromLegacy([legacy("k", [{ text: "a" }, { text: "b" }]), p("child", "kept", 1), p("next", "out")]);
    expect(shape(out)).toEqual(["columns:0", "column:1", "paragraph:2:a", "column:1", "paragraph:2:b", "paragraph:2:kept", "paragraph:0:out"]);
  });
});

describe("clampColumnsDepth", () => {
  const nested = (d: number) => [
    { id: "cs", type: "columns", text: "", indent: d, meta: { widths: [0.5, 0.5] } },
    { id: "c1", type: "column", text: "", indent: d + 1 },
    { id: "a", type: "paragraph", text: "a", indent: d + 2 },
    { id: "c2", type: "column", text: "", indent: d + 1 },
    { id: "b", type: "paragraph", text: "b", indent: d + 2 },
  ];

  test("columns at indent 5 move to 2 with children at 3 and 4", () => {
    const input = [p("top", "top"), p("l1", "l1", 1), p("l2", "l2", 2), p("l3", "l3", 3), p("l4", "l4", 4), ...nested(5)];
    const out = C.clampColumnsDepth(input);
    expect(out.slice(5).map((b: any) => b.indent)).toEqual([2, 3, 4, 3, 4]);
    const columns = M.children(out)[0].children[0].children.find((n: any) => n.block.id === "cs");
    expect(columns.children.map((n: any) => [n.block.id, n.children.map((c: any) => c.block.id)])).toEqual([["c1", ["a"]], ["c2", ["b"]]]);
  });

  test("a valid page comes back as the same array", () => {
    const input = nested(0);
    expect(C.clampColumnsDepth(input)).toBe(input);
  });

  test("an orphan column is dropped and its blocks move up, none lost", () => {
    const input = [p("x", "x"), { id: "lone", type: "column", text: "", indent: 1 }, p("a", "a", 2), p("b", "b", 3), p("y", "y")];
    const out = C.clampColumnsDepth(input);
    expect(out.map((b: any) => b.id + ":" + b.indent)).toEqual(["x:0", "a:1", "b:2", "y:0"]);
  });

  test("columnGroups lists each column's block range", () => {
    const blocks = [p("x", "x"), ...nested(0), p("y", "y")];
    expect(C.columnGroups(blocks, 1)).toEqual([{ index: 2, start: 3, end: 4 }, { index: 4, start: 5, end: 6 }]);
  });
});

describe("move into a column", () => {
  test("a block moved under a column takes the column child depth", () => {
    const blocks: any[] = [
      p("out", "out"),
      { id: "cs", type: "columns", text: "", indent: 0, meta: { widths: [0.5, 0.5] } },
      { id: "c1", type: "column", text: "", indent: 1 },
      p("a", "a", 2),
      { id: "c2", type: "column", text: "", indent: 1 },
    ];
    expect(M.move(blocks, 0, 5, 2)).toBe(true);
    expect(blocks.map((b) => b.id + ":" + b.indent)).toEqual(["cs:0", "c1:1", "a:2", "c2:1", "out:2"]);
    expect(C.columnGroups(blocks, 0)[1]).toEqual({ index: 3, start: 4, end: 5 });
  });
});


describe("editor rules for columns", () => {
  const cols = () => [
    { id: "cs", type: "columns", text: "", indent: 0, meta: { widths: [0.5, 0.5] } },
    { id: "c1", type: "column", text: "", indent: 1 }, p("a", "a", 2), p("b", "b", 2),
    { id: "c2", type: "column", text: "", indent: 1 },
  ];
  test("canIndent keeps column rows and column children in place and stops at depth 6", () => {
    const blocks: any[] = cols();
    expect(C.canIndent(blocks, 1, 1)).toBe(false);
    expect(C.canIndent(blocks, 3, -1)).toBe(false);
    expect(C.canIndent(blocks, 3, 1)).toBe(true);
    const deep: any[] = [{ id: "x", type: "paragraph", text: "", indent: 5 }, { id: "y", type: "paragraph", text: "", indent: 6 }];
    expect(C.canIndent(deep, 1, 1)).toBe(false);
  });
  test("fillColumns gives an empty column one paragraph and leaves full columns as they are", () => {
    const blocks: any[] = cols();
    const out = C.fillColumns(blocks, () => ({ id: "new", type: "paragraph", text: "", indent: 0 }));
    expect(out.map((b: any) => b.id + ":" + b.indent)).toEqual(["cs:0", "c1:1", "a:2", "b:2", "c2:1", "new:2"]);
    expect(C.fillColumns(out, () => { throw new Error("no"); })).toBe(out);
  });
  test("newColumns makes columns + 2 columns + a paragraph each at the nearest allowed depth", () => {
    let n = 0;
    const out = C.newColumns(5, 2, (type = "paragraph") => ({ id: "n" + n++, type, text: "", indent: 0, meta: null }));
    expect(out.map((b: any) => b.type + ":" + b.indent)).toEqual(["columns:2", "column:3", "paragraph:4", "column:3", "paragraph:4"]);
    expect(out[0].meta).toEqual({ widths: [0.5, 0.5] });
  });
  test("a block directly under columns moves into the column before it, a first one gets a column", () => {
    const out = C.clampColumnsDepth([{ id: "cs", type: "columns", text: "", indent: 0 }, p("stray", "s", 1), { id: "c1", type: "column", text: "", indent: 1 }, p("a", "a", 2), p("late", "l", 1)]);
    expect(out.map((b: any) => b.type + ":" + b.indent + (b.text ? ":" + b.text : ""))).toEqual(["columns:0", "column:1", "paragraph:2:s", "column:1", "paragraph:2:a", "paragraph:2:l"]);
  });
});
