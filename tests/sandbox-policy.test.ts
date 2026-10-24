import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FRAME_BASE_CSP, SANDBOX_ATTR } from "../sandbox-policy.js";
import { PART_CSP } from "../part-html.js";
import { VISUAL_CSP } from "../visual-html.js";

describe("one sandbox policy", () => {
  test("parts, visual/HTML blocks and the part register preview use the same frame policy", () => {
    expect(FRAME_BASE_CSP).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:");
    expect(PART_CSP).toBe(FRAME_BASE_CSP);
    expect(VISUAL_CSP).toBe(FRAME_BASE_CSP);
    const chunk = readFileSync(new URL("../assets/features/lazy/part-register.js", import.meta.url), "utf8");
    expect(/var CSP = "([^"]+)"/.exec(chunk)?.[1]).toBe(FRAME_BASE_CSP);
    for (const file of ["../visual-html.js", "../part-html.js", "../assets/features/lazy/part-register.js"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      const attrs = [...text.matchAll(/sandbox(?:=|"\s*,\s*)"([^"]*)"/g)].map((m) => m[1]);
      expect(attrs.length).toBeGreaterThan(0);
      for (const value of attrs) expect(value).toBe(SANDBOX_ATTR);
    }
  });

});
