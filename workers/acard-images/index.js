// Only reachable through a service binding; Pages owns authorization and caching.
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    const width = Number(new URL(request.url).searchParams.get("w"));
    if (!Number.isInteger(width) || width < 1 || width > 1600 || !request.body) return new Response("Invalid image request", { status: 400 });
    return (await env.IMAGES.input(request.body)
      .transform({ width, fit: "scale-down" })
      .output({ format: "image/webp" })).response();
  },
};
