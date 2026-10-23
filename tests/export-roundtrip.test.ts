import { expect, test } from "bun:test";
import { impReadZip } from "../import-zip.ts";
import { cookie, setup } from "./db-harness";

function memoryKv() {
  const data = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
  return {
    data,
    async put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { metadata?: unknown }) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
      data.set(key, { value: bytes.slice().buffer, metadata: options?.metadata ?? null });
    },
    async get(key: string) { return data.get(key)?.value ?? null; },
    async getWithMetadata(key: string) { const hit = data.get(key); return hit ? { value: hit.value, metadata: hit.metadata } : { value: null, metadata: null }; },
    async delete(key: string) { data.delete(key); },
    async list() { return { keys: [...data.keys()].map((name) => ({ name })), list_complete: true }; },
  };
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253, 227, 85, 242, 156, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const TEXT_FILE = new TextEncoder().encode("reading list\n");

type H = ReturnType<typeof setup>;

async function workspace() {
  const h = setup();
  h.env.MEDIA = memoryKv();
  await h.call("GET", "/api/tree");
  return h;
}

async function upload(h: H, file: File, page: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("page", page);
  const res = await h.worker.fetch(new Request("https://notes.test/api/upload", { method: "POST", headers: { cookie: await cookie() }, body: form }), h.env);
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; url: string };
}

async function exportZip(h: H) {
  return await h.worker.fetch(new Request("https://notes.test/api/export?scope=all&format=zip", { headers: { cookie: await cookie() } }), h.env);
}

async function unzip(bytes: Uint8Array) {
  const { entries } = await impReadZip(bytes);
  const out = new Map<string, Uint8Array>();
  for (const e of entries) out.set(e.path, await e.read());
  return out;
}

// A student's workspace: course > week > lecture pages, an image and a file, a task database with a self relation.
async function build(h: H) {
  const course = (await h.call("POST", "/api/pages", { title: "Course notes" })).data.slug as string;
  const week = (await h.call("POST", "/api/pages", { title: "Week 1", parent: course })).data.slug as string;
  const lecture = (await h.call("POST", "/api/pages", { title: "Lecture A", parent: week })).data.slug as string;
  expect((await h.call("PUT", "/api/page/" + course + "/view", { mode: "folder" })).status).toBe(200);
  const image = await upload(h, new File([PNG], "dot (1).png", { type: "image/png" }), week);
  const doc = await upload(h, new File([TEXT_FILE], "reading list.txt", { type: "text/plain" }), week);
  const put = await h.call("PUT", "/api/page/" + week, {
    title: "Week 1",
    blocks: [
      { id: "h", type: "heading2", text: "Summary" },
      { id: "p", type: "paragraph", text: "Bold and a link", meta: { richText: [{ text: "Bold", bold: true }, { text: " and a " }, { text: "link", href: "/" + lecture + "/" }] } },
      { id: "t", type: "to_do", text: "Review", checked: true },
      { id: "c", type: "callout", text: "Remember", meta: { tone: "warning", icon: "📌" } },
      { id: "k", type: "code", text: "print(1)", meta: { lang: "python" } },
      { id: "e", type: "equation", text: "E = mc^2" },
      { id: "i", type: "image", text: "dot", meta: { src: image.url, width: 60 } },
      { id: "f", type: "file", text: "reading list.txt", meta: { url: doc.url, name: "reading list.txt" } },
    ],
  });
  expect(put.status).toBe(200);
  const db = (await h.call("POST", "/api/db", { title: "Tasks", parent: course, page: true })).data;
  const props = (await h.call("GET", "/api/db/" + db.slug)).data.properties as any[];
  const title = props.find((p) => p.type === "title").id;
  const status = props.find((p) => p.type === "status").id;
  const add = async (name: string, type: string, config?: unknown) => (await h.call("POST", "/api/db/" + db.slug + "/properties", { name, type, config })).data.property;
  const done = await add("Done", "checkbox");
  const due = await add("Due", "date");
  const hours = await add("Hours", "number");
  const rel = await add("Blocks", "relation", { database: db.slug });
  const row = async (values: Record<string, unknown>) => (await h.call("POST", "/api/db/" + db.slug + "/rows", { props: values })).data.row;
  const r1 = await row({ [title]: "Read chapter", [status]: "o3", [done.id]: true, [due.id]: { start: "2026-10-30" }, [hours.id]: 2.5 });
  const r2 = await row({ [title]: "Write essay", [status]: "o2", [rel.id]: [r1.id] });
  const r3 = await row({ [title]: "Submit" });
  expect((await h.call("PUT", "/api/page/" + r2.page, { title: "Write essay", blocks: [{ id: "x", type: "paragraph", text: "Outline first, then draft." }] })).status).toBe(200);
  expect((await h.call("PUT", "/api/page/" + lecture + "/tags", { tags: ["school", "exam"] })).status).toBe(200);
  expect((await h.call("PUT", "/api/page/" + week + "/tags", { tags: ["school"] })).status).toBe(200);
  return { course, week, lecture, db, image, doc, r1, r2, r3, rel };
}

