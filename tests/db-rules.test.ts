import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { read, setup } from "./db-harness";

let ctx: ReturnType<typeof setup>, slug: string, base: string, p: Record<string, any>, row: any;
beforeEach(async () => {
  setSystemTime(new Date("2026-10-15T12:00:00Z"));
  ctx = setup();
  slug = (await ctx.call("POST", "/api/db", { title: "Rules" })).data.slug;
  base = "/api/db/" + slug;
  const initial = (await ctx.call("GET", base)).data.properties;
  p = Object.fromEntries(initial.map((prop: any) => [prop.type, prop]));
  for (const type of ["date", "checkbox", "select", "number", "text"]) {
    p[type] = (await ctx.call("POST", base + "/properties", { name: type, type, config: { options: [{ id: "a", name: "A" }, { id: "b", name: "B" }] } })).data.property;
  }
  row = (await ctx.call("POST", base + "/rows", { props: { [p.title.id]: "Task", [p.status.id]: "o1" } })).data.row;
});
afterEach(() => { ctx.sqlite.close(); setSystemTime(); });

const config = () => ({ trigger: { type: "changed", property: p.status.id, value: "o3" }, action: { type: "today", property: p.date.id } });
async function add(value: any = config(), enabled = true) {
  const response = await ctx.call("POST", base + "/rules", { config: value, enabled });
  expect(response.status).toBe(201);
  return response.data.rule;
}
const patch = (props: any) => ctx.call("PATCH", base + "/rows/" + row.id, { props });
const stored = async () => (await ctx.call("GET", base)).data.rows.find((r: any) => r.id === row.id).props;

test("status to date fires on PATCH and survives a fresh worker", async () => {
  await add();
  const today = new Date().toISOString().slice(0, 10);
  expect((await patch({ [p.status.id]: "o3" })).status).toBe(200);
  expect((await stored())[p.date.id]).toEqual({ start: today, end: null });
  const fresh = setup({ sqlite: ctx.sqlite });
  expect((await fresh.call("GET", base)).data.rows[0].props[p.date.id]).toEqual({ start: today, end: null });
});

test("nonmatching and unchanged values do not fire", async () => {
  await add();
  await patch({ [p.status.id]: "o2" });
  expect((await stored())[p.date.id]).toBeNull();
  await patch({ [p.status.id]: "o3" });
  await patch({ [p.date.id]: null });
  await patch({ [p.status.id]: "o3", [p.text.id]: "other edit" });
  expect((await stored())[p.date.id]).toBeNull();
});

test("two ping-pong rules match only the original write and never cascade", async () => {
  await add({ trigger: { type: "changed", property: p.status.id, value: "o3" }, action: { type: "set", property: p.checkbox.id, value: true } });
  await add({ trigger: { type: "changed", property: p.checkbox.id, value: true }, action: { type: "set", property: p.status.id, value: "o1" } });
  expect((await patch({ [p.status.id]: "o3" })).status).toBe(200);
  expect(await stored()).toMatchObject({ [p.status.id]: "o3", [p.checkbox.id]: true });
  await patch({ [p.checkbox.id]: false });
  await patch({ [p.checkbox.id]: true });
  expect(await stored()).toMatchObject({ [p.status.id]: "o1", [p.checkbox.id]: true });
});

test("disabled rules do nothing and can be enabled or deleted", async () => {
  const rule = await add(config(), false);
  await patch({ [p.status.id]: "o3" });
  expect((await stored())[p.date.id]).toBeNull();
  expect((await ctx.call("PATCH", base + "/rules/" + rule.id, { enabled: true })).status).toBe(200);
  await patch({ [p.status.id]: "o1" });
  await patch({ [p.status.id]: "o3" });
  expect((await stored())[p.date.id]).not.toBeNull();
  expect((await ctx.call("DELETE", base + "/rules/" + rule.id)).status).toBe(200);
  expect((await ctx.call("GET", base + "/rules")).data.rules).toEqual([]);
});

test("agent API PATCH triggers the same server rule", async () => {
  await add();
  await ensureAgentSchema(ctx.env.DB);
  const token = (await createAgentToken(ctx.env.DB, { name: "Rules test", scopes: ["read", "write"] })).token;
  const response = await ctx.worker.fetch(new Request("https://notes.test/api/v1/databases/" + slug + "/rows/" + row.id, {
    method: "PATCH", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ props: { [p.status.id]: "o3" } }),
  }), ctx.env);
  expect(response.status).toBe(200);
  expect((await stored())[p.date.id]).toEqual({ start: new Date().toISOString().slice(0, 10), end: null });
});

