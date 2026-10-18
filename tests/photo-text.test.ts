import { afterEach, expect, test } from "bun:test";
import { cookie, setup } from "./db-harness";

const harnesses: ReturnType<typeof setup>[] = [];
function harness() {
  const h = setup();
  harnesses.push(h);
  return h;
}
afterEach(() => { harnesses.splice(0).forEach(h => h.sqlite.close()); });

async function photo(h: ReturnType<typeof setup>, body: Uint8Array, type = "image/jpeg", anonymous = false, length?: string) {
  const headers: Record<string, string> = { "content-type": type };
  if (!anonymous) headers.cookie = await cookie();
  if (length) headers["content-length"] = length;
  return h.worker.fetch(new Request("https://notes.test/api/ai/photo-text", { method: "POST", headers, body: new Uint8Array(body).buffer }), h.env);
}

test("photo text forwards image bytes and returns trimmed transcription with line breaks", async () => {
  const h = harness();
  const bytes = new Uint8Array([255, 216, 255, 224, 0, 128, 255, 217]);
  const calls: { model: string; input: { image: number[] } }[] = [];
  h.env.AI = { run: async (model: string, input: { image: number[] }) => {
    calls.push({ model, input });
    return { response: "  오늘의 기록\n작은 시작  \n" };
  } };
  const result = await photo(h, bytes);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ text: "오늘의 기록\n작은 시작" });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.input.image).toEqual(Array.from(bytes));
});

test("photo text rejects actual image bodies over 2MB without inference", async () => {
  const h = harness();
  let calls = 0;
  h.env.AI = { run: async () => { calls++; return { response: "unexpected" }; } };
  expect((await photo(h, new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
  expect(calls).toBe(0);
});

test("photo text rejects declared oversized bodies before reading", async () => {
  const h = harness();
  expect((await photo(h, new Uint8Array([1]), "image/png", false, "2097153")).status).toBe(413);
});

test("photo text rejects non-image content", async () => {
  const h = harness();
  expect((await photo(h, new TextEncoder().encode("not an image"), "text/plain")).status).toBe(415);
});

test("photo text requires the AI binding", async () => {
  const h = harness();
  expect((await photo(h, new Uint8Array([255, 216, 255]))).status).toBe(503);
});

test("photo text requires authentication before image handling", async () => {
  const h = harness();
  let calls = 0;
  h.env.AI = { run: async () => { calls++; return { response: "unexpected" }; } };
  expect((await photo(h, new Uint8Array([1]), "image/jpeg", true)).status).toBe(401);
  expect(calls).toBe(0);
});

test("photo text accepts exactly 2MB and preserves an empty transcription", async () => {
  const h = harness();
  let size = 0;
  h.env.AI = { run: async (_model: string, input: { image: number[] }) => {
    size = input.image.length;
    return { response: "  " };
  } };
  const result = await photo(h, new Uint8Array(2 * 1024 * 1024));
  expect(result.status).toBe(200);
  expect(size).toBe(2097152);
  expect(await result.json()).toEqual({ text: "" });
});

test("photo text rejects an empty upload", async () => {
  const h = harness();
  expect((await photo(h, new Uint8Array())).status).toBe(400);
});

test("photo text handles unavailable inference without leaking upstream details", async () => {
  const h = harness();
  h.env.AI = { run: async () => { throw new Error("private upstream detail"); } };
  const result = await photo(h, new Uint8Array([1]));
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("private upstream detail");
});
