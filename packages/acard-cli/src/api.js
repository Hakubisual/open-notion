export const DEFAULT_SERVER = "https://notes.example.com";

export class ApiError extends Error {
  constructor(status, error) {
    super(`HTTP ${status}: ${error}`);
    this.status = status;
    this.error = error;
  }
}

export function makeConfig({ server, env = process.env }) {
  const base = (server || env.ACARD_URL || DEFAULT_SERVER).replace(/\/+$/, "");
  return { server: base, token: env.ACARD_TOKEN || "" };
}

export function authHeaders(cfg) {
  return cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
}

/** Calls the Acard REST API. Returns parsed JSON, or text when `text` is set. Throws ApiError on non-2xx. */
export async function request(cfg, method, path, { body, text = false } = {}) {
  const headers = { ...authHeaders(cfg), Accept: text ? "text/markdown, text/plain, */*" : "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(cfg.server + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    let error = raw.trim() || res.statusText;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.error !== undefined) error = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
    } catch {}
    throw new ApiError(res.status, error);
  }
  if (text) return raw;
  return raw ? JSON.parse(raw) : null;
}

export const pagePath = (slug) => `/api/v1/pages/${encodeURIComponent(slug)}`;
