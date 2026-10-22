import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../assets/features/lazy/toc.js", import.meta.url), "utf8");

// The reader navigation tests use a VM DOM fixture too. Keep selectors and tree mutations real
// enough to catch duplicate mounts, stale cached nodes, and headings outside the document body.
class Element {
  children: Element[] = [];
  parentElement: Element | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Function[]> = {};
  dataset: Record<string, string> = {};
  id = ""; className = ""; text = ""; href = ""; type = ""; hidden = false; open = false;
  constructor(public tagName: string) { this.tagName = tagName.toUpperCase(); }
  get firstChild() { return this.children[0] || null; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  classList = {
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    toggle: (name: string, on: boolean) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); on ? names.add(name) : names.delete(name); this.className = [...names].join(" "); },
    remove: (name: string) => { this.classList.toggle(name, false); },
  };
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  appendChild(node: Element) { return this.insertBefore(node, null); }
  insertBefore(node: Element, before: Element | null) {
    node.remove(); node.parentElement = this;
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
    return node;
  }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  matches(selector: string): boolean {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    const [, tag, id] = /^(\w+)(\[id\])?$/.exec(selector) || [];
    return this.tagName === tag?.toUpperCase() && (!id || !!this.id);
  }
  closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector: string): Element[] {
    if (selector.startsWith(":scope > ")) return this.children.filter(child => child.matches(selector.slice(9)));
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return descendants;
    return descendants.filter(node => selector.split(",").some(part => {
      const bits = part.split(" "), last = bits.pop()!;
      return node.matches(last) && (!bits.length || !!node.parentElement?.closest(bits[0]));
    }));
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name: string, fn: Function) { (this.listeners[name] ||= []).push(fn); }
  fire(name: string, event: Record<string, unknown> = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  cloneNode(): Element {
    const copy = Object.assign(new Element(this.tagName), { id: this.id, className: this.className, text: this.text, href: this.href, hidden: this.hidden, open: this.open, attrs: { ...this.attrs } });
    this.children.forEach(child => copy.appendChild(child.cloneNode()));
    return copy;
  }
}

function fixture(count = 2, options: { identity?: string; reader?: boolean; readonly?: boolean; store?: Map<string, string>; storageFails?: boolean } = {}) {
  const document = new Element("document"), body = document.appendChild(new Element("body"));
  body.className = options.reader === false ? "editing" : "reader";
  body.dataset.readonly = options.readonly ? "1" : "";
  const store = options.store || new Map<string, string>();
  let main: Element, article: Element, blocks: Element, actions: Element;
  function page(headings: number) {
    main?.remove(); main = body.appendChild(new Element("main")); main.id = "main";
    article = main.appendChild(new Element("article")); article.id = "article";
    const header = article.appendChild(new Element("div")); header.className = "page-head";
    actions = header.appendChild(new Element("div")); actions.className = "page-actions";
    blocks = article.appendChild(new Element("div")); blocks.className = "blocks";
    for (let i = 0; i < headings; i++) { const h = blocks.appendChild(new Element("h" + (i % 4 + 2))); h.id = "제목 " + i; h.textContent = "Heading " + i; }
    return main;
  }
  page(count);
  const nativeQuery = document.querySelector.bind(document);
  document.querySelector = (selector: string) => selector === 'meta[name="acard-id"]' ? { content: options.identity ?? "member-a" } as any : nativeQuery(selector);
  const ready: Function[] = [];
  runInNewContext(source, {
    document: Object.assign(document, { body, createElement: (tag: string) => new Element(tag), getElementById: (id: string) => nativeQuery("#" + id) }),
    window: { AcardReader: { on: (_: string, fn: Function) => ready.push(fn) } },
    localStorage: {
      getItem(key: string) { if (options.storageFails) throw Error("denied"); return store.get(key) ?? null; },
      setItem(key: string, value: string) { if (options.storageFails) throw Error("denied"); store.set(key, value); },
    },
  });
  return {
    document, body, store, page, ready: () => ready.forEach(fn => fn()),
    get main() { return main; }, get article() { return article; }, get blocks() { return blocks; }, get actions() { return actions; },
    get toc() { return nativeQuery(".reader-toc"); }, get button() { return nativeQuery(".reader-toc-toggle"); },
  };
}

