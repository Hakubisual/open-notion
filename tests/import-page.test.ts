import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { buildFixture } from "./fixtures/import-fixtures.ts";
import { cookie, read, setup } from "./db-harness";

// The real engine chunks set window.AcardImportEngine / AcardImportNotion / AcardImportObsidian; the UI chunk runs in a vm
// with a small simulated DOM, and every request goes through the assembled worker and SQLite.
const CHUNKS: Record<string, string> = { "/lazy/import-engine.js": "AcardImportEngine", "/lazy/import-notion.js": "AcardImportNotion", "/lazy/import-obsidian.js": "AcardImportObsidian" };
// The chunks only need window while they load; leaving a window without location on globalThis breaks PGlite in later files.
const engines: Record<string, unknown> = {};
beforeAll(async () => {
  (globalThis as any).window = globalThis;
  try {
    await import("../assets/features/lazy/import-engine.js");
    await import("../assets/features/lazy/import-notion.js");
    await import("../assets/features/lazy/import-obsidian.js");
    for (const name of Object.values(CHUNKS)) engines[name] = (globalThis as any)[name];
  } finally {
    delete (globalThis as any).window;
  }
});
afterAll(() => { for (const name of Object.values(CHUNKS)) delete (globalThis as any)[name]; });

function memoryKv() {
  const data = new Map<string, ArrayBuffer>();
  return {
    async put(key: string, value: ArrayBuffer) { data.set(key, value); },
    async get(key: string) { return data.get(key) ?? null; },
    async getWithMetadata(key: string) { return { value: data.get(key) ?? null, metadata: null }; },
    async delete(key: string) { data.delete(key); },
  };
}

let ctx: ReturnType<typeof setup>;
beforeEach(async () => { ctx = setup(); ctx.env.MEDIA = memoryKv(); await ctx.call("GET", "/api/tree"); });
afterEach(() => ctx.sqlite.close());