function snapshot(h: H) {
  const q = (sql: string) => h.sqlite.query(sql).all() as any[];
  const live = "NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug)";
  return {
    pages: q("SELECT kind, COUNT(*) AS n FROM pages p WHERE " + live + " GROUP BY kind ORDER BY kind"),
    blocks: q("SELECT b.type, COUNT(*) AS n FROM blocks b JOIN pages p ON p.slug = b.page WHERE " + live + " GROUP BY b.type ORDER BY b.type"),
    media: q("SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM media"),
    mediaKv: [...(h.env.MEDIA.data as Map<string, { value: ArrayBuffer }>).values()].map((v) => v.value.byteLength).sort(),
    rows: q("SELECT COUNT(*) AS n FROM db_rows"),
    props: q("SELECT d.title, p.type, COUNT(*) AS n FROM db_properties p JOIN databases d ON d.id = p.database_id GROUP BY d.title, p.type ORDER BY d.title, p.type"),
    tags: q("SELECT p.title, t.tag FROM page_tags t JOIN pages p ON p.slug = t.page ORDER BY p.title, t.tag"),
    links: q("SELECT s.title AS src, d.title AS dst FROM links l JOIN pages s ON s.slug = l.src JOIN pages d ON d.slug = l.dst ORDER BY src, dst"),
    titles: q("SELECT title, kind FROM pages p WHERE " + live + " ORDER BY title"),
    folders: q("SELECT p.title FROM page_view v JOIN pages p ON p.slug = v.page WHERE v.mode = 'folder' ORDER BY p.title"),
  };
}

