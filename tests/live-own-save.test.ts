import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// #109: a tab's own save came back as a live notice and showed 새 내용이 있어요 while the user kept typing.
const live = readFileSync(new URL("../assets/features/lazy/live.js", import.meta.url), "utf8");

function harness(server: { updated: number; text: string }) {
  const handlers: Record<string, Function[]> = {};
  const on = (map: Record<string, Function[]>) => (type: string, fn: Function) => { (map[type] ||= []).push(fn); return () => { map[type] = map[type].filter((f) => f !== fn); }; };
  const docHandlers: Record<string, Function[]> = {}, winHandlers: Record<string, Function[]> = {};
  const created: any[] = [];
  const document: any = { hidden: false, activeElement: null, addEventListener: on(docHandlers), dispatchEvent() {}, getElementById: () => null,
    querySelector: () => ({ content: "member-a" }), body: { appendChild() {} },
    createElement: (tag: string) => { const el: any = { tag, style: {}, hidden: false, setAttribute() {}, append() {} }; created.push(el); return el; } };
  const state = { title: "T", blocks: [{ id: "b1", type: "paragraph", text: "local, newer" }], baseUpdated: 0, dirty: false, saving: false };
  const editor = { state, render() {}, on: on(handlers), emit: (type: string) => (handlers[type] || []).slice().forEach((f) => f()) };
  const sockets: any[] = [];
  class Socket { onmessage: any; onclose: any; onerror: any; readyState = 1; constructor() { sockets.push(this); } close() {} send() {} }
  const timers: Function[] = [];
  const window: any = { WebSocket: Socket, AcardEditor: editor, addEventListener: on(winHandlers), confirm: () => true };
  const fetch = async () => ({ ok: true, json: async () => ({ page: { title: "T", updated: server.updated }, blocks: [{ id: "b1", type: "paragraph", text: server.text }] }) });
  runInNewContext(live, { window, document, location: new URL("https://notes.example.com/edit/p/"), WebSocket: Socket, fetch, Date, JSON, Math, Number,
    sessionStorage: { getItem: () => null, setItem() {} }, CustomEvent: class { constructor(public type: string, public init: any) {} },
    setTimeout: (fn: Function) => { timers.push(fn); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  const settle = async () => { for (let i = 0; i < 5; i++) { timers.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
  const notice = async (src: string) => { sockets[0].onmessage({ data: JSON.stringify({ type: "change", id: 1 + Math.random(), kinds: ["page"], slugs: ["p"], src }) }); await settle(); };
  const bar = () => created.find((el) => el.tag === "div" && el.id === "acard-live-bar");
  document.fire = (type: string) => (docHandlers[type] || []).forEach((f) => f({}));
  return { state, editor, notice, bar, settle, document };
}

test("a notice for this tab's own save shows no 새 내용이 있어요 bar, even while typing", async () => {
  const h = harness({ updated: 50, text: "saved by me" });
  h.state.baseUpdated = 50;
  h.document.fire("input");
  await h.notice("");
  expect(h.bar()).toBeUndefined();
});

test("a notice that arrives while this tab's save is in flight waits for it and then stays quiet", async () => {
  const server = { updated: 60, text: "saved by me" };
  const h = harness(server);
  h.state.baseUpdated = 50; h.state.saving = true;
  h.document.fire("input");
  await h.notice("");
  expect(h.bar()).toBeUndefined();
  h.state.saving = false; h.state.baseUpdated = 60;
  h.editor.emit("saved");
  await h.settle();
  expect(h.bar()).toBeUndefined();
});

test("a newer version from someone else still shows the bar while typing", async () => {
  const h = harness({ updated: 70, text: "remote edit" });
  h.state.baseUpdated = 50;
  h.document.fire("input");
  await h.notice("");
  expect(h.bar()?.hidden).toBe(false);
});
