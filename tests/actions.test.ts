import { beforeEach, describe, expect, test } from "bun:test";
import { cookie, setup } from "./db-harness";
import { normaliseConfig, normaliseCellValue, emptyValue } from "../db-model.js";

describe("button property model (notion-parity C4)", () => {
  test("a button has no value, keeps label/icon/color and at most ten actions, and its server cell is a disabled button", () => {
    const config = normaliseConfig("button", { label: "완료", icon: "✓", color: "green", actions: Array.from({ length: 12 }, () => ({ type: "update_row", values: {} })), extra: 1 });
    expect(config.label).toBe("완료");
    expect(config.icon).toBe("✓");
    expect(config.color).toBe("green");
    expect(config.actions.length).toBe(10);
    const prop = { id: "b", name: "버튼", type: "button", config };
    expect(normaliseCellValue(prop, "anything")).toBeNull();
    expect(emptyValue(prop)).toBeNull();
  });

  test("the server-drawn database table shows a button cell as a disabled button until the page script takes over", async () => {
    ctx = setup();
    const made = (await ctx.call("POST", "/api/db", { title: "습관", page: true })).data;
    await ctx.call("POST", "/api/db/" + made.slug + "/properties", { name: "버튼", type: "button", config: { label: "완료", icon: "✓", actions: [{ type: "update_row", values: {} }] } });
    await ctx.call("POST", "/api/db/" + made.slug + "/rows", { props: {} });
    const page = await ctx.worker.fetch(new Request("https://notes.test/" + made.slug + "/", { headers: { cookie: await cookie() } }), ctx.env);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('<button type="button" class="dbbtn" disabled>✓ 완료</button>');
  });
  test("a page that embeds a database with a button property loads the live database script; one without does not", async () => {
    ctx = setup();
    const withBtn = (await ctx.call("POST", "/api/db", { title: "습관", page: true })).data;
    await ctx.call("POST", "/api/db/" + withBtn.slug + "/properties", { name: "버튼", type: "button", config: { actions: [{ type: "update_row", values: {} }] } });
    const plain = (await ctx.call("POST", "/api/db", { title: "그냥", page: true })).data;
    const read = async (slug: string, db: string) => {
      await ctx.call("POST", "/api/pages", { title: slug, slug });
      await ctx.call("PUT", "/api/page/" + slug, { blocks: [{ id: "r", type: "db_ref", text: "", meta: { database: db } }] });
      return (await ctx.worker.fetch(new Request("https://notes.test/" + slug + "/", { headers: { cookie: await cookie() } }), ctx.env)).text();
    };
    expect(await read("embeds-button", withBtn.slug)).toContain('<script src="/db.js"></script>');
    expect(await read("embeds-plain", plain.slug)).not.toContain('<script src="/db.js"></script>');
  });
});

let ctx: ReturnType<typeof setup>;

async function makeDb(title: string, extra: Array<{ name: string; type: string; config?: unknown }> = []) {
  const created = (await ctx.call("POST", "/api/db", { title })).data;
  const ids: Record<string, string> = {};
  for (const prop of extra) {
    const made = await ctx.call("POST", "/api/db/" + created.slug + "/properties", prop);
    expect(made.status).toBe(200);
    ids[prop.name] = made.data.property.id;
  }
  const schema = (await ctx.call("GET", "/api/db/" + created.slug)).data;
  ids.title = schema.properties.find((p: any) => p.type === "title").id;
  ids.status = schema.properties.find((p: any) => p.type === "status").id;
  return { slug: created.slug as string, ids };
}
const rows = async (slug: string) => (await ctx.call("GET", "/api/db/" + slug)).data.rows as any[];
const addRow = async (slug: string, props: Record<string, unknown> = {}) => (await ctx.call("POST", "/api/db/" + slug + "/rows", { props })).data.row;

