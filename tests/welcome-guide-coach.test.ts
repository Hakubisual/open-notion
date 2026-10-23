import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../assets/_site/welcome-guide.js", import.meta.url), "utf8");

function load(pathname: string, guide: unknown) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  let loaded: () => void = () => {};
  const win: any = {
    location: { pathname },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
    document: { readyState: "loading", querySelector: () => null, querySelectorAll: () => [], head: { append() {} }, body: { append() {}, dataset: {} }, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {} }), addEventListener() {} },
    fetch: async (url: string, init?: any) => { calls.push((init?.method ?? "GET") + " " + url); return { ok: true, json: async () => guide }; },
    addEventListener: (name: string, fn: () => void) => { if (name === "load") loaded = fn; },
    setTimeout: (fn: () => void) => fn(),
    innerWidth: 1440, innerHeight: 900,
    getComputedStyle: () => ({ visibility: "visible" }),
  };
  win.window = win;
  runInNewContext(source, win);
  return { win, store, calls, run: async () => { loaded(); await new Promise((r) => setTimeout(r, 0)); } };
}

test("a member without an active guide asks once, then stops asking for this tab", async () => {
  const off = load("/", { enabled: false, active: false });
  await off.run();
  expect(off.calls).toEqual(["GET /api/guide"]);
  expect(off.store.get("acard-guide-off")).toBe("1");
});

test("a skipped guide stays quiet but is not switched off for the tab, so 이어서 하기 can bring it back", async () => {
  const s = load("/", { enabled: true, active: true, skipped: true, done: false, steps: {}, count: 0 });
  await s.run();
  expect(s.store.get("acard-guide-off")).toBeUndefined();
});

test("the coach never runs on onboarding, settings or import", () => {
  for (const p of ["/onboarding", "/settings", "/import", "/settings/agents/"]) expect(typeof load(p, {}).win.AcardGuide).toBe("undefined");
});

test("step choice follows the real order and the screen the person is on", () => {
  const { chooseStep } = load("/", {}).win.AcardGuide;
  const steps = (done: string[]) => ({ steps: Object.fromEntries(["page", "slash", "search", "share"].map((k) => [k, done.includes(k)])) });
  expect(chooseStep(steps([]), "/", false)).toMatchObject({ step: "page", n: 1, title: "첫 페이지를 만들어 보세요" });
  expect(chooseStep(steps([]), "/", true).target).toBe("[data-new-page]");
  expect(chooseStep(steps(["page"]), "/edit/x/", false)).toMatchObject({ step: "slash", n: 2, target: "#blocks .blk .text" });
  expect(chooseStep(steps(["page"]), "/", false).title).toBe("새 페이지에서 / 를 눌러 보세요");
  expect(chooseStep(steps(["page", "slash"]), "/", true)).toMatchObject({ step: "search", body: "아래 검색을 눌러요" });
  expect(chooseStep(steps(["page", "slash", "search"]), "/p/", false)).toMatchObject({ step: "share", target: "#share" });
  expect(chooseStep(steps(["page", "slash", "search", "share"]), "/", false)).toBeNull();
});

test("on the signed-in landing it points new members and unfinished guides at 내 홈으로, and stays quiet otherwise", () => {
  const win = load("/", {}).win;
  win.ACARD_T = { "js.guide.k": "시작 가이드", "js.guide.newTitle": "내 홈으로 들어가 시작해요", "js.guide.newBody": "b", "js.guide.go": "내 홈으로", "js.guide.count": "시작 가이드 {n} / 4", "js.guide.resumeTitle": "내 홈에서 이어서 해요", "js.guide.resumeBody": "r", "js.guide.resume": "이어서 하기" };
  const { landingCopy } = win.AcardGuide;
  expect(landingCopy({ enabled: true, active: false }, true)).toMatchObject({ t: "내 홈으로 들어가 시작해요", go: "내 홈으로" });
  expect(landingCopy({ enabled: true, active: true, done: false, count: 2 }, false)).toMatchObject({ k: "시작 가이드 2 / 4", go: "이어서 하기" });
  expect(landingCopy({ enabled: true, active: false }, false)).toBeNull();
  expect(landingCopy({ enabled: true, active: true, done: true, count: 4 }, false)).toBeNull();
});

test("on a phone the coach sits under its target with a pointer, goes above when there is no room, and never covers the target or the 피드백 pill", () => {
  const { spot } = load("/", {}).win.AcardGuide;
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const fbt = rect(274, 537, 100, 32);
  const overlaps = (a: any, b: any) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const line = rect(26, 300, 338, 40);
  const below = spot(line, 340, 158, { w: 390, h: 844 }, [rect(274, 796, 100, 32)]);
  expect(below).toMatchObject({ side: "below", top: 352 });
  expect(below.px).toBeGreaterThan(0);
  for (const [target, vh] of [[rect(26, 351, 338, 40), 585], [rect(26, 420, 338, 40), 585]] as const) {
    const s = spot(target, 340, 158, { w: 390, h: vh }, [fbt]);
    expect(s.side).toBe("above");
    const box = rect(s.left, s.top, 340, 158);
    expect(overlaps(box, target)).toBe(false);
    expect(overlaps(box, fbt)).toBe(false);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(382);
  }
  const offscreen = spot(rect(26, 1200, 338, 40), 374, 158, { w: 390, h: 844 }, [rect(12, 756, 366, 64)]);
  expect(offscreen).toMatchObject({ side: "sheet", left: 8, top: 756 - 8 - 158 });
  expect(spot(null, 374, 158, { w: 390, h: 844 }, []).side).toBe("sheet");
});

test("the coach is non-modal and never presses publish", () => {
  expect(source).not.toContain("aria-modal");
  expect(source).not.toMatch(/data-publish/);
  expect(source).not.toMatch(/observe\(document(\.body|\.documentElement)?,/);
});
