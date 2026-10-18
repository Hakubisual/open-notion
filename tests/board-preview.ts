import { resolve, sep } from "node:path";
import { cookie, setup } from "./db-harness";

// 로컬 브라우저 검증 전용: 실제 워커와 SQLite, 빌드된 정적 파일을 함께 제공한다.
// 실행: bun tests/board-preview.ts (기본 포트 4194, 메모리 DB 는 재시작하면 초기화된다).
const dist = resolve(import.meta.dir, "../dist");
// Bun에는 Cloudflare의 기반 클래스가 없다. 이 미리보기의 티켓/페이지/DB 경로는
// OAuth SDK의 WorkerEntrypoint 핸들러를 쓰지 않고 실제 빌드 워커로 그대로 전달된다.
const builtSource = await Bun.file(resolve(dist, "_worker.js")).text();
const localSource = builtSource.replace('import { WorkerEntrypoint } from "cloudflare:workers";', "class WorkerEntrypoint {}");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(localSource).toString("base64"));
const preview = setup({
  worker,
  assetFetch: async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const path = resolve(dist, "." + pathname);
    if (path !== dist && !path.startsWith(dist + sep)) return new Response("Not found", { status: 404 });
    const file = Bun.file(pathname.endsWith("/") ? resolve(path, "index.html") : path);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const headers = { "content-type": file.type, etag: '"' + file.size + "-" + file.lastModified + '"' };
    return new Response(request.method === "HEAD" ? null : file, { headers });
  },
});

const seeded = await preview.call("POST", "/api/sync");
if (seeded.status !== 200) throw new Error("Preview seed failed: " + JSON.stringify(seeded.data));
const board = await preview.call("GET", "/api/db/board");
if (board.status !== 200) throw new Error("Build dist with the board seed before starting the preview.");

const auth = await cookie();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 4194),
  fetch(request) {
    const headers = new Headers(request.headers);
    // ?anonymous=1 또는 헤더로 게이트 자체도 검증할 수 있다.
    if (new URL(request.url).searchParams.get("anonymous") === "1" || headers.get("x-preview-anonymous") === "1") headers.delete("cookie");
    else headers.set("cookie", auth);
    return preview.worker.fetch(new Request(request, { headers }), preview.env);
  },
});
console.log("BOARD_PREVIEW_READY " + server.url + "board/ (" + board.data.rows.length + " rows)");
