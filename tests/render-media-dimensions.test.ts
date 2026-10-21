import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import * as blocks from "../block-html.js";
import * as model from "../db-model.js";

const root = join(import.meta.dir, "..");
const shared = { ...blocks, ...model };
const db = new Function(...Object.keys(shared), readFileSync(join(root, "db-html.js"), "utf8").replace(/^export /gm, "") + "\nreturn {dbFileCell,databaseHtml};")(...Object.values(shared));
const context = { window: {} as any };
runInNewContext(readFileSync(join(root, "assets/db-views.js"), "utf8"), context);
const image = (id: string, meta: any = {}, indent = 0) => ({ id, type: "image", text: id, indent, meta: { src: "/media/" + id, ...meta } });
const images = (html: string) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const sizes = '(max-width: 760px) 100vw, 760px';

describe("reader media geometry", () => {
  test("intrinsic pixels are separate from figure percentage and use bounded variants", () => {
    const html = blocks.renderBlocks([image("photo", { iw: 1600, ih: 900, width: 50 })]);
    expect(html).toContain('style="width:50%"');
    expect(html).toContain('width="1600" height="900"');
    expect(html).toContain('style="height:auto"');
    expect(html).toContain('decoding="async" loading="eager" fetchpriority="high"');
    expect(html).toContain('srcset="/media/photo?w=400 400w, /media/photo?w=800 800w, /media/photo?w=1600 1600w"');
    expect(html).toContain('sizes="' + sizes + '"');
  });

  test("legacy images get variants without invented geometry and escape attributes", () => {
    const html = blocks.renderBlocks([image('old"photo')]);
    expect(images(html)[0]).not.toMatch(/\s(?:width|height)=/);
    expect(html).toContain('src="/media/old&quot;photo"');
    expect(html).toContain('srcset="/media/old&quot;photo?w=400');
    expect(blocks.renderBlocks([image("bad", { iw: -1, ih: '2" onerror="x' })])).not.toContain('height=');
  });

  test("only the first image in DOM order is eager across nested, grouped, and split bodies", () => {
    const ctx = {};
    const html = blocks.renderBlocks([image("parent"), image("child", {}, 1), image("group1", { group: "g" }), image("group2", { group: "g" })], ctx);
    const tags = images(html);
    expect(tags).toHaveLength(4);
    expect(tags[0]).toContain('loading="eager" fetchpriority="high"');
    tags.slice(1).forEach((tag) => { expect(tag).toContain('loading="lazy"'); expect(tag).not.toContain('fetchpriority'); });
    expect(images(blocks.renderBlocks([image("body")], ctx))[0]).toContain('loading="lazy"');
    expect(images(blocks.renderBlocks([{ type: "toggle", text: "Nested" }, image("nested", {}, 1), image("later")]))[0]).toContain('loading="eager"');
  });

  test("external, SVG and GIF sources never receive resize variants", () => {
    for (const meta of [{ src: "https://example.test/image.png" }, { src: "/media/a.svg" }, { src: "/media/a.gif" }, { type: "image/gif" }, { mime: "image/svg+xml" }]) {
      expect(blocks.renderBlocks([image("original", meta)])).not.toContain("srcset=");
    }
  });

  test("server and client DB thumbnails preserve geometry and responsive hints", () => {
    for (const dimensions of [{ iw: 800, ih: 600 }, { width: 800, height: 600 }]) {
      const file = { url: "/media/thumb", name: "Thumb", type: "image/png", ...dimensions };
      const html = db.dbFileCell([file]);
      const attrs = context.window.DoriDBViews.imageAttributes(file, file.url);
      expect(html).toContain('width="800" height="600"');
      for (const [name, value] of Object.entries(attrs)) expect(html).toContain(name + '="' + value + '"');
      expect(attrs.sizes).toBe(sizes);
      expect(attrs.loading).toBe("lazy");
      expect(attrs.decoding).toBe("async");
    }
    for (const type of ["image/gif", "image/svg+xml"]) {
      expect(db.dbFileCell([{ url: "/media/original", type }])).not.toContain("srcset=");
      expect(context.window.DoriDBViews.imageAttributes({ type }, "/media/original").srcset).toBeUndefined();
    }
    expect(db.dbFileCell([{ url: "/media/old", type: "image/png" }])).not.toMatch(/\s(?:width|height)=/);
  });

  test("DB-only pages prioritize one thumbnail and embedded DBs respect preceding images", () => {
    const properties = [{ id: "f", type: "files", name: "Files", config: {} }];
    const rows = [{ id: "r", values: { f: [{ url: "/media/a", type: "image/png" }, { url: "/media/b", type: "image/png" }] } }];
    const html = db.databaseHtml(properties, rows, [{ id: "v", type: "table", name: "Table", config: {} }], { slug: "db" });
    expect(images(html).filter((tag) => tag.includes('loading="eager"'))).toHaveLength(1);
    const body = blocks.renderBlocks([image("first"), { type: "db_ref", meta: { html } }]);
    expect(images(body).filter((tag) => tag.includes('loading="eager"'))).toHaveLength(1);
    expect(images(body)[0]).toContain('/media/first');
  });
});
