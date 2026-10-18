// Images that writers send as outside links become Acard media on every agent write path (create/update/append page,
// block edits, journal visuals, chat-agent pages) and on the editor's "이미지로 넣기": http(s) URLs are fetched
// server-side (public hosts only, <= 3 redirects, 4 MB, image bytes only), data: URIs are decoded, and the link is
// rewritten to /media/<id>. A failure keeps the original link and becomes a warning; the write itself never fails.
(() => {
  const MAX = 4 * 1024 * 1024, HOPS = 3, TIMEOUT_MS = 8000, PER_WRITE = 20;
  const LOCAL = /^(?:file:|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?:Users|home|tmp|var|private|mnt|root|Volumes)\/)/;
  const BARE = /^[^:/\\?#]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;
  const INLINE = /!\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

  function ipv4Private(ip) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  function ipv6Private(ip) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return ipv4Private(mapped[1]);
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8") || v.startsWith("::");
  }
  // True when the address is not a public unicast address (loopback, RFC 1918, link-local, CGNAT, multicast, ...).
  function privateAddress(ip) {
    return String(ip).includes(":") ? ipv6Private(String(ip)) : ipv4Private(String(ip));
  }

  // The hostname must be a name (no IP literal, no localhost/.local) and every A/AAAA answer must be public.
  async function publicHost(hostname) {
    if (isBlockedHost(hostname)) return false;
    const answers = [];
    for (const type of ["A", "AAAA"]) {
      const res = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(hostname) + "&type=" + type, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return false;
      const body = await res.json().catch(() => ({}));
      for (const a of body.Answer || []) if (a.type === 1 || a.type === 28) answers.push(String(a.data));
    }
    return answers.length > 0 && !answers.some(privateAddress);
  }

  async function readCapped(response) {
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX) throw new Error("4MB 보다 커요");
    const reader = response.body ? response.body.getReader() : null;
    if (!reader) return new ArrayBuffer(0);
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX) { await reader.cancel().catch(() => {}); throw new Error("4MB 보다 커요"); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out.buffer;
  }

  async function fetchImage(raw) {
    let url;
    try { url = new URL(raw); } catch { throw new Error("주소를 읽지 못했어요"); }
    for (let hop = 0; hop <= HOPS; hop++) {
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("http(s) 주소만 가져와요");
      if (url.username || url.password) throw new Error("로그인 정보가 든 주소는 가져오지 않아요");
      if (url.port && !["80", "443"].includes(url.port)) throw new Error("80/443 포트만 가져와요");
      if (!(await publicHost(url.hostname))) throw new Error("공개 인터넷 주소가 아니라 가져오지 않았어요");
      const res = await fetch(url.href, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8", "user-agent": "AcardImageFetcher/1.0 (+https://notes.example.com)" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        url = new URL(res.headers.get("location"), url);
        continue;
      }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error("상대 서버가 " + res.status + " 을 돌려줬어요"); }
      return { bytes: await readCapped(res), type: res.headers.get("content-type") || "", url: url.href };
    }
    throw new Error("리다이렉트가 " + HOPS + "번을 넘었어요");
  }

  function decodeDataUri(raw) {
    const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(raw);
    if (!m) throw new Error("data: 주소를 읽지 못했어요");
    if (!/;base64/i.test(m[2])) {
      const text = decodeURIComponent(m[3]);
      if (text.length > MAX) throw new Error("4MB 보다 커요");
      return { bytes: new TextEncoder().encode(text).buffer, type: m[1] };
    }
    const clean = m[3].replace(/\s+/g, "");
    if (clean.length > Math.ceil(MAX / 3) * 4 + 4) throw new Error("4MB 보다 커요");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { bytes: out.buffer, type: m[1] };
  }

  const nameOf = (src) => { try { return decodeURIComponent(new URL(src).pathname.split("/").pop() || "") || "image"; } catch { return "image"; } };
  const isLocal = (src) => LOCAL.test(src) || BARE.test(src);
  const wants = (src) => /^(?:https?:|data:)/i.test(src) || isLocal(src);

  async function importOne(store, page, src) {
    if (isLocal(src)) throw new Error("local image path found - upload it with upload_media (or the acard CLI bridge), then use the /media/ url");
    const got = /^data:/i.test(src) ? decodeDataUri(src) : await fetchImage(src);
    const saved = await store(page, /^data:/i.test(src) ? "image" : nameOf(src), null, got.bytes, /^data:/i.test(src) ? "data:" + (got.type || "") : src);
    return saved.url;
  }

  async function ingestImages(db, page, blocks, store) {
    const warnings = [], done = new Map(), claim = new Set();
    let budget = PER_WRITE;
    const convert = async (src) => {
      if (/^\/media\//.test(src)) { claim.add(src.slice(7).split(/[?#]/)[0]); return src; }
      if (!wants(src)) return src;
      if (done.has(src)) return done.get(src);
      let out = src;
      if (budget-- <= 0) warnings.push({ src: src.slice(0, 200), error: "한 번에 " + PER_WRITE + "개까지만 가져와요" });
      else {
        try { out = await importOne(store, page, src); }
        catch (error) { warnings.push({ src: src.slice(0, 200), error: String(error && error.message || error) }); }
      }
      done.set(src, out);
      return out;
    };
    for (const block of blocks || []) {
      if (block.type === "image" && block.meta && typeof block.meta.src === "string") block.meta.src = await convert(block.meta.src);
      if (typeof block.text === "string" && block.text.includes("![")) {
        let text = block.text;
        for (const m of [...block.text.matchAll(INLINE)]) {
          const next = await convert(m[2]);
          if (next !== m[2]) text = text.replace(m[0], "![" + m[1] + "](" + next + m[3] + ")");
        }
        block.text = text;
      }
    }
    for (const id of claim) await db.prepare("UPDATE media SET page = ? WHERE id = ? AND page IS NULL").bind(page, id).run().catch(() => {});
    return warnings;
  }

  function sanitizeSvg(text) {
    let s = String(text).replace(/<!DOCTYPE[\s\S]*?(?:\[[\s\S]*?\])?\s*>/gi, "").replace(/<!ENTITY[\s\S]*?>/gi, "").replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, "");
    for (const tag of ["script", "foreignObject", "iframe", "embed", "object", "handler", "listener", "audio", "video", "canvas"]) {
      s = s.replace(new RegExp("<" + tag + "\\b[\\s\\S]*?<\\/" + tag + "\\s*>", "gi"), "").replace(new RegExp("<" + tag + "\\b[^>]*\\/?>", "gi"), "");
    }
    s = s.replace(/<(set|animate\w*)\b[^>]*attributeName\s*=\s*["']?(?:xlink:)?href[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi, "");
    s = s.replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    s = s.replace(/\s((?:xlink:)?href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (all, name, value) => {
      const v = value.replace(/^["']|["']$/g, "").trim();
      return v.startsWith("#") || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(v) ? all : "";
    });
    s = s.replace(/@import[^;]*;?/gi, "").replace(/url\(\s*(?!["']?#)[^)]*\)/gi, "none").replace(/javascript:/gi, "");
    return s;
  }

  registerFeature({ services: { ingestImages, fetchImage, sanitizeSvg, privateAddress } });
})();
