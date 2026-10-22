// Canonical URLs use the constant site origin, never the request Host, so alias hosts and ?v= / ?utm_ links all point at
// one address: no query or fragment, no trailing slash except the root (features/share.js follows the same rule).
export const SITE_ORIGIN = "https://notes.example.com";

export const PUBLIC_PAGES: Record<string, string[]> = {
  "/": ["index.html"],
  "/download": ["download.html"],
  "/privacy": ["privacy.html", "privacy.en.html", "privacy.zh.html"],
  "/terms": ["terms.html", "terms.en.html", "terms.zh.html"],
};

export function canonicalUrl(path: string): string {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "");
  return SITE_ORIGIN + (bare || "/");
}

// Signed-in, account and agent surfaces. Shared /p/ links stay crawlable so their noindex header is seen.
const PRIVATE_PREFIXES = ["/api/", "/admin", "/settings", "/onboarding", "/beta", "/login", "/signup", "/forgot", "/reset", "/s/", "/cloud/", "/mcp", "/sse", "/oauth/", "/__"];

export function robotsTxt(): string {
  return ["User-agent: *", "Allow: /", ...PRIVATE_PREFIXES.map((p) => "Disallow: " + p), "", "Sitemap: " + SITE_ORIGIN + "/sitemap.xml", ""].join("\n");
}

export function sitemapXml(): string {
  const urls = Object.keys(PUBLIC_PAGES).map((path) => "  <url><loc>" + canonicalUrl(path) + "</loc></url>");
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, "</urlset>", ""].join("\n");
}

export function seoResponse(body: string, type: string): Response {
  return new Response(body, { headers: { "content-type": type + "; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
