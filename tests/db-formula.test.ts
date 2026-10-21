import { describe, expect, test } from "bun:test";
import { evaluateFormula, evaluateFormulaDetailed, formulaError, rollupValue } from "../db-formula.js";
import { FORMULA_EXAMPLES } from "../db-model.js";

function ctxOf(props: Record<string, any>, types: Record<string, string> = {}) {
  return {
    get: (k: string) => props[k],
    has: (k: string) => k in props,
    typeOf: (k: string) => types[k] || "text",
    now: Date.UTC(2026, 9, 15),
  };
}
const run = (expr: string, props: Record<string, any> = {}) => evaluateFormula(expr, ctxOf(props));

describe("산술", () => {
  test("곱셈이 덧셈보다 먼저 계산된다", () => {
    expect(run("1 + 2 * 3")).toBe(7);
  });
  test("괄호와 단항 마이너스를 처리한다", () => {
    expect(run("(1 + 2) * -3")).toBe(-9);
  });
  test("나머지와 나눗셈", () => {
    expect(run("10 % 4")).toBe(2);
    expect(run("7 / 2")).toBe(3.5);
  });
  test("문자열이 있으면 + 는 이어 붙인다", () => {
    expect(run('"a" + 1')).toBe("a1");
  });
});

describe("prop", () => {
  test("이름으로 속성을 읽는다", () => {
    expect(run('prop("가격") * 2', { 가격: 5 })).toBe(10);
  });
  test("없는 속성은 대체값을 쓴다", () => {
    expect(run('prop("없음", 3) + 1')).toBe(4);
    expect(run('prop("없음")')).toBe(null);
  });
});

describe("if / concat", () => {
  test("조건에 따라 분기한다", () => {
    expect(run('if(prop("n") > 3, "큼", "작음")', { n: 5 })).toBe("큼");
    expect(run('if(prop("n") > 3, "큼", "작음")', { n: 1 })).toBe("작음");
  });
  test("concat은 값을 이어 붙인다", () => {
    expect(run("concat('a', 1, true)")).toBe("a1true");
  });
});

describe("dateBetween", () => {
  test("일 단위", () => {
    expect(run('dateBetween("2026-03-10", "2026-03-01", "days")')).toBe(-9);
    expect(run('dateBetween("2026-03-01", "2026-03-10", "days")')).toBe(9);
  });
  test("월 단위는 온전한 달만 센다", () => {
    expect(run('dateBetween("2026-01-15", "2026-03-14", "months")')).toBe(1);
    expect(run('dateBetween("2026-01-15", "2026-03-15", "months")')).toBe(2);
    expect(run('dateBetween("2026-03-15", "2026-01-01", "months")')).toBe(-2);
  });
  test("시간 단위", () => {
    expect(run('dateBetween("2026-01-01T00:00", "2026-01-01T05:30", "hours")')).toBe(5);
  });
});

describe("비교와 논리", () => {
  test("비교 연산자", () => {
    expect(run("1 < 2")).toBe(true);
    expect(run("2 >= 3")).toBe(false);
    expect(run('"a" == "a"')).toBe(true);
    expect(run("1 != 2")).toBe(true);
  });
  test("and / or / not", () => {
    expect(run("true and false")).toBe(false);
    expect(run("true || false")).toBe(true);
    expect(run("not false")).toBe(true);
    expect(run("!(1 == 1)")).toBe(false);
  });
});

describe("문자열 함수", () => {
  test("lower upper trim", () => {
    expect(run('lower("AbC")')).toBe("abc");
    expect(run('upper("abc")')).toBe("ABC");
    expect(run('trim("  x ")')).toBe("x");
  });
  test("replace contains length", () => {
    expect(run('replace("a-b-c", "-", "+")')).toBe("a+b+c");
    expect(run('contains("hello", "ell")')).toBe(true);
    expect(run('length("도리노트")')).toBe(4);
  });
  test("join은 목록을 구분자로 잇는다", () => {
    expect(run('join(prop("태그"), "/")', { 태그: ["a", "b", "c"] })).toBe("a/b/c");
  });
});

