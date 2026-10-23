import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startFakeApi, TOKEN } from "./fake-server.js";
import { makeTempDir, removeDir, runCli } from "./run.js";

let api;
let dir;

beforeEach(async () => {
  api = startFakeApi([
    { slug: "hello", title: "Hello", body: "Hello body\n", updated: 1_600_000_000_000 },
    { slug: "child", title: "Child", parent: "hello", icon: "📄", body: "Child body\n", updated: 1_600_000_001_000 },
    { slug: "tasks", title: "Tasks", kind: "db", body: "", updated: 1_600_000_002_000 },
  ]);
  dir = await makeTempDir();
});

afterEach(async () => {
  api.stop();
  await removeDir(dir);
});

const cli = (args, token = TOKEN) => runCli(args, { token, server: api.url });
const state = async () => JSON.parse(await readFile(join(dir, ".acard-sync.json"), "utf8"));
const writes = () => api.requests.filter((r) => r.method === "PUT" || r.method === "POST");

describe("pull", () => {
  test("writes note pages as <slug>.md with state", async () => {
    const r = await cli(["pull", dir]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(await readFile(join(dir, "hello.md"), "utf8")).toContain("title: Hello\nslug: hello\n");
    expect(await readFile(join(dir, "child.md"), "utf8")).toContain("parent: hello");
    expect(existsSync(join(dir, "tasks.md"))).toBe(false); // kind "db" is skipped
    const s = await state();
    expect(Object.keys(s).sort()).toEqual(["child", "hello"]);
    expect(s.hello.updated).toBe(1_600_000_000_000);
    expect(s.hello.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("push", () => {
  test("unchanged files send nothing", async () => {
    await cli(["pull", dir]);
    const r = await cli(["push", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("unchanged hello.md");
    expect(writes()).toEqual([]);
  });

  test("local edit sends PUT and refreshes state", async () => {
    await cli(["pull", dir]);
    const file = join(dir, "hello.md");
    await writeFile(file, (await readFile(file, "utf8")) + "Edited locally\n");
    const r = await cli(["push", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("updated   hello.md");
    expect(r.stdout).toContain("unchanged child.md");
    expect(writes()).toEqual([{ method: "PUT", path: "/api/v1/pages/hello", search: "" }]);
    expect(api.pages.get("hello").body).toContain("Edited locally");
    expect((await state()).hello.updated).toBe(api.pages.get("hello").updated);
    // State matches the refreshed file, so a second push is a no-op.
    expect((await cli(["push", dir])).stdout).toContain("unchanged hello.md");
  });

  test("remote newer than state reports conflict and does not overwrite", async () => {
    await cli(["pull", dir]);
    const remote = api.pages.get("hello");
    remote.body = "Remote edit\n";
    remote.updated = api.tick();
    const file = join(dir, "hello.md");
    await writeFile(file, (await readFile(file, "utf8")) + "Local edit\n");
    const r = await cli(["push", dir]);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("conflict  hello.md");
    expect(writes()).toEqual([]);
    expect(api.pages.get("hello").body).toBe("Remote edit\n");
    expect(await readFile(file, "utf8")).toContain("Local edit");
  });

  test("remote edited between the conflict check and the PUT is still a conflict (server 409)", async () => {
    await cli(["pull", dir]);
    api.editAfterNextJsonGet("hello", "Human edit during push\n");
    const file = join(dir, "hello.md");
    await writeFile(file, (await readFile(file, "utf8")) + "Local edit\n");
    const r = await cli(["push", dir]);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toContain("conflict  hello.md");
    expect(api.pages.get("hello").body).toBe("Human edit during push\n");
    expect(await readFile(file, "utf8")).toContain("Local edit");
  });

  test("new file is POSTed and renamed to the server slug", async () => {
    await cli(["pull", dir]);
    await writeFile(join(dir, "draft.md"), "---\ntitle: My New Page\nparent: hello\n---\n\nFresh content\n");
    const r = await cli(["push", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("created   draft.md -> my-new-page.md");
    expect(writes()).toEqual([{ method: "POST", path: "/api/v1/pages", search: "" }]);
    expect(existsSync(join(dir, "draft.md"))).toBe(false);
    expect(await readFile(join(dir, "my-new-page.md"), "utf8")).toContain("Fresh content");
    expect(api.pages.get("my-new-page").parent).toBe("hello");
    expect((await state())["my-new-page"].updated).toBe(api.pages.get("my-new-page").updated);
  });
});

describe("auth", () => {
  test("whoami prints agent, via, scopes", async () => {
    const r = await cli(["whoami"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ agent: "test-agent", via: "token", scopes: ["read", "write"] });
  });

  for (const [label, token] of [["missing", null], ["invalid", "wrong-token"]]) {
    test(`${label} token -> 401 guidance, exit 1`, async () => {
      const r = await cli(["pull", dir], token);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("HTTP 401: invalid token");
      expect(r.stderr).toContain("set ACARD_TOKEN to the server's agent token");
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
    });
  }
});
