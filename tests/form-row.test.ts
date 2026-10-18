import { afterEach, beforeEach, expect, test } from "bun:test";
import { cookie, read, setup } from "./db-harness";

let ctx: ReturnType<typeof setup>;
let slug: string;
let properties: Record<string, any>;
let config: any;

beforeEach(async () => {
  ctx = setup();
  slug = (await ctx.call("POST", "/api/db", { title: "Form tasks" })).data.slug;
  const initial = (await ctx.call("GET", "/api/db/" + slug)).data.properties;
  properties = { title: initial.find((p: any) => p.type === "title") };
  for (const type of ["text", "number", "select", "multi_select", "date", "checkbox", "email", "url"]) {
    properties[type] = (await ctx.call("POST", "/api/db/" + slug + "/properties", {
      name: type, type, config: { options: [{ id: "a", name: "가" }, { id: "b", name: "나" }] },
    })).data.property;
  }
  config = { title: "새 작업", fields: Object.values(properties).map(p => ({ property: p.id, label: p.name, required: p.type === "title" })) };
});
afterEach(() => ctx.sqlite.close());

async function save() {
  const response = await ctx.call("PUT", "/api/db/" + slug + "/form", { config });
  expect(response.status).toBe(200);
  return response.data.form;
}
const count = () => (ctx.sqlite.query("SELECT count(*) AS n FROM db_rows").get() as any).n;
const props = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).map(([type, value]) => [properties[type].id, value]));

test("form config persists, updates in place, and migration matches the runtime schema", async () => {
  expect((await ctx.call("GET", "/api/db/" + slug + "/form")).data.form).toBeNull();
  const first = await save();
  config.fields[0].label = "작업 이름";
  const second = await save();
  expect(second.id).toBe(first.id);
  expect(second.created).toBe(first.created);
  expect(second.config).toEqual(config);
  expect((await ctx.call("GET", "/api/forms/" + first.id)).data.form.config).toEqual(config);
  const fresh = setup({ sqlite: ctx.sqlite });
  expect((await fresh.call("GET", "/api/db/" + slug + "/form")).data.form.config).toEqual(config);
  const before = ctx.sqlite.query("SELECT sql FROM sqlite_master WHERE name = 'db_forms'").get();
  ctx.sqlite.exec(read("migrations/nx-003-form-row.sql"));
  ctx.sqlite.exec(read("migrations/nx-003-form-row.sql"));
  expect(ctx.sqlite.query("SELECT sql FROM sqlite_master WHERE name = 'db_forms'").get()).toEqual(before);
});

test("valid submit creates a row using existing normalization and title synchronization", async () => {
  const form = await save();
  const response = await ctx.call("POST", "/api/forms/" + form.id + "/submit", { props: props({ title: "새 행", text: "메모", number: "1,250", select: "a", multi_select: ["a", "a", "b"], date: "2026-10-15", checkbox: "true", email: "owner@example.com", url: "https://example.com" }) });
  expect(response.status).toBe(201);
  expect(count()).toBe(1);
  expect(response.data.row.props).toMatchObject(props({ number: 1250, multi_select: ["a", "b"], date: { start: "2026-10-15", end: null }, checkbox: true }));
  expect((await ctx.call("GET", "/api/page/" + response.data.row.page)).data.page.title).toBe("새 행");
  expect(response.data.url).toBe("/edit/" + encodeURIComponent(response.data.row.page) + "/");
});

test("required and type errors are per-field 400 responses with no rows or pages created", async () => {
  const form = await save();
  const pageCount = (ctx.sqlite.query("SELECT count(*) AS n FROM pages").get() as any).n;
  for (const values of [{ title: "  " }, { title: "작업", number: "많이", select: "missing", multi_select: ["a", "missing"], date: "2026-02-30", checkbox: "yes", email: "bad", url: "javascript:alert(1)", text: {} }]) {
    const response = await ctx.call("POST", "/api/forms/" + form.id + "/submit", { props: props(values) });
    expect(response.status).toBe(400);
    const errors = response.data.errors;
    for (const key of Object.keys(values).filter(key => key !== "title" || !values.title.trim())) {
      expect(errors[properties[key].id]).toMatch(/[가-힣]/);
    }
    expect(count()).toBe(0);
    expect((ctx.sqlite.query("SELECT count(*) AS n FROM pages").get() as any).n).toBe(pageCount);
  }
});

