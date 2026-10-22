import { afterEach, expect, test } from "bun:test";
import { accountApi, signGoogleState } from "../gate/account";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const SUPA = "https://supa.test";
const env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon",
  SITE_URL: "https://notes.example.com", GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "gsecret",
};
const call = (href: string, cookie = "", extra = {}) => {
  const url = new URL(href);
  return accountApi(new Request(url, { headers: cookie ? { cookie } : {} }), { ...env, ...extra } as any, url);
};
const cookiesOf = (res: Response) => Object.fromEntries(res.headers.getSetCookie().map((c) => {
  const [pair] = c.split(";"); const at = pair.indexOf("=");
  return [pair.slice(0, at), decodeURIComponent(pair.slice(at + 1))];
}));
const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function start(origin = "https://notes.example.com", next = "/edit/x") {
  const res = await call(`${origin}/api/auth/google?next=${encodeURIComponent(next)}`);
  const jar = cookiesOf(res);
  const to = new URL(res.headers.get("location")!);
  return { res, to, jar, cookie: `acard_gauth=${encodeURIComponent(jar.acard_gauth)}; acard_next=${encodeURIComponent(jar.acard_next)}` };
}

type Seen = { google?: URLSearchParams; gotrue?: any };
function mockUpstream(seen: Seen, google = () => Response.json({ id_token: "header.payload.sig", access_token: "g" }), gotrue = () => Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })) {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://oauth2.googleapis.com/token") { seen.google = new URLSearchParams(String(init.body)); return google(); }
    if (url === SUPA + "/auth/v1/token?grant_type=id_token") { seen.gotrue = JSON.parse(init.body); return gotrue(); }
    throw new Error("unexpected fetch " + url);
  }) as typeof fetch;
}

test("the Google screen is asked for notes.example.com's own callback, with a hashed nonce and S256 PKCE", async () => {
  const { res, to, jar } = await start();
  expect(res.status).toBe(303);
  expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(to.searchParams.get("redirect_uri")).toBe("https://notes.example.com/api/auth/google/callback");
  expect(to.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
  expect(to.searchParams.get("scope")).toBe("openid email profile");
  const [, verifier, nonce] = jar.acard_gauth.split(".");
  expect(to.searchParams.get("nonce")).toBe(await hex(nonce));
  expect(to.searchParams.get("code_challenge")).toBe(b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  expect(jar.acard_next).toBe("/edit/x");
  expect(res.headers.getSetCookie().every((c) => c.includes("HttpOnly") && c.includes("Max-Age=600"))).toBe(true);
});

test("without the Google secrets the old Supabase flow is unchanged (rollback)", async () => {
  const res = await call("https://notes.example.com/api/auth/google", "", { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
  expect(res.headers.get("location")).toStartWith(SUPA + "/auth/v1/authorize?");
});

test("callback success: Google gets the verifier, GoTrue the raw nonce, and the usual session cookies are set", async () => {
  const { to, jar, cookie } = await start();
  const seen: Seen = {};
  mockUpstream(seen);
  const res = await call(`https://notes.example.com/api/auth/google/callback?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=gcode`, cookie);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/edit/x");
  const [, verifier, nonce] = jar.acard_gauth.split(".");
  expect(seen.google?.get("code")).toBe("gcode");
  expect(seen.google?.get("code_verifier")).toBe(verifier);
  expect(seen.google?.get("redirect_uri")).toBe("https://notes.example.com/api/auth/google/callback");
  expect(seen.gotrue).toEqual({ provider: "google", id_token: "header.payload.sig", nonce });
  const set = cookiesOf(res);
  expect([set.acard_at, set.acard_rt, set.acard_gauth, set.acard_next]).toEqual(["AT", "RT", "", ""]);
  expect(res.headers.get("clear-site-data")).toBe('"cache"');
});

test("a bad state (tampered, other key, expired, missing) never reaches Google or GoTrue", async () => {
  const { to, cookie } = await start();
  const good = to.searchParams.get("state")!;
  const [body] = good.split(".");
  const id = cookie.match(/acard_gauth=([^.;]+)/)![1];
  const states = [
    "", body + ".AAAA", good + ".x",
    await signGoogleState("other-secret", { h: "https://notes.example.com", i: id, x: Date.now() + 60_000 }),
    await signGoogleState(env.GOOGLE_CLIENT_SECRET, { h: "https://notes.example.com", i: id, x: Date.now() - 1 }),
  ];
  globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as any;
  for (const state of states) {
    const res = await call(`https://notes.example.com/api/auth/google/callback?state=${encodeURIComponent(state)}&code=gcode`, cookie);
    expect([state, res.headers.get("location")]).toEqual([state, "/login?e=oauth"]);
    expect(cookiesOf(res).acard_at).toBeUndefined();
  }
});

test("a missing or foreign verifier cookie fails without exchanging the code", async () => {
  const first = await start();
  const second = await start();
  globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as any;
  const state = encodeURIComponent(first.to.searchParams.get("state")!);
  for (const cookie of ["", "acard_next=%2F", second.cookie]) {
    const res = await call(`https://notes.example.com/api/auth/google/callback?state=${state}&code=gcode`, cookie);
    expect(res.headers.get("location")).toBe("/login?e=oauth");
  }
  const denied = await call(`https://notes.example.com/api/auth/google/callback?state=${state}&error=access_denied`, first.cookie);
  expect(denied.headers.get("location")).toBe("/login?e=oauth");
});

test("an id_token exchange failure (Google or GoTrue) ends at /login?e=oauth with no session", async () => {
  const { to, cookie } = await start();
  const href = `https://notes.example.com/api/auth/google/callback?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=gcode`;
  for (const [google, gotrue] of [
    [() => Response.json({ error: "invalid_grant" }, { status: 400 }), undefined],
    [undefined, () => Response.json({ error_code: "bad_oauth_callback", msg: "Nonces mismatch" }, { status: 400 })],
  ] as const) {
    const seen: Seen = {};
    mockUpstream(seen, google, gotrue);
    const res = await call(href, cookie);
    expect(res.headers.get("location")).toBe("/login?e=oauth");
    expect(cookiesOf(res).acard_at).toBeUndefined();
    expect(cookiesOf(res).acard_gauth).toBe("");
  }
});

test("a login started on another host comes back to that host with the one-time code, which only works there", async () => {
  const preview = "https://lane.notes-example.pages.dev";
  const { to, cookie } = await start(preview, "/");
  expect(to.searchParams.get("redirect_uri")).toBe("https://notes.example.com/api/auth/google/callback");
  const query = `?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=gcode`;
  globalThis.fetch = (async () => { throw new Error("must not fetch on notes.example.com"); }) as any;
  const hop = await call("https://notes.example.com/api/auth/google/callback" + query, "");
  expect(hop.headers.get("location")).toBe(preview + "/api/auth/google/callback" + query);
  expect(hop.headers.getSetCookie()).toEqual([]);
  const seen: Seen = {};
  mockUpstream(seen);
  const back = await call(hop.headers.get("location")!, cookie);
  expect(cookiesOf(back).acard_at).toBe("AT");
  expect(seen.google?.get("redirect_uri")).toBe("https://notes.example.com/api/auth/google/callback");
});
