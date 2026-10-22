import { afterEach, beforeEach, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { workspaceToZip } from "../notion-export";
import { cookie, read, setup } from "./db-harness";

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
afterEach(() => ctx.sqlite.close());

// Only the DOM is simulated: upload requests below run through the assembled worker and SQLite.
class Element {
  children: Element[] = [];
  attributes: Record<string, string> = {};
  events: Record<string, (event: any) => any> = {};
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name),
  };
  hidden = false;
  disabled = false;
  textContent = "";
  className = "";
  href = "";
  value = "";
  clicks = 0;
  files: File[] = [];
  constructor(public tagName = "div") {}
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  append(...nodes: Element[]) { this.children.push(...nodes); }
  appendChild(node: Element) { this.append(node); return node; }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  addEventListener(name: string, handler: (event: any) => any) { this.events[name] = handler; }
  click() { this.clicks++; }
}

async function client(fetcher?: (url: string, options: RequestInit) => Promise<Response>) {
  const ids = ["import-page", "import-drop", "import-pick", "import-files", "import-status", "import-results", "import-pages"];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const events: string[] = [];
  const listeners: Record<string, () => void> = {};
  const requests: { url: string; options: RequestInit }[] = [];
  const auth = await cookie();
  runInNewContext(read("assets/features/lazy/import.js"), {
    document: {
      getElementById: (id: string) => nodes[id],
      createElement: (tag: string) => new Element(tag),
      dispatchEvent: (event: Event) => events.push(event.type),
      addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; },
    },
    CustomEvent, FormData,
    fetch: async (url: string, options: RequestInit) => {
      requests.push({ url, options });
      if (fetcher) return fetcher(url, options);
      const headers = new Headers(options.headers);
      headers.set("cookie", auth);
      return ctx.worker.fetch(new Request("https://notes.test" + url, { ...options, headers }), ctx.env);
    },
  });
  return {
    nodes, events, requests, listeners,
    choose: (files: File[]) => { nodes["import-files"].files = files; return nodes["import-files"].events.change({}); },
    drop: (files: File[]) => nodes["import-drop"].events.drop({ preventDefault() {}, dataTransfer: { files } }),
  };
}

test("import page is an authenticated HTML route with shell and route-local assets", async () => {
  for (const path of ["/import", "/import/"]) {
    const response = await ctx.worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: await cookie() } }), ctx.env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    for (const id of ["sidebar", "menu", "main", "import-page", "import-drop", "import-pick", "import-files", "import-status", "import-pages"]) expect(html).toContain('id="' + id + '"');
    expect(html).toContain('src="/lazy/import.js"');
    expect(html).toContain('href="/lazy/import.css"');
    expect(html).toContain('accept=".zip,.md" multiple');
    expect((await ctx.call("GET", path, undefined, true)).status).toBe(401);
  }
  const head = await ctx.worker.fetch(new Request("https://notes.test/import", { method: "HEAD", headers: { cookie: await cookie() } }), ctx.env);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect((await ctx.call("POST", "/import")).status).toBe(405);
  expect((await ctx.call("GET", "/not-import")).status).toBe(404);
});

test("dropping a ZIP posts its ArrayBuffer and opens pages actually persisted by the worker", async () => {
  const ui = await client();
  const zip = new Uint8Array(workspaceToZip([{ slug: "meeting", title: "Meeting notes", blocks: [{ id: "p", type: "paragraph", text: "From Notion" }] }]));
  ui.nodes["import-drop"].events.dragenter({ preventDefault() {} });
  expect(ui.nodes["import-drop"].classes.has("is-dragging")).toBe(true);
  await ui.drop([new File([zip], "notion.zip")]);
  expect(ui.requests).toHaveLength(1);
  const request = ui.requests[0];
  expect(request.url).toBe("/api/import");
  expect(request.options.method).toBe("POST");
  expect(new Headers(request.options.headers).get("content-type")).toBe("application/zip");
  expect(request.options.body).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(request.options.body as ArrayBuffer)).toEqual(zip);
  const pages = (await ctx.call("GET", "/api/tree")).data.pages;
  const imported = pages.find((page: any) => page.title === "Meeting notes");
  expect(imported).toBeDefined();
  const row = ui.nodes["import-pages"].children.find(row => row.children[0].textContent === imported.title)!;
  expect(row.children[0].textContent).toBe(imported.title);
  expect(row.children[1].href).toBe("/" + encodeURIComponent(imported.slug) + "/");
  expect(ui.events).toContain("acard:tree-fresh");
  expect(ui.nodes["import-results"].hidden).toBe(false);
  expect(ui.nodes["import-drop"].classes.has("is-dragging")).toBe(false);
  expect(ui.nodes["import-pick"].disabled).toBe(false);
});

