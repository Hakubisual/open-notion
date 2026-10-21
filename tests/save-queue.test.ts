import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const source = await Bun.file(new URL("../assets/features/save-queue.js", import.meta.url)).text();
function setup(send: (slug: string, payload: any) => Promise<Response> = async () => new Response("{}")) {
  const context: any = { Promise, Map, Date, JSON, Math, Response, setTimeout, clearTimeout };
  runInNewContext(source, context);
  const records = new Map<string, any>();
  const storage = {
    read: () => [...records.values()],
    write: (entry: any) => { records.set(entry.slug, structuredClone(entry)); },
  };
  let clock = 100;
  const options = { identity: "member-a", storage, send, now: () => clock };
  return { api: context.AcardSaveQueue, storage, records, options, tick: (ms: number) => { clock += ms; } };
}
const payload = (text: string) => ({ title: "Queue", blocks: [{ id: "b1", type: "paragraph", text }], base_updated: 10 });

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
  const storage = f.api.storage(local, null, "member-a");
  const q = f.api.create({ ...f.options, storage });
  await q.ready;
  q.enqueue("one", payload("before debounce"));
  expect(values.size).toBe(1);
  const restored = f.api.create({ ...f.options, storage: f.api.storage(local, null, "member-a") });
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
  const entry = { slug: "one", acard_id: "member-a", base_updated: 10, sequence: 10, payload: payload("keep"), updated: 100, attempts: 0, nextAt: 0, blocked: 0 };
  const q = f.api.create({ ...f.options, storage: { read: () => [entry, { ...entry, blocked: 409 }], write: () => {} } });
  await q.ready;
  expect(q.get("one").blocked).toBe(409);
  expect(await q.attempt("one", true)).toBeNull();
});

test("explicitly rebased drafts supersede permanent failures and different pages flush independently", async () => {
  const sent: string[] = [];
  const f = setup(async (slug, body) => {
    sent.push(slug + ":" + body.blocks[0].text);
    return new Response("{}", { status: body.blocks[0].text === "blocked" ? 409 : 200 });
  });
  const q = f.api.create(f.options);
  await q.ready;
  q.enqueue("one", payload("blocked"));
  await q.flush(true);
  q.enqueue("one", { ...payload("fixed"), base_updated: 11 });
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
  let started: (() => void) | undefined;
  let scheduled: (() => void) | undefined;
  const statusWaits = new Map<string, () => void>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let clock = Date.now();
  const editor: any = {
    slug: "one", state: { title: "Queue", blocks: [], saving: false, dirty: false, baseUpdated: 10 },
    transport: () => new Promise<Response>((ok, bad) => { send = (r) => (r instanceof Error ? bad(r) : ok(r)); started?.(); }),
    setSave: (text: string) => { status.textContent = text; statuses.push(text); statusWaits.get(text)?.(); statusWaits.delete(text); },
    on: (name: string, fn: any) => { (listeners[name] ||= []).push(fn); },
    api: async () => null, render: () => {},
  };
  const values = new Map<string, string>();
  const localStorage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i], getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  const window: any = { AcardEditor: editor, localStorage, indexedDB: undefined, addEventListener: (name: string, fn: any) => { (listeners["window:" + name] ||= []).push(fn); } };
  const context: any = { window, Promise, Map, Date: { now: () => clock }, JSON, Math, Response, Object, Array,
    navigator: { onLine: online }, document: { querySelector: () => ({ content: "member-a" }), getElementById: () => status, addEventListener() {} },
    MutationObserver: class { observe() {} },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); scheduled?.(); return timerId; }, clearTimeout: (id: number) => { timers.delete(id); } };
  runInNewContext(source.replace("(typeof window === \"undefined\" ? globalThis : window)", "(window)"), context);
  const emit = (name: string, value?: any) => Promise.all((listeners[name] || []).map((fn) => fn(value)));
  const nextSend = () => new Promise<void>(resolve => { started = resolve; });
  const nextStatus = (text: string) => new Promise<void>(resolve => { statusWaits.set(text, resolve); });
  const nextTimer = () => new Promise<void>(resolve => { scheduled = resolve; });
  return { editor, statuses, status, emit, nextSend, nextStatus, nextTimer, respond: (r: Response | Error) => send(r), tick: () => { clock += 30000; const due = [...timers.values()]; timers.clear(); due.forEach(fn => fn()); } };
}

