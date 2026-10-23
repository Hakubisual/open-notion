import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// GitHub #120 item 1: a failed button press shows the server's reason as text right after the button, not only as a
// hover tooltip (a phone has no hover). Runs the shipped chunk in a real WebView with fetch stubbed to fail.
const chunk = readFileSync(new URL("../assets/features/lazy/buttons.js", import.meta.url), "utf8");
let view: InstanceType<typeof Bun.WebView>;

beforeAll(async () => {
  view = new Bun.WebView({ width: 390, height: 700 });
  await view.navigate("about:blank");
  await view.evaluate(`(() => {
    window.calls = [];
    window.clock = 1000000;
    Date.now = () => window.clock;
    window.fetch = (url, init) => { calls.push({ url, method: init && init.method }); return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "테스트 이유" }) }); };
    ${chunk}
    document.body.innerHTML = '<div class="blocks"><p><button class="btn act" data-button="go">실행</button></p></div>';
    window.pressAndSettle = async () => {
      document.querySelector('button[data-button="go"]').click();
      for (let i = 0; i < 20 && document.querySelector('button[data-button="go"]').dataset.busy; i++) await new Promise((r) => setTimeout(r, 0));
    };
    window.snap = () => { const b = document.querySelector('button[data-button="go"]'); const why = b.nextElementSibling; return { title: b.title, failed: b.classList.contains('btn-failed'), busy: !!b.dataset.busy, spans: document.querySelectorAll('.btn-why').length, role: why && why.getAttribute('role'), cls: why && why.className, text: why && why.textContent, scrollW: document.documentElement.scrollWidth, innerW: innerWidth }; };
  })()`);
});
afterAll(() => view?.close());

const json = async (expr: string) => JSON.parse(await view.evaluate(`JSON.stringify(${expr})`) as string);

test("a 403 with {error} puts the reason in a [role=status].btn-why right after the button, and a second failure reuses it", async () => {
  await view.evaluate("pressAndSettle()");
  expect(await json("calls")).toEqual([{ url: "/api/page/blank/button/go", method: "POST" }]);
  const first = await json("snap()");
  expect(first).toMatchObject({ title: "테스트 이유", failed: true, busy: false, spans: 1, role: "status", cls: "btn-why", text: "테스트 이유" });
  expect(first.scrollW).toBeLessThanOrEqual(first.innerW);

  await view.evaluate("clock += 1500");
  await view.evaluate("pressAndSettle()");
  expect(await json("calls.length")).toBe(2);
  expect(await json("snap()")).toMatchObject({ failed: true, spans: 1, role: "status", text: "테스트 이유" });
});

test("the reason and the btn-failed class go away together after 4000 ms", async () => {
  // The 4000 ms hide is the behavior under test; record the delay and fire that timer on the next tick instead of waiting.
  await view.evaluate(`(() => { window.__t = setTimeout; window.timers = []; window.setTimeout = (fn, ms) => { timers.push(ms); return __t(fn, ms >= 4000 ? 0 : ms); }; })()`);
  await view.evaluate("clock += 1500");
  await view.evaluate("pressAndSettle()");
  expect(await json("timers.filter((ms) => ms === 4000).length")).toBe(1);
  await view.evaluate("new Promise((r) => __t(r, 0))");
  expect(await json("snap()")).toMatchObject({ failed: false, spans: 0, cls: null, text: null, title: "테스트 이유" });
});