class Element {
  children: Element[] = [];
  attributes: Record<string, string> = {};
  events: Record<string, (event: any) => any> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, on: boolean) => (on ? this.classes.add(name) : this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  hidden = false;
  disabled = false;
  open = false;
  textContent = "";
  innerHTML = "";
  className = "";
  href = "";
  value = "";
  type = "";
  id = "";
  src = "";
  clicks = 0;
  files: unknown[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onChange: (() => void) | null = null;
  constructor(public tagName = "div", private doc?: any) {}
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  append(...nodes: Element[]) { this.children.push(...nodes); }
  appendChild(node: Element) { this.append(node); return node; }
  replaceChildren(...nodes: Element[]) { this.children = nodes; this.onChange?.(); }
  addEventListener(name: string, handler: (event: any) => any) { this.events[name] = handler; }
  click() { this.clicks++; return this.events.click?.({}); }
  focus() { if (this.doc) this.doc.activeElement = this; }
  text(): string { return [this.textContent, ...this.children.map((c) => c.text())].join(""); }
  find(pred: (e: Element) => boolean): Element | undefined {
    for (const c of this.children) { if (pred(c)) return c; const hit = c.find(pred); if (hit) return hit; }
    return undefined;
  }
}

type Fetcher = (url: string, options: RequestInit, real: () => Promise<Response>) => Promise<Response>;

async function client(fetcher?: Fetcher) {
  const ids = ["import-page", "import-drop", "import-pick", "import-files", "import-folder-pick", "import-folder", "import-status", "import-progress", "import-progress-text", "import-bar", "import-bar-fill", "import-progress-sub", "import-stop", "import-result", "import-error", "import-dialog"];
  const doc: any = { activeElement: null };
  const nodes: Record<string, Element> = Object.fromEntries(ids.map((id) => [id, new Element("div", doc)]));
  Object.assign(nodes["import-page"].dataset, { engine: "/lazy/import-engine.js", notion: "/lazy/import-notion.js", obsidian: "/lazy/import-obsidian.js" });
  const events: string[] = [];
  const loaded: string[] = [];
  const requests: { url: string; options: RequestInit }[] = [];
  const auth = await cookie();
  const context: any = {
    document: Object.assign(doc, {
      getElementById: (id: string) => nodes[id],
      createElement: (tag: string) => new Element(tag, doc),
      dispatchEvent: (event: Event) => events.push(event.type),
      addEventListener: () => {},
      head: { appendChild: (script: Element) => { loaded.push(script.src); context[CHUNKS[script.src]] = engines[CHUNKS[script.src]]; queueMicrotask(() => script.onload?.()); } },
    }),
    CustomEvent, FormData, File, Error, setTimeout, queueMicrotask,
    fetch: async (url: string, options: RequestInit) => {
      requests.push({ url, options });
      const real = () => {
        const headers = new Headers(options.headers);
        headers.set("cookie", auth);
        return ctx.worker.fetch(new Request("https://notes.test" + url, { ...options, headers }), ctx.env);
      };
      return fetcher ? fetcher(url, options, real) : real();
    },
  };
  context.window = context;
  createContext(context);
  runInContext(read("assets/features/lazy/import.js"), context);
  const paths = () => requests.map((r) => r.url.replace(/\/batches\/imp[a-z0-9]+\//, "/batches/:id/"));
  return {
    nodes, events, requests, loaded, doc, paths,
    choose: (files: unknown[]) => { nodes["import-files"].files = files; return nodes["import-files"].events.change({}); },
    chooseFolder: (files: unknown[]) => { nodes["import-folder"].files = files; return nodes["import-folder"].events.change({}); },
    drop: (files: unknown[]) => nodes["import-drop"].events.drop({ preventDefault() {}, dataTransfer: { files, items: [] } }),
    // Resolves when the dialog root is filled (subscribe before the action that opens it).
    dialogOpened: () => new Promise<Element>((ok, bad) => {
      const timer = setTimeout(() => bad(new Error("dialog did not open")), 10000);
      nodes["import-dialog"].onChange = () => { if (nodes["import-dialog"].children.length) { clearTimeout(timer); ok(nodes["import-dialog"].children[0]); } };
    }),
  };
}

const zipFile = async (name: "N1" | "O1") => { const f = await buildFixture(name); return { fixture: f, file: new File([f.zip], name + ".zip") }; };
const tree = async () => (await ctx.call("GET", "/api/tree")).data.pages as { slug: string; title: string }[];
const stats = (result: Element) => Object.fromEntries(result.find((e) => e.className === "import-stats")!.children.map((tile) => [tile.find((e) => e.className === "import-stat-label")!.textContent, Number(tile.find((e) => e.className === "import-stat-num")!.textContent)]));

test("import page is an authenticated HTML route with the new layout and lazy engine chunks", async () => {
  for (const path of ["/import", "/import/"]) {
    const response = await ctx.worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: await cookie() } }), ctx.env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    for (const id of ["sidebar", "menu", "main", "import-page", "import-drop", "import-pick", "import-files", "import-folder", "import-folder-pick", "import-status", "import-progress", "import-bar", "import-stop", "import-result", "import-error", "import-dialog"]) expect(html).toContain('id="' + id + '"');
    expect(html).toContain("<h1 id=\"import-title\">노션·옵시디언에서 가져오기</h1>");
    expect(html).toContain('src="/lazy/import.js"');
    expect(html).toContain('href="/lazy/import.css"');
    expect(html).toContain('data-engine="/lazy/import-engine.js"');
    expect(html).toContain('data-obsidian="/lazy/import-obsidian.js"');
    expect(html).toContain('<input type="file" id="import-folder" webkitdirectory');
    expect(html).toContain('role="progressbar"');
    expect((await ctx.call("GET", path, undefined, true)).status).toBe(401);
  }
  const head = await ctx.worker.fetch(new Request("https://notes.test/import", { method: "HEAD", headers: { cookie: await cookie() } }), ctx.env);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect((await ctx.call("POST", "/import")).status).toBe(405);
});

