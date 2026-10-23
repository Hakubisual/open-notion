import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { componentCss, getComponent, renderComponentBlock, UI_PRESETS } from "../component-registry.js";
import "../components/asset-art.js";

const asaRoot = join(import.meta.dir, "..", "assets", "kit");
const asaManifest = JSON.parse(readFileSync(join(asaRoot, "index.json"), "utf8")) as { path: string; kind: string; name: string; width: number; height: number }[];
const asaIds = ["asset-header", "asset-empty", "asset-icons", "asset-pattern"];
const asaRender = (id: string, data: unknown) => renderComponentBlock({ type: "component", text: JSON.stringify(data), meta: { ui: id } });
const asaPaths = (html: string) => [...html.matchAll(/\/kit\/([a-z0-9/-]+\.(?:webp|svg))(?:#(i-[a-z-]+))?/g)];
const asaPoison = '<script>alert(1)</script>"><img src=x onerror=alert(1)>';

describe.each(asaIds)("%s", (id) => {
  test("renders sample, malformed input, empty data, and every preset", () => {
    const component = getComponent(id)!;
    expect(component.family).toBe("asset");
    for (const data of [{}, component.sample, ...UI_PRESETS.map((preset) => ({ ...component.sample, preset }))]) {
      const html = asaRender(id, data);
      expect(html).toContain('data-ui="' + id + '"');
      expect(html).not.toContain("ui-fallback");
    }
    const malformed = renderComponentBlock({ text: "{bad", meta: { ui: id } });
    expect(malformed).toContain('data-ui-invalid="1"');
    expect(malformed).not.toContain("ui-fallback");
  });

  test("every sample asset path and sprite fragment exists", () => {
    const html = asaRender(id, getComponent(id)!.sample) + componentCss([id]);
    const paths = asaPaths(html);
    expect(paths.length).toBeGreaterThan(0);
    for (const [, path, fragment] of paths) {
      expect(existsSync(join(asaRoot, path)), path).toBe(true);
      if (fragment) expect(readFileSync(join(asaRoot, path), "utf8")).toContain('id="' + fragment + '"');
    }
  });

  test("escapes supplied strings without removing the legitimate static artwork", async () => {
    const html = asaRender(id, { title: asaPoison, subtitle: asaPoison, text: asaPoison, art: asaPoison, pattern: asaPoison, tone: asaPoison, action: { label: asaPoison, href: "/notes?q=\"safe\"&x=1" }, items: [{ icon: asaPoison, label: asaPoison, text: asaPoison }] });
    const unsafe: string[] = [];
    await new HTMLRewriter().on("*", { element(element) {
      if (element.tagName === "script") unsafe.push("script");
      for (const [name] of element.attributes) if (/^on/i.test(name)) unsafe.push(name);
      if (element.tagName === "img" && !/^\/kit\/(headers|empty)\/[a-z]+\.webp$/.test(element.getAttribute("src") || "")) unsafe.push("image source");
    } }).transform(new Response(html)).text();
    expect(unsafe).toEqual([]);
    expect(html).toContain("&lt;script&gt;");
    for (const img of html.matchAll(/<img\b[^>]*>/g)) expect(img[0]).toMatch(/src="\/kit\/(headers|empty)\/[a-z]+\.webp"/);
  });
});

test("the embedded allowlists exactly match all supported manifest names", () => {
  const properties = (id: string) => getComponent(id)!.schema.properties;
  for (const [kind, names] of [
    ["header", properties("asset-header").art.enum],
    ["empty", properties("asset-empty").art.enum],
    ["pattern", properties("asset-header").pattern.enum],
    ["pattern", properties("asset-pattern").pattern.enum],
    ["icon", properties("asset-icons").items.items.properties.icon.enum],
  ] as const) expect(names).toEqual(asaManifest.filter((entry) => entry.kind === kind).map((entry) => entry.name));
});

test("every allowed art, pattern, and icon resolves to a real manifest asset", () => {
  for (const entry of asaManifest.filter((entry) => entry.kind !== "cover")) {
    const id = entry.kind === "header" ? "asset-header" : entry.kind === "empty" ? "asset-empty" : entry.kind === "pattern" ? "asset-pattern" : "asset-icons";
    const html = asaRender(id, entry.kind === "icon" ? { items: [{ icon: entry.name, label: entry.name }] } : { art: entry.name, pattern: entry.name });
    expect(html).toContain("/kit/" + entry.path);
    for (const [, path, fragment] of asaPaths(html)) {
      expect(existsSync(join(asaRoot, path)), path).toBe(true);
      if (fragment) expect(readFileSync(join(asaRoot, path), "utf8")).toContain('id="' + fragment + '"');
    }
    if (entry.kind === "header" || entry.kind === "empty") {
      expect(html).toContain('width="' + entry.width + '" height="' + entry.height + '"');
      expect(html).toContain('alt="" loading="lazy" decoding="async"');
    }
    if (entry.kind === "icon") expect(html).toContain('role="img" aria-label="' + entry.name + '"');
    if (entry.kind === "pattern") expect(html).toContain("mask-image:url(/kit/" + entry.path + ")");
  }
});

test("unknown names and malformed name values fall back to the first manifest entry", () => {
  for (const value of ["unknown", "../../private", asaPoison, null, 5, {}, [], "toString"]) {
    const header = asaRender("asset-header", { art: value, pattern: value });
    expect(header).toContain('/kit/headers/desk.webp');
    expect(header).toContain('/kit/patterns/dots.svg');
    expect(asaRender("asset-empty", { art: value })).toContain('/kit/empty/folder.webp');
    expect(asaRender("asset-pattern", { pattern: value })).toContain('/kit/patterns/dots.svg');
    expect(asaRender("asset-icons", { items: [{ icon: value }] })).toContain('/kit/icons.svg#i-chart');
  }
});

test("empty-state actions only accept labelled HTTPS or root-relative links", () => {
  for (const href of ["/notes/new", "/", "/notes?q=a&b=c", "https://example.com/notes"]) {
    const html = asaRender("asset-empty", { action: { label: "Continue", href } });
    expect(html).toContain('<a class="vk-asset-action"');
    expect(html).toContain('href="' + href.replaceAll("&", "&amp;") + '"');
  }
  for (const href of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "//example.com", "/\\example.com", "https://", "https://example.com\n", "relative/path", 1, null]) {
    expect(asaRender("asset-empty", { action: { label: "Continue", href } })).not.toContain('<a ');
  }
  expect(asaRender("asset-empty", { action: { href: "/notes" } })).not.toContain('<a ');
});

test("malformed icon items stay calm and valid items are bounded", () => {
  for (const items of [null, "wrong", [null, 5, [], false]]) expect(asaRender("asset-icons", { items })).not.toContain("ui-fallback");
  const html = asaRender("asset-icons", { items: Array.from({ length: 30 }, () => ({ icon: "doc", label: "Record" })) });
  expect([...html.matchAll(/<use /g)]).toHaveLength(24);
});
