import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// #38 stage 2: the 부품으로 등록 dialog (lazy part-register) registers an HTML block as a workspace part through
// POST /api/parts, keeps its input and shows the server's sentence on an error, and on 201 turns the block into a part
// block. Runs the shipped chunk in a real WebView with a stubbed editor and fetch.
const chunk = readFileSync(new URL("../assets/features/lazy/part-register.js", import.meta.url), "utf8");
const CODE = '<div class="card"><h3>주간 판매 현황</h3><p id="t"></p></div><script>document.getElementById("t").textContent = (window.acardPartData || {}).title</script>';
let view: InstanceType<typeof Bun.WebView>;

beforeAll(async () => {
  view = new Bun.WebView({ width: 1000, height: 900 });
  await view.navigate("about:blank");
  await view.evaluate(`(() => {
    window.calls = []; window.renders = 0; window.saves = 0; window.reloads = 0; window.next = null;
    window.AcardEditor = {
      slug: 'sales', state: { blocks: [] },
      provide(name, api) { window[name === 'parts' ? 'parts' : 'reg'] = api; },
      lazy(name) { return name === 'parts' ? Promise.resolve({ reload() { reloads++; return Promise.resolve(); } }) : Promise.reject(new Error('none')); },
      render() { renders++; }, scheduleSave() { saves++; },
      api(path, opts) {
        calls.push({ path, method: opts && opts.method, body: JSON.parse(opts.body) });
        const r = window.next; window.next = null;
        return r.status < 300 ? Promise.resolve(r.body) : Promise.reject(new Error(r.body.error || String(r.status)));
      }
    };
    ${chunk}
    window.block = { id: 'b1', type: 'html', text: ${JSON.stringify(CODE)}, checked: false, indent: 0, meta: null };
    window.AcardEditor.state.blocks = [block];
    window.type = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
    window.q = (selector) => document.querySelector(selector);
  })()`);
});
afterAll(() => view?.close());

const json = async (expr: string) => JSON.parse(await view.evaluate(`JSON.stringify(${expr})`) as string);

test("opens with the name from the block's heading, the id as its slug, the field the code reads, and a sandboxed preview", async () => {
  await view.evaluate("reg.open(block, 0)");
  expect(await json("[q('.pr-dialog').open, q('#pr-name').value, q('#pr-id').value, document.activeElement.id]")).toEqual([true, "주간 판매 현황", expect.stringMatching(/^part-[a-z]{6}$/), "pr-name"]);
  expect(await json("[...document.querySelectorAll('.pr-field')].map(li => [li.querySelector('.pr-field-name').textContent, li.querySelector('.pr-chip').textContent])")).toEqual([["title", "글자"]]);
  expect(await json("JSON.parse(q('.pr-json-in').value)")).toEqual({ title: "" });
  expect(await json("[q('.pr-frame iframe').getAttribute('sandbox'), q('.pr-frame iframe').srcdoc.includes('acardPartData'), q('.pr-frame iframe').srcdoc.includes('주간 판매 현황')]")).toEqual(["allow-scripts", true, true]);
  expect(await json("[q('#pr-replace').checked, q('.pr-sub').textContent, q('.pr-note').textContent]")).toEqual([true, "이 블록을 재사용 가능한 부품으로 등록합니다.", "부품 코드는 격리된 칸에서만 실행돼요. 외부에 영향을 주지 않아 안전합니다."]);
  await view.evaluate("type('#pr-name', 'Weekly Sales Card')");
  expect(await json("q('#pr-id').value")).toBe("weekly-sales-card");
  await view.evaluate(`type('.pr-json-in', '{"title": "x", "count": 3}')`);
  expect(await json("[...document.querySelectorAll('.pr-chip')].map(c => c.textContent)")).toEqual(["글자", "숫자"]);
});

test("a 409 keeps the dialog and every value, shows the server's sentence and focuses 주소 이름; a 201 turns the block into the part", async () => {
  await view.evaluate(`type('#pr-desc', '주간 매출 카드'), type('#pr-id', 'weekly')`);
  await view.evaluate(`window.next = { status: 409, body: { error: '다른 사람이 등록한 부품 id 예요.' } }`);
  const settled = view.evaluate(`new Promise(r => { const o = new MutationObserver(() => { if (q('.pr-alert').textContent) { o.disconnect(); r(1); } }); o.observe(q('.pr-alert'), { childList: true, characterData: true, subtree: true }); q('#pr-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })`);
  await settled;
  expect(await json("[q('.pr-alert').textContent, q('.pr-dialog').open, q('#pr-name').value, q('#pr-desc').value, q('#pr-id').value, document.activeElement.id, q('.pr-submit').disabled]"))
    .toEqual(["다른 사람이 등록한 부품 id 예요.", true, "Weekly Sales Card", "주간 매출 카드", "weekly", "pr-id", false]);
  expect(await json("[calls.length, calls[0].method, calls[0].path, calls[0].body, block.type]")).toEqual([1, "POST", "/parts", { id: "weekly", name: "Weekly Sales Card", description: "주간 매출 카드", page: "sales", block: "b1", sample: { title: "x", count: 3 } }, "html"]);

  await view.evaluate(`window.next = { status: 201, body: { id: 'weekly', name: 'Weekly Sales Card', version: 1 } }`);
  const closed = view.evaluate(`new Promise(r => { q('.pr-dialog').addEventListener('close', () => r(1), { once: true }); q('.pr-submit').click(); })`);
  await closed;
  expect(await json("[block.type, block.meta, JSON.parse(block.text), renders, saves, reloads, q('.pr-dialog').open, q('#pr-toast').textContent, q('#pr-toast').hidden]"))
    .toEqual(["part", { part: "weekly", v: 1 }, { title: "x", count: 3 }, 1, 1, 1, false, "부품으로 등록했어요", false]);
});

test("Esc / 취소 close without a request; the checkbox off leaves the block as it is", async () => {
  await view.evaluate("(() => { window.block = { id: 'b2', type: 'html', text: '<p>plain</p>', checked: false, indent: 0, meta: null }; reg.open(block, 0); })()");
  expect(await json("[q('#pr-name').value, q('.pr-empty') !== null]")).toEqual(["새 부품", true]);
  await view.evaluate("q('.pr-cancel').click()");
  expect(await json("[q('.pr-dialog').open, calls.length]")).toEqual([false, 2]);
  await view.evaluate("(() => { reg.open(block, 0); q('#pr-replace').checked = false; window.next = { status: 201, body: { id: 'plain', version: 2 } }; })()");
  const closed = view.evaluate(`new Promise(r => { q('.pr-dialog').addEventListener('close', () => r(1), { once: true }); q('.pr-submit').click(); })`);
  await closed;
  expect(await json("[block.type, block.text, calls[2].body.id, renders]")).toEqual(["html", "<p>plain</p>", expect.stringMatching(/^part-[a-z]{6}$/), 1]);
});