test("status: online failure says it is resending, never offline; only a server OK shows saved", async () => {
  const w = wired(true);
  await w.emit("ready", w.editor);
  await w.emit("change", payload("draft"));
  expect(w.status.textContent).toBe("저장 중…");
  const first = w.nextSend();
  w.tick();
  await first;
  expect(w.status.textContent).not.toMatch(/저장됨|오프라인/);
  const retrying = w.nextStatus("저장 안 된 변경을 다시 보내는 중");
  const retryScheduled = w.nextTimer();
  w.respond(new TypeError("network"));
  await retrying;
  await retryScheduled;
  expect(w.status.textContent).not.toMatch(/저장됨|오프라인/);
  expect(w.status.textContent).toMatch(/다시 보내는/);
  const retry = w.nextSend();
  await w.emit("window:online");
  w.tick();
  await retry;
  const saved = w.nextStatus("저장됨");
  w.respond(Response.json({ updated: 11 }));
  await saved;
  expect(w.status.textContent).toBe("저장됨");
  expect(w.statuses.filter((s) => /오프라인/.test(s))).toEqual([]);
});

test("status: really offline shows the queued count", async () => {
  const w = wired(false);
  await w.emit("ready", w.editor);
  await w.emit("change", payload("draft"));
  expect(w.status.textContent).toBe("오프라인 - 1개 대기 중");
});

// A localStorage stand-in and an IndexedDB whose open request never answers (another tab holds the database).
function memoryLocal() {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}
test("a blocked or never-answering IndexedDB open gives up within the step limit and the journal keeps saves", async () => {
  const f = setup();
  const local = memoryLocal();
  local.setItem("acard-save-queue:member-a:one", JSON.stringify({ slug: "one", acard_id: "member-a", base_updated: 10, payload: payload("left over"), sequence: 5, updated: 1, attempts: 0, nextAt: 0, blocked: 0 }));
  const hung = { open: () => ({}), deleteDatabase: () => ({}) };
  const started = Date.now();
  const store = f.api.storage(local, hung, "member-a");
  const rows = await store.read();
  expect(Date.now() - started).toBeLessThan(3000);
  expect(rows.map((r: any) => r.payload.blocks[0].text)).toEqual(["left over"]);
  await store.write({ slug: "two", acard_id: "member-a", base_updated: 10, payload: payload("new"), sequence: 6 });
  expect(JSON.parse(local.getItem("acard-save-queue:member-a:two")!).payload.blocks[0].text).toBe("new");
});

test("a database left at a newer version (VersionError) is opened at its own version instead of being skipped", async () => {
  const f = setup();
  const versions: (number | undefined)[] = [];
  const rows = [{ slug: "kept", acard_id: "member-a", base_updated: 10, payload: payload("in idb"), sequence: 9 }];
  const db = { version: 7, objectStoreNames: { contains: () => true }, close() {}, transaction: () => ({ objectStore: () => ({ getAll: () => { const r: any = {}; queueMicrotask(() => { r.result = rows; r.onsuccess(); }); return r; } }) }) };
  const indexed = {
    open: (_: string, version?: number) => {
      versions.push(version);
      const r: any = {};
      queueMicrotask(() => { if (version === 1) r.onerror({ preventDefault() {} }); else { r.result = db; r.onsuccess(); } });
      return r;
    },
  };
  const store = f.api.storage(memoryLocal(), indexed, "member-a");
  expect((await store.read()).map((r: any) => r.slug)).toEqual(["kept"]);
  expect(versions).toEqual([1, undefined]);
});
