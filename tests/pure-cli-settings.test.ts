import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
// Built from parts so the edition's grep for these words does not hit this test itself.
const GUIDE = ["get", "write", "guide"].join("_");
const PREF = ["set", "write", "pref"].join("_");

// The self-host CLI is a plain local API/MCP client: pull, push, mcp and whoami against the local server.
test("the CLI ships only its sync, MCP and API files and defaults to the local server", async () => {
  expect(readdirSync(join(ROOT, "packages/acard-cli/src")).sort()).toEqual(["api.js", "local-images.js", "main.js", "mcp.js", "sync.js"]);
  const { DEFAULT_SERVER } = await import(join(ROOT, "packages/acard-cli/src/api.js"));
  expect(DEFAULT_SERVER).toBe("http://127.0.0.1:47811");
  const proc = Bun.spawn(["node", join(ROOT, "packages/acard-cli/bin/acard.js"), "--help"], { stdout: "pipe", stderr: "pipe" });
  const help = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  for (const cmd of ["pull", "push", "mcp", "whoami"]) expect(help).toContain("acard " + cmd);
  for (const gone of ["hooks", "setup", "--no-mcp"]) expect(help).not.toContain(gone);
});

test("an unknown command such as hooks exits 1", async () => {
  const proc = Bun.spawn(["node", join(ROOT, "packages/acard-cli/bin/acard.js"), "hooks", "install"], { stdout: "pipe", stderr: "pipe" });
  expect(await new Response(proc.stderr).text()).toContain("unknown command: hooks");
  expect(await proc.exited).toBe(1);
});

test("the settings page has no write prefs, auto notes or pasted instruction", () => {
  const html = read("assets/agents.html");
  for (const id of ['id="write-prefs"', 'id="auto-notes"', 'id="instructions"', "#write-prefs", "#auto-notes", "lazy/projects"]) expect(html).not.toContain(id);
  const js = read("assets/agents.js");
  for (const gone of ["/api/write-prefs", "loadPrefs", "mcp-rule", GUIDE, PREF]) expect(js).not.toContain(gone);
  expect(js).toContain("loadTokens();");
});

test("the gate serves only the CLI package and the build makes no plugin or skill", () => {
  const gate = read("gate/agent-entry.ts");
  expect(gate).toContain('path === "/acard-cli.tgz"');
  for (const gone of ["acard-marketplace.json", "acard-claude-plugin.zip", "acard-skill.zip"]) {
    expect(gate).not.toContain(gone);
    if (existsSync(join(ROOT, "dist"))) expect(existsSync(join(ROOT, "dist", gone))).toBe(false);
  }
});
