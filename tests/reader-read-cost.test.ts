import { describe, expect, test } from "bun:test";
import { setup, cookie, read } from "./db-harness";

function countReads(env: any) {
  const queries: string[] = [];
  const original = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => {
    const wrap = (statement: any): any => ({
      bind: (...args: any[]) => wrap(statement.bind(...args)),
      first: () => { queries.push(sql); return statement.first(); },
      all: () => { queries.push(sql); return statement.all(); },
      run: () => statement.run(),
    });
    return wrap(original(sql));
  };
  return queries;
}

async function get(h: ReturnType<typeof setup>, path: string) {
  return h.worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: await cookie(), accept: "text/html" } }), h.env);
}

describe("reader critical path", () => {
  test("ordinary note uses fewer than the previous 13 statements and reports stages", async () => {
    const h = setup();
    await h.call("POST", "/api/pages", { slug: "ordinary", title: "Ordinary" });
    h.sqlite.query("UPDATE blocks SET text = ? WHERE page = ?").run("A long article. ".repeat(30), "ordinary");
    await get(h, "/ordinary/");
    const queries = countReads(h.env);
    const response = await get(h, "/ordinary/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("A long article.");
    expect(queries.length).toBeLessThan(13);
    expect(queries.length).toBe(6);
    expect(queries.filter(sql => sql.includes("LEFT JOIN editor_trash") && sql.includes("LEFT JOIN editor_page_settings"))).toHaveLength(1);
    expect(queries.some(sql => sql.includes("WHERE p.parent = ?"))).toBe(false);
    for (const name of ["reader", "assets", "metadata", "blocks", "extras", "render"]) expect(response.headers.get("server-timing")).toContain(name + ";dur=");
    h.sqlite.close();
  });

  test("reader retains trash denial and folder child visibility", async () => {
    const h = setup();
    await h.call("POST", "/api/pages", { slug: "folder", title: "Folder" });
    await h.call("POST", "/api/pages", { slug: "child", title: "Visible child", parent: "folder" });
    expect(await (await get(h, "/folder/")).text()).toContain('data-view-mode="folder"');
    h.sqlite.query("INSERT INTO editor_trash (page, deleted, permanent) VALUES (?, 1, 0)").run("child");
    expect(await (await get(h, "/folder/")).text()).not.toContain("Visible child");
    expect((await get(h, "/child/")).status).toBe(404);
    expect((await h.call("GET", "/api/page/child")).status).toBe(404);
    h.sqlite.close();
  });

  test("repeated database refs share reads and bootstrap equals the API payload", async () => {
    const h = setup();
    await h.call("POST", "/api/pages", { slug: "table", title: "Data </script>&\u2028", kind: "db" });
    const title = (await h.call("GET", "/api/db/table")).data.properties.find((p: any) => p.type === "title").id;
    const row = (await h.call("POST", "/api/db/table/rows", { props: { [title]: "Preview" } })).data.row;
    await h.call("PUT", "/api/page/" + row.page + "/settings", { cover: "/media/cover", icon: "P" });
    await h.call("PUT", "/api/page/" + row.page, { blocks: [{ id: "image", type: "image", meta: { src: "/media/first", iw: 800, ih: 400 } }] });
    const template = (await h.call("POST", "/api/db/table/templates", { name: "Repeating", blocks: [] })).data.template;
    await h.call("PATCH", "/api/db/table/templates/" + template.id, { recurrence: { freq: "day", hour: 9, tz: "Asia/Seoul" } });
    await h.call("POST", "/api/pages", { slug: "refs", title: "Refs" });
    h.sqlite.query("DELETE FROM blocks WHERE page = 'refs'").run();
    for (let n = 0; n < 2; n++) h.sqlite.query("INSERT INTO blocks (page,id,ord,type,text,checked,indent,meta) VALUES ('refs',?,?, 'db_ref','',0,0,?)").run("ref" + n, n, JSON.stringify({ database: "table" }));
    await get(h, "/refs/");
    const queries = countReads(h.env);
    const html = await (await get(h, "/refs/")).text();
    expect(queries.filter(sql => sql.includes("FROM databases WHERE slug = ?"))).toHaveLength(1);
    for (const table of ["db_properties", "db_rows", "db_views", "db_templates"]) expect(queries.filter(sql => sql.includes("FROM " + table))).toHaveLength(1);
    const tags = [...html.matchAll(/<script type="application\/json" class="acard-db-boot" data-slug="table">([\s\S]*?)<\/script>/g)];
    expect(tags).toHaveLength(2);
    const api = await h.call("GET", "/api/db/table");
    expect(api.data.rows[0]).toMatchObject({ pageIcon: "P", cover: "/media/cover", firstImage: "/media/first", firstImageMeta: { src: "/media/first", iw: 800, ih: 400 } });
    expect(api.data.templates[0].recurrence).not.toBeNull();
    for (const tag of tags) {
      expect(tag[1]).not.toMatch(/[<>&\u2028\u2029]/);
      expect(JSON.parse(tag[1])).toEqual(api.data);
    }
    h.sqlite.close();
  });

  test("independent database reads are launched before any one completes", async () => {
    const h = setup();
    await h.call("POST", "/api/pages", { slug: "parallel", kind: "db" });
    const original = h.env.DB.prepare.bind(h.env.DB);
    const started = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.env.DB.prepare = (sql: string) => {
      const wrap = (stmt: any): any => ({
        bind: (...args: any[]) => wrap(stmt.bind(...args)), first: () => stmt.first(), run: () => stmt.run(),
        all: async () => {
          const table = /FROM (db_properties|db_rows|db_views|db_templates)\b/.exec(sql)?.[1];
          if (table) { started.add(table); if (started.size === 4) release(); await gate; }
          return stmt.all();
        },
      });
      return wrap(original(sql));
    };
    expect((await h.call("GET", "/api/db/parallel")).status).toBe(200);
    expect(started.size).toBe(4);
    h.sqlite.close();
  }, 2000);
});

describe("safe full saves", () => {
  test("create returns the exact GET page snapshot for notes and databases", async () => {
    const h = setup();
    for (const kind of ["note", "db"]) {
      const created = await h.call("POST", "/api/pages", { slug: "new-" + kind, kind });
      expect(created.status).toBe(200);
      expect(created.data.page).toEqual((await h.call("GET", "/api/page/" + created.data.slug)).data);
      expect(created.data.updated).toBe(created.data.page.page.updated);
    }
    h.sqlite.close();
  });

  test("cookie saves require their read version; stale PUT cannot write history, title, blocks or links", async () => {
    const h = setup({ rawSaves: true });
    const created = await h.call("POST", "/api/pages", { slug: "save" });
    const body = { title: "Saved", blocks: [{ id: "b1", type: "paragraph", text: "[[target]]" }] };
    expect((await h.call("PUT", "/api/page/save", body)).status).toBe(428);
    const saved = await h.call("PUT", "/api/page/save", { ...body, base_updated: created.data.updated });
    expect(saved.status).toBe(200);
    expect(saved.data.updated).toBeGreaterThan(created.data.updated);
    const before = JSON.stringify(h.sqlite.query("SELECT * FROM editor_history").all());
    const stale = await h.call("PUT", "/api/page/save", { ...body, title: "Lost", blocks: [], base_updated: created.data.updated });
    expect(stale).toEqual({ status: 409, data: { error: "conflict", updated: saved.data.updated } });
    expect(JSON.stringify(h.sqlite.query("SELECT * FROM editor_history").all())).toBe(before);
    expect((await h.call("GET", "/api/page/save")).data.page.title).toBe("Saved");
    expect(h.sqlite.query("SELECT dst FROM links WHERE src = 'save'").all()).toEqual([{ dst: "target" }]);
    h.sqlite.close();
  });

  test("compare-and-swap guards every mutation when another writer wins immediately before batch", async () => {
    const h = setup();
    const created = await h.call("POST", "/api/pages", { slug: "race" });
    const batch = h.env.DB.batch.bind(h.env.DB);
    h.env.DB.batch = async (statements: any[]) => {
      h.sqlite.query("UPDATE pages SET updated = updated + 1, title = 'Winner' WHERE slug = 'race'").run();
      return batch(statements);
    };
    const result = await h.call("PUT", "/api/page/race", { base_updated: created.data.updated, title: "Loser", blocks: [{ id: "evil", type: "paragraph", text: "[[lost]]" }] });
    expect(result.status).toBe(409);
    expect(h.sqlite.query("SELECT title FROM pages WHERE slug = 'race'").get()).toEqual({ title: "Winner" });
    expect(h.sqlite.query("SELECT id FROM blocks WHERE page = 'race'").all()).toEqual([{ id: "b1" }]);
    expect(h.sqlite.query("SELECT * FROM editor_history WHERE page = 'race'").all()).toHaveLength(0);
    expect(h.sqlite.query("SELECT * FROM links WHERE src = 'race'").all()).toHaveLength(0);
    h.sqlite.close();
  });

  test("bearer API callers retain unconditional PUT compatibility", async () => {
    const h = setup();
    await h.call("POST", "/api/pages", { slug: "agent" });
    const admin = await (h.worker as any).acardHost.tokenAdmin(h.env);
    const token = await admin.create({ name: "Writer", scopes: ["read", "write"] });
    const put = (bearer: string) => h.worker.fetch(new Request("https://notes.test/api/page/agent", { method: "PUT", headers: { cookie: "", authorization: "Bearer " + bearer, "content-type": "application/json" }, body: JSON.stringify({ title: "Agent", blocks: [] }) }), (h.worker as any).acardHost.trust(h.env));
    expect((await put("forged-header")).status).toBe(428);
    const response = await put(token.token);
    expect(response.status).toBe(200);
    h.sqlite.close();
  });
});

test("identity metadata is first in head and matches the hashed response header", async () => {
  const sourceCode = read("gate/agent-entry.ts").match(/async function identityResponse[\s\S]*?(?=\nexport default)/)![0];
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(sourceCode).replace(/^export /m, "");
  const identityResponse = new Function(code + "; return identityResponse;")();
  const source = () => new Response('<html><head><meta charset="utf-8"></head><body></body></html>', { headers: { "content-type": "text/html" } });
  const value = "11111111-1111-4111-8111-111111111111:11111111111141118111111111111111";
  const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex").slice(0, 16);
  const member = await identityResponse(source(), value);
  expect(member.headers.get("x-acard-id")).toBe(expected);
  expect(await member.text()).toContain('<head><meta name="acard-id" content="' + expected + '"><meta charset=');
  const guest = await identityResponse(source(), "guest-session", true);
  expect(guest.headers.get("x-acard-id")).toMatch(/^g-[0-9a-f]{16}$/);
  const anonymous = await identityResponse(source(), null);
  expect(anonymous.headers.has("x-acard-id")).toBe(false);
  expect(await anonymous.text()).not.toContain("acard-id");
  const api = await identityResponse(Response.json({ ok: true }), value);
  expect(api.headers.get("x-acard-id")).toBe(expected);
  expect(await api.json()).toEqual({ ok: true });
  // The service worker reads this cookie to notice a session it never saw change.
  expect(member.headers.get("set-cookie")).toContain("acard_id=" + expected + ";");
  expect(member.headers.get("set-cookie")).not.toContain("HttpOnly");
  expect(anonymous.headers.has("set-cookie")).toBe(false);
  const signingOut = new Response("{}", { headers: { "content-type": "application/json", "set-cookie": "acard_at=; Path=/; Max-Age=0" } });
  expect((await identityResponse(signingOut, value)).headers.get("set-cookie")).not.toContain("acard_id=" + expected);
});

test("entry routes attach member identity and never attach it to public shares", async () => {
  const source = new Bun.Transpiler({ loader: "ts" }).transformSync(read("gate/agent-entry.ts"));
  const marker = source.indexOf("const entry =");
  const end = source.indexOf("const DB_TRANSIENT", marker);
  const identify: (string | null)[] = [];
  const human = { ws: "owner", session: { user: { sub: "owner-user" } }, set: [], env: {} };
  const env = { GATE_PASSWORD: "p", GATE_SECRET: "s", ACARD_IDENTITY: (value: string | null) => identify.push(value) };
  const core = { fetch: async () => Response.json({ ok: true }) };
  const entry = new Function("unforward", "LEGACY_HOSTS", "AGENT_PATH", "langSwitch", "resourceFor", "bearer", "ACCOUNT_API", "MEMBER_SHARE", "SHARE_PATH", "scoped", "core", "OWNER_WS", "humanFor", "ADMIN_PATH", "BETA_API", "betaClosed", "PUBLIC_SITE", "guestEnv", "routeLoggedIn", "SITE_HOST", source.slice(marker, end) + "; return entry;")(
    (request: Request) => request, new Set(), /never/, () => null, () => null, () => null,
    /never/, /never/, /never/, (value: any) => value, core, "owner",
    async (_request: Request, value: any) => { value.ACARD_IDENTITY("owner-user:owner"); return human; },
    /never/, /never/, () => false, {}, () => null, async () => Response.json({ ok: true }), "notes.example.com",
  );
  expect((await entry.fetch(new Request("https://notes.example.com/api/tree"), env, {})).status).toBe(200);
  expect(identify).toEqual(["owner-user:owner"]);
  identify.length = 0;
  expect((await entry.fetch(new Request("https://notes.example.com/p/token"), env, {})).status).toBe(200);
  expect(identify).toEqual([]);
});
