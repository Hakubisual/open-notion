import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { markdownToBlocks } from "../markdown-blocks.ts";
import "../assets/editor-model.js";
import "../assets/columns-model.js";
import { renderBlocks } from "../block-html.js";
import { componentCss, componentMarkdown, getComponent, renderComponentBlock } from "../component-registry.js";
import { createAgentToken, ensureAgentSchema } from "../agent-api.js";
import { assembleWorkerSource } from "./assemble-worker";

// ds10-4 (#97): timeline, steps, compare, tabs and accordion.
const IDS = ["timeline", "steps", "compare", "tabs", "accordion"];
const ui = (id: string, data: unknown) => renderComponentBlock({ type: "component", text: typeof data === "string" ? data : JSON.stringify(data), meta: { ui: id } });
const EVIL = '<img src=x onerror="alert(1)">';
const count = (html: string, re: RegExp) => (html.match(re) || []).length;

describe("component family B", () => {
  test("all five are registered with schema, slash entry and a sample that renders without fallback", () => {
    for (const id of IDS) {
      const c = getComponent(id)!;
      expect(c).toBeTruthy();
      expect(c.schema.properties).toBeTruthy();
      expect(c.slash.label).toBeTruthy();
      const html = ui(id, c.sample);
      expect(html).toContain('data-ui="' + id + '"');
      expect(html).not.toContain("ui-fallback");
      expect(html).not.toMatch(/<script|\son[a-z]+=/i);
    }
  });

  test("CSS uses tokens only: no raw colors and no raw px font sizes", () => {
    for (const id of IDS) {
      const css = getComponent(id)!.css as string;
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
      expect(css).not.toMatch(/font-size:\s*\d/);
      expect(css).not.toContain("<");
    }
  });

  test("every field is escaped; **bold** is the only markup data can make", () => {
    const cases: [string, unknown][] = [
      ["timeline", { items: [{ date: EVIL, title: EVIL, text: EVIL, state: EVIL }] }],
      ["steps", { items: [{ title: EVIL, text: EVIL, date: EVIL }], current: EVIL }],
      ["compare", { columns: [EVIL, EVIL, EVIL], rows: [[EVIL, EVIL, EVIL]], highlight: 1, badge: EVIL }],
      ["tabs", { tabs: [{ label: EVIL, text: EVIL, icon: "<b" }, { label: "b", text: EVIL }] }],
      ["accordion", { items: [{ title: EVIL, text: EVIL, open: true }] }],
    ];
    for (const [id, data] of cases) {
      const html = ui(id, data);
      expect(html).not.toContain("<img");
      expect(html).not.toContain('onerror="');
      expect(html).toContain("&lt;img");
    }
    expect(ui("accordion", { items: [{ title: "**굵게**", text: "a `b`" }] })).toContain("<b>굵게</b>");
  });

  test("timeline draws one dot per item with its state; unknown state is todo; empty list shows a hint", () => {
    const html = ui("timeline", { items: [{ date: "9월", title: "A", state: "done" }, { title: "B", state: "doing" }, { title: "C", state: "nope" }, "junk"] });
    expect(count(html, /class="ui-tl-dot"/g)).toBe(3);
    expect(html).toContain('ui-tl-i ui-tl-done"');
    expect(html).toContain('ui-tl-i ui-tl-doing" aria-current="step"');
    expect(html).toContain('ui-tl-i ui-tl-todo"');
    expect(html).toContain("진행 중");
    expect(ui("timeline", {})).toContain("아직 기록이 없어요");
  });

  test("steps mark earlier steps done, the current one now, later ones todo, and stack under 640px", () => {
    const html = ui("steps", { current: 1, items: [{ title: "조사", date: "9월 2일" }, { title: "시안" }, { title: "출시", text: "정식" }] });
    expect(html.match(/ui-st-i ui-st-(\w+)/g)).toEqual(["ui-st-i ui-st-done", "ui-st-i ui-st-now", "ui-st-i ui-st-todo"]);
    expect(count(html, /aria-current="step"/g)).toBe(1);
    expect(html).toContain("<svg");
    expect(html).toContain(">3<");
    expect(html).toContain("9월 2일");
    expect(getComponent("steps")!.css).toContain("@container (max-width:639px){.ui-st{flex-direction:column}");
    expect(ui("steps", { current: "x", items: [{ title: "a" }] })).toContain("ui-st-i ui-st-now");
  });

  test("compare: header row, row labels, yes/no as check/dash, the highlight column carries the badge", () => {
    const html = ui("compare", { columns: ["항목", "A안", "B안"], rows: [["확장", "yes", "no"], ["가격", true, false], ["짧은 행"]], highlight: 2, badge: "추천" });
    expect(count(html, /<th scope="col"/g)).toBe(3);
    expect(count(html, /<th scope="row"/g)).toBe(3);
    expect(count(html, /class="ui-cmp-yes"/g)).toBe(2);
    expect(count(html, /class="ui-cmp-no"/g)).toBe(2);
    expect(html).toContain('class="ui-cmp-hl">B안<span class="ui-cmp-badge">추천</span>');
    expect(count(html, /<td class="ui-cmp-hl"/g)).toBe(3);
    expect(count(html, /<td/g)).toBe(6);
    const none = ui("compare", { columns: ["a", "b"], rows: [], highlight: 9 });
    expect(none).not.toContain("ui-cmp-badge");
    expect(ui("compare", { columns: ["a", "b"], rows: [], highlight: 0 })).not.toContain("ui-cmp-badge");
  });

  test("tabs are script-free radios + labels: one group per block, every label points at its own radio, selected is checked", () => {
    const html = ui("tabs", { tabs: [{ label: "요약", text: "하나\n\n둘" }, { label: "위험", text: "셋" }], selected: 1 });
    expect(html).not.toContain("<script");
    const ids = [...html.matchAll(/<input class="ui-tabs-r" type="radio" name="([^"]+)" id="([^"]+)"( checked)?>/g)];
    expect(ids).toHaveLength(2);
    expect(new Set(ids.map((m) => m[1])).size).toBe(1);
    expect(ids.map((m) => !!m[3])).toEqual([false, true]);
    expect([...html.matchAll(/<label class="ui-tabs-l" for="([^"]+)"/g)].map((m) => m[1])).toEqual(ids.map((m) => m[2]));
    expect(count(html, /class="ui-tabs-p"/g)).toBe(2);
    expect(html).toContain("<p>하나</p><p>둘</p>");
    expect(getComponent("tabs")!.css).toContain(".ui-tabs-r:nth-of-type(2):checked~.ui-tabs-ps>.ui-tabs-p:nth-child(2){display:block}");
    expect(ui("tabs", { tabs: [{ label: "a" }], selected: 7 })).toContain(" checked>");
  });

  test("two tabs blocks on one page (even with identical data) never share radio names or ids", () => {
    const data = { tabs: [{ label: "A", text: "a" }, { label: "B", text: "b" }] };
    const page = renderBlocks(markdownToBlocks(componentMarkdown("tabs", data) + "\n\n" + componentMarkdown("tabs", data)), { page: { slug: "t" } });
    const ids = [...page.matchAll(/ id="(uitab-[^"]+)"/g)].map((m) => m[1]);
    const names = new Set([...page.matchAll(/ name="(uitab-[^"]+)"/g)].map((m) => m[1]));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(names.size).toBe(2);
    for (const id of ids) expect(page).toContain('for="' + id + '"');
    expect(count(page, /\.ui-tabs-l\{/g)).toBe(1);
  });

  test("accordion uses details/summary, open only where open is true", () => {
    const html = ui("accordion", { items: [{ title: "Q1", text: "A1", open: true }, { title: "Q2", text: "A2\n\nA3", open: "yes" }, { title: "Q3" }] });
    expect(count(html, /<details class="ui-acc-i"/g)).toBe(3);
    expect(count(html, /<details class="ui-acc-i" open>/g)).toBe(1);
    expect(count(html, /<summary>/g)).toBe(3);
    expect(html).toContain("<p>A2</p><p>A3</p>");
    expect(html).toContain("내용이 없어요");
  });

  test("malformed JSON draws defaults, flagged", () => {
    for (const id of IDS) {
      const html = ui(id, "{ nope");
      expect(html).toContain('data-ui-invalid="1"');
      expect(html).not.toContain("ui-fallback");
    }
  });

  test("the page CSS carries each family once", () => {
    const css = componentCss();
    for (const id of IDS) expect(css.split(getComponent(id)!.css as string).length - 1).toBe(1);
  });
});

function d1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []): any => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...(params as any[])).changes } }),
    all: async () => ({ results: sqlite.query(sql).all(...(params as any[])) }),
    first: async () => sqlite.query(sql).get(...(params as any[])) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => {
      sqlite.exec("BEGIN");
      try { const out = []; for (const item of list) out.push(await item.run()); sqlite.exec("COMMIT"); return out; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

describe("family B through the worker", () => {
  test("an agent-written page draws all five in the reader, and tabs keep their radios and labels on the published page", async () => {
    const sqlite = new Database(":memory:");
    const worker = new Function(assembleWorkerSource())();
    const env: any = { DB: d1(sqlite), GATE_PASSWORD: "pw", GATE_SECRET: "secret", ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const person = "dn_auth=" + expires + "." + mac;
    const send = async (method: string, path: string, headers: Record<string, string>, body?: string) => {
      const res = await worker.fetch(new Request("https://notes.test" + path, { method, headers, body }), env, {});
      return { status: res.status, text: await res.text() };
    };
    await send("GET", "/api/v1/me", {});
    await ensureAgentSchema(env.DB);
    const token = (await createAgentToken(env.DB, { name: "agent", scopes: ["read", "write"] })).token;
    const md = "---\ntitle: ds10 B\n---\n\n" + IDS.map((id) => componentMarkdown(id, getComponent(id)!.sample)).join("\n\n") + "\n\n" + componentMarkdown("tabs", getComponent("tabs")!.sample) + "\n";
    const made = await send("POST", "/api/v1/pages", { authorization: "Bearer " + token, "content-type": "text/markdown" }, md);
    expect(made.status).toBe(201);
    const slug = JSON.parse(made.text).slug;
    const reader = await send("GET", "/" + encodeURIComponent(slug) + "/", { cookie: person });
    expect(reader.status).toBe(200);
    for (const id of IDS) expect(reader.text).toContain('data-ui="' + id + '"');
    const published = await send("POST", "/api/page/" + encodeURIComponent(slug) + "/access/publish", { cookie: person, origin: "https://notes.test" });
    expect(published.status).toBe(201);
    const page = await send("GET", JSON.parse(published.text).url, {});
    expect(page.status).toBe(200);
    expect(page.text).toContain('data-ui="tabs"');
    const radios = [...page.text.matchAll(/<input class="ui-tabs-r" type="radio" name="([^"]+)" id="([^"]+)"/g)];
    expect(radios).toHaveLength(6);
    expect(new Set(radios.map((m) => m[2])).size).toBe(6);
    expect(new Set(radios.map((m) => m[1])).size).toBe(2);
    for (const m of radios) expect(page.text).toContain('<label class="ui-tabs-l" for="' + m[2] + '"');
    expect(page.text).toContain('<details class="ui-acc-i" open>');
    expect(page.text).toContain(".ui-tabs-r:nth-of-type(1):checked~");
  });
});
