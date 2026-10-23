// Format detection + dispatch for the importer (#129 #130 #133). Pure, runs in the Worker, browsers and tests; every
// top-level name starts with "imp" because the Worker inlines all import-*.ts files into one scope.
//   impDetect(entries) -> "acard" | "notion-md" | "notion-html" | "obsidian" | "markdown" | "unknown"
//     (async: the "[[ in at least half of the .md files" rule needs file contents)
//   impPlanFor(entries, { name }) -> ImpPlan; throws Error with code "empty" when nothing importable is inside
import { IMP_LIMITS, type ImpEntry, type ImpFormat, type ImpPlan } from "./import-plan.ts";
import { impDecodeText } from "./import-zip.ts";
import { impNotionPlan } from "./import-notion.ts";
import { impObsidianPlan } from "./import-obsidian.ts";
import { impAcardPlan } from "./import-acard.ts";

export type ImpDetected = ImpFormat | "unknown";

const IMP_NOTION_NAME = /(?:^|\s)[0-9a-f]{32}(?:_all)?\.(md|html|csv)$/i;
const IMP_DETECT_SAMPLE = 200;

export async function impDetect(entries: ImpEntry[]): Promise<ImpDetected> {
  if (entries.some((e) => e.path === "acard-export.json")) return "acard";
  if (entries.some((e) => e.path.split("/").includes(".obsidian"))) return "obsidian";
  let notionMd = false;
  let notionOther = false;
  const md: ImpEntry[] = [];
  for (const e of entries) {
    const name = e.path.slice(e.path.lastIndexOf("/") + 1);
    const hit = IMP_NOTION_NAME.exec(name);
    if (hit) {
      if (hit[1].toLowerCase() === "md") notionMd = true;
      else notionOther = true;
    }
    if (/\.md$/i.test(name)) md.push(e);
  }
  if (notionMd) return "notion-md";
  if (notionOther) return "notion-html";
  if (md.length === 0) return "unknown";
  const sample = md.slice(0, IMP_DETECT_SAMPLE);
  let wiki = 0;
  for (const e of sample) if (impDecodeText(await e.read()).text.includes("[[")) wiki += 1;
  return wiki * 2 >= sample.length ? "obsidian" : "markdown";
}

// Readers hold every page's text and blocks in memory, so the text files of one import are capped (IMP_LIMITS.textBytes,
// docs/import.md) before any of them is read. Sizes are the archive's declared sizes; inflating checks them.
const IMP_TEXT_FILE = /\.(md|markdown|html?|csv|txt|json)$/i;
export function impCheckText(entries: ImpEntry[], limit = IMP_LIMITS.textBytes): void {
  let total = 0;
  for (const e of entries) if (IMP_TEXT_FILE.test(e.path)) total += e.size;
  if (total > limit) throw Object.assign(new Error(`too-big: ${total} bytes of text`), { code: "too-big" });
}

export type ImpReaders = { notion: typeof impNotionPlan; obsidian: typeof impObsidianPlan; acard: typeof impAcardPlan };
const IMP_READERS: ImpReaders = { notion: impNotionPlan, obsidian: impObsidianPlan, acard: impAcardPlan };

export async function impPlanFor(entries: ImpEntry[], opts: { name: string; readers?: Partial<ImpReaders> }): Promise<ImpPlan> {
  const readers = { ...IMP_READERS, ...opts.readers };
  impCheckText(entries);
  const format = await impDetect(entries);
  if (format === "unknown") throw Object.assign(new Error("empty: no importable files in the archive"), { code: "empty" });
  let plan: ImpPlan;
  if (format === "acard") plan = await readers.acard(entries, { name: opts.name });
  else if (format === "notion-md" || format === "notion-html") plan = await readers.notion(entries, { name: opts.name, format });
  else plan = await readers.obsidian(entries, { name: opts.name });
  return { ...plan, format };
}
