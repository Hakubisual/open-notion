// Media originals live in R2 (bucket acard-media, binding MEDIA_R2) from 2026-10-20; the KV namespace MEDIA keeps
// everything else (imginfo/<id>, resized @w copies) and the originals written before the move, which stay as a fallback
// so an image that was not copied yet still opens. App code keeps calling env.MEDIA with the KV shape it always used:
// this wrapper sends original keys (…media/<16 hex>) to R2 and the rest to KV. The /media/<id> addresses do not change.

type KvLike = {
  get(key: string, options?: unknown): Promise<unknown>;
  getWithMetadata(key: string, options?: unknown): Promise<{ value: unknown; metadata: unknown }>;
  put(key: string, value: unknown, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
};

type R2Object = { key: string; size: number; customMetadata?: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> };
export type R2Like = {
  get(key: string): Promise<R2Object | null>;
  head(key: string): Promise<{ key: string; size: number; customMetadata?: Record<string, string> } | null>;
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number; include?: string[] }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
};

export const ORIGINAL_KEY = /(?:^|\/)media\/[0-9a-f]{16}$/;

function typeOf(options: unknown): string {
  return options && typeof options === "object" && typeof (options as { type?: unknown }).type === "string" ? (options as { type: string }).type : "text";
}

async function decode(object: R2Object, type: string): Promise<unknown> {
  if (type === "arrayBuffer") return object.arrayBuffer();
  if (type === "stream") return (object as unknown as { body: unknown }).body;
  const text = await object.text();
  return type === "json" ? JSON.parse(text) : text;
}

function readMeta(object: { customMetadata?: Record<string, string> }): Record<string, unknown> {
  try { return JSON.parse(object.customMetadata?.meta ?? "{}"); } catch { return {}; }
}

export function r2Put(r2: R2Like, key: string, value: unknown, options?: unknown) {
  const metadata = options && typeof options === "object" ? (options as { metadata?: Record<string, unknown> }).metadata : undefined;
  const mime = typeof metadata?.mime === "string" ? metadata.mime : "application/octet-stream";
  return r2.put(key, value, { httpMetadata: { contentType: mime }, customMetadata: { meta: JSON.stringify(metadata ?? {}) } });
}

export function hybridMedia(kv: KvLike, r2: R2Like): KvLike & { readonly r2: R2Like; readonly kv: KvLike } {
  return {
    r2,
    kv,
    async get(key, options) {
      if (!ORIGINAL_KEY.test(key)) return kv.get(key, options);
      const object = await r2.get(key);
      return object ? decode(object, typeOf(options)) : kv.get(key, options);
    },
    async getWithMetadata(key, options) {
      if (!ORIGINAL_KEY.test(key)) return kv.getWithMetadata(key, options);
      const object = await r2.get(key);
      if (!object) return kv.getWithMetadata(key, options);
      return { value: await decode(object, typeOf(options)), metadata: { ...readMeta(object), store: "r2" } };
    },
    async put(key, value, options) {
      if (!ORIGINAL_KEY.test(key)) return kv.put(key, value, options);
      await r2Put(r2, key, value, options);
    },
    async delete(key) {
      if (ORIGINAL_KEY.test(key)) await r2.delete(key);
      await kv.delete(key);
    },
    // Used when a workspace is deleted (gate/tenancy.ts wipeWorkspace): every key under the prefix in either store.
    async list(options = {}) {
      const found = await kv.list(options);
      if (found.list_complete === false) return found;
      const names = new Set(found.keys.map((entry) => entry.name));
      const extra: { name: string }[] = [];
      let cursor: string | undefined;
      do {
        const page = await r2.list({ prefix: options.prefix, cursor, limit: 1000 });
        for (const object of page.objects) if (!names.has(object.key)) extra.push({ name: object.key });
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return { ...found, keys: found.keys.concat(extra), list_complete: true };
    },
  };
}

export function withR2Media<E extends { MEDIA?: unknown; MEDIA_R2?: unknown }>(env: E): E {
  if (!env.MEDIA || !env.MEDIA_R2) return env;
  return { ...env, MEDIA: hybridMedia(env.MEDIA as KvLike, env.MEDIA_R2 as R2Like) };
}

// One-off move (2026-10-20): copy KV originals into R2 under the same key. Idempotent (an object already in R2 with the
// same size is skipped), never deletes KV. Called page by page by scripts/media-to-r2.ts through POST /__media/migrate.
export async function migrateMediaPage(kv: KvLike, r2: R2Like, cursor: string | undefined, limit: number) {
  const page = await kv.list({ cursor, limit });
  const out = { scanned: page.keys.length, copied: 0, skipped: 0, failed: [] as string[], bytes: 0, cursor: page.list_complete ? null : page.cursor ?? null };
  for (const entry of page.keys) {
    if (!ORIGINAL_KEY.test(entry.name)) continue;
    const found = await kv.getWithMetadata(entry.name, { type: "arrayBuffer" });
    const value = found.value as ArrayBuffer | null;
    if (!value) { out.failed.push(entry.name + ": empty in KV"); continue; }
    const there = await r2.head(entry.name);
    if (there && there.size === value.byteLength) { out.skipped += 1; out.bytes += value.byteLength; continue; }
    await r2Put(r2, entry.name, value, { metadata: (found.metadata ?? {}) as Record<string, unknown> });
    const check = await r2.head(entry.name);
    if (!check || check.size !== value.byteLength) { out.failed.push(entry.name + ": size mismatch after copy"); continue; }
    out.copied += 1;
    out.bytes += value.byteLength;
  }
  return out;
}

export async function r2Usage(r2: R2Like) {
  let bytes = 0, objects = 0;
  let cursor: string | undefined;
  do {
    const page = await r2.list({ cursor, limit: 1000 });
    for (const object of page.objects) { bytes += object.size; objects += 1; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { bytes, objects };
}
