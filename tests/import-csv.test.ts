import { describe, expect, test } from "bun:test";
import { impCellValue, impInferProperty, impNotionKeyValueLines, impParseCsv, impParseDate } from "../import-csv.ts";
import { buildFixture } from "./fixtures/import-fixtures.ts";

const dec = new TextDecoder();

async function n1Projects() {
  const f = await buildFixture("N1");
  const path = [...f.files.keys()].find((p) => p.endsWith("_all.csv"))!;
  const rows = impParseCsv(dec.decode(f.files.get(path)!));
  return { f, header: rows[0], data: rows.slice(1) };
}

describe("impParseCsv", () => {
  test("BOM, quoted quotes, embedded CRLF, CRLF/LF/CR rows, trailing empty line", () => {
    expect(impParseCsv('\uFEFFa,b\r\n"x""y","1\r\n2"\r\n\n')).toEqual([
      ["a", "b"],
      ['x"y', "1\r\n2"],
    ]);
    expect(impParseCsv("a,b\rc,\r")).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
    expect(impParseCsv("a,b\n,\n")).toEqual([
      ["a", "b"],
      ["", ""],
    ]);
    expect(impParseCsv("")).toEqual([]);
    expect(impParseCsv('"only"')).toEqual([["only"]]);
  });

  test("N1 Projects _all.csv: 3 rows x 13 columns", async () => {
    const { header, data } = await n1Projects();
    expect(header).toEqual(["Name", "Status", "Priority", "Tags", "Owner", "Due", "Done", "Budget", "Progress", "Site", "Contact", "Related", "Created time"]);
    expect(data.length).toBe(3);
    expect(data.every((r) => r.length === 13)).toBe(true);
    expect(data[0][5]).toBe("October 23, 2026 3:00 PM → October 30, 2026 5:00 PM");
  });

  test("E7: 20,000 x 30 with quoted commas/newlines parses in < 2 s without misalignment", async () => {
    const e7 = await buildFixture("E7");
    const bytes = [...e7.files.entries()].find(([p]) => p.endsWith(".csv"))![1];
    const text = dec.decode(bytes);
    const t0 = performance.now();
    const rows = impParseCsv(text);
    const ms = performance.now() - t0;
    expect(rows.length).toBe(20_001);
    expect(rows.every((r) => r.length === 30)).toBe(true);
    expect(rows[1][1]).toBe("Kim, Jo 0");
    expect(rows[1][2]).toBe('line1 0\nline2 "q"');
    expect(rows[20_000][0]).toBe("Row 20000");
    expect(ms).toBeLessThan(2000);
  });

  test("E8: CP949 csv decoded with euc-kr gives Korean headers and cells", async () => {
    const e8 = await buildFixture("E8");
    const bytes = [...e8.files.entries()].find(([p]) => p.endsWith(".csv"))![1];
    const rows = impParseCsv(new TextDecoder("euc-kr").decode(bytes));
    expect(rows).toEqual([
      ["이름", "상태", "메모"],
      ["웹사이트 개선", "진행 중", "한글, 쉼표"],
      ["모바일 앱", "완료", "메모 없음"],
    ]);
    const status = impInferProperty(rows[0][1], rows.slice(1).map((r) => r[1]), 1);
    expect(status.type).toBe("status");
  });
});

