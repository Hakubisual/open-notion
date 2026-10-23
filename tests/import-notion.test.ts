import { describe, expect, test } from "bun:test";
import { impReadNested, impReadZip } from "../import-zip.ts";
import { impPlanFor } from "../import-detect.ts";
import { buildFixture, type FixtureName } from "./fixtures/import-fixtures.ts";

async function planOf(name: FixtureName, small = false) {
  const fixture = await buildFixture(name, { small });
  const read = await impReadZip(fixture.zip);
  const entries = await impReadNested(read.entries, undefined, read.skipped);
  const started = performance.now();
  const plan = await impPlanFor(entries, { name });
  return { fixture, plan, ms: performance.now() - started };
}

describe("impNotionPlan", () => {
  for (const [name, small, limit] of [["N1", false, 1000], ["N2", false, 1000], ["N3", false, 1000], ["E5", false, 1000], ["E6", false, 1000], ["E8", false, 1000], ["E10", false, 1000], ["N4", true, 3000]] as [FixtureName, boolean, number][]) {
    test(name + (small ? " (small)" : "") + ": every count equals what the export holds", async () => {
      const { fixture, plan, ms } = await planOf(name, small);
      expect(plan.counts).toEqual(fixture.sourceCounts);
      expect(ms).toBeLessThan(limit);
    });
  }

  test("N1 and N2 keep the hierarchy, typed properties, rows linked to their pages and relations between rows", async () => {
    for (const name of ["N1", "N2"] as FixtureName[]) {
      const { plan } = await planOf(name);
      const keys = new Set([...plan.pages.map((p) => p.key), ...plan.databases.map((d) => d.key)]);
      expect(plan.pages.every((p) => !p.parent || keys.has(p.parent))).toBe(true);
      const chain: string[] = [];
      for (let cur: any = plan.pages.find((p) => p.title === "Meeting notes"); cur; cur = plan.pages.find((p) => p.key === cur.parent) || plan.databases.find((d) => d.key === cur.parent)) chain.push(cur.title);
      expect(chain).toEqual(["Meeting notes", "Website redesign", "Projects", "Projects", "Home"]);
      const db = plan.databases[0];
      expect(db.properties.map((p) => p.type)).toEqual(["title", "status", "select", "multi_select", "multi_select", "date", "checkbox", "number", "number", "url", "email", "relation", "date"]);
      expect(db.rows.map((r) => plan.pages.find((p) => p.key === r.page)!.title)).toEqual(["Website redesign", "Mobile app", "Brand refresh"]);
      const related = db.properties.find((p) => p.type === "relation")!.id;
      expect((db.rows[1].values[related] as string[]).map((k) => plan.pages.find((p) => p.key === k)!.title)).toEqual(["Website redesign", "Brand refresh"]);
      expect(plan.pages.filter((p) => p.kind === "db_row")).toHaveLength(3);
    }
  });

  test("links become page placeholders that exist, files and images become assets, Notion markup is gone", async () => {
    for (const name of ["N1", "N2"] as FixtureName[]) {
      const { plan } = await planOf(name);
      const keys = new Set(plan.pages.map((p) => p.key));
      const assets = new Set(plan.assets.map((a) => a.key));
      for (const p of plan.pages) for (const b of p.blocks) {
        for (const r of (b.meta?.richText as any[]) || []) {
          if (String(r.href).startsWith("imp-page:")) expect(keys.has(r.href.slice(9).split("#")[0])).toBe(true);
          if (String(r.href).startsWith("imp-asset:")) expect(assets.has(r.href.slice(10))).toBe(true);
        }
        for (const f of ["src", "url"]) if (String(b.meta?.[f] || "").startsWith("imp-asset:")) expect(assets.has(String(b.meta![f]).slice(10))).toBe(true);
      }
      const text = JSON.stringify(plan.pages).replace(/imp-(page|asset):[^"]*/g, "");
      expect(text).not.toContain("%20");
      expect(text).not.toContain(".md)");
      expect(text).not.toContain("<aside");
      expect(plan.skipped.filter((s) => s.code === "link-missing")).toHaveLength(1);
      expect(plan.skipped.filter((s) => s.code === "duplicate-view")).toHaveLength(1);
      const callouts = plan.pages.flatMap((p) => p.blocks).filter((b) => b.type === "callout");
      expect(callouts.map((b) => b.meta?.icon)).toEqual(["💡", "📌"]);
    }
  });

  test("a Notion toggle (bullet + indented line) becomes a toggle with its child, in md and html alike", async () => {
    for (const name of ["N1", "N2"] as FixtureName[]) {
      const { plan } = await planOf(name);
      const web = plan.pages.find((p) => p.title === "Website redesign")!.blocks;
      const at = web.findIndex((b) => b.type === "toggle");
      expect(web[at].text).toBe("Toggle summary");
      expect(web[at + 1]).toMatchObject({ type: "paragraph", text: "Hidden child paragraph inside the toggle.", indent: (web[at].indent ?? 0) + 1 });
    }
  });

  test("images in a Markdown export become image blocks; E4 keeps no script, its html page and its embed fence", async () => {
    const { plan } = await planOf("N1");
    expect(plan.pages.flatMap((p) => p.blocks).filter((b) => b.type === "image")).toHaveLength(3);
    expect(JSON.stringify(plan.pages)).not.toContain("![");
    const e4 = await planOf("E4");
    expect(e4.plan.counts).toEqual(e4.fixture.sourceCounts);
    const keys = new Set(e4.plan.pages.map((p) => p.key));
    for (const r of e4.plan.pages.flatMap((p) => p.blocks).flatMap((b) => (b.meta?.richText as any[]) || [])) if (String(r.href).startsWith("imp-page:")) expect(keys.has(r.href.slice(9))).toBe(true);
    const outside = e4.plan.pages.flatMap((p) => p.blocks).filter((b) => b.type !== "code");
    expect(JSON.stringify(outside)).not.toMatch(/<script|onerror=|onload=|javascript:|alert\(/i);
  });

  test("hostile pages finish fast without script, unsafe links or a stack overflow", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const entry = (path: string, text: string) => { const b = enc(text); return { path, size: b.length, read: async () => b }; };
    const page = (body: string) => '<html><body><article class="page"><header><h1 class="page-title">T</h1></header><div class="page-body">' + body + "</div></article></body></html>";
    const inputs = [
      entry("X 0123456789abcdef0123456789abcdef.html", page("<div>".repeat(50000) + "deep text")),
      entry("X 0123456789abcdef0123456789abcdef.html", page('<p><img src=x onerror=alert(1)></p><p><a href="javascript:alert(1)">j</a></p><p>hi<script>alert(9)</script></p>')),
      entry("X 0123456789abcdef0123456789abcdef.html", page("<p>cut</p>").replace(/<\/div>[\s\S]*$/, "<style>a{}</style")),
      entry("X 0123456789abcdef0123456789abcdef.html", page("<p>cut</p>").replace(/<\/div>[\s\S]*$/, "<script>alert(2)</script")),
      entry("X 0123456789abcdef0123456789abcdef.md", "# X\n\n[a](javascript:alert(1))\n\nsee [b](JaVaScRiPt:alert(1)) inline\n\n![c](javascript:alert(1))\n\n[d](data:text/html,<script>)\n\n[f](../../../../etc/passwd)\n"),
    ];
    for (const input of inputs) {
      const started = performance.now();
      const plan = await impPlanFor([input], { name: "x" });
      expect(performance.now() - started).toBeLessThan(5000);
      expect(JSON.stringify(plan)).not.toMatch(/<script|onerror=|onload=|javascript:|alert\(/i);
      expect(JSON.stringify(plan)).not.toContain("etc/passwd\",\"href");
    }
  });

  test("E6 keeps pages whose names differ only in case as separate pages; E8 decodes Korean CSV and UTF-16 text", async () => {
    const e6 = (await planOf("E6")).plan;
    expect(new Set(e6.pages.map((p) => p.key)).size).toBe(4);
    const e8 = (await planOf("E8")).plan;
    expect(e8.databases[0].properties.map((p) => p.name).join(" ")).toMatch(/[가-힣]/);
    expect(JSON.stringify(e8.pages)).toMatch(/[가-힣]/);
  });
});
