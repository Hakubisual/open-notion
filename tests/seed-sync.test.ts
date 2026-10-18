import { expect, test } from "bun:test";
import { setup } from "./db-harness";

const NOTES = { pages: [{ slug: "note-a", title: "A", parent: null, ord: 1, kind: "note", updated: 1, hash: "h1", blocks: [{ id: "s0", type: "paragraph", text: "a" }] }] };

// Production served HEAD with a weak etag (W/"x") and stored the GET tag ("x"), so every request rewrote the seed.
function seeded() {
  let gets = 0;
  const box = setup({
    assetFetch: async (request: Request) => {
      if (new URL(request.url).pathname !== "/notes-seed.json") return new Response("not found", { status: 404 });
      if (request.method === "HEAD") return new Response(null, { headers: { etag: 'W/"seed-1"' } });
      gets++;
      return new Response(JSON.stringify(NOTES), { headers: { "content-type": "application/json", etag: '"seed-1"' } });
    },
  });
  return { box, gets: () => gets, inserts: () => (box.sqlite.query("SELECT COUNT(*) c FROM blocks WHERE page = 'note-a'").get() as any).c };
}

test("an unchanged seed is read once even when HEAD and GET format the etag differently", async () => {
  const s = seeded();
  for (let i = 0; i < 4; i++) expect((await s.box.call("GET", "/api/tree")).status).toBe(200);
  expect(s.gets()).toBe(1);
  expect(s.inserts()).toBe(1);
});

test("concurrent requests run one seed sync, not one each", async () => {
  const s = seeded();
  const results = await Promise.all(Array.from({ length: 6 }, () => s.box.call("GET", "/api/tree")));
  expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
  expect(s.gets()).toBe(1);
});