describe("점 메서드 문법", () => {
  test("a.f(b)는 f(a, b)와 같다", () => {
    expect(run('"ab".upper()')).toBe("AB");
    expect(run('prop("x").length()', { x: "abc" })).toBe(run('length(prop("x"))', { x: "abc" }));
    expect(run('"a-b".replace("-", "+")')).toBe("a+b");
  });
  test("수 뒤의 점은 뒤가 숫자일 때만 소수점이다", () => {
    expect(run("1.5 + 2")).toBe(3.5);
    expect(run("1.abs()")).toBe(1);
    expect(run("1.5.round()")).toBe(2);
    expect(run("(-1).abs()")).toBe(1);
  });
  test("메서드는 단항 마이너스보다 먼저 묶인다", () => {
    expect(run('-"3".toNumber()')).toBe(-3);
    expect(run("-(1).abs() + 5")).toBe(4);
  });
  test("점으로 끝나는 수식은 오류 메시지", () => {
    expect(formulaError('"a".')).toBeTruthy();
    expect(run('"a".')).toBe(null);
  });
});

describe("style 색 글자", () => {
  test("style은 색·굵기 구간 하나를 돌려준다", () => {
    expect(run('"지남".style("red", "b")')).toEqual({ __rich: [{ text: "지남", color: "red", b: true }] });
    expect(run('style("글", "blue_background")')).toEqual({ __rich: [{ text: "글", bg: "blue" }] });
  });
  test("글자와 합치면 구간이 이어 붙는다", () => {
    expect(run('"a" + "b".style("blue")')).toEqual({ __rich: [{ text: "a" }, { text: "b", color: "blue" }] });
    expect(run('concat("x", "y".style("c"))')).toEqual({ __rich: [{ text: "x" }, { text: "y", c: true }] });
  });
  test("알 수 없는 스타일은 글자만, grey는 gray, unstyle은 평문", () => {
    expect(run('"x".style("chartreuse")')).toEqual({ __rich: [{ text: "x" }] });
    expect(run('"n".style("grey")')).toEqual({ __rich: [{ text: "n", color: "gray" }] });
    expect(run('unstyle("a".style("red") + "b")')).toBe("ab");
    expect(run('length("abc".style("red"))')).toBe(3);
  });
});

describe("날짜 값", () => {
  const now = (props: Record<string, any> = {}) => ({ ...ctxOf(props), now: Date.UTC(2026, 9, 20, 3) });
  test("날짜 속성 {start,end}을 비교하고 now()는 시각이다", () => {
    expect(evaluateFormula('prop("마감") < now()', now({ 마감: { start: "2026-10-01", end: null } }))).toBe(true);
    expect(evaluateFormula('prop("마감") < now()', now({ 마감: { start: "2026-10-21", end: null } }))).toBe(false);
    expect(evaluateFormula('if(prop("마감") < now(), "지남".style("red","b"), "남음")', now({ 마감: { start: "2026-10-19" } }))).toEqual({ __rich: [{ text: "지남", color: "red", b: true }] });
  });
  test("dateBetween은 날짜 속성 값도 받고 문자열과 같은 부호다", () => {
    expect(run('dateBetween(prop("a"), prop("b"), "days")', { a: { start: "2026-10-20" }, b: { start: "2026-10-01" } })).toBe(-19);
  });
  test("오프셋이 있는 ISO는 그 오프셋, 없으면 서울 시각으로 읽는다", () => {
    expect(run('dateBetween("2026-10-20T18:00", "2026-10-20T09:00+00:00", "minutes")')).toBe(0);
    expect(run('prop("d")', { d: "2026-10-20T09:00+00:00" })).toBe("2026-10-20T09:00+00:00");
  });
});

