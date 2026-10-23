// The importer's pure modules in dependency order, inlined into the Worker at //__IMPORT_CORE__ by build.ts and
// tests/assemble-worker.ts. A file that does not exist yet is skipped, so the list can name modules of later waves.
export const IMPORT_CORE_FILES = [
  "import-plan.ts",
  "import-zip.ts",
  "import-inline.ts",
  "import-csv.ts",
  "import-sanitize.ts",
  "import-notion.ts",
  "import-obsidian.ts",
  "import-acard.ts",
  "import-detect.ts",
];
