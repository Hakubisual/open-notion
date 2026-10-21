import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleWorkerSource } from "./assemble-worker";

mock.module("cloudflare:workers", () => ({ DurableObject: class {}, WorkerEntrypoint: class {} }));

const ROOT = join(import.meta.dir, "..");
const SUPABASE = "https://supa.test";
const OWNER_UID = "00000000-0000-4000-8000-000000000001";
const SECRET_TEXT = "zebra-other-confidential";
const ROOT_MEDIA = "1111111111111111";
const OTHER_MEDIA = "2222222222222222";

function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []): any => ({
    sql, params,
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...(params as any[])) }),
    first: async () => sqlite.query(sql).get(...(params as any[])) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => {
      sqlite.exec("BEGIN");
      try { const out = []; for (const item of list) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

let worker: any;
let env: any;
let owner: Database;
let keyPair: CryptoKeyPair;
let dir: string;
let ownerCookie: string;
const realFetch = globalThis.fetch;
const b64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

async function jwt(sub: string) {
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: "k1", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ sub, email: "owner@test.dev", exp: Math.floor(Date.now() / 1000) + 600, iss: SUPABASE + "/auth/v1", aud: "authenticated", role: "authenticated" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}

type Opts = { cookie?: string; bearer?: string; body?: unknown; form?: Record<string, string>; origin?: string };
async function call(method: string, path: string, opts: Opts = {}) {
  if (method === "PUT" && /^\/api\/page\/[^/]+$/.test(path) && opts.body && typeof opts.body === "object" && !("base_updated" in opts.body)) {
    const page = await call("GET", path, { cookie: opts.cookie });
    opts = { ...opts, body: { ...opts.body, base_updated: page.data?.page?.updated } };
  }
  const headers: Record<string, string> = { accept: "text/html,application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = "Bearer " + opts.bearer;
  if (opts.origin) headers.origin = opts.origin;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.body); }
  if (opts.form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(opts.form).toString(); }
  const res: Response = await worker.fetch(new Request("https://notes.example.com" + path, { method, headers, redirect: "manual", body }), env, {});
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text, headers: res.headers };
}
const asOwner = (method: string, path: string, opts: Opts = {}) => call(method, path, { ...opts, cookie: ownerCookie });

async function invite(slug: string, email: string, role = "read") {
  const made = await asOwner("POST", "/api/page/" + slug + "/access", { body: { email, role } });
  expect(made.status).toBe(201);
  return made.data.invites[0] as { url: string; code: string; rule: string };
}
async function verify(found: { url: string; code: string }, email: string) {
  const done = await call("POST", found.url, { form: { email, code: found.code } });
  expect(done.status).toBe(303);
  const cookie = /acard_guest=([^;]+)/.exec(done.headers.get("set-cookie") ?? "");
  expect(cookie).not.toBeNull();
  expect(done.headers.get("set-cookie")).toContain("HttpOnly");
  expect(done.headers.get("set-cookie")).toContain("Secure");
  expect(done.headers.get("set-cookie")).toContain("SameSite=Lax");
  expect(done.headers.get("set-cookie")).not.toContain("Domain=");
  return "acard_guest=" + cookie![1];
}

beforeAll(async () => {
  dir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "acard-share-"));
  const core = join(dir, "acard-core.js");
  await writeFile(core, "const __mod = (function () {\n" + assembleWorkerSource() + "\n})();\nexport default __mod;\nexport const acardHost = __mod.acardHost;\n");
  const built = await Bun.build({
    entrypoints: [join(ROOT, "gate", "agent-entry.ts")],
    format: "esm", target: "browser", conditions: ["workerd", "worker", "browser"], external: ["cloudflare:workers"],
    plugins: [{ name: "core", setup(build) { build.onResolve({ filter: /[\\/]acard-core\.js$/ }, () => ({ path: core })); } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const out = join(dir, "worker.mjs");
  await writeFile(out, await built.outputs[0].text());
  worker = (await import(out)).default;

  keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === SUPABASE + "/auth/v1/.well-known/jwks.json") return Response.json({ keys: [{ ...jwk, kid: "k1", alg: "ES256" }] });
    if (url.startsWith(SUPABASE + "/rest/v1/profiles")) return Response.json([{ id: "x", display_name: "t", handle: "t", onboarded_at: "2026-10-16T00:00:00Z" }]);
    if (url.startsWith(SUPABASE)) return Response.json({}, { status: 401 });
    return realFetch(input, init);
  }) as typeof fetch;

  owner = new Database(":memory:");
  const media = new Map<string, Uint8Array>([["media/" + ROOT_MEDIA, new Uint8Array([1])], ["media/" + OTHER_MEDIA, new Uint8Array([2])]]);
  const assets: Record<string, string> = { "/style.css": "body{}", "/tokens.css": ":root{}", "/editor.html": "<html>EDITOR</html>", "/other/index.html": "<html>OWNER STATIC " + SECRET_TEXT + "</html>", "/search-index.json": "[\"" + SECRET_TEXT + "\"]" };
  env = {
    DB: d1(owner),
    MEDIA: {
      get: async (key: string) => media.get(key) ?? null,
      getWithMetadata: async (key: string) => (media.has(key) ? { value: media.get(key)!.buffer, metadata: { mime: "image/png", name: "x.png" } } : { value: null, metadata: null }),
      put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }),
    },
    GATE_PASSWORD: "pw", GATE_SECRET: "secret",
    OWNER_USER_ID: OWNER_UID,
    SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: "anon",
    ASSETS: { fetch: async (request: Request) => {
      const raw = new URL(request.url).pathname;
      const path = raw.endsWith("/") && raw !== "/" ? raw + "index.html" : raw;
      const body = assets[path];
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { headers: { "content-type": path.endsWith(".html") ? "text/html; charset=utf-8" : "text/css" } });
    } },
  };
  ownerCookie = "acard_at=" + (await jwt(OWNER_UID));
  for (const [slug, title, parent] of [["root", "Shared root", null], ["child", "Shared child", "root"], ["grand", "Shared grand", "child"], ["other", "Other " + SECRET_TEXT, null]] as const) {
    expect((await asOwner("POST", "/api/pages", { body: { title, slug, parent } })).status).toBe(200);
  }
  const put = (slug: string, blocks: unknown[]) => asOwner("PUT", "/api/page/" + slug, { body: { blocks } });
  expect((await put("root", [{ id: "r1", type: "paragraph", text: "root body" }, { id: "img", type: "image", text: "", meta: { src: "/media/" + ROOT_MEDIA } }, { id: "lnk", type: "paragraph", text: "see [[other]]" }])).status).toBe(200);
  expect((await put("child", [{ id: "c1", type: "paragraph", text: "child body" }])).status).toBe(200);
  expect((await put("other", [{ id: "o1", type: "paragraph", text: SECRET_TEXT + " see [[root]]" }, { id: "img", type: "image", text: "", meta: { src: "/media/" + OTHER_MEDIA } }])).status).toBe(200);
  owner.query("INSERT INTO media (id, page, name, mime, bytes, created) VALUES (?, 'other', 'o.png', 'image/png', 1, 1)").run(OTHER_MEDIA);
  owner.query("INSERT INTO editor_comments (id, page, text, created, updated) VALUES ('oc', 'other', ?, 1, 1)").run(SECRET_TEXT);
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