describe("날짜 함수 (서울 기준)", () => {
  // 2026-10-20T15:30Z is 2026-10-21 00:30 in Seoul.
  const at = (expr: string, props: Record<string, any> = {}) => evaluateFormula(expr, { ...ctxOf(props), now: Date.UTC(2026, 9, 20, 15, 30) });
  test("today와 formatDate", () => {
    expect(at('formatDate(today(), "YYYY-MM-DD")')).toBe("2026-10-21");
    expect(at('today()')).toBe("2026-10-21");
    expect(at('formatDate(parseDate("2026-03-01"), "ddd")')).toBe("일");
    expect(at('formatDate(parseDate("2026-03-01T09:05"), "YYYY년 M월 D일 dddd HH:mm")')).toBe("2026년 3월 1일 일요일 09:05");
  });
  test("dateAdd·dateSubtract는 월말을 넘지 않는다", () => {
    expect(at('dateAdd(parseDate("2026-01-31"), 1, "months")')).toBe("2026-02-28");
    expect(at('formatDate(dateAdd(prop("시작"), 7, "days"), "M월 D일")', { 시작: { start: "2026-01-31" } })).toBe("2월 7일");
    expect(at('dateSubtract(parseDate("2026-03-31"), 1, "quarters")')).toBe("2025-12-31");
    expect(at('dateAdd(parseDate("2026-01-01T23:30"), 90, "minutes")')).toBe("2026-01-02 01:00");
    expect(at('dateAdd("abc", 1, "days")')).toBe(null);
  });
  test("year month date day week", () => {
    expect(at('year(prop("시작"))', { 시작: { start: "2026-01-31" } })).toBe(2026);
    expect(at('month(parseDate("2026-01-31"))')).toBe(1);
    expect(at('date(parseDate("2026-01-31"))')).toBe(31);
    expect(at('day(parseDate("2026-03-01"))')).toBe(7);
    expect(at('week(parseDate("2026-01-01"))')).toBe(1);
    expect(at('week(prop("시작"))', { 시작: { start: "2026-01-31" } })).toBe(5);
  });
  test("dateStart dateEnd timestamp", () => {
    const range = { 기간: { start: "2026-05-01", end: "2026-05-04" } };
    expect(at('dateStart(prop("기간"))', range)).toBe("2026-05-01");
    expect(at('dateEnd(prop("기간"))', range)).toBe("2026-05-04");
    expect(at('dateBetween(dateEnd(prop("기간")), dateStart(prop("기간")), "days")', range)).toBe(-3);
    expect(at('timestamp(parseDate("2026-10-20T09:00+00:00"))')).toBe(Date.UTC(2026, 9, 20, 9));
    expect(at('prop("기간").dateStart() < today()', range)).toBe(true);
  });
});

test("수식 편집기 예시는 모두 올바르고 값을 낸다", () => {
  const props = { 진행: 80, 시작: { start: "2026-01-31" }, 마감: { start: "2026-01-01" } };
  expect(FORMULA_EXAMPLES.map((e: string) => formulaError(e))).toEqual(FORMULA_EXAMPLES.map(() => null));
  expect(FORMULA_EXAMPLES.map((e: string) => evaluateFormula(e, ctxOf(props)))).toEqual(["순조로움", "2월 7일", { __rich: [{ text: "지남", color: "red", b: true }] }]);
});

describe("replace 정규식", () => {
  test("정규식 문법이 있으면 정규식, 아니면 글자 그대로", () => {
    expect(run('replace("10-20 회의", "^\\\\d{2}-\\\\d{2}\\\\s*", "")')).toBe("회의");
    expect(run('replace("a.b", ".", "-")')).toBe("a-b");
    expect(run('replace("a-b-c", "-", "+")')).toBe("a+b+c");
    expect(run('replaceAll("2026년 10월", "[^0-9]", "")')).toBe("202610");
    expect(run('replace("1234567", "(\\\\d+)(\\\\d{3})$", "$1,$2")')).toBe("1234,567");
    expect(run('"x(1".replace("(", "[")')).toBe("x[1");
  });
});

