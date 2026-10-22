import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { markdownToBlocks } from "../markdown-blocks";

const order = ["meeting", "plan", "report", "research", "tasks", "journal", "reading", "project", "decision", "travel", "weekly"];

export async function loadTemplates(root: string) {
  return Promise.all(order.map(async (id) => {
    const raw = await readFile(join(root, "seed/templates", id + ".md"), "utf8");
    const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    if (!header) throw new Error("Missing template metadata: " + id);
    const meta = Object.fromEntries(header[1].split(/\r?\n/).map(line => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }));
    const blocks = markdownToBlocks(raw.slice(header[0].length)).map((block, index) => ({ ...block, id: "template-" + index }));
    // style: report turns on the research-report page style (page setting font) for a page made from this template.
    return { id, name: meta.name, icon: meta.icon, description: meta.description, ...(meta.style === "report" ? { settings: { font: "report" } } : {}), blocks };
  }));
}

export async function buildTemplates(root: string, dist: string) {
  await writeFile(join(dist, "templates-seed.json"), JSON.stringify({ templates: await loadTemplates(root) }));
}
