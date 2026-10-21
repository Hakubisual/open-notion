import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadTemplates } from "../features/templates.build";
import { assembleWorkerSource } from "./assemble-worker";
import { runInNewContext } from "node:vm";

const templates = await loadTemplates(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = assembleWorkerSource();
let sqlite: Database, worker: any, env: any, cookie: string;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...values: any[]) => statement(sql, values),
    execute: () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = {
    GATE_PASSWORD: "template-pw", GATE_SECRET: "template-secret",
    ASSETS: { fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/templates-seed.json") return Response.json({ templates });
      if (path === "/" || path === "/home/") return new Response('<article id="article"><h1>Home</h1></article>', { headers: { "content-type": "text/html" } });
      return new Response("missing", { status: 404 });
    } },
    DB: { prepare: statement, batch: async (statements: ReturnType<typeof statement>[]) => sqlite.transaction(() => statements.map(item => item.execute()))() },
  };
  worker = new Function(source)();
  const login = await worker.fetch(new Request("https://notes.test/__gate", { method: "POST", body: new URLSearchParams({ pw: "template-pw" }) }), env);
  cookie = login.headers.get("set-cookie").split(";")[0];
});
afterEach(() => sqlite.close());

function call(path: string, method = "GET", body?: unknown, anonymous = false) {
  return worker.fetch(new Request("https://notes.test/api" + path, {
    method, headers: { ...(anonymous ? {} : { cookie }), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env) as Promise<Response>;
}
const content = (blocks: any[]) => blocks.map(({ type, text, indent = 0, checked = false, meta = null }) => ({ type, text, indent, checked, meta }));

test("template client keeps the creation version when a conflict is retried", async () => {
  const source = await Bun.file(new URL("../assets/features/lazy/templates.js", import.meta.url)).text();
  const create = source.slice(source.indexOf("  async function create("), source.indexOf("  async function open("));
  const puts: any[] = [];
  let creates = 0;
  const context: any = { creating: false, pendingPage: null, location: {}, JSON, encodeURIComponent,
    dialog: { querySelectorAll: () => [] }, fail: () => {},
    editor: { save: async () => {}, api: async (path: string, options: any) => {
      if (path === "/pages") { creates++; return { slug: "new", updated: 17 }; }
      puts.push(JSON.parse(options.body)); throw Error("conflict");
    } },
  };
  runInNewContext(create + "\nthis.create = create;", context);
  const template = { name: "Template", blocks: [{ id: "b1", type: "paragraph", text: "content" }] };
  await context.create(template);
  await context.create(template);
  expect(creates).toBe(1);
  expect(puts).toEqual([0, 1].map(() => ({ title: template.name, blocks: template.blocks, base_updated: 17 })));
  expect(context.location.href).toBeUndefined();
});

test("curated catalog is bounded and every markdown template produces editable blocks", async () => {
  expect(templates.length).toBeGreaterThan(0);
  expect(templates.length).toBeLessThanOrEqual(10);
  expect(new Set(templates.map(t => t.id)).size).toBe(templates.length);
  for (const template of templates) {
    expect(template.blocks.length).toBeGreaterThan(3);
    expect(template.blocks[0].type).toBe("heading1");
    expect(template.blocks.every(block => block.id && block.type && typeof block.text === "string")).toBe(true);
  }
  const response = await call("/templates");
  expect(response.status).toBe(200);
  expect((await response.json()).templates).toEqual(templates);
});

test("create from every curated template uses POST pages then PUT without losing blocks", async () => {
  for (const template of templates) {
    const page = await (await call("/pages", "POST", { title: template.name })).json();
    expect((await call("/page/" + encodeURIComponent(page.slug), "PUT", { title: template.name, base_updated: page.updated, blocks: template.blocks })).status).toBe(200);
    const saved = await (await call("/page/" + encodeURIComponent(page.slug))).json();
    expect(saved.page.title).toBe(template.name);
    expect(content(saved.blocks)).toEqual(content(template.blocks));
  }
});

test("personal templates appear with previews and retain the original application API", async () => {
  const page = await (await call("/pages", "POST", { title: "Personal" })).json();
  const blocks = [{ id: "todo", type: "to_do", text: "Keep", checked: true, meta: { richText: [{ text: "Keep", bold: true }] } }];
  await call("/page/" + page.slug, "PUT", { blocks, base_updated: page.updated });
  const saved = await (await call("/editor/templates", "POST", { slug: page.slug, name: "Mine" })).json();
  const catalog = await (await call("/templates")).json();
  expect(catalog.personal[0]).toMatchObject({ id: saved.template.id, name: "Mine", blocks: [{ type: "to_do", text: "Keep", checked: true }] });
  const copy = await (await call("/pages", "POST", { title: "Copy" })).json();
  expect((await call("/page/" + copy.slug + "/from-template", "POST", { templateId: saved.template.id })).status).toBe(200);
  expect(content((await (await call("/page/" + copy.slug)).json()).blocks)).toEqual(content(catalog.personal[0].blocks));
});

test("welcome flag and two examples are atomic and idempotent across concurrent requests", async () => {
  expect(await (await call("/templates/welcome")).json()).toEqual({ eligible: true });
  const responses = await Promise.all([call("/templates/welcome", "POST"), call("/templates/welcome", "POST")]);
  expect(responses.map(response => response.status)).toEqual([303, 303]);
  expect(responses[0].headers.get("location")).toBe(responses[1].headers.get("location"));
  const receipt = sqlite.query("SELECT value FROM feature_templates_state WHERE key = 'examples'").get() as { value: string };
  const pages = JSON.parse(receipt.value);
  expect(pages).toHaveLength(2);
  expect(sqlite.query("SELECT COUNT(*) AS n FROM pages").get()).toEqual({ n: 2 });
  for (const page of pages) expect((await (await call("/page/" + page.slug)).json()).blocks.length).toBeGreaterThan(5);
  expect(await (await call("/templates/welcome")).json()).toEqual({ eligible: false });
  sqlite.exec("DELETE FROM blocks; DELETE FROM pages");
  expect((await call("/templates/welcome", "POST")).status).toBe(303);
  expect(sqlite.query("SELECT COUNT(*) AS n FROM pages").get()).toEqual({ n: 0 });
});

test("a failed example batch does not consume the first-run flag", async () => {
  await call("/templates/welcome");
  sqlite.exec("CREATE TRIGGER fail_example BEFORE INSERT ON blocks BEGIN SELECT RAISE(ABORT, 'example failure'); END");
  expect((await call("/templates/welcome", "POST")).status).toBe(500);
  expect(sqlite.query("SELECT COUNT(*) AS n FROM feature_templates_state").get()).toEqual({ n: 0 });
  expect(sqlite.query("SELECT COUNT(*) AS n FROM pages").get()).toEqual({ n: 0 });
});

test("existing editor pages suppress onboarding but bundled database seed pages do not", async () => {
  await call("/templates/welcome");
  sqlite.exec("INSERT INTO databases (id, slug, title, icon, parent, ord, created, updated) VALUES ('sseed', 'seed-db', 'Seed', '', NULL, 0, 1, 1); INSERT INTO pages VALUES ('seed-db', 'Seed', NULL, 0, 'db', 1, 'editor', NULL)");
  expect((await (await call("/templates/welcome")).json()).eligible).toBe(true);
  await call("/pages", "POST", { title: "Already here" });
  expect((await (await call("/templates/welcome")).json()).eligible).toBe(false);
  expect((await call("/templates/welcome", "POST")).headers.get("location")).toBe("/");
});

test("home includes an eligible server form and POST redirects without reader scripts", async () => {
  const home = (path = "/") => worker.fetch(new Request("https://notes.test" + path, { headers: { cookie } }), env) as Promise<Response>;
  const first = await home();
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect(await first.text()).toContain('form method="post" action="/api/templates/welcome"');
  expect(await (await home("/home/")).text()).toContain('id="templates-welcome"');
  const result = await worker.fetch(new Request("https://notes.test/api/templates/welcome", { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "" }), env);
  expect(result.status).toBe(303);
  expect(result.headers.get("location")).toMatch(/^\/edit\/example-[^/]+\/$/);
  expect(await (await home()).text()).not.toContain('id="templates-welcome"');
});

test("catalog and onboarding remain behind the signed cookie gate", async () => {
  for (const path of ["/templates", "/templates/welcome"]) {
    expect((await call(path, "GET", undefined, true)).status).toBe(401);
    expect((await call(path, "POST", undefined, true)).status).toBe(401);
  }
});