test("twenty-rule limit includes disabled rules and is enforced in SQL", async () => {
  for (let i = 0; i < 20; i++) await add(config(), i % 2 === 0);
  expect((await ctx.call("POST", base + "/rules", { config: config() })).status).toBe(409);
  const rules = (await ctx.call("GET", base + "/rules")).data.rules;
  expect(rules).toHaveLength(20);
  await ctx.call("DELETE", base + "/rules/" + rules[0].id);
  await add();
  expect((await ctx.call("GET", base + "/rules")).data.rules).toHaveLength(20);
});

test("created rules run for form writes and synchronize a rule-set title", async () => {
  await add({ trigger: { type: "created" }, action: { type: "set", property: p.checkbox.id, value: true } });
  await add({ trigger: { type: "created" }, action: { type: "set", property: p.title.id, value: "Created by rule" } });
  const form = (await ctx.call("PUT", base + "/form", { config: { title: "New task", fields: [{ property: p.title.id, label: "Name", required: true }] } })).data.form;
  const response = await ctx.call("POST", "/api/forms/" + form.id + "/submit", { props: { [p.title.id]: "Input title" } });
  expect(response.status).toBe(201);
  expect(response.data.row.props[p.checkbox.id]).toBe(true);
  expect((await ctx.call("GET", "/api/page/" + response.data.row.page)).data.page.title).toBe("Created by rule");
});

test("select changes and checkbox false triggers set normalized property values", async () => {
  await add({ trigger: { type: "changed", property: p.select.id, value: "a" }, action: { type: "set", property: p.number.id, value: 0 } });
  await add({ trigger: { type: "changed", property: p.checkbox.id, value: false }, action: { type: "set", property: p.title.id, value: "Unchecked" } });
  await patch({ [p.select.id]: "a", [p.checkbox.id]: true });
  expect((await stored())[p.number.id]).toBe(0);
  await patch({ [p.checkbox.id]: false });
  expect((await ctx.call("GET", "/api/page/" + row.page)).data.page.title).toBe("Unchecked");
});

test("unrelated rule actions preserve the default title of an unnamed row", async () => {
  await add();
  const unnamed = (await ctx.call("POST", base + "/rows", { props: {} })).data.row;
  const before = (await ctx.call("GET", "/api/page/" + unnamed.page)).data.page.title;
  await ctx.call("PATCH", base + "/rows/" + unnamed.id, { props: { [p.status.id]: "o3" } });
  expect((await ctx.call("GET", "/api/page/" + unnamed.page)).data.page.title).toBe(before);
});

test("invalid and cross-database rules are rejected and stale properties are inactive", async () => {
  const invalid = [
    { ...config(), trigger: { type: "changed", property: p.number.id, value: 3 } },
    { ...config(), action: { type: "today", property: p.text.id } },
    { ...config(), action: { type: "set", property: p.status.id, value: "o1" } },
    { ...config(), action: { type: "set", property: p.checkbox.id, value: "true" } },
    { ...config(), action: { type: "set", property: p.date.id, value: "2026-02-30" } },
    { ...config(), action: { type: "set", property: "other_db_property", value: "x" } },
  ];
  for (const value of invalid) expect((await ctx.call("POST", base + "/rules", { config: value })).status).toBe(400);
  await add();
  await ctx.call("DELETE", base + "/properties/" + p.date.id);
  expect((await patch({ [p.status.id]: "o3" })).status).toBe(200);
  expect((await ctx.call("GET", base + "/rules")).data.rules[0].valid).toBe(false);
});

test("rule routes retain cookie authentication and schema migration is idempotent", async () => {
  for (const method of ["GET", "POST"]) expect((await ctx.call(method, base + "/rules", method === "POST" ? { config: config() } : undefined, true)).status).toBe(401);
  const rule = await add();
  const other = (await ctx.call("POST", "/api/db", { title: "Other" })).data;
  expect((await ctx.call("DELETE", "/api/db/" + other.slug + "/rules/" + rule.id)).status).toBe(404);
  const before = ctx.sqlite.query("SELECT sql FROM sqlite_master WHERE name LIKE 'db_rules%' ORDER BY name").all();
  ctx.sqlite.exec(read("migrations/nx-004-db-rules.sql"));
  ctx.sqlite.exec(read("migrations/nx-004-db-rules.sql"));
  expect(ctx.sqlite.query("SELECT sql FROM sqlite_master WHERE name LIKE 'db_rules%' ORDER BY name").all()).toEqual(before);
});
