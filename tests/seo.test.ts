import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

test("robots.txt points to the sitemap and keeps signed-in paths out; the sitemap lists only canonical public URLs", () => {
  const robots = robotsTxt();
  expect(robots).toContain("Sitemap: https://notes.example.com/sitemap.xml");
  for (const path of ["/api/", "/admin", "/settings", "/login", "/s/"]) expect(robots).toContain("Disallow: " + path + "\n");
  expect(robots).not.toMatch(/Disallow: \/\n/);
  const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual(Object.keys(PUBLIC_PAGES).map(canonicalUrl));
});
