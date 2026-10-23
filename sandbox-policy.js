// One sandbox policy for every frame that runs code a person, an agent or a plugin wrote (#144, refs #38 #21).
// HTML / visual blocks and parts run in an opaque-origin frame on notes.example.com (sandbox="allow-scripts", no
// allow-same-origin) under FRAME_BASE_CSP. Acard plugins run on a separate site (the sandbox host, a workers.dev
// Worker) under pluginFrameCsp(), which is FRAME_BASE_CSP made narrower: the inline script is pinned by hash, the only
// additions are a blob: worker for the plugin code, the network hosts its manifest declares (none by default), the
// pages allowed to embed it and the sandbox flag itself. sandboxCspProblems() checks that relation; the tests run it.
// Dependency-free: inlined into the worker (build.ts, tests/assemble-worker.ts), bundled into the editor chunks, imported
// by the sandbox Worker (workers/acard-plugin-sandbox) and the plugin SDK.

export const SANDBOX_ATTR = "allow-scripts";
export const FRAME_BASE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";

// Hosts a plugin may never declare: Acard itself, the sandbox host's own site, other app/preview hosting and local names.
const SANDBOX_DENY_HOST = /(^|\.)(notes\.example\.com|workers\.dev|pages\.dev|localhost|local|internal|invalid|arpa)$/;
const SANDBOX_HOST = /^(\*\.)?(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const SANDBOX_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{2,5})?$/;
const SANDBOX_HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;
export const SANDBOX_MAX_HOSTS = 5;

// "api.example.com" or "*.example.com" -> the CSP source "https://api.example.com"; anything else -> null.
export function sandboxNetworkSource(raw) {
  const host = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!SANDBOX_HOST.test(host) || SANDBOX_DENY_HOST.test(host.replace(/^\*\./, ""))) return null;
  return "https://" + host;
}

// The response-header CSP of a plugin frame. Throws on any input that would widen it, so a bad manifest can never
// produce a weaker policy: the caller validated the manifest already, this is the last line.
export function pluginFrameCsp({ network = [], bootHash, ancestors = [] } = {}) {
  if (!SANDBOX_HASH.test(String(bootHash || ""))) throw new Error("pluginFrameCsp: bootHash must be sha256-<base64>");
  if (!Array.isArray(network) || network.length > SANDBOX_MAX_HOSTS) throw new Error("pluginFrameCsp: at most " + SANDBOX_MAX_HOSTS + " network hosts");
  if (!Array.isArray(ancestors) || !ancestors.length || ancestors.some((a) => !SANDBOX_ORIGIN.test(String(a)))) throw new Error("pluginFrameCsp: ancestors must be exact https origins");
  const hosts = network.map((h) => { const s = sandboxNetworkSource(h); if (!s) throw new Error("pluginFrameCsp: host not allowed: " + h); return s; });
  return [
    "sandbox " + SANDBOX_ATTR,
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    "script-src '" + bootHash + "'",
    "font-src data:",
    "worker-src blob:",
    "connect-src " + (hosts.length ? [...new Set(hosts)].join(" ") : "'none'"),
    "frame-ancestors " + [...new Set(ancestors)].join(" "),
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function sandboxCspDirectives(csp) {
  const out = new Map();
  for (const part of String(csp).split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), sources);
  }
  return out;
}

// Problems that make `csp` wider than `base` (FRAME_BASE_CSP by default); [] means every directive of base is the same
// or narrower and the only new directives are the plugin additions. A hash source is narrower than 'unsafe-inline'.
export function sandboxCspProblems(csp, base = FRAME_BASE_CSP) {
  const have = sandboxCspDirectives(csp), want = sandboxCspDirectives(base), problems = [];
  const fallback = have.get("default-src") ?? ["'none'"];
  for (const [name, allowed] of want) {
    const got = have.get(name) ?? fallback;
    for (const source of got) {
      if (allowed.includes(source)) continue;
      if (source === "'none'") continue;
      if (/^'sha256-/.test(source) && allowed.includes("'unsafe-inline'")) continue;
      problems.push(name + " adds " + source);
    }
  }
  const extra = { "worker-src": (s) => s === "blob:", "connect-src": (s) => s === "'none'" || (s.startsWith("https://") && sandboxNetworkSource(s.slice(8)) === s),
    "frame-ancestors": (s) => SANDBOX_ORIGIN.test(s), "base-uri": (s) => s === "'none'", "form-action": (s) => s === "'none'", sandbox: (s) => s === SANDBOX_ATTR };
  for (const [name, got] of have) {
    if (want.has(name)) continue;
    const ok = extra[name];
    if (!ok) { problems.push("unexpected directive " + name); continue; }
    for (const source of got) if (!ok(source)) problems.push(name + " adds " + source);
  }
  if (have.has("sandbox") && have.get("sandbox").length !== 1) problems.push("sandbox must be exactly " + SANDBOX_ATTR);
  return problems;
}