test("a full export zip imports back into an empty workspace with the same pages, blocks, files, rows, relations and tags", async () => {
  const a = await workspace();
  const made = await build(a);
  const exported = await exportZip(a);
  expect(exported.status).toBe(200);
  expect(exported.headers.get("content-type")).toBe("application/zip");
  expect(exported.headers.get("content-disposition")).toBe('attachment; filename="acard.zip"');
  expect(exported.headers.get("cache-control")).toBe("no-store");
  expect(exported.headers.get("x-robots-tag")).toContain("noindex");
  const zip = new Uint8Array(await exported.arrayBuffer());
  expect(new Uint8Array(await (await exportZip(a)).arrayBuffer())).toEqual(zip);

  // The archive itself: manifest, folder paths, relative file links, csv for other apps, table of contents.
  const files = await unzip(zip);
  const text = (path: string) => new TextDecoder().decode(files.get(path)!);
  const manifest = JSON.parse(text("acard-export.json"));
  expect([manifest.format, manifest.version]).toEqual(["acard-export", 1]);
  expect(manifest.missingMedia).toBeUndefined();
  const weekEntry = manifest.pages.find((p: any) => p.slug === made.week);
  expect(weekEntry).toMatchObject({ title: "Week 1", parent: made.course, kind: "note", file: made.course + "/" + made.week + ".md" });
  expect(manifest.pages.find((p: any) => p.slug === made.course).kind).toBe("folder");
  expect(manifest.pages.find((p: any) => p.slug === made.lecture)).toMatchObject({ file: made.course + "/" + made.week + "/" + made.lecture + ".md", tags: ["exam", "school"] });
  expect(manifest.pages.find((p: any) => p.slug === made.r2.page)).toMatchObject({ kind: "db_row", parent: made.db.slug });
  const imageFile = "files/" + made.image.id + "-dot_1_.png";
  expect(manifest.media).toEqual([
    { id: made.image.id, name: "dot (1).png", mime: "image/png", file: imageFile },
    { id: made.doc.id, name: "reading list.txt", mime: "text/plain", file: "files/" + made.doc.id + "-reading_list.txt" },
  ]);
  expect(files.get(imageFile)).toEqual(PNG);
  const weekMd = text(weekEntry.file);
  expect(weekMd).toContain("acard_meta: 1");
  expect(weekMd).toContain("](../" + imageFile + ' "60")');
  expect(weekMd).toContain("- [file] ../files/" + made.doc.id + "-reading_list.txt reading list.txt");
  expect(weekMd).not.toContain("/media/");
  expect(text(made.course + "/" + made.week + "/" + made.lecture + ".md")).toContain('tags: ["exam", "school"]');
  const dbEntry = manifest.databases.find((d: any) => d.slug === made.db.slug);
  expect(dbEntry.properties.map((p: any) => p.type)).toEqual(["title", "status", "checkbox", "date", "number", "relation"]);
  expect(dbEntry.rows.find((r: any) => r.page === made.r2.page).values).toMatchObject({ [dbEntry.properties[1].id]: "진행 중", [dbEntry.properties[5].id]: [made.r1.page] });
  const csv = text(made.course + "/" + made.db.slug + ".csv").trim().split("\n");
  expect(csv[0]).toBe("이름,상태,Done,Due,Hours,Blocks");
  expect(csv).toContain("Read chapter,완료,Yes,2026-10-30,2.5,");
  expect(csv).toContain("Write essay,진행 중,No,,,Read chapter");
  expect(text("index.md")).toContain("- [Week 1](./" + weekEntry.file + ")");

  // Import into a fresh workspace and compare.
  const before = snapshot(a);
  const b = await workspace();
  const imported = await b.worker.fetch(new Request("https://notes.test/api/import", { method: "POST", headers: { cookie: await cookie(), "content-type": "application/zip" }, body: zip }), b.env);
  const report = (await imported.json()) as any;
  expect(imported.status).toBe(200);
  expect(report.counts).toMatchObject({ images: 1, attachments: 1, internalLinks: 1, internalLinksToMissing: 0, databases: 1, dbRows: 3 });
  expect(report.skipped).toEqual([]);
  const after = snapshot(b);
  expect(after.pages).toEqual(before.pages);
  expect(after.blocks).toEqual(before.blocks);
  expect(after.media).toEqual(before.media);
  expect(after.mediaKv).toEqual(before.mediaKv);
  expect(after.rows).toEqual(before.rows);
  expect(after.props).toEqual(before.props);
  expect(after.tags).toEqual(before.tags);
  expect(after.links).toEqual(before.links);
  expect(after.titles).toEqual(before.titles);
  expect(after.folders).toEqual(before.folders);

  const slugOf = (title: string) => (b.sqlite.query("SELECT slug, parent FROM pages WHERE title = ?").get(title) as any);
  expect(slugOf("Week 1").parent).toBe(slugOf("Course notes").slug);
  expect(slugOf("Lecture A").parent).toBe(slugOf("Week 1").slug);
  const week = (await b.call("GET", "/api/page/" + slugOf("Week 1").slug)).data.blocks as any[];
  expect(week.find((x) => x.type === "paragraph").meta.richText).toEqual([{ text: "Bold", bold: true }, { text: " and a " }, { text: "link", href: "/" + slugOf("Lecture A").slug + "/" }]);
  const newImage = week.find((x) => x.type === "image").meta;
  expect(newImage).toMatchObject({ width: 60 });
  expect(newImage.src).toMatch(/^\/media\/[0-9a-f]{16}$/);
  expect(b.env.MEDIA.data.get("media/" + newImage.src.slice(7)).value.byteLength).toBe(PNG.length);
  expect(week.find((x) => x.type === "file").meta.url).toMatch(/^\/media\/[0-9a-f]{16}$/);
  expect(week.find((x) => x.type === "callout").meta).toMatchObject({ tone: "warning", icon: "📌" });
  expect(week.find((x) => x.type === "code").meta).toMatchObject({ lang: "python" });
  expect(week.find((x) => x.type === "to_do").checked).toBe(true);
  const essay = (await b.call("GET", "/api/page/" + slugOf("Write essay").slug)).data.blocks as any[];
  expect(essay.map((x) => x.text)).toEqual(["Outline first, then draft."]);

  const newDb = (await b.call("GET", "/api/db/" + slugOf("Tasks").slug)).data;
  const rel = newDb.properties.find((p: any) => p.type === "relation");
  expect(rel.config.database).toBe(newDb.database.slug);
  const byTitle = new Map(newDb.rows.map((r: any) => [r.pageTitle, r]));
  const essayRow = byTitle.get("Write essay") as any;
  const readRow = byTitle.get("Read chapter") as any;
  expect(essayRow.props[rel.id]).toEqual([readRow.id]);
  const statusProp = newDb.properties.find((p: any) => p.type === "status");
  expect(statusProp.config.options.find((o: any) => o.id === readRow.props[statusProp.id]).name).toBe("완료");
  expect(readRow.props[newDb.properties.find((p: any) => p.type === "date").id]).toEqual({ start: "2026-10-30", end: null });
  expect(readRow.props[newDb.properties.find((p: any) => p.type === "number").id]).toBe(2.5);
  expect(readRow.props[newDb.properties.find((p: any) => p.type === "checkbox").id]).toBe(true);
});

