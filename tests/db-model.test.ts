import { describe, expect, test } from "bun:test";
import {
  PROPERTY_TYPE_NAMES,
  VIEW_TYPE_NAMES,
  calculationsFor,
  columnWidth,
  computeCalculation,
  displayValue,
  emptyValue,
  formatCalculation,
  formatDate,
  formatNumber,
  formatRelativeTime,
  groupRows,
  isEmptyValue,
  matchesFilter,
  normaliseCellValue,
  normaliseProperty,
  normaliseRow,
  normaliseTemplate,
  normaliseView,
  optionById,
  richValue,
  filterOperatorsFor,
  sortRows,
  visibleProperties,
} from "../db-model.js";

function props(...specs) {
  return specs.map((spec, index) => normaliseProperty(spec, index));
}

const STATUS = { id: "status", name: "상태", type: "status", config: { options: [
  { id: "s1", name: "시작 전", color: "gray" },
  { id: "s2", name: "진행 중", color: "blue" },
  { id: "s3", name: "완료", color: "green" },
] } };

const PROGRESS = { id: "progress", name: "진행", type: "number", config: { number_format: "percent", display: "bar" } };

function row(id, values, ord) {
  return { id, ord: ord ?? 0, props: values, created: 1000, updated: 2000 };
}

const values = (row) => row.props;

