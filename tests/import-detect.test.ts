import { describe, expect, test } from "bun:test";
import { impParseRef, type ImpEntry, type ImpPlan } from "../import-plan.ts";
import { impReadNested, impReadZip } from "../import-zip.ts";
import { impCheckText } from "../import-detect.ts";
import { acardMarkdown, type Block } from "../markdown-blocks.ts";
import { buildFixture, type FixtureName } from "./fixtures/import-fixtures.ts";

const calls: { module: string; opts: unknown; paths: string[] }[] = [];
const fakePlan = (format: ImpPlan["format"], name: string): ImpPlan => ({ format, name, pages: [], databases: [], assets: [], skipped: [], counts: { pages: 0, databases: 0, dbRows: 0, internalLinks: 0, internalLinksToMissing: 0, images: 0, attachments: 0, tags: 0, embedsNote: 0, callouts: 0, equations: 0, codeBlocks: 0, todos: 0 } });
const fakeReaders = {
  notion: async (entries: ImpEntry[], opts: { name: string; format: "notion-md" | "notion-html" }) => {
    calls.push({ module: "notion", opts, paths: entries.map((e) => e.path) });
    return fakePlan(opts.format, opts.name);
  },
  obsidian: async (entries: ImpEntry[], opts: { name: string }) => {
    calls.push({ module: "obsidian", opts, paths: entries.map((e) => e.path) });
    return fakePlan("obsidian", opts.name);
  },
};
const { impDetect, impPlanFor: realPlanFor } = await import("../import-detect.ts");
const impPlanFor = (entries: ImpEntry[], opts: { name: string }) => realPlanFor(entries, { ...opts, readers: fakeReaders });
type ImpDetected = Awaited<ReturnType<typeof impDetect>>;
const { impAcardPlan } = await import("../import-acard.ts");

const utf8 = (s: string) => new TextEncoder().encode(s);
const entriesOf = (files: Record<string, string | Uint8Array>): ImpEntry[] =>
  Object.entries(files).map(([path, data]) => {
    const bytes = typeof data === "string" ? utf8(data) : data;
    return { path, size: bytes.length, read: async () => bytes };
  });
async function fixtureEntries(name: FixtureName, small = false): Promise<ImpEntry[]> {
  const f = await buildFixture(name, { small });
  const { entries } = await impReadZip(f.zip);
  return entries;
}

describe("impDetect", () => {
  const cases: [FixtureName, ImpDetected][] = [
    ["N1", "notion-md"],
    ["N2", "notion-html"],
    ["O1", "obsidian"],
    ["E3", "markdown"],
    ["E4", "notion-md"],
    ["E5", "notion-md"],
    ["E6", "notion-md"],
    ["E7", "notion-md"],
    ["E8", "notion-md"],
    ["E9", "notion-md"],
    ["E10", "notion-md"],
  ];
  for (const [name, expected] of cases) {
    test(`${name} -> ${expected}`, async () => {
      expect(await impDetect(await fixtureEntries(name, name === "E7" || name === "E9"))).toBe(expected);
    });
  }
  test("N3: the outer zip alone is unknown, after impReadNested it is notion-md", async () => {
    const outer = await fixtureEntries("N3");
    expect(outer.every((e) => /\.zip$/i.test(e.path))).toBe(true);
    expect(await impDetect(outer)).toBe("unknown");
    const inner = await impReadNested(outer);
    expect(inner.length).toBe(4);
    expect(await impDetect(inner)).toBe("notion-md");
  });
  test("E1: the empty file has no entries, impReadZip throws 'empty' and an empty entry list is unknown", async () => {
    const f = await buildFixture("E1");
    await expect(impReadZip(f.zip)).rejects.toMatchObject({ code: "empty" });
    expect(await impDetect([])).toBe("unknown");
  });
  test("E2: the truncated zip is corrupt before detection", async () => {
    const f = await buildFixture("E2");
    await expect(impReadZip(f.zip)).rejects.toMatchObject({ code: "corrupt" });
  });
  test("acard-export.json at the root wins over everything else", async () => {
    expect(await impDetect(entriesOf({ "acard-export.json": "{}", ".obsidian/app.json": "{}", "Home 0123456789abcdef0123456789abcdef.md": "# x" }))).toBe("acard");
    expect(await impDetect(entriesOf({ "sub/acard-export.json": "{}", "a.md": "# x" }))).toBe("markdown");
  });
  test(".obsidian anywhere -> obsidian; [[ in at least half of the md files -> obsidian; otherwise markdown", async () => {
    expect(await impDetect(entriesOf({ "vault/.obsidian/app.json": "{}", "vault/a.md": "# a" }))).toBe("obsidian");
    expect(await impDetect(entriesOf({ "a.md": "see [[b]]", "b.md": "# b", "c.png": new Uint8Array(3) }))).toBe("obsidian");
    expect(await impDetect(entriesOf({ "a.md": "see [[b]]", "b.md": "# b", "c.md": "# c" }))).toBe("markdown");
    expect(await impDetect(entriesOf({ "a.md": "# a", "b.md": "# b" }))).toBe("markdown");
  });
  test("a 32-hex csv or html alone is notion-html; any 32-hex md makes it notion-md; _all suffix counts", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(await impDetect(entriesOf({ [`Tasks ${id}.csv`]: "Name\n", "readme.md": "# r" }))).toBe("notion-html");
    expect(await impDetect(entriesOf({ [`Tasks ${id}_all.csv`]: "Name\n", [`Home ${id}.html`]: "<html>" }))).toBe("notion-html");
    expect(await impDetect(entriesOf({ [`Tasks ${id}.csv`]: "Name\n", [`Home ${id}.md`]: "# r" }))).toBe("notion-md");
  });
  test("no md, no manifest, no notion names -> unknown", async () => {
    expect(await impDetect(entriesOf({ "a.txt": "x", "b.png": new Uint8Array(2), "zip-inside.zip": new Uint8Array(4) }))).toBe("unknown");
  });
});

