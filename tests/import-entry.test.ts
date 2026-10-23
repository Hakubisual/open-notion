import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { DICTS, LANGS, injectAppLang, translateHtml } from "../gate/i18n";
import { cookie, setup } from "./db-harness";

const ROOT = join(import.meta.dir, "..");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const app = (l: string) => JSON.parse(read("assets/i18n/app-" + l + ".json")) as Record<string, string>;

const homeSource = read("assets/ui/home.js");
const homeFns = homeSource.slice(homeSource.indexOf("  function importHtml("), homeSource.indexOf("  async function render("));
const homeCtx = (extra: object) => ({ icon: () => "", esc: (s: string) => String(s), href: (s: string) => "/" + encodeURIComponent(s) + "/", localStorage: { getItem: () => "0" }, ...extra });
const homeTop = (checklist: any, local: any = null): string => runInNewContext(homeFns + "\nchecklistHtml(checklist, local) + importHtml(checklist)", homeCtx({ checklist, local }));

test("home: / serves the home script and the sidebar menu link; an empty workspace gets the checklist step and the import card", async () => {
  const h = setup();
  await h.call("GET", "/api/home/summary");
  h.sqlite.query("INSERT INTO pages (slug,title,kind,source,updated) VALUES ('index','Home','note','editor',1)").run();
  const page = await h.worker.fetch(new Request("https://notes.test/", { headers: { cookie: await cookie() } }), h.env);
  expect(page.status).toBe(200);
  const shell = await page.text();
  expect(shell).toContain('<script src="/lazy/ui-home-js.js?v=');
  expect(shell).toContain('<a role="menuitem" href="/import">노션·옵시디언에서 가져오기</a>');

  const summary = await h.call("GET", "/api/home/summary");
  expect(summary.data.checklist).toMatchObject({ page: false, import: false });
  const top = homeTop(summary.data.checklist);
  expect(top).toMatch(/data-step="import"[^>]*href="\/import">[^]*?<b>노션·옵시디언에서 가져오기<\/b><span>내보낸 zip이나 볼트 폴더를 올려요<\/span>/);
  expect(top).toContain('<section class="ui-card home-import" data-w="import">');
  expect(top).toContain("다른 앱에서 옮겨 오기</h2>");
  expect(top).toContain("노션이나 옵시디언에 있던 페이지를 그대로 가져와요.");
  expect(top).toContain('<a class="ui-btn ui-btn-primary" href="/import" data-home-import>가져오기</a>');

  const local = homeTop({ page: false, import: false }, { mcp: "http://127.0.0.1/mcp", mcpCopied: false, backupDone: false });
  expect(local).toMatch(/data-step="import"[^>]*href="\/import">[^]*?<b>노션·옵시디언 가져오기<\/b><span>노션 zip이나 옵시디언 볼트를 올려요<\/span>/);
});

test("home: the import card is gone once a page was written or an import happened, and for a missing checklist", () => {
  for (const c of [{ page: true, import: false }, { page: false, import: true }, { page: true, import: true }, {}]) {
    expect(homeTop(c)).not.toContain("data-home-import");
  }
  expect(runInNewContext(homeFns + "\nimportHtml(undefined)", homeCtx({}))).toBe("");
});

test("sidebar: the more menu links to /import with the Notion/Obsidian label", () => {
  const src = read("block-html.js");
  expect(src).toContain('<li><a role="menuitem" href="/import">노션·옵시디언에서 가져오기</a></li>');
  expect(src).not.toContain(">노션에서 가져오기<");
});

test("settings: an import section with an /import link sits right before my-data, as served in ko/en/zh", async () => {
  const src = read("assets/_site/settings.html");
  const at = src.indexOf('<section class="ai-usage" id="import">');
  const myData = src.indexOf('<section class="ai-usage" id="my-data">');
  expect(at).toBeGreaterThan(-1);
  expect(myData).toBeGreaterThan(at);
  expect(src.slice(at, myData).trim()).toBe('<section class="ai-usage" id="import"><h2>가져오기</h2><p class="hint">노션이나 옵시디언에서 페이지를 옮겨 와요. 링크·이미지·파일·데이터베이스가 같이 들어와요.</p><a class="btn btn-wide" href="/import">가져오기 열기</a></section>');
  for (const lang of LANGS) {
    const served = await injectAppLang(html(src), lang).text();
    expect(served).toContain('<a class="btn btn-wide" href="/import">가져오기 열기</a>');
  }
});

