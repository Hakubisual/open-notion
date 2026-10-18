(() => {
  const schema = [
    "CREATE TABLE IF NOT EXISTS db_rules (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, config TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS db_rules_database ON db_rules(database_id, created, id)",
  ];
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const triggerTypes = ["select", "status", "checkbox"];
  const actionTypes = ["title", "text", "number", "select", "status", "multi_select", "date", "checkbox", "url", "email", "phone", "relation"];
  const unpack = row => ({ ...row, config: JSON.parse(row.config), enabled: row.enabled === 1 });

  function valueFor(prop, value) {
    if (value === null && prop.type !== "checkbox") return { value: emptyValue(prop) };
    if (["select", "status"].includes(prop.type)) {
      if (typeof value !== "string" || !optionById(prop, value)) return null;
    } else if (prop.type === "checkbox") {
      if (typeof value !== "boolean") return null;
    } else if (prop.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
    } else if (["multi_select", "relation"].includes(prop.type)) {
      if (!Array.isArray(value) || value.length > 200 || value.some(id => typeof id !== "string" || !id || id.length > 200 || prop.type === "multi_select" && !optionById(prop, id))) return null;
    } else if (prop.type === "date") {
      const valid = text => typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text;
      if (!(typeof value === "string" ? valid(value) : object(value) && valid(value.start) && (value.end == null || valid(value.end) && value.end >= value.start))) return null;
    } else if (typeof value !== "string" || value.length > 4000) return null;
    return { value: normaliseCellValue(prop, value) };
  }

  function configFor(input, properties, database) {
    if (!object(input) || !object(input.trigger) || !object(input.action)) return null;
    const { trigger, action } = input;
    let when;
    if (trigger.type === "created") when = { type: "created" };
    else if (trigger.type === "changed") {
      const prop = properties.find(prop => prop.id === trigger.property);
      if (!prop || !triggerTypes.includes(prop.type)) return null;
      const match = valueFor(prop, trigger.value);
      if (!match || match.value === null) return null;
      when = { type: "changed", property: prop.id, value: match.value };
    } else return null;
    const prop = properties.find(prop => prop.id === action.property);
    if (!prop || !actionTypes.includes(prop.type) || prop.id === when.property) return null;
    let then;
    if (action.type === "today" && prop.type === "date") then = { type: "today", property: prop.id };
    else if (action.type === "set") {
      const match = valueFor(prop, action.value);
      if (!match || !validBoardProgress(database, properties, { [prop.id]: match.value })) return null;
      then = { type: "set", property: prop.id, value: match.value };
    } else return null;
    return { trigger: when, action: then };
  }

  registerFeature({
    schema: db => db.batch(schema.map(sql => db.prepare(sql))),
    beforeRowWrite: async ({ db, database, properties, before, props }) => {
      const rows = await db.prepare("SELECT config FROM db_rules WHERE database_id = ? AND enabled = 1 ORDER BY created, id").bind(database.id).all();
      // Match the user's normalized write, never the output of another rule.
      const incoming = { ...props };
      const today = new Date().toISOString().slice(0, 10);
      for (const row of rows.results ?? []) {
        const config = configFor(JSON.parse(row.config), properties, database);
        // Deleted properties/options and changed types make old rules inactive.
        if (!config) continue;
        const { trigger, action } = config;
        const matches = trigger.type === "created" ? before === null : before !== null
          && incoming[trigger.property] === trigger.value
          && (before[trigger.property] ?? emptyValue(properties.find(prop => prop.id === trigger.property))) !== trigger.value;
        if (matches) props[action.property] = action.type === "today" ? { start: today, end: null } : action.value;
      }
    },
    api: async ({ path, method, request, db }) => {
      const match = /^\/api\/db\/([^/]+)\/rules(?:\/([^/]+))?$/.exec(path);
      if (!match) return null;
      const database = await db.prepare("SELECT id, slug FROM databases WHERE slug = ? AND NOT EXISTS (SELECT 1 FROM editor_trash WHERE page = slug)").bind(decodeURIComponent(match[1])).first();
      if (!database) return json({ error: "없는 데이터베이스예요." }, 404);
      const id = match[2] ? decodeURIComponent(match[2]) : null;
      const properties = await readProperties(db, database.id);
      if (!id && method === "GET") {
        const rows = await db.prepare("SELECT * FROM db_rules WHERE database_id = ? ORDER BY created, id").bind(database.id).all();
        return json({ rules: (rows.results ?? []).map(row => ({ ...unpack(row), valid: !!configFor(JSON.parse(row.config), properties, database) })), properties, limit: 20 });
      }
      const current = id ? await db.prepare("SELECT * FROM db_rules WHERE id = ? AND database_id = ?").bind(id, database.id).first() : null;
      if (id && !current) return json({ error: "없는 규칙이에요." }, 404);
      if (id && method === "DELETE") {
        await db.prepare("DELETE FROM db_rules WHERE id = ? AND database_id = ?").bind(id, database.id).run();
        return json({ ok: true });
      }
      if (!(id ? method === "PATCH" : method === "POST")) return json({ error: "지원하지 않는 방법이에요." }, 405);
      const body = await request.json().catch(() => null);
      if (!object(body) || body.enabled !== undefined && typeof body.enabled !== "boolean") return json({ error: "규칙 설정을 확인해 주세요." }, 400);
      const config = configFor(body.config ?? (current && JSON.parse(current.config)), properties, database);
      if (!config) return json({ error: "조건과 실행할 속성 값을 확인해 주세요." }, 400);
      const enabled = body.enabled ?? (current ? current.enabled === 1 : true);
      const ruleId = id || crypto.randomUUID();
      if (id) await db.prepare("UPDATE db_rules SET config = ?, enabled = ? WHERE id = ? AND database_id = ?").bind(JSON.stringify(config), enabled ? 1 : 0, id, database.id).run();
      else {
        // The count and insert are one SQL statement, including concurrent requests.
        const result = await db.prepare("INSERT INTO db_rules (id, database_id, config, enabled, created) SELECT ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM db_rules WHERE database_id = ?) < 20")
          .bind(ruleId, database.id, JSON.stringify(config), enabled ? 1 : 0, Date.now(), database.id).run();
        if (!Number(result.meta?.changes)) return json({ error: "규칙은 데이터베이스마다 20개까지 만들 수 있어요." }, 409);
      }
      return json({ rule: unpack(await db.prepare("SELECT * FROM db_rules WHERE id = ?").bind(ruleId).first()) }, id ? 200 : 201);
    },
  });
})();
