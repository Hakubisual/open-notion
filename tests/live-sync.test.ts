import { describe, expect, test } from "bun:test";
import { classify, newSink, publish, trackDb } from "../gate/live";

function fakeDb() {
  const ran: string[] = [];
  const stmt = (sql: string, params: unknown[] = []): any => ({
    sql, params,
    bind: (...p: unknown[]) => stmt(sql, p),
    run: async () => { ran.push(sql); return { success: true }; },
    all: async () => { ran.push(sql); return { results: [] }; },
    first: async () => { ran.push(sql); return null; },
  });
  return { ran, db: { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => list.map((s) => { ran.push(s.sql); return { success: true }; }) } };
}

describe("live change feed", () => {
  test("classifies content writes and ignores reads and unrelated tables", () => {
    expect(classify("UPDATE pages SET title = ? WHERE slug = ?")).toBe("tree");
    expect(classify("INSERT INTO blocks (page, id) VALUES (?, ?)")).toBe("page");
    expect(classify("INSERT OR IGNORE INTO page_tags (page, tag) VALUES (?, ?)")).toBe("tags");
    expect(classify("DELETE FROM editor_trash WHERE page = ?")).toBe("tree");
    expect(classify("SELECT * FROM pages")).toBeNull();
    expect(classify("UPDATE share_rate SET count = count + 1 WHERE key = ?")).toBeNull();
    expect(classify("INSERT INTO agent_tokens (id) VALUES (?)")).toBeNull();
  });

  test("a tracked db records kinds and slugs only after the write succeeds, batch included", async () => {
    const { db, ran } = fakeDb();
    const sink = newSink("owner");
    const tracked = trackDb(db, sink);
    await tracked.prepare("SELECT slug FROM pages WHERE slug = ?").bind("a").first();
    expect(sink.kinds.size).toBe(0);
    await tracked.prepare("UPDATE pages SET title = ?, updated = ? WHERE slug = ?").bind("New", 1, "my-page").run();
    await tracked.batch([tracked.prepare("DELETE FROM blocks WHERE page = ?").bind("other")]);
    expect([...sink.kinds].sort()).toEqual(["page", "title", "tree"]);
    expect(sink.slugs.has("my-page")).toBe(true);
    expect(sink.slugs.has("other")).toBe(true);
    expect(ran.length).toBe(3);
  });

  test("slugs come only from page columns, never from titles or block text", async () => {
    const { db } = fakeDb();
    const sink = newSink("owner");
    const tracked = trackDb(db, sink);
    await tracked.prepare("INSERT INTO blocks (page, id, ord, type, text) VALUES (?, ?, ?, ?, ?)").bind("p1", "b1", 0, "paragraph", "secret body").run();
    await tracked.prepare("UPDATE pages SET title = ?, updated = ? WHERE slug = ?").bind("Secret title", 1, "p2").run();
    expect([...sink.slugs].sort()).toEqual(["p1", "p2"]);
  });

  test("a failed write publishes nothing", async () => {
    const sink = newSink("owner");
    const tracked = trackDb({ prepare: (sql: string) => ({ sql, params: [], bind() { return this; }, run: async () => { throw new Error("boom"); } }), batch: async () => [] } as any, sink);
    await expect(tracked.prepare("UPDATE pages SET title = ? WHERE slug = ?").run()).rejects.toThrow("boom");
    expect(sink.kinds.size).toBe(0);
  });

  test("publish sends one notice per workspace with no page text, and nothing for read-only requests", async () => {
    const sent: { name: string; body: any }[] = [];
    const live = { idFromName: (name: string) => name, get: (id: unknown) => ({ fetch: async (_: string, init?: RequestInit) => { sent.push({ name: String(id), body: JSON.parse(String(init?.body)) }); return new Response("{}"); } }) };
    const a = newSink("owner"); a.kinds.add("page"); a.slugs.add("p1");
    const b = newSink("owner"); b.kinds.add("tree"); b.slugs.add("p2");
    const idle = newSink("abc");
    await publish(live, [a, b, idle], "c123");
    expect(sent.length).toBe(1);
    expect(sent[0].name).toBe("live:owner");
    expect(sent[0].body).toEqual({ kinds: ["page", "tree"], slugs: ["p1", "p2"], src: "c123" });
  });
});

describe("LiveFeed visibility", async () => {
  const source = await Bun.file(new URL("../workers/acard-live/index.js", import.meta.url)).text();
  const visible = new Function(source.slice(source.indexOf("export function visible")).replace("export function", "function").split("\nexport default")[0] + "\nreturn visible;")();
  const event = { id: 3, t: 1, kinds: ["page", "tree", "home"], slugs: ["shared", "secret"], src: "" };

  test("members see every notice unchanged", () => {
    expect(visible(event, null)).toEqual(event);
  });

  test("a guest sees only the slugs it may read and never workspace-wide kinds", () => {
    expect(visible(event, ["shared"])).toEqual({ ...event, slugs: ["shared"], kinds: ["page", "tree"] });
    expect(visible(event, ["elsewhere"])).toBeNull();
    expect(visible({ ...event, slugs: [] }, ["shared"])).toBeNull();
  });
});