describe("ifs · let/lets · 리스트 리터럴 · 거듭제곱 (C1a)", () => {
  test("^ 는 오른쪽 결합이고 곱셈보다 먼저, 단항 마이너스보다 나중에 계산된다", () => {
    expect(run("2^3^2")).toBe(512);
    expect(run("2 * 3 ^ 2")).toBe(18);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("2 ^ -1")).toBe(0.5);
    expect(run('round(prop("체중 kg") / ((prop("신장 cm") / 100) ^ 2)*10)/10', { "체중 kg": 70, "신장 cm": 175 })).toBe(22.9);
  });
  test("pow 와 mod (mod 의 부호는 나눠지는 수를 따른다)", () => {
    expect(run("pow(2, 10)")).toBe(1024);
    expect(run("mod(-7, 3)")).toBe(-1);
    expect(run("mod(7, -3)")).toBe(1);
    expect(run("mod(1, 0)")).toBe(null);
  });
  test("ifs 는 처음 참인 조건의 값, 없으면 마지막 기본값이나 빈 값", () => {
    expect(run('ifs(prop("체중") > 80, "A", prop("체중") > 60, "B", "C")', { 체중: 70 })).toBe("B");
    expect(run('ifs(prop("체중") > 80, "A", prop("체중") > 60, "B", "C")', { 체중: 50 })).toBe("C");
    expect(run("ifs(false, 1, false, 2)")).toBe(null);
    expect(run("ifs(true, 1, 1 / 0, 2)")).toBe(1);
  });
  test("let/lets 는 이름을 차례로 묶고 뒤의 값이 앞의 이름을 쓴다", () => {
    expect(run('lets(a, 2, b, a^3, ifs(b > 7, "큼", "작음"))')).toBe("큼");
    expect(run("let(x, 1, let(y, x + 1, x + y))")).toBe(3);
    expect(run("let(x, 1, let(x, 2, x))")).toBe(2);
    expect(run('lets(w, prop("체중"), h, prop("키")/100, round(w/h^2*10)/10)', { 체중: 70, 키: 175 })).toBe(22.9);
  });
  test("묶이지 않은 이름과 잘못된 let 은 파싱 오류, 평가는 빈 값", () => {
    expect(formulaError("x + 1")).toBeTruthy();
    expect(formulaError("let(x, 1, let(x, 2, x)) + x")).toBeTruthy();
    expect(formulaError("let(x, x, 1)")).toBeTruthy();
    expect(formulaError("let(1, 2, 3)")).toBeTruthy();
    expect(run("let(1, 2, 3)")).toBe(null);
    expect(formulaError("let(x, 1, x + 1)")).toBe(null);
  });
  test("리스트 리터럴", () => {
    expect(run("[1, 2, 3].length()")).toBe(3);
    expect(run("length([])")).toBe(0);
    expect(run('[1, "a", true]')).toBe("1, a, true");
    expect(run("sum([1, 2, 3])")).toBe(6);
    expect(run("[\n  1,\n  2\n].length()")).toBe(2);
    expect(run("[[1], [2, 3]].length()")).toBe(2);
    expect(formulaError("[1, 2")).toBeTruthy();
    expect(formulaError("[,]")).toBeTruthy();
  });
});

