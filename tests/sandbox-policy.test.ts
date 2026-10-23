import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FRAME_BASE_CSP, SANDBOX_ATTR, pluginFrameCsp, sandboxCspProblems, sandboxNetworkSource } from "../sandbox-policy.js";
import { PART_CSP } from "../part-html.js";
import { VISUAL_CSP } from "../visual-html.js";

const HASH = "sha256-" + "A".repeat(43) + "=";
const ANCESTORS = ["https://notes.example.com"];

describe("one sandbox policy (#144)", () => {
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

  test("a plugin frame policy is the base policy or narrower plus the plugin additions only", () => {
    const none = pluginFrameCsp({ bootHash: HASH, ancestors: ANCESTORS });
    expect(sandboxCspProblems(none)).toEqual([]);
    expect(none).toContain("connect-src 'none'");
    expect(none).toContain("sandbox allow-scripts;");
    expect(none).toContain("script-src '" + HASH + "'");
    expect(none).not.toContain("unsafe-eval");
    const two = pluginFrameCsp({ network: ["api.example.com", "*.tiles.example.org"], bootHash: HASH, ancestors: ANCESTORS });
    expect(sandboxCspProblems(two)).toEqual([]);
    expect(two).toContain("connect-src https://api.example.com https://*.tiles.example.org;");
  });

  test("the checker catches a widened policy", () => {
    const ok = pluginFrameCsp({ bootHash: HASH, ancestors: ANCESTORS });
    expect(sandboxCspProblems(ok.replace("img-src data:", "img-src data: https:"))).toEqual(["img-src adds https:"]);
    expect(sandboxCspProblems(ok.replace("script-src '" + HASH + "'", "script-src 'unsafe-inline' 'unsafe-eval'"))).toEqual(["script-src adds 'unsafe-eval'"]);
    expect(sandboxCspProblems(ok.replace("worker-src blob:", "worker-src blob: https:"))).toEqual(["worker-src adds https:"]);
    expect(sandboxCspProblems(ok.replace("sandbox allow-scripts", "sandbox allow-scripts allow-same-origin"))).toContain("sandbox adds allow-same-origin");
    expect(sandboxCspProblems(ok + "; object-src *")).toEqual(["unexpected directive object-src"]);
    expect(sandboxCspProblems(ok.replace("default-src 'none'; ", ""))).toEqual([]);
    expect(sandboxCspProblems("default-src *")).toContain("img-src adds *");
  });

  test("network hosts that would reach Acard, the sandbox site or local names are refused", () => {
    for (const bad of ["notes.example.com", "api.notes.example.com", "*.notes.example.com", "x.example.workers.dev", "evil.pages.dev", "localhost", "127.0.0.1", "10.0.0.1", "[::1]", "a.internal", "https://api.example.com", "api.example.com:8443", "api.example.com/path", "*", "*.com", "a b.com", ""]) {
      expect(sandboxNetworkSource(bad)).toBeNull();
      expect(() => pluginFrameCsp({ network: [bad], bootHash: HASH, ancestors: ANCESTORS })).toThrow();
    }
    expect(sandboxNetworkSource("API.Example.com.")).toBe("https://api.example.com");
  });

  test("inputs that would weaken the policy throw instead", () => {
    expect(() => pluginFrameCsp({ bootHash: "'unsafe-inline'", ancestors: ANCESTORS })).toThrow();
    expect(() => pluginFrameCsp({ bootHash: HASH, ancestors: [] })).toThrow();
    expect(() => pluginFrameCsp({ bootHash: HASH, ancestors: ["*"] })).toThrow();
    expect(() => pluginFrameCsp({ bootHash: HASH, ancestors: ["https://*.notes-example.pages.dev"] })).toThrow();
    expect(() => pluginFrameCsp({ bootHash: HASH, ancestors: ["http://notes.example.com"] })).toThrow();
    expect(() => pluginFrameCsp({ network: ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"], bootHash: HASH, ancestors: ANCESTORS })).toThrow();
  });
});
