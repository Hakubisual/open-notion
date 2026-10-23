import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// gate/agent-entry.ts imports the built core, so the function is lifted from source like identity-cache.test.ts does.
const entryText = readFileSync(join(ROOT, "gate", "agent-entry.ts"), "utf8");
const start = entryText.indexOf("export function earlyHints");
const entrySource = entryText.slice(start, entryText.indexOf("\n}", start) + 2);
const earlyHints = new Function(new Bun.Transpiler({ loader: "ts" }).transformSync(entrySource).replace(/^export /m, "") + "; return earlyHints;")() as (versions: Record<string, string> | undefined) => string | null;

// Item 8 (acard-perf-smooth w1-server): the Link header names the same two first-screen files, with the same ?v=, that
// the HTML itself asks for - never a private URL.
describe("early hints", () => {
  test("the hinted URLs are the stamped style.css and core font the built HTML loads", () => {
    const worker = readFileSync(join(ROOT, "dist", "_worker.js"), "utf8");
    const versions = JSON.parse(/globalThis\.ACARD_STATIC_VERSIONS = (\{.*?\});/.exec(worker)![1]) as Record<string, string>;
    const link = earlyHints(versions)!;
    expect(link).toBeTruthy();
    const hinted = [...link.matchAll(/<([^>]+)>; rel=preload; as=(\w+)(; crossorigin)?/g)].map((m) => ({ url: m[1], as: m[2], cors: Boolean(m[3]) }));
    expect(hinted).toEqual([
      { url: "/style.css?v=" + versions["style.css"], as: "style", cors: false },
      { url: "/fonts/pretendard-core.woff2?v=" + versions["fonts/pretendard-core.woff2"], as: "font", cors: true },
    ]);
    const editor = readFileSync(join(ROOT, "dist", "editor.html"), "utf8");
    for (const { url } of hinted) {
      expect(editor).toContain('href="' + url + '"');
      // The worker's reader shell (pageShell) carries the same stamped hrefs.
      expect(worker).toContain('href="' + url + '"');
      expect(url).not.toMatch(/^\/(?:api|media|edit|p|s)\//);
    }
  });

  test("no hint without both versions", () => {
    expect(earlyHints(undefined)).toBeNull();
    expect(earlyHints({ "style.css": "abc" })).toBeNull();
    expect(earlyHints({ "style.css": "abc", "fonts/pretendard-core.woff2": "def" })).toBe("</style.css?v=abc>; rel=preload; as=style, </fonts/pretendard-core.woff2?v=def>; rel=preload; as=font; crossorigin");
  });
});
