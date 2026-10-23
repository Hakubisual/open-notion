// Run from the exported desktop folder: bun stage.ts.
import { basename, join } from "node:path";
import { cp, mkdir, rm } from "node:fs/promises";

const root = join(import.meta.dir, "..");
const stage = join(import.meta.dir, "stage");
const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
const arch = process.arch;
if (!os || (arch !== "x64" && arch !== "arm64")) throw new Error("Unsupported desktop platform: " + process.platform + "-" + arch);

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error("Failed: bun " + args.join(" "));
}

await rm(stage, { recursive: true, force: true });
await run(["run", "build"]);
await mkdir(join(stage, "server"), { recursive: true });
await cp(join(root, "dist"), join(stage, "app"), {
  recursive: true,
  filter: (source) => basename(source) !== "_worker.js",
});
await run(["build", "local/main.ts", "--compile", "--minify", "--target=bun-" + os + "-" + arch,
  "--outfile", join(stage, "server", "acard-server" + (os === "windows" ? ".exe" : ""))]);
console.log("DESKTOP_STAGE_OK " + os + "-" + arch);
