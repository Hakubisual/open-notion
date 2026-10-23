import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

test("client bundles isolate editors, opt readers in, and omit empty reader tags", async () => {
  const root = join(import.meta.dir, "..");
  const fixture = await mkdtemp(join(tmpdir(), "acard-feature-bundle-"));
  try {
    await cp(root, fixture, { recursive: true, filter: (path) => !/^(node_modules|dist|\.build|\.git|\.wrangler)([\\/]|$)/.test(relative(root, path)) });
    await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "junction");
    const features = join(fixture, "assets/features");
    await rm(features, { recursive: true });
    await mkdir(features);
    const build = async () => {
      const process = Bun.spawn(["bun", "run", "build.ts"], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
      expect({ exit, error: exit ? stdout + stderr : "" }).toEqual({ exit: 0, error: "" });
    };
    const output = (name: string) => readFile(join(fixture, "dist", name), "utf8");
    await writeFile(join(features, "empty.reader.js"), " \n");
    await writeFile(join(features, "editor.js"), "window.editorFixture = true;");
    await build();
    expect(await output("features.js")).toContain("editorFixture");
    expect(await output("features-reader.js")).toBe("");
    expect(await output("index.html")).not.toContain("/features");
    expect(await output("_worker.js")).not.toContain("/features");
    expect(await output("editor.html")).toMatch(/\/features\.js\?v=/);
    const files = {
      "z.reader.js": "window.readerFixture = true;",
      "a.shared.js": "window.sharedFixture = true;",
      "z.reader.css": ".reader-fixture { color: red; }",
      "editor.css": ".editor-fixture { color: blue; }",
    };
    for (const [name, code] of Object.entries(files)) await writeFile(join(features, name), code);
    await build();
    expect(await output("features.js")).toBe("window.sharedFixture=true;window.editorFixture=true;");
    expect(await output("features-reader.js")).toBe("window.sharedFixture=true;window.readerFixture=true;");
    // style.css carries tokens.css in front instead of the @import round trip; tokens.css itself stays for local/cloud-page.ts.
    const tokens = (await output("tokens.css")).trimEnd();
    expect(tokens).toContain(":root{");
    expect(await output("style.css")).not.toContain("@import");
    expect((await output("style.css")).startsWith(tokens)).toBe(true);
    expect(await output("features.css")).toBe(files["editor.css"]);
    expect(await output("features-reader.css")).toBe(files["z.reader.css"]);
    for (const name of ["index.html", "_worker.js"]) {
      expect(await output(name)).toMatch(/\/features-reader\.js\?v=/);
      expect(await output(name)).toMatch(/\/features-reader\.css\?v=/);
      expect(await output(name)).not.toMatch(/\/features\.(js|css)/);
    }
    expect(await output("editor.html")).not.toContain("features-reader");
    // No lazy chunks: the recent-cache preload line is dropped rather than stamped with a placeholder.
    expect(await output("editor.html")).not.toContain("/lazy/");
    await mkdir(join(features, "lazy"));
    const lazySource = 'window.AcardEditor.provide("fixture", { heavyOnly: true });';
    await writeFile(join(features, "lazy/fixture.js"), lazySource);
    await writeFile(join(features, "lazy/fixture.css"), ".lazy-fixture { color: cyan; }");
    await writeFile(join(features, "lazy/README.md"), "Not shipped");
    await writeFile(join(features, "lazy/recent-cache.js"), 'window.AcardEditor.provide("recent-cache", {});');
    await build();
    // The minified bundle prints the manifest object literal (unquoted keys), so it is read as an expression, not JSON.
    const manifest = async () => new Function("return " + (await output("features.js")).match(/^window\.AcardLazy=(\{.*?\});/)![1])();
    const first = await manifest();
    const shipped = new Bun.Transpiler({ minifyWhitespace: true }).transformSync(lazySource);
    expect(first.fixture.js).toBe(Bun.hash(Buffer.from(shipped)).toString(36).slice(0, 8));
    expect(first.fixture.css).toBeTruthy();
    expect(await output("lazy/fixture.js")).toBe(shipped);
    expect(await output("features.js")).not.toContain("heavyOnly");
    expect(await output("features.css")).not.toContain("lazy-fixture");
    expect(await output("features-reader.js")).not.toContain("fixture");
    await expect(output("features/lazy/fixture.js")).rejects.toThrow();
    await expect(output("lazy/README.md")).rejects.toThrow();
    expect(await output("index.html")).not.toContain("/lazy/");
    expect(await output("editor.html")).not.toContain("/lazy/fixture");
    // The editor preloads recent-cache.js by the exact URL its lazy loader builds (/lazy/<name>.js?v=<manifest hash>).
    expect(await output("editor.html")).toContain('<link rel="preload" as="script" href="/lazy/recent-cache.js?v=' + first["recent-cache"].js + '">');
    expect(await output("lazy/recent-cache.js")).toBeTruthy();
    await writeFile(join(features, "lazy/fixture.js"), lazySource + "\nwindow.changed = 1;");
    await writeFile(join(features, "lazy/fixture.css"), ".lazy-fixture { color: purple; }");
    await build();
    const second = await manifest();
    expect(second.fixture.js).not.toBe(first.fixture.js);
    expect(second.fixture.css).not.toBe(first.fixture.css);
  } finally { await rm(fixture, { recursive: true, force: true }); }
}, 120000);
