import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PART_DEFAULTS } from "../part-html.js";

// #38 stage 2: the 부품 갤러리 dialog (lazy part-gallery) lists the defaults and the workspace's parts, searches them,
// renames through PATCH (showing the server's sentence on a refusal) and inserts the picked part. Runs the shipped
// chunk with the built parts chunk in a real WebView; the editor API is a stub that records calls.
const chunk = readFileSync(new URL("../assets/features/lazy/part-gallery.js", import.meta.url), "utf8");
const partsChunk = readFileSync(new URL("../assets/features/lazy/parts.js", import.meta.url), "utf8");
const DENIED = "다른 사람이 등록한 부품이에요. 만든 사람만 바꾸거나 지울 수 있어요.";
const mine = { id: "weekly-card", name: "주간 판매 카드", description: "우리 팀 판매 현황 - registered from an HTML block (sales). Its script reads window.acardPartData.", version: 2, builtin: false, owner: "a@b.c", shared: false, public: false, schema: {}, sample: { title: "4월" }, fence: "" };
const builtin: Record<string, unknown>[] = PART_DEFAULTS.map((p) => ({ id: p.id, name: p.name, version: p.version, builtin: true, description: p.description, schema: p.schema, sample: p.sample, fence: "" }));
let view: InstanceType<typeof Bun.WebView>;

beforeAll(async () => {
  view = new Bun.WebView({ width: 1100, height: 900 });
  await view.navigate("about:blank");
  await view.evaluate(`(() => {
    window.calls = [];
    window.responses = {};
    window.listBody = { parts: ${JSON.stringify(builtin.concat([mine]))}, themes: [] };
    const provided = {};
    window.AcardEditor = {
      state: { blocks: [{ id: "b1", type: "paragraph", text: "" }, { id: "b2", type: "paragraph", text: "" }] },
      renders: 0, saves: 0,
      render() { this.renders++; }, scheduleSave() { this.saves++; },
      provide(name, api) { provided[name] = api; },
      lazy(name) { return provided[name] ? Promise.resolve(provided[name]) : Promise.reject(new Error("no " + name)); },
      api(path, opts) {
        const method = (opts && opts.method) || "GET", key = method + " " + path;
        calls.push({ method, path, body: opts && opts.body ? JSON.parse(opts.body) : null });
        const canned = responses[key];
        if (canned) return canned.status >= 400 ? Promise.reject(new Error(canned.body.error)) : Promise.resolve(canned.body);
        if (key === "GET /parts") return Promise.resolve(listBody);
        return Promise.reject(new Error("stub: " + key));
      }
    };
    ${partsChunk}
    ${chunk}
    window.gallery = provided["part-gallery"];
    window.openGallery = (index) => gallery.open(index);
    window.type = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); };
    window.names = (sel) => Array.from(document.querySelectorAll(sel + " .pg-card:not([hidden]) .pg-name")).map((n) => n.textContent);
    window.menuItem = (text) => Array.from(document.querySelectorAll(".pg-menu-item")).find((b) => b.textContent === text);
    window.settled = (check) => new Promise((resolve, reject) => {
      if (check()) return resolve("ok");
      const timer = setTimeout(() => { mo.disconnect(); reject(new Error("timeout")); }, 3000);
      const mo = new MutationObserver(() => { if (check()) { clearTimeout(timer); mo.disconnect(); resolve("ok"); } });
      mo.observe(document.querySelector(".pg"), { subtree: true, childList: true, attributes: true, characterData: true });
    });
  })()`);
});
afterAll(() => view?.close());

const json = async (expr: string) => JSON.parse(await view.evaluate(`JSON.stringify(${expr})`) as string);
const open = (index: number) => view.evaluate(`openGallery(${index}).then(() => "ok")`);
// close() fires its close event as a queued task; wait for it so the next open never races the dialog's close handler.
const close = () => view.evaluate(`new Promise((r) => { const d = document.querySelector('.pg'); d.addEventListener('close', () => r('closed'), { once: true }); d.close(); })`);

test("both groups render with the defaults and the owned part, search keeps only the heatmap card", async () => {
  await view.evaluate("(calls.length = 0, responses = {})");
  expect(await open(0)).toBe("ok");
  expect(await json("[document.querySelector('.pg').open, document.activeElement.className]")).toEqual([true, "pg-search"]);
  expect(await json("names('.pg-builtin')")).toEqual(["상태 카드", "표 (합계 자동)", "차트 (막대·선)", "히트맵 (열지도)", "흐름도 (DAG)"]);
  expect(await json("names('.pg-mine')")).toEqual(["주간 판매 카드"]);
  expect(await json("[document.querySelector('.pg-mine .pg-chip').textContent, !!document.querySelector('.pg-mine .pg-more'), !!document.querySelector('.pg-builtin .pg-more')]")).toEqual(["v2", true, false]);
  expect(await json("document.querySelector('.pg-mine .pg-desc').textContent")).toBe("우리 팀 판매 현황");
  // The first card is selected and previewed through the parts chunk's live preview.
  expect(await json("[document.querySelector('.pg-card.sel').dataset.id, !!document.querySelector('.pg-preview iframe.acp-frame'), document.querySelector('.pg-title').textContent]")).toEqual(["badge", true, "상태 카드"]);
  await view.evaluate(`type('.pg-search', '히트')`);
  expect(await json("names('.pg')")).toEqual(["히트맵 (열지도)"]);
  expect(await json("[document.querySelector('.pg-mine').hidden, document.querySelector('.pg-card.sel').dataset.id]")).toEqual([true, "heatmap"]);
  await view.evaluate(`type('.pg-search', 'DAG')`);
  expect(await json("names('.pg')")).toEqual(["흐름도 (DAG)"]);
  await view.evaluate(`type('.pg-search', 'zzz')`);
  expect(await json("[names('.pg').length, document.querySelector('.pg-none').hidden]")).toEqual([0, false]);
  await view.evaluate(`type('.pg-search', '')`);
  expect(await json("names('.pg').length")).toBe(6);
});

