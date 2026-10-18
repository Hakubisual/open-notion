(() => {
  const schema = "CREATE TABLE IF NOT EXISTS db_forms (id TEXT PRIMARY KEY, database_id TEXT NOT NULL UNIQUE, config TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)";
  const types = new Set(["title", "text", "number", "select", "status", "multi_select", "date", "checkbox", "email", "url"]);
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const empty = value => value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
  const unpack = row => row ? { ...row, config: JSON.parse(row.config) } : null;

  async function databaseFor(db, slug) {
    return db.prepare("SELECT d.id, d.slug, d.title FROM databases d WHERE d.slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = d.slug)").bind(slug).first();
  }

  async function findForm(db, id) {
    const row = await db.prepare("SELECT f.* FROM db_forms f JOIN databases d ON d.id = f.database_id WHERE f.id = ? AND NOT EXISTS (SELECT 1 FROM editor_trash t WHERE t.page = d.slug)").bind(id).first();
    if (!row) return null;
    const database = await db.prepare("SELECT id, slug, title FROM databases WHERE id = ?").bind(row.database_id).first();
    return { form: unpack(row), database, properties: await readProperties(db, database.id) };
  }

  function configInput(input, properties) {
    if (!object(input) || typeof input.title !== "string" || !input.title.trim() || input.title.length > 120 || !Array.isArray(input.fields) || !input.fields.length || input.fields.length > properties.length) return null;
    const ids = new Set();
    const fields = [];
    for (const field of input.fields) {
      if (!object(field) || typeof field.property !== "string" || ids.has(field.property) || typeof field.label !== "string" || !field.label.trim() || field.label.length > 120 || typeof field.required !== "boolean") return null;
      const prop = properties.find(prop => prop.id === field.property);
      if (!prop || !types.has(prop.type)) return null;
      ids.add(prop.id);
      fields.push({ property: prop.id, label: field.label.trim(), required: field.required });
    }
    return { title: input.title.trim(), fields };
  }

  function validType(prop, value, normal) {
    switch (prop.type) {
      case "number": return (typeof value === "string" || typeof value === "number") && normal !== null;
      case "checkbox": return [true, false, 1, 0, "true", "false"].includes(value);
      case "select": case "status": return typeof value === "string" && normal !== null;
      case "multi_select": return Array.isArray(value) && value.every(id => typeof id === "string" && optionById(prop, id));
      case "date": {
        const validDate = text => typeof text === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(text) && !Number.isNaN(Date.parse(text)) && new Date(text.slice(0, 10)).toISOString().slice(0, 10) === text.slice(0, 10);
        return normal !== null && (typeof value === "string" ? validDate(value) : object(value) && validDate(value.start) && (empty(value.end) || validDate(value.end) && value.end >= value.start));
      }
      case "email": return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
      case "url": {
        if (typeof value !== "string") return false;
        try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
      }
      default: return typeof value === "string" && value.length <= 4000;
    }
  }

  async function submit(db, found, body) {
    const errors = {};
    const props = {};
    if (!object(body) || !object(body.props)) return { status: 400, data: { error: "입력 값을 확인해 주세요.", errors: { _form: "입력 값이 필요해요." } } };
    for (const field of found.form.config.fields) {
      const prop = found.properties.find(prop => prop.id === field.property);
      if (!prop || !types.has(prop.type)) { errors[field.property] = "속성이 바뀌었어요. 폼 설정을 확인해 주세요."; continue; }
      const value = body.props[prop.id];
      if (empty(value) && (!Array.isArray(value) || prop.type === "multi_select")) {
        if (field.required) errors[prop.id] = field.label + "을(를) 입력해 주세요.";
        continue;
      }
      const structured = prop.type === "date" && object(value) && typeof value.start === "string" && (empty(value.end) || typeof value.end === "string")
        || prop.type === "multi_select" && Array.isArray(value) && value.every(id => typeof id === "string");
      const normal = value !== null && typeof value === "object" && !structured ? null : normaliseCellValue(prop, value);
      if (!validType(prop, value, normal)) {
        errors[prop.id] = field.label + ": " + ({ number: "숫자를 입력해 주세요.", email: "이메일 주소를 확인해 주세요.", url: "http 또는 https 주소를 입력해 주세요.", date: "올바른 날짜를 입력해 주세요.", checkbox: "체크 값을 확인해 주세요.", select: "목록에서 골라 주세요.", status: "목록에서 골라 주세요.", multi_select: "목록에서 골라 주세요." }[prop.type] || "텍스트를 입력해 주세요.");
      } else if (field.required && prop.type === "checkbox" && !normal) {
        errors[prop.id] = field.label + "에 체크해 주세요.";
      } else props[prop.id] = normal;
    }
    if (!validBoardProgress(found.database, found.properties, props)) {
      const prop = found.properties.find(prop => prop.type === "number" && prop.name === "진행률");
      errors[prop.id] = "진행률은 0부터 100까지 입력해 주세요.";
    }
    if (Object.keys(errors).length) return { status: 400, data: { error: "입력 값을 확인해 주세요.", errors } };
    try {
      const data = await dbRowRequest(db, found.database.slug, "POST", null, { props });
      return { status: 201, data: { ...data, url: "/edit/" + encodeURIComponent(data.row.page) + "/" } };
    } catch (error) {
      if (error instanceof AgentError) return { status: error.status, data: { error: error.message, errors: { _form: error.message } } };
      throw error;
    }
  }

  function formHtml(found, values = {}, errors = {}, result) {
    const esc = escapeHtml;
    const fields = found.form.config.fields.map(field => {
      const prop = found.properties.find(prop => prop.id === field.property);
      if (!prop || !types.has(prop.type)) return '<p class="fr-error">속성이 바뀌었어요. 폼 설정을 확인해 주세요.</p>';
      const id = esc(prop.id), value = values[prop.id], required = field.required ? " required" : "";
      const common = ' id="' + id + '" name="' + id + '"' + required + (errors[prop.id] ? ' aria-invalid="true" aria-describedby="error-' + id + '"' : "");
      let input;
      if (["select", "status", "multi_select"].includes(prop.type)) {
        input = '<select' + common + (prop.type === "multi_select" ? ' multiple size="4"' : "") + '>' + (prop.type === "multi_select" ? "" : '<option value="">선택해 주세요</option>') + (prop.config.options || []).map(option => '<option value="' + esc(option.id) + '"' + ((Array.isArray(value) ? value : [value]).includes(option.id) ? " selected" : "") + '>' + esc(option.name) + '</option>').join("") + '</select>';
      } else if (prop.type === "checkbox") input = '<input type="checkbox" value="true"' + common + (value === true || value === "true" ? " checked" : "") + '>';
      else input = '<input type="' + (["date", "email", "url"].includes(prop.type) ? prop.type : "text") + '"' + (prop.type === "number" ? ' inputmode="decimal"' : ' maxlength="4000"') + common + ' value="' + esc(value == null ? "" : String(value)) + '">';
      return '<div class="fr-field"><label for="' + id + '">' + esc(field.label) + (field.required ? ' <span class="fr-required">*</span>' : "") + '</label>' + input + (errors[prop.id] ? '<p class="fr-error" id="error-' + id + '">' + esc(errors[prop.id]) + '</p>' : "") + '</div>';
    }).join("");
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(found.form.config.title) + ' · Acard</title><link rel="stylesheet" href="/lazy/form-row.css"></head><body class="fr-page"><main class="fr-card"><header class="fr-header"><a href="/edit/' + encodeURIComponent(found.database.slug) + '/">Acard · ' + esc(found.database.title) + '</a><p>로그인한 나만 사용하는 폼</p><h1>' + esc(result ? "제출됐어요" : found.form.config.title) + '</h1></header>' + (result ? '<section class="fr-content"><p>데이터베이스에 새 행을 만들었어요.</p><a class="fr-primary" href="' + esc(result.url) + '">행 열기</a><a class="fr-back" href="/edit/' + encodeURIComponent(found.database.slug) + '/">표로 돌아가기</a></section>' : '<form method="post" class="fr-content">' + (Object.keys(errors).length ? '<p role="alert" class="fr-error">입력 값을 확인해 주세요.</p>' : '') + fields + '<button class="fr-primary" type="submit">제출</button></form>') + '</main></body></html>';
  }

  registerFeature({
    schema: db => db.prepare(schema).run(),
    api: async ({ path, method, request, db }) => {
      const configRoute = /^\/api\/db\/([^/]+)\/form$/.exec(path);
      if (configRoute) {
        const database = await databaseFor(db, decodeURIComponent(configRoute[1]));
        if (!database) return json({ error: "없는 데이터베이스예요." }, 404);
        const properties = (await readProperties(db, database.id)).filter(prop => types.has(prop.type));
        if (method === "GET") return json({ form: unpack(await db.prepare("SELECT * FROM db_forms WHERE database_id = ?").bind(database.id).first()), properties });
        if (method !== "PUT") return json({ error: "지원하지 않는 방법이에요." }, 405);
        const body = await request.json().catch(() => null);
        const config = configInput(body?.config, properties);
        if (!config) return json({ error: "폼 제목과 속성 설정을 확인해 주세요." }, 400);
        const now = Date.now();
        await db.prepare("INSERT INTO db_forms (id, database_id, config, created, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(database_id) DO UPDATE SET config = excluded.config, updated = excluded.updated").bind(crypto.randomUUID(), database.id, JSON.stringify(config), now, now).run();
        return json({ form: unpack(await db.prepare("SELECT * FROM db_forms WHERE database_id = ?").bind(database.id).first()) });
      }
      const route = /^\/api\/forms\/([^/]+)(\/submit)?$/.exec(path);
      if (!route) return null;
      const found = await findForm(db, decodeURIComponent(route[1]));
      if (!found) return json({ error: "없는 폼이에요." }, 404);
      if (!route[2] && method === "GET") return json({ ...found, properties: found.properties.filter(prop => found.form.config.fields.some(field => field.property === prop.id)) });
      if (!route[2] || method !== "POST") return json({ error: "지원하지 않는 방법이에요." }, 405);
      const result = await submit(db, found, await request.json().catch(() => null));
      return json(result.data, result.status);
    },
    authenticatedRoutes: async ({ path, method, request, db }) => {
      const route = /^\/form\/([^/]+)\/?$/.exec(path);
      if (!route) return null;
      if (!db) return json({ error: "저장소가 연결되지 않았어요." }, 503);
      await ensureSchema(db);
      const found = await findForm(db, decodeURIComponent(route[1]));
      if (!found) return json({ error: "없는 폼이에요." }, 404);
      if (!["GET", "POST"].includes(method)) return json({ error: "지원하지 않는 방법이에요." }, 405);
      const values = {};
      let result;
      if (method === "POST") {
        const data = await request.formData().catch(() => null);
        if (!data) return json({ error: "입력 값을 확인해 주세요." }, 400);
        for (const field of found.form.config.fields) {
          const prop = found.properties.find(prop => prop.id === field.property);
          values[field.property] = prop?.type === "multi_select" ? data.getAll(field.property) : prop?.type === "checkbox" ? data.has(field.property) : data.get(field.property);
        }
        result = await submit(db, found, { props: values });
      }
      return new Response(formHtml(found, values, result?.data.errors || {}, result?.status === 201 ? result.data : null), { status: result?.status || 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
    },
  });
})();
