// Image variants for shared pages (#61). Pages Functions cannot hold an Images binding, so the app sends original bytes
// here over a service binding. No public route (workers_dev off, no routes): only the bound app reaches it.
//   POST /resize?w=<px>&f=<avif|webp|jpeg|png>  body = image bytes -> the variant
//   POST /meta                                  body = image bytes -> { width, height, format, lqip } (lqip: 24 px webp data URL)
const FORMATS = { avif: "image/avif", webp: "image/webp", jpeg: "image/jpeg", png: "image/png" };

function streamOf(bytes) {
  return new Response(bytes).body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || !request.body) return new Response("not found", { status: 404 });
    if (!env.IMAGES) return new Response("images binding missing", { status: 503 });
    try {
      if (url.pathname === "/meta") {
        const bytes = await request.arrayBuffer();
        const info = await env.IMAGES.info(streamOf(bytes));
        if (!info || !info.width || !info.height) return Response.json({ error: "no dimensions" }, { status: 422 });
        const tiny = await (await env.IMAGES.input(streamOf(bytes)).transform({ width: 24, fit: "scale-down" }).output({ format: "image/webp", quality: 40 })).response().arrayBuffer();
        let binary = "";
        for (const b of new Uint8Array(tiny)) binary += String.fromCharCode(b);
        return Response.json({ width: info.width, height: info.height, format: info.format, lqip: "data:image/webp;base64," + btoa(binary) });
      }
      if (url.pathname !== "/resize") return new Response("not found", { status: 404 });
      const width = Number(url.searchParams.get("w"));
      const format = FORMATS[url.searchParams.get("f") ?? ""];
      if (!Number.isInteger(width) || width < 16 || width > 2400 || !format) return new Response("bad request", { status: 400 });
      const result = await env.IMAGES.input(request.body)
        .transform({ width, fit: "scale-down" })
        .output({ format, quality: format === "image/avif" ? 60 : 78 });
      return result.response();
    } catch (error) {
      return new Response("transform failed: " + String(error && error.message ? error.message : error).slice(0, 200), { status: 422 });
    }
  },
};
