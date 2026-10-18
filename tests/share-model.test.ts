import { expect, test } from "bun:test";
import { agentScopes, describeAccess, moveWidensSharing, readablePages, shareRole } from "../features/share-model.js";

type Rule = { id: string; page: string; principal: string; role: string; expires: number | null };
const NOW = 1_000_000;

function model(rules: Rule[], options: { inherit?: Record<string, boolean>; subpages?: Record<string, boolean> } = {}) {
  const parents = new Map<string, string | null>([["root", null], ["child", "root"], ["grand", "child"], ["other", null]]);
  return {
    parents,
    inherit: new Map(Object.entries(options.inherit ?? {})),
    subpages: new Map(Object.entries(options.subpages ?? {})),
    rules,
    now: NOW,
  };
}
const rule = (id: string, page: string, principal: string, role: string, expires: number | null = null): Rule => ({ id, page, principal, role, expires });
const guest = (email: string, links: string[] = []) => ({ kind: "guest", email, links: new Set(links) });

test("sub-pages inherit the parent's rules and other pages stay closed", () => {
  const m = model([rule("r1", "root", "email:a@x.dev", "read")]);
  expect(shareRole(m, "root", guest("a@x.dev"))).toBe("read");
  expect(shareRole(m, "grand", guest("A@X.dev"))).toBe("read");
  expect(shareRole(m, "other", guest("a@x.dev"))).toBe("none");
  expect(shareRole(m, "root", guest("b@x.dev"))).toBe("none");
  expect([...readablePages(m, guest("a@x.dev"))].sort()).toEqual(["child", "grand", "root"]);
});

test("the broadest rule on the chain wins", () => {
  const m = model([rule("r1", "root", "email:a@x.dev", "read"), rule("r2", "child", "email:a@x.dev", "edit")]);
  expect(shareRole(m, "root", guest("a@x.dev"))).toBe("read");
  expect(shareRole(m, "grand", guest("a@x.dev"))).toBe("edit");
});

test("a sub-page that stops inheriting drops its parents' rules", () => {
  const m = model([rule("r1", "root", "email:a@x.dev", "edit"), rule("r2", "child", "email:b@x.dev", "read")], { inherit: { child: false } });
  expect(shareRole(m, "child", guest("a@x.dev"))).toBe("none");
  expect(shareRole(m, "grand", guest("a@x.dev"))).toBe("none");
  expect(shareRole(m, "grand", guest("b@x.dev"))).toBe("read");
  expect(describeAccess(m, "grand").map((entry) => [entry.principal, entry.inherited])).toEqual([["email:b@x.dev", true]]);
});

test("expired rules give nothing", () => {
  const m = model([rule("r1", "root", "email:a@x.dev", "edit", NOW), rule("l1", "root", "link", "read", NOW - 1)]);
  expect(shareRole(m, "root", guest("a@x.dev", ["l1"]))).toBe("none");
  expect(shareRole(m, "root", { kind: "token", rule: m.rules[1] })).toBe("none");
  const live = model([rule("l1", "root", "link", "read", NOW + 1)]);
  expect(shareRole(live, "child", { kind: "token", rule: live.rules[0] })).toBe("read");
});

test("link visitors only read; a guest gets the link level only after opening that link", () => {
  const m = model([rule("l1", "root", "link", "edit")]);
  expect(shareRole(m, "child", { kind: "token", rule: m.rules[0] })).toBe("read");
  expect(shareRole(m, "other", { kind: "token", rule: m.rules[0] })).toBe("none");
  expect(shareRole(m, "child", guest("a@x.dev"))).toBe("none");
  expect(shareRole(m, "child", guest("a@x.dev", ["l1"]))).toBe("edit");
});

test("published pages include sub-pages only when 하위 페이지 is on", () => {
  const off = model([rule("p1", "root", "publish", "read")]);
  expect(shareRole(off, "root", { kind: "token", rule: off.rules[0] })).toBe("read");
  expect(shareRole(off, "child", { kind: "token", rule: off.rules[0] })).toBe("none");
  const on = model([rule("p1", "root", "publish", "read")], { subpages: { root: true } });
  expect(shareRole(on, "grand", { kind: "token", rule: on.rules[0] })).toBe("read");
  const email = model([rule("r1", "root", "email:a@x.dev", "full")]);
  expect(shareRole(email, "root", { kind: "token", rule: email.rules[0] })).toBe("none");
});

test("agent rules only narrow the token's scopes, nearest rule first", () => {
  const m = model([rule("a1", "root", "agent:token:t1", "read"), rule("a2", "child", "agent:token:t1", "write"), rule("a3", "other", "agent:token:t1", "none")]);
  expect(agentScopes(m, "root", "token:t1", ["read", "write"])).toEqual(["read"]);
  expect(agentScopes(m, "grand", "token:t1", ["read", "write"])).toEqual(["read", "write"]);
  expect(agentScopes(m, "grand", "token:t1", ["read"])).toEqual(["read"]);
  expect(agentScopes(m, "other", "token:t1", ["read", "write"])).toEqual([]);
  expect(agentScopes(m, "root", "token:t2", ["read", "write"])).toEqual(["read", "write"]);
});

test("moving a page under a shared parent is detected", () => {
  const m = model([rule("r1", "other", "email:a@x.dev", "read")]);
  expect(moveWidensSharing(m, "root", "other")).toBe(true);
  expect(moveWidensSharing(m, "child", null)).toBe(false);
});

test("pages not in the model (trashed or missing) resolve to nothing", () => {
  const m = model([rule("r1", "root", "email:a@x.dev", "full")]);
  expect(shareRole(m, "gone", guest("a@x.dev"))).toBe("none");
  expect(shareRole(m, "gone", { kind: "owner" })).toBe("none");
  expect(shareRole(m, "other", { kind: "owner" })).toBe("full");
});