describe("impPlanFor dispatch (mocked readers)", () => {
  test("notion-md and notion-html go to impNotionPlan with the format", async () => {
    calls.length = 0;
    const md = await impPlanFor(await fixtureEntries("N1"), { name: "n1.zip" });
    expect(md.format).toBe("notion-md");
    expect(md.name).toBe("n1.zip");
    const html = await impPlanFor(await fixtureEntries("N2"), { name: "n2.zip" });
    expect(html.format).toBe("notion-html");
    expect(calls.map((c) => [c.module, (c.opts as { format?: string }).format])).toEqual([
      ["notion", "notion-md"],
      ["notion", "notion-html"],
    ]);
    expect(calls[0].paths.length).toBeGreaterThan(0);
  });
  test("obsidian and plain markdown both go to impObsidianPlan", async () => {
    calls.length = 0;
    expect((await impPlanFor(await fixtureEntries("O1"), { name: "vault.zip" })).format).toBe("obsidian");
    const plain = await impPlanFor(await fixtureEntries("E3"), { name: "md.zip" });
    expect(plain.format).toBe("markdown");
    expect(calls.map((c) => c.module)).toEqual(["obsidian", "obsidian"]);
    expect(calls[1].paths).toEqual(["ok.md"]);
    expect(calls[1].opts).toEqual({ name: "md.zip" });
  });
  test("unknown throws an Error with code empty", async () => {
    calls.length = 0;
    await expect(impPlanFor(entriesOf({ "a.txt": "x" }), { name: "x.zip" })).rejects.toMatchObject({ code: "empty" });
    await expect(impPlanFor([], { name: "x.zip" })).rejects.toMatchObject({ code: "empty" });
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------- hand-made Acard export
const MEDIA_ID = "m0001";
const MEDIA_FILE = `files/${MEDIA_ID}-cover.png`;
const PDF_ID = "m0003";
const PDF_FILE = `files/${PDF_ID}-brief.pdf`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const block = (type: Block["type"], text: string, extra: Partial<Block> = {}): Block => ({ id: "b" + Math.random().toString(36).slice(2, 8), type, text, ...extra });

function acardExport(): ImpEntry[] {
  const launchBlocks: Block[] = [
    block("heading2", "Goals"),
    block("paragraph", "Ship it. See retro and gone.", { meta: { richText: [{ text: "Ship it. See " }, { text: "retro", href: "/retro/" }, { text: " and " }, { text: "gone", href: "/gone/" }, { text: "." }] } }),
    block("image", "cover", { meta: { src: `/media/${MEDIA_ID}`, width: 60 } }),
    block("callout", "Keep the scope small.", { meta: { tone: "note", icon: "💡" } }),
    block("to_do", "Write the plan", { checked: true }),
    block("code", "bun test", { meta: { lang: "bash" } }),
  ];
  const retroBlocks: Block[] = [
    block("paragraph", "Back to launch goals, and a wiki link to Launch.", { meta: { richText: [{ text: "Back to " }, { text: "launch goals", href: "/launch/#Goals" }, { text: ", and a wiki link to [[Launch]]." }] } }),
    block("image", "same cover", { meta: { src: MEDIA_FILE, width: 100 } }),
    block("paragraph", "Here is **bold** and a missing picture:"),
    block("image", "lost", { meta: { src: "/media/nope", width: 100 } }),
    block("equation", "E = mc^2"),
    block("file", "brief.pdf", { meta: { url: PDF_FILE, name: "brief.pdf" } }),
    block("file", "brief again", { meta: { url: `/media/${PDF_ID}`, name: "brief again" } }),
  ];
  const manifest = {
    format: "acard-export",
    version: 1,
    pages: [
      { slug: "launch", title: "Launch", parent: "tasks", kind: "db_row", file: "pages/launch.md", tags: ["Work", "q4"], icon: "🚀" },
      { slug: "retro", title: "Retro", parent: "tasks", kind: "db_row", file: "pages/retro.md", tags: ["work"] },
    ],
    databases: [
      {
        slug: "tasks",
        title: "Tasks",
        parent: null,
        properties: [
          { id: "p_title", name: "Name", type: "title" },
          { id: "p_status", name: "Status", type: "select", config: { options: [{ id: "o1", name: "Done", color: "green" }] } },
          { id: "p_rel", name: "Related", type: "relation", config: { database: "tasks" } },
          { id: "p_due", name: "Due", type: "date" },
        ],
        rows: [
          { page: "launch", values: { p_title: "Launch", p_status: "Done", p_rel: ["retro", "outside-page"], p_due: { start: "2026-10-23", end: null } } },
          { page: "retro", values: { p_title: "Retro", p_status: null, p_rel: ["launch"], p_due: null } },
          { page: "not-a-page", values: { p_title: "ghost" } },
        ],
      },
    ],
    media: [
      { id: MEDIA_ID, name: "cover.png", mime: "image/png", file: MEDIA_FILE },
      { id: "m0002", name: "gone.pdf", mime: "application/pdf", file: "files/m0002-gone.pdf" },
      { id: PDF_ID, name: "brief.pdf", mime: "application/pdf", file: PDF_FILE },
    ],
  };
  return entriesOf({
    "acard-export.json": JSON.stringify(manifest),
    "pages/launch.md": acardMarkdown("Launch", launchBlocks),
    "pages/retro.md": acardMarkdown("Retro", retroBlocks),
    [MEDIA_FILE]: PNG,
    [PDF_FILE]: "%PDF-1.4 synthetic",
    "tasks.csv": "Name,Status\nLaunch,Done\nRetro,\n",
    "index.md": "# Export\n\n- [Launch](pages/launch.md)\n",
  });
}

describe("impAcardPlan", () => {
  test("2 pages, 1 db with 2 rows, 1 image + 1 file asset: exact counts, placeholders and skips", async () => {
    const plan = await impAcardPlan(acardExport(), { name: "acard.zip" });
    expect(plan.format).toBe("acard");
    expect(plan.name).toBe("acard.zip");
    expect(plan.counts).toEqual({ pages: 2, databases: 1, dbRows: 2, internalLinks: 3, internalLinksToMissing: 1, images: 2, attachments: 2, tags: 2, embedsNote: 0, callouts: 1, equations: 1, codeBlocks: 1, todos: 1 });

    expect(plan.pages.map((p) => [p.key, p.source, p.title, p.parent, p.kind])).toEqual([
      ["launch", "acard:launch", "Launch", "tasks", "db_row"],
      ["retro", "acard:retro", "Retro", "tasks", "db_row"],
    ]);
    expect(plan.pages[0].tags).toEqual(["Work", "q4"]);
    expect(plan.pages[0].icon).toBe("🚀");
    expect(plan.pages[1].icon).toBeUndefined();

    const launch = plan.pages[0].blocks;
    expect(launch.map((b) => b.type)).toEqual(["heading2", "paragraph", "image", "callout", "to_do", "code"]);
    expect(launch[0].text).toBe("Goals");
    const runs = launch[1].meta?.richText as { text: string; href?: string }[];
    expect(launch[1].text).toBe("Ship it. See retro and gone.");
    expect(runs.find((r) => r.text === "retro")?.href).toBe("imp-page:retro");
    expect(runs.find((r) => r.text === "gone")?.href).toBeUndefined();
    expect(launch[2].meta).toMatchObject({ src: `imp-asset:${MEDIA_FILE}`, width: 60 });
    expect(impParseRef(launch[2].meta?.src)).toEqual({ kind: "asset", key: MEDIA_FILE });
    expect(launch[3].meta).toMatchObject({ tone: "note", icon: "💡" });
    expect(launch[4].checked).toBe(true);
    expect(launch[5].meta).toEqual({ lang: "bash" });

    const retro = plan.pages[1].blocks;
    expect(retro.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph", "paragraph", "equation", "file", "file"]);
    const retroRuns = retro[0].meta?.richText as { text: string; href?: string }[];
    expect(retroRuns.find((r) => r.text === "launch goals")?.href).toBe("imp-page:launch#Goals");
    expect(retroRuns.find((r) => r.text === "Launch")?.href).toBe("imp-page:launch");
    expect(retro[0].text).toBe("Back to launch goals, and a wiki link to Launch.");
    expect(retro[1].meta?.src).toBe(`imp-asset:${MEDIA_FILE}`);
    expect(retro[2].text).toBe("Here is bold and a missing picture:");
    expect((retro[2].meta?.richText as { text: string; bold?: boolean }[]).find((r) => r.bold)?.text).toBe("bold");
    expect(retro[3]).toMatchObject({ type: "paragraph", text: "lost" });
    expect(retro[5].meta).toEqual({ url: `imp-asset:${PDF_FILE}`, name: "brief.pdf" });
    expect(retro[6].meta).toEqual({ url: `imp-asset:${PDF_FILE}`, name: "brief again" });
    for (const page of plan.pages) for (const b of page.blocks) expect(JSON.stringify(b)).not.toContain("acard_meta");

    expect(plan.databases).toHaveLength(1);
    const db = plan.databases[0];
    expect([db.key, db.source, db.title, db.parent]).toEqual(["tasks", "acard:tasks", "Tasks", null]);
    expect(db.properties.map((p) => [p.id, p.type])).toEqual([["p_title", "title"], ["p_status", "select"], ["p_rel", "relation"], ["p_due", "date"]]);
    expect(db.rows).toEqual([
      { page: "launch", values: { p_title: "Launch", p_status: "Done", p_rel: ["retro"], p_due: { start: "2026-10-23", end: null } } },
      { page: "retro", values: { p_title: "Retro", p_status: null, p_rel: ["launch"], p_due: null } },
    ]);

    expect(plan.assets).toHaveLength(2);
    expect(plan.assets[0]).toMatchObject({ key: MEDIA_FILE, path: MEDIA_FILE, name: "cover.png", kind: "image", size: PNG.length });
    expect(await plan.assets[0].read()).toEqual(PNG);
    expect(plan.assets[1]).toMatchObject({ key: PDF_FILE, path: PDF_FILE, name: "brief.pdf", kind: "file" });

    expect(plan.skipped.map((s) => [s.code, s.detail])).toEqual([
      ["unreadable", "media file listed in acard-export.json is not in the archive"],
      ["link-missing", "/gone/"],
      ["link-missing", "/media/nope"],
      ["relation-outside", "outside-page"],
    ]);
  });
  test("impPlanFor routes an acard export to impAcardPlan", async () => {
    calls.length = 0;
    const plan = await impPlanFor(acardExport(), { name: "acard.zip" });
    expect(plan.format).toBe("acard");
    expect(plan.counts.pages).toBe(2);
    expect(calls).toEqual([]);
  });
  test("a manifest that is not an Acard export is corrupt; a missing page file is skipped, not fatal", async () => {
    await expect(impAcardPlan(entriesOf({ "acard-export.json": "{\"format\":\"other\"}" }), { name: "x" })).rejects.toMatchObject({ code: "corrupt" });
    await expect(impAcardPlan(entriesOf({ "acard-export.json": "not json" }), { name: "x" })).rejects.toMatchObject({ code: "corrupt" });
    const plan = await impAcardPlan(entriesOf({ "acard-export.json": JSON.stringify({ format: "acard-export", version: 1, pages: [{ slug: "a", title: "A", parent: null, kind: "note", file: "pages/a.md" }] }) }), { name: "x" });
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0].blocks).toEqual([]);
    expect(plan.skipped).toEqual([{ path: "pages/a.md", code: "unreadable", detail: "page file listed in acard-export.json is not in the archive" }]);
  });
});

describe("impPlanFor with the real readers", () => {
  test("N1 and O1 produce plans from import-notion.ts / import-obsidian.ts", async () => {
    const n1 = await buildFixture("N1");
    const notion = await realPlanFor((await impReadZip(n1.zip)).entries, { name: "n1.zip" });
    expect(notion.format).toBe("notion-md");
    expect(notion.counts.pages).toBe(n1.sourceCounts.pages);
    expect(notion.counts.databases).toBe(n1.sourceCounts.databases);
    const o1 = await buildFixture("O1");
    const obsidian = await realPlanFor((await impReadZip(o1.zip)).entries, { name: "vault.zip" });
    expect(obsidian.format).toBe("obsidian");
    expect(obsidian.counts.pages).toBe(o1.sourceCounts.pages);
  });
});

test("more uncompressed text than IMP_LIMITS.textBytes is refused as too-big before any file is read", async () => {
  let reads = 0;
  const big = (path: string, size: number): ImpEntry => ({ path, size, read: async () => { reads += 1; return new Uint8Array(0); } });
  const entries = [big("a.md", 40 * 1024 * 1024), big("b.md", 30 * 1024 * 1024), big("photo.png", 200 * 1024 * 1024)];
  const error = await impPlanFor(entries, { name: "x" }).then(() => null, (e) => e);
  expect(error?.code).toBe("too-big");
  expect(reads).toBe(0);
  expect(() => impCheckText(entries.slice(0, 1))).not.toThrow();
});
