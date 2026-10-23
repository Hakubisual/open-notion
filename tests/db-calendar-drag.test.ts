import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const context = { window: {} as any };
runInNewContext(readFileSync(join(import.meta.dir, "../assets/db-views.js"), "utf8"), context);
const views = context.window.DoriDBViews;

class Node {
  children: Node[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, Function[]> = {};
  style: any = {};
  className = "";
  textContent = "";
  classList = { add() {}, remove() {} };
  constructor(public tagName: string) {}
  get firstChild() { return this.children[0] || null; }
  appendChild(n: Node) { this.children.push(n); return n; }
  removeChild(n: Node) { this.children = this.children.filter((c) => c !== n); return n; }
  setAttribute(k: string, v: any) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type: string, fn: Function) { (this.listeners[type] ||= []).push(fn); }
  fire(type: string, event: any = {}) { (this.listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, ...event })); }
  all(cls: string): Node[] { return this.children.flatMap((c) => [...(c.className.split(" ").includes(cls) ? [c] : []), ...c.all(cls)]); }
}

const fakeDoc = (readonly = false) => ({
  head: new Node("head"),
  body: Object.assign(new Node("body"), { dataset: readonly ? { readonly: "1" } : {} }),
  getElementById: () => null,
  createElement: (tag: string) => new Node(tag),
  createTextNode: (text: string) => Object.assign(new Node("#text"), { textContent: text }),
});

const now = new Date();
const ymd = (d: number) => now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");

function render(value: any, readonly = false) {
  const saved: any[] = [];
  const doc = fakeDoc(readonly);
  const el = views.calendar({
    doc,
    properties: [{ id: "t", type: "title", name: "이름", config: {} }, { id: "d", type: "date", name: "날짜", config: {} }],
    rows: [{ id: "r1", values: { t: "A", d: value } }],
    values: (row: any) => row.values,
    setValue: (rowId: string, propId: string, v: any) => saved.push([rowId, propId, v]),
  });
  const days = el.all("dbv-cal-day");
  const dayCell = (n: number) => days.find((c) => !c.className.includes("dim") && c.children[0].textContent === String(n))!;
  const drag = (from: number, to: number) => {
    const chip = dayCell(from).all("dbv-chip")[0];
    const dataTransfer = { setData() {}, getData: () => "r1" };
    chip.fire("dragstart", { dataTransfer });
    dayCell(to).fire("dragover", { dataTransfer });
    dayCell(to).fire("drop", { dataTransfer });
    chip.fire("dragend", { dataTransfer });
  };
  return { saved, dayCell, drag };
}

describe("calendar drag", () => {
  test("dropping a chip on another day saves that date", () => {
    const view = render({ start: ymd(10), end: null });
    expect(view.dayCell(10).all("dbv-chip")[0].getAttribute("draggable")).toBe("true");
    view.drag(10, 14);
    expect(view.saved).toEqual([["r1", "d", { start: ymd(14), end: null }]]);
  });

  test("a range keeps its length and times keep their time of day", () => {
    const view = render({ start: ymd(3) + "T09:30", end: ymd(5) + "T18:00" });
    view.drag(3, 20);
    expect(view.saved).toEqual([["r1", "d", { start: ymd(20) + "T09:30", end: ymd(22) + "T18:00" }]]);
  });

  test("read-only views do not allow dragging", () => {
    const view = render({ start: ymd(10), end: null }, true);
    expect(view.dayCell(10).all("dbv-chip")[0].getAttribute("draggable")).toBeNull();
    view.drag(10, 14);
    expect(view.saved).toEqual([]);
  });
});
