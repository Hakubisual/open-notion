// Browser import engine (lazy chunk, loaded by lazy/import.js): window.AcardImportEngine = { readZip(file), readFolder(items), planFor(entries, name, load) }.
// The Notion and Obsidian readers are their own chunks (lazy/import-notion.js, lazy/import-obsidian.js) so every chunk stays under
// the 46,000 B lazy cap; planFor runs impDetect and asks load("notion" | "obsidian") for the reader, the same dispatch as impPlanFor.
import { IMP_LIMITS } from "../../../import-plan.ts";
import { impReadZip, impReadNested } from "../../../import-zip.ts";
import { impCheckText, impDetect } from "../../../import-detect.ts";
import { impAcardPlan } from "../../../import-acard.ts";

const fail = (code) => Object.assign(new Error(code), { code });

window.AcardImportEngine = {
  async readZip(file) {
    const read = await impReadZip({ size: file.size, read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) });
    const entries = await impReadNested(read.entries, IMP_LIMITS, read.skipped);
    return { entries, skipped: read.skipped };
  },
  // items: File (webkitRelativePath) or { path, file } from a dropped folder.
  readFolder(items) {
    const entries = [];
    let total = 0;
    for (const item of items) {
      const file = item.file || item;
      const path = String(item.path || file.webkitRelativePath || file.name).replace(/\\/g, "/").replace(/^\/+/, "");
      const segs = path.split("/");
      if (segs.includes("..") || segs.includes("__MACOSX")) continue;
      if (!segs.includes(".obsidian") && segs[segs.length - 1].startsWith(".")) continue;
      total += file.size;
      entries.push({ path, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) });
    }
    if (total > IMP_LIMITS.archiveBytes) throw fail("too-big");
    if (entries.length > IMP_LIMITS.entries) throw fail("too-many");
    if (!entries.length) throw fail("empty");
    return { entries, skipped: [] };
  },
  async planFor(entries, name, load) {
    try { impCheckText(entries); } catch { throw fail("too-big"); }
    const format = await impDetect(entries);
    if (format === "unknown") throw fail("empty");
    let plan;
    if (format === "acard") plan = await impAcardPlan(entries, { name });
    else if (format === "notion-md" || format === "notion-html") plan = await (await load("notion"))(entries, { name, format });
    else plan = await (await load("obsidian"))(entries, { name });
    return { ...plan, format };
  },
};