describe("impInferProperty", () => {
  test("N1 Projects columns infer the documented types", async () => {
    const { header, data } = await n1Projects();
    const inferred = header.map((h, i) => impInferProperty(h, data.map((r) => r[i] ?? ""), i));
    // Owner is a person column in Notion; the CSV carries plain names joined by ", ", so the rule yields multi_select.
    expect(inferred.map((p) => p.type)).toEqual([
      "title", "status", "select", "multi_select", "multi_select", "date", "checkbox", "number", "number", "url", "email", "relation", "date",
    ]);
    expect(inferred[1].config.options).toEqual([
      { id: "o1", name: "In progress", color: "gray" },
      { id: "o2", name: "Not started", color: "brown" },
      { id: "o3", name: "Done", color: "orange" },
    ]);
    expect(inferred[3].config.options).toEqual([
      { id: "o1", name: "Design", color: "gray" },
      { id: "o2", name: "Frontend", color: "brown" },
      { id: "o3", name: "Mobile", color: "orange" },
    ]);
    expect(inferred[7].config.number_format).toBe("dollar");
    expect(inferred[8].config.number_format).toBe("percent");
    const targets = inferred[11].config.notionTargets as string[];
    expect(targets.length).toBe(3);
    expect(targets.every((t) => /^Home [0-9a-f]{32}\/Projects [0-9a-f]{32}\/.+ [0-9a-f]{32}\.md$/.test(t))).toBe(true);
    expect(targets.some((t) => t.includes("/Mobile app "))).toBe(true);
  });

  test("rule order and edge cases", () => {
    expect(impInferProperty("Anything", ["x"], 0).type).toBe("title");
    expect(impInferProperty("Empty", ["", "  "], 1).type).toBe("text");
    expect(impInferProperty("Done", ["Yes", "", "No"], 1).type).toBe("checkbox");
    expect(impInferProperty("Won", ["₩1,000", "₩2,500"], 1)).toEqual({ type: "number", config: { number_format: "won" } });
    expect(impInferProperty("Plain", ["1", "2.5", "-3"], 1)).toEqual({ type: "number", config: { number_format: "number" } });
    expect(impInferProperty("Commas", ["1,000", "2"], 1).config.number_format).toBe("number_with_commas");
    expect(impInferProperty("When", ["2026-10-23", "2026년 10월 23일", "October 23, 2026 (GMT+9)"], 1).type).toBe("date");
    expect(impInferProperty("Link", ["https://a.example", "http://b.example/x?y=1"], 1).type).toBe("url");
    expect(impInferProperty("Mail", ["a@example.com"], 1).type).toBe("email");
    expect(impInferProperty("Rel", ["Doc (https://www.notion.so/Doc-0123456789abcdef0123456789abcdef?pvs=21)"], 1)).toEqual({
      type: "relation",
      config: { notionTargets: ["https://www.notion.so/Doc-0123456789abcdef0123456789abcdef?pvs=21"] },
    });
    expect(impInferProperty("상태", ["진행 중", "완료", "진행 중"], 1).type).toBe("status");
    expect(impInferProperty("Kind", ["A", "B", "A"], 1).type).toBe("select");
    const many = Array.from({ length: 40 }, (_, i) => `v${i}`);
    expect(impInferProperty("Free", many, 1).type).toBe("text");
    const colors = impInferProperty("Many", [Array.from({ length: 12 }, (_, i) => `o${i}`).join(", ")], 1);
    expect(colors.type).toBe("multi_select");
    const opts = colors.config.options as { color: string }[];
    expect(opts.length).toBe(12);
    expect(opts[9].color).toBe("gray");
    expect(opts.some((o) => o.color === "default")).toBe(false);
  });
});

