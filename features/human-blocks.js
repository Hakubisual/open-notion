// #36 AI writes, people edit: a block a person changed carries meta.human. Agent writes never change such a block;
// a different new text is kept on it as meta.suggest ("update suggestion") until the person accepts or dismisses it.
// Top-level functions so agent-api.js, mcp-blocks and agent-runs (inlined into the same worker scope) share them.

const humanSame = (a, b) => a.type === b.type && a.text === b.text;

// Called on every person save (editor PUT and changed-blocks PATCH) of a page an agent has written. New blocks and
// blocks whose text or type changed get meta.human; marks and pending suggestions the client did not send back are
// carried over from the stored block. Pages no agent touched are saved as sent (#25 still guards them page-wide).
async function humanAgentPage(db, slug) {
  try { return Boolean(await db.prepare("SELECT 1 AS x FROM agent_activity WHERE page = ? LIMIT 1").bind(slug).first()); }
  catch { return false; }
}

function humanMarkSaves(oldBlocks, newBlocks, now, agentPage) {
  if (!agentPage) return newBlocks;
  const old = new Map(oldBlocks.map((block) => [block.id, block]));
  for (const block of newBlocks) {
    const before = old.get(block.id);
    const changed = !before || !humanSame(before, block);
    const keep = before && before.meta ? before.meta : {};
    const meta = { ...(block.meta || {}) };
    if (changed) meta.human = { at: now };
    else if (keep.human && !meta.human) meta.human = keep.human;
    if (keep.suggest && !meta.suggest) meta.suggest = keep.suggest;
    block.meta = Object.keys(meta).length ? meta : null;
  }
  return newBlocks;
}

