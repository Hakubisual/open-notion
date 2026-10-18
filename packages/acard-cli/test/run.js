import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BIN = join(import.meta.dir, "..", "bin", "acard.js");

/** Runs the CLI under plain Node (the shipped runtime) and collects its output. */
export async function runCli(args, { token, server } = {}) {
  const env = { ...process.env };
  delete env.ACARD_TOKEN;
  delete env.ACARD_URL;
  if (token != null) env.ACARD_TOKEN = token;
  const proc = Bun.spawn(["node", BIN, ...(server ? ["--server", server] : []), ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

export const makeTempDir = () => mkdtemp(join(tmpdir(), "acard-cli-test-"));
export const removeDir = (dir) => rm(dir, { recursive: true, force: true });
