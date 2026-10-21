import { describe, expect, test } from "bun:test";
import { setup } from "./db-harness";

async function tripAndSchedule() {
  const ctx = setup();
  const a = (await ctx.call("POST", "/api/db", { title: "여행" })).data;
  const b = (await ctx.call("POST", "/api/db", { title: "일정" })).data;
  const titleOf = async (slug: string) => (await ctx.call("GET", "/api/db/" + slug)).data.properties.find((p: any) => p.type === "title").id;
  const aTitle = await titleOf(a.slug);
  const bTitle = await titleOf(b.slug);
  const b1 = (await ctx.call("POST", "/api/db/" + b.slug + "/rows", { props: { [bTitle]: "공항" } })).data.row;
  const b2 = (await ctx.call("POST", "/api/db/" + b.slug + "/rows", { props: { [bTitle]: "호텔" } })).data.row;
  const rel = (await ctx.call("POST", "/api/db/" + a.slug + "/properties", { name: "일정", type: "relation", config: { database: b.slug } })).data.property;
  const a1 = (await ctx.call("POST", "/api/db/" + a.slug + "/rows", { props: { [aTitle]: "제주", [rel.id]: [b1.id, b2.id] } })).data.row;
  const read = async (slug: string) => (await ctx.call("GET", "/api/db/" + slug)).data;
  return { ctx, a, b, rel, a1, b1, b2, read };
}

