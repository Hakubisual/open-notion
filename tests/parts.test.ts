import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAcardMcpServer, OperationFailure } from "../agents/mcp-tools";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { renderBlocks } from "../block-html.js";
import { markdownToBlocks } from "../markdown-blocks.ts";
import { PART_DEFAULTS, PART_RUNTIME, PART_THEMES, partBlockHtml, partSrcdoc, partThemeCss, validatePartData, validatePartTheme } from "../part-html.js";
import { partsChunk, runtimeString, withRuntime } from "../scripts/build-parts.ts";
import { assembleWorkerSource } from "./assemble-worker";

// #38 registered parts + data: default parts render only inside the HTML-block sandbox, agents fill them with data only.
const WORKER_SOURCE = assembleWorkerSource();
const F = "```";

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

let sqlite: Database, env: any, worker: any, writer: string;
const agent = { name: "Claude Code", via: "token" as const, scopes: ["read", "write"] };

async function cookie() {
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "dn_auth=" + expires + "." + mac;
}
async function send(method: string, path: string, body?: unknown, auth: "agent" | "person" | "none" = "agent") {
  const headers: Record<string, string> = auth === "agent" ? { authorization: "Bearer " + writer } : auth === "person" ? { cookie: await cookie() } : {};
  if (body !== undefined) headers["content-type"] = typeof body === "string" ? "text/markdown" : "application/json";
  const res = await worker.fetch(new Request("https://notes.test" + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env);
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, headers: res.headers };
}
const run = (operation: string, input: Record<string, unknown>) => worker.acardHost.run(env, agent, operation, input);
const rows = (slug: string) => (sqlite.query("SELECT id, type, text, meta FROM blocks WHERE page = ? ORDER BY ord").all(slug) as any[]).map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
const version = async (slug: string) => (await send("GET", "/api/v1/pages/" + encodeURIComponent(slug))).data.updated;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  worker = new Function(WORKER_SOURCE)();
  env = { DB: d1(sqlite), GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  await send("GET", "/api/v1/me");
  await ensureAgentSchema(env.DB);
  writer = (await createAgentToken(env.DB, { name: agent.name, scopes: agent.scopes })).token;
});

