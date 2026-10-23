import { afterEach, beforeEach, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { cookie, setup } from "./db-harness";

let ctx: ReturnType<typeof setup>;
let other: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); other = setup(); });
afterEach(() => { ctx.sqlite.close(); other.sqlite.close(); });

async function page(h: ReturnType<typeof setup>, slug: string, title: string, text = "") {
  expect((await h.call("POST", "/api/pages", { title, slug })).status).toBe(200);
  if (text) expect((await h.call("PUT", "/api/page/" + slug, { blocks: [{ id: "b1", type: "paragraph", text }] })).status).toBe(200);
}

async function chain(h: ReturnType<typeof setup>) {
  await page(h, "c", "Page C");
  await page(h, "d", "Page D");
  await page(h, "b", "Page B", "to [[c]]");
  await page(h, "a", "Page A", "to [[b]]");
  await page(h, "e", "Page E", "to [[a]] and [[gone]]");
  await page(h, "gone", "Gone page", "to [[a]]");
  expect((await h.call("DELETE", "/api/page/gone")).status).toBe(200);
}

const slugs = (data: any) => data.nodes.map((node: any) => node.slug).sort();

test("signed-out callers get 401 and guest sessions get 403", async () => {
  expect((await ctx.call("GET", "/api/graph", undefined, true)).status).toBe(401);
  expect((await ctx.call("GET", "/graph", undefined, true)).status).toBe(401);
  const guestEnv = (ctx.worker as any).acardHost.trust({ ...ctx.env, ACARD_SESSION: "guest" });
  for (const path of ["/api/graph", "/graph"]) {
    const response = await ctx.worker.fetch(new Request("https://notes.test" + path), guestEnv);
    expect(response.status).toBe(403);
  }
});

test("graph lists own live pages and links between them, never trashed pages or another workspace", async () => {
  await chain(ctx);
  await page(other, "secret", "Other workspace secret", "to [[a]]");
  const { status, data } = await ctx.call("GET", "/api/graph");
  expect(status).toBe(200);
  expect(slugs(data)).toEqual(expect.arrayContaining(["a", "b", "c", "d", "e"]));
  expect(slugs(data)).not.toContain("gone");
  expect(slugs(data)).not.toContain("secret");
  expect(JSON.stringify(data)).not.toContain("Other workspace secret");
  const edges = data.edges.map((edge: string[]) => edge.join(">")).sort();
  expect(edges).toEqual(["a>b", "b>c", "e>a"]);
  const a = data.nodes.find((node: any) => node.slug === "a");
  expect(a).toMatchObject({ title: "Page A", kind: "note", links: 2 });
  expect(data.nodes.find((node: any) => node.slug === "d").links).toBe(0);
});

test("around returns the 1- or 2-link neighbourhood, unknown pages 404", async () => {
  await chain(ctx);
  expect(slugs((await ctx.call("GET", "/api/graph?around=a")).data)).toEqual(["a", "b", "e"]);
  expect(slugs((await ctx.call("GET", "/api/graph?around=a&depth=1")).data)).toEqual(["a", "b", "e"]);
  const two = (await ctx.call("GET", "/api/graph?around=a&depth=2")).data;
  expect(slugs(two)).toEqual(["a", "b", "c", "e"]);
  expect(two.edges.map((edge: string[]) => edge.join(">")).sort()).toEqual(["a>b", "b>c", "e>a"]);
  expect(slugs((await ctx.call("GET", "/api/graph?around=c&depth=1")).data)).toEqual(["b", "c"]);
  expect((await ctx.call("GET", "/api/graph?around=gone")).status).toBe(404);
  expect((await ctx.call("GET", "/api/graph?around=nope")).status).toBe(404);
});

test("/graph returns an HTML shell loading the graph chunk", async () => {
  const response = await ctx.worker.fetch(new Request("https://notes.test/graph?around=a", { headers: { cookie: await cookie() } }), ctx.env);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain('src="/lazy/graph.js');
  expect(html).toContain('href="/lazy/graph.css');
  for (const id of ["graph-canvas", "graph-q", "graph-around", "graph-depth"]) expect(html).toContain('id="' + id + '"');
  expect((await ctx.call("POST", "/graph")).status).toBe(405);
  expect(statSync(join(import.meta.dir, "../assets/features/lazy/graph.js")).size).toBeLessThan(46000);
});
