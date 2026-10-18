// Pure sharing resolver. No I/O: features/share.js loads the model from the workspace DB and every
// non-owner route asks this file. Route table and rules: research/share/routes.md.
// The worker inlines this file (imports/exports stripped); tests import it directly.

export const SHARE_ROLES = ["none", "read", "comment", "edit", "full"];
export const GUEST_ROLES = ["full", "edit", "comment", "read"];
export const AGENT_LEVELS = ["none", "read", "write"];

export function shareRank(role) {
  const index = SHARE_ROLES.indexOf(role);
  return index < 0 ? 0 : index;
}

export function shareAtLeast(role, need) {
  return shareRank(role) >= shareRank(need);
}

// model = { parents: Map<slug, parent|null> (live pages only), inherit: Map<slug, boolean>,
//           subpages: Map<slug, boolean> (publish 하위 페이지), rules: [{ id, page, principal, role, expires }], now }
export function shareChain(model, slug) {
  const chain = [];
  const seen = new Set();
  let current = slug;
  while (current && !seen.has(current) && model.parents.has(current)) {
    seen.add(current);
    chain.push(current);
    if (model.inherit.get(current) === false) break;
    current = model.parents.get(current);
  }
  return chain;
}

export function ruleActive(rule, now) {
  return !(rule.expires !== null && rule.expires !== undefined && Number(rule.expires) <= now);
}

function rulesOn(model, page) {
  if (!model.byPage) {
    model.byPage = new Map();
    for (const rule of model.rules) {
      if (!model.byPage.has(rule.page)) model.byPage.set(rule.page, []);
      model.byPage.get(rule.page).push(rule);
    }
  }
  return model.byPage.get(page) || [];
}

// Human principals: { kind: "owner" } | { kind: "guest", email, links: Set<rule id> } | { kind: "token", rule }.
// A link rule's comment/edit level needs a verified guest who opened that link (its id is in the session), so link
// pages never show up in other guests' trees; anonymous link and publish visitors only read.
export function shareRole(model, slug, who) {
  if (!model.parents.has(slug)) return "none";
  if (who.kind === "owner") return "full";
  const chain = shareChain(model, slug);
  if (who.kind === "guest") {
    const email = "email:" + String(who.email || "").toLowerCase();
    let best = "none";
    for (const page of chain) {
      for (const rule of rulesOn(model, page)) {
        const mine = rule.principal === email || (rule.principal === "link" && Boolean(who.links && who.links.has(rule.id)));
        if (mine && ruleActive(rule, model.now) && shareRank(rule.role) > shareRank(best)) best = rule.role;
      }
    }
    return best;
  }
  if (who.kind === "token") {
    const rule = who.rule;
    if (!rule || !ruleActive(rule, model.now) || !(rule.principal === "link" || rule.principal === "publish")) return "none";
    if (rule.page === slug) return "read";
    const inherits = rule.principal === "link" || model.subpages.get(rule.page) === true;
    return inherits && chain.includes(rule.page) ? "read" : "none";
  }
  return "none";
}

// Agents: the nearest per-page rule only ever narrows the token's own scopes.
export function agentScopes(model, slug, key, scopes) {
  const own = (scopes || []).filter((scope) => scope === "read" || scope === "write");
  if (!model.parents.has(slug)) return own;
  const principal = "agent:" + key;
  for (const page of shareChain(model, slug)) {
    const rule = rulesOn(model, page).find((entry) => entry.principal === principal && ruleActive(entry, model.now));
    if (!rule) continue;
    if (rule.role === "none") return [];
    if (rule.role === "read") return own.filter((scope) => scope === "read");
    return own;
  }
  return own;
}

export function readablePages(model, who) {
  const out = new Set();
  for (const slug of model.parents.keys()) if (shareAtLeast(shareRole(model, slug, who), "read")) out.add(slug);
  return out;
}

// "다른 사람에게 표시되는 내용": every human principal with its effective role and where it comes from.
export function describeAccess(model, slug) {
  const best = new Map();
  for (const page of shareChain(model, slug)) {
    for (const rule of rulesOn(model, page)) {
      if (rule.principal.startsWith("agent:") || !ruleActive(rule, model.now)) continue;
      const known = best.get(rule.principal);
      if (!known || shareRank(rule.role) > shareRank(known.role)) best.set(rule.principal, { ...rule, inherited: page !== slug });
    }
  }
  return [...best.values()];
}

// Moving a page: true when the new place shares it with someone who cannot see it now.
export function moveWidensSharing(model, slug, parent) {
  const before = new Set(describeAccess(model, slug).map((rule) => rule.principal));
  const moved = { ...model, parents: new Map(model.parents), byPage: undefined };
  moved.parents.set(slug, parent);
  return describeAccess(moved, slug).some((rule) => !before.has(rule.principal));
}