describe("리스트 메서드와 람다 current · index (C1a)", () => {
  const row = (id: string, title: string, props: Record<string, any>) => ({ __row: true, id, title, props });
  const tasks = [
    row("t1", "설계", { 완료: true, 금액: 100 }),
    row("t2", "구현", { 완료: false, 금액: 250 }),
    row("t3", "검사", { 완료: true, 금액: 50 }),
    row("t4", "배포", { 완료: false, 금액: 0 }),
    row("t5", "기록", { 완료: false, 금액: null }),
  ];
  const rel = { "할 일": tasks };

  test("관계 행 목록을 거르고 세고 합친다", () => {
    expect(run('prop("할 일").filter(current.prop("완료")).length()', rel)).toBe(2);
    expect(run('filter(prop("할 일"), current.prop("완료") == false).length()', rel)).toBe(3);
    expect(run('prop("할 일").map(current.prop("금액")).sum()', rel)).toBe(400);
    expect(run('sum(prop("할 일").filter(current.prop("완료")).map(current.prop("금액")))', rel)).toBe(150);
    expect(run('round(prop("할 일").filter(current.prop("완료")).length() / prop("할 일").length(), 2)', rel)).toBe(0.4);
  });
  test("행을 글로 보이면 제목이다", () => {
    expect(run('prop("할 일").filter(current.prop("완료"))', rel)).toBe("설계, 검사");
    expect(run('prop("할 일").first()', rel)).toBe("설계");
    expect(run('"할 일: " + prop("할 일").last()', rel)).toBe("할 일: 기록");
    expect(run('prop("할 일").first().prop("금액")', rel)).toBe(100);
  });
  test("some every find findIndex includes", () => {
    expect(run('some(prop("할 일"), current.prop("금액") > 200)', rel)).toBe(true);
    expect(run('prop("할 일").every(current.prop("완료"))', rel)).toBe(false);
    expect(run('prop("할 일").find(current.prop("금액") == 50)', rel)).toBe("검사");
    expect(run('["a", "b", "c"].findIndex(current == "b")')).toBe(1);
    expect(run('["a", "b"].findIndex(current == "z")')).toBe(-1);
    expect(run('includes(["1", "2", "3"], prop("month"))', { month: "2" })).toBe(true);
    expect(run('[1, 2].includes(3)')).toBe(false);
  });
  test("index 는 원소 순번(0부터)", () => {
    expect(run('["a", "b", "c"].map(index + ":" + current).join(" ")')).toBe("0:a 1:b 2:c");
    expect(run('[5, 6, 7].filter(index > 0).sum()')).toBe(13);
  });
  test("중첩 람다에서 안쪽 current 는 안쪽 원소", () => {
    expect(run("[1, 2].map([10, 20].map(current).sum() + current)")).toBe("31, 32");
    expect(run("[[1, 2], [3]].map(current.map(current * 10).sum())")).toBe("30, 30");
  });
  test("first last at slice flat reverse unique sort concat", () => {
    expect(run("[3, 1, 2].slice(1).at(0)")).toBe(1);
    expect(run("[3, 1, 2].slice(0, 2)")).toBe("3, 1");
    expect(run("[3, 1, 2].at(-1)")).toBe(2);
    expect(run("[3, 1, 2].at(9)")).toBe(null);
    expect(run("[[1], [2, 3]].flat().includes(3)")).toBe(true);
    expect(run("[[1], [2, 3]].flat().length()")).toBe(3);
    expect(run("[1, 2, 3].reverse()")).toBe("3, 2, 1");
    expect(run('["b", "a", "b"].unique()')).toBe("b, a");
    expect(run("[3, 1, 2].sort()")).toBe("1, 2, 3");
    expect(run("[1].concat([2, 3])")).toBe("1, 2, 3");
    expect(run("first([])")).toBe(null);
  });
  test("글자에도 substring · slice · at", () => {
    expect(run('"2026-10-20".substring(0, 4)')).toBe("2026");
    expect(run('"가나다".substring(1)')).toBe("나다");
    expect(run('"abcdef".slice(2, 4)')).toBe("cd");
  });
  test("원소에 style 구간이 있는 리스트는 색을 유지하며 쉼표로 잇는다", () => {
    const v = run('prop("할 일").filter(current.prop("완료") == false).map("미완료".style("b", "red") + " " + current)', rel) as any;
    expect(v && v.__rich.map((s: any) => s.text).join("")).toBe("미완료 구현, 미완료 배포, 미완료 기록");
    expect(v.__rich[0]).toEqual({ text: "미완료", b: true, color: "red" });
  });
  test("리스트가 아닌 값에 리스트 메서드는 빈 값, 오류 없음", () => {
    expect(run("(5).map(current + 1)")).toBe(null);
    expect(run('prop("없음").filter(current)')).toBe(null);
    expect(run("(5).first()")).toBe(null);
    // a relation value that is still an id list: .prop() on an id is empty, never the property name
    expect(run('prop("할 일").filter(current.prop("완료")).length()', { "할 일": ["t1", "t2"] })).toBe(0);
    expect(run('prop("가격", 3)', { 가격: 5 })).toBe(5);
    expect(formulaError("current + 1")).toBeTruthy();
    expect(formulaError("index")).toBeTruthy();
    expect(formulaError("[1].map(current + index)")).toBe(null);
  });
});

