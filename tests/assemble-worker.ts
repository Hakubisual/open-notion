import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
const stripModule = (text: string) => text.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, "");

export function assembleWorkerSource(fixture = "") {
  let source = read("gate/_worker.js");
  const parts: Record<string, string> = {
    "//__EQUATION_HTML__": "equation-html.js",
    "//__BLOCK_HTML__": "block-html.js",
    "//__DB_MODEL__": "db-model.js",
    "//__DB_FORMULA__": "db-formula.js",
    "//__DB_HTML__": "db-html.js",
    "//__EDITOR_PAGES__": "editor-pages.js",
    "//__AGENT_API__": "agent-api.js",
    "//__MARKDOWN_BLOCKS__": "markdown-blocks.ts",
    "//__NOTION_IMPORT__": "notion-import.ts",
    "//__NOTION_EXPORT__": "notion-export.ts",
  };
  for (const [marker, file] of Object.entries(parts)) {
    const code = file.endsWith(".ts") ? new Bun.Transpiler({ loader: "ts" }).transformSync(read(file)) : read(file);
    const extra = marker === "//__EQUATION_HTML__" ? "\n" + stripModule(read("visual-html.js")) : "";
    source = source.replace(marker, () => stripModule(code) + extra);
  }
  const features = readdirSync(join(ROOT, "features")).filter((name) => name.endsWith(".js")).sort();
  source = source.replace("//__FEATURES__", () => features.map((name) => stripModule(read("features/" + name))).concat(fixture).join("\n;\n"));
  const clientFeatures = readdirSync(join(ROOT, "assets/features"));
  for (const ext of ["js", "css"]) {
    const present = clientFeatures.some((name) => name.endsWith("." + ext)
      && (name.endsWith(".reader." + ext) || name.endsWith(".shared.js"))
      && read("assets/features/" + name).trim());
    const tag = ext === "js" ? '<script src="/features-reader.js"></script>' : '<link rel="stylesheet" href="/features-reader.css">';
    source = source.replace("//__READER_FEATURE_" + ext.toUpperCase() + "__", () => present ? JSON.stringify(tag) + "," : "");
  }
  source = read("assets/editor-model.js") + "\n" + source;
  source = source.replace("export default {", "const __worker = {").replace(/^export /gm, "");
  return source + "\nreturn Object.assign(__worker, { acardHost });";
}
