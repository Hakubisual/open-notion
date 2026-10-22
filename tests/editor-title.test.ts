import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/editor.js", import.meta.url), "utf8");
const titleEvents = source.slice(source.indexOf('  els.title.addEventListener("input"'), source.indexOf('  document.getElementById("add-block").addEventListener'));
const next = readFileSync(new URL("../assets/features/editor-next.js", import.meta.url), "utf8");

for (const mode of ["classic", "next"]) test(mode + ": title Enter and end ArrowDown enter the body, preserving IME and title saving", async () => {
  const browser = new Bun.WebView();
  try {
    await browser.navigate("about:blank");
    await browser.evaluate(`(() => {
      document.body.innerHTML = '<input id="title"><div id="blocks"></div>';
      window.els = { title: document.getElementById('title'), blocks: document.getElementById('blocks') };
      window.state = { title: '', blocks: [] };
      window.saves = 0;
      window.scheduleSave = () => saves++;
      window.newBlock = () => ({ id: 'new', type: 'paragraph', text: '' });
      window.render = () => { els.blocks.innerHTML = state.blocks.map(b => b.type === 'divider' ? '<hr>' : '<div class="text" contenteditable="true">' + b.text + '</div>').join(''); };
      ${titleEvents}
      window.AcardEditor = { on() {} };
      new Function('window', 'document', 'localStorage', 'location', ${JSON.stringify(next)})(window, document, {getItem: () => ${JSON.stringify(mode)}}, {search:''});
      window.press = (key, options = {}) => {
        const event = new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true, ...options});
        els.title.dispatchEvent(event);
        return { prevented:event.defaultPrevented, body:els.blocks.contains(document.activeElement), offset:getSelection().anchorOffset };
      };
    })()`);
    for (const options of [{}, { shiftKey: true }]) {
      const result = await browser.evaluate(`(() => {
        state.blocks = [{id:'first',type:'paragraph',text:'existing'}]; render();
        els.title.value = 'A title'; els.title.focus(); els.title.dispatchEvent(new Event('input'));
        const before = saves, moved = press('Enter', ${JSON.stringify(options)});
        document.execCommand('insertText', false, 'Body ');
        return {moved, title:state.title, value:els.title.value, text:els.blocks.textContent, saved:before > 0};
      })()`);
      expect(result).toEqual({ moved: { prevented: true, body: true, offset: 0 }, title: "A title", value: "A title", text: "Body existing", saved: true });
    }
    for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(await browser.evaluate(`(() => { els.title.focus(); return press('Enter', ${JSON.stringify(options)}); })()`)).toMatchObject({ prevented: false, body: false });
    }
    expect(await browser.evaluate("(() => { els.title.focus(); els.title.setSelectionRange(2,2); return press('ArrowDown'); })()")).toMatchObject({ prevented: false, body: false });
    expect(await browser.evaluate("(() => { els.title.setSelectionRange(0,els.title.value.length); return press('ArrowDown'); })()")).toMatchObject({ prevented: false, body: false });
    expect(await browser.evaluate("(() => { els.title.setSelectionRange(7,7); return press('ArrowDown'); })()")).toEqual({ prevented: true, body: true, offset: 0 });
    for (const blocks of [[], [{ id: "rule", type: "divider", text: "" }]]) {
      expect(await browser.evaluate(`(() => {
        state.blocks = ${JSON.stringify(blocks)}; render(); els.title.focus();
        const before = saves, moved = press('Enter');
        return {moved, block:state.blocks[0], saved:saves > before};
      })()`)).toEqual({ moved: { prevented: true, body: true, offset: 0 }, block: { id: "new", type: "paragraph", text: "" }, saved: true });
    }
  } finally { await browser.close(); }
}, 15000);

// Live #80 QA: editor.html focuses a ?create title before editor.js runs, so the first Enter landed with no handler and the
// next words were typed into the title. The inline script now holds that Enter and editor.js finishes it on start.
test("an Enter pressed before editor.js loads still moves a new page's title to the body", async () => {
  const html = readFileSync(new URL("../assets/editor.html", import.meta.url), "utf8");
  const inline = /<input id="title"[^>]*>\s*<script>([\s\S]*?)<\/script>\s*<script>([\s\S]*?)<\/script>/.exec(html)!.slice(1).join(";");
  const fresh = source.slice(source.indexOf("  if (fresh) {\n".replace(/\n/g, source.includes("\r\n") ? "\r\n" : "\n")), source.indexOf("  loadTree();", source.indexOf("  if (fresh) {")));
  const browser = new Bun.WebView();
  try {
    await browser.navigate("about:blank");
    expect(await browser.evaluate(`(() => {
      document.body.innerHTML = '<input id="title" aria-busy="true" readonly><div id="blocks"></div>';
      new Function(${JSON.stringify(inline.replace("location.search", "'?new&create'"))})();
      const t = document.getElementById('title');
      t.value = '빠른 제목';
      const early = new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true});
      t.dispatchEvent(early);
      window.els = { title: t, blocks: document.getElementById('blocks') };
      window.state = { title: '', blocks: [] };
      window.saves = 0;
      window.scheduleSave = () => saves++;
      window.newBlock = () => ({ id: 'new', type: 'paragraph', text: '' });
      window.render = () => { els.blocks.innerHTML = state.blocks.map(b => '<div class="text" contenteditable="true">' + b.text + '</div>').join(''); };
      ${titleEvents}
      const fresh = true;
      ${fresh}
      document.execCommand('insertText', false, '본문');
      return { early: early.defaultPrevented, title: t.value, body: els.blocks.textContent, inBody: els.blocks.contains(document.activeElement), pending: 'enterPending' in t.dataset };
    })()`)).toEqual({ early: true, title: "빠른 제목", body: "본문", inBody: true, pending: false });
  } finally { await browser.close(); }
}, 15000);