describe("sharing", () => {
  test("an invited email proves the code, reads the page and its sub-pages, and nothing else", async () => {
    const found = await invite("root", "Guest@Example.com");
    expect(found.url).toMatch(/^\/s\/o\/i\/[A-Za-z0-9_-]{43}$/);
    expect(found.code).toMatch(/^\d{6}$/);
    expect((await call("GET", "/root/")).status).toBe(303);
    expect((await call("GET", found.url)).text).toContain("코드");
    expect((await call("POST", found.url, { form: { email: "guest@example.com", code: found.code === "000000" ? "111111" : "000000" } })).status).toBe(401);
    expect((await call("POST", found.url, { form: { email: "someone@else.dev", code: found.code } })).status).toBe(401);
    const guest = await verify(found, "guest@example.com");
    expect((await call("POST", found.url, { form: { email: "guest@example.com", code: found.code } })).status).toBe(401);

    const tree = await call("GET", "/api/tree", { cookie: guest });
    expect(tree.data.pages.map((p: any) => p.slug).sort()).toEqual(["child", "grand", "root"]);
    expect(tree.data.pages.find((p: any) => p.slug === "root").parent).toBeNull();
    for (const path of ["/root/", "/child/", "/grand/"]) expect((await call("GET", path, { cookie: guest })).status).toBe(200);
    const page = await call("GET", "/root/", { cookie: guest });
    expect(page.text).toContain("root body");
    expect(page.text).not.toContain(SECRET_TEXT);
    expect((await call("GET", "/other/", { cookie: guest })).status).toBe(401);
    expect((await call("GET", "/api/page/other", { cookie: guest })).status).toBe(401);
    expect(JSON.stringify((await call("GET", "/api/search?q=zebra", { cookie: guest })).data)).not.toContain("other");
    expect((await call("GET", "/media/" + ROOT_MEDIA, { cookie: guest })).status).toBe(200);
    expect((await call("GET", "/media/" + OTHER_MEDIA, { cookie: guest })).status).toBe(401);
    expect((await call("GET", "/api/media/" + ROOT_MEDIA + "/meta", { cookie: guest })).status).toBe(200);
    expect((await call("GET", "/api/media/" + OTHER_MEDIA + "/meta", { cookie: guest })).status).toBe(401);
    expect((await call("GET", "/search-index.json", { cookie: guest })).status).toBe(401);
    expect((await call("GET", "/api/backlinks?slug=root", { cookie: guest })).data).toEqual({ backlinks: [] });
    expect((await call("PUT", "/api/page/root", { cookie: guest, body: { blocks: [] } })).status).toBe(401);
    expect((await call("GET", "/edit/root/", { cookie: guest })).status).toBe(302);
    expect((await call("GET", "/api/page/root/access", { cookie: guest })).data).toEqual({ page: "root", role: "read" });
    expect((await call("POST", "/api/page/root/access", { cookie: guest, body: { email: "x@y.dev", role: "full" } })).status).toBe(401);

    const access = await asOwner("GET", "/api/page/child/access");
    expect(access.data.people).toEqual([expect.objectContaining({ email: "guest@example.com", role: "read", inherited: true })]);
    expect(await asOwner("PATCH", "/api/page/root/access/rules/" + found.rule, { body: { role: "edit" } })).toMatchObject({ status: 200 });
    expect((await call("PUT", "/api/page/child", { cookie: guest, body: { blocks: [{ id: "c1", type: "paragraph", text: "edited by guest" }] } })).status).toBe(200);
    expect((await asOwner("GET", "/api/page/child")).data.blocks[0].text).toBe("edited by guest");
    expect((await call("PUT", "/api/page/other", { cookie: guest, body: { blocks: [] } })).status).toBe(401);
    expect((await call("POST", "/api/page/child/move", { cookie: guest, body: { parent: "other" } })).status).toBe(401);
    expect((await call("DELETE", "/api/page/root", { cookie: guest })).status).toBe(401);

    expect((await asOwner("DELETE", "/api/page/root/access/rules/" + found.rule)).status).toBe(200);
    expect((await call("GET", "/root/", { cookie: guest })).status).toBe(401);
    expect((await call("GET", "/api/page/root", { cookie: guest })).status).toBe(401);
  });

  test("sub-pages can stop inheriting and restore it", async () => {
    const found = await invite("root", "inherit@example.com");
    const guest = await verify(found, "inherit@example.com");
    expect((await asOwner("PUT", "/api/page/child/access/settings", { body: { inherit: false } })).status).toBe(200);
    expect((await call("GET", "/child/", { cookie: guest })).status).toBe(401);
    expect((await call("GET", "/grand/", { cookie: guest })).status).toBe(401);
    expect((await asOwner("GET", "/api/page/child/access")).data).toMatchObject({ inherit: false, people: [] });
    expect((await asOwner("PUT", "/api/page/child/access/settings", { body: { inherit: true } })).status).toBe(200);
    expect((await call("GET", "/grand/", { cookie: guest })).status).toBe(200);
    await asOwner("DELETE", "/api/page/root/access/rules/" + found.rule);
  });

  test("anyone with the link reads the page and sub-pages until the link is turned off or expires", async () => {
    const on = await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "link", role: "read" } });
    expect(on.status).toBe(200);
    const url = on.data.link.url as string;
    expect(url).toMatch(/^\/p\/[A-Za-z0-9_-]{43}$/);
    expect((await asOwner("GET", "/api/page/root/access")).data.link.url).toBe(url);
    const page = await call("GET", url);
    expect(page.status).toBe(200);
    expect(page.text).toContain("root body");
    expect(page.text).not.toContain(SECRET_TEXT);
    expect(page.text).toContain(url + "/child/");
    expect((await call("GET", url + "/child/")).status).toBe(200);
    expect((await call("GET", url + "/other/")).status).toBe(404);
    expect((await call("GET", url + "/media/" + ROOT_MEDIA)).status).toBe(200);
    expect((await call("GET", url + "/media/" + OTHER_MEDIA)).status).toBe(404);
    expect((await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "link", role: "read", expires: Date.now() - 1000 } })).status).toBe(200);
    expect((await call("GET", url)).status).toBe(401);
    expect((await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "invited" } })).status).toBe(200);
    expect((await call("GET", url)).status).toBe(401);
  });

  // #61: shared pages sent every original image (31 JPEGs, 7 MB on the owner's page) at full size with no dimensions.
  test("a link page draws components with their styles and an unknown block as a fallback card (ds10)", async () => {
    const blocks = [{ id: "r1", type: "paragraph", text: "root body" }, { id: "u1", type: "component", text: '{"label":"방문","value":"1,284","delta":"+8%"}', meta: { ui: "stat" } }, { id: "u2", type: "component", text: "{ bad", meta: { ui: "stat" } }, { id: "u3", type: "future_block", text: "", meta: null }];
    expect((await asOwner("PUT", "/api/page/root", { body: { blocks } })).status).toBe(200);
    const url = (await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "link", role: "read" } })).data.link.url as string;
    const page = await call("GET", url);
    expect(page.status).toBe(200);
    expect(page.text).toContain('data-ui="stat"');
    expect(page.text).toContain("1,284");
    expect(page.text).toContain('data-ui-invalid="1"');
    expect(page.text).toContain('class="ui-fallback"');
    expect(page.text).toContain(".ui-stat{");
  });

  test("a link page sends sized AVIF/WebP copies with width/height, lazy below the first image, original kept as the link", async () => {
    const on = await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "link", role: "read" } });
    const url = on.data.link.url as string;
    const calls: string[] = [];
    env.IMAGE_RESIZER = { fetch: async (target: string) => {
      calls.push(new URL(target).pathname + new URL(target).search);
      if (target.endsWith("/meta")) return Response.json({ width: 1600, height: 900, format: "image/jpeg", lqip: "data:image/webp;base64,AAAA" });
      return new Response(new Uint8Array([9, 9]), { headers: { "content-type": "image/webp" } });
    } };
    try {
      const blocks = [{ id: "r1", type: "paragraph", text: "root body" }, { id: "img", type: "image", text: "", meta: { src: "/media/" + ROOT_MEDIA } }, { id: "img2", type: "image", text: "", meta: { src: "/media/" + ROOT_MEDIA, width: 50 } }];
      expect((await asOwner("PUT", "/api/page/root", { body: { blocks } })).status).toBe(200);
      const page = await call("GET", url);
      expect(page.status).toBe(200);
      const imgs = [...page.text.matchAll(/<img [^>]*src="[^"]*\/media\/[^>]*>/g)].map((m) => m[0]);
      expect(imgs.length).toBe(2);
      for (const img of imgs) {
        expect(img).toContain('width="1600"');
        expect(img).toContain('height="900"');
        expect(img).toContain(url + "/media/" + ROOT_MEDIA + "/480.webp 480w, " + url + "/media/" + ROOT_MEDIA + "/960.webp 960w, " + url + "/media/" + ROOT_MEDIA + "/1440.webp 1440w\"");
        expect(img).toContain("sizes=");
      }
      expect(imgs[0]).toContain('loading="eager"');
      expect(imgs[0]).toContain("data:image/webp;base64,AAAA");
      expect(imgs[1]).toContain('loading="lazy"');
      expect(imgs[1]).toContain("calc(0.5 * 760px)");
      expect(page.text).toContain('<source type="image/avif" srcset="' + url + "/media/" + ROOT_MEDIA + "/480.avif 480w");
      expect(page.text).toContain('href="' + url + "/media/" + ROOT_MEDIA + '"');
      expect(page.text).not.toContain('"/media/' + ROOT_MEDIA);
      expect(page.text).not.toContain(" /media/" + ROOT_MEDIA);
      const variant = await call("GET", url + "/media/" + ROOT_MEDIA + "/960.webp");
      expect(variant.status).toBe(200);
      expect(variant.headers.get("content-type")).toBe("image/webp");
      expect(variant.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(calls).toContain("/resize?w=960&f=webp");
      expect((await call("GET", url + "/media/" + OTHER_MEDIA + "/960.webp")).status).toBe(404);
      expect((await call("GET", url + "/media/" + ROOT_MEDIA + "/123.webp")).status).toBe(404);
    } finally {
      delete env.IMAGE_RESIZER;
      await asOwner("PUT", "/api/page/root", { body: { blocks: [{ id: "r1", type: "paragraph", text: "root body" }, { id: "img", type: "image", text: "", meta: { src: "/media/" + ROOT_MEDIA } }, { id: "lnk", type: "paragraph", text: "see [[other]]" }] } });
    }
  });

  test("a link page is served from the edge cache until the live feed number moves, then read again", async () => {
    const on = await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "link", role: "read" } });
    const url = on.data.link.url as string;
    const store = new Map<string, Response>();
    let seq = 7;
    (globalThis as any).caches = { default: {
      match: async (key: Request) => store.get(key.url)?.clone() ?? undefined,
      put: async (key: Request, res: Response) => { store.set(key.url, res.clone()); },
    } };
    env.LIVE = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ id: seq }) }) };
    try {
      const first = await call("GET", url);
      expect(first.headers.get("x-acard-share-cache")).toBe("miss");
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      owner.query("UPDATE blocks SET text = 'changed directly' WHERE page = 'root' AND id = 'r1'").run();
      const second = await call("GET", url);
      expect(second.headers.get("x-acard-share-cache")).toBe("hit");
      expect(second.text).toContain("root body");
      seq = 8;
      const third = await call("GET", url);
      expect(third.headers.get("x-acard-share-cache")).toBe("miss");
      expect(third.text).toContain("changed directly");
      expect((await call("GET", url, { cookie: "acard_guest=o." + "A".repeat(43) })).headers.get("x-acard-share-cache")).toBeNull();
    } finally {
      delete (globalThis as any).caches;
      delete env.LIVE;
      owner.query("UPDATE blocks SET text = 'root body' WHERE page = 'root' AND id = 'r1'").run();
    }
  });

  // #57: a dropped Hyperdrive socket on a shared link page answered 500 / Cloudflare 1101 (10 of 40 concurrent on preview).
  test("a dropped database socket on a link page is a 503 retry, not a 500", async () => {
    const on = await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "link", role: "read" } });
    const url = on.data.link.url as string;
    const db = env.DB;
    const lost = () => { throw Object.assign(new Error("write CONNECTION_CLOSED 7fbe.hyperdrive.local:5432"), { code: "CONNECTION_CLOSED" }); };
    const stmt: any = { bind: () => stmt, first: lost, all: lost, run: lost, raw: lost };
    env.DB = { ...db, prepare: () => stmt, batch: lost };
    try {
      const page = await call("GET", url);
      expect(page.status).toBe(503);
      expect(page.headers.get("retry-after")).toBe("2");
    } finally {
      env.DB = db;
    }
    expect((await call("GET", url)).status).toBe(200);
    await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "invited" } });
  });

  test("an HTML block reaches link visitors only inside the sandbox, and only while the link allows it", async () => {
    const put = (slug: string, blocks: unknown[]) => asOwner("PUT", "/api/page/" + slug, { body: { blocks } });
    const before = { root: (await asOwner("GET", "/api/page/root")).data.blocks, other: (await asOwner("GET", "/api/page/other")).data.blocks };
    const html = { id: "h1", type: "html", text: "<b id=chart>chart-on-root</b><script>document.title='x'</script>", meta: { caption: "링크 차트" } };
    expect((await put("root", [...before.root, html])).status).toBe(200);
    expect((await put("other", [...before.other, { ...html, id: "h2", text: "<b>chart-on-other</b>" }])).status).toBe(200);
    const on = await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "link", role: "read" } });
    const url = on.data.link.url as string;
    const page = await call("GET", url);
    expect(page.status).toBe(200);
    const frame = /<iframe[^>]*class="acv-frame"[^>]*>/.exec(page.text)?.[0] ?? "";
    expect(frame).toContain('sandbox="allow-scripts"');
    expect(frame).not.toContain("allow-same-origin");
    expect(frame).not.toContain("srcdoc");
    expect(frame).toContain('src="' + url + '/frame/h1"');
    expect(page.text).not.toContain("chart-on-root");
    expect(page.text).not.toContain("chart-on-other");
    const pageCsp = page.headers.get("content-security-policy") ?? "";
    expect(pageCsp).toContain("frame-src 'self'");
    expect(pageCsp).toMatch(/script-src 'sha256-[A-Za-z0-9+/]+=*';/);
    expect(pageCsp).not.toContain("script-src 'unsafe-inline'");
    const inline = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline.length).toBe(1);
    const digest = new Bun.CryptoHasher("sha256").update(inline[0]).digest("base64");
    expect(pageCsp).toContain("script-src 'sha256-" + digest + "'");
    const doc = await call("GET", url + "/frame/h1");
    expect(doc.status).toBe(200);
    expect(doc.text).toContain("<b id=chart>chart-on-root</b><script>document.title='x'</script>");
    const frameCsp = doc.headers.get("content-security-policy") ?? "";
    expect(frameCsp).toContain("sandbox allow-scripts");
    expect(frameCsp).not.toContain("allow-same-origin");
    expect(frameCsp).toContain("default-src 'none'");
    expect(frameCsp).toContain("frame-ancestors 'self'");
    expect(doc.headers.get("set-cookie")).toBeNull();
    expect((await call("GET", url + "/frame/h2")).status).toBe(404);
    expect((await call("GET", url + "/frame/r1")).status).toBe(404);
    expect((await call("GET", url + "/other/frame/h2")).status).toBe(404);
    expect((await call("GET", url + "/other/")).status).toBe(404);
    expect((await asOwner("PUT", "/api/page/root/access/general", { body: { mode: "invited" } })).status).toBe(200);
    const off = await call("GET", url);
    expect(off.status).toBe(401);
    expect(off.text).not.toContain("chart-on-root");
    expect((await call("GET", url + "/frame/h1")).status).toBe(401);
    expect((await put("root", before.root)).status).toBe(200);
    expect((await put("other", before.other)).status).toBe(200);
  });

  const np5Guests: Record<string, string> = {};
  async function np5Guest(role: "read" | "edit" | "full") {
    if (!np5Guests[role]) np5Guests[role] = await verify(await invite("root", "np5-" + role + "@example.com", role), "np5-" + role + "@example.com");
    return np5Guests[role];
  }

  test("a guest can change a two-way relation only when it may edit both databases (notion-parity-5 C2)", async () => {
    const trips = (await asOwner("POST", "/api/db", { body: { title: "여행", slug: "np5-trips", parent: "root", page: true } })).data;
    const plans = (await asOwner("POST", "/api/db", { body: { title: "일정", slug: "np5-plans", parent: "other", page: true } })).data;
    const rel = (await asOwner("POST", "/api/db/" + plans.slug + "/properties", { body: { name: "여행", type: "relation", config: { database: trips.slug, synced: true }, pairName: "일정" } })).data;
    const trip = (await asOwner("POST", "/api/db/" + trips.slug + "/rows", { body: { props: {} } })).data.row;
    const plan = (await asOwner("POST", "/api/db/" + plans.slug + "/rows", { body: { props: {} } })).data.row;
    const values = async () => [
      (await asOwner("GET", "/api/db/" + trips.slug)).data.rows.find((r: any) => r.id === trip.id).props[rel.pair.id],
      (await asOwner("GET", "/api/db/" + plans.slug)).data.rows.find((r: any) => r.id === plan.id).props[rel.property.id],
    ];
    const reader = await np5Guest("read");
    const denied = await call("PATCH", "/api/db/" + trips.slug + "/rows/" + trip.id, { cookie: reader, body: { props: { [rel.pair.id]: [plan.id] } } });
    expect(denied.status).toBe(401);
    expect(await values()).toEqual([[], []]);
    const editor = await np5Guest("edit");
    const otherSide = await call("PATCH", "/api/db/" + trips.slug + "/rows/" + trip.id, { cookie: editor, body: { props: { [rel.pair.id]: [plan.id] } } });
    expect(otherSide.status).toBe(401);
    expect(await values()).toEqual([[], []]);
    expect((await asOwner("PATCH", "/api/db/" + trips.slug + "/rows/" + trip.id, { body: { props: { [rel.pair.id]: [plan.id] } } })).status).toBe(200);
    expect(await values()).toEqual([[plan.id], [trip.id]]);
    await asOwner("DELETE", "/api/db/" + trips.slug);
    await asOwner("DELETE", "/api/db/" + plans.slug);
  });

  test("an edit guest cannot save or run a button whose target database it may not edit; readers and visitors cannot press at all (notion-parity-7 C3 C4)", async () => {
    const mine = (await asOwner("POST", "/api/db", { body: { title: "내 할 일", slug: "np7-mine", parent: "root", page: true } })).data;
    const theirs = (await asOwner("POST", "/api/db", { body: { title: "남의 기록", slug: "np7-theirs", parent: "other", page: true } })).data;
    const count = async (slug: string) => (await asOwner("GET", "/api/db/" + slug)).data.rows.length;
    const editor = await np5Guest("edit");
    const reader = await np5Guest("read");

    const before = (await asOwner("GET", "/api/page/child")).data.blocks;
    const save = (cookie: string, actions: unknown) => call("GET", "/api/page/child", { cookie }).then((page) =>
      call("PUT", "/api/page/child", { cookie, body: { base_updated: page.data.page.updated, blocks: [...before, { id: "np7", type: "button", text: "추가", meta: { actions } }] } }));
    expect((await save(editor, [{ type: "create_row", database: theirs.slug }])).status).toBe(200);
    expect((await asOwner("GET", "/api/page/child")).data.blocks.find((b: any) => b.id === "np7").meta.actions).toBeUndefined();
    expect((await save(editor, [{ type: "create_row", database: mine.slug }])).status).toBe(200);
    expect((await asOwner("GET", "/api/page/child")).data.blocks.find((b: any) => b.id === "np7").meta.actions).toEqual([{ type: "create_row", database: mine.slug, values: {} }]);
    expect((await call("POST", "/api/page/child/button/np7", { cookie: editor, body: {} })).status).toBe(200);
    expect(await count(mine.slug)).toBe(1);

    expect((await asOwner("PUT", "/api/page/child", { body: { blocks: [...before, { id: "np7", type: "button", text: "추가", meta: { actions: [{ type: "create_row", database: theirs.slug }] } }] } })).status).toBe(200);
    const forbidden = await call("POST", "/api/page/child/button/np7", { cookie: editor, body: {} });
    expect(forbidden.status).toBe(403);
    expect(await count(theirs.slug)).toBe(0);

    const linked = (await asOwner("POST", "/api/db/" + mine.slug + "/properties", { body: { name: "기록", type: "relation", config: { database: theirs.slug } } })).data.property;
    const theirRow = (await asOwner("POST", "/api/db/" + theirs.slug + "/rows", { body: { props: {} } })).data.row;
    const myRow = (await asOwner("POST", "/api/db/" + mine.slug + "/rows", { body: { props: { [linked.id]: [theirRow.id] } } })).data.row;
    const theirTitle = (await asOwner("GET", "/api/db/" + theirs.slug)).data.properties.find((p: any) => p.type === "title").id;
    const related = (await asOwner("POST", "/api/db/" + mine.slug + "/properties", { body: { name: "기록 바꾸기", type: "button", config: { actions: [{ type: "update_related", relation: linked.id, values: { [theirTitle]: "바뀜" } }] } } })).data.property;
    const relatedPress = await call("POST", "/api/db/" + mine.slug + "/rows/" + myRow.id + "/button/" + related.id, { cookie: editor, body: {} });
    expect(relatedPress.status).toBe(403);
    expect((await asOwner("GET", "/api/db/" + theirs.slug)).data.rows[0].pageTitle).not.toBe("바뀜");
    const stealProp = await call("POST", "/api/db/" + mine.slug + "/properties", { cookie: editor, body: { name: "훔치기", type: "button", config: { actions: [{ type: "create_row", database: theirs.slug }] } } });
    expect(stealProp.status).toBe(403);

    const rowsBefore = await count(mine.slug);
    expect((await call("POST", "/api/page/child/button/np7", { cookie: reader, body: {} })).status).toBe(401);
    expect((await call("POST", "/api/db/" + mine.slug + "/rows/" + myRow.id + "/button/" + related.id, { cookie: reader, body: {} })).status).toBe(401);
    expect((await call("POST", "/api/page/child/button/np7", { body: {} })).status).toBe(401);
    expect(await count(mine.slug)).toBe(rowsBefore);
    expect(await count(theirs.slug)).toBe(1);

    expect((await asOwner("PUT", "/api/page/child", { body: { blocks: before } })).status).toBe(200);
    await asOwner("DELETE", "/api/db/" + mine.slug);
    await asOwner("DELETE", "/api/db/" + theirs.slug);
  });

  test("person candidates are this database page's shared emails, all for full, self and assigned for edit, none for read (notion-parity-5 C10)", async () => {
    const team = (await asOwner("POST", "/api/db", { body: { title: "팀 할 일", slug: "np5-team", parent: "root", page: true, properties: [{ id: "title", name: "이름", type: "title" }, { id: "who", name: "담당", type: "person" }] } })).data;
    const schema = (await asOwner("GET", "/api/db/" + team.slug)).data;
    const who = schema.properties.find((p: any) => p.type === "person").id;
    const edit = await np5Guest("edit");
    const read = await np5Guest("read");
    await invite("root", "np5-full@example.com", "full");
    const full = await verify(await invite("root", "np5-full@example.com", "full"), "np5-full@example.com");
    await invite("other", "np5-elsewhere@example.com", "edit");
    const owner = await asOwner("GET", "/api/db/" + team.slug + "/people");
    expect(owner.status).toBe(200);
    const emails = owner.data.people.map((p: any) => p.email);
    expect(emails).toEqual(expect.arrayContaining(["owner@test.dev", "np5-full@example.com", "np5-edit@example.com", "np5-read@example.com"]));
    expect(emails).not.toContain("np5-elsewhere@example.com");
    const asFull = await call("GET", "/api/db/" + team.slug + "/people", { cookie: full });
    expect(asFull.data.people.map((p: any) => p.email).sort()).toEqual([...emails].sort());
    expect((await asOwner("POST", "/api/db/" + team.slug + "/rows", { body: { props: { [who]: ["np5-full@example.com"] } } })).status).toBe(200);
    const asEdit = await call("GET", "/api/db/" + team.slug + "/people", { cookie: edit });
    expect(asEdit.status).toBe(200);
    expect(asEdit.data.people.map((p: any) => p.email).sort()).toEqual(["np5-edit@example.com", "np5-full@example.com"]);
    const blocked = await call("POST", "/api/db/" + team.slug + "/rows", { cookie: edit, body: { props: { [who]: ["np5-read@example.com"] } } });
    expect(blocked.status).toBe(400);
    expect((await call("POST", "/api/db/" + team.slug + "/rows", { cookie: edit, body: { props: { [who]: ["np5-edit@example.com"] } } })).status).toBe(200);
    const asRead = await call("GET", "/api/db/" + team.slug + "/people", { cookie: read });
    expect(asRead.status).toBe(401);
    expect(JSON.stringify(asRead.data)).not.toContain("@example.com");
    await asOwner("DELETE", "/api/db/" + team.slug);
  });

  test("a button round-trips through the agent read_page/update_page operations; actions on a database the token may not write are not saved (notion-parity-7 C3)", async () => {
    const ok = (await asOwner("POST", "/api/db", { body: { title: "할 일", slug: "np7-mcp-ok", parent: "root", page: true } })).data;
    const hidden = (await asOwner("POST", "/api/db", { body: { title: "숨긴 DB", slug: "np7-mcp-hidden", parent: "other", page: true } })).data;
    const made = await asOwner("POST", "/api/agents/tokens", { body: { name: "np7-writer", scopes: ["read", "write"] } });
    const ops: Record<string, (args: any) => [string, string, unknown]> = {
      create_page: (a) => ["POST", "/api/v1/pages", a],
      read_page: (a) => ["GET", "/api/v1/pages/" + encodeURIComponent(a.slug) + "?format=json", undefined],
      update_page: (a) => ["PUT", "/api/v1/pages/" + encodeURIComponent(a.slug), a],
    };
    const tool = (name: string, args: unknown) => { const [m, p, b] = ops[name](args); return call(m, p, { bearer: made.data.token, body: b }); };
    const content = (res: any) => { expect(res.status).toBeLessThan(300); return res.data; };
    const md = (label: string, db: string) => '---\nacard_meta: 1\n---\n\n- [button] ' + label + '\n<!--acard {"actions":[{"type":"create_row","database":"' + db + '"},{"type":"open","target":"created"}],"color":"blue"}-->\n';
    const created = content(await tool("create_page", { title: "np7 버튼", parent: "root", markdown: md("추가", ok.slug) }));
    const read = content(await tool("read_page", { slug: created.slug }));
    expect(read.markdown).toContain("- [button] 추가\n<!--acard ");
    expect(read.markdown).toContain('"database":"' + ok.slug + '"');
    const updated = content(await tool("update_page", { slug: created.slug, markdown: read.markdown.replace("- [button] 추가", "- [button] 할 일 더하기"), expectedUpdated: read.updated }));
    expect(updated.updated).toBe(true);
    const page = (await asOwner("GET", "/api/page/" + encodeURIComponent(created.slug))).data.blocks[0];
    expect(page.text).toBe("할 일 더하기");
    expect(page.meta.actions[0]).toEqual({ type: "create_row", database: ok.slug, values: {} });
    const pressed = await asOwner("POST", "/api/page/" + encodeURIComponent(created.slug) + "/button/" + page.id, { body: {} });
    expect(pressed.status).toBe(200);
    expect((await asOwner("GET", "/api/db/" + ok.slug)).data.rows.length).toBe(1);

    expect((await asOwner("PUT", "/api/page/other/access/agents", { body: { token: made.data.record.id, level: "read" } })).status).toBe(200);
    const sneaky = content(await tool("create_page", { title: "np7 숨김", parent: "root", markdown: md("몰래", hidden.slug) }));
    expect(sneaky.buttons).toContain("버튼 1개");
    const stored = (await asOwner("GET", "/api/page/" + encodeURIComponent(sneaky.slug))).data.blocks[0];
    expect(stored.meta.actions).toBeUndefined();
    expect(stored.meta.color).toBe("blue");

    await asOwner("PUT", "/api/page/other/access/agents", { body: { token: made.data.record.id, level: "inherit" } });
    await asOwner("DELETE", "/api/agents/tokens/" + made.data.record.id);
    for (const slug of [created.slug, sneaky.slug]) owner.query("DELETE FROM pages WHERE slug = ?").run(slug);
    await asOwner("DELETE", "/api/db/" + ok.slug);
    await asOwner("DELETE", "/api/db/" + hidden.slug);
  });

  test("agent tokens are narrowed per page and never widened", async () => {
    const made = await asOwner("POST", "/api/agents/tokens", { body: { name: "writer", scopes: ["read", "write"] } });
    const reader = await asOwner("POST", "/api/agents/tokens", { body: { name: "reader", scopes: ["read"] } });
    const blocks = await call("GET", "/api/v1/pages/root/blocks", { bearer: made.data.token });
    expect(blocks.status).toBe(200);
    const edit = (token: string, version: number) => call("PATCH", "/api/v1/pages/root/blocks/r1", { bearer: token, body: { markdown: "agent edit", expected_version: version } });
    expect((await asOwner("PUT", "/api/page/root/access/agents", { body: { token: made.data.record.id, level: "read" } })).status).toBe(200);
    expect((await edit(made.data.token, blocks.data.version)).status).toBe(403);
    expect((await call("GET", "/api/v1/pages/root", { bearer: made.data.token })).status).toBe(200);
    expect((await asOwner("PUT", "/api/page/root/access/agents", { body: { token: reader.data.record.id, level: "write" } })).status).toBe(200);
    expect((await edit(reader.data.token, blocks.data.version)).status).toBe(403);
    expect((await asOwner("PUT", "/api/page/root/access/agents", { body: { token: made.data.record.id, level: "write" } })).status).toBe(200);
    expect((await edit(made.data.token, blocks.data.version)).status).toBe(200);
    expect((await asOwner("PUT", "/api/page/other/access/agents", { body: { token: made.data.record.id, level: "none" } })).status).toBe(200);
    expect((await call("GET", "/api/v1/pages/other", { bearer: made.data.token })).status).toBe(403);
    expect(JSON.stringify((await call("GET", "/api/v1/pages", { bearer: made.data.token })).data)).not.toContain('"other"');
    const mcp = await call("POST", "/mcp", { bearer: made.data.token, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_page", arguments: { slug: "other" } } } });
    expect(JSON.stringify(mcp.data)).not.toContain(SECRET_TEXT);
    await asOwner("DELETE", "/api/agents/tokens/" + made.data.record.id);
    await asOwner("DELETE", "/api/agents/tokens/" + reader.data.record.id);
  });

  test("moving a page under a shared parent asks for confirmation", async () => {
    const found = await invite("other", "move@example.com");
    const warned = await asOwner("POST", "/api/page/grand/move", { body: { parent: "other" } });
    expect(warned.status).toBe(409);
    expect(warned.data.error).toContain("이 페이지가 공유됩니다");
    expect((await asOwner("POST", "/api/page/grand/move", { body: { parent: "other", confirmShare: true } })).status).toBe(200);
    expect((await asOwner("POST", "/api/page/grand/move", { body: { parent: "child", confirmShare: true } })).status).toBe(200);
    await asOwner("DELETE", "/api/page/other/access/rules/" + found.rule);
  });

  test("someone without access asks for it, the owner approves or denies, and approval opens the page", async () => {
    const anon = await call("POST", "/s/o/r/root", { form: { email: "Ask@Example.com", role: "edit", note: "please" } });
    expect(anon.status).toBe(200);
    expect((await call("POST", "/s/o/r/no-such-page", { form: { email: "ask@example.com" } })).text).toBe(anon.text);
    await call("POST", "/s/o/r/root", { form: { email: "deny@example.com" } });
    const state = await asOwner("GET", "/api/page/root/access");
    const asked = state.data.requests.find((entry: any) => entry.email === "ask@example.com");
    const denied = state.data.requests.find((entry: any) => entry.email === "deny@example.com");
    expect(asked).toMatchObject({ role: "edit", note: "please" });
    expect((await asOwner("POST", "/api/page/root/access/requests/" + denied.id, { body: { decision: "deny" } })).status).toBe(200);
    const approved = await asOwner("POST", "/api/page/root/access/requests/" + asked.id, { body: { decision: "approve" } });
    expect(approved.status).toBe(200);
    expect(approved.data.invite.code).toMatch(/^\d{6}$/);
    const guest = await verify(approved.data.invite, "ask@example.com");
    expect((await call("PUT", "/api/page/child", { cookie: guest, body: { blocks: [{ id: "c1", type: "paragraph", text: "child body" }] } })).status).toBe(200);
    expect((await asOwner("GET", "/api/page/root/access")).data.requests).toEqual([]);
    const denyGuest = await call("GET", "/root/", { cookie: "acard_guest=o." + "A".repeat(43) });
    expect(denyGuest.status).toBe(401);

    const reader = await invite("child", "reader@example.com");
    const readerCookie = await verify(reader, "reader@example.com");
    expect((await call("POST", "/api/page/child/access/request", { cookie: readerCookie, body: { role: "edit" } })).status).toBe(201);
    const pending = (await asOwner("GET", "/api/page/child/access")).data.requests[0];
    expect(pending).toMatchObject({ email: "reader@example.com", role: "edit" });
    const upgraded = await asOwner("POST", "/api/page/child/access/requests/" + pending.id, { body: { decision: "approve" } });
    expect(upgraded.data.invite).toBeNull();
    expect((await call("PUT", "/api/page/child", { cookie: readerCookie, body: { blocks: [{ id: "c1", type: "paragraph", text: "child body" }] } })).status).toBe(200);
    for (const rule of [approved.data.rule, upgraded.data.rule]) await asOwner("DELETE", "/api/page/" + (rule === approved.data.rule ? "root" : "child") + "/access/rules/" + rule);
  });

  test("publishing makes a public page that unpublishing removes; sub-pages only when chosen", async () => {
    const made = await asOwner("POST", "/api/page/root/access/publish");
    expect(made.status).toBe(201);
    const url = made.data.url as string;
    const page = await call("GET", url);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await call("GET", url + "/child/")).status).toBe(404);
    await asOwner("PUT", "/api/page/root/access/settings", { body: { publishSubpages: true, allowIndex: true, siteTitle: "Acard 사이트" } });
    expect((await call("GET", url + "/child/")).status).toBe(200);
    const indexed = await call("GET", url);
    expect(indexed.headers.get("x-robots-tag")).toBe("index, follow");
    expect(indexed.text).toContain("Acard 사이트");
    expect((await asOwner("GET", "/api/page/root/access")).data.publish.url).toBe(url);
    expect((await asOwner("DELETE", "/api/page/root/access/publish")).status).toBe(200);
    expect((await call("GET", url)).status).toBe(404);
    expect((await call("GET", url + "/child/")).status).toBe(404);
    await asOwner("PUT", "/api/page/root/access/settings", { body: { publishSubpages: false, allowIndex: false, siteTitle: "" } });
  });

  test("a permanently deleted page takes its sharing rules and requests with it", async () => {
    const first = await asOwner("POST", "/api/pages", { body: { title: "Temp", slug: "temp-share" } });
    expect(first.data.slug).toBe("temp-share");
    const found = await invite("temp-share", "temp@example.com");
    const guest = await verify(found, "temp@example.com");
    expect((await call("GET", "/api/page/temp-share", { cookie: guest })).status).toBe(200);
    expect((await asOwner("DELETE", "/api/page/temp-share")).status).toBe(200);
    expect((await asOwner("DELETE", "/api/page/temp-share/permanent")).status).toBe(200);
    expect(owner.query("SELECT count(*) AS n FROM share_rules WHERE page = 'temp-share'").get()).toEqual({ n: 0 });
    expect(owner.query("SELECT count(*) AS n FROM share_requests WHERE page = 'temp-share'").get()).toEqual({ n: 0 });
    expect((await call("GET", "/api/page/temp-share", { cookie: guest })).status).toBe(401);
    expect((await call("GET", "/api/tree", { cookie: guest })).data.pages).toEqual([]);
  });

  test("state changes from another origin are refused", async () => {
    expect((await asOwner("PUT", "/api/page/root/access/general", { origin: "https://evil.test", body: { mode: "link" } })).status).toBe(403);
    expect((await asOwner("PUT", "/api/page/root", { origin: "https://evil.test", body: { blocks: [] } })).status).toBe(403);
  });

  // Invite mail is not wired yet, so codes are handed over by hand and last 24 hours (owner call 2026-10-20).
  test("invite codes last 24 hours: a 23-hour-old code still opens the page", async () => {
    const found = await invite("root", "day@example.com");
    const row = owner.query("SELECT created, expires FROM share_invites WHERE rule = ? AND used IS NULL").get(found.rule) as { created: number; expires: number };
    expect(row.expires - row.created).toBe(24 * 60 * 60 * 1000);
    owner.query("UPDATE share_invites SET created = created - ?, expires = expires - ? WHERE rule = ? AND used IS NULL").run(23 * 3600e3, 23 * 3600e3, found.rule);
    expect((await call("POST", found.url, { form: { email: "day@example.com", code: found.code } })).status).toBe(303);
    await asOwner("DELETE", "/api/page/root/access/rules/" + found.rule);
  });

  test("invite codes stop after five wrong tries and refuse once expired", async () => {
    const found = await invite("root", "tries@example.com");
    for (let i = 0; i < 5; i += 1) expect((await call("POST", found.url, { form: { email: "tries@example.com", code: "x" } })).status).toBe(401);
    expect((await call("POST", found.url, { form: { email: "tries@example.com", code: found.code } })).status).toBe(401);
    const late = await asOwner("POST", "/api/page/root/access/rules/" + found.rule + "/code");
    owner.query("UPDATE share_invites SET expires = 1 WHERE used IS NULL").run();
    expect((await call("POST", late.data.url, { form: { email: "tries@example.com", code: late.data.code } })).status).toBe(401);
    await asOwner("DELETE", "/api/page/root/access/rules/" + found.rule);
  });

  // Every route the worker knows must sit behind the resolver: a guest that may read only "root" sends every method
  // to every route aimed at "other" and must never get its content or change it.
  test("no route lets a guest reach a page it was not given", async () => {
    const worker = (await readFile(join(ROOT, "gate/_worker.js"), "utf8")).replace(/\r\n/g, "\n");
    const handleApi = worker.slice(worker.indexOf("async function handleApi"));
    const sources = [handleApi, ...(await Promise.all(["editor-pages.js", ...(await Array.fromAsync(new Bun.Glob("features/*.js").scan({ cwd: ROOT })))].map((file) => readFile(join(ROOT, file), "utf8"))))];
    const literals = new Set<string>();
    const patterns: RegExp[] = [];
    for (const [i, source] of sources.entries()) {
      for (const match of source.matchAll(/path [!=]== "(\/[^"]*)"(?! \+)/g)) literals.add(i === 0 && !match[1].startsWith("/api") ? "/api" + match[1] : match[1]);
      for (const match of source.matchAll(/(\/\^\\\/[^\n]*?\$\/)\.exec\((?:path|url\.pathname)\)/g)) {
        const re = new Function("return " + match[1])() as RegExp;
        patterns.push(i === 0 && !re.source.startsWith("^\\/api") ? new RegExp("^\\/api" + re.source.slice(1)) : re);
      }
    }
    const samples = [
      "/api/sync", "/api/upload", "/api/media-usage", "/api/media/" + OTHER_MEDIA, "/api/link-preview?url=https://x.test", "/api/media/import", "/api/page/other/attachments", "/api/import", "/api/import/md", "/api/export?slug=other",
      "/api/export?scope=all", "/api/tree", "/api/search?q=zebra", "/api/backlinks?slug=other", "/api/pages", "/api/page/other", "/api/page/other/rename",
      "/api/page/other/move", "/api/page/other/blocks", "/api/page/other/settings", "/api/page/other/comments", "/api/page/other/comments/oc",
      "/api/page/other/history", "/api/page/other/history/h1/restore", "/api/page/other/trash", "/api/page/other/restore", "/api/page/other/permanent",
      "/api/page/other/duplicate", "/api/page/other/from-template", "/api/page/other/share", "/api/page/other/share/" + "a".repeat(64), "/api/page/other/access",
      "/api/page/other/access/general", "/api/page/other/access/settings", "/api/page/other/access/publish", "/api/page/other/access/agents",
      "/api/page/other/access/rules/r1", "/api/page/other/access/requests/" + "a".repeat(32), "/api/editor/trash", "/api/editor/trash/empty", "/api/editor/templates", "/api/db", "/api/db/list",
      "/api/db/other", "/api/db/other/rows", "/api/db/other/rows/r1", "/api/db/other/properties", "/api/db/other/views", "/api/db/other/templates",
      "/api/db/other/rules", "/api/db/other/rules/x", "/api/db/other/form", "/api/forms/f1", "/api/forms/f1/submit", "/api/templates", "/api/templates/welcome",
      "/api/ai/polish", "/api/ai/write", "/api/ai/ask", "/api/ai/photo-text", "/api/quick-note", "/api/home/starter", "/api/home/summary", "/api/first-run", "/api/projects", "/api/projects/settings", "/api/projects/backfill", "/api/projects/other/drafts", "/api/projects/other/drafts/apply", "/api/v1/memo", "/api/v1/pages/other/blocks", "/api/v1/agent-skills", "/api/v1/media", "/form/f1",
      "/api/agent", "/api/agent/status", "/api/agent/chat", "/api/agent/sessions", "/api/agent/chat/other", "/api/agent/pages/other/sessions",
      "/api/agent/pages/other/rule", "/api/agent/sessions/s1/step", "/api/agent/suggestions/g1/accept",
      "/api/agent/warm", "/api/agent/latency", "/api/agent/chat-suggestions/g1/apply",
      "/api/journal/sessions", "/api/journal/sessions/j1", "/api/journal/memory/x", "/api/journal/digest", "/api/journal/agents",
      "/api/folders/tree", "/api/folders/prefs", "/api/folders/undo", "/api/folders/activity", "/api/folders/bulk", "/api/folders/suggest", "/api/folders/suggest/apply",
      "/api/parts", "/api/parts/kit", "/api/parts/kit/share", "/api/parts/themes", "/api/parts/themes/kit", "/api/parts/themes/kit/share", "/p/" + "A".repeat(43) + "/acard-part.json", "/api/tags", "/api/tags/merge", "/api/tags/x", "/api/tags/x/pages", "/api/page/other/tags", "/api/v1/folders/tags", "/api/v1/folders/move",
      "/api/page-view/migrate", "/api/page-view/undo", "/api/v1/page-view/migrate", "/api/v1/pages/other/view", "/api/page/other/view",
      "/api/v1/journal/start", "/api/v1/journal/log", "/api/v1/journal/end", "/api/v1/journal/memory", "/api/v1/journal/visual", "/api/v1/doc-guides/split", "/api/v1/components", "/api/v1/components/stat",
      "/other/", "/edit/other/", "/print/other/", "/media/" + OTHER_MEDIA, "/api/media/" + OTHER_MEDIA + "/meta", "/p/" + "A".repeat(43), "/s/i/" + "A".repeat(43), "/s/logout", "/s/r/other",
    ];
    const uncovered = [...[...literals].filter((path) => !samples.some((sample) => sample.split("?")[0] === path)), ...patterns.filter((re) => !samples.some((sample) => re.test(sample.split("?")[0]))).map(String)];
    expect(uncovered).toEqual([]);

    const found = await invite("root", "routes@example.com", "full");
    const guest = await verify(found, "routes@example.com");
    const before = JSON.stringify(owner.query("SELECT * FROM pages WHERE slug = 'other' UNION ALL SELECT page, id, text, ord, type, checked, indent, meta FROM blocks WHERE page = 'other'").all());
    const pages = owner.query("SELECT count(*) AS n FROM pages").get();
    for (const sample of samples) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const res = await call(method, sample, { cookie: guest, body: method === "GET" ? undefined : { parent: "other", slug: "other", title: "x", blocks: [], email: "a@b.dev", mode: "link", text: "x" } });
        expect({ sample, method, leak: res.text.includes(SECRET_TEXT) }).toEqual({ sample, method, leak: false });
        if (!["/api/tree", "/api/search?q=zebra", "/api/db/list", "/s/logout", "/s/r/other"].includes(sample) && !sample.startsWith("/api/v1/") && !sample.startsWith("/p/") && !sample.startsWith("/s/")) {
          expect({ sample, method, ok: res.status < 300 }).toEqual({ sample, method, ok: false });
        }
      }
    }
    expect(JSON.stringify(owner.query("SELECT * FROM pages WHERE slug = 'other' UNION ALL SELECT page, id, text, ord, type, checked, indent, meta FROM blocks WHERE page = 'other'").all())).toBe(before);
    expect(owner.query("SELECT count(*) AS n FROM pages").get()).toEqual(pages);
    expect(owner.query("SELECT count(*) AS n FROM editor_trash WHERE page != 'temp-share'").get()).toEqual({ n: 0 });
    await asOwner("DELETE", "/api/page/root/access/rules/" + found.rule);
  });
});
