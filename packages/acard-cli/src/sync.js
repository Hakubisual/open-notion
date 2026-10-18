import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ApiError, pagePath, request } from "./api.js";

export const STATE_FILE = ".acard-sync.json";

export const hash = (content) => createHash("sha256").update(content, "utf8").digest("hex");

async function loadState(dir) {
  try {
    return JSON.parse(await readFile(join(dir, STATE_FILE), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

const saveState = (dir, state) => writeFile(join(dir, STATE_FILE), JSON.stringify(state, null, 2) + "\n");

async function readIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Fetches the remote markdown for a page and writes it locally, updating state. */
async function writePage(cfg, dir, state, slug, updated) {
  const markdown = await request(cfg, "GET", `${pagePath(slug)}?format=markdown`, { text: true });
  await writeFile(join(dir, `${slug}.md`), markdown);
  state[slug] = { updated, hash: hash(markdown) };
}

export async function pull(cfg, dir, out) {
  await mkdir(dir, { recursive: true });
  const state = await loadState(dir);
  const { pages } = await request(cfg, "GET", "/api/v1/pages");
  let failed = false;
  for (const page of pages.filter((p) => p.kind === "note")) {
    const file = join(dir, `${page.slug}.md`);
    const local = await readIfExists(file);
    // Never clobber unpushed local edits.
    if (local !== null && state[page.slug] && hash(local) !== state[page.slug].hash) {
      out(`skipped   ${page.slug}.md (local changes; push first)`);
      continue;
    }
    try {
      await writePage(cfg, dir, state, page.slug, page.updated);
      out(`pulled    ${page.slug}.md`);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 401) throw err;
      failed = true;
      out(`error     ${page.slug}.md (${err.message})`);
    }
  }
  await saveState(dir, state);
  return failed ? 1 : 0;
}

async function refresh(cfg, dir, state, slug) {
  const page = await request(cfg, "GET", pagePath(slug));
  await writePage(cfg, dir, state, slug, page.updated);
}

export async function push(cfg, dir, out) {
  const state = await loadState(dir);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  let bad = 0;
  for (const file of files) {
    const slug = file.slice(0, -3);
    const content = await readFile(join(dir, file), "utf8");
    const entry = state[slug];
    try {
      if (entry && entry.hash === hash(content)) {
        out(`unchanged ${file}`);
      } else if (entry) {
        const remote = await request(cfg, "GET", pagePath(slug));
        if (Number(remote.updated) > Number(entry.updated)) {
          bad++;
          out(`conflict  ${file} (remote changed since last pull; pull or merge manually)`);
          continue;
        }
        try {
          await request(cfg, "PUT", pagePath(slug), { body: { markdown: content, expectedUpdated: Number(entry.updated) } });
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 409) throw err;
          bad++;
          out(`conflict  ${file} (remote changed while pushing; pull or merge manually)`);
          continue;
        }
        await refresh(cfg, dir, state, slug);
        out(`updated   ${file}`);
      } else {
        const created = await request(cfg, "POST", "/api/v1/pages", { body: { markdown: content } });
        const newSlug = created.slug;
        if (newSlug !== slug && existsSync(join(dir, `${newSlug}.md`))) {
          throw new Error(`created as ${newSlug} but ${newSlug}.md already exists locally`);
        }
        await refresh(cfg, dir, state, newSlug);
        if (newSlug !== slug) await unlink(join(dir, file));
        out(newSlug === slug ? `created   ${file}` : `created   ${file} -> ${newSlug}.md`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await saveState(dir, state);
        throw err;
      }
      bad++;
      out(`error     ${file} (${err.message})`);
    }
  }
  await saveState(dir, state);
  return bad ? 1 : 0;
}