describe("normaliseProperty", () => {
  test("file values retain validated upload geometry through persistence", () => {
    const file = { name: "photo", url: "/media/0123456789abcdef", type: "image/png" };
    expect(normaliseCellValue({ type: "files" }, [{ ...file, width: 640, height: 480 }])).toEqual([{ ...file, iw: 640, ih: 480 }]);
    expect(normaliseCellValue({ type: "files" }, [{ ...file, iw: 320, ih: 240 }])).toEqual([{ ...file, iw: 320, ih: 240 }]);
    for (const dimensions of [{ width: 0, height: 480 }, { iw: Infinity, ih: 480 }, { iw: "640", ih: 480 }, {}]) {
      expect(normaliseCellValue({ type: "files" }, [{ ...file, ...dimensions }])).toEqual([file]);
    }
  });

  test("모르는 종류는 텍스트로 떨어뜨린다", () => {
    const prop = normaliseProperty({ id: "p1", name: "메모", type: "wat" }, 0);
    expect(prop.type).toBe("text");
  });

  test("이름이 비면 종류 이름으로 채운다", () => {
    const prop = normaliseProperty({ id: "p1", type: "number" }, 0);
    expect(prop.name).toBe("숫자 1");
  });

  test("상태 속성은 기본 옵션 세 개를 갖는다", () => {
    const prop = normaliseProperty({ id: "s", name: "상태", type: "status" }, 0);
    expect(prop.config.options.map((option) => option.name)).toEqual(["시작 전", "진행 중", "완료"]);
  });

  test("옵션 id 가 겹치면 고유하게 만든다", () => {
    const prop = normaliseProperty({ id: "s", name: "상태", type: "select", config: { options: [{ id: "x", name: "가" }, { id: "x", name: "나" }] } }, 0);
    expect(new Set(prop.config.options.map((option) => option.id)).size).toBe(2);
  });

  test("모르는 색은 허용 목록 안의 색으로 바꾼다", () => {
    const prop = normaliseProperty({ id: "s", name: "상태", type: "select", config: { options: [{ id: "a", name: "가", color: "neon" }] } }, 0);
    expect(["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]).toContain(prop.config.options[0].color);
  });

  test("숫자 속성의 모르는 포맷은 숫자로 되돌린다", () => {
    const prop = normaliseProperty({ id: "n", name: "값", type: "number", config: { number_format: "klingon", display: "spiral" } }, 0);
    expect(prop.config.number_format).toBe("number");
    expect(prop.config.display).toBe("number");
  });

  test("롤업 함수 이름을 검사한다", () => {
    const prop = normaliseProperty({ id: "r", name: "롤업", type: "rollup", config: { function: "nope" } }, 0);
    expect(prop.config.function).toBe("count");
  });
});

describe("normaliseCellValue", () => {
  test("숫자는 쉼표와 퍼센트 기호를 걷어낸다", () => {
    const prop = normaliseProperty(PROGRESS, 0);
    expect(normaliseCellValue(prop, "1,250")).toBe(1250);
    expect(normaliseCellValue(prop, "40 %")).toBe(40);
  });

  test("숫자가 아닌 값은 null 이 된다", () => {
    const prop = normaliseProperty(PROGRESS, 0);
    expect(normaliseCellValue(prop, "많이")).toBe(null);
  });

  test("선택 값은 목록에 있는 id 만 남긴다", () => {
    const prop = normaliseProperty(STATUS, 0);
    expect(normaliseCellValue(prop, "s2")).toBe("s2");
    expect(normaliseCellValue(prop, "s9")).toBe(null);
  });

  test("다중 선택은 중복을 지우고 목록 밖 값을 버린다", () => {
    const prop = normaliseProperty({ id: "m", name: "태그", type: "multi_select", config: { options: [{ id: "a", name: "가" }, { id: "b", name: "나" }] } }, 0);
    expect(normaliseCellValue(prop, ["a", "a", "z"])).toEqual(["a"]);
  });

  test("날짜는 시작/끝 객체로 통일한다", () => {
    const prop = normaliseProperty({ id: "d", name: "날짜", type: "date" }, 0);
    expect(normaliseCellValue(prop, "2026-03-04")).toEqual({ start: "2026-03-04", end: null });
    expect(normaliseCellValue(prop, "2026-03-04T09:30")).toEqual({ start: "2026-03-04T09:30", end: null });
    expect(normaliseCellValue(prop, "언젠가")).toBe(null);
  });

  test("체크박스는 참/거짓으로 좁힌다", () => {
    const prop = normaliseProperty({ id: "c", name: "확인", type: "checkbox" }, 0);
    expect(normaliseCellValue(prop, "true")).toBe(true);
    expect(normaliseCellValue(prop, 1)).toBe(true);
    expect(normaliseCellValue(prop, "")).toBe(false);
  });

  test("파일은 url 이 있는 항목만 남긴다", () => {
    const prop = normaliseProperty({ id: "f", name: "파일", type: "files" }, 0);
    expect(normaliseCellValue(prop, [{ name: "a.png", url: "/a.png" }, { name: "빈칸" }])).toEqual([{ name: "a.png", url: "/a.png", type: "" }]);
  });
});

describe("emptyValue 와 isEmptyValue", () => {
  test("종류마다 빈 값의 모양이 다르다", () => {
    const list = props({ id: "a", type: "number" }, { id: "b", type: "checkbox" }, { id: "c", type: "multi_select" }, { id: "d", type: "text" });
    expect(list.map(emptyValue)).toEqual([null, false, [], ""]);
  });

  test("0 과 false 는 비어 있지 않다", () => {
    const numberProp = normaliseProperty({ id: "a", type: "number" }, 0);
    const checkProp = normaliseProperty({ id: "b", type: "checkbox" }, 0);
    expect(isEmptyValue(numberProp, 0)).toBe(false);
    expect(isEmptyValue(checkProp, false)).toBe(true);
    expect(isEmptyValue(checkProp, true)).toBe(false);
  });
});

describe("formatNumber", () => {
  test("쉼표 포맷은 세 자리마다 끊는다", () => {
    expect(formatNumber(1234567, { number_format: "number_with_commas" })).toBe("1,234,567");
  });

  test("퍼센트 포맷은 소수 두 자리까지 보여 준다", () => {
    expect(formatNumber(0.4, { number_format: "percent" })).toBe("40%");
    expect(formatNumber(0.1234, { number_format: "percent" })).toBe("12.34%");
  });

  test("통화 포맷", () => {
    expect(formatNumber(1200, { number_format: "won" })).toBe("1,200원");
    expect(formatNumber(9.5, { number_format: "dollar" })).toBe("$9.5");
  });

  test("빈 값과 숫자가 아닌 값은 빈 문자열", () => {
    expect(formatNumber(null, {})).toBe("");
    expect(formatNumber("", {})).toBe("");
  });
});

describe("formatDate 와 formatRelativeTime", () => {
  test("날짜는 점으로 구분한다", () => {
    expect(formatDate("2026-03-04")).toBe("2026.03.04");
    expect(formatDate({ start: "2026-03-04", end: "2026-03-06" })).toBe("2026.03.04 → 2026.03.06");
  });

  test("상대 시간은 방금/분/시간/일로 줄인다", () => {
    const now = Date.parse("2026-03-04T12:00:00Z");
    expect(formatRelativeTime(now - 30000, now)).toBe("방금");
    expect(formatRelativeTime(now - 5 * 60000, now)).toBe("5분 전");
    expect(formatRelativeTime(now - 3 * 3600000, now)).toBe("3시간 전");
    expect(formatRelativeTime(now - 2 * 86400000, now)).toBe("2일 전");
  });
});

describe("displayValue", () => {
  test("상태는 옵션 이름으로 보여 준다", () => {
    const prop = normaliseProperty(STATUS, 0);
    expect(displayValue(prop, "s3")).toBe("완료");
    expect(displayValue(prop, "s9")).toBe("");
  });

  test("다중 선택은 쉼표로 잇는다", () => {
    const prop = normaliseProperty({ id: "m", name: "태그", type: "multi_select", config: { options: [{ id: "a", name: "가" }, { id: "b", name: "나" }] } }, 0);
    expect(displayValue(prop, ["a", "b"])).toBe("가, 나");
  });

  test("숫자는 속성 포맷을 따른다", () => {
    const prop = normaliseProperty(PROGRESS, 0);
    expect(displayValue(prop, 0.5)).toBe("50%");
  });

  test("수식 서식 값은 평문으로 보이고, 비었는지·정렬·필터는 그 글자를 본다", () => {
    const prop = normaliseProperty({ id: "f", name: "수식", type: "formula" }, 0);
    const late = { __rich: [{ text: "지남", color: "red", b: true }] };
    expect(displayValue(prop, late)).toBe("지남");
    expect(richValue(late)).toEqual([{ text: "지남", classes: ["fx-red", "fx-b"] }]);
    expect(richValue("남음")).toEqual([{ text: "남음", classes: [] }]);
    expect(isEmptyValue(prop, late)).toBe(false);
    expect(isEmptyValue(prop, { __rich: [] })).toBe(true);
    expect(matchesFilter([prop], { f: late }, { property: "f", operator: "contains", value: "지" })).toBe(true);
    const rows = [{ id: "1", v: { f: "나" } }, { id: "2", v: { f: late } }];
    expect(sortRows([prop], rows, [{ property: "f" }], (r: any) => r.v).map((r: any) => r.id)).toEqual(["1", "2"]);
  });
});

describe("matchesFilter", () => {
  const list = props(STATUS, PROGRESS, { id: "title", name: "제목", type: "title" });

  test("select 는 is/is_not", () => {
    expect(matchesFilter(list, { status: "s3" }, { property: "status", operator: "is", value: "s3" })).toBe(true);
    expect(matchesFilter(list, { status: "s3" }, { property: "status", operator: "is_not", value: "s3" })).toBe(false);
  });

  test("number 는 크기 비교", () => {
    expect(matchesFilter(list, { progress: 80 }, { property: "progress", operator: "greater_than", value: 50 })).toBe(true);
    expect(matchesFilter(list, { progress: 30 }, { property: "progress", operator: "greater_than", value: 50 })).toBe(false);
  });

  test("텍스트는 contains", () => {
    expect(matchesFilter(list, { title: "NWIRO scene 레벨" }, { property: "title", operator: "contains", value: "nwiro" })).toBe(true);
    expect(matchesFilter(list, { title: "MCP 인프라" }, { property: "title", operator: "contains", value: "nwiro" })).toBe(false);
  });

  test("is_empty 와 is_not_empty", () => {
    expect(matchesFilter(list, { progress: null }, { property: "progress", operator: "is_empty" })).toBe(true);
    expect(matchesFilter(list, { progress: 10 }, { property: "progress", operator: "is_empty" })).toBe(false);
  });

  test("and 는 모두, or 는 하나", () => {
    const both = { and: [{ property: "status", operator: "is", value: "s3" }, { property: "progress", operator: "greater_than", value: 50 }] };
    expect(matchesFilter(list, { status: "s3", progress: 100 }, both)).toBe(true);
    expect(matchesFilter(list, { status: "s3", progress: 10 }, both)).toBe(false);
    const either = { or: [{ property: "status", operator: "is", value: "s3" }, { property: "progress", operator: "greater_than", value: 50 }] };
    expect(matchesFilter(list, { status: "s1", progress: 90 }, either)).toBe(true);
  });

  test("조건이 없으면 모두 통과", () => {
    expect(matchesFilter(list, {}, null)).toBe(true);
  });

  test("상대 날짜 is_within은 서울 날짜로 오늘 기준 범위를 본다", () => {
    const dates = props({ id: "due", name: "마감", type: "date" });
    const now = Date.UTC(2026, 9, 31, 15, 30); // 2026-11-01 00:30 in Seoul
    const hit = (start: any, relative: string) => matchesFilter(dates, { due: start === null ? null : { start, end: null } }, { property: "due", operator: "is_within", value: { relative } }, { now });
    expect(["2026-10-31", "2026-11-01", "2026-11-30", "2026-12-01"].map((d) => hit(d, "this_month"))).toEqual([false, true, true, false]);
    expect(["2026-11-01T00:10", "2026-10-31T23:59"].map((d) => hit(d, "today"))).toEqual([true, false]);
    expect(["2026-10-25", "2026-10-26", "2026-11-01", "2026-11-02"].map((d) => hit(d, "this_week"))).toEqual([false, true, true, false]);
    expect(["2025-12-31", "2026-01-01", "2026-12-31"].map((d) => hit(d, "this_year"))).toEqual([false, true, true]);
    expect(["2026-10-24", "2026-10-25", "2026-11-01", "2026-11-02"].map((d) => hit(d, "past_days:7"))).toEqual([false, true, true, false]);
    expect(["2026-10-31", "2026-11-01", "2026-11-08", "2026-11-09"].map((d) => hit(d, "next_days:7"))).toEqual([false, true, true, false]);
    expect(hit(null, "this_month")).toBe(false);
    expect(hit("2026-11-05", "someday")).toBe(false);
    expect(filterOperatorsFor("date")).toContain("is_within");
  });

  test("날짜는 is_before/is_after", () => {
    const withDate = props({ id: "due", name: "마감", type: "date" });
    expect(matchesFilter(withDate, { due: { start: "2026-01-01", end: null } }, { property: "due", operator: "is_before", value: "2026-06-01" })).toBe(true);
    expect(matchesFilter(withDate, { due: { start: "2026-08-01", end: null } }, { property: "due", operator: "is_before", value: "2026-06-01" })).toBe(false);
  });

  test("체크박스는 is_checked", () => {
    const withCheck = props({ id: "done", name: "완료", type: "checkbox" });
    expect(matchesFilter(withCheck, { done: true }, { property: "done", operator: "is_checked" })).toBe(true);
    expect(matchesFilter(withCheck, { done: false }, { property: "done", operator: "is_checked" })).toBe(false);
  });
});

describe("sortRows", () => {
  const list = props(STATUS, PROGRESS, { id: "title", name: "제목", type: "title" });

  test("숫자 내림차순", () => {
    const rows = [row("a", { progress: 10 }, 0), row("b", { progress: 90 }, 1), row("c", { progress: 50 }, 2)];
    const sorted = sortRows(list, rows, [{ property: "progress", direction: "descending" }], values);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  test("상태는 옵션 순서를 따른다", () => {
    const rows = [row("a", { status: "s3" }, 0), row("b", { status: "s1" }, 1), row("c", { status: "s2" }, 2)];
    const sorted = sortRows(list, rows, [{ property: "status", direction: "ascending" }], values);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  test("정렬이 없으면 원래 순서", () => {
    const rows = [row("a", {}, 0), row("b", {}, 1)];
    expect(sortRows(list, rows, [], values).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("빈 값은 뒤로 밀린다", () => {
    const rows = [row("a", { progress: null }, 0), row("b", { progress: 5 }, 1)];
    const sorted = sortRows(list, rows, [{ property: "progress", direction: "descending" }], values);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("groupRows", () => {
  test("상태 옵션마다 열을 만들고 빈 열도 남긴다", () => {
    const list = props(STATUS);
    const rows = [row("a", { status: "s3" }, 0), row("b", { status: "s3" }, 1), row("c", { status: "s1" }, 2)];
    const grouped = groupRows(list, rows, "status", values);
    expect(grouped.groups.map((group) => group.label)).toEqual(["시작 전", "진행 중", "완료", "옵션 없음"]);
    expect(grouped.groups.map((group) => group.rows.length)).toEqual([1, 0, 2, 0]);
  });

  test("값이 없는 행은 옵션 없음으로 간다", () => {
    const list = props(STATUS);
    const grouped = groupRows(list, [row("a", { status: null }, 0)], "status", values);
    const none = grouped.groups.find((group) => group.key === "__none");
    expect(none.rows.map((entry) => entry.id)).toEqual(["a"]);
  });

  test("그룹 속성이 없으면 null", () => {
    expect(groupRows(props(STATUS), [], "없는속성", values)).toBe(null);
  });
});

describe("computeCalculation", () => {
  const list = props(STATUS, PROGRESS, { id: "done", name: "완료", type: "checkbox" });
  const rows = [
    row("a", { status: "s3", progress: 100, done: true }, 0),
    row("b", { status: "s2", progress: 50, done: false }, 1),
    row("c", { status: "s3", progress: null, done: true }, 2),
    row("d", { status: null, progress: 25, done: false }, 3),
  ];

  test("count_all 은 필터된 전체 행 수", () => {
    expect(computeCalculation(list, rows, "progress", "count_all", values)).toBe(4);
  });

  test("count_values 는 채워진 칸 수", () => {
    expect(computeCalculation(list, rows, "progress", "count_values", values)).toBe(3);
  });

  test("sum / average / min / max 는 숫자만 센다", () => {
    expect(computeCalculation(list, rows, "progress", "sum", values)).toBe(175);
    expect(computeCalculation(list, rows, "progress", "average", values)).toBe(58.333);
    expect(computeCalculation(list, rows, "progress", "min", values)).toBe(25);
    expect(computeCalculation(list, rows, "progress", "max", values)).toBe(100);
  });

  test("숫자가 하나도 없으면 합계는 null", () => {
    expect(computeCalculation(list, [row("a", { progress: null }, 0)], "progress", "sum", values)).toBe(null);
  });

  test("percent_checked 는 체크된 비율", () => {
    expect(computeCalculation(list, rows, "done", "percent_checked", values)).toBe(50);
  });

  test("percent_per_option 은 옵션별 비율", () => {
    const result = computeCalculation(list, rows, "status", "percent_per_option", values);
    expect(result).toEqual([
      { id: "s1", name: "시작 전", color: "gray", count: 0, percent: 0 },
      { id: "s2", name: "진행 중", color: "blue", count: 1, percent: 25 },
      { id: "s3", name: "완료", color: "green", count: 2, percent: 50 },
    ]);
  });

  test("percent_empty 와 percent_not_empty", () => {
    expect(computeCalculation(list, rows, "progress", "percent_empty", values)).toBe(25);
    expect(computeCalculation(list, rows, "progress", "percent_not_empty", values)).toBe(75);
  });

  test("earliest_date 와 latest_date", () => {
    const withDate = props({ id: "due", name: "마감", type: "date" });
    const dated = [row("a", { due: { start: "2026-05-01", end: null } }, 0), row("b", { due: { start: "2026-01-09", end: null } }, 1)];
    expect(computeCalculation(withDate, dated, "due", "earliest_date", values)).toBe("2026-01-09");
    expect(computeCalculation(withDate, dated, "due", "latest_date", values)).toBe("2026-05-01");
  });

  test("계산 결과를 읽는 문자열로 바꾼다", () => {
    const progress = normaliseProperty(PROGRESS, 0);
    expect(formatCalculation("average", 0.58333, progress)).toBe("58.33%");
    expect(formatCalculation("count_values", 3, progress)).toBe("3");
    const status = normaliseProperty(STATUS, 0);
    expect(formatCalculation("percent_per_option", [{ name: "완료", percent: 50 }], status)).toBe("완료 50%");
  });

  test("종류마다 쓸 수 있는 계산이 다르다", () => {
    expect(calculationsFor("number")).toContain("sum");
    expect(calculationsFor("checkbox")).toContain("percent_checked");
    expect(calculationsFor("number")).not.toContain("percent_checked");
    expect(calculationsFor("status")).toContain("percent_per_option");
  });
});

describe("뷰 정규화와 보이는 속성", () => {
  test("모르는 뷰 종류는 표로 떨어뜨린다", () => {
    expect(normaliseView({ id: "v", name: "이상한 뷰", type: "hologram" }, 0).type).toBe("table");
  });

  test("정렬 방향은 두 값만 인정한다", () => {
    const view = normaliseView({ id: "v", type: "table", config: { sorts: [{ property: "progress", direction: "sideways" }] } }, 0);
    expect(view.config.sorts).toEqual([{ property: "progress", direction: "ascending" }]);
  });

  test("숨긴 속성은 보이는 목록에서 빠진다", () => {
    const list = props(STATUS, PROGRESS, { id: "title", name: "제목", type: "title", hidden: true });
    expect(visibleProperties(list, { config: {} }).map((prop) => prop.id)).toEqual(["status", "progress"]);
  });

  test("뷰가 보이는 속성을 지정하면 그것만 남는다", () => {
    const list = props(STATUS, PROGRESS);
    const view = { config: { visible: ["progress"] } };
    expect(visibleProperties(list, view).map((prop) => prop.id)).toEqual(["progress"]);
  });

  test("컬럼 폭은 속성 종류별 기본값을 쓴다", () => {
    const title = normaliseProperty({ id: "t", name: "제목", type: "title" }, 0);
    expect(columnWidth(title, { config: {} })).toBe(260);
    expect(columnWidth(title, { config: { widths: { t: 400 } } })).toBe(400);
  });
});

describe("normaliseRow 와 normaliseTemplate", () => {
  test("행 값은 속성 id 로 맞춰지고 빠진 칸은 빈 값이 된다", () => {
    const list = props(STATUS, PROGRESS);
    const parsed = normaliseRow({ id: "r1", props: { status: "s2" } }, list, 0);
    expect(parsed.props.status).toBe("s2");
    expect(parsed.props.progress).toBe(null);
  });

  test("행 값은 속성 이름으로도 들어온다", () => {
    const list = props(STATUS);
    expect(normaliseRow({ props: { 상태: "s1" } }, list, 0).props.status).toBe("s1");
  });

  test("템플릿은 이름과 속성값을 갖는다", () => {
    const parsed = normaliseTemplate({ name: "실험", props: { status: "s1" }, blocks: [{ type: "paragraph", text: "메모" }] }, 0);
    expect(parsed.name).toBe("실험");
    expect(parsed.props.status).toBe("s1");
    expect(parsed.blocks.length).toBe(1);
  });
});

describe("목록 상수", () => {
  test("속성 종류 20가지가 모두 있다", () => {
    expect(PROPERTY_TYPE_NAMES).toEqual([
      "title", "text", "number", "select", "multi_select", "status", "date", "checkbox",
      "url", "email", "phone", "files", "formula", "relation", "person", "rollup", "created_time", "updated_time", "unique_id", "button",
    ]);
  });

  test("뷰 종류 7가지가 모두 있다", () => {
    expect(VIEW_TYPE_NAMES).toEqual(["table", "board", "gallery", "list", "calendar", "timeline", "chart"]);
  });

  test("옵션 id 로 옵션을 찾는다", () => {
    const prop = normaliseProperty(STATUS, 0);
    expect(optionById(prop, "s2").name).toBe("진행 중");
    expect(optionById(prop, "nope")).toBe(null);
  });
});
