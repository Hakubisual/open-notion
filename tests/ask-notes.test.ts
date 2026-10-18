import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { assembleWorkerSource } from "./assemble-worker";

let sqlite: Database;
let worker: any;
let env: any;
let cookie: string;
let calls: { model: string; input: any }[];
const source = assembleWorkerSource();

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...values: any[]) => statement(sql, values),
    execute: () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    run: async () => statement(sql, params).execute(),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  calls = [];
  env = {
    GATE_PASSWORD: "test-pw", GATE_SECRET: "test-secret",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    DB: { prepare: statement, batch: async (items: ReturnType<typeof statement>[]) => sqlite.transaction(() => items.map(item => item.execute()))() },
    AI: { run: async (model: string, input: any) => { calls.push({ model, input }); return { response: "프로젝트 출시는 금요일이에요. [1]" }; } },
  };
  worker = new Function(source)();
  const login = await worker.fetch(new Request("https://notes.test/__gate", { method: "POST", body: new URLSearchParams({ pw: "test-pw" }) }), env);
  cookie = login.headers.get("set-cookie").split(";")[0];
  expect((await call("/api/tree")).status).toBe(200);
});
afterEach(() => sqlite.close());

function call(path: string, method = "GET", body?: unknown, authenticated = true) {
  return worker.fetch(new Request("https://notes.test" + path, {
    method, headers: { ...(authenticated ? { cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env) as Promise<Response>;
}
const ask = (question: string) => call("/api/ai/ask", "POST", { question });
async function page(slug = "launch", text = "프로젝트 출시는 금요일이에요.", count = 1) {
  expect((await call("/api/pages", "POST", { slug, title: "출시 계획" })).status).toBe(200);
  expect((await call("/api/page/" + slug, "PUT", { title: "출시 계획", blocks: Array.from({ length: count }, (_, i) => ({ id: "source-" + i, type: "paragraph", text })) })).status).toBe(200);
}

test("retrieves real search results and numbered block passages for the prompt", async () => {
  await page();
  const search = await (await call("/api/search?q=" + encodeURIComponent("프로젝트"))).json();
  const response = await ask("프로젝트 출시는 언제인가요?");
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.sources).toEqual([{ n: 1, slug: search.results[0].slug, title: "출시 계획", block_id: "source-0", snippet: "프로젝트 출시는 금요일이에요." }]);
  expect(result.answer).toContain("[1]");
  expect(calls).toHaveLength(1);
  expect(calls[0].model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  expect(JSON.parse(calls[0].input.messages[1].content).passages).toEqual([{ n: 1, title: result.sources[0].title, text: result.sources[0].snippet }]);
});

test("search service controls which pages may become sources", async () => {
  await page("allowed");
  await page("excluded");
  worker = new Function(assembleWorkerSource('registerFeature({ services: { search: async () => [{ slug: "allowed", title: "출시 계획", hit: "프로젝트" }] } });'))();
  const result = await (await ask("프로젝트")).json();
  expect(result.sources.map((row: any) => row.slug)).toEqual(["allowed"]);
});

test("no match and trashed pages skip the model", async () => {
  await page();
  expect(await (await ask("없는단어")).json()).toEqual({ answer: "노트에서 찾지 못했어요", sources: [] });
  expect((await call("/api/page/launch", "DELETE")).status).toBe(200);
  expect((await (await ask("프로젝트")).json()).sources).toEqual([]);
  expect(calls).toHaveLength(0);
});

test("anonymous requests stay behind the cookie gate", async () => {
  expect((await call("/api/ai/ask", "POST", { question: "프로젝트" }, false)).status).toBe(401);
  expect(calls).toHaveLength(0);
});

test("rejects long, empty, malformed and non-POST questions", async () => {
  expect((await ask("가".repeat(501))).status).toBe(413);
  expect((await ask(" ")).status).toBe(400);
  expect((await call("/api/ai/ask", "POST", { question: 3 })).status).toBe(400);
  expect((await call("/api/ai/ask")).status).toBe(405);
  expect(calls).toHaveLength(0);
});

test("requires Workers AI and hides provider exception details", async () => {
  delete env.AI;
  expect((await ask("프로젝트")).status).toBe(503);
  await page();
  env.AI = { run: async () => { throw new Error("private note text"); } };
  const response = await ask("프로젝트");
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private note text");
});

test("limits passages and snippet size and rejects unknown citations", async () => {
  await page("many", "프로젝트 " + "가".repeat(2000), 12);
  const result = await (await ask("프로젝트")).json();
  expect(result.sources).toHaveLength(8);
  expect(result.sources.every((row: any) => row.snippet.length <= 1002)).toBe(true);
  env.AI.run = async () => ({ response: "없는 출처 [99]" });
  expect((await ask("프로젝트")).status).toBe(502);
  env.AI.run = async () => ({ response: "출처 없음" });
  expect((await ask("프로젝트")).status).toBe(502);
});
