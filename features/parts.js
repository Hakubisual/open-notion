// Parts (#38): registered parts + data. A page keeps a part as ```acard-part {"part":"<id>","v":N} + JSON data (block type
// "part"); the code that draws it lives in part-html.js (five defaults, shipped as /lazy/parts.js) or in this workspace's
// parts table (registered from an HTML block). Agents fill parts with data only: list_parts shows every part with its
// data schema, set_part_data validates the data and writes it through humanGuard (#36), so a part a person edited
// keeps the person's data and the agent's becomes an update suggestion. Sharing: shared=1 lets a public link read the
// part (GET /p/<token>/acard-part.json), public=1 marks it for the future gallery (owner screen pending).
(() => {
  const schema = [
    "CREATE TABLE IF NOT EXISTS parts (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, code TEXT NOT NULL, schema TEXT NOT NULL DEFAULT '{}', sample TEXT NOT NULL DEFAULT '{}', owner TEXT NOT NULL DEFAULT '', shared INTEGER NOT NULL DEFAULT 0, public INTEGER NOT NULL DEFAULT 0, token_hash TEXT NULL, source TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '')",
    "CREATE UNIQUE INDEX IF NOT EXISTS parts_token ON parts(token_hash)",
    "CREATE TABLE IF NOT EXISTS part_themes (id TEXT PRIMARY KEY, name TEXT NOT NULL, light TEXT NULL, dark TEXT NULL, owner TEXT NOT NULL DEFAULT '', shared INTEGER NOT NULL DEFAULT 0, public INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0)",
  ];
  const PUBLIC_HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...PUBLIC_HEADERS, "content-type": "application/json; charset=utf-8" } });
  const sha = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };

  function rowOut(row, withCode) {
    return { id: row.id, name: row.name, description: String(row.description || ""), version: Number(row.version), schema: parse(row.schema, {}), sample: parse(row.sample, {}), owner: row.owner,
      shared: Number(row.shared) === 1, public: Number(row.public) === 1, created: Number(row.created), updated: Number(row.updated),
      ...(row.source ? { source: row.source } : {}), ...(withCode ? { code: row.code } : {}) };
  }

  async function workspaceParts(db) {
    const rows = await db.prepare("SELECT * FROM parts ORDER BY created, id").all();
    return rows.results ?? [];
  }

  async function findPart(db, id) {
    if (PART_DEFAULT_IDS.has(id)) { const d = PART_DEFAULTS.find((p) => p.id === id); return { ...d, builtin: true }; }
    const row = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first();
    return row ? { ...rowOut(row, false), builtin: false } : null;
  }

  function guessSchema(value, depth = 0) {
    if (Array.isArray(value)) return { type: "array", maxItems: 500, ...(value.length && depth < 6 ? { items: guessSchema(value[0], depth + 1) } : {}) };
    if (value === null) return {};
    if (typeof value === "object") {
      const properties = {};
      if (depth < 6) for (const [key, v] of Object.entries(value)) properties[key] = guessSchema(v, depth + 1);
      return { type: "object", properties };
    }
    if (typeof value === "number") return { type: ["number", "null"] };
    if (typeof value === "string") return { type: "string", maxLength: 2000 };
    if (typeof value === "boolean") return { type: "boolean" };
    return {};
  }

  function cleanId(raw) {
    const id = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (!PART_ID.test(id)) throw new AgentError("부품 id 는 영문 소문자로 시작하는 2-40자(a-z, 0-9, -)여야 해요.");
    if (PART_DEFAULT_IDS.has(id)) throw new AgentError("기본 부품과 같은 id 예요. 다른 id 를 써 주세요.", 409);
    return id;
  }

  // POST /api/parts {id, name, page, block} registers the code of an HTML block on that page (or {code}); the block's
  // window.acardPartData reads the data. Re-registering the same id from the same owner bumps the version.
  async function register(db, helpers, body, owner) {
    const id = cleanId(body.id);
    const name = String(body.name || id).trim().slice(0, 60) || id;
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 200) : null;
    let code = typeof body.code === "string" ? body.code : null, source = "";
    if (code === null) {
      if (typeof body.page !== "string" || typeof body.block !== "string") throw new AgentError("page 와 block(HTML 블록 id), 또는 code 를 보내 주세요.");
      const slug = helpers.resolveSlug(body.page);
      const found = await helpers.readPage(db, slug);
      const block = found && found.blocks.find((b) => b.id === body.block);
      if (!block) throw new AgentError("없는 블록이에요.", 404);
      if (block.type !== "html" && block.type !== "visual") throw new AgentError("HTML 블록만 부품으로 등록할 수 있어요.");
      code = String(block.text || "");
      source = slug + "#" + block.id;
    }
    if (!code.trim()) throw new AgentError("부품 코드가 비었어요.");
    if (new TextEncoder().encode(code).length > PART_MAX_BYTES) throw new AgentError("부품 코드는 64KB 까지예요.", 413);
    const sample = body.sample && typeof body.sample === "object" && !Array.isArray(body.sample) ? body.sample : {};
    const partSchema = body.schema && typeof body.schema === "object" && !Array.isArray(body.schema) ? body.schema : guessSchema(sample);
    const sampleErrors = validatePartData(partSchema, sample);
    if (sampleErrors.length) throw new AgentError("예시 데이터가 스키마와 맞지 않아요: " + sampleErrors.slice(0, 3).join(" · "));
    const now = Date.now();
    const old = await db.prepare("SELECT owner, version FROM parts WHERE id = ?").bind(id).first();
    if (old && old.owner !== owner) throw new AgentError("다른 사람이 등록한 부품 id 예요.", 409);
    if (old) {
      await db.prepare("UPDATE parts SET name = ?, version = ?, code = ?, schema = ?, sample = ?, source = ?, updated = ? WHERE id = ?")
        .bind(name, Number(old.version) + 1, code, JSON.stringify(partSchema), JSON.stringify(sample), source, now, id).run();
      if (description !== null) await db.prepare("UPDATE parts SET description = ? WHERE id = ?").bind(description, id).run();
    } else {
      await db.prepare("INSERT INTO parts (id, name, version, code, schema, sample, owner, shared, public, token_hash, source, created, updated, description) VALUES (?, ?, 1, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?)")
        .bind(id, name, code, JSON.stringify(partSchema), JSON.stringify(sample), owner, source, now, now, description ?? "").run();
    }
    return rowOut(await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first(), false);
  }

  function themeOut(row) {
    const light = row.light ? parse(row.light, null) : null, dark = row.dark ? parse(row.dark, null) : null;
    return { id: row.id, name: row.name, builtin: false, ...(light ? { light } : {}), ...(dark ? { dark } : {}), shared: Number(row.shared) === 1, public: Number(row.public) === 1 };
  }
  async function findTheme(db, id) {
    const builtin = PART_THEMES.find((t) => t.id === id);
    if (builtin) return { ...builtin, builtin: true };
    const row = await db.prepare("SELECT * FROM part_themes WHERE id = ?").bind(id).first();
    return row ? themeOut(row) : null;
  }
  async function listThemes(db) {
    const rows = (await db.prepare("SELECT * FROM part_themes ORDER BY created, id").all()).results ?? [];
    return [...PART_THEMES.map((t) => ({ id: t.id, name: t.name, builtin: true, description: t.description, modes: [t.light && "light", t.dark && "dark"].filter(Boolean) })), ...rows.map((r) => { const t = themeOut(r); return { id: t.id, name: t.name, builtin: false, modes: [t.light && "light", t.dark && "dark"].filter(Boolean) }; })];
  }

  async function listParts(db) {
    const builtin = PART_DEFAULTS.map((p) => ({ id: p.id, name: p.name, version: p.version, builtin: true, description: p.description, schema: p.schema, sample: p.sample,
      fence: "```acard-part " + JSON.stringify({ part: p.id, v: p.version }) }));
    const mine = (await workspaceParts(db)).map((row) => { const p = rowOut(row, false); return { ...p, builtin: false, description: (p.description ? p.description + " - r" : "R") + "egistered from an HTML block" + (p.source ? " (" + p.source + ")" : "") + ". Its script reads window.acardPartData.", fence: "```acard-part " + JSON.stringify({ part: p.id, v: p.version }) }; });
    return { parts: [...builtin, ...mine], themes: await listThemes(db), howTo: "Write a part as a fenced block: the fence line above, then the JSON data, then ```. Or call set_part_data on an existing part block; it checks the data against the schema. A part's look is its theme: add \"theme\":\"<id>\" to the fence (or theme in set_part_data) only when the user asks for a look; without it the part follows the page." };
  }

  async function setPartData(db, principal, helpers, input) {
    if (typeof input.expected_version !== "number" || !Number.isSafeInteger(input.expected_version) || input.expected_version < 0) throw new AgentError("read_blocks의 version을 expected_version 숫자로 보내 주세요.");
    if (typeof input.page !== "string" || !input.page.trim()) throw new AgentError("페이지 슬러그가 필요해요.");
    const data = typeof input.data === "string" ? parse(input.data, null) : input.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AgentError("data 는 JSON 객체여야 해요.");
    const slug = helpers.resolveSlug(input.page);
    const found = await helpers.readPage(db, slug);
    if (!found) throw new AgentError("없는 페이지예요.", 404);
    if (found.page.updated !== input.expected_version) throw new AgentError("그사이 페이지가 바뀌었어요. 다시 읽고 합친 뒤 쓰세요.", 409);
    const blocks = found.blocks.slice();
    let index = -1, partId;
    if (typeof input.block_id === "string" && input.block_id) {
      index = blocks.findIndex((b) => b.id === input.block_id);
      if (index < 0) throw new AgentError("없는 블록이에요.", 404);
      if (blocks[index].type !== "part") throw new AgentError("부품 블록이 아니에요. set_part_data 는 부품 블록의 데이터만 바꿔요.");
      if (globalThis.AiMarks.effective(blocks[index], found.settings?.ai) !== "edit") markRefusal(found, [blocks[index].id]);
      partId = String(blocks[index].meta?.part || "");
    } else {
      partId = String(input.part || "");
      if (!partId) throw new AgentError("block_id(기존 부품 블록) 또는 part(새 부품 블록을 붙일 부품 id)가 필요해요.");
    }
    if (input.theme !== undefined && input.theme !== null && input.theme !== "" && !(await findTheme(db, String(input.theme)))) throw new AgentError("없는 테마예요: " + input.theme + ". list_parts 의 themes 를 확인해 주세요.", 404);
    const part = await findPart(db, partId);
    if (!part) throw new AgentError("없는 부품이에요: " + partId + ". list_parts 로 확인해 주세요.", 404);
    const errors = validatePartData(part.schema, data);
    if (errors.length) throw new AgentError("부품 " + partId + " 데이터가 스키마와 맞지 않아요: " + errors.slice(0, 5).join(" · "));
    const text = JSON.stringify(data, null, 2);
    if (new TextEncoder().encode(text).length > PART_MAX_BYTES) throw new AgentError("부품 데이터는 64KB 까지예요.", 413);
    let affected;
    if (index >= 0) {
      const meta = { ...(blocks[index].meta || {}), part: partId, v: part.version };
      if (input.theme === null || input.theme === "") delete meta.theme; else if (input.theme !== undefined) meta.theme = String(input.theme);
      blocks[index] = { ...blocks[index], text, meta };
      affected = blocks[index].id;
    } else {
      const block = { id: "a" + crypto.randomUUID(), type: "part", text, indent: 0, checked: false, meta: { part: partId, v: part.version, ...(typeof input.theme === "string" && input.theme ? { theme: input.theme } : {}), ...(typeof input.caption === "string" && input.caption ? { caption: input.caption.slice(0, 200) } : {}) } };
      const after = typeof input.after_block_id === "string" ? blocks.findIndex((b) => b.id === input.after_block_id) : blocks.length - 1;
      if (typeof input.after_block_id === "string" && after < 0) throw new AgentError("없는 블록이에요.", 404);
      blocks.splice(after + 1, 0, block);
      affected = block.id;
    }
    return writeGuarded(db, principal, helpers, found, slug, blocks, input.expected_version, "part-data", { block_id: affected, part: partId });
  }

  // One versioned agent write: the person-edit guard (#36), the version claim in SQL, history and attribution.
  async function writeGuarded(db, principal, helpers, found, slug, blocks, expected, action, extra) {
    const guard = humanGuard(found.blocks, blocks, principal.name, found.settings?.ai);
    const version = Math.max(Date.now(), found.page.updated + 1);
    const claimed = await db.prepare("UPDATE pages SET updated = ? WHERE slug = ? AND updated = ?").bind(version, slug, expected).run();
    if (Number(claimed?.meta?.changes ?? 0) === 0) throw new AgentError("그사이 페이지가 바뀌었어요. 다시 읽고 합친 뒤 쓰세요.", 409);
    await helpers.captureEditorVersion(db, slug);
    await db.prepare("UPDATE pages SET source = 'editor', hash = NULL WHERE slug = ?").bind(slug).run();
    await helpers.saveBlocks(db, slug, guard.blocks);
    await db.prepare("INSERT INTO agent_activity (id, page, agent, via, action, created) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), slug, principal.name, principal.via, action, version).run();
    return humanNote({ page: slug, version, updated: version, ...extra }, guard);
  }

  // patch_block: only the text being changed travels (an HTML block's one number or style rule). Each find must occur
  // exactly once, so an edit cannot land twice or in the wrong place.
  async function patchBlock(db, principal, helpers, input) {
    if (typeof input.expected_version !== "number" || !Number.isSafeInteger(input.expected_version) || input.expected_version < 0) throw new AgentError("read_blocks의 version을 expected_version 숫자로 보내 주세요.");
    if (typeof input.page !== "string" || !input.page.trim()) throw new AgentError("페이지 슬러그가 필요해요.");
    if (!Array.isArray(input.edits) || !input.edits.length || input.edits.length > 50) throw new AgentError("edits 에 {find, replace} 를 1~50개 보내 주세요.");
    const slug = helpers.resolveSlug(input.page);
    const found = await helpers.readPage(db, slug);
    if (!found) throw new AgentError("없는 페이지예요.", 404);
    if (found.page.updated !== input.expected_version) throw new AgentError("그사이 페이지가 바뀌었어요. 다시 읽고 합친 뒤 쓰세요.", 409);
    const blocks = found.blocks.slice();
    const index = blocks.findIndex((b) => b.id === input.block_id);
    if (index < 0) throw new AgentError("없는 블록이에요.", 404);
    if (globalThis.AiMarks.effective(blocks[index], found.settings?.ai) !== "edit") markRefusal(found, [blocks[index].id]);
    let text = String(blocks[index].text ?? "");
    for (const [n, edit] of input.edits.entries()) {
      if (!edit || typeof edit.find !== "string" || !edit.find || typeof edit.replace !== "string") throw new AgentError("edits[" + n + "] 는 find 와 replace 문자열이 필요해요.");
      const at = text.indexOf(edit.find);
      if (at < 0) throw new AgentError("edits[" + n + "] 의 find 를 블록에서 찾지 못했어요. read_blocks 로 다시 읽어 주세요.", 409);
      if (text.indexOf(edit.find, at + 1) >= 0) throw new AgentError("edits[" + n + "] 의 find 가 블록에 여러 번 있어요. 앞뒤 글자를 더 넣어 한 곳만 가리키게 해 주세요.");
      text = text.slice(0, at) + edit.replace + text.slice(at + edit.find.length);
    }
    const [checked] = helpers.normaliseBlocks([{ ...blocks[index], text }]);
    blocks[index] = { ...blocks[index], text: checked.text };
    const result = await writeGuarded(db, principal, helpers, found, slug, blocks, input.expected_version, "block-patch", { block_ids: [blocks[index].id] });
    return withWarnings(result, [], [blocks[index]]);
  }

  // /api/parts/themes: list, register {id, name, light?, dark?} (a theme is CSS variables only, see PART_THEME_KEYS), share/public.
  async function themes({ path, method, request, db, env }) {
    const match = /^\/api\/parts\/themes(?:\/([a-z0-9-]{2,40}))?(?:\/(share))?$/.exec(path);
    if (!match) return null;
    if (env.ACARD_SESSION === "guest" || env.ACARD_GUEST_TOKEN !== undefined) return reply({ error: "멤버만 볼 수 있어요." }, 401);
    const [, id, action] = match;
    const owner = String(env.ACARD_USER_EMAIL || env.ACARD_GUEST_EMAIL || "owner");
    try {
      if (!id && method === "GET") return reply({ themes: await listThemes(db), keys: PART_THEME_KEYS });
      if (!id && method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return reply({ error: "JSON 본문이 필요해요." }, 400);
        const themeId = String(body.id || "").trim().toLowerCase();
        if (!PART_ID.test(themeId)) throw new AgentError("테마 id 는 영문 소문자로 시작하는 2-40자(a-z, 0-9, -)여야 해요.");
        if (PART_THEME_IDS.has(themeId)) throw new AgentError("기본 테마와 같은 id 예요.", 409);
        const errors = validatePartTheme(body);
        if (errors.length) throw new AgentError("테마를 읽지 못했어요: " + errors.slice(0, 4).join(" · "));
        const old = await db.prepare("SELECT owner FROM part_themes WHERE id = ?").bind(themeId).first();
        if (old && old.owner !== owner) throw new AgentError("다른 사람이 등록한 테마 id 예요.", 409);
        const now = Date.now(), name = String(body.name || themeId).slice(0, 60), light = body.light ? JSON.stringify(body.light) : null, dark = body.dark ? JSON.stringify(body.dark) : null;
        if (old) await db.prepare("UPDATE part_themes SET name = ?, light = ?, dark = ?, updated = ? WHERE id = ?").bind(name, light, dark, now, themeId).run();
        else await db.prepare("INSERT INTO part_themes (id, name, light, dark, owner, shared, public, created, updated) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)").bind(themeId, name, light, dark, owner, now, now).run();
        return reply(themeOut(await db.prepare("SELECT * FROM part_themes WHERE id = ?").bind(themeId).first()), 201);
      }
      if (!id) return reply({ error: "지원하지 않는 방법이에요." }, 405);
      const found = await findTheme(db, id);
      if (!action && method === "GET") return found ? reply({ ...found, css: partThemeCss(found) }) : reply({ error: "없는 테마예요." }, 404);
      if (!found || found.builtin) return reply({ error: "없는 테마예요." }, 404);
      if (!action && method === "DELETE") { await db.prepare("DELETE FROM part_themes WHERE id = ?").bind(id).run(); return reply({ ok: true }); }
      if (action === "share" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const now = Date.now();
        if (typeof body.link === "boolean") await db.prepare("UPDATE part_themes SET shared = ?, updated = ? WHERE id = ?").bind(body.link ? 1 : 0, now, id).run();
        if (typeof body.public === "boolean") await db.prepare("UPDATE part_themes SET public = ?, updated = ? WHERE id = ?").bind(body.public ? 1 : 0, now, id).run();
        return reply(themeOut(await db.prepare("SELECT * FROM part_themes WHERE id = ?").bind(id).first()));
      }
      return reply({ error: "지원하지 않는 방법이에요." }, 405);
    } catch (error) {
      if (error instanceof AgentError) return reply({ error: error.message }, error.status);
      throw error;
    }
  }

  async function human({ path, method, request, db, env, helpers }) {
    const match = /^\/api\/parts(?:\/([a-z0-9-]{2,40}))?(?:\/(share))?$/.exec(path);
    if (!match) return null;
    const [, id, action] = match;
    if (env.ACARD_SESSION === "guest" || env.ACARD_GUEST_TOKEN !== undefined) return reply({ error: "멤버만 볼 수 있어요." }, 401);
    const owner = String(env.ACARD_USER_EMAIL || env.ACARD_GUEST_EMAIL || "owner");
    try {
      if (!id && method === "GET") return reply(await listParts(db));
      if (!id && method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return reply({ error: "JSON 본문이 필요해요." }, 400);
        return reply(await register(db, helpers, body, owner), 201);
      }
      if (!id) return reply({ error: "지원하지 않는 방법이에요." }, 405);
      const row = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first();
      if (!action && method === "GET") {
        if (row) return reply(rowOut(row, true));
        const d = PART_DEFAULTS.find((p) => p.id === id);
        return d ? reply({ ...d, builtin: true }) : reply({ error: "없는 부품이에요." }, 404);
      }
      if (!row) return reply({ error: "없는 부품이에요." }, 404);
      if (row.owner && row.owner !== owner) return reply({ error: "다른 사람이 등록한 부품이에요. 만든 사람만 바꾸거나 지울 수 있어요." }, 403);
      if (!action && method === "PATCH") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return reply({ error: "JSON 본문이 필요해요." }, 400);
        const name = body.name === undefined ? row.name : String(body.name).trim().slice(0, 60);
        if (!name) return reply({ error: "부품 이름을 적어 주세요." }, 400);
        const description = body.description === undefined ? String(row.description || "") : String(body.description).trim().slice(0, 200);
        await db.prepare("UPDATE parts SET name = ?, description = ?, updated = ? WHERE id = ?").bind(name, description, Date.now(), id).run();
        return reply(rowOut(await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first(), false));
      }
      if (!action && method === "DELETE") {
        await db.prepare("DELETE FROM parts WHERE id = ?").bind(id).run();
        return reply({ ok: true });
      }
      if (action === "share" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const now = Date.now();
        let url = null;
        if (body.link === true) {
          const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          await db.prepare("UPDATE parts SET shared = 1, token_hash = ?, updated = ? WHERE id = ?").bind(await sha(token), now, id).run();
          url = (env.ACARD_SHARE_PREFIX || "/p/") + token + "/acard-part.json";
        } else if (body.link === false) {
          await db.prepare("UPDATE parts SET shared = 0, token_hash = NULL, updated = ? WHERE id = ?").bind(now, id).run();
        }
        if (typeof body.public === "boolean") await db.prepare("UPDATE parts SET public = ?, updated = ? WHERE id = ?").bind(body.public ? 1 : 0, now, id).run();
        const out = rowOut(await db.prepare("SELECT * FROM parts WHERE id = ?").bind(id).first(), false);
        return reply(url ? { ...out, url } : out);
      }
      return reply({ error: "지원하지 않는 방법이에요." }, 405);
    } catch (error) {
      if (error instanceof AgentError) return reply({ error: error.message }, error.status);
      throw error;
    }
  }

  // A shared part read by its link: name, version, schema, sample and code; no owner, nothing from pages.
  async function sharedPart({ path, method, db }) {
    const match = /^\/p\/([A-Za-z0-9_-]{43})\/acard-part\.json$/.exec(path);
    if (!match || !db) return null;
    const notFound = () => new Response(method === "HEAD" ? null : JSON.stringify({ error: "없는 부품이에요." }), { status: 404, headers: { ...PUBLIC_HEADERS, "content-type": "application/json; charset=utf-8" } });
    if (method !== "GET" && method !== "HEAD") return notFound();
    const row = await db.prepare("SELECT * FROM parts WHERE token_hash = ? AND shared = 1").bind(await sha(match[1])).first().catch(() => null);
    if (!row) return notFound();
    const { owner, ...out } = rowOut(row, true);
    return new Response(method === "HEAD" ? null : JSON.stringify(out), { headers: { ...PUBLIC_HEADERS, "content-type": "application/json; charset=utf-8" } });
  }

  registerFeature({
    schema: async (db) => {
      await db.batch(schema.map((sql) => db.prepare(sql)));
      // #38 stage 2: stores made before the description column (supabase/033 on Postgres); an existing column throws and is ignored.
      await db.prepare("ALTER TABLE parts ADD COLUMN description TEXT NOT NULL DEFAULT ''").run().catch(() => {});
    },
    api: [themes, human],
    publicRoutes: [sharedPart],
    services: { mcpTools: [
      { name: "list_parts", description: "List the parts this workspace can draw: the 5 defaults (badge, table, chart, heatmap, dag) and parts registered from HTML blocks, each with its JSON data schema, a sample and the fence to write. Parts compute sums/averages/ratios themselves; send raw data. Any flow, process, pipeline or structure diagram is the dag part (step cards with desc/tags/gate joined by arrows, callout under it): never write it as HTML cards.", scope: "read", operation: "listParts",
        inputSchema: () => ({}) },
      { name: "patch_block", description: "Change part of one block's text without resending the block: edits is a list of {find, replace}, each find must occur exactly once in the block (use it for HTML blocks: change one number or one style rule). Requires version from read_blocks.", scope: "write", operation: "patchBlock",
        inputSchema: (z) => ({ page: z.string(), block_id: z.string(), edits: z.array(z.object({ find: z.string(), replace: z.string() })), expected_version: z.number().int().nonnegative() }) },
      { name: "set_part_data", description: "Set the JSON data of a part block (block_id) or add a new part block (part, optional after_block_id, caption). Data only: the code stays in the part. The data is checked against the part's schema; a part a person edited keeps the person's data and yours becomes an update suggestion. Requires version from read_blocks as expected_version.", scope: "write", operation: "setPartData",
        inputSchema: (z) => ({ page: z.string(), block_id: z.string().optional(), part: z.string().optional(), after_block_id: z.string().optional(), caption: z.string().optional(), theme: z.string().nullable().optional(), data: z.record(z.string(), z.unknown()), expected_version: z.number().int().nonnegative() }) },
    ] },
    agentOps: {
      listParts: async (db) => listParts(db),
      setPartData: (db, principal, helpers, input) => setPartData(db, principal, helpers, input),
      patchBlock: (db, principal, helpers, input) => patchBlock(db, principal, helpers, input),
    },
  });
})();
