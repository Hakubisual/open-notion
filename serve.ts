import { join } from "node:path";
const DIST = join(import.meta.dir, "dist");
const PORT = Number(process.env.PORT || 4173);
Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = Bun.file(join(DIST, p));
    if (!(await file.exists())) file = Bun.file(join(DIST, "404.html"));
    return new Response(file);
  }
});
console.log("PREVIEW_READY http://127.0.0.1:" + PORT);
