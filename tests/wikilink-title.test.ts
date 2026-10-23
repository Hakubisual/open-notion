import { afterEach, beforeEach, expect, test } from "bun:test";
import { cookie, setup } from "./db-harness";
import "../assets/editor-model.js";
import { renderBlocks } from "../block-html.js";

let h: ReturnType<typeof setup>;
let auth: string;
const text = "A [[my   page title]] B [[My Page Title|별칭]] C [[my page title#Second Part]] D [[target]] E [[Nothing Here]] F [[dup]] G [[Gone Page]] H [[Other WS]]";

async function reader(path: string) {
  const response = await h.worker.fetch(new Request("https://notes.test" + path, { headers: { cookie: auth, accept: "text/html" } }), h.env);
  expect(response.status).toBe(200);
  return response.text();
}

beforeEach(async () => {
  h = setup();
  auth = await cookie();
  for (const [slug, title] of [["src", "Source"], ["target", "My Page Title"], ["dup-old", "Dup"], ["dup-new", "dup"], ["gone", "Gone Page"]]) {
    expect((await h.call("POST", "/api/pages", { slug, title })).status).toBe(200);
  }
  h.sqlite.query("UPDATE pages SET updated = 100 WHERE slug = 'dup-new'").run();
  h.sqlite.query("UPDATE pages SET updated = 50 WHERE slug = 'dup-old'").run();
  h.sqlite.query("INSERT INTO editor_trash (page, deleted, permanent) VALUES ('gone', 1, 0)").run();
  const other = setup();
  expect((await other.call("POST", "/api/pages", { slug: "other-ws", title: "Other WS" })).status).toBe(200);
  other.sqlite.close();
  const blocks = [
    { id: "p", type: "paragraph", text },
    { id: "r", type: "paragraph", text: "rich [[My Page Title]]", meta: { richText: [{ text: "rich [[My Page Title]]" }] } },
  ];
  expect((await h.call("PUT", "/api/page/src", { title: "Source", blocks })).status).toBe(200);
});
afterEach(() => h.sqlite.close());

test("reader resolves [[title]], alias, heading and slug forms inside the workspace", async () => {
  const html = await reader("/src/");
  expect(html).toContain('<a href="/target/">my   page title</a>');
  expect(html).toContain('<a href="/target/">별칭</a>');
  expect(html).toContain('<a href="/target/#second-part">my page title</a>');
  expect(html).toContain('<a href="/target/">target</a>');
  expect(html).toContain('<a href="/dup-new/">dup</a>');
  expect(html).toContain("[[Nothing Here]]");
  expect(html).toContain("[[Gone Page]]");
  expect(html).toContain("[[Other WS]]");
  expect(html).toContain('rich <a href="/target/" rel="noopener">My Page Title</a>');
});

test("saved title links reach the links table and backlinks", async () => {
  const dsts = (h.sqlite.query("SELECT dst FROM links WHERE src = 'src'").all() as { dst: string }[]).map((row) => row.dst);
  expect(dsts).toContain("target");
  expect(dsts).toContain("dup-new");
  expect(dsts).not.toContain("dup-old");
  expect(dsts).not.toContain("gone");
  expect(dsts).not.toContain("other-ws");
  expect((await h.call("GET", "/api/backlinks?slug=target")).data.backlinks.map((row: any) => row.slug)).toEqual(["src"]);
  expect((await h.call("GET", "/api/backlinks?slug=dup-new")).data.backlinks.map((row: any) => row.slug)).toEqual(["src"]);
});

test("DB-free render keeps [[slug]] links and leaves title text alone", () => {
  const html = renderBlocks([{ id: "a", type: "paragraph", text: "[[infra|인프라]] [[infra#Deploy Steps]] [[Some Title]]" }]);
  expect(html).toContain('<a href="/infra/">인프라</a>');
  expect(html).toContain('<a href="/infra/#deploy-steps">infra</a>');
  expect(html).toContain("[[Some Title]]");
});