test("reader TOC requires two nonempty document headings and excludes generated TOC labels", () => {
  for (const count of [0, 1, 2]) { const f = fixture(count); f.ready(); expect(!!f.toc).toBe(count >= 2); expect(!!f.button).toBe(count >= 2); }
  const f = fixture(1);
  const empty = f.blocks.appendChild(new Element("h3")); empty.id = "empty"; empty.textContent = "  ";
  const title = f.article.appendChild(new Element("h2")); title.id = "metadata"; title.textContent = "Metadata";
  const generated = f.blocks.appendChild(new Element("div")); generated.className = "tocblock";
  const label = generated.appendChild(new Element("h3")); label.id = "toc-label"; label.textContent = "Contents";
  f.ready(); expect(f.toc).toBeNull();
});

test("reader TOC uses ordered h2 through h5 anchors and literal heading text without rewriting content", () => {
  const f = fixture(4), headings = [...f.blocks.children];
  headings[0].textContent = "<img src=x onerror=alert(1)> & section";
  f.ready();
  expect(f.toc!.querySelectorAll("li").map(li => li.className)).toEqual(["l2", "l3", "l4", "l5"]);
  expect(f.toc!.querySelectorAll("a").map(a => a.href)).toEqual(headings.map(h => "#" + encodeURIComponent(h.id)));
  expect(f.toc!.querySelectorAll(".reader-toc-label")[0].textContent).toBe(headings[0].textContent);
  expect(f.toc!.querySelectorAll("img")).toHaveLength(0);
  expect(f.blocks.children).toEqual(headings);
  expect(f.article.children.indexOf(f.toc!)).toBeLessThan(f.article.children.indexOf(f.blocks));
  expect(f.button!.getAttribute("aria-controls")).toBe(f.toc!.id);
});

test("reader TOC hides and restores per-device visibility across documents and unavailable storage", () => {
  const f = fixture(); f.ready(); f.button!.fire("click");
  expect(f.toc!.hidden).toBe(true); expect(f.main.classList.contains("reader-has-toc")).toBe(false);
  expect(f.button!.getAttribute("aria-expanded")).toBe("false");
  const reopened = fixture(2, { store: f.store, identity: "member-b" }); reopened.ready();
  expect(reopened.toc!.hidden).toBe(true);
  reopened.button!.fire("click");
  expect(reopened.toc!.hidden).toBe(false); expect(reopened.button!.getAttribute("aria-expanded")).toBe("true");
  const denied = fixture(2, { storageFails: true }); denied.ready(); denied.button!.fire("click");
  expect(denied.toc!.hidden).toBe(true);
});

test("reader TOC remounts once after navigated and fresh events, including cached cloned markup", () => {
  const f = fixture(); f.ready();
  f.toc!.querySelector("details")!.open = false;
  const cached = f.main.cloneNode(); f.main.remove(); f.body.appendChild(cached);
  f.document.fire("acard:navigated"); f.document.fire("acard:page-fresh");
  expect(f.document.querySelectorAll(".reader-toc")).toHaveLength(1);
  expect(f.document.querySelectorAll(".reader-toc-toggle")).toHaveLength(1);
  expect(f.toc!.querySelector("details")!.open).toBe(false);
  f.button!.fire("click"); expect(f.toc!.hidden).toBe(true);
  cached.remove(); f.page(3); f.document.fire("acard:navigated");
  expect(f.toc!.querySelectorAll("a")).toHaveLength(3); expect(f.toc!.hidden).toBe(true);
  f.page(1); f.document.fire("acard:page-fresh"); expect(f.toc).toBeNull(); expect(f.button).toBeNull();
});

test("reader TOC replaces legacy footer navigation and reveals collapsed heading ancestors", () => {
  const f = fixture(), legacy = f.main.appendChild(new Element("nav")); legacy.className = "toc";
  const heading = f.blocks.children[1], folded = f.blocks.appendChild(new Element("details")); folded.appendChild(heading);
  f.ready(); expect(f.main.querySelector(".toc")).toBeNull();
  const link = f.toc!.querySelectorAll("a")[1];
  link.fire("click", { ctrlKey: true }); expect(folded.open).toBe(false);
  link.fire("click", { button: 0 }); expect(folded.open).toBe(true);
});

test("reader TOC does not mount for guests, anonymous pages, editors or read-only shares", () => {
  for (const options of [{ identity: "g-guest" }, { identity: "" }, { reader: false }, { readonly: true }]) {
    const f = fixture(3, options); f.ready(); f.document.fire("acard:page-fresh"); expect(f.toc).toBeNull(); expect(f.button).toBeNull();
  }
});