test("onboarding step 2: the import link is translated in en/ko/zh and the key set stays equal", async () => {
  const src = read("assets/_site/onboarding.html");
  const start = src.indexOf('<form class="onb-step" id="step2"');
  const step2 = src.slice(start, src.indexOf("</form>", start));
  expect(step2.indexOf('data-i18n="onb.import"')).toBeGreaterThan(step2.lastIndexOf('name="preset"'));
  for (const lang of LANGS) {
    expect(DICTS[lang]["onb.import"], lang).toBeTruthy();
    const served = await translateHtml(html(src), lang).text();
    expect(served).toContain('<a class="skip" id="import" href="/import" data-i18n="onb.import">' + DICTS[lang]["onb.import"] + "</a>");
  }
  expect(DICTS.en["onb.import"]).toBe("Coming from Notion or Obsidian? Import your pages");
  expect(DICTS.ko["onb.import"]).toBe("노션이나 옵시디언에서 오셨나요? 페이지 가져오기");
  expect(DICTS.zh["onb.import"]).toBe("从 Notion 或 Obsidian 过来？导入页面");
  expect(Object.keys(DICTS.ko).sort()).toEqual(Object.keys(DICTS.en).sort());
  expect(Object.keys(DICTS.zh).sort()).toEqual(Object.keys(DICTS.en).sort());
});

function fakeEl(): any {
  const listeners: Record<string, Function[]> = {};
  const el: any = {
    hidden: false, disabled: false, textContent: "", innerHTML: "", value: "", className: "", dataset: {}, style: {}, children: [],
    classList: { toggle() {}, add() {} }, setAttribute() {}, append() {}, appendChild(c: any) { el.children.push(c); },
    addEventListener: (t: string, f: Function) => { (listeners[t] ||= []).push(f); },
    fire: async (t: string, e: any = {}) => { for (const f of listeners[t] ?? []) await f(e); },
    querySelector: () => (el.child ??= fakeEl()), querySelectorAll: () => [],
  };
  return el;
}

async function runOnboarding(click: "skip" | "import") {
  const nodes: Record<string, any> = {};
  const calls: { url: string; body: any }[] = [];
  let assigned = "";
  let done!: () => void;
  const finished = new Promise<void>((r) => { done = r; });
  const fetch = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url === "/api/first-run" && body?.state === "waiting_connect") done();
    return { ok: true, status: 200, json: async () => (url === "/api/profile" ? { profile: { onboarded_at: null, home_layout: { widgets: [] } }, suggest: {} } : {}) };
  };
  const ctx: any = {
    document: { getElementById: (id: string) => (nodes[id] ??= fakeEl()), createElement: () => fakeEl(), hidden: false },
    location: { origin: "https://acard.test", search: "", assign: (u: string) => { assigned = u; done(); }, replace() {} },
    window: {}, fetch, navigator: {}, scrollTo() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    getSelection: () => ({ selectAllChildren() {} }), URLSearchParams, Blob, JSON, Promise,
  };
  runInNewContext(read("assets/_site/onboarding.js"), ctx, { filename: "onboarding.js" });
  let prevented = false;
  await nodes[click].fire("click", { preventDefault: () => { prevented = true; } });
  await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error("finish never moved on")), 1000))]);
  return { saves: calls.filter((c) => c.url === "/api/profile" && c.body), starter: calls.some((c) => c.url === "/api/home/starter"), assigned, prevented, step3Hidden: nodes.step3?.hidden };
}

test("onboarding: the import link finishes onboarding exactly like Skip, then goes to /import instead of step 3", async () => {
  const skip = await runOnboarding("skip");
  const imp = await runOnboarding("import");
  expect(imp.saves.map((c) => c.body)).toEqual(skip.saves.map((c) => c.body));
  expect(imp.saves.map((c) => c.body)).toEqual([{ home_layout: { widgets: [] }, finish: true }]);
  expect(imp.starter).toBe(false);
  expect(skip.assigned).toBe("");
  expect(skip.step3Hidden).toBe(false);
  expect(imp.prevented).toBe(true);
  expect(imp.assigned).toBe("/import");
  expect(imp.step3Hidden).not.toBe(false);
});

test("every new Korean entry string has natural en and zh text", () => {
  const en = app("en"), zh = app("zh");
  for (const k of ["노션·옵시디언에서 가져오기", "내보낸 zip이나 볼트 폴더를 올려요", "노션·옵시디언 가져오기", "노션 zip이나 옵시디언 볼트를 올려요",
    "다른 앱에서 옮겨 오기", "노션이나 옵시디언에 있던 페이지를 그대로 가져와요.", "가져오기",
    "노션이나 옵시디언에서 페이지를 옮겨 와요. 링크·이미지·파일·데이터베이스가 같이 들어와요.", "가져오기 열기"]) {
    expect(en[k], "en " + k).toBeTruthy();
    expect(zh[k], "zh " + k).toBeTruthy();
    expect(/[\uac00-\ud7a3]/.test(en[k] + zh[k]), k).toBe(false);
  }
});
