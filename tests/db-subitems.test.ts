import { describe, expect, test } from "bun:test";
import { nestRows, normaliseDatabaseConfig, normaliseView, SUBITEM_DEPTH } from "../db-model.js";
import { setup } from "./db-harness";

const rows = (...ids: [string, string | null][]) => ids.map(([id, parent]) => ({ id, parent }));
const parentOf = (row: any) => row.parent;
const shape = (list: any[]) => list.map((entry) => entry.row.id + ":" + entry.depth + (entry.dim ? "~" : "") + (entry.hasChildren ? "+" : ""));

describe("sub-item order (nestRows)", () => {
  test("children follow their parent, indented, in the shown order", () => {
    const all = rows(["a", null], ["b", null], ["a1", "a"], ["a2", "a"], ["a1x", "a1"], ["b1", "b"]);
    expect(shape(nestRows(all, all, parentOf, new Set()))).toEqual(["a:0+", "a1:1+", "a1x:2", "a2:1", "b:0+", "b1:1"]);
  });

  test("depth stops at 3 and deeper rows keep that indent", () => {
    const all = rows(["r", null], ["c1", "r"], ["c2", "c1"], ["c3", "c2"], ["c4", "c3"]);
    expect(SUBITEM_DEPTH).toBe(3);
    expect(nestRows(all, all, parentOf, new Set()).map((entry) => entry.depth)).toEqual([0, 1, 2, 3, 3]);
  });

  test("a collapsed parent hides its whole subtree", () => {
    const all = rows(["a", null], ["a1", "a"], ["a1x", "a1"], ["b", null]);
    const out = nestRows(all, all, parentOf, new Set(["a"]));
    expect(shape(out)).toEqual(["a:0+", "b:0"]);
    expect(out[0].collapsed).toBe(true);
  });

  test("a filtered-in child keeps its filtered-out parent, dimmed", () => {
    const all = rows(["a", null], ["a1", "a"], ["b", null]);
    const shown = [all[1], all[2]];
    expect(shape(nestRows(all, shown, parentOf, new Set()))).toEqual(["a:0~+", "a1:1", "b:0"]);
  });

  test("a broken loop in the data still draws every row once", () => {
    const all = rows(["x", "y"], ["y", "x"], ["z", null]);
    const out = nestRows(all, all, parentOf, new Set());
    expect(out.map((entry) => entry.row.id).sort()).toEqual(["x", "y", "z"]);
  });

  test("view and database settings keep only known values", () => {
    expect(normaliseView({ type: "table", config: { subitems: "flat" } }, 0).config.subitems).toBe("flat");
    expect(normaliseView({ type: "table", config: { subitems: "weird" } }, 0).config.subitems).toBeUndefined();
    expect(normaliseDatabaseConfig({ subitems: { parent: "p", children: "c" }, other: 1 })).toEqual({ subitems: { parent: "p", children: "c" } });
    expect(normaliseDatabaseConfig({ subitems: { parent: "p" } })).toEqual({});
  });
});

describe("sub-items on a database", () => {
  async function todo() {
    const ctx = setup();
    const d = (await ctx.call("POST", "/api/db", { title: "할 일" })).data;
    const on = await ctx.call("PATCH", "/api/db/" + d.slug, { subitems: true });
    const read = async () => (await ctx.call("GET", "/api/db/" + d.slug)).data;
    return { ctx, d, on, read };
  }

  test("turning sub-items on makes the 상위 항목 / 하위 항목 pair and the setting survives a re-read", async () => {
    const { on, read } = await todo();
    expect(on.status).toBe(200);
    const data = await read();
    const sub = data.database.config.subitems;
    const parent = data.properties.find((p: any) => p.id === sub.parent);
    const children = data.properties.find((p: any) => p.id === sub.children);
    expect(parent).toMatchObject({ name: "상위 항목", type: "relation", config: { limit: 1, synced: true, pair: children.id } });
    expect(children).toMatchObject({ name: "하위 항목", type: "relation", config: { synced: true, pair: parent.id } });
  });

  test("turning it on twice keeps one pair; off clears the setting and keeps the values", async () => {
    const { ctx, d, read } = await todo();
    await ctx.call("PATCH", "/api/db/" + d.slug, { subitems: true });
    const data = await read();
    expect(data.properties.filter((p: any) => p.type === "relation").length).toBe(2);
    const sub = data.database.config.subitems;
    const a = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: {} })).data.row;
    await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: { [sub.parent]: [a.id] } });
    expect((await ctx.call("PATCH", "/api/db/" + d.slug, { subitems: false })).status).toBe(200);
    const after = await read();
    expect(after.database.config.subitems).toBeUndefined();
    expect(after.rows.find((r: any) => r.id === a.id).props[sub.children].length).toBe(1);
  });

  test("adding two sub-items under A shows them in A's 하위 항목 and a count rollup is 2; moving one to B splits them", async () => {
    const { ctx, d, read } = await todo();
    const sub = (await read()).database.config.subitems;
    const count = (await ctx.call("POST", "/api/db/" + d.slug + "/properties", { name: "하위 항목 개수", type: "rollup", config: { relation_property: sub.children, target_property: "", function: "count" } })).data.property;
    const a = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: {} })).data.row;
    const b = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: {} })).data.row;
    const c1 = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: { [sub.parent]: [a.id] } })).data.row;
    const c2 = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: { [sub.parent]: [a.id] } })).data.row;
    let data = await read();
    const row = (id: string) => data.rows.find((r: any) => r.id === id);
    expect(row(a.id).props[sub.children].sort()).toEqual([c1.id, c2.id].sort());
    expect(row(a.id).computed[count.id]).toBe(2);
    await ctx.call("PATCH", "/api/db/" + d.slug + "/rows/" + c2.id, { props: { [sub.parent]: [b.id] } });
    data = await read();
    expect(row(a.id).props[sub.children]).toEqual([c1.id]);
    expect(row(b.id).props[sub.children]).toEqual([c2.id]);
  });

  test("A under its own child is refused and nothing changes", async () => {
    const { ctx, d, read } = await todo();
    const sub = (await read()).database.config.subitems;
    const a = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: {} })).data.row;
    const b = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: { [sub.parent]: [a.id] } })).data.row;
    const before = JSON.stringify((await read()).rows);
    const bad = await ctx.call("PATCH", "/api/db/" + d.slug + "/rows/" + a.id, { props: { [sub.parent]: [b.id] } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toContain("하위 항목");
    expect(JSON.stringify((await read()).rows)).toBe(before);
  });

  test("the setting is stored in databases.config", async () => {
    const { ctx, d } = await todo();
    const raw: any = ctx.sqlite.query("SELECT config FROM databases WHERE slug = ?").get(d.slug);
    expect(Object.keys(JSON.parse(raw.config).subitems)).toEqual(["parent", "children"]);
  });
});