test("file picker posts Markdown files under repeated file keys without a manual multipart header", async () => {
  const ui = await client();
  ui.nodes["import-pick"].events.click({});
  expect(ui.nodes["import-files"].clicks).toBe(1);
  await ui.choose([new File(["# Notes\n\nFirst"], "한글.md"), new File(["Second"], "other.MD")]);
  expect(ui.requests).toHaveLength(1);
  const request = ui.requests[0];
  expect(request.url).toBe("/api/import/md");
  expect(request.options.method).toBe("POST");
  expect(request.options.headers).toBeUndefined();
  expect(request.options.body).toBeInstanceOf(FormData);
  const form = request.options.body as FormData;
  expect([...form.keys()]).toEqual(["file", "file"]);
  expect(form.getAll("file").map(file => (file as File).name)).toEqual(["한글.md", "other.MD"]);
  expect(ui.nodes["import-pages"].children).toHaveLength(2);
  const imported = (await ctx.call("GET", "/api/tree")).data.pages;
  for (const row of ui.nodes["import-pages"].children) {
    const page = imported.find((page: any) => page.title === row.children[0].textContent);
    expect(page).toBeDefined();
    expect(row.children[1].href).toBe("/" + encodeURIComponent(page.slug) + "/");
    expect(row.children[0].attributes.translate).toBe("no");
  }
});

test("invalid extensions and oversized ZIP or Markdown files never send an upload", async () => {
  const ui = await client();
  for (const file of [new File(["html"], "page.html"), { name: "big.zip", size: 30 * 1024 * 1024 + 1 }, { name: "big.md", size: 2 * 1024 * 1024 + 1 }]) {
    await ui.choose([file as File]);
    expect(ui.nodes["import-status"].classes.has("is-error")).toBe(true);
    expect(ui.nodes["import-pick"].disabled).toBe(false);
  }
  expect(ui.requests).toHaveLength(0);
});

test("pending uploads block duplicate drops and failures restore the picker without invented results", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const ui = await client(() => pending);
  const file = new File(["content"], "notes.md");
  const uploading = ui.choose([file]);
  expect(ui.nodes["import-pick"].disabled).toBe(true);
  expect(ui.nodes["import-drop"].attributes["aria-busy"]).toBe("true");
  await ui.drop([file]);
  expect(ui.requests).toHaveLength(1);
  finish(new Response(JSON.stringify({ error: "upload rejected" }), { status: 413 }));
  await uploading;
  expect(ui.nodes["import-status"].classes.has("is-error")).toBe(true);
  expect(ui.nodes["import-status"].children.at(-1)?.textContent).toBe("upload rejected");
  expect(ui.nodes["import-pick"].disabled).toBe(false);
  expect(ui.nodes["import-drop"].attributes["aria-busy"]).toBe("false");
  expect(ui.nodes["import-pages"].children).toHaveLength(0);
  expect(ui.events).not.toContain("acard:tree-fresh");
});

test("partial batch success stays visible when a later archive fails, with warning and skipped counts", async () => {
  let n = 0;
  const ui = await client(async () => ++n === 1
    ? Response.json({ imported: 1, pages: [{ slug: "saved", title: "<script>private</script>" }], warnings: ["warning detail"], skipped: ["image.png"] })
    : Response.json({ error: "second archive failed" }, { status: 400 }));
  await ui.drop([new File(["a"], "a.zip"), new File(["b"], "b.zip")]);
  expect(ui.nodes["import-pages"].children).toHaveLength(1);
  expect(ui.nodes["import-pages"].children[0].children[0].textContent).toBe("<script>private</script>");
  expect(ui.nodes["import-status"].classes.has("is-error")).toBe(true);
  expect(ui.nodes["import-results"].hidden).toBe(false);
  const success = await client(async () => Response.json({ imported: 0, pages: [], warnings: ["warning detail"], skipped: ["image.png"] }));
  await success.choose([new File(["a"], "a.zip")]);
  expect(success.nodes["import-status"].children.map(node => node.textContent)).toContain("warning detail");
  expect(success.nodes["import-status"].children.some(node => node.className === "import-count" && node.textContent === "1")).toBe(true);
  expect(success.nodes["import-results"].hidden).toBe(true);
});
