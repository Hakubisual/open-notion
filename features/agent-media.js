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

  // attach_images / attach_video (#33): images the agent looked at go right under the paragraph they support, each with
  // a caption (what the agent saw), marked as agent-attached; several images (video keyframes) share one row. Nothing is
  // uploaded unless the agent calls this (or writes the image into markdown) for a page it can write.
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const TIME = /^\d{1,2}(?::\d{2}){1,2}$/;
  const LOCAL = /^(?:file:|pasted:|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?:Users|home|tmp|var|private|mnt|root|Volumes)\/)/;
  const clipText = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
  async function resolveImage(db, helpers, page, item) {
    if (item.data) {
      const bytes = decodeBase64(item.data);
      if (!bytes) throw fail("data 는 4MB 이하 이미지의 base64 여야 해요.");
      return (await helpers.storeImage(page, item.name || "image", null, bytes)).url;
    }
    const src = String(item.src || "").trim();
    if (!src) throw fail("이미지마다 src(/media/, http(s), data:) 나 data(base64) 가 필요해요.");
    if (LOCAL.test(src)) throw fail("로컬 파일" + (src.startsWith("pasted:") ? "(붙여 넣은 이미지)" : "") + "은 서버가 읽을 수 없어요. acard CLI(acard mcp 또는 acard hooks install)가 먼저 올려 주거나, data 에 base64 로 보내 주세요: " + src.slice(0, 120));
    const probe = [{ type: "image", text: "", meta: { src } }];
    const warnings = helpers.ingestImages ? await helpers.ingestImages(db, page, probe) : [];
    if (!/^\/media\/[0-9a-f]{16}$/.test(probe[0].meta.src)) throw fail("이미지를 가져오지 못했어요: " + (warnings[0] ? warnings[0].error : src.slice(0, 120)));
    return probe[0].meta.src;
  }

  async function attachImages(db, principal, helpers, input) {
    const page = await pageFor(db, principal, helpers, String(input.page || ""));
    if (!page) throw fail("page 에 이미지를 붙일 페이지 슬러그를 주세요.");
    const list = Array.isArray(input.images) ? input.images : [];
    if (!list.length || list.length > 8) throw fail("images 는 1~8개여야 해요.");
    for (const item of list) if (!clipText(item && item.caption, 300)) throw fail("이미지마다 caption(무엇이 보이는지 한 문장)이 필요해요.");
    const found = await helpers.readPage(db, page);
    const blocks = found.blocks.slice();
    let at = blocks.length, indent = 0;
    if (input.after_block_id) {
      const index = blocks.findIndex((block) => block.id === input.after_block_id);
      if (index < 0) throw fail("없는 블록이에요. read_blocks 로 블록 ID 를 확인하세요.", 404);
      indent = blocks[index].indent || 0;
      at = index + 1;
      while (at < blocks.length && (blocks[at].indent || 0) > indent) at += 1;
    }
    const group = list.length > 1 ? "g" + Math.random().toString(36).slice(2, 8) : null;
    const images = [];
    for (const item of list) {
      const src = await resolveImage(db, helpers, page, item);
      const time = TIME.test(String(item.time || "")) ? String(item.time) : undefined;
      images.push({ src, caption: clipText(item.caption, 300), ...(time ? { time } : {}) });
    }
    const added = images.map((image) => ({ id: "a" + crypto.randomUUID(), type: "image", text: image.caption, indent, checked: false,
      meta: { src: image.src, width: 100, agent: true, ...(image.time ? { time: image.time } : {}), ...(group ? { group } : {}) } }));
    let video = null;
    if (input.video && typeof input.video === "object") {
      const vsrc = String(input.video.src || "");
      if (!/^\/media\/[0-9a-f]{16}$/.test(vsrc)) throw fail("video.src 는 올린 영상의 /media/ 주소여야 해요.");
      video = { src: vsrc, name: clipText(input.video.name || "영상", 120) };
      await db.prepare("UPDATE media SET page = ? WHERE id = ? AND page IS NULL").bind(page, vsrc.slice(7)).run().catch(() => {});
      added.push({ id: "a" + crypto.randomUUID(), type: "file", text: "영상 파일 열기 (" + video.name + ")", indent, checked: false, meta: { url: vsrc, name: video.name } });
    }
    if (blocks.length + added.length > 2000) throw fail("페이지에는 블록을 2000개까지 넣을 수 있어요.", 413);
    blocks.splice(at, 0, ...added);
    const version = Math.max(Date.now(), Number(found.page.updated) + 1);
    await helpers.captureEditorVersion(db, page);
    await helpers.saveBlocks(db, page, blocks);
    await db.prepare("UPDATE pages SET updated = ?, source = 'editor', hash = NULL WHERE slug = ?").bind(version, page).run();
    await db.prepare("INSERT INTO agent_activity (id, page, agent, via, action, created) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), page, principal.name, principal.via, "attach-images", version).run();
    const journal = ACARD_FEATURES.services.journalAttach;
    const noted = journal ? await journal(db, principal, helpers, { page, title: found.page.title, images, video }).catch(() => null) : null;
    return { page, url: "/" + encodeURIComponent(page) + "/", version, block_ids: added.map((block) => block.id), images, ...(video ? { video } : {}), ...(noted ? { journal: noted } : {}) };
  }

  // Server side of attach_video: the acard CLI (bridge or hook) runs ffmpeg on the user's machine, fills frames with the
  // extracted keyframes and, when the user allowed it, uploads the file and sets video. A client without the CLI gets a
  // clear message instead of a silent text-only note.
  async function attachVideo(db, principal, helpers, input) {
    const frames = Array.isArray(input.frames) ? input.frames : [];
    if (!frames.length) {
      throw fail(input.note ? "영상 키프레임을 뽑지 못했어요: " + clipText(input.note, 300) : "로컬 영상은 사용자 PC 의 acard CLI(acard mcp 또는 acard hooks install)가 ffmpeg 로 키프레임을 뽑아 붙여요. CLI 가 없으면 영상에서 본 장면을 이미지로 저장해 attach_images 로 붙이세요.", 400);
    }
    const caption = clipText(input.caption, 200);
    const images = frames.slice(0, 6).map((frame, i) => ({ src: frame.src, data: frame.data, name: frame.name || "frame-" + (i + 1) + ".jpg", time: frame.time,
      caption: clipText(frame.caption, 300) || (caption ? caption + (frame.time ? " · " + frame.time : "") : "") }));
    const out = await attachImages(db, principal, helpers, { page: input.page, after_block_id: input.after_block_id, images, video: input.video });
    return { ...out, ...(input.note ? { note: clipText(input.note, 300) } : {}) };
  }

  const imageItem = (z) => z.object({
    src: z.string().optional().describe("Local path (C:\\...\\shot.png, ./shot.png), 'pasted:1' for the newest image the user pasted in this chat (2 = the one before), a /media/ url, http(s) or data: url."),
    data: z.string().optional().describe("Base64 image bytes instead of src."),
    name: z.string().optional(),
    caption: z.string().describe("Required. One Korean sentence saying what is visible in the image and why it matters, e.g. '비밀번호 입력 후 오류 토스트가 입력창을 가림'."),
    time: z.string().optional().describe("Video time of a frame, m:ss."),
  });

  registerFeature({
    services: { mcpTools: [{ name: "upload_media", description: "Upload one image (png, jpeg, webp, gif or svg; SVG scripts are stripped; max 4 MB) for a page you can write. data is base64. Use it for LOCAL files (paths like ./x.png or C:\\...): the server cannot read your disk. http(s) and data: images in markdown are imported automatically. Returns url and a markdown image line to insert with insert_blocks or append_to_page; always give it a Korean caption.",
      scope: "write", operation: "uploadMedia", inputSchema: (z) => ({ page: z.string().describe("Slug of the page the image is for."), name: z.string().optional(), mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]).optional(), data: z.string().describe("Base64 image bytes (a data: URL prefix is allowed).") }) },
    { name: "attach_images", scope: "write", operation: "attachImages",
      description: "When you LOOKED AT an image while working (a screenshot or image file you opened, an image the user pasted, a frame of a video) and it supports what you write in a page, attach it there instead of only describing it in text. Put it right after the paragraph it supports (after_block_id from read_blocks; omitted = end of page). Every image needs a caption: what you saw in it, in one Korean sentence; the paragraph above should summarize what the images show. Several images in one call sit in one row. Local paths and 'pasted:N' are uploaded by the acard CLI bridge/hook on the user's machine; only what you attach is uploaded. The image is also added to your work journal (and project 메모) as a thumbnail.",
      inputSchema: (z) => ({ page: z.string().describe("Slug of the page."), after_block_id: z.string().optional().describe("Block id the images belong to (read_blocks). Omit to add at the end."), images: z.array(imageItem(z)).describe("1-8 images, each with a caption.") }) },
    { name: "attach_video", scope: "write", operation: "attachVideo",
      description: "When you looked at a VIDEO file (screen recording, clip) put 3-6 keyframes from it into the page, each with its timestamp, right after the paragraph that describes what happens in the video. Give path (local video file); the acard CLI on the user's machine extracts the frames with ffmpeg (no server transcoding) and fills frames. Set upload_video true only if the user allowed uploading the video file itself (max 4 MB); then the page also links the file. Write a caption per frame (frames[].caption) or one caption for all.",
      inputSchema: (z) => ({ page: z.string(), path: z.string().optional().describe("Local video file path."), count: z.number().int().min(3).max(6).optional().describe("Keyframes to extract, 3-6 (default 4)."), upload_video: z.boolean().optional(), after_block_id: z.string().optional(), caption: z.string().optional(), captions: z.array(z.string()).optional().describe("One caption per frame, in order."),
        frames: z.array(imageItem(z).extend({ caption: z.string().optional() })).optional().describe("Filled by the acard CLI; set yourself only with already uploaded /media/ frames."),
        video: z.object({ src: z.string(), name: z.string().optional() }).optional().describe("Filled by the acard CLI when upload_video is true."), note: z.string().optional() }) }] },
    agentOps: { uploadMedia, attachImages, attachVideo },
    agentApi: async ({ path, method, request, db, principal, helpers, storeImage, storeVideo }) => {
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
        if (/^video\//i.test(String(mime || "")) && storeVideo) return helpers.json(await storeVideo(slug, name, bytes), 201);
        return helpers.json(await storeImage(slug, name, mime, bytes), 201);
      } catch (error) {
        return helpers.json({ error: String(error.message || error) }, error.status || 500);
      }
    },
  });
})();