test("··· → 이름·설명 바꾸기 → 저장 sends PATCH and shows the server's 403 sentence in the alert line", async () => {
  await view.evaluate(`(calls.length = 0, responses = { "PATCH /parts/weekly-card": { status: 403, body: { error: ${JSON.stringify(DENIED)} } } })`);
  await view.evaluate(`document.querySelector('.pg-mine .pg-more').click()`);
  expect(await json("Array.from(document.querySelectorAll('.pg-menu-item')).map(b => b.textContent)")).toEqual(["이름·설명 바꾸기", "링크 공유", "삭제"]);
  expect(await json("document.querySelector('.pg-menu-item.pg-danger').textContent")).toBe("삭제");
  await view.evaluate(`menuItem('이름·설명 바꾸기').click()`);
  expect(await json("[document.querySelector('.pg-card.sel').dataset.id, document.querySelectorAll('.pg-edit input').length, document.activeElement.value]")).toEqual(["weekly-card", 2, "주간 판매 카드"]);
  await view.evaluate(`(type('.pg-edit .pg-in', '주간 카드'), document.querySelector('.pg-edit .pg-primary').click())`);
  expect(await view.evaluate(`settled(() => !document.querySelector('.pg-alert').hidden)`)).toBe("ok");
  expect(await json("calls.filter(c => c.method === 'PATCH')")).toEqual([{ method: "PATCH", path: "/parts/weekly-card", body: { name: "주간 카드", description: "우리 팀 판매 현황" } }]);
  expect(await json("[document.querySelector('.pg-alert').getAttribute('role'), document.querySelector('.pg-alert').textContent, document.querySelector('.pg').open, !!document.querySelector('.pg-edit')]")).toEqual(["alert", DENIED, true, true]);
  expect(await json("document.querySelector('.pg-mine .pg-name').textContent")).toBe("주간 판매 카드");
  // A 200 updates the card in place.
  await view.evaluate(`(responses = { "PATCH /parts/weekly-card": { status: 200, body: { ...${JSON.stringify(mine)}, name: "주간 카드", description: "새 설명" } } }, document.querySelector('.pg-edit .pg-primary').click())`);
  expect(await view.evaluate(`settled(() => !document.querySelector('.pg-edit'))`)).toBe("ok");
  expect(await json("[document.querySelector('.pg-mine .pg-name').textContent, document.querySelector('.pg-mine .pg-desc').textContent, document.querySelector('.pg-title').textContent]")).toEqual(["주간 카드", "새 설명", "주간 카드"]);
  expect(await close()).toBe("closed");
});

test("an empty workspace list shows the empty sentence and its hint; Esc closes an open menu before the dialog", async () => {
  await view.evaluate(`(listBody = { parts: ${JSON.stringify(builtin)}, themes: [] }, responses = {})`);
  expect(await open(0)).toBe("ok");
  expect(await json("[document.querySelector('.pg-mine').hidden, document.querySelector('.pg-empty-main').textContent, document.querySelector('.pg-empty-hint').textContent]"))
    .toEqual([false, "아직 등록한 부품이 없어요.", "HTML 블록 메뉴에서 '부품으로 등록'을 누르면 여기에 모여요."]);
  await view.evaluate(`listBody = { parts: ${JSON.stringify(builtin.concat([mine]))}, themes: [] }`);
  expect(await close()).toBe("closed");
  expect(await open(0)).toBe("ok");
  await view.evaluate(`document.querySelector('.pg-mine .pg-more').click()`);
  const esc = () => view.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  expect(await json("!!document.querySelector('.pg-menu')")).toBe(true);
  await esc();
  expect(await json("[!!document.querySelector('.pg-menu'), document.querySelector('.pg').open, document.activeElement.className]")).toEqual([false, true, "pg-more"]);
  await esc();
  expect(await json("document.querySelector('.pg').open")).toBe(false);
});

test("arrow keys move between cards, Enter selects, and 이 부품 넣기 adds a part block with the selected id after the index", async () => {
  expect(await open(0)).toBe("ok");
  await view.evaluate(`document.querySelector('.pg-card.sel .pg-pick').focus()`);
  const key = (k: string) => view.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
  await key("ArrowRight"); await key("ArrowRight");
  expect(await json("document.activeElement.closest('.pg-card').dataset.id")).toBe("chart");
  await view.evaluate(`document.activeElement.click()`);
  expect(await json("[document.querySelector('.pg-card.sel').dataset.id, document.querySelector('.pg-title').textContent]")).toEqual(["chart", "차트 (막대·선)"]);
  await key("ArrowDown");
  expect(await json("document.activeElement.closest('.pg-card').dataset.id")).not.toBe("chart");
  await key("ArrowUp");
  expect(await json("document.activeElement.closest('.pg-card').dataset.id")).toBe("chart");
  await view.evaluate(`document.querySelector('.pg-use').click()`);
  const blocks = await json("AcardEditor.state.blocks");
  expect(blocks.length).toBe(3);
  expect(blocks[1]).toMatchObject({ type: "part", meta: { part: "chart", v: 1 } });
  expect(JSON.parse(blocks[1].text)).toEqual(PART_DEFAULTS.find((p) => p.id === "chart")!.sample);
  expect(await json("[document.querySelector('.pg').open, AcardEditor.renders > 0, AcardEditor.saves > 0]")).toEqual([false, true, true]);
});
