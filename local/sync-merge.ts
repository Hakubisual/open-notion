// Three-way merge of one page for multi-device sync (docs/local-first.md 14장 충돌 규칙).
// base = the copy both devices last agreed on (null on a first connect), local = this PC, remote = the server copy.
// Edits to different blocks or fields are combined. When the same block was changed differently on both sides (or
// changed on one side and deleted on the other), the page edited last wins as a whole and the other side's full page is
// returned as `copy`, which the caller saves as a "(충돌 사본)" page, so no content is lost.

export type SyncBlock = { id: string; type: string; text: string; checked: number; indent: number; meta: string | null };
export type SyncDoc = {
  page: { slug: string; title: string; parent: string | null; ord: number; kind: string; updated: number };
  blocks: SyncBlock[];
  links: string[];
  settings: Record<string, unknown> | null;
  view: Record<string, unknown> | null;
  tags: string[];
};
export type Side = { deleted: boolean; doc: SyncDoc | null };
export type MergeResult = { deleted: boolean; doc: SyncDoc | null; copy: SyncDoc | null; winner: "local" | "remote" | "merged" };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blockBody = (b: SyncBlock | undefined) => (b ? [b.type, b.text, Number(b.checked) ? 1 : 0, Number(b.indent) || 0, b.meta ?? null] : null);
const sameBlock = (a: SyncBlock | undefined, b: SyncBlock | undefined) => same(blockBody(a), blockBody(b));

function pick<T>(base: T, local: T, remote: T, localNewer: boolean): T {
  if (same(local, remote) || same(remote, base)) return local;
  if (same(local, base)) return remote;
  return localNewer ? local : remote;
}

function mergeBlocks(base: SyncBlock[] | null, local: SyncBlock[], remote: SyncBlock[]): SyncBlock[] | null {
  const b = new Map((base ?? []).map((x) => [x.id, x]));
  const l = new Map(local.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  const kept = new Map<string, SyncBlock>();
  for (const id of new Set([...l.keys(), ...r.keys()])) {
    const lb = l.get(id), rb = r.get(id), bb = b.get(id);
    if (lb && rb) {
      if (sameBlock(lb, rb) || sameBlock(rb, bb)) kept.set(id, lb);
      else if (sameBlock(lb, bb)) kept.set(id, rb);
      else return null;
    } else if (lb) {
      if (!bb) kept.set(id, lb);
      else if (!sameBlock(lb, bb)) return null;
    } else if (rb) {
      if (!bb) kept.set(id, rb);
      else if (!sameBlock(rb, bb)) return null;
    }
  }
  const baseOrder = (base ?? []).map((x) => x.id).filter((id) => l.has(id));
  const localKeepsBaseOrder = same(local.map((x) => x.id).filter((id) => b.has(id)), baseOrder);
  const [primary, secondary] = localKeepsBaseOrder ? [remote, local] : [local, remote];
  const order = primary.map((x) => x.id).filter((id) => kept.has(id));
  const placed = new Set(order);
  secondary.forEach((x, i) => {
    if (placed.has(x.id) || !kept.has(x.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = order.indexOf(secondary[j].id); if (k >= 0) { at = k + 1; break; } }
    order.splice(at, 0, x.id);
    placed.add(x.id);
  });
  return order.map((id) => kept.get(id)!);
}

export function mergePage(base: Side | null, local: Side, remote: Side): MergeResult {
  const localNewer = (local.doc?.page.updated ?? 0) > (remote.doc?.page.updated ?? 0);
  if (local.deleted && remote.deleted) return { deleted: true, doc: remote.doc ?? local.doc, copy: null, winner: "remote" };
  // A deleted page loses to an edit on the other side: the edit wins and the page comes back.
  if (remote.deleted) return { deleted: false, doc: local.doc, copy: null, winner: "local" };
  if (local.deleted) return { deleted: false, doc: remote.doc, copy: null, winner: "remote" };
  const l = local.doc!, r = remote.doc!, b = base && !base.deleted ? base.doc : null;
  const blocks = mergeBlocks(b ? b.blocks : null, l.blocks, r.blocks);
  if (!blocks) {
    const [win, lose] = localNewer ? [l, r] : [r, l];
    return { deleted: false, doc: win, copy: lose, winner: localNewer ? "local" : "remote" };
  }
  const field = <K extends keyof SyncDoc["page"]>(k: K) => pick(b?.page[k], l.page[k], r.page[k], localNewer);
  const doc: SyncDoc = {
    page: { slug: l.page.slug, title: String(field("title")), parent: (field("parent") as string | null) ?? null, ord: Number(field("ord")), kind: l.page.kind, updated: Math.max(l.page.updated, r.page.updated) },
    blocks,
    links: [...new Set([...l.links, ...r.links])].sort(),
    settings: pick(b?.settings ?? null, l.settings, r.settings, localNewer),
    view: pick(b?.view ?? null, l.view, r.view, localNewer),
    tags: pick(b?.tags ?? [], l.tags, r.tags, localNewer),
  };
  return { deleted: false, doc, copy: null, winner: "merged" };
}
