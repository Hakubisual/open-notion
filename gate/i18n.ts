// Language for the hosted site UI copy. English is the default for every first visit, whatever the country (
// Accept-Language and CF-IPCountry are ignored). A choice made with ?lang= or the
// language menu is kept in the acard_lang cookie (signed-in users also get it back from profiles.lang). A signed-in user
// who never chose (no cookie, no profiles.lang) and whose browser asks for Korean first gets Korean (beta #39, issue #59).
import en from "../src/i18n/en.json";
import ko from "../src/i18n/ko.json";
import zh from "../src/i18n/zh.json";

export type Lang = "en" | "ko" | "zh";
export const LANGS: readonly Lang[] = ["en", "ko", "zh"];
export const DICTS: Record<Lang, Record<string, string>> = { en, ko, zh };
export const LANG_COOKIE = "acard_lang";
const HTML_LANG: Record<Lang, string> = { en: "en", ko: "ko", zh: "zh-CN" };

export const isLang = (v: unknown): v is Lang => v === "en" || v === "ko" || v === "zh";

function cookieLang(request: Request): Lang | null {
  const m = /(?:^|;\s*)acard_lang=([a-z]{2})/.exec(request.headers.get("cookie") ?? "");
  return m && isLang(m[1]) ? m[1] : null;
}

export function pickLang(request: Request): Lang {
  return cookieLang(request) ?? "en";
}

// Signed-in pages: the saved choice first, then a Korean browser, then English. Landing and sign-in pages keep pickLang.
export function pickUserLang(request: Request): Lang {
  return cookieLang(request) ?? browserLang(request) ?? "en";
}

// The browser's first language (navigator.language is the first Accept-Language entry): "ko" when it is Korean.
export function browserLang(request: Request): Lang | null {
  let best = "", bestQ = -1;
  for (const part of (request.headers.get("accept-language") ?? "").split(",")) {
    const [tag, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)).find(Boolean);
    const weight = q ? Number(q[1]) : 1;
    if (tag && tag !== "*" && weight > bestQ) { best = tag; bestQ = weight; }
  }
  return best === "ko" || best.startsWith("ko-") ? "ko" : null;
}

export const langCookie = (lang: Lang) => `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;

export function t(lang: Lang, key: string): string {
  return DICTS[lang][key] ?? DICTS.en[key] ?? key;
}

// GET /any/page?lang=xx stores the choice and comes back to the same address without the parameter.
export function langSwitch(request: Request, url: URL): Response | null {
  if (request.method !== "GET" || !url.searchParams.has("lang")) return null;
  const lang = url.searchParams.get("lang");
  if (!isLang(lang) || url.pathname.startsWith("/api/")) return null;
  url.searchParams.delete("lang");
  const qs = url.searchParams.toString();
  return new Response(null, {
    status: 302,
    headers: { location: url.pathname + (qs ? "?" + qs : "") + url.hash, "set-cookie": langCookie(lang), "cache-control": "no-store" },
  });
}

// Pages mark copy with data-i18n="key" (text), data-i18n-html="key" (trusted markup from the dictionary) and
// data-i18n-attr="attr:key;attr:key". Links the beta rewriter turned into waitlist links use "<key>.beta" when it exists.
// Scripts read their strings from window.ACARD_T (keys starting with "js."), injected for the page's language only.
export function translateHtml(res: Response, lang: Lang): Response {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const dict = DICTS[lang];
  const pick = (key: string) => dict[key] ?? DICTS.en[key];
  const js: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict)) if (k.startsWith("js.")) js[k] = v;
  const headers = new Headers(res.headers);
  headers.set("content-language", HTML_LANG[lang]);
  headers.set("vary", "Cookie");
  const out = new HTMLRewriter()
    .on("html", { element(el) { el.setAttribute("lang", HTML_LANG[lang]); } })
    .on("head", { element(el) { el.append(`<script>window.ACARD_LANG=${JSON.stringify(lang)};window.ACARD_T=${JSON.stringify(js).replace(/</g, "\\u003c")}</script>`, { html: true }); } })
    .on("[data-i18n]", {
      element(el) {
        const key = el.getAttribute("data-i18n")!;
        const beta = el.getAttribute("data-beta") === "1" ? pick(key + ".beta") : undefined;
        const value = beta ?? pick(key);
        if (value !== undefined) el.setInnerContent(value);
      },
    })
    .on("[data-i18n-html]", {
      element(el) {
        const value = pick(el.getAttribute("data-i18n-html")!);
        if (value !== undefined) el.setInnerContent(value, { html: true });
      },
    })
    .on("[data-i18n-attr]", {
      element(el) {
        for (const pair of el.getAttribute("data-i18n-attr")!.split(";")) {
          const [attr, key] = pair.split(":").map((s) => s.trim());
          const value = attr && key ? pick(key) : undefined;
          if (value !== undefined) el.setAttribute(attr, value);
        }
      },
    })
    .on(`a[data-lang="${lang}"]`, { element(el) { el.setAttribute("aria-current", "true"); } })
    .transform(new Response(res.body, { status: res.status, headers }));
  return out;
}

// API errors are written in Korean in account.ts / beta.ts; the "err.*" dictionary entries carry the same Korean text,
// so a reply's message/error is looked up by its Korean wording and sent in the caller's language.
const KO_TO_KEY = new Map<string, string>();
for (const [k, v] of Object.entries(ko as Record<string, string>)) if (k.startsWith("err.")) KO_TO_KEY.set(v, k);

export function localizeMessage(text: string, lang: Lang): string {
  if (lang === "ko") return text;
  const key = KO_TO_KEY.get(text);
  return key ? t(lang, key) : text;
}

export async function localizeJson(res: Response, lang: Lang): Promise<Response> {
  if (lang === "ko" || !(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return new Response(text, res); }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    for (const f of ["message", "error"]) if (typeof obj[f] === "string") obj[f] = localizeMessage(obj[f] as string, lang);
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers });
}

export function injectAppLang(res: Response, lang: Lang): Response {
  if (lang === "ko" || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const headers = new Headers(res.headers);
  headers.set("content-language", HTML_LANG[lang]);
  headers.set("vary", "Cookie");
  return new HTMLRewriter()
    .on("html", { element(el) { el.setAttribute("lang", HTML_LANG[lang]); } })
    .on("head", { element(el) { el.prepend(`<script>window.ACARD_LANG=${JSON.stringify(lang)}</script><script src="/i18n-app.js"></script>`, { html: true }); } })
    .transform(new Response(res.body, { status: res.status, statusText: res.statusText, headers }));
}
