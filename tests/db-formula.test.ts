import { describe, expect, test } from "bun:test";
import { evaluateFormula, formulaError, rollupValue } from "../db-formula.js";

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
