import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
new Function(readFileSync(join(ROOT, "assets/features/lazy/command-search.js"), "utf8"))();
const S = (globalThis as any).AcardCommandSearch;

// The editor's own block list (assets/editor.js BLOCK_TYPES) plus registry-style component items, as the palette builds it.
const editorSrc = readFileSync(join(ROOT, "assets/editor.js"), "utf8");
const BLOCKS = [...editorSrc.matchAll(/\{ type: "([a-z_0-9]+)", label: "([^"]+)", hint: "([^"]*)"/g)].map((m) => ({ type: m[1], label: m[2], hint: m[3] }));
const COMPONENTS = [
  { type: "component:chart-bar", label: "막대 차트", hint: "항목별 값 비교", aliases: "bar 막대그래프" },
  { type: "component:chart-line", label: "선 차트", hint: "시간에 따른 변화", aliases: "line 꺾은선" },
  { type: "component:kpi", label: "KPI 카드", hint: "핵심 숫자", aliases: "kpi metric 지표" },
  { type: "component:timeline-steps", label: "단계 타임라인", hint: "일정과 단계", aliases: "timeline 로드맵" },
];
const ITEMS = [...BLOCKS, ...COMPONENTS];
const top = (q: string, n = 3) => S.search(ITEMS, q, n).map((x: any) => x.type);

beforeEach(() => store.clear());

test("the block list is read from the editor (sanity)", () => {
  expect(BLOCKS.length).toBeGreaterThan(15);
  expect(BLOCKS.map((b) => b.type)).toContain("chart");
});

test("Korean words, synonyms and English find the same feature", () => {
  expect(top("차트")[0]).toBe("chart");
  expect(top("그래프")).toContain("chart");
  expect(top("chart")).toContain("chart");
  expect(top("도표")).toContain("table");
  expect(top("타임라인")).toContain("component:timeline-steps");
  expect(top("kpi")[0]).toBe("component:kpi");
  expect(top("흐름")).toContain("diagram");
});

test("initial consonants and a half-typed syllable match", () => {
  expect(top("ㅊㅌ")[0]).toBe("chart");
  expect(top("ㅈㅁ")).toContain("heading1");
  expect(top("차")).toContain("chart");
  expect(top("찿")).toEqual([]);
});

test("one or two typos still find it; nonsense finds nothing", () => {
  expect(top("chrat")).toContain("chart");
  expect(top("diagarm")).toContain("diagram");
  expect(top("qqqqzz")).toEqual([]);
});

test("recent use lifts an item among close matches", () => {
  const headings = top("제목", 6).filter((t: string) => /^heading/.test(t));
  expect(headings[0]).toBe("heading1");
  S.remember("heading3");
  expect(top("제목", 6).filter((t: string) => /^heading/.test(t))[0]).toBe("heading3");
  expect(top("차트")[0]).toBe("chart");
});

test("OSA distance counts a swap as one edit", () => {
  expect(S.osa("abcd", "abdc", 2)).toBe(1);
  expect(S.osa("abc", "xyz", 1)).toBe(2);
});