test("required checkbox requires checking; optional false and number zero remain valid", async () => {
  config.fields.find((f: any) => f.property === properties.checkbox.id).required = true;
  const form = await save();
  expect((await ctx.call("POST", "/api/forms/" + form.id + "/submit", { props: props({ title: "작업", checkbox: false }) })).status).toBe(400);
  config.fields.find((f: any) => f.property === properties.checkbox.id).required = false;
  await save();
  const response = await ctx.call("POST", "/api/forms/" + form.id + "/submit", { props: props({ title: "작업", checkbox: false, number: "0" }) });
  expect(response.status).toBe(201);
  expect(response.data.row.props[properties.number.id]).toBe(0);
  expect(response.data.row.props[properties.checkbox.id]).toBe(false);
});

test("malformed structured values return field errors rather than normalization exceptions", async () => {
  const form = await save();
  for (const values of [{ number: [], text: { toString: "bad" }, date: { start: { start: "2026-10-15" } } }, { multi_select: [{ toString: "bad" }] }]) {
    const response = await ctx.call("POST", "/api/forms/" + form.id + "/submit", { props: props({ title: "작업", ...values }) });
    expect(response.status).toBe(400);
    for (const type of Object.keys(values)) expect(response.data.errors[properties[type].id]).toMatch(/[가-힣]/);
    expect(count()).toBe(0);
  }
});

test("unknown form and deleted database return 404; anonymous routes return 401", async () => {
  for (const [method, path] of [["GET", "/form/missing"], ["GET", "/api/forms/missing"], ["POST", "/api/forms/missing/submit"]]) {
    expect((await ctx.call(method, path, method === "POST" ? {} : undefined)).status).toBe(404);
    expect((await ctx.call(method, path, method === "POST" ? {} : undefined, true)).status).toBe(401);
  }
  expect((await ctx.call("PUT", "/api/db/" + slug + "/form", { config }, true)).status).toBe(401);
  const form = await save();
  await ctx.call("DELETE", "/api/db/" + slug);
  expect((await ctx.call("GET", "/form/" + form.id)).status).toBe(404);
});

test("invalid configs and changed properties cannot silently create rows", async () => {
  for (const fields of [[], [config.fields[0], config.fields[0]], [{ property: "unknown", label: "알 수 없음", required: false }]]) {
    expect((await ctx.call("PUT", "/api/db/" + slug + "/form", { config: { ...config, fields } })).status).toBe(400);
  }
  const form = await save();
  await ctx.call("DELETE", "/api/db/" + slug + "/properties/" + properties.text.id);
  const response = await ctx.call("POST", "/api/forms/" + form.id + "/submit", { props: props({ title: "작업" }) });
  expect(response.status).toBe(400);
  expect(response.data.errors[properties.text.id]).toMatch(/[가-힣]/);
  expect(count()).toBe(0);
});

test("native authenticated HTML form submits and links to the normalized row", async () => {
  const form = await save();
  const data = new URLSearchParams({ [properties.title.id]: "브라우저 작업", [properties.number.id]: "1,250" });
  const response = await ctx.worker.fetch(new Request("https://notes.test/form/" + form.id, { method: "POST", headers: { cookie: await cookie() }, body: data }), ctx.env);
  expect(response.status).toBe(201);
  const row = (ctx.sqlite.query("SELECT page, props FROM db_rows").get() as any);
  expect(JSON.parse(row.props)[properties.number.id]).toBe(1250);
  expect(await response.text()).toContain('/edit/' + encodeURIComponent(row.page) + '/');
});
