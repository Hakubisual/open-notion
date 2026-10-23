import { describe, expect, test } from "bun:test";
import { setup, cookie } from "./db-harness";

// Counts round trips the way gate/tenancy.ts d1Adapter sends them to a member workspace store: statements started in
// the same tick travel together, every later tick is one more network hop. Each trip lists the SQL it carried.
function pipeCounted(db: any) {
  const trips: string[][] = [];
  let queue: { sql: string; run: () => Promise<any>; resolve: (v: any) => void; reject: (e: unknown) => void }[] = [];
  const flush = async () => {
    const taken = queue;
    queue = [];
    trips.push(taken.map((t) => t.sql));
    for (const t of taken) { try { t.resolve(await t.run()); } catch (error) { t.reject(error); } }
  };
  const send = (sql: string, run: () => Promise<any>) => new Promise<any>((resolve, reject) => {
    if (!queue.length) queueMicrotask(() => void flush());
    queue.push({ sql, run, resolve, reject });
  });
  // Schema statements are answered at once by the adapter (sent ahead of the next real statement), so they cost no trip.
  const DDL = /^\s*(?:create\s+(?:unique\s+)?(?:virtual\s+)?(?:table|index|trigger)\s+if\s+not\s+exists|drop\s+(?:trigger|index)\s+if\s+exists|alter\s+table\s+\S+\s+add\s+column)/i;
  const statement = (sql: string, raw: any): any => ({
    sql,
    raw,
    bind: (...args: unknown[]) => statement(sql, raw.bind(...args)),
    run: () => (DDL.test(sql) ? raw.run() : send(sql, () => raw.run())),
    all: () => send(sql, () => raw.all()),
    first: () => send(sql, () => raw.first()),
  });
  const counted = {
    acardKey: "ws:counted",
    prepare: (sql: string) => statement(sql, db.prepare(sql)),
    batch: (list: any[]) => (list.every((s) => DDL.test(s.sql)) ? db.batch(list.map((s) => s.raw ?? s)) : send("BATCH " + list.map((s) => s.sql).join(" | "), () => db.batch(list.map((s) => s.raw ?? s)))),
  };
  return { trips, db: counted };
}
const WRITE = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|BATCH)/i;
const writes = (trips: string[][]) => trips.flat().filter((sql) => WRITE.test(sql));

async function fixture(options: Parameters<typeof setup>[0] = {}) {
  const h = setup({ notesSeed: { pages: [] }, ...options });
  const counter = pipeCounted(h.env.DB);
  h.env.DB = counter.db;
  const get = (path: string, env = h.env, accept = "text/html") => h.worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: "", accept } }), env);
  const owner = async (path: string, accept?: string) => h.worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: await cookie(), accept: accept ?? "text/html" } }), h.env);
  const measure = async (run: () => Promise<Response>) => { counter.trips.length = 0; const response = await run(); return { response, trips: counter.trips.map((t) => [...t]) }; };
  return { ...h, get, owner, measure, trips: counter.trips };
}