async function buttonPage(slug: string, actions: unknown, extra: Record<string, unknown> = {}) {
  expect((await ctx.call("POST", "/api/pages", { title: slug, slug })).status).toBe(200);
  const saved = await ctx.call("PUT", "/api/page/" + slug, { blocks: [{ id: "btn", type: "button", text: "추가", meta: { actions, ...extra } }] });
  expect(saved.status).toBe(200);
  return (await ctx.call("GET", "/api/page/" + slug)).data.blocks[0];
}

describe("button actions run on the server", () => {
  beforeEach(() => { ctx = setup(); });

  test("a button block adds a row from a template with today and now and opens it", async () => {
    const todo = await makeDb("할 일", [{ name: "날짜", type: "date" }, { name: "시각", type: "date" }]);
    const tpl = (await ctx.call("POST", "/api/db/" + todo.slug + "/templates", { name: "기본", props: { [todo.ids.status]: "o2", [todo.ids.title]: "새 할 일" }, blocks: [{ id: "x", type: "paragraph", text: "템플릿 본문" }] })).data.template;
    await buttonPage("btn-page", [
      { type: "create_row", database: todo.slug, template: tpl.id, values: { [todo.ids["날짜"]]: { relative: "today" }, [todo.ids["시각"]]: { relative: "now" } } },
      { type: "open", target: "created" },
    ]);
    const before = Date.now();
    const res = await ctx.call("POST", "/api/page/btn-page/button/btn", { actions: [{ type: "create_row", database: "nope" }] });
    expect(res.status).toBe(200);
    expect(res.data.created.length).toBe(1);
    expect(res.data.updated).toBe(0);
    const list = await rows(todo.slug);
    expect(list.length).toBe(1);
    const props = list[0].props;
    expect(props[todo.ids.status]).toBe("o2");
    expect(list[0].pageTitle).toBe("새 할 일");
    expect(props[todo.ids["날짜"]].start).toBe(new Date(before).toISOString().slice(0, 10));
    const at = Date.parse(props[todo.ids["시각"]].start + "Z");
    expect(Math.abs(at - before)).toBeLessThan(2 * 60_000);
    expect(res.data.open).toBe("/" + encodeURIComponent(list[0].page) + "/");
    const page = (await ctx.call("GET", "/api/page/" + encodeURIComponent(list[0].page))).data;
    expect(page.blocks.map((b: any) => b.text)).toContain("템플릿 본문");
  });

  test("the route runs only the stored actions; a block without actions is refused", async () => {
    const a = await makeDb("A");
    expect((await ctx.call("POST", "/api/pages", { title: "plain", slug: "plain" })).status).toBe(200);
    await ctx.call("PUT", "/api/page/plain", { blocks: [{ id: "link", type: "button", text: "이동", meta: { url: "https://example.com" } }] });
    const refused = await ctx.call("POST", "/api/page/plain/button/link", { actions: [{ type: "create_row", database: a.slug }] });
    expect(refused.status).toBe(400);
    expect((await ctx.call("POST", "/api/page/plain/button/missing", {})).status).toBe(404);
    expect((await rows(a.slug)).length).toBe(0);
  });

  test("a button property updates only its row, a ref to the row fills a relation, and update_related touches only related rows", async () => {
    const log = await makeDb("기록", [{ name: "날짜", type: "date" }]);
    const habits = await makeDb("습관", [
      { name: "완료", type: "checkbox" },
      { name: "기록들", type: "relation", config: { database: log.slug } },
    ]);
    const logRel = await ctx.call("POST", "/api/db/" + log.slug + "/properties", { name: "습관", type: "relation", config: { database: habits.slug } });
    const logHabit = logRel.data.property.id;
    const done = await ctx.call("POST", "/api/db/" + habits.slug + "/properties", { name: "완료하기", type: "button", config: { label: "완료", actions: [{ type: "update_row", values: { [habits.ids["완료"]]: true } }] } });
    expect(done.status).toBe(200);
    const record = await ctx.call("POST", "/api/db/" + habits.slug + "/properties", { name: "기록하기", type: "button", config: { actions: [{ type: "create_row", database: log.slug, values: { [log.ids["날짜"]]: { relative: "today" }, [logHabit]: { ref: "row" } } }] } });
    const stamp = await ctx.call("POST", "/api/db/" + habits.slug + "/properties", { name: "기록 날짜", type: "button", config: { actions: [{ type: "update_related", relation: habits.ids["기록들"], values: { [log.ids["날짜"]]: { relative: "today" } } }] } });
    const h1 = await addRow(habits.slug, { [habits.ids.title]: "운동" });
    const h2 = await addRow(habits.slug, { [habits.ids.title]: "독서" });
    const l1 = await addRow(log.slug, { [log.ids.title]: "a" });
    const l2 = await addRow(log.slug, { [log.ids.title]: "b" });
    await ctx.call("PATCH", "/api/db/" + habits.slug + "/rows/" + h2.id, { props: { [habits.ids["기록들"]]: [l1.id] } });

    const pressed = await ctx.call("POST", "/api/db/" + habits.slug + "/rows/" + h2.id + "/button/" + done.data.property.id, {});
    expect(pressed.status).toBe(200);
    expect(pressed.data.updated).toBe(1);
    let list = await rows(habits.slug);
    expect(list.find((r: any) => r.id === h2.id).props[habits.ids["완료"]]).toBe(true);
    expect(list.find((r: any) => r.id === h1.id).props[habits.ids["완료"]]).toBe(false);

    const recorded = await ctx.call("POST", "/api/db/" + habits.slug + "/rows/" + h1.id + "/button/" + record.data.property.id, {});
    expect(recorded.status).toBe(200);
    const logs = await rows(log.slug);
    expect(logs.length).toBe(3);
    const made = logs.find((r: any) => r.id === recorded.data.created[0].row);
    expect(made.props[logHabit]).toEqual([h1.id]);
    expect(made.props[log.ids["날짜"]].start).toBe(new Date().toISOString().slice(0, 10));

    const stamped = await ctx.call("POST", "/api/db/" + habits.slug + "/rows/" + h2.id + "/button/" + stamp.data.property.id, {});
    expect(stamped.status).toBe(200);
    expect(stamped.data.updated).toBe(1);
    const after = await rows(log.slug);
    expect(after.find((r: any) => r.id === l1.id).props[log.ids["날짜"]].start).toBe(new Date().toISOString().slice(0, 10));
    expect(after.find((r: any) => r.id === l2.id).props[log.ids["날짜"]]).toBeNull();
  });

  test("update_row on the title renames the row page; a bad board progress value is refused like a PATCH", async () => {
    const tasks = await makeDb("작업", [{ name: "진행률", type: "number" }]);
    await ctx.call("PATCH", "/api/db/" + tasks.slug, { config: { board_progress: tasks.ids["진행률"] } });
    const rename = await ctx.call("POST", "/api/db/" + tasks.slug + "/properties", { name: "이름 바꾸기", type: "button", config: { actions: [{ type: "update_row", values: { [tasks.ids.title]: "끝난 일" } }] } });
    const bad = await ctx.call("POST", "/api/db/" + tasks.slug + "/properties", { name: "망가뜨리기", type: "button", config: { actions: [{ type: "update_row", values: { [tasks.ids["진행률"]]: 900 } }] } });
    const row = await addRow(tasks.slug, { [tasks.ids.title]: "할 일" });
    expect((await ctx.call("POST", "/api/db/" + tasks.slug + "/rows/" + row.id + "/button/" + rename.data.property.id, {})).status).toBe(200);
    const page = (await ctx.call("GET", "/api/page/" + encodeURIComponent(row.page))).data;
    expect(page.page.title).toBe("끝난 일");
    const patch = await ctx.call("PATCH", "/api/db/" + tasks.slug + "/rows/" + row.id, { props: { [tasks.ids["진행률"]]: 900 } });
    const viaButton = await ctx.call("POST", "/api/db/" + tasks.slug + "/rows/" + row.id + "/button/" + bad.data.property.id, {});
    expect(viaButton.status).toBe(patch.status);
    expect(viaButton.data.error).toBe(patch.data.error);
  });

  test("more than ten actions, a missing database and a malformed action are refused and write nothing", async () => {
    const a = await makeDb("A");
    const eleven = Array.from({ length: 11 }, () => ({ type: "create_row", database: a.slug }));
    const block = await buttonPage("too-many", eleven);
    expect(block.meta.actions).toBeUndefined();
    await ctx.call("PUT", "/api/page/too-many", { blocks: [{ id: "btn", type: "button", text: "x", meta: { actions: [{ type: "create_row", database: a.slug }] } }] });
    ctx.sqlite.query("UPDATE blocks SET meta = ? WHERE page = 'too-many' AND id = 'btn'").run(JSON.stringify({ actions: eleven }));
    const tooMany = await ctx.call("POST", "/api/page/too-many/button/btn", {});
    expect(tooMany.status).toBe(400);
    ctx.sqlite.query("UPDATE blocks SET meta = ? WHERE page = 'too-many' AND id = 'btn'").run(JSON.stringify({ actions: [{ type: "create_row", database: "no-such-db" }] }));
    expect((await ctx.call("POST", "/api/page/too-many/button/btn", {})).status).toBe(404);
    ctx.sqlite.query("UPDATE blocks SET meta = ? WHERE page = 'too-many' AND id = 'btn'").run(JSON.stringify({ actions: [{ type: "send_mail", to: "x@y.z" }] }));
    expect((await ctx.call("POST", "/api/page/too-many/button/btn", {})).status).toBe(400);
    expect((await rows(a.slug)).length).toBe(0);
  });

  test("a link button keeps its url and no actions; anonymous presses are 401", async () => {
    const a = await makeDb("A");
    const link = await buttonPage("links", undefined, { url: "https://example.com" });
    expect(link.meta).toEqual({ url: "https://example.com" });
    await buttonPage("act", [{ type: "create_row", database: a.slug }]);
    expect((await ctx.call("POST", "/api/page/act/button/btn", {}, true)).status).toBe(401);
    expect((await rows(a.slug)).length).toBe(0);
  });
  test("an exported acard-md page with a button imports as a working button; a button aimed at a missing database keeps no actions", async () => {
    const a = await makeDb("A");
    await buttonPage("src", [{ type: "create_row", database: a.slug }, { type: "open", target: "created" }], { color: "green" });
    const exported = await ctx.call("GET", "/api/export?slug=src&format=acard-md");
    expect(exported.status).toBe(200);
    const md = String(exported.data);
    expect(md).toContain("acard_meta: 1");
    const form = new FormData();
    form.append("files", new File([md], "src.md", { type: "text/markdown" }));
    form.append("files", new File([md.replace('"database":"' + a.slug + '"', '"database":"nope"')], "bad.md", { type: "text/markdown" }));
    const res = await ctx.worker.fetch(new Request("https://notes.test/api/import/md", { method: "POST", headers: { cookie: await cookie() }, body: form }), ctx.env);
    const imported = (await res.json()) as any;
    expect(imported.imported).toBe(2);
    const good = (await ctx.call("GET", "/api/page/" + encodeURIComponent(imported.pages[0].slug))).data.blocks[0];
    expect(good.meta.actions).toEqual([{ type: "create_row", database: a.slug, values: {} }, { type: "open", target: "created" }]);
    expect(good.meta.color).toBe("green");
    expect((await ctx.call("POST", "/api/page/" + encodeURIComponent(imported.pages[0].slug) + "/button/" + good.id, {})).status).toBe(200);
    expect((await rows(a.slug)).length).toBe(1);
    const bad = (await ctx.call("GET", "/api/page/" + encodeURIComponent(imported.pages[1].slug))).data.blocks[0];
    expect(bad.meta.actions).toBeUndefined();
  });
});
