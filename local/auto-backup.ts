// Automatic backups of the local app (docs/local-first.md 7장).
// Once per interval the whole workspace is saved as <data>/backups/auto-YYYYMMDD-HHMMSS.zip (newest AUTO_BACKUP.keep kept;
// before-restore-* safety copies are never touched). When the app is connected to notes.example.com the same zip is also
// uploaded as an automatic cloud backup; the server decides whether the account may upload (subscription) and which old
// automatic backups it keeps. The last result of each lives in <data>/auto-backup.json for the "내 데이터" screen.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportLocal, type LocalArchiveEnv } from "./archive";
import type { CloudClient } from "./cloud";

// One place for the schedule. ACARD_BACKUP_INTERVAL_MS=60000 is the test value (one backup a minute).
export const AUTO_BACKUP = {
  intervalMs: Number(process.env.ACARD_BACKUP_INTERVAL_MS) > 0 ? Number(process.env.ACARD_BACKUP_INTERVAL_MS) : 86_400_000,
  keep: 7,
};

export type AutoResult = { at: number; name?: string; bytes?: number; error?: string; skipped?: string };
export type AutoState = { local: AutoResult | null; cloud: AutoResult | null };

const AUTO_NAME = /^auto-\d{8}-\d{6}\.zip$/;
const stamp = (now: Date) => now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

export function autoBackups(dataDir: string): string[] {
  try { return readdirSync(join(dataDir, "backups")).filter((name) => AUTO_NAME.test(name)).sort().reverse(); } catch { return []; }
}

export function readAutoState(dataDir: string): AutoState {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, "auto-backup.json"), "utf8")) as Partial<AutoState>;
    return { local: raw.local ?? null, cloud: raw.cloud ?? null };
  } catch {
    return { local: null, cloud: null };
  }
}

function lastLocalAt(dataDir: string, state: AutoState): number {
  if (state.local && !state.local.error) return state.local.at;
  const newest = autoBackups(dataDir)[0];
  if (!newest) return 0;
  const m = /^auto-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/.exec(newest)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function startAutoBackup(options: { env: LocalArchiveEnv; dataDir: string; ready: () => Promise<void>; cloud: CloudClient; intervalMs?: number; keep?: number }) {
  const intervalMs = options.intervalMs ?? AUTO_BACKUP.intervalMs;
  const keep = options.keep ?? AUTO_BACKUP.keep;
  const { dataDir } = options;
  const dir = join(dataDir, "backups");
  const file = join(dataDir, "auto-backup.json");
  let state = readAutoState(dataDir);
  let running: Promise<AutoState> | null = null;
  const save = () => writeFileSync(file, JSON.stringify(state));

  async function uploadCloud(zip: Uint8Array): Promise<AutoResult | null> {
    if (!options.cloud.enabled || !options.cloud.status().connected) return null;
    const res = await options.cloud.call("/api/v1/cloud/backups?auto=1", { method: "POST", headers: { "content-type": "application/zip" }, body: zip as BodyInit });
    const body = (await res.json().catch(() => ({}))) as { name?: string; bytes?: number; error?: string };
    if (res.status === 402) return { at: Date.now(), skipped: "subscription_required" };
    if (!res.ok) return { at: Date.now(), error: body.error || "업로드 실패 (" + res.status + ")" };
    return { at: Date.now(), name: body.name, bytes: body.bytes };
  }

  async function backup(): Promise<AutoState> {
    await options.ready();
    const now = new Date();
    let zip: Uint8Array;
    try {
      zip = await exportLocal(options.env);
      mkdirSync(dir, { recursive: true });
      let name = "auto-" + stamp(now) + ".zip";
      for (let step = 1; existsSync(join(dir, name)); step++) name = "auto-" + stamp(new Date(now.getTime() + step * 1000)) + ".zip";
      writeFileSync(join(dir, name), zip);
      for (const old of autoBackups(dataDir).slice(keep)) rmSync(join(dir, old), { force: true });
      state = { ...state, local: { at: now.getTime(), name, bytes: zip.length } };
    } catch (error) {
      state = { ...state, local: { at: now.getTime(), error: String((error as Error).message || error) } };
      save();
      return state;
    }
    save();
    try {
      const cloud = await uploadCloud(zip);
      if (cloud) state = { ...state, cloud };
    } catch (error) {
      state = { ...state, cloud: { at: Date.now(), error: String((error as Error).message || error) } };
    }
    save();
    return state;
  }

  function tick(force = false): Promise<AutoState> {
    if (running) return running;
    if (!force && Date.now() - lastLocalAt(dataDir, state) < intervalMs) return Promise.resolve(state);
    running = backup().finally(() => { running = null; });
    return running;
  }

  // Checked often enough that a 1-minute test interval is met within ~15 s, and a day-long one right after the PC wakes.
  const checkMs = Math.min(60_000, Math.max(5_000, Math.floor(intervalMs / 4)));
  const first = setTimeout(() => { tick().catch(() => {}); }, 3_000);
  const timer = setInterval(() => { tick().catch(() => {}); }, checkMs);

  return {
    intervalMs,
    keep,
    tick,
    status: () => {
      const last = lastLocalAt(dataDir, state);
      return { intervalMs, keep, local: state.local, cloud: state.cloud, files: autoBackups(dataDir), next: last ? last + intervalMs : null, running: Boolean(running) };
    },
    stop: () => { clearTimeout(first); clearInterval(timer); },
  };
}

export type AutoBackup = ReturnType<typeof startAutoBackup>;
