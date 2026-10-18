import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// #10: a live/SW swap of <main> must not leave the owner's home showing only the "비공개 노트" footer.
test("home view re-attaches after a <main> swap (acard:page-fresh)", async () => {
  const listeners: Record<string, ((e?: unknown) => void)[]> = {};
  const nodes: Record<string, any> = {};
  const article = { before(el: any) { el.isConnected = true; nodes["acard-home"] = el; } };
  nodes.article = article;
  const document: any = {
    getElementById: (id: string) => nodes[id] ?? null,
    createElement: () => ({ isConnected: false, hidden: false, innerHTML: "", addEventListener() {}, querySelectorAll: () => [] }),
    addEventListener: (t: string, f: any) => { (listeners[t] ||= []).push(f); },
    body: { classList: { add() {} } },
  };
  const fetch = async (url: string) => ({ ok: true, json: async () => (url === "/api/profile" ? { profile: { home_layout: { widgets: [] } } } : null) });
  new Function("document", "fetch", readFileSync("assets/ui/home.js", "utf8"))(document, fetch);
  await new Promise((r) => setTimeout(r, 20));
  const home = nodes["acard-home"];
  expect(home?.isConnected).toBe(true);
  home.isConnected = false;
  delete nodes["acard-home"];
  nodes.article = { before(el: any) { el.isConnected = true; nodes["acard-home"] = el; } };
  listeners["acard:page-fresh"].forEach((f) => f());
  expect(nodes["acard-home"]).toBe(home);
  expect(home.isConnected).toBe(true);
});
