import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { assembleWorkerSource } from "./assemble-worker";

const source = assembleWorkerSource();
const picker = readFileSync(new URL("../assets/features/lazy/templates.js", import.meta.url), "utf8");
let sqlite: Database, worker: any, env: any, cookie: string;

beforeEach(async () => {
  setSystemTime(new Date("2026-03-04T15:07:00Z"));
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...values: any[]) => statement(sql, values),
    execute: () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = {
    GATE_PASSWORD: "vars-pw", GATE_SECRET: "vars-secret",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    DB: { prepare: statement, batch: async (statements: ReturnType<typeof statement>[]) => sqlite.transaction(() => statements.map(item => item.execute()))() },
  };
  worker = new Function(source)();
  const login = await worker.fetch(new Request("https://notes.test/__gate", { method: "POST", body: new URLSearchParams({ pw: "vars-pw" }) }), env);
  cookie = login.headers.get("set-cookie").split(";")[0];
});
afterEach(() => { sqlite.close(); setSystemTime(); });

async function call(path: string, method = "GET", body?: unknown) {
  const response = await worker.fetch(new Request("https://notes.test/api" + path, {
    method, headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: response.status, data: await response.json() };
}

test("a personal template fills date, today, time and title in Asia/Seoul and keeps unknown variables", async () => {
  const page = (await call("/pages", "POST", { title: "Source" })).data;
  const blocks = [
    { id: "a", type: "paragraph", text: "{{date}} / {{today}} {{time}}" },
    { id: "b", type: "paragraph", text: "제목: {{title}} {{x}}", meta: { richText: [{ text: "제목: {{title}} {{x}}", bold: true }] } },
  ];
  await call("/page/" + page.slug, "PUT", { title: "회의 {{date}}", blocks, base_updated: page.updated });
  const saved = (await call("/editor/templates", "POST", { slug: page.slug, name: "회의" })).data.template;
  const copy = (await call("/pages", "POST", { title: "회의" })).data;
  expect((await call("/page/" + copy.slug + "/from-template", "POST", { templateId: saved.id })).status).toBe(200);
  const result = (await call("/page/" + copy.slug)).data;
  expect(result.page.title).toBe("회의 2026-03-05");
  expect(result.blocks.map((b: any) => b.text)).toEqual(["2026-03-05 / 2026-03-05 00:07", "제목: 회의 2026-03-05 {{x}}"]);
  expect(result.blocks[1].meta.richText[0].text).toBe("제목: 회의 2026-03-05 {{x}}");
});

test("a built-in template is filled by the picker before it is saved", async () => {
  const create = picker.slice(picker.indexOf("  async function create("), picker.indexOf("  async function open("));
  const calls: any[] = [];
  const context: any = { creating: false, pendingPage: null, location: {}, JSON, encodeURIComponent, Date, Intl,
    dialog: { querySelectorAll: () => [] }, fail: (e: any) => { throw e; },
    editor: { save: async () => {}, api: async (path: string, options: any) => { calls.push({ path, body: JSON.parse(options.body) }); return { slug: "new", updated: 3 }; } },
  };
  runInNewContext(create + "\nthis.create = create;", context);
  await context.create({ name: "일지 {{date}}", blocks: [{ id: "b1", type: "paragraph", text: "{{time}} {{title}} {{nope}}" }] });
  expect(calls[0].body.title).toBe("일지 2026-03-05");
  expect(calls[1].body.title).toBe("일지 2026-03-05");
  expect(calls[1].body.blocks[0].text).toBe("00:07 일지 2026-03-05 {{nope}}");
});

test("the picker shows the variable hint", () => {
  expect(picker).toContain('"{{date}}, {{title}} 같은 변수를 쓸 수 있어요"');
});