describe("계산 상한과 오류 전달 (C1a)", () => {
  const ten = "[1,2,3,4,5,6,7,8,9,10]";
  const nest = (n: number) => {
    let e = "current";
    for (let i = 0; i < n; i++) e = ten + ".map(" + e + ")";
    return e;
  };
  test("평가 노드 1만 개를 넘으면 '수식이 너무 깁니다' 오류, 그 아래는 정상", () => {
    const heavy = evaluateFormulaDetailed(nest(4), ctxOf({}));
    expect(heavy.value).toBe(null);
    expect(heavy.error).toBe("수식이 너무 깁니다");
    expect(run(nest(4))).toBe(null);
    const light = evaluateFormulaDetailed(nest(3), ctxOf({}));
    expect(light.error).toBe(null);
    expect(String(light.value).split(", ").length).toBe(1000);
  });
  test("단계 카운터는 수식 평가마다 0에서 시작한다(같은 문맥 재사용)", () => {
    const ctx = ctxOf({});
    for (let i = 0; i < 20; i++) expect(evaluateFormulaDetailed(nest(3), ctx).error).toBe(null);
  });
  test("2만 개 목록을 map 하면 오류 값", () => {
    const big = Array.from({ length: 20000 }, (_, i) => i + 1);
    const r = evaluateFormulaDetailed('prop("n").map(current * 2)', ctxOf({ n: big }));
    expect(r.value).toBe(null);
    expect(r.error).toBeTruthy();
  });
  test("런타임 오류는 메시지로, 정상 값은 오류 없이", () => {
    expect(evaluateFormulaDetailed("nope(1)", ctxOf({}))).toEqual({ value: null, error: "알 수 없는 함수: nope" });
    // dividing by zero (an empty number) is an empty value, not an error, as before
    expect(evaluateFormulaDetailed("1 / 0", ctxOf({}))).toEqual({ value: null, error: null });
    expect(evaluateFormulaDetailed('prop("a") / prop("b")', ctxOf({ a: 0, b: null }))).toEqual({ value: null, error: null });
    expect(evaluateFormulaDetailed("1 + 2", ctxOf({}))).toEqual({ value: 3, error: null });
    expect(evaluateFormulaDetailed('prop("없음")', ctxOf({}))).toEqual({ value: null, error: null });
  });
});

describe("rollupValue", () => {
  const rel = (vals: any[]) => ({
    related: vals.map((v) => ({ get: () => v, typeOf: () => "number" })),
    targetType: "number",
  });
  const r = (fn: string) => ({ relation_property: "r", target_property: "t", function: fn });

  test("count sum average", () => {
    const c = rel([1, 2, 3, null]);
    expect(rollupValue(r("count"), c)).toBe(4);
    expect(rollupValue(r("sum"), c)).toBe(6);
    expect(rollupValue(r("average"), c)).toBe(2);
  });
  test("min max", () => {
    const c = rel([4, 9, 2]);
    expect(rollupValue(r("min"), c)).toBe(2);
    expect(rollupValue(r("max"), c)).toBe(9);
  });
  test("percent_checked", () => {
    expect(rollupValue(r("percent_checked"), rel([true, false, true, true]))).toBe(75);
  });
  test("unique", () => {
    expect(rollupValue(r("unique"), rel(["a", "b", "a"]))).toBe("a, b");
    expect(rollupValue(r("count_unique"), rel(["a", "b", "a"]))).toBe(2);
  });
});

describe("오류 처리", () => {
  test("잘못된 수식은 한국어 메시지를 돌려준다", () => {
    expect(formulaError("1 + (2")).toBeTruthy();
    expect(formulaError("1 + 2")).toBe(null);
  });
  test("평가는 절대 던지지 않는다", () => {
    for (const g of ["", "((", "foo(", "@@@", "1 / 0", '"abc', "nope(1)"]) {
      expect(run(g)).toBe(null);
    }
  });
});
