import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PUBLIC_PAGES, canonicalUrl, robotsTxt, sitemapXml } from "../gate/seo";

const ROOT = join(import.meta.dir, "..");
const site = (file: string) => readFileSync(join(ROOT, "assets", "_site", file), "utf8");
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

describe("canonical URLs", () => {
  test("use the site origin and drop query, fragment and trailing slash", () => {
    expect(canonicalUrl("/")).toBe("https://notes.example.com/");
    expect(canonicalUrl("/?v=1&utm_source=x")).toBe("https://notes.example.com/");
    expect(canonicalUrl("/guide/")).toBe("https://notes.example.com/guide");
    expect(canonicalUrl("/privacy?lang=en#top")).toBe("https://notes.example.com/privacy");
  });
});

describe("public pages carry link-preview and canonical tags in the served HTML", () => {
  for (const [path, files] of Object.entries(PUBLIC_PAGES)) {
    for (const file of files) {
      test(file, () => {
        const html = site(file);
        expect(html).toContain(`<link rel="canonical" href="${canonicalUrl(path)}">`);
        expect(meta(html, "og:url")).toBe(canonicalUrl(path));
        expect(meta(html, "og:image")).toBe("https://notes.example.com/og.png");
        expect(meta(html, "og:image:width")).toBe("1200");
        expect(meta(html, "og:image:height")).toBe("630");
        for (const key of ["og:title", "og:description", "og:type", "og:site_name", "og:locale", "og:image:alt", "twitter:title", "twitter:description"]) expect(meta(html, key), key).toBeTruthy();
        expect(meta(html, "twitter:card")).toBe("summary_large_image");
        expect(meta(html, "twitter:image")).toBe("https://notes.example.com/og.png");
        expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
      });
    }
  }
});

test("og.png is a 1200x630 PNG", () => {
  const png = readFileSync(join(ROOT, "assets", "og.png"));
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});

test("#118 the built pages point og:image at /og.png?v=<hash of the built og.png>, and a new og.png gives a new URL", async () => {
  const fixture = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "acard-og-version-"));
  try {
    await cp(ROOT, fixture, { recursive: true, filter: (path) => !/^(node_modules|dist|\.build|\.git|\.wrangler|design|research)([\\/]|$)/.test(relative(ROOT, path)) });
    await symlink(join(ROOT, "node_modules"), join(fixture, "node_modules"), "junction");
    const build = async () => {
      const proc = Bun.spawn(["bun", "run", "build.ts"], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect({ exit, error: exit ? stdout + stderr : "" }).toEqual({ exit: 0, error: "" });
      const hash = Bun.hash(await readFile(join(fixture, "dist", "og.png"))).toString(36).slice(0, 8);
      const worker = await readFile(join(fixture, "dist", "_worker.js"), "utf8");
      expect(worker).toContain('"og.png": "' + hash + '"');
      expect(worker).toContain('<meta property="og:image" content="/og.png?v=' + hash + '">');
      for (const file of ["index.html", "privacy.en.html", "terms.zh.html", "download.html"]) {
        const html = await readFile(join(fixture, "dist", "_site", file), "utf8");
        expect(meta(html, "og:image"), file).toBe("https://notes.example.com/og.png?v=" + hash);
        expect(meta(html, "twitter:image"), file).toBe("https://notes.example.com/og.png?v=" + hash);
      }
      return hash;
    };
    const first = await build();
    await writeFile(join(fixture, "assets", "og.png"), Buffer.concat([await readFile(join(fixture, "assets", "og.png")), Buffer.from("new logo")]));
    expect(await build()).not.toBe(first);
  } finally { await rm(fixture, { recursive: true, force: true }); }
}, 120000);

test("robots.txt points to the sitemap and keeps signed-in paths out; the sitemap lists only canonical public URLs", () => {
  const robots = robotsTxt();
  expect(robots).toContain("Sitemap: https://notes.example.com/sitemap.xml");
  for (const path of ["/api/", "/admin", "/settings", "/login", "/s/"]) expect(robots).toContain("Disallow: " + path + "\n");
  expect(robots).not.toMatch(/Disallow: \/\n/);
  const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual(Object.keys(PUBLIC_PAGES).map(canonicalUrl));
});
