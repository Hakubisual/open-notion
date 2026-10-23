import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const model = readFileSync(join(ROOT, "assets/editor-model.js"), "utf8");
const chunk = readFileSync(join(ROOT, "assets/features/lazy/editor-next.js"), "utf8");
let pasteMd = "";

beforeAll(async () => {
  const built = await Bun.build({ entrypoints: [join(ROOT, "assets/features/lazy/paste-md.js")], minify: true, format: "iife" });
  if (!built.success) throw new AggregateError(built.logs);
  pasteMd = await built.outputs[0].text();
});

let browser: InstanceType<typeof Bun.WebView>;
beforeAll(async () => { browser = new Bun.WebView(); await browser.navigate("about:blank"); });
afterAll(async () => { await browser.close(); });

async function paste(plain: string, html = "") {
  return await browser.evaluate(`(async () => {
    document.body.innerHTML = '<div id="blocks"></div>';
    ${model}
    const els = { blocks: document.getElementById('blocks') };
    const state = { blocks: [{ id: 'b1', type: 'paragraph', text: '', checked: false, indent: 0, meta: null }], pages: [{ slug: 'home-notes', title: 'Home' }] };
    let n = 0, loads = 0;
    const apis = {};
    const render = () => { els.blocks.innerHTML = state.blocks.map(b => '<div class="blk" data-id="' + b.id + '"><div class="text" contenteditable="true"></div></div>').join(''); };
    window.AcardEditorNext = { on: true };
    window.AcardEditor = {
      provide: (name, api) => { apis[name] = api; }, on() { return () => {}; }, get state() { return state; }, slug: 'p', render, scheduleSave() {}, setSave() {},
      api: () => Promise.reject(Error('offline')), transport: () => Promise.reject(Error('offline')),
      lazy: (name) => { loads++; new Function(${JSON.stringify(pasteMd)})(); return Promise.resolve(apis[name]); },
      insertBlocksAfter(id, blocks) { const at = state.blocks.findIndex(b => b.id === id); const added = blocks.map(b => Object.assign({ id: 'n' + (++n), type: 'paragraph', text: '', checked: false, indent: 0, meta: null }, b)); state.blocks.splice(at + 1, 0, ...added); render(); return added.map(b => b.id); },
    };
    render();
    new Function(${JSON.stringify(chunk)})();
    apis['editor-next'].start();
    const text = els.blocks.querySelector('.text');
    text.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(plain)});
    if (${JSON.stringify(html)}) dt.setData('text/html', ${JSON.stringify(html)});
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    text.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 0));
    return { loads, blocks: state.blocks.filter(b => b.text || b.type !== 'paragraph').map(b => ({ type: b.type, text: b.text, meta: b.meta || null })) };
  })()`);
}

test("an Obsidian note pastes as heading, callout, bold text and a page link, without its front matter", async () => {
  const note = "---\ntags: [school]\n---\n# Week 1\n\n> [!warning] Exam\n> Bring a calculator.\n\nRead **chapter 3** before [[Home]].\n\n%%private%%\n- [x] done";
  const out = (await paste(note)) as any;
  expect(out.loads).toBe(1);
  expect(out.blocks.map((b: any) => b.type)).toEqual(["heading1", "callout", "paragraph", "to_do"]);
  expect(out.blocks[1].meta).toMatchObject({ tone: "warning" });
  const runs = out.blocks[2].meta.richText;
  expect(runs).toContainEqual({ text: "chapter 3", bold: true });
  expect(runs.find((r: any) => r.mention)).toMatchObject({ mention: { type: "page", slug: "home-notes" } });
  expect(JSON.stringify(out.blocks)).not.toMatch(/tags:|private|\[\[/);
});

test("a copied Notion callout pastes as a callout with its icon, and one plain line stays instant", async () => {
  const html = '<figure class="callout"><div><span class="icon">💡</span></div><div>Kickoff notes</div></figure>';
  const callout = (await paste("💡 Kickoff notes", html)) as any;
  expect(callout.blocks).toEqual([{ type: "callout", text: "Kickoff notes", meta: { tone: "note", icon: "💡" } }]);
  expect(callout.loads).toBe(0);
  const plain = (await paste("just one line")) as any;
  expect(plain.loads).toBe(0);
});

test("pasted script links never become links", async () => {
  const out = (await paste("**see** [x](javascript:alert(1)) and [y](https://example.com)")) as any;
  expect(JSON.stringify(out.blocks)).not.toContain("javascript:");
  expect(out.blocks[0].meta.richText).toContainEqual({ text: "y", href: "https://example.com" });
});
