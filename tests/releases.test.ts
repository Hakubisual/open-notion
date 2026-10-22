import { expect, test } from "bun:test";
import { releaseRoute, withReleaseInfo } from "../gate/releases";

const config = { repo: "example/releases", win: { version: "0.1.1", date: "2026-10-22" } };
const get = (path: string, fetcher: typeof fetch = fetch) => releaseRoute(new Request("https://notes.example.com" + path), path, config, fetcher);
const asset = (version: string, file: string) => `https://github.com/example/releases/releases/download/v${version}/${file}`;

test("download buttons redirect to the current installer, and a platform without a build goes back to the page", async () => {
  const win = await get("/download/windows");
  expect(win!.status).toBe(302);
  expect(win!.headers.get("location")).toBe(asset("0.1.1", "Acard-0.1.1-win-x64.exe"));
  expect((await get("/download/mac-arm64"))!.headers.get("location")).toBe("/download");
  expect((await get("/download/linux"))!.status).toBe(404);
});

test("the update feed serves the current version's latest.yml and the files it names redirect to that version", async () => {
  const seen: string[] = [];
  const fetcher = (async (url: string) => {
    seen.push(url);
    return new Response("version: 0.1.1\npath: Acard-0.1.1-win-x64.exe\n");
  }) as unknown as typeof fetch;
  const feed = await get("/releases/win/latest.yml", fetcher);
  expect(feed!.status).toBe(200);
  expect(await feed!.text()).toContain("version: 0.1.1");
  expect(seen).toEqual([asset("0.1.1", "latest.yml")]);
  expect((await get("/releases/win/Acard-0.1.1-win-x64.exe.blockmap"))!.headers.get("location")).toBe(asset("0.1.1", "Acard-0.1.1-win-x64.exe.blockmap"));
  expect((await get("/releases/mac/latest-mac.yml", fetcher))!.status).toBe(404);
  expect((await get("/releases/win/..%2Fsecret"))!.status).toBe(404);
  expect(await get("/releasesx/win/latest.yml")).toBeNull();
});

test("the download page shows the version of a published platform and the pending note of the other", async () => {
  const html = '<p><span data-release-version="win">-</span><a data-release-ready="win">dl</a><i data-release-pending="win">soon</i>'
    + '<span data-release-version="mac">-</span><a data-release-ready="mac">mac</a><i data-release-pending="mac">mac soon</i></p>';
  const out = await withReleaseInfo(new Response(html, { headers: { "content-type": "text/html" } }), config).text();
  expect(out).toBe('<p><span data-release-version="win">0.1.1</span><a data-release-ready="win">dl</a><span data-release-version="mac">-</span><i data-release-pending="mac">mac soon</i></p>');
});