describe("server round trips per request (acard-perf-smooth w1-server)", () => {
  test("a folder page in the reader reads page+meta+blocks in one trip and the folder view in two", async () => {
    const h = await fixture();
    await h.call("POST", "/api/pages", { slug: "folder", title: "Folder" });
    await h.call("POST", "/api/pages", { slug: "child-a", title: "Child A", parent: "folder" });
    await h.call("POST", "/api/pages", { slug: "child-b", title: "Child B", parent: "folder" });
    await h.owner("/folder/");
    const { response, trips } = await h.measure(() => h.owner("/folder/"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-view-mode="folder"');
    expect(html).toContain("Child A");
    console.log("folder page trips:", trips.length, JSON.stringify(trips.map((t) => t.map((s) => s.slice(0, 40)))));
    // page row + settings/trash + blocks in one trip; then extras/tree/page_view(row+children+moves); then previews.
    expect(trips[0].some((s) => s.startsWith("SELECT id, type, text, checked, indent, meta FROM blocks"))).toBe(true);
    const pv = trips.findIndex((t) => t.some((s) => s.includes("FROM page_view WHERE page")));
    expect(trips[pv].some((s) => s.includes("WHERE p.parent = ?"))).toBe(true);
    expect(trips[pv].some((s) => s.includes("FROM page_view_moves"))).toBe(true);
    expect(trips.length).toBe(3);
    h.sqlite.close();
  });

  test("an ordinary note page is two trips in the reader", async () => {
    const h = await fixture();
    await h.call("POST", "/api/pages", { slug: "note", title: "Note" });
    h.sqlite.query("UPDATE blocks SET text = ? WHERE page = ?").run("A long article. ".repeat(30), "note");
    await h.owner("/note/");
    const { response, trips } = await h.measure(() => h.owner("/note/"));
    expect(response.status).toBe(200);
    console.log("note page trips:", trips.length);
    expect(trips.length).toBe(2);
    h.sqlite.close();
  });

  test("/api/page/<slug> reads the page and its backlinks in one trip", async () => {
    const h = await fixture();
    await h.call("POST", "/api/pages", { slug: "target", title: "Target" });
    await h.call("POST", "/api/pages", { slug: "source", title: "Source" });
    await h.call("PUT", "/api/page/source", { title: "Source", blocks: [{ id: "b1", type: "paragraph", text: "see [[target]]" }] });
    await h.owner("/api/page/target", "application/json");
    const { response, trips } = await h.measure(() => h.owner("/api/page/target", "application/json"));
    expect(response.status).toBe(200);
    const payload = await response.json() as { backlinks: { slug: string }[] };
    expect(payload.backlinks.map((b) => b.slug)).toEqual(["source"]);
    console.log("api page trips:", trips.length);
    expect(trips.length).toBe(1);
    h.sqlite.close();
  });

  test("a member home is made once; later loads read it without a write or an extra trip, and a trashed home still heals", async () => {
    const h = await fixture();
    const member = (h.worker as any).acardHost.trust({ ...h.env, ACARD_SESSION: "member", ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) } });
    await h.owner("/api/tree", "application/json");
    const first = await h.measure(() => h.get("/", member));
    expect(first.response.status).toBe(200);
    const firstHtml = await first.response.text();
    expect(firstHtml).toContain("Home");
    expect(h.sqlite.query("SELECT slug, title, source, hash FROM pages WHERE slug = 'index'").get()).toEqual({ slug: "index", title: "Home", source: "editor", hash: null });
    expect(h.sqlite.query("SELECT count(*) AS n FROM blocks WHERE page = 'index'").get()).toEqual({ n: 1 });
    expect(writes(first.trips).length).toBeGreaterThan(0);
    const second = await h.measure(() => h.get("/", member));
    expect(second.response.status).toBe(200);
    expect(await second.response.text()).toBe(firstHtml);
    console.log("member home trips first/second:", first.trips.length, second.trips.length, "writes second:", writes(second.trips).length);
    expect(writes(second.trips)).toEqual([]);
    // page+meta+blocks, then tree/extras/agent, then the home summary - no self-heal batch and no re-read.
    expect(second.trips.length).toBe(3);
    h.sqlite.query("INSERT INTO editor_trash (page, deleted, permanent) VALUES ('index', 1, 0)").run();
    const healed = await h.get("/", member);
    expect(healed.status).toBe(200);
    expect(await healed.text()).toBe(firstHtml);
    expect(h.sqlite.query("SELECT count(*) AS n FROM editor_trash WHERE page = 'index'").get()).toEqual({ n: 0 });
    h.sqlite.close();
  });

  test("the editor and page routes start schema setup and the asset fetch in the same tick", async () => {
    for (const path of ["/edit/some-page", "/some-page/"]) {
      const events: string[] = [];
      const h = setup({ assets: { "/editor.html": "<html><body>EDITOR</body></html>" }, assetFetch: async () => { events.push("asset"); return new Response("not found", { status: 404 }); } });
      const batch = h.env.DB.batch.bind(h.env.DB);
      h.env.DB.batch = (list: any[]) => { events.push("schema"); return batch(list); };
      const original = h.env.ASSETS.fetch;
      h.env.ASSETS.fetch = async (request: Request) => { if (new URL(request.url).pathname === "/editor.html") events.push("asset"); return original(request); };
      const response = await h.worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: await cookie(), accept: "text/html" } }), h.env);
      expect([path, response.status]).toEqual([path, path.startsWith("/edit/") ? 200 : 404]);
      // Before: the schema batch was awaited to completion before the asset was asked for; now both start together.
      expect(events.slice(0, 2).sort()).toEqual(["asset", "schema"]);
      expect(events.indexOf("asset")).toBeLessThanOrEqual(1);
      h.sqlite.close();
    }
  });
});
