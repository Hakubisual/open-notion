import { describe, expect, test } from "bun:test";
import type { ImpEntry } from "../import-plan.ts";
import { impReadZip } from "../import-zip.ts";
import { impObsidianPlan } from "../import-obsidian.ts";
import { buildFixture } from "./fixtures/import-fixtures.ts";

const fromFiles = (files: Map<string, Uint8Array>): ImpEntry[] => [...files].map(([path, bytes]) => ({ path, size: bytes.length, read: async () => bytes }));
const runsOf = (plan: any) => plan.pages.flatMap((p: any) => p.blocks.flatMap((b: any) => (b.meta?.richText || []).map((r: any) => ({ page: p.key, ...r }))));

describe("impObsidianPlan", () => {
  test("O1 as a zip and as a picked folder gives exactly the counts the vault holds", async () => {
    const fixture = await buildFixture("O1");
    for (const entries of [(await impReadZip(fixture.zip)).entries, fromFiles(fixture.files)]) {
      const started = performance.now();
      const plan = await impObsidianPlan(entries, { name: "obsidian-vault.zip" });
      expect(performance.now() - started).toBeLessThan(1000);
      expect(plan.counts).toEqual(fixture.sourceCounts);
      expect(plan.pages.filter((p) => p.kind === "note")).toHaveLength(15);
    }
  });

  test("links resolve to real pages, the ambiguous README and the missing notes are reported, comments are gone", async () => {
    const plan = await impObsidianPlan((await impReadZip((await buildFixture("O1")).zip)).entries, { name: "v" });
    const keys = new Set(plan.pages.map((p) => p.key));
    const runs = runsOf(plan);
    for (const run of runs.filter((r: any) => String(r.href || "").startsWith("imp-page:"))) expect(keys.has(run.href.slice(9).split("#")[0])).toBe(true);
    expect(runs.some((r: any) => r.href === "imp-page:Projects/Website redesign.md#Goals")).toBe(true);
    expect(plan.skipped.filter((s) => s.code === "link-ambiguous").map((s) => s.detail)).toEqual(["[[README]] -> Archive/README.md"]);
    expect(plan.skipped.filter((s) => s.code === "link-missing").length).toBe(2);
    expect(plan.skipped.some((s) => s.code === "canvas" && s.path === "Board.canvas")).toBe(true);
    const text = JSON.stringify(plan.pages);
    expect(text).not.toContain("%%");
    expect(text).not.toContain("internal note");
    expect(text).not.toContain("[[Home]]");
  });

  test("embeds become images with their width, files, or links; folders and tags are kept", async () => {
    const plan = await impObsidianPlan((await impReadZip((await buildFixture("O1")).zip)).entries, { name: "v" });
    const home = plan.pages.find((p) => p.key === "Home.md")!;
    const images = home.blocks.filter((b) => b.type === "image");
    expect(images.map((b) => b.meta?.width)).toEqual([100, 39]);
    expect(images.every((b) => String(b.meta?.src).startsWith("imp-asset:attachments/"))).toBe(true);
    expect(home.blocks.some((b) => b.type === "file" && String(b.meta?.url) === "imp-asset:attachments/spec.pdf")).toBe(true);
    expect(home.blocks[0]).toMatchObject({ type: "table", meta: { columns: ["속성", "값"] } });
    expect(home.tags).toEqual(expect.arrayContaining(["home", "area/school", "qa"]));
    expect(plan.pages.find((p) => p.key === "Projects/README.md")!.parent).toBe("folder:Projects");
    expect(plan.pages.find((p) => p.key === "folder:일기")).toMatchObject({ kind: "folder", title: "일기", parent: null });
    const callouts = plan.pages.find((p) => p.key === "Notes/Callouts.md")!.blocks.filter((b) => b.type === "callout");
    expect(callouts.map((b) => b.meta?.tone)).toEqual(["note", "warning", "tip", "question", "info"]);
    expect(JSON.stringify(callouts)).not.toMatch(/\[![a-z]+\][+-]/);
  });

  test("a self embed and a plain markdown folder finish without looping", async () => {
    for (const name of ["E5", "E10"] as const) {
      const fixture = await buildFixture(name);
      const plan = await impObsidianPlan((await impReadZip(fixture.zip)).entries, { name });
      expect(plan.pages.length).toBeGreaterThan(0);
    }
    const self = await impObsidianPlan(fromFiles(new Map([["a.md", new TextEncoder().encode("# a\n\n![[a]]\n![[a]]")]])), { name: "s" });
    expect(self.counts.embedsNote).toBe(2);
  });
});
