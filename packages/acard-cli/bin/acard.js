#!/usr/bin/env node
import { main } from "../src/main.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    process.stderr.write(`acard: ${err?.stack || err}\n`);
    process.exitCode = 1;
  },
);