describe("two-way relations: turning the pair on and off", () => {
  test("turning synced on adds the paired property on the other database, filled from existing links", async () => {
    const { ctx, a, b, rel, a1, b1, b2, read } = await tripAndSchedule();
    const on = await ctx.call("PATCH", "/api/db/" + a.slug + "/properties/" + rel.id, { config: { database: b.slug, synced: true }, pairName: "여행" });
    expect(on.status).toBe(200);
    expect(on.data.property.config).toMatchObject({ synced: true, pair: on.data.pair.id });

    const schedule = await read(b.slug);
    const pair = schedule.properties.find((p: any) => p.id === on.data.pair.id);
    expect(pair).toMatchObject({ name: "여행", type: "relation", config: { database: a.slug, synced: true, pair: rel.id } });
    const rows = new Map(schedule.rows.map((r: any) => [r.id, r]));
    expect((rows.get(b1.id) as any).props[pair.id]).toEqual([a1.id]);
    expect((rows.get(b2.id) as any).props[pair.id]).toEqual([a1.id]);
    expect((await read(a.slug)).rows.find((r: any) => r.id === a1.id).props[rel.id]).toEqual([b1.id, b2.id]);
  });

  test("turning synced off without dropPair keeps the paired property as a one-way relation", async () => {
    const { ctx, a, b, rel, b1, read } = await tripAndSchedule();
    const on = await ctx.call("PATCH", "/api/db/" + a.slug + "/properties/" + rel.id, { config: { database: b.slug, synced: true } });
    const off = await ctx.call("PATCH", "/api/db/" + a.slug + "/properties/" + rel.id, { config: { database: b.slug, synced: false }, dropPair: false });
    expect(off.status).toBe(200);
    expect(off.data.property.config).toMatchObject({ synced: false, pair: "" });
    const schedule = await read(b.slug);
    const pair = schedule.properties.find((p: any) => p.id === on.data.pair.id);
    expect(pair.config).toMatchObject({ database: a.slug, synced: false, pair: "" });
    expect(schedule.rows.find((r: any) => r.id === b1.id).props[pair.id].length).toBe(1);
    expect(ctx.sqlite.query("SELECT COUNT(*) AS n FROM db_relation_links").get()).toEqual({ n: 0 });
  });

  test("turning synced off with dropPair removes the paired property", async () => {
    const { ctx, a, b, rel, read } = await tripAndSchedule();
    const on = await ctx.call("PATCH", "/api/db/" + a.slug + "/properties/" + rel.id, { config: { database: b.slug, synced: true } });
    await ctx.call("PATCH", "/api/db/" + a.slug + "/properties/" + rel.id, { config: { database: b.slug, synced: false }, dropPair: true });
    expect((await read(b.slug)).properties.some((p: any) => p.id === on.data.pair.id)).toBe(false);
  });

  test("a missing other database is refused and nothing changes", async () => {
    const { ctx, a, b, rel, read } = await tripAndSchedule();
    const before = JSON.stringify([(await read(a.slug)).properties, (await read(b.slug)).properties]);
    const bad = await ctx.call("PATCH", "/api/db/" + a.slug + "/properties/" + rel.id, { config: { database: "no-such-db", synced: true } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toContain("찾지 못했어요");
    expect(JSON.stringify([(await read(a.slug)).properties, (await read(b.slug)).properties])).toBe(before);
  });

  test("a relation created with synced on gets its pair in the same request", async () => {
    const { ctx, a, b, read } = await tripAndSchedule();
    const made = await ctx.call("POST", "/api/db/" + b.slug + "/properties", { name: "여행지", type: "relation", config: { database: a.slug, synced: true }, pairName: "일정들" });
    expect(made.status).toBe(200);
    expect((await read(a.slug)).properties.find((p: any) => p.id === made.data.pair.id)).toMatchObject({ name: "일정들", config: { pair: made.data.property.id } });
  });

  test("the paired property can feed a rollup on the other side", async () => {
    const { ctx, a, b, rel, b1, read } = await tripAndSchedule();
    const on = await ctx.call("PATCH", "/api/db/" + a.slug + "/properties/" + rel.id, { config: { database: b.slug, synced: true } });
    const count = (await ctx.call("POST", "/api/db/" + b.slug + "/properties", { name: "여행 수", type: "rollup", config: { relation_property: on.data.pair.id, target_property: "", function: "count" } })).data.property;
    expect((await read(b.slug)).rows.find((r: any) => r.id === b1.id).computed[count.id]).toBe(1);
  });
});

async function twoWay() {
  const t = await tripAndSchedule();
  const on = await t.ctx.call("PATCH", "/api/db/" + t.a.slug + "/properties/" + t.rel.id, { config: { database: t.b.slug, synced: true }, pairName: "여행" });
  const pair = on.data.pair.id as string;
  const rowOf = async (slug: string, id: string) => (await t.read(slug)).rows.find((r: any) => r.id === id);
  const links = () => t.ctx.sqlite.query("SELECT prop_id, src_row, dst_row FROM db_relation_links ORDER BY prop_id, src_row, dst_row").all();
  return { ...t, pair, rowOf, links };
}

describe("two-way relations: values stay in step", () => {
  test("linking from either side shows on the other side, unlinking removes it from both", async () => {
    const t = await twoWay();
    const b3 = (await t.ctx.call("POST", "/api/db/" + t.b.slug + "/rows", { props: { [t.pair]: [t.a1.id] } })).data.row;
    expect((await t.rowOf(t.a.slug, t.a1.id)).props[t.rel.id]).toEqual([t.b1.id, t.b2.id, b3.id]);
    await t.ctx.call("PATCH", "/api/db/" + t.a.slug + "/rows/" + t.a1.id, { props: { [t.rel.id]: [t.b2.id] } });
    expect((await t.rowOf(t.a.slug, t.a1.id)).props[t.rel.id]).toEqual([t.b2.id]);
    expect((await t.rowOf(t.b.slug, t.b1.id)).props[t.pair]).toEqual([]);
    expect((await t.rowOf(t.b.slug, b3.id)).props[t.pair]).toEqual([]);
    expect((await t.rowOf(t.b.slug, t.b2.id)).props[t.pair]).toEqual([t.a1.id]);
    await t.ctx.call("PATCH", "/api/db/" + t.b.slug + "/rows/" + t.b2.id, { props: { [t.pair]: [] } });
    expect((await t.rowOf(t.a.slug, t.a1.id)).props[t.rel.id]).toEqual([]);
    expect(t.links()).toEqual([]);
  });

  test("deleting a row removes it from the other side's values", async () => {
    const t = await twoWay();
    expect((await t.ctx.call("DELETE", "/api/db/" + t.b.slug + "/rows/" + t.b1.id)).status).toBe(200);
    expect((await t.rowOf(t.a.slug, t.a1.id)).props[t.rel.id]).toEqual([t.b2.id]);
    expect(t.links().some((l: any) => l.src_row === t.b1.id || l.dst_row === t.b1.id)).toBe(false);
  });

  test("deleting the whole other database leaves no dangling link and keeps the pair one-way", async () => {
    const t = await twoWay();
    expect((await t.ctx.call("DELETE", "/api/db/" + t.b.slug)).status).toBe(200);
    expect((await t.rowOf(t.a.slug, t.a1.id)).props[t.rel.id]).toEqual([]);
    expect(t.links()).toEqual([]);
  });

  test("rows made from a template and duplicated rows show on the other side", async () => {
    const t = await twoWay();
    const tpl = (await t.ctx.call("POST", "/api/db/" + t.a.slug + "/templates", { name: "T", props: { [t.rel.id]: [t.b1.id] }, blocks: [] })).data.template;
    const fromTemplate = (await t.ctx.call("POST", "/api/db/" + t.a.slug + "/rows", { template: tpl.id })).data.row;
    const copy = (await t.ctx.call("POST", "/api/db/" + t.a.slug + "/rows", { props: (await t.rowOf(t.a.slug, t.a1.id)).props })).data.row;
    expect((await t.rowOf(t.b.slug, t.b1.id)).props[t.pair].sort()).toEqual([t.a1.id, fromTemplate.id, copy.id].sort());
    expect((await t.rowOf(t.b.slug, t.b2.id)).props[t.pair].sort()).toEqual([t.a1.id, copy.id].sort());
  });

  test("linking to a deleted row is a 400 and nothing changes", async () => {
    const t = await twoWay();
    await t.ctx.call("DELETE", "/api/db/" + t.b.slug + "/rows/" + t.b2.id);
    const before = JSON.stringify([(await t.read(t.a.slug)).rows, (await t.read(t.b.slug)).rows, t.links()]);
    const bad = await t.ctx.call("PATCH", "/api/db/" + t.a.slug + "/rows/" + t.a1.id, { props: { [t.rel.id]: [t.b1.id, t.b2.id] } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify([(await t.read(t.a.slug)).rows, (await t.read(t.b.slug)).rows, t.links()])).toBe(before);
  });

  test("a failing statement in the middle of the batch leaves both sides as they were", async () => {
    const t = await twoWay();
    const before = JSON.stringify([(await t.read(t.a.slug)).rows, (await t.read(t.b.slug)).rows, t.links()]);
    t.ctx.sqlite.exec("CREATE TRIGGER np5_fail BEFORE INSERT ON db_relation_links WHEN NEW.dst_row = '" + t.a1.id + "' BEGIN SELECT RAISE(ABORT, 'injected'); END");
    const b3 = (await t.ctx.call("POST", "/api/db/" + t.b.slug + "/rows", { props: {} })).data.row;
    const broken = await t.ctx.call("PATCH", "/api/db/" + t.a.slug + "/rows/" + t.a1.id, { props: { [t.rel.id]: [t.b1.id, b3.id] } });
    expect(broken.status).toBe(500);
    t.ctx.sqlite.exec("DROP TRIGGER np5_fail");
    const rowsA = (await t.read(t.a.slug)).rows;
    const rowsB = (await t.read(t.b.slug)).rows.filter((r: any) => r.id !== b3.id);
    expect(JSON.stringify([rowsA, rowsB, t.links()])).toBe(before);
  });

  test("two rows linking to the same row at once both end up in its value", async () => {
    const t = await twoWay();
    const a2 = (await t.ctx.call("POST", "/api/db/" + t.a.slug + "/rows", { props: {} })).data.row;
    const b3 = (await t.ctx.call("POST", "/api/db/" + t.b.slug + "/rows", { props: {} })).data.row;
    await Promise.all([
      t.ctx.call("PATCH", "/api/db/" + t.a.slug + "/rows/" + t.a1.id, { props: { [t.rel.id]: [t.b1.id, t.b2.id, b3.id] } }),
      t.ctx.call("PATCH", "/api/db/" + t.a.slug + "/rows/" + a2.id, { props: { [t.rel.id]: [b3.id] } }),
    ]);
    expect((await t.rowOf(t.b.slug, b3.id)).props[t.pair].sort()).toEqual([t.a1.id, a2.id].sort());
  });

  test("one-way relations still save values as before", async () => {
    const { ctx, a, b, b1, read } = await tripAndSchedule();
    const plain = (await ctx.call("POST", "/api/db/" + a.slug + "/properties", { name: "참고", type: "relation", config: { database: b.slug } })).data.property;
    const row = (await ctx.call("POST", "/api/db/" + a.slug + "/rows", { props: { [plain.id]: [b1.id, "anything"] } })).data.row;
    expect((await read(a.slug)).rows.find((r: any) => r.id === row.id).props[plain.id]).toEqual([b1.id, "anything"]);
    expect(ctx.sqlite.query("SELECT COUNT(*) AS n FROM db_relation_links").get()).toEqual({ n: 0 });
  });
});

async function selfTree() {
  const ctx = setup();
  const d = (await ctx.call("POST", "/api/db", { title: "할 일" })).data;
  const parent = (await ctx.call("POST", "/api/db/" + d.slug + "/properties", { name: "상위 항목", type: "relation", config: { database: d.slug, synced: true, limit: 1 }, pairName: "하위 항목" })).data;
  const P = parent.property.id as string, C = parent.pair.id as string;
  const make = async (props: any = {}) => (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props })).data;
  const row = async (id: string) => (await ctx.call("GET", "/api/db/" + d.slug)).data.rows.find((r: any) => r.id === id);
  const patch = (id: string, props: any) => ctx.call("PATCH", "/api/db/" + d.slug + "/rows/" + id, { props });
  return { ctx, d, P, C, make, row, patch };
}

describe("same-database tree relation (limit 1 parent)", () => {
  test("putting a child under another parent moves it, from either side", async () => {
    const t = await selfTree();
    const p = (await t.make()).row, q = (await t.make()).row, c = (await t.make({ [t.P]: [p.id] })).row;
    expect((await t.row(p.id)).props[t.C]).toEqual([c.id]);
    await t.patch(q.id, { [t.C]: [c.id] });
    expect((await t.row(c.id)).props[t.P]).toEqual([q.id]);
    expect((await t.row(p.id)).props[t.C]).toEqual([]);
    await t.patch(c.id, { [t.P]: [p.id] });
    expect((await t.row(q.id)).props[t.C]).toEqual([]);
    expect((await t.row(p.id)).props[t.C]).toEqual([c.id]);
  });

  test("a row cannot be its own parent or go under its own child", async () => {
    const t = await selfTree();
    const a = (await t.make()).row, b = (await t.make({ [t.P]: [a.id] })).row;
    const self = await t.patch(a.id, { [t.P]: [a.id] });
    expect(self.status).toBe(400);
    const loop = await t.patch(a.id, { [t.P]: [b.id] });
    expect(loop.status).toBe(400);
    expect((await t.row(a.id)).props[t.P]).toEqual([]);
    expect((await t.row(b.id)).props[t.P]).toEqual([a.id]);
    const fromChildSide = await t.patch(b.id, { [t.C]: [a.id] });
    expect(fromChildSide.status).toBe(400);
    expect((await t.row(a.id)).props[t.P]).toEqual([]);
    expect((await t.row(b.id)).props[t.C]).toEqual([]);
  });

  test("two parents claiming one child in sequence leave exactly one parent", async () => {
    const t = await selfTree();
    const p = (await t.make()).row, q = (await t.make()).row, c = (await t.make()).row;
    await Promise.all([t.patch(p.id, { [t.C]: [c.id] }), t.patch(q.id, { [t.C]: [c.id] })]);
    const parents = (await t.row(c.id)).props[t.P];
    expect(parents.length).toBe(1);
    const other = parents[0] === p.id ? q.id : p.id;
    expect((await t.row(other)).props[t.C]).toEqual([]);
    expect((await t.row(parents[0])).props[t.C]).toEqual([c.id]);
  });

  test("A under B and B under A at once: one wins, the other is refused as a loop", async () => {
    const t = await selfTree();
    const a = (await t.make()).row, b = (await t.make()).row;
    const [first, second] = await Promise.all([t.patch(a.id, { [t.P]: [b.id] }), t.patch(b.id, { [t.P]: [a.id] })]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const ap = (await t.row(a.id)).props[t.P], bp = (await t.row(b.id)).props[t.P];
    expect(ap.length + bp.length).toBe(1);
  });

  test("deleting a parent leaves its children without a parent", async () => {
    const t = await selfTree();
    const p = (await t.make()).row, c = (await t.make({ [t.P]: [p.id] })).row;
    await t.ctx.call("DELETE", "/api/db/" + t.d.slug + "/rows/" + p.id);
    expect((await t.row(c.id)).props[t.P]).toEqual([]);
  });
});
