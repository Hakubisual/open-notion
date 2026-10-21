// Builds the lazy parts chunk (#38) from assets/features/parts/page.js + part-html.js into assets/features/lazy/parts.js.
// Run after editing either: bun scripts/build-parts.ts. tests/parts.test.ts fails while the output is stale.
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

export async function runtimeString(): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(ROOT, "assets", "features", "parts", "runtime.js")], minify: true, target: "browser", format: "iife" });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  return (await built.outputs[0].text()).trim();
}

export function withRuntime(partHtml: string, runtime: string): string {
  return partHtml.replace(/\/\/ PART_RUNTIME:BEGIN\n[\s\S]*?\n\/\/ PART_RUNTIME:END/, () => "// PART_RUNTIME:BEGIN\nexport const PART_RUNTIME = " + JSON.stringify(runtime) + ";\n// PART_RUNTIME:END");
}

export async function partsChunk(): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(ROOT, "assets", "features", "parts", "page.js")], minify: true, target: "browser", format: "iife" });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  return built.outputs[0].text();
}

if (import.meta.main) {
  const partHtml = join(ROOT, "part-html.js");
  await Bun.write(partHtml, withRuntime(await Bun.file(partHtml).text(), await runtimeString()));
  const js = await partsChunk();
  await Bun.write(join(ROOT, "assets", "features", "lazy", "parts.js"), js);
  console.log("parts chunk", js.length, "bytes");
}
