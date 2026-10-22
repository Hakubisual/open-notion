import { describe, expect, test } from "bun:test";
import { setup, cookie } from "./db-harness";
import { webpName } from "../gate/_worker.js";
import imageWorker from "../workers/acard-image/index.js";

// Header-only image bytes: imageDimensions reads the size from the header, which is all the upload path looks at.
function png(width: number, height: number, length = 33, animated = false) {
  const bytes = new Uint8Array(length), v = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  v.setUint32(8, 13); bytes.set(new TextEncoder().encode("IHDR"), 12);
  v.setUint32(16, width); v.setUint32(20, height);
  if (animated) { v.setUint32(33, 8); bytes.set(new TextEncoder().encode("acTL"), 37); }
  return bytes;
}
function webp(width: number, height: number, length: number) {
  const bytes = new Uint8Array(Math.max(length, 30)), v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0); bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  v.setUint32(16, 10, true);
  const u24 = (at: number, n: number) => { bytes[at] = n & 255; bytes[at + 1] = (n >> 8) & 255; bytes[at + 2] = (n >> 16) & 255; };
  u24(24, width - 1); u24(27, height - 1);
  return bytes;
}
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 10, 0, 0, 0, 0]);

function harness(options: { compress?: string; out?: (bytes: Uint8Array) => Uint8Array | null; slots?: number; resizer?: (url: string, init: any) => Promise<Response> } = {}) {
  const h = setup();
  const stored = new Map<string, { value: ArrayBuffer; metadata: any }>();
  const calls: string[] = [];
  let slots = options.slots ?? Infinity;
  h.env.MEDIA = {
    put: async (key: string, value: ArrayBuffer, o: any) => { stored.set(key, { value, metadata: o?.metadata }); },
    getWithMetadata: async (key: string) => stored.get(key) ?? { value: null, metadata: null },
    get: async () => null, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }),
  };
  h.env.MEDIA_COMPRESS = options.compress ?? "on";
  const ledger = { used: 0, mediaUsage: async (delta: number) => { ledger.used += delta; return { ok: true, used: ledger.used, alerted: 0 }; }, mediaMarkAlerted: async () => false, compressSlot: async () => (slots-- > 0) };
  h.env.WORKSPACE = { idFromName: (n: string) => n, get: () => ledger };
  h.env.IMAGE_RESIZER = { fetch: async (url: string, init: any) => {
    calls.push(url);
    if (options.resizer) return options.resizer(url, init);
    const out = options.out ? options.out(new Uint8Array(init.body)) : webp(2560, 1024, 20);
    return out ? new Response(out.slice().buffer as ArrayBuffer) : new Response("fail", { status: 422 });
  } };
  const upload = async (bytes: Uint8Array, name: string, type: string) => {
    const form = new FormData();
    form.set("file", new File([bytes.slice().buffer as ArrayBuffer], name, { type })); form.set("page", "p");
    return h.worker.fetch(new Request("https://notes.test/api/upload", { method: "POST", headers: { cookie: await cookie() }, body: form }), h.env) as Promise<Response>;
  };
  return { ...h, stored, calls, ledger, upload };
}

