import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const source = await Bun.file(new URL("../assets/features/save-queue.js", import.meta.url)).text();
function setup(send: (slug: string, payload: any) => Promise<Response> = async () => new Response("{}")) {
  const context: any = { Promise, Map, Date, JSON, Math, Response };
  runInNewContext(source, context);
  const records = new Map<string, any>();
  const storage = {
    read: () => [...records.values()],
    write: (entry: any) => { records.set(entry.slug, structuredClone(entry)); },
  };
  let clock = 100;
  const options = { storage, send, now: () => clock };
  return { api: context.AcardSaveQueue, storage, records, options, tick: (ms: number) => { clock += ms; } };
}
const payload = (text: string) => ({ title: "Queue", blocks: [{ id: "b1", type: "paragraph", text }] });

test("retry schedule doubles from one second and caps at thirty seconds", async () => {
  const f = setup(async () => { throw new TypeError("offline"); });
  const q = f.api.create(f.options);
  await q.ready;
  q.enqueue("one", payload("draft"));
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = q.get("one").nextAt;
    await expect(q.attempt("one")).rejects.toThrow("offline");
    expect(q.get("one").nextAt).toBe((before || 100) + delay);
    expect(await q.attempt("one")).toBeNull();
    f.tick(delay);
  }
});

test("latest payload wins per page and sequence survives a persistence round-trip", async () => {
  const f = setup();
  const q = f.api.create(f.options);
  await q.ready;
  const original = payload("first");
  const first = q.enqueue("one", original).sequence;
  original.blocks[0].text = "mutated outside queue";
  expect(q.get("one").payload.blocks[0].text).toBe("first");
  q.enqueue("two", payload("other"));
  q.enqueue("one", payload("latest"));
  expect(q.entries()).toHaveLength(2);
  const restored = f.api.create(f.options);
  await restored.ready;
  expect(restored.get("one").payload).toEqual(payload("latest"));
  expect(restored.enqueue("one", payload("next")).sequence).toBeGreaterThan(first + 2);
});

test("409 and other 4xx stop retries, survive reload, and retain the draft", async () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    let calls = 0;
    const f = setup(async () => { calls++; return new Response("{}", { status }); });
    const q = f.api.create(f.options);
    await q.ready;
    q.enqueue("one", payload("keep"));
    await q.attempt("one");
    const restored = f.api.create(f.options);
    await restored.ready;
    f.tick(60000);
    await restored.flush(true);
    expect(calls).toBe(1);
    expect(restored.get("one").blocked).toBe(status);
    expect(restored.get("one").payload).toEqual(payload("keep"));
  }
});

test("5xx retries, and a success tombstone does not resurrect after reload", async () => {
  let calls = 0;
  const f = setup(async () => new Response("{}", { status: ++calls === 1 ? 503 : 200 }));
  const q = f.api.create(f.options);
  await q.ready;
  q.enqueue("one", payload("keep"));
  await q.attempt("one");
  expect(q.get("one").attempts).toBe(1);
  f.tick(1000);
  await q.attempt("one");
  const restored = f.api.create(f.options);
  await restored.ready;
  expect(restored.entries()).toEqual([]);
});

test("an old in-flight success cannot delete a newer edit", async () => {
  let release!: (response: Response) => void;
  let started!: () => void;
  const signal = new Promise<void>(resolve => { started = resolve; });
  const f = setup(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const q = f.api.create(f.options);
  await q.ready;
  q.enqueue("one", payload("first"));
  const request = q.attempt("one");
  await signal;
  q.enqueue("one", payload("second"));
  release(new Response("{}"));
  await request;
  expect(q.get("one").payload).toEqual(payload("second"));
  expect(f.records.get("one").payload).toEqual(payload("second"));
});

test("localStorage fallback writes synchronously and round-trips pending pages", async () => {
  const f = setup();
  const values = new Map<string, string>();
  const local = {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i],
    getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value),
  };
  const storage = f.api.storage(local, null);
  const q = f.api.create({ ...f.options, storage });
  await q.ready;
  q.enqueue("one", payload("before debounce"));
  expect(values.size).toBe(1);
  const restored = f.api.create({ ...f.options, storage: f.api.storage(local, null) });
  await restored.ready;
  expect(restored.get("one").payload).toEqual(payload("before debounce"));
});

