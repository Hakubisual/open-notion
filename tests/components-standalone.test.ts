import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Components must also run in the public edition (OpenNotion): no Acard server, token or storage calls in their code,
// no imports beyond the registry, and pictures only from static /kit/ files. Static scan of every components/*.js.
const ROOT = join(import.meta.dir, "..");
const files = ["component-registry.js", ...readdirSync(join(ROOT, "components")).filter((n) => n.endsWith(".js")).map((n) => "components/" + n)];
const FORBIDDEN: [string, RegExp][] = [
  ["fetch", /\bfetch\s*\(/], ["XMLHttpRequest", /XMLHttpRequest/], ["WebSocket", /\bWebSocket\b/], ["sendBeacon", /sendBeacon/],
  ["/api/ path", /["'`]\/api\//], ["notes.example.com host", /notes\.example\.com/i], ["cookie", /document\.cookie/], ["storage", /\b(localStorage|sessionStorage|indexedDB)\b/],
  ["token", /\b(authorization|bearer|api[_-]?key|access[_-]?token)\b/i], ["eval", /\beval\s*\(|new Function\s*\(/], ["script tag", /<script/i],
  ["remote url", /["'(]https?:\/\/(?!www\.w3\.org\/)[a-z0-9]/i],
];

test("component code makes no network, token, storage or eval calls", () => {
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const [name, re] of FORBIDDEN) if (re.test(text)) hits.push(file + ": " + name);
  }
  expect(hits).toEqual([]);
});

test("components import only the registry (index.js reads its own folder)", () => {
  const bad: string[] = [];
  for (const file of files.filter((f) => f.startsWith("components/") && f !== "components/index.js")) {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(/^import[^\n]*from\s+["']([^"']+)["']/gm)) if (m[1] !== "../component-registry.js") bad.push(file + ": " + m[1]);
  }
  expect(bad).toEqual([]);
});

test("pictures come only from static /kit/ svg or webp files", () => {
  const bad: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(/["'(](\/[a-z0-9/_-]+\.(?:png|jpe?g|gif|webp|svg|avif))/gi)) if (!/^\/kit\/[a-z0-9/_-]+\.(svg|webp)$/i.test(m[1])) bad.push(file + ": " + m[1]);
  }
  expect(bad).toEqual([]);
});

test("the scan catches what it names (self-check)", () => {
  const sample = 'fetch("/api/pages"); localStorage.x; document.cookie; "https://notes.example.com/x"';
  const caught = FORBIDDEN.filter(([, re]) => re.test(sample)).map(([n]) => n);
  expect(caught).toEqual(expect.arrayContaining(["fetch", "/api/ path", "notes.example.com host", "cookie", "storage", "remote url"]));
});
