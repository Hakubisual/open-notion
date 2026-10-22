import { describe, expect, test } from "bun:test";
import { imageDimensions } from "../gate/_worker.js";
import imagesWorker from "../workers/acard-images/index.js";
import { setup, cookie } from "./db-harness";

function png(width: number, height: number, animated = false) {
  const bytes = new Uint8Array(animated ? 53 : 33), v = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  v.setUint32(8, 13); bytes.set(new TextEncoder().encode("IHDR"), 12);
  v.setUint32(16, width); v.setUint32(20, height);
  if (animated) { v.setUint32(33, 8); bytes.set(new TextEncoder().encode("acTL"), 37); }
  return bytes;
}

function webp(width: number, height: number, animated = false) {
  const bytes = new Uint8Array(30), v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF")); v.setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8); v.setUint32(16, 10, true);
  bytes[20] = animated ? 2 : 0;
  for (let i = 0; i < 3; i++) { bytes[24 + i] = (width - 1) >> (8 * i); bytes[27 + i] = (height - 1) >> (8 * i); }
  return bytes;
}

async function harness() {
  const h = setup();
  await h.call("POST", "/api/pages", { slug: "images" });
  const values = new Map<string, any>();
  h.env.MEDIA = {
    put: async (key: string, value: ArrayBuffer, options: any) => { values.set(key, { value, metadata: options.metadata }); },
    getWithMetadata: async (key: string) => values.get(key) || { value: null },
    delete: async (key: string) => { values.delete(key); },
  };
  const auth = await cookie();
  const request = (path: string, init: RequestInit = {}) => h.worker.fetch(new Request("https://notes.test" + path, { ...init, headers: { cookie: auth, ...init.headers } }), h.env);
  const upload = async (bytes: Uint8Array, type = "image/png") => {
    const data = new FormData();
    data.set("file", new File([new Uint8Array(bytes).buffer], "picture." + (type === "image/svg+xml" ? "svg" : type.split("/")[1]), { type })); data.set("page", "images");
    const response = await request("/api/upload", { method: "POST", body: data });
    expect({ type, status: response.status }).toEqual({ type, status: 200 });
    return await response.json() as any;
  };
  return { ...h, values, request, upload };
}

describe("intrinsic image headers", () => {
  test("PNG, JPEG, GIF, extended/lossy/lossless WebP and truncated data", () => {
    expect(imageDimensions(png(1200, 800).buffer)).toEqual({ width: 1200, height: 800, animated: false });
    expect(imageDimensions(png(1200, 800, true).buffer).animated).toBe(true);
    const jpeg = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 2, 88, 3, 32, 1, 1, 17, 0, 255, 217]);
    expect(imageDimensions(jpeg.buffer)).toEqual({ width: 800, height: 600, animated: false });
    const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 32, 3, 88, 2]);
    expect(imageDimensions(gif.buffer)).toEqual({ width: 800, height: 600, animated: true });
    expect(imageDimensions(webp(640, 480).buffer)).toEqual({ width: 640, height: 480, animated: false });
    expect(imageDimensions(webp(640, 480, true).buffer).animated).toBe(true);
    const lossy = webp(640, 480);
    lossy.set(new TextEncoder().encode("VP8 "), 12); lossy.set([0, 0, 0, 157, 1, 42, 128, 2, 224, 1], 20);
    expect(imageDimensions(lossy.buffer)).toEqual({ width: 640, height: 480, animated: false });
    const lossless = webp(1, 1); lossless.set(new TextEncoder().encode("VP8L"), 12); lossless.set([47, 0, 0, 0, 0], 20);
    expect(imageDimensions(lossless.buffer)).toEqual({ width: 1, height: 1, animated: false });
    for (const bytes of [new Uint8Array(), jpeg.slice(0, 8), png(1, 1).slice(0, 15), webp(1, 1).slice(0, 22)]) expect(imageDimensions(bytes.buffer).width).toBeNull();
  });
});

