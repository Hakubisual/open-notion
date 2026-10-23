import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cloudPage } from "../local/cloud-page";

const ROOT = join(import.meta.dir, "..");
const dict = (lang: string) => JSON.parse(readFileSync(join(ROOT, "assets", "i18n", "app-" + lang + ".json"), "utf8")) as Record<string, string>;

// The self-host edition has no hosted cloud unless ACARD_CLOUD_URL names one.
test("the cloud is off by default", () => {
  const host = readFileSync(join(ROOT, "local/cloud-host.ts"), "utf8");
  expect(host).toContain('process.env.ACARD_CLOUD_URL ?? ""');
  expect(host).toContain("Set ACARD_CLOUD_URL to a hosted Acard to publish and back up there.");
});

test("the My data page hides the account section while the cloud is off and shows both agent commands", async () => {
  const html = await cloudPage().text();
  expect(html).toContain('<section id="account" hidden>');
  for (const id of ["publish", "sync", "cloud"]) expect(html).toContain('<section id="' + id + '" hidden>');
  expect(html).toContain('if (!s.enabled) { $("account").hidden = true;');
  expect(html).toContain('$("account").hidden = false;');
  expect(html).not.toContain('$("state").textContent = "꺼짐"');
  expect(html).toContain('id="mcp-cmd"');
  expect(html).toContain('id="mcp-cmd-codex"');
  expect(html).toContain('"claude mcp add --transport http acard " + location.origin + "/mcp"');
  expect(html).toContain('"codex mcp add acard --url " + location.origin + "/mcp"');
});

test("the page's headings and buttons have English and Chinese entries", async () => {
  const html = await cloudPage().text();
  const headings = [...html.matchAll(/<h[12]>([^<]+)/g)].map((m) => m[1].trim());
  expect(headings.length).toBeGreaterThan(5);
  const keys = [...headings, "백업 파일 내려받기", "백업 파일로 복원…", "자동 백업 확인 중…", "← 내 페이지로", "내 데이터 · Acard"];
  for (const lang of ["en", "zh"]) {
    const d = dict(lang);
    for (const key of keys) expect([lang, key, Boolean(d[key])]).toEqual([lang, key, true]);
  }
  expect(dict("en")["내 데이터"]).toBe("My data");
  expect(dict("en")["백업 파일"]).toBe("Backup file");
});
