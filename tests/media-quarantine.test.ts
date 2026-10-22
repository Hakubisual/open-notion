import { expect, test } from "bun:test";
import { hybridMedia, quarantineOriginal, restoreOriginal, QUARANTINE } from "../gate/media-store";

function memoryR2(options: { corruptCopies?: boolean } = {}) {
  const objects = new Map<string, { bytes: ArrayBuffer; custom: Record<string, string>; type: string }>();
  const view = (key: string, o: { bytes: ArrayBuffer; custom: Record<string, string>; type: string }) => ({ key, size: o.bytes.byteLength, customMetadata: o.custom, httpMetadata: { contentType: o.type }, arrayBuffer: async () => o.bytes, text: async () => new TextDecoder().decode(o.bytes) });
  return {
    objects,
    get: async (key: string) => (objects.has(key) ? view(key, objects.get(key)!) : null),
    head: async (key: string) => (objects.has(key) ? view(key, objects.get(key)!) : null),
    put: async (key: string, value: ArrayBuffer, o: any) => {
      const bytes = options.corruptCopies && key.startsWith(QUARANTINE) ? new Uint8Array(value.byteLength).buffer : value;
      objects.set(key, { bytes, custom: o?.customMetadata ?? {}, type: o?.httpMetadata?.contentType ?? "" });
    },
    delete: async (key: string) => { objects.delete(key); },
    list: async () => ({ objects: [...objects.entries()].map(([key, o]) => ({ key, size: o.bytes.byteLength })), truncated: false }),
  };
}
const emptyKv = { get: async () => null, getWithMetadata: async () => ({ value: null, metadata: null }), put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const KEY = "ws/0123456789abcdef0123456789abcdef/media/1111222233334444";
const bytes = () => new TextEncoder().encode("png bytes here").buffer as ArrayBuffer;

test("quarantine copies, checks and only then removes the original; restore puts the same bytes and metadata back", async () => {
  const r2 = memoryR2();
  await r2.put(KEY, bytes(), { httpMetadata: { contentType: "image/png" }, customMetadata: { meta: '{"mime":"image/png","name":"a.png"}' } });
  expect(await quarantineOriginal(r2 as any, KEY)).toEqual({ ok: true, bytes: 14 });
  expect(r2.objects.has(KEY)).toBe(false);
  const held = r2.objects.get(QUARANTINE + KEY)!;
  expect([held.type, held.custom.meta, typeof held.custom.quarantinedAt]).toEqual(["image/png", '{"mime":"image/png","name":"a.png"}', "string"]);
  expect(await quarantineOriginal(r2 as any, KEY)).toEqual({ ok: true, bytes: 0 });
  expect(await restoreOriginal(r2 as any, KEY)).toEqual({ ok: true, bytes: 14 });
  expect(r2.objects.has(QUARANTINE + KEY)).toBe(false);
  const back = r2.objects.get(KEY)!;
  expect([new TextDecoder().decode(back.bytes), back.type, back.custom]).toEqual(["png bytes here", "image/png", { meta: '{"mime":"image/png","name":"a.png"}' }]);
});

test("a copy that does not match keeps the original in place", async () => {
  const r2 = memoryR2({ corruptCopies: true });
  await r2.put(KEY, bytes(), { httpMetadata: { contentType: "image/png" }, customMetadata: {} });
  expect(await quarantineOriginal(r2 as any, KEY)).toEqual({ ok: false, error: "copy differs" });
  expect(new TextDecoder().decode(r2.objects.get(KEY)!.bytes)).toBe("png bytes here");
});

test("only original keys can be moved; a missing file is reported, never invented", async () => {
  const r2 = memoryR2();
  expect((await quarantineOriginal(r2 as any, "backups/u/x.zip")).ok).toBe(false);
  expect((await quarantineOriginal(r2 as any, KEY)).error).toBe("missing");
  expect((await restoreOriginal(r2 as any, KEY)).error).toBe("not in quarantine");
});

test("/media reads still find a quarantined original (marked) so a wrong call never breaks an image", async () => {
  const r2 = memoryR2();
  await r2.put(KEY, bytes(), { httpMetadata: { contentType: "image/png" }, customMetadata: { meta: '{"mime":"image/png"}' } });
  await quarantineOriginal(r2 as any, KEY);
  const store = hybridMedia(emptyKv as any, r2 as any);
  const found = await store.getWithMetadata(KEY, { type: "arrayBuffer" });
  expect(new TextDecoder().decode(found.value as ArrayBuffer)).toBe("png bytes here");
  expect(found.metadata).toMatchObject({ mime: "image/png", store: "r2", quarantined: true });
  expect(new TextDecoder().decode(await store.get(KEY, { type: "arrayBuffer" }) as ArrayBuffer)).toBe("png bytes here");
  expect((await store.getWithMetadata("ws/0123456789abcdef0123456789abcdef/media/9999999999999999", { type: "arrayBuffer" })).value).toBeNull();
});
