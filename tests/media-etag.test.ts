import { describe, expect, test } from "bun:test";
import { setup, cookie } from "./db-harness";
import { mediaEtag } from "../gate/_worker.js";

function png(width: number, height: number) {
  const bytes = new Uint8Array(33), v = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  v.setUint32(8, 13); bytes.set(new TextEncoder().encode("IHDR"), 12);
  v.setUint32(16, width); v.setUint32(20, height);
  return bytes;
}

async function harness() {
  const h = setup();
  await h.call("POST", "/api/pages", { slug: "pics" });
  const values = new Map<string, any>();
  const reads: string[] = [];
  h.env.MEDIA = {
    put: async (key: string, value: ArrayBuffer, options: any) => { values.set(key, { value, metadata: options?.metadata }); },
    getWithMetadata: async (key: string) => { reads.push(key); return values.get(key) || { value: null, metadata: null }; },
    get: async () => null,
    delete: async (key: string) => { values.delete(key); },
  };
  const auth = await cookie();
  const request = (path: string, init: RequestInit = {}) => h.worker.fetch(new Request("https://notes.test" + path, { ...init, headers: { cookie: auth, ...init.headers } }), h.env) as Promise<Response>;
  const upload = async (bytes: Uint8Array) => {
    const form = new FormData();
    form.set("file", new File([bytes.slice().buffer as ArrayBuffer], "a.png", { type: "image/png" })); form.set("page", "pics");
    return await (await request("/api/upload", { method: "POST", body: form })).json() as any;
  };
  return { ...h, values, reads, request, upload };
}

describe("stored media ETag (acard-storage-cost 4)", () => {
  test("upload stores the ETag in the media row and R2 metadata; a matching If-None-Match is a 304 without any storage read", async () => {
    const h = await harness();
    const bytes = png(40, 30);
    const up = await h.upload(bytes);
    const etag = await mediaEtag(bytes.buffer);
    expect(h.sqlite.query("SELECT etag FROM media WHERE id = ?").get(up.id)).toEqual({ etag });
    expect(h.values.get("media/" + up.id).metadata.etag).toBe(etag);
    const first = await h.request(up.url);
    expect([first.status, first.headers.get("etag"), first.headers.get("cache-control")]).toEqual([200, etag, "private, no-cache"]);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);
    h.reads.length = 0;
    const again = await h.request(up.url, { headers: { "if-none-match": etag } });
    expect([again.status, again.headers.get("etag"), again.headers.get("cache-control"), await again.text()]).toEqual([304, etag, "private, no-cache", ""]);
    expect(again.headers.get("x-content-type-options")).toBe("nosniff");
    expect(h.reads).toEqual([]);
    const weak = await h.request(up.url, { headers: { "if-none-match": '"other", W/' + etag } });
    expect(weak.status).toBe(304);
    const stale = await h.request(up.url, { headers: { "if-none-match": '"stale"' } });
    expect(stale.status).toBe(200);
    h.sqlite.close();
  });

  test("a file stored before ETags were saved computes its ETag on the first full read, once, then answers 304 from the row", async () => {
    const h = await harness();
    const bytes = png(10, 10);
    const up = await h.upload(bytes);
    h.sqlite.query("UPDATE media SET etag = NULL WHERE id = ?").run(up.id);
    delete h.values.get("media/" + up.id).metadata.etag;
    const etag = await mediaEtag(bytes.buffer);
    const first = await h.request(up.url, { headers: { "if-none-match": etag } });
    expect(first.status).toBe(304);
    expect(h.sqlite.query("SELECT etag FROM media WHERE id = ?").get(up.id)).toEqual({ etag });
    h.reads.length = 0;
    expect((await h.request(up.url, { headers: { "if-none-match": etag } })).status).toBe(304);
    expect(h.reads).toEqual([]);
    h.sqlite.close();
  });

  test("trash, a missing cookie and an unknown id are refused before a 304 can be given", async () => {
    const h = await harness();
    const up = await h.upload(png(10, 10));
    const etag = (await h.request(up.url)).headers.get("etag")!;
    expect((await h.request(up.url, { headers: { cookie: "", "if-none-match": etag } })).status).toBe(401);
    expect((await h.request("/media/ffffffffffffffff", { headers: { "if-none-match": etag } })).status).toBe(404);
    h.sqlite.query("INSERT INTO editor_trash (page, deleted, permanent) VALUES ('pics',1,0)").run();
    expect((await h.request(up.url, { headers: { "if-none-match": etag } })).status).toBe(404);
    h.sqlite.close();
  });

  test("a deleted file is never a 304 even with its old ETag", async () => {
    const h = await harness();
    const up = await h.upload(png(10, 10));
    const etag = (await h.request(up.url)).headers.get("etag")!;
    expect((await h.request("/api/media/" + up.id, { method: "DELETE", headers: { origin: "https://notes.test" } })).status).toBe(200);
    expect((await h.request(up.url, { headers: { "if-none-match": etag } })).status).toBe(404);
    h.sqlite.close();
  });
});