describe("part rendering", () => {
  test("a part block renders only as an opaque-origin sandbox frame with a no-network CSP, and the page script loads once", () => {
    const md = [F + 'acard-part {"part":"chart","v":1}', '{"labels":["a"],"series":[{"data":[1]}],"title":"<img src=x onerror=alert(1)>"}', F, "", F + 'acard-part {"part":"table","v":1}', '{"columns":["a"],"rows":[]}', F].join("\n");
    const html = renderBlocks(markdownToBlocks(md), { pages: [] });
    const frames = [...html.matchAll(/<iframe[^>]*>/g)].map((m) => m[0]);
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame).toContain('sandbox="allow-scripts"');
      expect(frame).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
      expect(frame).toContain("default-src &#39;none&#39;");
    }
    expect(html.match(/\/lazy\/parts\.js\?v=__PARTS_JS__/g)).toHaveLength(1);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("partRuntime");
  });
  test("data that would close the script tag stays inside the JSON", () => {
    const doc = partSrcdoc("dag", '{"nodes":[{"id":"a","label":"</script><script>alert(1)</script>"}]}');
    expect(doc.match(/<\/script>/g)).toHaveLength(2);
    expect(doc).toContain("\\u003c/script\\u003e");
  });
  test("a part without a name or over 64 KB is not drawn", () => {
    expect(partBlockHtml({ type: "part", text: "{}", meta: {} }, "1")).not.toContain("<iframe");
    expect(partBlockHtml({ type: "part", text: "x".repeat(64 * 1024 + 1), meta: { part: "chart" } }, "1")).not.toContain("<iframe");
  });
  test("every default part's sample passes its own schema, and wrong data is refused with a path", () => {
    for (const part of PART_DEFAULTS) expect(validatePartData(part.schema, part.sample)).toEqual([]);
    const chart = PART_DEFAULTS.find((p) => p.id === "chart")!;
    expect(validatePartData(chart.schema, { labels: ["a"], series: [{ data: ["1"] }] })[0]).toContain("data.series[0].data[0]");
    expect(validatePartData(chart.schema, { labels: ["a"] })[0]).toContain("data.series");
  });
  test("the five default parts draw their data and compute sum/avg/ratio themselves", () => {
    const draw = (part: string, data: unknown) => {
      const box: any = { getAttribute: () => part, innerHTML: "", className: "" };
      const doc: any = { getElementById: (id: string) => (id === "acp" ? box : { textContent: JSON.stringify(data) }), createElement: () => ({}), head: { appendChild() {} } };
      new Function("document", PART_RUNTIME)(doc);
      return box.innerHTML as string;
    };
    const table = draw("table", { columns: ["모델", "호출", "비용"], rows: [["a", 10, 3], ["b", 30, 1]], sum: [1, 2], avg: [1], ratio: 2, unit: "$" });
    expect(table).toContain("합계");
    expect(table).toContain("$4");
    expect(table).toContain(">20<");
    expect(table).toContain("75%");
    expect(table).toContain("25%");
    expect(draw("chart", { labels: ["월", "화"], series: [{ data: [2, 6] }] })).toContain("합계 8 · 평균 4 · 최고 화 6");
    expect(draw("badge", { items: [{ label: "끝", value: 3, of: 4, state: "ok", badge: "<b>" }] })).toContain("75%");
    expect(draw("badge", { items: [{ label: "끝", value: 3, badge: "<b>" }] })).toContain("&lt;b&gt;");
    expect(draw("heatmap", { rows: ["월"], cols: ["9시", "10시"], values: [[1, null]] })).toContain("가장 많은 칸 월 9시 1");
    expect(draw("dag", { nodes: [{ id: "a", label: "기획", state: "done" }, { id: "b", label: "개발" }], edges: [["a", "b"]] })).toContain("완료 1 / 2 단계 · 50%");
  });
  test("the part runtime is a fixed string that runs on its own, even after the worker bundle (no __name or outer names)", async () => {
    const shipped = readFileSync(new URL("../part-html.js", import.meta.url), "utf8");
    expect(shipped).toBe(withRuntime(shipped, await runtimeString()));
    const box: any = { getAttribute: () => "badge", innerHTML: "", className: "" };
    const doc: any = { getElementById: (id: string) => (id === "acp" ? box : { textContent: '{"items":[{"label":"a","value":1}]}' }), createElement: () => ({}), head: { appendChild() {} } };
    new Function("document", "window", PART_RUNTIME)(doc, {});
    expect(box.innerHTML).toContain("<b>1</b>");
  });
  test("the shipped lazy parts chunk is the current build and stays inside the lazy cap", async () => {
    const shipped = readFileSync(new URL("../assets/features/lazy/parts.js", import.meta.url), "utf8");
    expect(shipped).toBe(await partsChunk());
    expect(shipped.length).toBeLessThanOrEqual(40000);
  });
});