describe("authorized media delivery", () => {
  test("upload stores page and intrinsic metadata; old uploads backfill via meta", async () => {
    const h = await harness();
    const uploaded = await h.upload(png(1200, 800));
    expect(uploaded.width).toBe(1200); expect(uploaded.height).toBe(800);
    const key = "media/" + uploaded.id;
    expect(h.values.get(key).metadata.width).toBe(1200);
    expect(h.sqlite.query("SELECT page FROM media WHERE id = ?").get(uploaded.id)).toEqual({ page: "images" });
    delete h.values.get(key).metadata.width; delete h.values.get(key).metadata.height;
    expect(await (await h.request("/api/media/" + uploaded.id + "/meta")).json()).toEqual({ width: 1200, height: 800, mime: "image/png" });
    h.sqlite.close();
  });

  test("variants are transformed once, KV cached, never upscaled and individually ETagged", async () => {
    const h = await harness();
    const uploaded = await h.upload(png(1200, 800));
    const widths: number[] = [];
    h.env.IMAGES = { input: (stream: ReadableStream) => ({ transform: ({ width }: { width: number }) => ({ output: async ({ format }: { format: string }) => {
      expect(await new Response(stream).arrayBuffer()).toEqual(png(1200, 800).buffer);
      expect(format).toBe("image/webp"); widths.push(width);
      return { response: () => new Response(webp(width, Math.round(width * 2 / 3)), { headers: { "content-type": format } }) };
    } }) }) };
    const original = await h.request(uploaded.url);
    const resized = await h.request(uploaded.url + "?w=400");
    expect(resized.headers.get("content-type")).toBe("image/webp");
    expect(imageDimensions(await resized.arrayBuffer()).width).toBe(400);
    expect(resized.headers.get("etag")).not.toBe(original.headers.get("etag"));
    expect(h.values.get("media/" + uploaded.id + "@w400").metadata).toMatchObject({ mime: "image/webp", width: 400, height: 267 });
    await h.request(uploaded.url + "?w=400");
    await h.request(uploaded.url + "?w=800");
    await h.request(uploaded.url + "?w=1600");
    await h.request(uploaded.url + "?w=900");
    expect(widths).toEqual([400, 800, 1200]);
    const conditional = await h.request(uploaded.url + "?w=400", { headers: { "if-none-match": '"other", W/' + resized.headers.get("etag") } });
    expect(conditional.status).toBe(304); expect(await conditional.text()).toBe("");
    expect(await (await h.request(uploaded.url, { method: "HEAD" })).text()).toBe("");
    expect(original.headers.get("cache-control")).toBe("private, no-cache");
    h.sqlite.close();
  });

  test("SVG, GIF and animated PNG/WebP remain original; unavailable transform preserves original", async () => {
    const h = await harness();
    const sources: [Uint8Array, string][] = [
      [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'), "image/svg+xml"],
      [new Uint8Array([71, 73, 70, 56, 57, 97, 32, 3, 88, 2]), "image/gif"],
      [png(1200, 800, true), "image/png"], [webp(1200, 800, true), "image/webp"],
    ];
    h.env.IMAGES = { input: () => { throw new Error("animated images must not reach transform"); } };
    let serviceCalls = 0;
    h.env.IMAGES_SVC = { fetch: async () => { serviceCalls++; return new Response("unexpected", { status: 500 }); } };
    for (const [bytes, mime] of sources) {
      const uploaded = await h.upload(bytes, mime);
      const original = await h.request(uploaded.url);
      const variant = await h.request(uploaded.url + "?w=400");
      expect(await variant.arrayBuffer()).toEqual(await original.arrayBuffer());
      expect(variant.headers.get("content-type")).toBe(mime);
      expect(h.values.has("media/" + uploaded.id + "@w400")).toBe(false);
    }
    expect(serviceCalls).toBe(0);
    delete h.env.IMAGES;
    delete h.env.IMAGES_SVC;
    const plain = await h.upload(png(1200, 800));
    expect((await h.request(plain.url + "?w=400")).headers.get("content-type")).toBe("image/png");
    h.sqlite.close();
  });

  test("service binding posts bytes through the Images Worker and caches only valid WebP", async () => {
    const h = await harness();
    const source = png(1200, 800);
    const uploaded = await h.upload(source);
    const widths: number[] = [];
    const requests: Request[] = [];
    const images = { input: (stream: ReadableStream) => ({ transform: ({ width, fit }: { width: number; fit: string }) => ({ output: async ({ format }: { format: string }) => {
      expect(await new Response(stream).arrayBuffer()).toEqual(source.buffer);
      expect(fit).toBe("scale-down"); expect(format).toBe("image/webp"); widths.push(width);
      return { response: () => new Response(webp(width, Math.round(width * 2 / 3)), { headers: { "content-type": format } }) };
    } }) }) };
    h.env.IMAGES_SVC = { fetch: async (url: string, init: RequestInit) => {
      const request = new Request(url, init);
      requests.push(request);
      expect(request.method).toBe("POST"); expect(request.headers.get("content-type")).toBe("image/png");
      return imagesWorker.fetch(request, { IMAGES: images });
    } };
    const original = await h.request(uploaded.url);
    const resized = await h.request(uploaded.url + "?w=400");
    const bytes = await resized.arrayBuffer();
    expect(resized.status).toBe(200); expect(resized.headers.get("content-type")).toBe("image/webp");
    expect(bytes.byteLength).toBeLessThan(source.byteLength);
    expect(imageDimensions(bytes)).toEqual({ width: 400, height: 267, animated: false });
    expect(resized.headers.get("etag")).not.toBe(original.headers.get("etag"));
    expect(h.values.get("media/" + uploaded.id + "@w400").metadata).toMatchObject({ mime: "image/webp", width: 400, height: 267 });
    const cached = await h.request(uploaded.url + "?w=400");
    expect(await cached.arrayBuffer()).toEqual(bytes);
    expect((await h.request(uploaded.url + "?w=400", { headers: { "if-none-match": resized.headers.get("etag")! } })).status).toBe(304);
    expect(await (await h.request(uploaded.url + "?w=400", { method: "HEAD" })).text()).toBe("");
    await h.request(uploaded.url + "?w=800");
    await h.request(uploaded.url + "?w=1600");
    await h.request(uploaded.url + "?w=900");
    expect(widths).toEqual([400, 800, 1200]);
    expect(requests.map(request => new URL(request.url).searchParams.get("w"))).toEqual(["400", "800", "1200"]);
    h.sqlite.query("INSERT INTO editor_trash (page, deleted, permanent) VALUES ('images',1,0)").run();
    expect((await h.request(uploaded.url + "?w=400", { headers: { "if-none-match": resized.headers.get("etag")! } })).status).toBe(404);
    expect((await h.request(uploaded.url + "?w=400", { headers: { cookie: "" } })).status).toBe(401);
    expect(requests).toHaveLength(3);
    h.sqlite.close();
  });

  test("service errors and invalid output preserve originals without poisoning the variant cache", async () => {
    const h = await harness();
    const source = png(1200, 800);
    const uploaded = await h.upload(source);
    for (const response of [new Response("unavailable", { status: 503 }), new Response(source), new Response(webp(800, 533))]) {
      h.env.IMAGES_SVC = { fetch: async () => response };
      const result = await h.request(uploaded.url + "?w=400");
      expect(result.headers.get("content-type")).toBe("image/png");
      expect(await result.arrayBuffer()).toEqual(source.buffer);
      expect(h.values.has("media/" + uploaded.id + "@w400")).toBe(false);
    }
    h.sqlite.close();
  });

  test("Images Worker rejects invalid requests before calling Images", async () => {
    let calls = 0;
    const env = { IMAGES: { input: () => { calls++; throw new Error("unexpected transform"); } } };
    expect((await imagesWorker.fetch(new Request("https://acard-images/?w=400"), env)).status).toBe(405);
    for (const width of ["", "0", "-1", "1601", "400.5", "bad"]) {
      expect((await imagesWorker.fetch(new Request("https://acard-images/?w=" + width, { method: "POST", body: png(1200, 800) }), env)).status).toBe(400);
    }
    expect((await imagesWorker.fetch(new Request("https://acard-images/?w=400", { method: "POST" }), env)).status).toBe(400);
    expect(calls).toBe(0);
  });

  test("trash is checked before cached variants and 304; authorization SQL fails closed", async () => {
    const h = await harness();
    const uploaded = await h.upload(png(1200, 800));
    const original = await h.request(uploaded.url);
    h.values.set("media/" + uploaded.id + "@w400", { value: webp(400, 267).buffer, metadata: { mime: "image/webp" } });
    h.sqlite.query("INSERT INTO editor_trash (page, deleted, permanent) VALUES ('images',1,0)").run();
    for (const path of [uploaded.url, uploaded.url + "?w=400", "/api/media/" + uploaded.id + "/meta"]) expect((await h.request(path, { headers: { "if-none-match": original.headers.get("etag")! } })).status).toBe(404);
    h.sqlite.query("DELETE FROM editor_trash").run();
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = (sql: string) => sql.includes("FROM media m LEFT JOIN editor_trash") ? { bind: () => ({ first: async () => { throw new Error("database unavailable"); } }) } : prepare(sql);
    await expect(h.request(uploaded.url)).rejects.toThrow("database unavailable");
    h.sqlite.close();
  });
});