describe("upload compression (MEDIA_COMPRESS)", () => {
  test("a png is stored as the smaller WebP, quota and media row count the WebP bytes", async () => {
    const h = harness();
    const res = await h.upload(png(5000, 2000, 400), "shot.png", "image/png");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect([body.mime, body.name, body.size, body.originalSize, body.width]).toEqual(["image/webp", "shot.webp", 30, 400, 2560]);
    expect(h.calls).toEqual(["https://acard-image/compress?max=2560&q=85"]);
    expect(h.stored.get("media/" + body.id)!.metadata).toMatchObject({ mime: "image/webp", size: 30, originalSize: 400 });
    expect(h.ledger.used).toBe(30);
    const row = await h.env.DB.prepare("SELECT mime, bytes FROM media WHERE id = ?").bind(body.id).first();
    expect(row).toEqual({ mime: "image/webp", bytes: 30 });
  });

  test("keeps the original when the WebP is not smaller, when the flag is off, or when the monthly slots are used", async () => {
    for (const [label, h] of [["bigger", harness({ out: () => webp(100, 100, 500) })], ["off", harness({ compress: "off" })], ["slots", harness({ slots: 0 })]] as const) {
      const body = await (await h.upload(png(100, 100, 400), "a.png", "image/png")).json() as any;
      expect({ label, mime: body.mime, size: body.size, name: body.name }).toEqual({ label, mime: "image/png", size: 400, name: "a.png" });
    }
  });

  test("animated png, gif, webp, svg and a failing transform keep their bytes; svg and gif never reach the resizer", async () => {
    const h = harness();
    expect((await (await h.upload(png(100, 100, 80, true), "a.png", "image/png")).json() as any).mime).toBe("image/png");
    expect((await (await h.upload(GIF, "a.gif", "image/gif")).json() as any).mime).toBe("image/gif");
    expect((await (await h.upload(webp(10, 10, 40), "a.webp", "image/webp")).json() as any).size).toBe(40);
    expect((await (await h.upload(new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), "a.svg", "image/svg+xml")).json() as any).mime).toBe("image/svg+xml");
    expect(h.calls).toEqual([]);
    const failing = harness({ out: () => null });
    expect((await (await failing.upload(png(100, 100, 400), "a.png", "image/png")).json() as any).mime).toBe("image/png");
  });

  test("Images over the free 5,000 (9422), a thrown fetch or a non-WebP answer store the original png/jpeg unchanged", async () => {
    const source = png(3000, 2000, 400);
    const cases: [string, (url: string, init: any) => Promise<Response>][] = [
      ["9422", async () => new Response("transform failed: ERROR 9422: monthly transformation limit reached", { status: 422 })],
      ["throws", async () => { throw new Error("service binding unavailable"); }],
      ["png back", async () => new Response(png(2560, 1700, 300).slice().buffer as ArrayBuffer)],
      ["too wide", async () => new Response(webp(3000, 2000, 20).slice().buffer as ArrayBuffer)],
    ];
    for (const [label, resizer] of cases) {
      const h = harness({ resizer });
      const res = await h.upload(source, "a.png", "image/png");
      const body = await res.json() as any;
      expect({ label, status: res.status, mime: body.mime, size: body.size, name: body.name, original: body.originalSize }).toEqual({ label, status: 200, mime: "image/png", size: 400, name: "a.png", original: undefined });
      expect(new Uint8Array(h.stored.get("media/" + body.id)!.value)).toEqual(source);
      expect(h.ledger.used).toBe(400);
    }
  });

  test("the acard-image /compress route answers 422 (not a broken image) when Images refuses, and checks its parameters", async () => {
    const refusing = { IMAGES: { input: () => ({ transform: () => ({ output: async () => { throw new Error("ERROR 9422: transformation limit"); } }) }) } };
    const res = await imageWorker.fetch(new Request("https://acard-image/compress?max=2560&q=85", { method: "POST", body: png(10, 10) }), refusing);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("9422");
    for (const query of ["max=0&q=85", "max=2560&q=0", "max=2560&q=101", "max=bad&q=85"]) {
      expect((await imageWorker.fetch(new Request("https://acard-image/compress?" + query, { method: "POST", body: png(10, 10) }), refusing)).status).toBe(400);
    }
    const seen: any[] = [];
    const ok = { IMAGES: { input: () => ({ transform: (t: any) => { seen.push(t); return { output: async (o: any) => { seen.push(o); return { response: () => new Response("webp") }; } }; } }) } };
    expect((await imageWorker.fetch(new Request("https://acard-image/compress?max=2560&q=85", { method: "POST", body: png(10, 10) }), ok)).status).toBe(200);
    expect(seen).toEqual([{ width: 2560, height: 2560, fit: "scale-down" }, { format: "image/webp", quality: 85 }]);
  });

  test("a png declared as jpeg is not compressed under the wrong type", async () => {
    const h = harness();
    expect((await (await h.upload(png(100, 100, 400), "a.jpg", "image/jpeg")).json() as any).mime).toBe("image/jpeg");
    expect(h.calls).toEqual([]);
  });

  test("webpName swaps png/jpg/jpeg endings only", () => {
    expect(["a.png", "b.JPG", "c.jpeg", "d.gif", "e"].map(webpName)).toEqual(["a.webp", "b.webp", "c.webp", "d.gif", "e"]);
  });
});
