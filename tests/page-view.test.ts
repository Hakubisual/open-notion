import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

// Owner pick (draft A, 2026-10-20): a page is a folder or an article, a person decides; agents never write into a
// folder; the migration moves only agent-written long bodies into a 개요 sub-page and undo puts them back.
const WORKER_SOURCE = assembleWorkerSource();

function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...(params as any[])) }),
    first: async () => sqlite.query(sql).get(...(params as any[])) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => {
      sqlite.exec("BEGIN");
      try { const out = []; for (const item of list) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

let sqlite: Database, worker: any, env: any, writer: string;
async function cookie() {
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "dn_auth=" + expires + "." + mac;
}
async function send(method: string, path: string, body?: unknown, auth: "agent" | "person" = "agent") {
  const headers: Record<string, string> = auth === "agent" ? { authorization: "Bearer " + writer } : { cookie: await cookie(), accept: "text/html" };
  if (body !== undefined) headers["content-type"] = typeof body === "string" ? "text/markdown" : "application/json";
  const res = await worker.fetch(new Request("https://notes.test" + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env);
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}
const LONG = "이 프로젝트는 콘서트 VJ 작업을 정리한 문서예요. ".repeat(20);
const page = (title: string, md: string, parent?: string) => send("POST", "/api/v1/pages", "---\ntitle: " + title + (parent ? "\nparent: " + parent : "") + "\n---\n" + md);
const kids = (slug: string) => sqlite.query("SELECT slug, title FROM pages WHERE parent = ? ORDER BY ord").all(slug) as any[];
const body = (slug: string) => (sqlite.query("SELECT text FROM blocks WHERE page = ? ORDER BY ord").all(slug) as any[]).map((r) => r.text).join("\n");
const reader = async (slug: string) => (await send("GET", "/" + encodeURIComponent(slug) + "/", undefined, "person")).data as string;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  const db = d1(sqlite);
  env = { DB: db, GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  worker = new Function(WORKER_SOURCE)();
  await ensureAgentSchema(db as any);
  writer = (await createAgentToken(db as any, { name: "Codex", scopes: ["read", "write"] })).token;
  await send("GET", "/api/tree", undefined, "person");
});

test("a page with sub-pages and a short body opens as a folder of cards; a long body stays an article until a person chooses", async () => {
  const proj = (await page("샘플프로젝트 Pulse VJ", "2026 콘서트 VJ 작업 모음")).data.slug;
  await page("씬별 시안", "씬마다 시안과 레퍼런스", proj);
  await page("작업 구성도", "전체 흐름", proj);
  let html = await reader(proj);
  expect(html).toContain('data-view-mode="folder"');
  expect(html).toContain("2026 콘서트 VJ 작업 모음");
  expect(html).toContain("페이지 2개");
  expect(html.match(/class="fv-card"/g)?.length).toBe(2);
  expect(html).toContain('data-fv-mode="article"');

  const doc = (await page("긴 글", LONG)).data.slug;
  await page("부록", "부록", doc);
  html = await reader(doc);
  expect(html).not.toContain('data-view-mode="folder"');
  expect(html).toContain("콘서트 VJ 작업을 정리한 문서");
  expect((await send("PUT", "/api/page/" + encodeURIComponent(doc) + "/view", { mode: "folder" }, "person")).status).toBe(200);
  expect(await reader(doc)).toContain('data-view-mode="folder"');
  expect((await send("PUT", "/api/page/" + encodeURIComponent(doc) + "/view", { mode: "article" }, "person")).status).toBe(200);
  expect(await reader(doc)).not.toContain('data-view-mode="folder"');
});

test("an agent writes into an article as before, never into a page a person set to folder, and cannot override the person's choice", async () => {
  const proj = (await page("프로젝트", "짧은 설명")).data.slug;
  await page("하위", "하위 글", proj);
  expect((await send("PUT", "/api/page/" + encodeURIComponent(proj) + "/view", { mode: "folder" }, "person")).status).toBe(200);
  const read = (await send("GET", "/api/v1/pages/" + encodeURIComponent(proj))).data;
  const update = await send("PUT", "/api/v1/pages/" + encodeURIComponent(proj), { markdown: LONG, expectedUpdated: read.updated });
  expect(update.status).toBe(409);
  expect(String(update.data.error)).toContain("하위 페이지");
  expect((await send("POST", "/api/v1/pages/" + encodeURIComponent(proj) + "/append", { markdown: "더 쓰기" })).status).toBe(409);
  expect(body(proj)).toBe("짧은 설명");
  expect((await send("PUT", "/api/v1/pages/" + encodeURIComponent(proj) + "/view", { mode: "article" })).status).toBe(409);

  expect((await send("PUT", "/api/page/" + encodeURIComponent(proj) + "/view", { mode: "article" }, "person")).status).toBe(200);
  const again = (await send("GET", "/api/v1/pages/" + encodeURIComponent(proj))).data;
  expect((await send("PUT", "/api/v1/pages/" + encodeURIComponent(proj), { markdown: "에이전트가 쓴 글", expectedUpdated: again.updated })).status).toBe(200);
  expect(body(proj)).toBe("에이전트가 쓴 글");
});

test("create_page with view: folder makes a folder with its description", async () => {
  const made = await send("POST", "/api/v1/pages", { title: "새 프로젝트", markdown: "> [!summary] 세 줄 요약\n\n" + LONG, view: "folder", description: "한 줄 설명" });
  expect(made.status).toBe(201);
  expect(body(made.data.slug)).toBe("");
  await page("메모", "메모", made.data.slug);
  const html = await reader(made.data.slug);
  expect(html).toContain('data-view-mode="folder"');
  expect(html).toContain("한 줄 설명");
});

test("migration moves only agent-written long bodies into a 개요 sub-page, keeps a person's body, and undo restores both ways", async () => {
  const agentProj = (await page("에이전트 프로젝트", LONG)).data.slug;
  await page("씬별 시안", "시안", agentProj);
  const personProj = (await page("사람 프로젝트", LONG)).data.slug;
  await page("하위", "하위", personProj);
  const p = (await send("GET", "/api/page/" + encodeURIComponent(personProj), undefined, "person")).data;
  p.blocks[0].text = "사람이 고친 " + p.blocks[0].text;
  expect((await send("PUT", "/api/page/" + encodeURIComponent(personProj), { title: p.page?.title ?? "사람 프로젝트", blocks: p.blocks, base_updated: p.page.updated }, "person")).status).toBe(200);
  const rawOnly = (await page("정리본", LONG)).data.slug;
  await page("AI 원본 노트 - 정리본", "원문", rawOnly);

  const dryRes = await send("POST", "/api/page-view/migrate", { dry: true }, "person");
  expect(dryRes.status).toBe(200);
  const dry = dryRes.data;
  expect(dry.moved.map((m: any) => m.slug)).toEqual([agentProj]);
  expect(kids(agentProj).length).toBe(1);

  const run = (await send("POST", "/api/page-view/migrate", {}, "person")).data;
  expect(run.moved.map((m: any) => m.slug)).toEqual([agentProj]);
  expect(run.kept.map((k: any) => k.slug)).toContain(personProj);
  const overview = kids(agentProj).find((k) => k.title === "개요");
  expect(overview).toBeTruthy();
  expect(kids(agentProj)[0].title).toBe("개요");
  expect(body(overview.slug)).toBe(LONG.trim());
  expect(body(agentProj)).toBe("");
  expect(body(personProj)).toContain("사람이 고친");
  expect(body(rawOnly)).toBe(LONG.trim());
  const html = await reader(agentProj);
  expect(html).toContain('data-view-mode="folder"');
  expect(html).toContain("본문이 옮겨진 곳");

  expect((await send("POST", "/api/page-view/undo", { batch: run.batch }, "person")).data.restored).toBe(1);
  expect(body(agentProj)).toBe(LONG.trim());
  expect(kids(agentProj).map((k) => k.title)).toEqual(["씬별 시안"]);
  expect(await reader(agentProj)).not.toContain('data-view-mode="folder"');
});
