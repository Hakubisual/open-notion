import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../assets/features/shortcuts.shared.js", import.meta.url), "utf8");
function setup() {
  const handlers = {}, actions = [];
  const context = { window: { AcardEditor: { lazy: async () => ({ run: key => actions.push(key) }) } }, document: { addEventListener: (name, fn) => { handlers[name] = fn; } }, alert: message => { throw new Error(message); } };
  context.AcardEditor = context.window.AcardEditor;
  runInNewContext(source, context);
  async function key(value, options = {}) {
    const event = { key: value, timeStamp: 100, target: { closest: () => null }, preventDefault() { this.defaultPrevented = true; }, ...options };
    handlers.keydown(event);
    await Promise.resolve();
    return event;
  }
  return { key, actions };
}

test("single keys dispatch actions only outside typing contexts", async () => {
  const f = setup();
  for (const target of [{ closest: () => ({ tagName: "INPUT" }) }, { closest: () => ({ tagName: "TEXTAREA" }) }, { closest: () => null, isContentEditable: true }]) {
    for (const key of ["/", "k", "n", "q", "?", "g", "h", "t"]) await f.key(key, { target });
  }
  expect(f.actions).toEqual([]);
  for (const key of ["/", "k", "n", "q", "?"]) await f.key(key);
  expect(f.actions).toEqual(["/", "k", "n", "q", "?"]);
});

test("navigation sequences expire and typing cancels the prefix", async () => {
  const f = setup();
  await f.key("g"); await f.key("h", { timeStamp: 200 });
  await f.key("g"); await f.key("t", { timeStamp: 200 });
  await f.key("g"); await f.key("h", { timeStamp: 1500 });
  await f.key("g"); await f.key("x", { target: { closest: () => ({} ) } }); await f.key("h");
  expect(f.actions).toEqual(["gh", "gt"]);
});

test("composing repeated modified and already handled keys stay untouched", async () => {
  const f = setup();
  for (const flag of ["isComposing", "repeat", "ctrlKey", "metaKey", "altKey", "defaultPrevented"]) await f.key("q", { [flag]: true });
  expect(f.actions).toEqual([]);
});