// Gives blocks parsed from an agent's full-page markdown the ids of the blocks they replace: unchanged blocks match
// by longest common subsequence, and the blocks between two matches pair up in order. Unpaired new blocks get fresh ids.
function humanAlign(oldBlocks, newBlocks) {
  const n = oldBlocks.length, m = newBlocks.length;
  const key = (block) => block.type + "\u0000" + block.text;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) {
    lcs[i][j] = key(oldBlocks[i]) === key(newBlocks[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (key(oldBlocks[i]) === key(newBlocks[j])) { pairs.push([i, j]); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i += 1;
    else j += 1;
  }
  const ids = new Array(m).fill(null);
  let pi = 0, pj = 0;
  for (const [oi, nj] of pairs.concat([[n, m]])) {
    for (let k = 0; k < Math.min(oi - pi, nj - pj); k += 1) ids[pj + k] = oldBlocks[pi + k].id;
    if (oi < n) ids[nj] = oldBlocks[oi].id;
    pi = oi + 1; pj = nj + 1;
  }
  const used = new Set(oldBlocks.map((block) => block.id));
  return newBlocks.map((block, index) => {
    let id = ids[index];
    if (!id) { id = block.id; while (used.has(id)) id = "a" + Math.random().toString(36).slice(2, 10); used.add(id); }
    return { ...block, id };
  });
}

// Runs after every agent write. Person-edited blocks the agent changed go back to the person's version with the
// agent's text as meta.suggest; ones it removed come back with a removal suggestion. Returns the guarded blocks.
function humanGuard(before, after, by) {
  const now = Date.now();
  const out = after.map((block) => ({ ...block }));
  let suggestions = 0;
  const kept = [];
  const at = (id) => out.findIndex((block) => block.id === id);
  for (let index = 0; index < before.length; index += 1) {
    const person = before[index];
    if (!person.meta || !person.meta.human) continue;
    let pos = at(person.id);
    if (pos < 0) pos = out.findIndex((block) => humanSame(block, person) && !before.some((b) => b.id === block.id));
    if (pos < 0) {
      // A protected block inside columns comes back inside them (notion-parity C13): its column and columns
      // ancestors are structure blocks, so any the agent removed come back too, in their old order.
      const chain = [];
      for (let back = index - 1, level = person.indent || 0; back >= 0 && level > 0; back -= 1) {
        const above = before[back];
        if ((above.indent || 0) >= level) continue;
        level = above.indent || 0;
        if (above.type === "column" || above.type === "columns") chain.unshift(above);
        else if (chain.length) break;
      }
      let prev = -1;
      const placeAfter = (from) => { prev = -1; for (let back = from - 1; back >= 0 && prev < 0; back -= 1) prev = at(before[back].id); };
      for (const anc of chain) {
        if (at(anc.id) >= 0) continue;
        placeAfter(before.indexOf(anc));
        out.splice(prev + 1, 0, { ...anc });
      }
      placeAfter(index);
      out.splice(prev + 1, 0, { ...person, meta: { ...person.meta, suggest: { remove: true, by, at: now } } });
      suggestions += 1; kept.push(person.id);
      continue;
    }
    const agent = out[pos];
    if (humanSame(agent, person)) { out[pos] = { ...agent, id: person.id, indent: person.indent, checked: person.checked, meta: person.meta }; continue; }
    const suggest = { text: agent.text, type: agent.type, by, at: now };
    if (agent.meta && agent.meta.richText === undefined && Object.keys(agent.meta).length) suggest.meta = agent.meta;
    out[pos] = { ...person, meta: { ...person.meta, suggest } };
    suggestions += 1; kept.push(person.id);
  }
  humanKeepColumn(before, out);
  return { blocks: out, suggestions, kept };
}

// The column a block sits in: the id of its nearest column ancestor, or null outside columns.
function humanColumnOf(blocks, index) {
  for (let back = index - 1, level = blocks[index].indent || 0; back >= 0 && level > 0; back -= 1) {
    if ((blocks[back].indent || 0) >= level) continue;
    level = blocks[back].indent || 0;
    if (blocks[back].type === "column") return blocks[back].id;
  }
  return null;
}

// A person-edited block an agent moved to another column (notion-parity C13) goes back to the person's column,
// right after the block that came before it there (or first in that column).
function humanKeepColumn(before, out) {
  before.forEach((person, index) => {
    if (!person.meta || !person.meta.human) return;
    const home = humanColumnOf(before, index);
    const pos = out.findIndex((block) => block.id === person.id);
    if (pos < 0 || humanColumnOf(out, pos) === home || (home && !out.some((block) => block.id === home))) return;
    let end = pos + 1;
    while (end < out.length && (out[end].indent || 0) > (out[pos].indent || 0)) end += 1;
    const branch = out.splice(pos, end - pos);
    const shift = (person.indent || 0) - (branch[0].indent || 0);
    let at = -1;
    for (let back = index - 1; back >= 0 && at < 0; back -= 1) {
      const found = out.findIndex((block) => block.id === before[back].id);
      if (found >= 0) { at = found; if (before[back].id !== home) { while (at + 1 < out.length && (out[at + 1].indent || 0) > (out[found].indent || 0)) at += 1; } }
    }
    out.splice(at + 1, 0, ...branch.map((block) => ({ ...block, indent: (block.indent || 0) + shift })));
  });
}

function humanNote(result, guard) {
  if (!guard || !guard.suggestions) return result;
  return { ...result, suggestions: guard.suggestions, humanKept: guard.kept,
    note: "사람이 고친 문단 " + guard.suggestions + "개는 그대로 두고, 바꾸려던 내용은 그 문단 아래 '업데이트 제안'으로 붙였어요. 사람이 반영하거나 무시해요." };
}

(() => {
  const SUGGESTION = /^\/api\/page\/([^/]+)\/suggestion$/;
  registerFeature({ api: async ({ path, method, request, db, helpers }) => {
    const match = SUGGESTION.exec(path);
    if (!match) return null;
    const { json } = helpers;
    if (method !== "POST") return json({ error: "지원하지 않는 방법이에요." }, 405);
    let slug;
    try { slug = resolveSlug(decodeURIComponent(match[1])); } catch { return json({ error: "주소를 읽지 못했어요." }, 400); }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.block !== "string" || !["accept", "dismiss"].includes(body.action)) return json({ error: "블록과 동작(accept, dismiss)을 보내 주세요." }, 400);
    const found = await readPage(db, slug);
    if (!found) return json({ error: "없는 페이지예요." }, 404);
    const index = found.blocks.findIndex((block) => block.id === body.block);
    const target = found.blocks[index];
    if (!target || !target.meta || !target.meta.suggest) return json({ error: "이미 처리한 제안이에요." }, 404);
    const suggest = target.meta.suggest;
    const meta = { ...target.meta };
    delete meta.suggest;
    const blocks = found.blocks.slice();
    if (body.action === "accept" && suggest.remove) blocks.splice(index, 1);
    else if (body.action === "accept") {
      delete meta.richText;
      blocks[index] = { ...target, type: suggest.type || target.type, text: String(suggest.text ?? ""), meta: { ...meta, ...(suggest.meta || {}), human: { at: Date.now() } } };
    } else blocks[index] = { ...target, meta: Object.keys(meta).length ? meta : null };
    await captureEditorVersion(db, slug);
    const updated = Math.max(Date.now(), Number(found.page.updated) + 1);
    await db.prepare("UPDATE pages SET updated = ?, source = 'editor', hash = NULL WHERE slug = ?").bind(updated, slug).run();
    await saveBlocks(db, slug, normaliseBlocks(blocks));
    return json({ ok: true, updated, action: body.action });
  } });
})();
