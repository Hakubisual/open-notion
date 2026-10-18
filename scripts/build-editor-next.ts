// Builds the lazy editor-next chunk from editor-next/ (readable source, outside assets/ so the build does not ship it) into assets/features/lazy/ (shipped bytes).
// Run after editing the source: bun scripts/build-editor-next.ts. tests/editor-next.test.ts fails while the output is stale.
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "editor-next");
const OUT = join(ROOT, "assets", "features", "lazy");

export async function editorNextChunk(): Promise<{ js: string; css: string }> {
  const built = await Bun.build({ entrypoints: [join(SRC, "editor-next.js")], minify: true, target: "browser" });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const js = await built.outputs[0].text();
  const css = (await Bun.file(join(SRC, "editor-next.css")).text()).split("\n").map((line) => line.trim()).filter(Boolean).join("");
  return { js, css: css + "\n" };
}

export async function visualsChunk(): Promise<{ js: string; css: string }> {
  const built = await Bun.build({ entrypoints: [join(SRC, "visuals-editor.js")], minify: true, target: "browser" });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const css = (await Bun.file(join(SRC, "visuals-editor.css")).text()).split("\n").map((line) => line.trim()).filter(Boolean).join("");
  return { js: await built.outputs[0].text(), css: css + "\n" };
}

if (import.meta.main) {
  const visuals = await visualsChunk();
  await Bun.write(join(OUT, "visuals.js"), visuals.js);
  await Bun.write(join(OUT, "visuals.css"), visuals.css);
  console.log("visuals chunk", visuals.js.length + visuals.css.length, "bytes");
  const { js, css } = await editorNextChunk();
  await Bun.write(join(OUT, "editor-next.js"), js);
  await Bun.write(join(OUT, "editor-next.css"), css);
  console.log("editor-next chunk", js.length + css.length, "bytes");
}
