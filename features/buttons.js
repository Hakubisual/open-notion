// 동작형 버튼(notion-parity C3 블록, C4 속성): 두 버튼 모두 저장된 동작만 서버의 runActions 로 실행한다.
// 클라이언트가 보낸 동작 목록은 받지 않는다. 손님 권한은 features/share.js 의 라우트 표(edit)와
// runActions 의 대상 DB 별 검사가 같이 본다.
(() => {
  const BLOCK = /^\/api\/page\/([^/]+)\/button\/([^/]+)$/;
  const PROP = /^\/api\/db\/([^/]+)\/rows\/([^/]+)\/button\/([^/]+)$/;

  registerFeature({
    api: async ({ path, method, db, env, helpers }) => {
      const block = BLOCK.exec(path);
      const prop = !block && PROP.exec(path);
      if (!block && !prop) return null;
      const { json } = helpers;
      if (method !== "POST") return json({ error: "지원하지 않는 방법이에요." }, 405);
      if (block) {
        let slug;
        try { slug = resolveSlug(decodeURIComponent(block[1])); } catch { return json({ error: "주소를 읽지 못했어요." }, 400); }
        const id = decodeURIComponent(block[2]);
        const row = await db.prepare("SELECT type, meta FROM blocks WHERE page = ? AND id = ?").bind(slug, id).first();
        if (!row || row.type !== "button") return json({ error: "없는 버튼이에요." }, 404);
        const meta = parseJson(row.meta, {}) || {};
        if (!Array.isArray(meta.actions) || !meta.actions.length) return json({ error: "동작이 없는 버튼이에요." }, 400);
        // issue 107: no more than the permission of whoever saved these actions (gate/_worker.js buttonPressDb).
        const as = await buttonPressDb(db, blockButtonKey(slug, id));
        if (as.error) return json({ error: as.error }, as.status);
        const result = await runActions(as.db, env, {}, meta.actions);
        return json(result, result.error ? result.status : 200);
      }
      const slug = decodeURIComponent(prop[1]);
      const database = await databaseBySlug(db, slug);
      if (!database) return json({ error: "없는 데이터베이스예요." }, 404);
      const propId = decodeURIComponent(prop[3]);
      const found = await db.prepare("SELECT type, config FROM db_properties WHERE id = ? AND database_id = ?").bind(propId, database.id).first();
      if (!found || found.type !== "button") return json({ error: "없는 버튼이에요." }, 404);
      const config = normaliseConfig("button", parseJson(found.config, {}));
      if (!config.actions.length) return json({ error: "동작이 없는 버튼이에요." }, 400);
      const rowId = decodeURIComponent(prop[2]);
      if (!(await db.prepare("SELECT 1 AS x FROM db_rows WHERE id = ? AND database_id = ?").bind(rowId, database.id).first())) return json({ error: "없는 행이에요." }, 404);
      const as = await buttonPressDb(db, propButtonKey(propId));
      if (as.error) return json({ error: as.error }, as.status);
      const result = await runActions(as.db, env, { database, row: rowId }, config.actions);
      return json(result, result.error ? result.status : 200);
    },
  });
})();
