// Image upload for outside agents: POST /api/v1/media and MCP upload_media. The token needs write scope on the page
// the image is for (narrowed per page like every other v1 write); the worker's storeImage keeps png/jpeg/webp/gif only.
(() => {
  const MAX_BASE64 = Math.ceil((4 * 1024 * 1024) / 3) * 4 + 4;

  function decodeBase64(text) {
    const clean = String(text || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (!clean || clean.length > MAX_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  async function pageFor(db, principal, helpers, slug) {
    if (!slug && principal.scopes.includes("write")) return null;
    const scoped = helpers.services && helpers.services.agentScopes && slug ? await helpers.services.agentScopes(db, principal, String(slug)) : principal.scopes;
    if (!scoped.includes("write")) throw Object.assign(new Error("이 토큰에는 쓰기 권한이 없어요."), { status: 403 });
    const found = await helpers.readPage(db, String(slug || ""));
    if (!found) throw Object.assign(new Error("없는 페이지예요. page 에 이미지를 넣을 페이지 슬러그를 주세요."), { status: 404 });
    return found.page.slug;
  }

  async function uploadMedia(db, principal, helpers, input) {
    const page = await pageFor(db, principal, helpers, input.page);
    const bytes = decodeBase64(input.data);
    if (!bytes) throw Object.assign(new Error("data 는 4MB 이하 이미지의 base64 여야 해요."), { status: 400 });
    return helpers.storeImage(page, input.name, input.mime, bytes);
  }

  registerFeature({
    services: { mcpTools: [{ name: "upload_media", description: "Upload one image (png, jpeg, webp, gif or svg; SVG scripts are stripped; max 4 MB) for a page you can write. data is base64. Use it for LOCAL files (paths like ./x.png or C:\\...): the server cannot read your disk. http(s) and data: images in markdown are imported automatically. Returns url and a markdown image line to insert with insert_blocks or append_to_page; always give it a Korean caption.",
      scope: "write", operation: "uploadMedia", inputSchema: (z) => ({ page: z.string().describe("Slug of the page the image is for."), name: z.string().optional(), mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]).optional(), data: z.string().describe("Base64 image bytes (a data: URL prefix is allowed).") }) }] },
    agentOps: { uploadMedia },
    agentApi: async ({ path, method, request, db, principal, helpers, storeImage }) => {
      helpers = { ...helpers, services: ACARD_FEATURES.services };
      if (path !== "/api/v1/media") return null;
      if (method !== "POST") return helpers.json({ error: "지원하지 않는 방법이에요." }, 405);
      try {
        const type = request.headers.get("content-type") || "";
        let page, name, mime, bytes;
        if (/^multipart\/form-data/i.test(type)) {
          const form = await request.formData();
          const file = form.get("file");
          if (!file || typeof file === "string") return helpers.json({ error: "file 이 필요해요." }, 400);
          page = form.get("page"); name = file.name; mime = form.get("mime") || file.type; bytes = await file.arrayBuffer();
        } else {
          const url = new URL(request.url);
          page = url.searchParams.get("page"); name = url.searchParams.get("name"); mime = type; bytes = await request.arrayBuffer();
        }
        const length = Number(request.headers.get("content-length") || 0);
        if (length > 4 * 1024 * 1024 + 64 * 1024) return helpers.json({ error: "파일이 너무 커요. 최대 4MB 까지 올릴 수 있어요." }, 413);
        const slug = await pageFor(db, principal, helpers, page);
        return helpers.json(await storeImage(slug, name, mime, bytes), 201);
      } catch (error) {
        return helpers.json({ error: String(error.message || error) }, error.status || 500);
      }
    },
  });
})();
