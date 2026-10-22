// acard-next-10 #8: a new local data folder opened on one empty page and a bare sidebar. It now starts with the example
// pages and the home shows the local 시작하기 steps (first page, local MCP address, Notion/markdown import, backup file).
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const APP = join(import.meta.dir, "..", "dist");
const dirs: string[] = [];
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// A port the OS just handed out, so parallel runs and other local servers never collide.
function freePort() { const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); const port = probe.port; probe.stop(true); return port; }

async function boot(dataDir: string, port = freePort()) {
  const child = Bun.spawn(["bun", join(import.meta.dir, "..", "local", "main.ts")], {
    env: { ...process.env, ACARD_DATA_DIR: dataDir, ACARD_APP_DIR: APP, ACARD_PORT: String(port) }, stdin: "pipe", stdout: "pipe", stderr: "inherit",
  });
  const reader = child.stdout.getReader();
  for (let seen = ""; !seen.includes("READY");) {
    const { value, done } = await reader.read();
    if (done) throw new Error("local server exited before READY: " + seen);
    seen += new TextDecoder().decode(value);
  }
  const base = "http://127.0.0.1:" + port;
  const call = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { origin: base, ...(init.headers as Record<string, string>) } });
  const stop = async () => { child.stdin.end(); await child.exited; };
  return { base, call, stop };
}

const titles = async (call: (path: string) => Promise<Response>) => ((await (await call("/api/folders/tree")).json()) as { pages: { title: string; kind: string }[] }).pages.filter((p) => p.kind === "note").map((p) => p.title).sort();

test("a new local data folder starts with example pages and the local checklist at 0 / 4, once", async () => {
  const dataDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "acard-first-run-"));
  dirs.push(dataDir);
  const first = await boot(dataDir);
  try {
    expect(await titles(first.call)).toEqual(["Getting started", "My first weekly plan"]);
    const profile = await (await first.call("/api/profile")).json() as any;
    expect(profile).toEqual({ profile: { home_layout: { widgets: [] } }, local: { mcp: first.base + "/mcp", mcpCopied: false, backupDone: false } });
    const summary = await (await first.call("/api/home/summary")).json() as any;
    expect(summary.checklist).toMatchObject({ page: false, import: false });
    expect((await first.call("/__local/archive/export")).status).toBe(200);
    expect((await (await first.call("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: "mcp" }) })).json() as any).local)
      .toEqual({ mcp: first.base + "/mcp", mcpCopied: true, backupDone: true });
  } finally { await first.stop(); }
  const again = await boot(dataDir);
  try {
    expect(await titles(again.call)).toEqual(["Getting started", "My first weekly plan"]);
    expect(((await (await again.call("/api/profile")).json()) as any).local).toMatchObject({ mcpCopied: true, backupDone: true });
  } finally { await again.stop(); }
}, 60000);

test("the home checklist draws the local steps from the local profile and keeps the web steps otherwise", () => {
  const source = readFileSync(new URL("../assets/ui/home.js", import.meta.url), "utf8");
  const render = (local: unknown) => runInNewContext(source.slice(source.indexOf("  function checklistHtml("), source.indexOf("  async function render(")) + "\nchecklistHtml({ page: true }, local)", {
    local, icon: () => "", esc: (s: string) => s.replaceAll("&", "&amp;"), href: (s: string) => "/" + encodeURIComponent(s) + "/", localStorage: { getItem: () => "0" },
  }) as string;
  const local = render({ mcp: "http://127.0.0.1:47811/mcp", mcpCopied: true, backupDone: false });
  expect([...local.matchAll(/data-step="(\w+)"/g)].map((m) => m[1])).toEqual(["page", "mcp", "import", "backup"]);
  expect(local).toContain('aria-valuenow="2"');
  expect(local).toContain('href="http://127.0.0.1:47811/mcp"');
  expect(local).toContain('href="/__local/archive/export" download');
  expect([...render(null).matchAll(/data-step="(\w+)"/g)].map((m) => m[1])).toEqual(["page", "agent", "import", "share"]);
});
