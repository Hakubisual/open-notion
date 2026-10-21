import { expect, test } from "bun:test";
import { normaliseView } from "../db-model.js";
import { setup } from "./db-harness";

test("a view keeps its default template id; an empty or missing one is left out (C17)", () => {
  expect(normaliseView({ id: "v", type: "table", config: { default_template: "t1" } }, 0).config.default_template).toBe("t1");
  expect("default_template" in normaliseView({ id: "v", type: "table", config: { default_template: "" } }, 0).config).toBe(false);
  expect("default_template" in normaliseView({ id: "v", type: "table", config: { default_template: null } }, 0).config).toBe(false);
});

test("the default template saves on one view only and survives the template being deleted as a plain new row", async () => {
  const ctx = setup();
  const db = (await ctx.call("POST", "/api/db", { title: "기본 템플릿" })).data;
  const base = "/api/db/" + encodeURIComponent(db.slug);
  const tpl = (await ctx.call("POST", base + "/templates", { name: "일지", props: {}, blocks: [] })).data.template;
  const second = (await ctx.call("POST", base + "/views", { name: "B", type: "table" })).data.view;
  const views = (await ctx.call("GET", base)).data.views;
  const first = views.find((v: any) => v.id !== second.id);
  await ctx.call("PATCH", base + "/views/" + encodeURIComponent(first.id), { config: { ...first.config, default_template: tpl.id } });
  const after = (await ctx.call("GET", base)).data.views;
  expect(after.find((v: any) => v.id === first.id).config.default_template).toBe(tpl.id);
  expect(after.find((v: any) => v.id === second.id).config.default_template).toBeUndefined();
  await ctx.call("DELETE", base + "/templates/" + encodeURIComponent(tpl.id));
  // 남은 기본값이 가리키는 템플릿이 없어도 행 추가는 빈 행으로 된다.
  const row = await ctx.call("POST", base + "/rows", { template: tpl.id });
  expect(row.status).toBe(200);
});
