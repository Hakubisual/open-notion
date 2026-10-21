// Bun entry: registers every components/*.js file (sorted, same order as the worker and browser copies).
import { readdirSync } from "node:fs";

for (const name of readdirSync(import.meta.dir).filter((n) => n.endsWith(".js") && n !== "index.js").sort()) await import("./" + name);