describe("list_parts / set_part_data", () => {
  async function partPage() {
    const md = "# 현황\n\n" + F + 'acard-part {"part":"chart","v":1}\n{"labels":["a"],"series":[{"data":[1]}]}\n' + F + "\n";
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: Parts\n---\n" + md)).data.slug;
    const partId = rows(slug).find((r) => r.type === "part")!.id;
    return { slug, partId };
  }
  test("list_parts returns the five defaults with schemas and a fence to write", async () => {
    const out = await run("listParts", {});
    expect(out.parts.map((p: any) => p.id)).toEqual(["badge", "table", "chart", "heatmap", "dag"]);
    for (const p of out.parts) { expect(p.schema.type).toBe("object"); expect(p.fence).toStartWith("```acard-part {\"part\":\"" + p.id + "\""); }
  });
  test("set_part_data refuses data that does not fit, writes data that does and never touches the code", async () => {
    const { slug, partId } = await partPage();
    await expect(run("setPartData", { page: slug, block_id: partId, data: { labels: ["a"], series: [{ data: ["x"] }] }, expected_version: await version(slug) })).rejects.toThrow("스키마");
    const ok = await run("setPartData", { page: slug, block_id: partId, data: { labels: ["a", "b"], series: [{ data: [4, 5] }] }, expected_version: await version(slug) });
    expect(ok.block_id).toBe(partId);
    const block = rows(slug).find((r) => r.id === partId)!;
    expect(JSON.parse(block.text).series[0].data).toEqual([4, 5]);
    expect(block.meta).toMatchObject({ part: "chart", v: 1 });
    const added = await run("setPartData", { page: slug, part: "dag", data: { nodes: [{ id: "a", label: "A" }] }, after_block_id: partId, expected_version: await version(slug) });
    expect(rows(slug).map((r) => r.type)).toEqual(["heading1", "part", "part"]);
    expect(rows(slug)[2]).toMatchObject({ id: added.block_id, meta: { part: "dag", v: 1 } });
    await expect(run("setPartData", { page: slug, block_id: rows(slug)[0].id, data: {}, expected_version: await version(slug) })).rejects.toThrow("부품 블록이 아니에요");
    await expect(run("setPartData", { page: slug, part: "nope", data: {}, expected_version: await version(slug) })).rejects.toThrow("없는 부품");
    await expect(run("setPartData", { page: slug, block_id: partId, data: { labels: [], series: [] }, expected_version: 1 })).rejects.toThrow("바뀌었어요");
  });
  test("a part a person edited keeps the person's data and the agent's data becomes an update suggestion (#36)", async () => {
    const { slug, partId } = await partPage();
    const page = (await send("GET", "/api/page/" + encodeURIComponent(slug), undefined, "person")).data;
    const personData = '{"labels":["사람"],"series":[{"data":[9]}]}';
    page.blocks.find((b: any) => b.id === partId).text = personData;
    expect((await send("PUT", "/api/page/" + encodeURIComponent(slug), { title: "Parts", blocks: page.blocks, base_updated: page.page.updated }, "person")).status).toBe(200);
    const res = await run("setPartData", { page: slug, block_id: partId, data: { labels: ["agent"], series: [{ data: [1] }] }, expected_version: await version(slug) });
    expect(res.suggestions).toBe(1);
    const block = rows(slug).find((r) => r.id === partId)!;
    expect(block.text).toBe(personData);
    expect(block.meta.human).toBeTruthy();
    expect(JSON.parse(block.meta.suggest.text).labels).toEqual(["agent"]);
  });
  test("both tools are registered on the MCP server with their scopes", async () => {
    const server = createAcardMcpServer(async (operation, input) => {
      try { return await worker.acardHost.run(env, agent, operation, input); } catch (error: any) { throw new OperationFailure(error.message, error.status); }
    }, "test", worker.acardHost.mcpTools);
    const client = new Client({ name: "parts-test", version: "test" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_parts");
    expect(names).toContain("set_part_data");
    const listed = JSON.parse(((await client.callTool({ name: "list_parts", arguments: {} })).content as any)[0].text);
    expect(listed.parts).toHaveLength(5);
    await client.close(); await server.close();
    await expect(worker.acardHost.run(env, { ...agent, scopes: ["read"] }, "setPartData", {})).rejects.toThrow();
  });
});

describe("part themes", () => {
  test("every built-in theme is valid CSS variables only; a theme cannot smuggle code or unknown keys", () => {
    for (const theme of PART_THEMES.filter((t) => t.light || t.dark)) expect(validatePartTheme(theme)).toEqual([]);
    expect(validatePartTheme({ dark: { acc: "red;}</style><script>x()</script>" } })[0]).toContain("dark.acc");
    expect(validatePartTheme({ light: { "background-image": "url(https://x)" } })[0]).toContain("light.background-image");
    expect(partThemeCss({ dark: { acc: "url(https://x)" } })).toBe("");
    const dark = partThemeCss(PART_THEMES.find((t) => t.id === "terminal"));
    expect(dark).toContain(":root[data-theme=light]");
    expect(dark).toContain("--acc:#dbc66f");
  });
  test("a part keeps its theme through markdown and draws with it in the frame", () => {
    const md = F + 'acard-part {"part":"badge","v":1,"theme":"terminal"}\n{"items":[]}\n' + F;
    const [block] = markdownToBlocks(md);
    expect(block.meta).toMatchObject({ part: "badge", theme: "terminal" });
    const html = renderBlocks([block], { pages: [] });
    expect(html).toContain('data-theme-id="terminal"');
    expect(html).toContain("--acc:#dbc66f");
  });
  test("list_parts lists themes; set_part_data sets a theme and refuses an unknown one; a person registers and shares a theme", async () => {
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: T\n---\n" + F + 'acard-part {"part":"chart","v":1}\n{"labels":["a"],"series":[{"data":[1]}]}\n' + F + "\n")).data.slug;
    const id = rows(slug)[0].id;
    expect((await run("listParts", {})).themes.map((t: any) => t.id)).toEqual(["acard", "terminal", "bento", "neon", "paper"]);
    await expect(run("setPartData", { page: slug, block_id: id, theme: "nope", data: { labels: ["a"], series: [{ data: [1] }] }, expected_version: await version(slug) })).rejects.toThrow("없는 테마");
    const kit = await send("POST", "/api/parts/themes", { id: "bong-kit", name: "봉랩 키트", dark: { acc: "#dbc66f", card: "#171826", radius: "0px" } }, "person");
    expect(kit.status).toBe(201);
    expect((await send("POST", "/api/parts/themes", { id: "bad", dark: { acc: "red;}" } }, "person")).status).toBe(400);
    await run("setPartData", { page: slug, block_id: id, theme: "bong-kit", data: { labels: ["a"], series: [{ data: [2] }] }, expected_version: await version(slug) });
    expect(rows(slug)[0].meta).toMatchObject({ part: "chart", theme: "bong-kit" });
    expect((await send("GET", "/api/parts/themes/bong-kit", undefined, "person")).data.css).toContain("--card:#171826");
    expect((await send("POST", "/api/parts/themes/bong-kit/share", { link: true, public: true }, "person")).data).toMatchObject({ shared: true, public: true });
    expect((await run("listParts", {})).themes.map((t: any) => t.id)).toContain("bong-kit");
    expect((await send("GET", "/api/parts/themes", undefined, "none")).status).toBe(401);
  });
});

describe("registering and sharing parts", () => {
  async function htmlPage() {
    const md = F + "html-embed\n<div id=o></div><script>o.textContent = (window.acardPartData || {}).msg</script>\n" + F + "\n";
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: Kit\n---\n" + md)).data.slug;
    return { slug, block: rows(slug)[0].id };
  }
  test("a person registers an HTML block as a part; list_parts shows it and set_part_data checks its schema", async () => {
    const { slug, block } = await htmlPage();
    const made = await send("POST", "/api/parts", { id: "Kit Card", name: "키트 카드", page: slug, block, sample: { msg: "hi" } }, "person");
    expect(made.status).toBe(201);
    expect(made.data).toMatchObject({ id: "kit-card", version: 1, shared: false, public: false, source: slug + "#" + block });
    expect(made.data.code).toBeUndefined();
    const list = await run("listParts", {});
    expect(list.parts.map((p: any) => p.id)).toContain("kit-card");
    const again = await send("POST", "/api/parts", { id: "kit-card", page: slug, block, sample: { msg: "x" } }, "person");
    expect(again.data.version).toBe(2);
    expect((await send("GET", "/api/parts/kit-card", undefined, "person")).data.code).toContain("acardPartData");
    await run("setPartData", { page: slug, part: "kit-card", data: { msg: "ok" }, expected_version: await version(slug) });
    await expect(run("setPartData", { page: slug, part: "kit-card", data: { msg: 3 }, expected_version: await version(slug) })).rejects.toThrow("스키마");
    expect((await send("POST", "/api/parts", { id: "chart", code: "<p>x</p>" }, "person")).status).toBe(409);
    expect((await send("POST", "/api/parts", { id: "x", code: "<p>x</p>" }, "person")).status).toBe(400);
    const para = (await send("POST", "/api/v1/pages", "---\ntitle: P\n---\n그냥 글\n")).data.slug;
    expect((await send("POST", "/api/parts", { id: "para", page: para, block: rows(para)[0].id }, "person")).status).toBe(400);
  });
  test("a share link exposes only that part's code and schema; turning it off or marking public works; agents and anonymous callers cannot reach the human API", async () => {
    const { slug, block } = await htmlPage();
    await send("POST", "/api/parts", { id: "kit", page: slug, block, sample: { msg: "hi" } }, "person");
    const shared = await send("POST", "/api/parts/kit/share", { link: true, public: true }, "person");
    expect(shared.data).toMatchObject({ shared: true, public: true });
    expect(shared.data.url).toMatch(/^\/p\/[A-Za-z0-9_-]{43}\/acard-part\.json$/);
    const open = await send("GET", shared.data.url, undefined, "none");
    expect(open.status).toBe(200);
    expect(open.data).toMatchObject({ id: "kit", name: "kit", schema: { type: "object" } });
    expect(open.data.code).toContain("acardPartData");
    expect(open.data.owner).toBeUndefined();
    expect(open.headers.get("cache-control")).toBe("private, no-store");
    const off = await send("POST", "/api/parts/kit/share", { link: false, public: false }, "person");
    expect(off.data).toMatchObject({ shared: false, public: false });
    expect((await send("GET", shared.data.url, undefined, "none")).status).toBe(404);
    expect((await send("GET", "/api/parts", undefined, "none")).status).toBe(401);
    expect((await send("GET", "/p/" + "A".repeat(43) + "/acard-part.json", undefined, "none")).status).toBe(404);
  });
});

describe("published and link pages", () => {
  test("a part on a published page loads its frame from /frame/<id> with the code inside and the sandbox CSP header", async () => {
    const md = "# 공개\n\n" + F + 'acard-part {"part":"badge","v":1}\n{"items":[{"label":"끝","value":1}]}\n' + F + "\n";
    const slug = (await send("POST", "/api/v1/pages", "---\ntitle: Pub\n---\n" + md)).data.slug;
    const partId = rows(slug).find((r) => r.type === "part")!.id;
    const link = await send("POST", "/api/page/" + encodeURIComponent(slug) + "/share", undefined, "person");
    expect(link.status).toBe(201);
    const page = await worker.fetch(new Request("https://notes.test" + link.data.url), env);
    const html = await page.text();
    expect(html).toContain('src="' + link.data.url + "/frame/" + partId + '"');
    expect(html).not.toContain("/lazy/parts.js");
    const frame = await worker.fetch(new Request("https://notes.test" + link.data.url + "/frame/" + partId), env);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(frame.headers.get("content-security-policy")).toContain("default-src 'none'");
    const doc = await frame.text();
    expect(doc).toContain("data-part=\"badge\"");
    // The code a published frame runs must work on its own: no bundler helpers (__name) or names from outside the frame.
    const code = JSON.parse(/go\(\{acpCode:("(?:[^"\\]|\\.)*")/.exec(doc)![1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
    const box: any = { getAttribute: () => "badge", innerHTML: "", className: "" };
    const fakeDoc: any = { getElementById: (id: string) => (id === "acp" ? box : { textContent: '{"items":[{"label":"끝","value":1}]}' }), createElement: () => ({}), head: { appendChild() {} } };
    new Function("document", "window", "__name", code)(fakeDoc, {}, undefined);
    expect(box.innerHTML).toContain("<b>1</b>");
  });
});

// #58: flows were written as stacked white HTML cards because dag could not hold step details.
describe("flow diagrams (dag) and the HTML block guard", () => {
  const draw = (data: unknown) => {
    const box: any = { getAttribute: () => "dag", innerHTML: "", className: "", querySelector: () => null };
    const doc: any = { getElementById: (id: string) => (id === "acp" ? box : { textContent: JSON.stringify(data) }), createElement: () => ({}), head: { appendChild() {} } };
    new Function("document", PART_RUNTIME)(doc);
    return box.innerHTML as string;
  };
  const flow = { title: "전체 흐름", numbered: true, callout: { title: "점진 개선 루프", text: "10건마다 기준을 고친다" }, nodes: [
    { id: "a", label: "레퍼런스 이미지", desc: "ima2로 씬 시안", tags: [{ text: "ima2 API", kind: "api" }, { text: "오너 선택", kind: "person" }], gate: "룩 기준 1장 확정" },
    { id: "b", label: "배치 구상", desc: "블록 레이아웃 <스케치>", items: ["LED 4:1"], tags: ["에이전트"], gate: "카메라 확정" },
    { id: "c", label: "에셋 분해 + 판정 단계 이름이 아주 긴 경우" }], edges: [["a", "b"], ["b", "c", "오너 OK"]] };
  test("a flow draws every step as a card with its number, full label, description, items, tags, gate and the callout", () => {
    const html = draw(flow);
    expect(validatePartData(PART_DEFAULTS.find((p) => p.id === "dag")!.schema, flow)).toEqual([]);
    expect(html.match(/class="fn /g)?.length).toBe(3);
    expect(html).toContain('<span class="no">1</span>');
    expect(html).toContain("<b>에셋 분해 + 판정 단계 이름이 아주 긴 경우</b>");
    expect(html).toContain("<p>블록 레이아웃 &lt;스케치&gt;</p>");
    expect(html).toContain("<li>LED 4:1</li>");
    expect(html).toContain('<span class="t api">ima2 API</span>');
    expect(html).toContain('<span class="t person">오너 선택</span>');
    expect(html).toContain('<div class="gt">룩 기준 1장 확정</div>');
    expect(html).toContain('<div class="co"><b>점진 개선 루프</b>: 10건마다 기준을 고친다</div>');
    expect(html).toContain('data-cols="3"');
    expect(html).toContain('data-edges="[[&quot;a&quot;,&quot;b&quot;,&quot;&quot;],[&quot;b&quot;,&quot;c&quot;,&quot;오너 OK&quot;]]"');
    expect(html).not.toContain("완료 0");
  });
  test("branches and merges share a column; old dag data without details still draws with its done ratio", () => {
    const html = draw({ nodes: [{ id: "s", label: "시작", state: "done" }, { id: "x", label: "갈래 1" }, { id: "y", label: "갈래 2" }, { id: "m", label: "합류" }], edges: [["s", "x"], ["s", "y"], ["x", "m"], ["y", "m"]] });
    expect(html).toContain('data-cols="3"');
    expect(html).toMatch(/<div class="fc"><div class="fn " data-id="x">[\s\S]*data-id="y"/);
    expect(html).toContain("완료 1 / 4 단계 · 25%");
  });
  test("the frame lays out cards and arrows, left to right when wide and top-down when narrow", () => {
    const css = PART_RUNTIME;
    expect(css).toContain(".fl.st{grid-auto-flow:row");
    expect(css).toContain("--font:'Acard Part'");
    expect(css).not.toMatch(/\.fn\{[^}]*background:#fff/);
  });
  test("writing an HTML block with fixed white boxes or a stacked card flow returns a warning naming the part; themed HTML does not", async () => {
    const white = F + "html-embed\n<style>.st{background:#fff;color:#1d1d1f}</style><div class=\"st\">1 레퍼런스</div><div class=\"ar\">▼</div><div class=\"st\">2 배치</div>\n" + F;
    const themed = F + "html-embed\n<div class=\"card\" style=\"background:var(--bg-soft);color:var(--fg)\">a</div>\n" + F;
    const created = await run("createPage", { title: "흐름", markdown: "# 흐름\n\n" + white });
    expect(created.htmlWarnings?.[0].warning).toContain("dag");
    const clean = await run("createPage", { title: "테마", markdown: themed });
    expect(clean.htmlWarnings).toBeUndefined();
    const appended = await run("appendToPage", { slug: clean.slug, markdown: white });
    expect(appended.htmlWarnings).toHaveLength(1);
    const read = await run("readBlocks", { page: clean.slug });
    const inserted = await run("insertBlocks", { page: clean.slug, after_block_id: null, markdown: white, expected_version: read.version });
    expect(inserted.htmlWarnings?.[0].block_id).toBe(inserted.block_ids[0]);
    const read2 = await run("readBlocks", { page: clean.slug });
    const themedId = read2.blocks.find((b: any) => b.type === "html" && b.text.includes("var(--bg-soft)")).id;
    const patched = await run("patchBlock", { page: clean.slug, block_id: themedId, edits: [{ find: "var(--bg-soft)", replace: "#ffffff" }], expected_version: read2.version });
    expect(patched.htmlWarnings?.[0].warning).toContain("배경색");
    const read3 = await run("readBlocks", { page: clean.slug });
    const fixed = await run("updateBlock", { page: clean.slug, block_id: themedId, markdown: themed, expected_version: read3.version });
    expect(fixed.htmlWarnings).toBeUndefined();
    const page = await run("readPage", { slug: clean.slug });
    const updated = await run("updatePage", { slug: clean.slug, markdown: themed + "\n\n" + white, expectedUpdated: page.updated });
    expect(updated.htmlWarnings).toHaveLength(1);
  });
  test("list_parts and the MCP instructions send flows to the dag part with a filled example", async () => {
    const out = await run("listParts", {});
    const dag = out.parts.find((p: any) => p.id === "dag");
    expect(validatePartData(dag.schema, dag.sample)).toEqual([]);
    const first = dag.sample.nodes[0];
    expect([typeof first.desc, typeof first.gate, Array.isArray(first.tags), typeof dag.sample.callout.text]).toEqual(["string", "string", true, "string"]);
    expect(dag.description).toContain("Never hand-write");
  });
});
