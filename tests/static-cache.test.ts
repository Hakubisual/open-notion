import { expect, test } from "bun:test";
import { IMMUTABLE, cacheVersioned, serviceWorkerOff } from "../gate/static-cache";

const origin = "https://notes.example.com";
const pages = (cc = "public, max-age=0, must-revalidate", status = 200) => new Response("x", { status, headers: { "cache-control": cc } });
const versions = { "app.js": "abc123", "lazy/live.js": "l1", "img/icons/home-128.webp": "i9" };
const cc = (path: string, init?: RequestInit, response = pages()) => cacheVersioned(new Request(origin + path, init), response, versions).headers.get("cache-control");

test("a URL carrying this build's hash is cached for a year without revalidation", () => {
  for (const path of ["/app.js?v=abc123", "/lazy/live.js?v=l1", "/img/icons/home-128.webp?v=i9"]) expect(cc(path)).toBe(IMMUTABLE);
  expect(cc("/app.js?v=abc123", { method: "HEAD" })).toBe(IMMUTABLE);
});

test("unversioned, old, unknown, ?v=0 and extra-parameter URLs keep revalidating", () => {
  for (const path of ["/app.js", "/app.js?v=old", "/app.js?v=0", "/app.js?v=abc123&x=1", "/other.js?v=abc123", "/lazy/live.js?v=abc123"]) {
    expect(cc(path)).toBe("public, max-age=0, must-revalidate");
  }
});

test("HTML, the service worker, API answers and errors are never made immutable", () => {
  expect(cc("/app.js?v=abc123", undefined, pages("no-store", 404))).toBe("no-store");
  expect(cc("/app.js?v=abc123", { method: "POST" })).toBe("public, max-age=0, must-revalidate");
  expect(cc("/sw.js?v=abc123", undefined, pages("no-cache"))).toBe("no-cache");
  expect(cc("/api/tree?v=abc123", undefined, pages("no-store"))).toBe("no-store");
  expect(cacheVersioned(new Request(origin + "/app.js?v=abc123"), pages(), undefined).headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
});

test("?sw=off answers with a no-store page that unregisters workers, clears caches and reopens the page without the switch", async () => {
  expect(serviceWorkerOff(new Request(origin + "/edit/a/"))).toBeNull();
  expect(serviceWorkerOff(new Request(origin + "/edit/a/?sw=off", { method: "POST" }))).toBeNull();
  const response = serviceWorkerOff(new Request(origin + "/edit/a/?x=1&sw=off"))!;
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.text();
  expect(body).toContain("unregister()");
  expect(body).toContain("c.delete(n)");
  expect(body).toContain('location.replace("/edit/a/?x=1")');
});