test("failed persistence never sends a payload or silently discards it", async () => {
  let sent = false;
  const f = setup(async () => { sent = true; return new Response("{}"); });
  const q = f.api.create({ ...f.options, storage: { read: () => [], write: () => Promise.reject(new Error("full")) } });
  await q.ready;
  q.enqueue("one", payload("keep"));
  await expect(q.attempt("one")).rejects.toThrow("full");
  expect(sent).toBe(false);
  expect(q.get("one").payload).toEqual(payload("keep"));
});

test("a crash journal wins over stale IndexedDB retry metadata at the same sequence", async () => {
  const f = setup();
  const entry = { slug: "one", sequence: 10, payload: payload("keep"), updated: 100, attempts: 0, nextAt: 0, blocked: 0 };
  const q = f.api.create({ ...f.options, storage: { read: () => [entry, { ...entry, blocked: 409 }], write: () => {} } });
  await q.ready;
  expect(q.get("one").blocked).toBe(409);
  expect(await q.attempt("one", true)).toBeNull();
});

test("new drafts supersede permanent failures and different pages flush independently", async () => {
  const sent: string[] = [];
  const f = setup(async (slug, body) => {
    sent.push(slug + ":" + body.blocks[0].text);
    return new Response("{}", { status: body.blocks[0].text === "blocked" ? 409 : 200 });
  });
  const q = f.api.create(f.options);
  await q.ready;
  q.enqueue("one", payload("blocked"));
  await q.flush(true);
  q.enqueue("one", payload("fixed"));
  q.enqueue("two", payload("other"));
  await q.flush(true);
  expect(sent).toEqual(["one:blocked", "one:fixed", "two:other"]);
  expect(q.entries()).toEqual([]);
});


function wired(online: boolean) {
  const statuses: string[] = [];
  const listeners: Record<string, ((v?: any) => void)[]> = {};
  const status: any = { textContent: "" };
  let send!: (r: Response | Error) => void;
  const timers: (() => void)[] = [];
  const editor: any = {
    slug: "one", state: { title: "Queue", blocks: [], saving: false, dirty: false },
    transport: () => new Promise<Response>((ok, bad) => { send = (r) => (r instanceof Error ? bad(r) : ok(r)); }),
    setSave: (text: string) => { status.textContent = text; statuses.push(text); },
    on: (name: string, fn: any) => { (listeners[name] ||= []).push(fn); },
    api: async () => null, render: () => {},
  };
  const values = new Map<string, string>();
  const localStorage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i], getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  const window: any = { AcardEditor: editor, localStorage, indexedDB: undefined, addEventListener: (name: string, fn: any) => { (listeners["window:" + name] ||= []).push(fn); } };
  const context: any = { window, Promise, Map, Date, JSON, Math, Response, Object, Array,
    navigator: { onLine: online }, document: { getElementById: () => status, addEventListener() {} },
    MutationObserver: class { observe() {} },
    setTimeout: (fn: () => void) => { timers.push(fn); return 1; }, clearTimeout() {} };
  runInNewContext(source.replace("(typeof window === \"undefined\" ? globalThis : window)", "(window)"), context);
  const emit = (name: string, value?: any) => (listeners[name] || []).forEach((fn) => fn(value));
  return { editor, statuses, status, emit, respond: (r: Response | Error) => send(r), tick: () => timers.splice(0).forEach((fn) => fn()) };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test("status: online failure says it is resending, never offline; only a server OK shows saved", async () => {
  const w = wired(true);
  w.emit("ready", w.editor);
  await settle();
  w.emit("change", payload("draft"));
  await settle();
  expect(w.status.textContent).toBe("저장 중…");
  w.tick();
  await settle();
  expect(w.status.textContent).not.toMatch(/저장됨|오프라인/);
  w.respond(new TypeError("network"));
  await settle();
  expect(w.status.textContent).not.toMatch(/저장됨|오프라인/);
  expect(w.status.textContent).toMatch(/다시 보내는/);
  w.emit("window:online");
  await settle();
  w.respond(new Response("{}"));
  await settle();
  expect(w.status.textContent).toBe("저장됨");
  expect(w.statuses.filter((s) => /오프라인/.test(s))).toEqual([]);
});

test("status: really offline shows the queued count", async () => {
  const w = wired(false);
  w.emit("ready", w.editor);
  await settle();
  w.emit("change", payload("draft"));
  await settle();
  expect(w.status.textContent).toBe("오프라인 - 1개 대기 중");
});