test("a Notion zip goes batches -> files -> chunk -> finish, pages land in the tree and the result shows the plan counts", async () => {
  const ui = await client();
  const { fixture, file } = await zipFile("N1");
  ui.nodes["import-drop"].events.dragenter({ preventDefault() {} });
  expect(ui.nodes["import-drop"].classes.has("is-dragging")).toBe(true);
  await ui.drop([file]);
  const paths = ui.paths();
  expect(paths[0]).toBe("/api/import/batches");
  expect(paths.filter((p) => p === "/api/import/batches/:id/files").length).toBe(4);
  expect(paths.slice(-2)).toEqual(["/api/import/batches/:id/chunk", "/api/import/batches/:id/finish"]);
  expect(ui.loaded).toEqual(["/lazy/import-engine.js", "/lazy/import-notion.js"]);
  const body = JSON.parse(String(ui.requests[0].options.body));
  expect(body.format).toBe("notion-md");
  expect(body.sources.filter((s: any) => s.kind === "db").length).toBe(1);
  expect(body.sources.filter((s: any) => s.kind === "row").length).toBe(3);
  const titles = (await tree()).map((p) => p.title);
  expect(titles).toContain("Home");
  expect(titles).toContain("Projects");
  const result = ui.nodes["import-result"];
  expect(result.hidden).toBe(false);
  expect(result.children[0].textContent).toBe("가져왔어요");
  const c = fixture.sourceCounts;
  expect(stats(result)).toEqual({ 페이지: c.pages, 데이터베이스: c.databases, 행: c.dbRows, 이미지: c.images, 파일: c.attachments, 링크: c.internalLinks });
  const skipped = result.find((e) => e.className === "import-skip-path");
  expect(skipped?.attributes.translate).toBe("no");
  const reasons = result.find((e) => e.className === "import-skip-list")!.children.map((row) => row.children[2].textContent).sort();
  expect(reasons).toEqual(["같은 표의 다른 보기라 한 번만 가져왔어요", "링크 대상이 내보낸 파일에 없어요"]);
  const open = result.find((e) => e.textContent === "첫 페이지 열기")!;
  const first = (await tree()).find((p) => p.title === "Home")!;
  expect(open.href).toBe("/" + encodeURIComponent(first.slug) + "/");
  expect(ui.nodes["import-bar"].attributes["aria-valuenow"]).toBe(ui.nodes["import-bar"].attributes["aria-valuemax"]);
  expect(ui.events).toContain("acard:tree-fresh");
  expect(ui.nodes["import-pick"].disabled).toBe(false);
  expect(ui.nodes["import-drop"].attributes["aria-busy"]).toBe("false");
});

test("undo posts /undo and the imported pages leave the tree", async () => {
  const ui = await client();
  await ui.choose([(await zipFile("N1")).file]);
  const before = (await tree()).length;
  const undo = ui.nodes["import-result"].find((e) => e.textContent === "이번 가져오기 되돌리기")!;
  await undo.click();
  expect(ui.paths().at(-1)).toBe("/api/import/batches/:id/undo");
  expect(ui.nodes["import-result"].text()).toContain("되돌렸어요. 휴지통에서 다시 꺼낼 수 있어요.");
  const after = await tree();
  expect(after.length).toBeLessThan(before);
  expect(after.map((p) => p.title)).not.toContain("Home");
});

test("a second import of the same export asks first: skip is the default, Esc cancels, nothing is duplicated", async () => {
  const first = await client();
  await first.choose([(await zipFile("N1")).file]);
  const count = (await tree()).length;

  const ui = await client();
  const opened = ui.dialogOpened();
  const running = ui.choose([(await zipFile("N1")).file]);
  const dialog = await opened;
  expect(dialog.attributes.role).toBe("dialog");
  expect(dialog.attributes["aria-modal"]).toBe("true");
  expect(dialog.children[0].textContent).toMatch(/^이미 가져온 페이지 \d+개가 있어요$/);
  const buttons = dialog.find((e) => e.className === "import-dialog-actions")!.children.map((b) => b.textContent);
  expect(buttons).toEqual(["건너뛰고 가져오기", "새 사본으로 가져오기", "취소"]);
  expect(ui.doc.activeElement.textContent).toBe("건너뛰고 가져오기");
  ui.doc.activeElement.click();
  await running;
  const batches = ui.requests.filter((r) => r.url.startsWith("/api/import/batches?") || r.url === "/api/import/batches").map((r) => r.url);
  expect(batches).toEqual(["/api/import/batches", "/api/import/batches?duplicates=skip"]);
  expect(ui.paths().at(-1)).toBe("/api/import/batches/:id/finish");
  expect((await tree()).length).toBe(count);

  const esc = await client();
  const again = esc.dialogOpened();
  const cancelled = esc.choose([(await zipFile("N1")).file]);
  const card = await again;
  card.events.keydown({ key: "Escape", preventDefault() {} });
  await cancelled;
  expect(esc.paths()).toEqual(["/api/import/batches"]);
  expect(esc.nodes["import-status"].text()).toBe("가져오기를 취소했어요.");
});

test("a zip over 500 MB is refused before anything is read or sent", async () => {
  const ui = await client();
  await ui.choose([{ name: "huge.zip", size: 500 * 1024 * 1024 + 1, slice() { throw new Error("read"); } }]);
  expect(ui.requests).toHaveLength(0);
  expect(ui.loaded).toHaveLength(0);
  expect(ui.nodes["import-error"].hidden).toBe(false);
  expect(ui.nodes["import-error"].text()).toContain("파일이 500MB보다 커요. 노션에서 팀 공간별로 나눠 내보내거나, 받은 zip 안의 Part 파일을 하나씩 올려 주세요.");
});

