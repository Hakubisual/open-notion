// AI marks for the in-editor AI (/api/ai/polish, /api/ai/write): the editor sends the page and the block ids
// it wants rewritten (and a [start, end) range for a selection inside one block). A target a person marked lock or ref,
// or a range over a marked piece, is refused with 423 before any model is called; the prompts are not trusted with it.
// Without page/blocks (older clients) nothing changes. Top-level so every feature in the worker scope can call it.
async function aiMarkCheck(db, helpers, body) {
  if (!body || typeof body.page !== "string" || !body.page) return { found: null };
  let slug;
  try { slug = resolveSlug(body.page); } catch { return { found: null }; }
  const found = await readPage(db, slug);
  if (!found) return { found: null };
  const ids = Array.isArray(body.blocks) ? body.blocks.filter((id) => typeof id === "string").slice(0, 2000) : [];
  const range = Array.isArray(body.range) && body.range.length === 2 && body.range.every(Number.isInteger) ? body.range : null;
  const hit = globalThis.AiMarks.blocked(found.blocks, found.settings?.ai, ids, range);
  if (hit.length) {
    return { found, refused: helpers.json({ error: "고정·참고로 표시한 부분이라 AI가 바꾸지 않아요. 표시를 풀거나 다른 부분을 골라 주세요.", locked: hit }, 423) };
  }
  return { found };
}

// The page as AI context: lock blocks in <locked>, ref blocks in <ref>, with the rule that names them.
function aiMarkContext(found, limit) {
  if (!found || !globalThis.AiMarks.any(found.blocks, found.settings?.ai)) return null;
  const ctx = globalThis.AiMarks.promptContext(found.blocks, found.settings?.ai, limit);
  return { text: ctx.text, refs: ctx.refs,
    rule: "<ref> 안의 글은 사람이 고른 참고 자료다. 사실과 숫자는 여기서 가져오고, 쓴 문장에는 어느 자료에서 왔는지 드러나게 쓴다. <ref> 와 <locked> 안의 글은 다시 쓰거나 고치지 말고 결과에 옮겨 적지도 않는다." };
}
