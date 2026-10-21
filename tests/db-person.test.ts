import { describe, expect, test } from "bun:test";
import { displayValue, emptyValue, filterOperatorsFor, matchesCondition, normaliseCellValue, normaliseProperty, PROPERTY_TYPE_NAMES, personInitial } from "../db-model.js";
import { setup } from "./db-harness";

const person = normaliseProperty({ id: "who", name: "담당", type: "person" }, 0);

describe("person property model (notion-parity-5 C10)", () => {
  test("is a property type whose values are lower-case emails without duplicates", () => {
    expect(PROPERTY_TYPE_NAMES).toContain("person");
    expect(normaliseCellValue(person, ["Kim@Example.com ", "kim@example.com", "not an email", "lee@example.com"])).toEqual(["kim@example.com", "lee@example.com"]);
    expect(normaliseCellValue(person, "solo@example.com")).toEqual(["solo@example.com"]);
    expect(emptyValue(person)).toEqual([]);
    const one = normaliseProperty({ id: "one", name: "책임", type: "person", config: { limit: 1 } }, 0);
    expect(normaliseCellValue(one, ["a@example.com", "b@example.com"])).toEqual(["b@example.com"]);
  });

  test("shows the emails and an initial, and filters with contains / does not contain / empty", () => {
    expect(displayValue(person, ["kim@example.com", "lee@example.com"])).toBe("kim@example.com, lee@example.com");
    expect(personInitial("kim.minsu@example.com")).toBe("K");
    expect(personInitial("서연@example.com")).toBe("서");
    expect(filterOperatorsFor("person")).toEqual(["contains", "does_not_contain", "is_empty", "is_not_empty"]);
    expect(matchesCondition(person, ["kim@example.com"], { operator: "contains", value: "KIM@example.com" })).toBe(true);
    expect(matchesCondition(person, ["kim@example.com"], { operator: "does_not_contain", value: "kim@example.com" })).toBe(false);
    expect(matchesCondition(person, [], { operator: "is_empty" })).toBe(true);
  });
});

describe("person cells for the owner", () => {
  test("the owner gets the owner's email as a candidate, can assign it, and a filter 포함 finds the row", async () => {
    const ctx = setup();
    ctx.env.ACARD_USER_EMAIL = "Owner@Example.com";
    const d = (await ctx.call("POST", "/api/db", { title: "할 일" })).data;
    const prop = (await ctx.call("POST", "/api/db/" + d.slug + "/properties", { name: "담당", type: "person" })).data.property;
    const people = await ctx.call("GET", "/api/db/" + d.slug + "/people");
    expect(people.status).toBe(200);
    expect(people.data.people.map((p: any) => p.email)).toEqual(["owner@example.com"]);
    const row = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: { [prop.id]: ["owner@example.com"] } })).data.row;
    expect(row.props[prop.id]).toEqual(["owner@example.com"]);
    await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: {} });
    const data = (await ctx.call("GET", "/api/db/" + d.slug)).data;
    expect(data.rows.filter((r: any) => matchesCondition(prop, r.props[prop.id], { operator: "contains", value: "owner@example.com" })).length).toBe(1);
  });

  test("an email that is not a candidate cannot be written into a person cell", async () => {
    const ctx = setup();
    ctx.env.ACARD_USER_EMAIL = "owner@example.com";
    const d = (await ctx.call("POST", "/api/db", { title: "할 일" })).data;
    const prop = (await ctx.call("POST", "/api/db/" + d.slug + "/properties", { name: "담당", type: "person" })).data.property;
    const bad = await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: { [prop.id]: ["stranger@example.com"] } });
    expect(bad.status).toBe(400);
    const row = (await ctx.call("POST", "/api/db/" + d.slug + "/rows", { props: {} })).data.row;
    const patched = await ctx.call("PATCH", "/api/db/" + d.slug + "/rows/" + row.id, { props: { [prop.id]: ["stranger@example.com"] } });
    expect(patched.status).toBe(400);
    expect((await ctx.call("GET", "/api/db/" + d.slug)).data.rows.every((r: any) => r.props[prop.id].length === 0)).toBe(true);
  });
});
