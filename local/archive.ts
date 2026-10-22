// Local backup routes (docs/local-first.md 3장, 7장):
//   GET  /__local/archive/export            -> the whole workspace as one zip download
//   POST /__local/archive/import (zip body) -> safety backup of the current data, then replace it with the zip
//   GET  /__local/archive/backups           -> the safety backups kept in <data>/backups
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveError, applyArchive, exportArchive, readArchive, type ArchiveDb, type MediaFile } from "../gate/archive";

type MediaKv = {
  getWithMetadata(key: string, options?: unknown): Promise<{ value: unknown; metadata: unknown }>;
  put(key: string, value: unknown, options?: unknown): Promise<void>;
};
export type LocalArchiveEnv = { DB: ArchiveDb; MEDIA: MediaKv };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const stamp = (now = new Date()) => now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");

export function mediaReader(media: MediaKv) {
  return async (id: string): Promise<MediaFile | null> => {
    const found = await media.getWithMetadata("media/" + id, { type: "arrayBuffer" });
    if (!found.value) return null;
    const meta = (found.metadata ?? {}) as { mime?: string; name?: string };
    return { id, bytes: new Uint8Array(found.value as ArrayBuffer), mime: meta.mime ?? "application/octet-stream", name: meta.name ?? "file" };
  };
}

export function mediaWriter(media: MediaKv) {
  return async (file: MediaFile) => {
    await media.put("media/" + file.id, file.bytes, { metadata: { mime: file.mime, name: file.name, size: file.bytes.length } });
  };
}

export async function exportLocal(env: LocalArchiveEnv, pages?: string[]) {
  return exportArchive(env.DB, mediaReader(env.MEDIA), { source: "local", app: "acard-local", pages });
}

export async function restoreLocal(env: LocalArchiveEnv, dataDir: string, bytes: Uint8Array) {
  const parts = await readArchive(bytes);
  const dir = join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const safety = join(dir, "before-restore-" + stamp() + ".zip");
  writeFileSync(safety, await exportLocal(env));
  const result = await applyArchive(env.DB, parts, mediaWriter(env.MEDIA));
  return { ...result, safetyBackup: safety, source: parts.manifest.source };
}

export function listBackups(dataDir: string) {
  const dir = join(dataDir, "backups");
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".zip")).map((name) => ({ name, bytes: statSync(join(dir, name)).size })).sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export async function archiveRoute(request: Request, url: URL, env: LocalArchiveEnv, dataDir: string, ready: () => Promise<void>): Promise<Response> {
  const path = url.pathname.slice("/__local/archive".length);
  try {
    await ready();
    if (path === "/export" && request.method === "GET") {
      return new Response((await exportLocal(env)) as BodyInit, {
        headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="acard-backup-${stamp()}.zip"`, "cache-control": "no-store" },
      });
    }
    if (path === "/import" && request.method === "POST") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length) return json({ error: "백업 파일이 비어 있어요." }, 400);
      return json({ ok: true, ...(await restoreLocal(env, dataDir, bytes)) });
    }
    if (path === "/backups" && request.method === "GET") return json({ backups: listBackups(dataDir) });
    return json({ error: "not found" }, 404);
  } catch (error) {
    if (error instanceof ArchiveError) return json({ error: error.message }, error.status);
    throw error;
  }
}