test("trashed pages stay out, a lost file is listed in missingMedia, and more than 250 MB of files is refused", async () => {
  const h = await workspace();
  const keep = (await h.call("POST", "/api/pages", { title: "Keep" })).data.slug as string;
  const gone = (await h.call("POST", "/api/pages", { title: "Gone" })).data.slug as string;
  const image = await upload(h, new File([PNG], "a.png", { type: "image/png" }), keep);
  expect((await h.call("PUT", "/api/page/" + keep, { title: "Keep", blocks: [{ id: "i", type: "image", text: "", meta: { src: image.url } }] })).status).toBe(200);
  expect((await h.call("DELETE", "/api/page/" + gone)).status).toBe(200);
  h.env.MEDIA.data.delete("media/" + image.id);
  const res = await exportZip(h);
  expect(res.status).toBe(200);
  const files = await unzip(new Uint8Array(await res.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(files.get("acard-export.json")!));
  expect(manifest.pages.map((p: any) => p.slug)).toEqual([keep]);
  expect(manifest.media).toEqual([]);
  expect(manifest.missingMedia).toEqual([image.id]);
  expect([...files.keys()].some((p) => p.startsWith("files/"))).toBe(false);

  h.sqlite.query("UPDATE media SET bytes = ? WHERE id = ?").run(251 * 1000 * 1000, image.id);
  const big = await exportZip(h);
  expect(big.status).toBe(413);
  const body = (await big.json()) as any;
  expect(body.code).toBe("too-big");
  expect(body.error).toContain("250MB");
});