test("stop during the import calls abort and leaves nothing behind", async () => {
  let ui!: Awaited<ReturnType<typeof client>>;
  ui = await client(async (url, _options, real) => {
    if (url.endsWith("/chunk")) ui.nodes["import-stop"].click();
    return real();
  });
  const before = (await tree()).length;
  await ui.choose([(await zipFile("N1")).file]);
  expect(ui.paths().at(-1)).toBe("/api/import/batches/:id/abort");
  expect(ui.paths()).not.toContain("/api/import/batches/:id/finish");
  expect(ui.nodes["import-error"].text()).toBe("가져오기를 멈췄어요. 들어온 것은 모두 지웠어요.");
  expect((await tree()).length).toBe(before);
  expect(Number((ctx.sqlite.query("SELECT COUNT(*) AS n FROM pages WHERE title = 'Home'").get() as any).n)).toBe(0);
});

test("a folder pick builds entries from webkitRelativePath and imports the vault", async () => {
  const fixture = await buildFixture("O1");
  const files = [...fixture.files].map(([path, bytes]) => {
    const file = new File([bytes], path.split("/").pop()!);
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    return file;
  });
  const ui = await client();
  ui.nodes["import-folder-pick"].click();
  expect(ui.nodes["import-folder"].clicks).toBe(1);
  await ui.chooseFolder(files);
  expect(ui.loaded).toEqual(["/lazy/import-engine.js", "/lazy/import-obsidian.js"]);
  const body = JSON.parse(String(ui.requests[0].options.body));
  expect(body.format).toBe("obsidian");
  expect(body.sources.some((s: any) => s.key === "obsidian-vault/Home.md" || s.source.endsWith("/Home.md"))).toBe(true);
  expect(ui.paths().at(-1)).toBe("/api/import/batches/:id/finish");
  expect(stats(ui.nodes["import-result"]).페이지).toBe(fixture.sourceCounts.pages);
  expect((await tree()).map((p) => p.title)).toContain("Home");
});

test("a single .md file still goes to /api/import/md as form field file", async () => {
  const ui = await client();
  await ui.choose([new File(["# Notes\n\nFirst"], "한글.md")]);
  expect(ui.paths()).toEqual(["/api/import/md"]);
  const form = ui.requests[0].options.body as FormData;
  expect([...form.keys()]).toEqual(["file"]);
  expect(ui.loaded).toHaveLength(0);
  const page = (await tree()).find((p) => p.title === "한글")!;
  expect(page).toBeDefined();
  expect(ui.nodes["import-result"].find((e) => e.textContent === "첫 페이지 열기")!.href).toBe("/" + encodeURIComponent(page.slug) + "/");
});

test("while an import runs a second drop is ignored", async () => {
  let release!: () => void;
  const gate = new Promise<void>((ok) => { release = ok; });
  let reached!: () => void;
  const atBatches = new Promise<void>((ok) => { reached = ok; });
  const ui = await client(async (url, _options, real) => {
    if (url === "/api/import/batches") { reached(); await gate; }
    return real();
  });
  const { file } = await zipFile("N1");
  const running = ui.drop([file]);
  await atBatches;
  expect(ui.nodes["import-pick"].disabled).toBe(true);
  expect(ui.nodes["import-folder-pick"].disabled).toBe(true);
  expect(ui.nodes["import-stop"].disabled).toBe(false);
  expect(ui.nodes["import-drop"].attributes["aria-busy"]).toBe("true");
  await ui.drop([file]);
  await ui.choose([new File(["x"], "x.md")]);
  release();
  await running;
  expect(ui.paths().filter((p) => p === "/api/import/batches")).toHaveLength(1);
  expect(ui.paths()).not.toContain("/api/import/md");
});

test("a server {code} shows the error card with its sentence and a retry that runs again", async () => {
  let calls = 0;
  const ui = await client(async (url, _options, real) => {
    if (url === "/api/import/batches" && ++calls === 1) return Response.json({ code: "limit-pages", error: "too many" }, { status: 413 });
    return real();
  });
  await ui.choose([(await zipFile("N1")).file]);
  const error = ui.nodes["import-error"];
  expect(error.hidden).toBe(false);
  expect(error.dataset.code).toBe("limit-pages");
  expect(error.text()).toContain("한 번에 가져올 수 있는 양을 넘었어요. 나눠서 가져와 주세요.");
  expect(ui.nodes["import-result"].hidden).toBe(true);
  await error.find((e) => e.textContent === "다시 시도")!.click();
  expect(ui.paths().at(-1)).toBe("/api/import/batches/:id/finish");
  expect(ui.nodes["import-result"].hidden).toBe(false);
});
