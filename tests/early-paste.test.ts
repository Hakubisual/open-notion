import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// #108: on a new page, markdown pasted before the lazy editor-next chunk started went through the classic paste handler,
// which joins lines, and was saved as one paragraph. The classic handler now holds such a paste for the chunk.
const source = readFileSync(new URL("../assets/editor.js", import.meta.url), "utf8");
const model = readFileSync(new URL("../assets/editor-model.js", import.meta.url), "utf8");
const chunk = readFileSync(new URL("../assets/features/lazy/editor-next.js", import.meta.url), "utf8");
const listenerStart = source.indexOf('    text.addEventListener("paste"');
const listener = source.slice(listenerStart, source.indexOf("    });", listenerStart) + "    });".length);

async function pasteEarly(plain: string, html = "") {
  const browser = new Bun.WebView();
  try {
    await browser.navigate("about:blank");
    return await browser.evaluate(`(async () => {
      document.body.innerHTML = '<div id="blocks"></div>';
      ${model}
      const els = { blocks: document.getElementById('blocks') };
      const state = { blocks: [{ id: 'b1', type: 'paragraph', text: '', checked: false, indent: 0, meta: null }] };
      let n = 0, saves = 0, loaded = false;
      const newBlock = () => ({ id: 'n' + (++n), type: 'paragraph', text: '', checked: false, indent: 0, meta: null });
      const render = () => { els.blocks.innerHTML = state.blocks.map(b => '<div class="blk" data-id="' + b.id + '"><div class="text" contenteditable="true"></div></div>').join(''); els.blocks.querySelectorAll('.text').forEach((t, i) => t.textContent = state.blocks[i].text); };
      const scheduleSave = () => saves++;
      const focusBlock = id => els.blocks.querySelector('.blk[data-id="' + id + '"] .text').focus();
      const apis = {};
      // The chunk has not arrived when the paste lands (a cold new page); deliver() hands it over afterwards.
      let deliver, pending = null;
      const lazy = name => pending || (pending = new Promise(ok => { deliver = () => { loaded = true; new Function(${JSON.stringify(chunk)})(); ok(apis[name]); }; }));
      window.AcardEditorNext = { on: true };
      window.AcardEditor = { provide: (name, api) => { apis[name] = api; }, on() { return () => {}; }, get state() { return state; }, slug: 'p', render, scheduleSave, setSave() {},
        api: () => Promise.reject(Error('offline')), transport: () => Promise.reject(Error('offline')),
        insertBlocksAfter(id, blocks) { const at = state.blocks.findIndex(b => b.id === id); const added = blocks.map(b => Object.assign(newBlock(), b)); state.blocks.splice(EditorModel.endOf(state.blocks, at) , 0, ...added); render(); scheduleSave(); return added.map(b => b.id); } };
      render();
      const text = els.blocks.querySelector('.text'), block = state.blocks[0];
      text.addEventListener('input', () => { block.text = text.textContent; scheduleSave(); });
      ${listener}
      text.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(plain)});
      if (${JSON.stringify(html)}) dt.setData('text/html', ${JSON.stringify(html)});
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      text.dispatchEvent(ev);
      const before = { loaded, blocks: state.blocks.length, text: state.blocks[0].text };
      if (pending) { deliver(); await pending; await Promise.resolve(); }
      return { prevented: ev.defaultPrevented, before, started: !!window.AcardEditorNext.started, blocks: state.blocks.map(b => b.type + ':' + b.text), saved: saves > 0 };
    })()`);
  } finally { await browser.close(); }
}

test("markdown pasted before editor-next starts is split into blocks once it starts", async () => {
  expect(await pasteEarly("## 회의 메모\n\n- 첫째\n- 둘째")).toEqual({
    prevented: true, before: { loaded: false, blocks: 1, text: "" }, started: true,
    blocks: ["heading2:회의 메모", "bulleted:첫째", "bulleted:둘째"], saved: true,
  });
}, 20000);

test("a one-line paste before editor-next starts is inserted right away", async () => {
  expect(await pasteEarly("한 줄")).toMatchObject({ prevented: true, before: { loaded: false, blocks: 1, text: "한 줄" }, started: false, blocks: ["paragraph:한 줄"] });
}, 20000);
