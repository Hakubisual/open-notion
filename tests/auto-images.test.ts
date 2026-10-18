import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assembleWorkerSource } from "./assemble-worker";

const source = assembleWorkerSource();
const writer = { name: "Image agent", via: "token" as const, scopes: ["read", "write"] };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const realFetch = globalThis.fetch;
let sqlite: Database, env: any, worker: any, kv: Map<string, any>, hits: string[];
let dns: Record<string, string>, web: Record<string, () => Response>;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  kv = new Map(); hits = [];
  dns = { "img.example.com": "93.184.216.34", "evil.example.com": "10.0.0.5", "hop.example.com": "93.184.216.35" };
  web = {
    "https://img.example.com/cat.png": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
    "https://img.example.com/page.html": () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    "https://img.example.com/big.png": () => new Response(new Uint8Array(5 * 1024 * 1024), { headers: { "content-type": "image/png" } }),
    "https://hop.example.com/r": () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/x.png" } }),
    "https://hop.example.com/loop": () => new Response(null, { status: 302, headers: { location: "https://hop.example.com/loop" } }),
  };
  globalThis.fetch = (async (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    hits.push(url);
    const q = /^https:\/\/cloudflare-dns\.com\/dns-query\?name=([^&]+)&type=(A|AAAA)$/.exec(url);
    if (q) {
      const ip = dns[decodeURIComponent(q[1])];
      return Response.json({ Answer: ip && q[2] === "A" ? [{ type: 1, data: ip }] : [] });
    }
    return web[url] ? web[url]() : new Response("nope", { status: 404 });
  }) as typeof fetch;
  const statement = (sql: string, params: any[] = []) => ({
    bind: (...next: any[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...params).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...params) }),
    first: async () => sqlite.query(sql).get(...params) ?? null,
  });
  env = { GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    MEDIA: { put: async (key: string, value: ArrayBuffer, options: any) => { kv.set(key, { value, ...options }); } },
    DB: { prepare: statement, batch: async (list: ReturnType<typeof statement>[]) => { const out = []; for (const s of list) out.push(await s.run()); return out; } } };
  worker = new Function(source)();
  await worker.acardHost.run(env, writer, "whoami", {});
});

afterEach(() => { globalThis.fetch = realFetch; sqlite.close(); });

const run = (op: string, input: any) => worker.acardHost.run(env, writer, op, input);
const srcs = async (slug: string) => (await run("readPage", { slug })).markdown.match(/!\[[^\]]*\]\([^)]+\)/g);

test("create_page rewrites an https image and a data: URI to /media/ and keeps the source", async () => {
  const data = "data:image/png;base64," + Buffer.from(PNG).toString("base64");
  const made = await run("createPage", { slug: "pics", title: "Pics", markdown: `![고양이](https://img.example.com/cat.png)\n\n![점](${data})` });
  expect(made.imageWarnings).toBeUndefined();
  const lines = await srcs("pics");
  expect(lines).toHaveLength(2);
  for (const line of lines) expect(line).toMatch(/\]\(\/media\/[0-9a-f]{16}\)$/);
  const sources = [...kv.values()].map((v) => v.metadata.source);
  expect(sources).toContain("https://img.example.com/cat.png");
  expect(sqlite.query("SELECT COUNT(*) AS n FROM media WHERE page = 'pics'").get()).toEqual({ n: 2 });
});

test("private IPs, IP literals, localhost and private redirects are refused without failing the write", async () => {
  const md = ["https://evil.example.com/a.png", "http://127.0.0.1/a.png", "http://169.254.169.254/latest", "http://localhost/a.png", "https://hop.example.com/r", "http://[::1]/a.png"]
    .map((u) => `![x](${u})`).join("\n\n");
  const made = await run("createPage", { slug: "bad", title: "Bad", markdown: md });
  expect(made.imageWarnings).toHaveLength(6);
  expect(kv.size).toBe(0);
  expect(hits.some((u) => /evil\.example\.com\/x\.png|127\.0\.0\.1|169\.254|localhost|\[::1\]/.test(u) && !u.includes("dns-query"))).toBe(false);
  expect((await srcs("bad"))[0]).toBe("![x](https://evil.example.com/a.png)");
});

test("non-image bytes, oversized files and redirect loops leave the link and warn", async () => {
  const made = await run("createPage", { slug: "odd", title: "Odd", markdown: "![a](https://img.example.com/page.html)\n\n![b](https://img.example.com/big.png)\n\n![c](https://hop.example.com/loop)" });
  expect(made.imageWarnings.map((w: any) => w.error)).toEqual([expect.stringContaining("이미지만"), expect.stringContaining("4MB"), expect.stringContaining("리다이렉트")]);
  expect(kv.size).toBe(0);
});

test("local paths are not fetched; the warning tells the agent to use upload_media", async () => {
  const made = await run("createPage", { slug: "loc", title: "Loc", markdown: "![s](./shot.png)\n\n![w](C:\\Users\\me\\a.png)" });
  expect(made.imageWarnings).toHaveLength(2);
  expect(made.imageWarnings[0].error).toContain("upload_media");
});

test("append and insert_blocks import images too", async () => {
  await run("createPage", { slug: "p", title: "P", markdown: "first" });
  await run("appendToPage", { slug: "p", markdown: "![a](https://img.example.com/cat.png)" });
  const read = await run("readBlocks", { page: "p" });
  await run("insertBlocks", { page: "p", after_block_id: null, markdown: "![b](https://img.example.com/cat.png)", expected_version: read.version });
  for (const line of await srcs("p")) expect(line).toMatch(/\/media\//);
});

test("SVG sanitizer strips scripts, foreignObject, handlers and outside references", () => {
  let services: any = {};
  new Function("registerFeature", "isBlockedHost", readFileSync(import.meta.dir + "/../features/auto-images.js", "utf8"))((def: any) => { services = def.services; }, () => false);
  const clean = services.sanitizeSvg;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><rect width="1" height="1" onclick="x()"/></a><image href="https://evil.test/t.png"/><use href="#ok"/></svg>';
  const out = clean(svg);
  expect(out).not.toMatch(/script|foreignObject|onload|onclick|javascript:|evil\.test/i);
  expect(out).toContain('href="#ok"');
  expect(out).toContain("<rect");
});

test("a page-less upload is claimed by the page that uses it", async () => {
  const form = new FormData();
  form.set("file", new File([PNG], "shot.png", { type: "image/png" }));
  const { createAgentToken } = await import("../agent-api.js");
  const token = (await createAgentToken(env.DB, { name: "w", scopes: ["read", "write"] })).token;
  const res = await worker.fetch(new Request("https://notes.test/api/v1/media", { method: "POST", headers: { authorization: "Bearer " + token }, body: form }), env);
  expect(res.status).toBe(201);
  const { id } = await res.json();
  expect(sqlite.query("SELECT page FROM media WHERE id = ?").get(id)).toEqual({ page: null });
  await run("createPage", { slug: "claim", title: "C", markdown: "![s](/media/" + id + ")" });
  expect(sqlite.query("SELECT page FROM media WHERE id = ?").get(id)).toEqual({ page: "claim" });
});
