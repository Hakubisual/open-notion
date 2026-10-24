import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/editor.js", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("../assets/editor-model.js", import.meta.url), "utf8");
const cut = (from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const undo = cut("  var undoStack = [],", "  function save() {");
const wire = cut("  function wireText(", "  // The next block in the given direction");
const near = cut("  function nearText(", "  function columnTemplate(");
const focus = cut("  function focusBlock(", "  function dbRefBlock(");
const moves = cut("  function duplicate(index)", "  function indent(index, delta)");

let browser: Bun.WebView;
beforeAll(async () => {
  browser = new Bun.WebView();
  await browser.navigate("about:blank");
  await browser.evaluate(`(() => {
    ${modelSource}
    document.body.innerHTML = '<div id="blocks"></div>';
    window.model = EditorModel;
    window.els = { blocks: document.getElementById('blocks'), slash: { hidden: true } };
    window.cm = { columnOf: () => null, canIndent: () => true };
    window.slashes = 0;
    window.openSlash = () => slashes++;
    window.hideSlash = () => {};
    window.loadEasy = () => Promise.resolve();
    window.subpagesOf = () => []; window.syncSubpages = () => {};
    window.paintTocs = () => {}; window.emitFeature = () => {}; window.setSave = () => {};
    window.save = () => Promise.resolve();
    window.palettes = [];
    window.humanEdit = () => document.documentElement.getAttribute('data-human-edit') === 'on';
    window.lazy = (name) => { if (name === 'tab-palette') return Promise.resolve({ open: (id) => palettes.push(id) }); return Promise.reject(new Error(name)); };
    window.easy = null; window.formatContext = null; window.slashIndex = -1; window.startupEdited = false;
    let n = 0;
    window.uid = () => 'c' + (++n);
    window.newBlock = (type) => ({ id: uid(), type: type || 'paragraph', text: '', checked: false, indent: 0, meta: null });
    window.render = () => {
      els.blocks.innerHTML = '';
      state.blocks.forEach((block, index) => {
        const row = document.createElement('div'); row.className = 'blk'; row.dataset.id = block.id;
        const text = document.createElement('div'); text.className = 'text'; text.contentEditable = 'true'; text.textContent = block.text;
        row.appendChild(text); els.blocks.appendChild(row); wireText(text, block, row, index);
      });
    };
    let saveTimer = null, hasToc = false;
    ${undo}${wire}${near}${focus}${moves}
    window.wireText = wireText; window.restoreEdit = restoreEdit; window.undoStack = undoStack; window.redoStack = redoStack;
    window.reset = () => {
      window.state = { title: 'T', blocks: [
        { id: 'a', type: 'paragraph', text: 'one', indent: 0, meta: null },
        { id: 'b', type: 'to_do', text: 'two', indent: 0, meta: null, checked: true },
        { id: 'b1', type: 'paragraph', text: 'child', indent: 1, meta: null },
        { id: 'c', type: 'heading2', text: 'three', indent: 0, meta: null }
      ] };
      undoStack.length = 0; previousSnapshot = snapshot(); render();
    };
    window.press = (id, init) => {
      const text = els.blocks.querySelector('[data-id="' + id + '"] .text');
      text.focus();
      const ev = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init));
      text.dispatchEvent(ev);
      clearTimeout(saveTimer);
      return ev.defaultPrevented;
    };
    window.view = () => ({
      ids: state.blocks.map(b => b.id), indents: state.blocks.map(b => b.indent),
      focused: document.activeElement && document.activeElement.closest('.blk') ? document.activeElement.closest('.blk').dataset.id : null
    });
  })()`);
});
afterAll(() => browser.close());

test("Enter, Backspace and input shortcuts do nothing while an IME composition is in progress", async () => {
  expect(await browser.evaluate(`(() => {
    reset();
    const prevented = press('a', { key: 'Enter', isComposing: true, keyCode: 229 });
    const after229 = press('a', { key: 'Enter', keyCode: 229 });
    const enter = state.blocks.length;
    reset(); state.blocks[0].text = ''; render();
    const back = press('a', { key: 'Backspace', isComposing: true, keyCode: 229 });
    const backspace = state.blocks.length;
    reset();
    const text = els.blocks.querySelector('[data-id="a"] .text');
    text.textContent = '/';
    text.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    return { prevented, after229, enter, back, backspace, slashes };
  })()`)).toEqual({ prevented: false, after229: false, enter: 4, back: false, backspace: 4, slashes: 0 });
});

test("Tab on an empty top-level line opens the feature palette; list items and lines with text still indent (acard-human-edit)", async () => {
  expect(await browser.evaluate(`(async () => {
    reset(); palettes.length = 0;
    document.documentElement.removeAttribute('data-human-edit');
    state.blocks.push({ id: 'off', type: 'paragraph', text: '', indent: 0, meta: null }); render();
    press('off', { key: 'Tab' });
    await Promise.resolve(); await Promise.resolve();
    const flagOff = { palettes: palettes.length, indent: state.blocks.find(b => b.id === 'off').indent };
    reset(); palettes.length = 0;
    document.documentElement.setAttribute('data-human-edit', 'on');
    state.blocks.push({ id: 'e', type: 'paragraph', text: '', indent: 0, meta: null }, { id: 'l', type: 'bulleted', text: '', indent: 0, meta: null });
    render();
    const emptyLine = press('e', { key: 'Tab' });
    await Promise.resolve(); await Promise.resolve();
    const opened = palettes.slice();
    const indentsAfterPalette = view().indents;
    press('l', { key: 'Tab' });
    const listIndent = state.blocks.find(b => b.id === 'l').indent;
    press('c', { key: 'Tab' });
    const textIndent = state.blocks.find(b => b.id === 'c').indent;
    const composing = press('e', { key: 'Tab', isComposing: true, keyCode: 229 });
    return { flagOff, emptyLine, opened, indentsAfterPalette, listIndent, textIndent, composing, palettesAfter: palettes.length };
  })()`)).toEqual({ flagOff: { palettes: 0, indent: 1 }, emptyLine: true, opened: ["e"], indentsAfterPalette: [0, 0, 1, 0, 0, 0], listIndent: 1, textIndent: 1, composing: false, palettesAfter: 1 });
});

test("Ctrl+D duplicates the block below it with its children, focuses the copy, and Ctrl+Z undoes it", async () => {
  expect(await browser.evaluate(`(() => {
    reset();
    const prevented = press('b', { key: 'd', ctrlKey: true });
    const copy = state.blocks[3];
    const after = Object.assign(view(), { copy: { type: copy.type, text: copy.text, indent: copy.indent, checked: copy.checked }, child: state.blocks[4].text });
    restoreEdit(undoStack, redoStack);
    return { prevented, after, undone: view().ids };
  })()`)).toEqual({
    prevented: true,
    after: { ids: ["a", "b", "b1", "c1", "c2", "c"], indents: [0, 0, 1, 0, 1, 0], focused: "c1", copy: { type: "to_do", text: "two", indent: 0, checked: true }, child: "child" },
    undone: ["a", "b", "b1", "c"],
  });
});

test("Ctrl+Shift+ArrowUp/Down move the block among its siblings, keep the caret in it, and Ctrl+Z undoes it", async () => {
  expect(await browser.evaluate(`(() => {
    reset();
    const up = press('c', { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
    const afterUp = view();
    const down = press('a', { key: 'ArrowDown', metaKey: true, shiftKey: true });
    const afterDown = view();
    press('b1', { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
    const child = view();
    const top = press('c', { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
    restoreEdit(undoStack, redoStack);
    return { up, afterUp, down, afterDown, child, top, undone: view().ids };
  })()`)).toEqual({
    up: true,
    afterUp: { ids: ["a", "c", "b", "b1"], indents: [0, 0, 0, 1], focused: "c" },
    child: { ids: ["c", "a", "b", "b1"], indents: [0, 0, 0, 1], focused: "b1" },
    down: true,
    afterDown: { ids: ["c", "a", "b", "b1"], indents: [0, 0, 0, 1], focused: "a" },
    top: true,
    undone: ["a", "c", "b", "b1"],
  });
});