describe("impCellValue", () => {
  test("dates: English, Korean, ranges, same-day range, GMT suffix, ISO, slashes", () => {
    expect(impParseDate("2026년 10월 23일 오후 3:00")).toEqual({ start: "2026-10-23T15:00", end: null });
    expect(impParseDate("2026년 10월 23일 오전 12:00 (GMT+9)")).toEqual({ start: "2026-10-23T00:00", end: null });
    expect(impParseDate("October 23, 2026")).toEqual({ start: "2026-10-23", end: null });
    expect(impParseDate("October 23, 2026 12:30 PM")).toEqual({ start: "2026-10-23T12:30", end: null });
    expect(impCellValue({ type: "date" }, "October 23, 2026 3:00 PM → October 30, 2026 5:00 PM")).toEqual({ start: "2026-10-23T15:00", end: "2026-10-30T17:00" });
    expect(impCellValue({ type: "date" }, "October 23, 2026 3:00 PM → 5:00 PM (GMT+9)")).toEqual({ start: "2026-10-23T15:00", end: "2026-10-23T17:00" });
    expect(impCellValue({ type: "date" }, "2026-10-23T15:00")).toEqual({ start: "2026-10-23T15:00", end: null });
    expect(impCellValue({ type: "date" }, "2026/10/23")).toEqual({ start: "2026-10-23", end: null });
    expect(impCellValue({ type: "date" }, "not a date")).toBeNull();
    expect(impCellValue({ type: "date" }, "")).toBeNull();
  });

  test("numbers, checkbox, options, relation, text", () => {
    expect(impCellValue({ type: "number" }, "$12,500")).toBe(12500);
    expect(impCellValue({ type: "number" }, "15%")).toBe(15);
    expect(impCellValue({ type: "number" }, "$1,200.50")).toBe(1200.5);
    expect(impCellValue({ type: "number" }, "-₩3,000")).toBe(-3000);
    expect(impCellValue({ type: "number" }, "abc")).toBeNull();
    expect(impCellValue({ type: "checkbox" }, "Yes")).toBe(true);
    expect(impCellValue({ type: "checkbox" }, "No")).toBe(false);
    expect(impCellValue({ type: "select" }, " High ")).toBe("High");
    expect(impCellValue({ type: "status" }, "")).toBeNull();
    expect(impCellValue({ type: "multi_select" }, "Design, Frontend")).toEqual(["Design", "Frontend"]);
    expect(impCellValue({ type: "multi_select" }, "")).toEqual([]);
    expect(impCellValue({ type: "relation" }, "Mobile app (Home%20x/Mobile%20app%20abc.md), Brand (Home%20x/Brand%20def.md)")).toEqual([
      "Home x/Mobile app abc.md",
      "Home x/Brand def.md",
    ]);
    expect(impCellValue({ type: "relation" }, "")).toEqual([]);
    expect(impCellValue({ type: "relation" }, "just text")).toBeNull();
    expect(impCellValue({ type: "url" }, " https://example.com ")).toBe("https://example.com");
    expect(impCellValue({ type: "text" }, "  hi  ")).toBe("hi");
  });
});

describe("impNotionKeyValueLines", () => {
  test("N1 row page: property lines removed, body kept", async () => {
    const { f, header } = await n1Projects();
    const path = [...f.files.keys()].find((p) => /\/Website redesign [0-9a-f]{32}\.md$/.test(p))!;
    const { values, rest } = impNotionKeyValueLines(dec.decode(f.files.get(path)!), header);
    expect(values).toEqual({
      Status: "In progress",
      Priority: "High",
      Tags: "Design, Frontend",
      Owner: "Jane Doe",
      Due: "October 23, 2026 3:00 PM → October 30, 2026 5:00 PM",
      Done: "No",
      Budget: "$12,500",
      Progress: "15%",
      Site: "https://example.com",
      Contact: "jane@example.com",
      Related: "Mobile app (Mobile%20app%204c9638d4557f5eccec4a9bbc98cc3428.md)",
      "Created time": "October 1, 2026 9:12 AM",
    });
    expect(rest.startsWith("# Website redesign\n\n<aside>")).toBe(true);
    expect(rest).not.toContain("Budget: $12,500");
    expect(rest).toContain("## Goals");
  });

  test("longest header wins, keys with spaces, non-header line stops the block", () => {
    const body = "# T\n\nCreated time: October 1, 2026\nCreated: x\nStatus: Done\n\nBody.\nNote: not a property";
    const r = impNotionKeyValueLines(body, ["Created", "Created time", "Status"]);
    expect(r.values).toEqual({ "Created time": "October 1, 2026", Created: "x", Status: "Done" });
    expect(r.rest).toBe("# T\n\nBody.\nNote: not a property");
    const none = impNotionKeyValueLines("# T\n\nJust text: with colon\n", ["Status"]);
    expect(none.values).toEqual({});
    expect(none.rest).toBe("# T\n\nJust text: with colon\n");
  });
});

test("12-hour times outside 1-12 are not dates (verifier V1 case)", () => {
  expect(impParseDate("October 23, 2026 25:00 PM")).toBeNull();
  expect(impParseDate("October 23, 2026 0:30 AM")).toBeNull();
  expect(impParseDate("2026년 10월 23일 오후 13:00")).toBeNull();
  expect(impParseDate("October 23, 2026 12:00 AM")).toEqual({ start: "2026-10-23T00:00", end: null });
  expect(impParseDate("2026년 10월 23일 오전 12:00")).toEqual({ start: "2026-10-23T00:00", end: null });
});
