// Full workspace export that imports back the same (issue 133): acard-export.json (pages, databases with their
// properties and rows, media), one lossless acard-md file per page in its folder path, files/<media id>-<name> for every
// image or file a page uses, a csv per database for other apps, and index.md. import-acard.ts reads it back. Select /
// status / multi-select values are written as option names and relation values as the row pages' slugs, so the
// importer can map them to the new workspace's ids.
(() => {
  const EXZ_MEDIA_LIMIT = 250 * 1000 * 1000;
  const exzText = new TextEncoder();

  let exzCrcTable = null;
  function exzCrc(bytes) {
    if (!exzCrcTable) {
      exzCrcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; exzCrcTable[n] = c >>> 0; }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = exzCrcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  // Stored (uncompressed) zip written as a stream: each entry's bytes are dropped once sent, so at most one media file
  // sits in memory (a workspace's media can be far bigger than the Worker isolate). next() returns the next
  // { name, data } or null; the central directory goes out last.
  function exzZipStream(next) {
    const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
    const entries = [];
    let pos = 0;
    return new ReadableStream({
      async pull(controller) {
        const f = await next();
        if (f) {
          const name = exzText.encode(f.name);
          const e = { name, crc: exzCrc(f.data), size: f.data.length, offset: pos };
          const head = new Uint8Array(30 + name.length);
          const v = new DataView(head.buffer);
          v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
          v.setUint16(12, dosDate, true); v.setUint32(14, e.crc, true); v.setUint32(18, e.size, true); v.setUint32(22, e.size, true);
          v.setUint16(26, name.length, true); head.set(name, 30);
          entries.push(e);
          controller.enqueue(head);
          if (e.size) controller.enqueue(f.data);
          pos += head.length + e.size;
          return;
        }
        let total = 22;
        for (const e of entries) total += 46 + e.name.length;
        const out = new Uint8Array(total);
        const v = new DataView(out.buffer);
        let at = 0;
        for (const e of entries) {
          v.setUint32(at, 0x02014b50, true); v.setUint16(at + 4, 20, true); v.setUint16(at + 6, 20, true); v.setUint16(at + 8, 0x0800, true);
          v.setUint16(at + 14, dosDate, true); v.setUint32(at + 16, e.crc, true); v.setUint32(at + 20, e.size, true); v.setUint32(at + 24, e.size, true);
          v.setUint16(at + 28, e.name.length, true); v.setUint32(at + 42, e.offset, true); at += 46; out.set(e.name, at); at += e.name.length;
        }
        v.setUint32(at, 0x06054b50, true); v.setUint16(at + 8, entries.length, true); v.setUint16(at + 10, entries.length, true);
        v.setUint32(at + 12, at, true); v.setUint32(at + 16, pos, true);
        controller.enqueue(out);
        controller.close();
      },
    });
  }
  const exzSafe = (name) => String(name || "file").replace(/[\u0000-\u001f\u007f"\\/:*?<>|\s()[\]#%]+/g, "_").slice(0, 80) || "file";
  const exzCsvCell = (value) => { const s = String(value ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  async function exportZip(db, env) {
    const folders = new Set((((await db.prepare("SELECT page FROM page_view WHERE mode = 'folder'").all().catch(() => null)) || {}).results ?? []).map((r) => String(r.page)));
    const rows = (await db.prepare("SELECT p.slug, p.title, p.parent, p.kind, p.ord, s.icon FROM pages p LEFT JOIN editor_page_settings s ON s.page = p.slug WHERE NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = p.slug) ORDER BY p.ord, p.slug").all()).results ?? [];
    if (!rows.length) return json({ error: "내보낼 페이지가 없어요." }, 404);
    const meta = ACARD_FEATURES.services.folderExportMeta ? await ACARD_FEATURES.services.folderExportMeta(db) : { pathOf: () => "", tagsOf: () => [] };
    const live = new Set(rows.map((r) => String(r.slug)));
    const pageFile = (slug) => { const dir = meta.pathOf(slug); return (dir ? dir + "/" : "") + exzSafe(slug) + ".md"; };
    const mediaRows = (await db.prepare("SELECT id, page, name, mime, bytes FROM media").all()).results ?? [];
    const mediaById = new Map(mediaRows.map((m) => [String(m.id), m]));
    const used = new Map();
    const unknown = new Set();
    const files = [];
    const pages = [];
    for (const row of rows) {
      const slug = String(row.slug);
      const found = await readPage(db, slug);
      if (!found) continue;
      const file = pageFile(slug);
      const up = "../".repeat(file.split("/").length - 1);
      const blocks = globalThis.AiMarks.stripMarks(found.blocks).map((b) => {
        if (!b.meta) return b;
        const next = { ...b, meta: { ...b.meta } };
        for (const field of ["src", "url"]) {
          const m = /^\/media\/([0-9a-f]{16})/.exec(String(next.meta[field] || ""));
          if (m && mediaById.has(m[1])) {
            const target = "files/" + m[1] + "-" + exzSafe(mediaById.get(m[1]).name);
            used.set(m[1], target);
            next.meta[field] = up + target;
          } else if (m) unknown.add(m[1]);
        }
        return next;
      });
      const tags = meta.tagsOf(slug);
      const text = acardMarkdown(String(row.title || slug), blocks).replace(/^(---\n[\s\S]*?acard_meta: 1)\n/, (all, head) => (tags.length ? head + "\ntags: [" + tags.map((t) => JSON.stringify(t)).join(", ") + "]\n" : all));
      files.push({ name: file, data: exzText.encode(text) });
      pages.push({ slug, title: String(row.title || slug), parent: row.parent && live.has(String(row.parent)) ? String(row.parent) : null, kind: row.kind === "note" && folders.has(slug) ? "folder" : String(row.kind || "note"), file, tags: meta.tagsOf(slug), ...(row.icon ? { icon: String(row.icon) } : {}) });
    }
    const databases = [];
    const dbRows = (await db.prepare("SELECT slug FROM databases ORDER BY ord, slug").all()).results ?? [];
    for (const d of dbRows) {
      const slug = String(d.slug);
      if (!live.has(slug)) continue;
      const found = await readDatabase(db, slug);
      if (!found) continue;
      const rowSlugById = new Map(found.rows.map((r) => [String(r.id), r.page ? String(r.page) : ""]));
      const props = found.properties.map((p) => ({ id: String(p.id).replace(/^[^_]+_/, ""), name: p.name, type: p.type, config: p.config }));
      const optionName = (prop, id) => ((prop.config && prop.config.options) || []).find((o) => o.id === id)?.name ?? null;
      const outRows = [];
      for (const r of found.rows) {
        if (!r.page || !live.has(String(r.page))) continue;
        const values = {};
        found.properties.forEach((prop, i) => {
          let value = r.props ? r.props[prop.id] : undefined;
          if (value === undefined) return;
          if (prop.type === "select" || prop.type === "status") value = value ? optionName(prop, value) : null;
          else if (prop.type === "multi_select") value = (Array.isArray(value) ? value : []).map((id) => optionName(prop, id)).filter(Boolean);
          else if (prop.type === "relation") value = (Array.isArray(value) ? value : []).map((id) => rowSlugById.get(String(id))).filter((s) => s && live.has(s));
          values[props[i].id] = value;
        });
        outRows.push({ page: String(r.page), values });
      }
      databases.push({ slug, title: found.database.title, parent: found.database.parent && live.has(String(found.database.parent)) ? String(found.database.parent) : null, properties: props, rows: outRows });
      const header = found.properties.map((p) => p.name);
      const titleOf = new Map(pages.map((pg) => [pg.slug, pg.title]));
      const lines = [header.map(exzCsvCell).join(",")].concat(outRows.map((r) => props.map((p) => {
        const v = r.values[p.id];
        if (v === null || v === undefined) return "";
        if (typeof v === "boolean") return v ? "Yes" : "No";
        if (Array.isArray(v)) return exzCsvCell((p.type === "relation" ? v.map((s) => titleOf.get(s) || s) : v).join(", "));
        if (typeof v === "object" && v.start) return exzCsvCell(v.end ? v.start + " → " + v.end : v.start);
        return exzCsvCell(v);
      }).join(",")));
      const dir = meta.pathOf(slug);
      files.push({ name: (dir ? dir + "/" : "") + exzSafe(slug) + ".csv", data: exzText.encode(lines.join("\n") + "\n") });
    }
    const store = env && env[MEDIA_BINDING];
    const missing = [...unknown].sort();
    let bytes = 0;
    for (const id of used.keys()) bytes += Number(mediaById.get(id).bytes) || 0;
    if (bytes > EXZ_MEDIA_LIMIT) return json({ code: "too-big", error: "이미지와 파일이 모두 250MB보다 많아서 한 번에 내려받을 수 없어요. 큰 파일이 있는 페이지를 하나씩 내보내 주세요." }, 413);
    // Pages and csv files first, then each media file read from the store as it is written, then the manifest (which
    // lists the media actually found) and the table of contents.
    async function* entries() {
      yield* files;
      const media = [];
      for (const [id, file] of used) {
        const row = mediaById.get(id);
        const found = store ? await store.getWithMetadata("media/" + id, { type: "arrayBuffer" }).catch(() => null) : null;
        if (!found || !found.value) { missing.push(id); continue; }
        media.push({ id, name: String(row.name || "file"), mime: String(row.mime || ""), file });
        yield { name: file, data: new Uint8Array(found.value) };
      }
      const manifest = { format: "acard-export", version: 1, pages, databases, media, ...(missing.length ? { missingMedia: missing.sort() } : {}) };
      yield { name: "acard-export.json", data: exzText.encode(JSON.stringify(manifest, null, 1)) };
      yield { name: "index.md", data: exzText.encode("# 목차\n\n" + pages.filter((p) => p.kind !== "db_row").map((p) => "- [" + p.title.replace(/[\]\n]/g, " ") + "](./" + p.file + ")").join("\n") + "\n") };
    }
    const it = entries();
    return new Response(exzZipStream(async () => (await it.next()).value || null), {
      headers: { "content-type": "application/zip", "content-disposition": exportFilename("acard", "zip"), "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
    });
  }

  registerFeature({ services: { exportZip } });
})();
