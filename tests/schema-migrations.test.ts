import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// The owner workspace runs on Postgres, where gate/pg-d1.ts skips every CREATE statement, so a table that the Worker
// creates only from code never exists there (#128). Member-store-only tables are listed with the store that owns them.
const STORE_ONLY: Record<string, string> = {
  sync_pages: "gate/cloud.ts sync store (Durable Object per subscriber)",
  sync_meta: "gate/cloud.ts sync store (Durable Object per subscriber)",
};

function filesUnder(dir: string, ext: RegExp): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && ext.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

function createdTables(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(/CREATE\s+(?:VIRTUAL\s+)?TABLE\s+IF\s+NOT\s+EXISTS\s+(?:acard\.)?([a-z_0-9]+)/gi)) {
      found.add(match[1].toLowerCase());
    }
  }
  return found;
}

test("every table the Worker creates from code also has a Postgres migration (#128)", () => {
  const fromCode = createdTables([...filesUnder("gate", /\.(js|ts)$/), ...filesUnder("features", /\.js$/)]);
  const fromMigrations = createdTables(filesUnder("migrations/supabase", /^\d{3}-.*\.sql$/));
  expect(fromCode.size).toBeGreaterThan(40);
  const missing = [...fromCode].filter((name) => !fromMigrations.has(name) && !(name in STORE_ONLY)).sort();
  expect(missing).toEqual([]);
});
