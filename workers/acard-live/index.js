import { DurableObject } from "cloudflare:workers";

// One LiveFeed per workspace (idFromName("live:" + ws)). The app worker publishes a small change notice after a write
// commits; the feed fans it out to every open WebSocket (or SSE stream) of that workspace. A notice names only the
// slugs and the kinds of change, never page content: clients re-read through their own permission-checked APIs.
// Guest sockets carry the set of slugs they may read and only hear notices about those slugs.
const BACKLOG = 300;
const SSE_KEEPALIVE_MS = 25_000;

export class LiveFeed extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.streams = new Set();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.seq = (await ctx.storage.get("seq")) ?? 0;
      this.backlog = (await ctx.storage.get("backlog")) ?? [];
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") return this.publish(await request.json());
    const since = Number(url.searchParams.get("since") ?? "");
    const scope = parseScope(url.searchParams.get("scope"));
    if (url.pathname === "/ws") {
      if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ scope });
      pair[1].send(JSON.stringify(this.hello(since, scope)));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/sse") return this.sse(since, scope);
    return new Response("not found", { status: 404 });
  }

  hello(since, scope) {
    const oldest = this.backlog.length ? this.backlog[0].id : this.seq + 1;
    const known = Number.isFinite(since) && since > 0;
    // A client that missed more than the backlog holds (or a feed that restarted) does one full catch-up fetch.
    const reset = known && (since < oldest - 1 || since > this.seq);
    const missed = known && !reset ? this.backlog.filter((e) => e.id > since).map((e) => visible(e, scope)).filter(Boolean) : [];
    return { type: "hello", id: this.seq, reset, missed };
  }

  async publish(body) {
    const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k) => typeof k === "string").slice(0, 12) : [];
    const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s) => typeof s === "string").slice(0, 50) : [];
    if (!kinds.length) return Response.json({ ok: false }, { status: 400 });
    this.seq += 1;
    const event = { id: this.seq, t: Date.now(), kinds, slugs, src: typeof body.src === "string" ? body.src.slice(0, 40) : "" };
    this.backlog.push(event);
    if (this.backlog.length > BACKLOG) this.backlog.splice(0, this.backlog.length - BACKLOG);
    await this.ctx.storage.put({ seq: this.seq, backlog: this.backlog });
    let sent = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const shown = visible(event, (socket.deserializeAttachment() || {}).scope ?? null);
      if (!shown) continue;
      try { socket.send(JSON.stringify({ type: "change", ...shown })); sent += 1; } catch { /* closing socket */ }
    }
    for (const stream of this.streams) {
      const shown = visible(event, stream.scope);
      if (shown) { stream.write("id: " + event.id + "\ndata: " + JSON.stringify({ type: "change", ...shown }) + "\n\n"); sent += 1; }
    }
    return Response.json({ ok: true, id: event.id, sent });
  }

  sse(since, scope) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const stream = { scope, write: (text) => writer.write(encoder.encode(text)).catch(() => this.drop(stream)) };
    stream.timer = setInterval(() => stream.write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
    stream.close = () => { clearInterval(stream.timer); writer.close().catch(() => {}); };
    this.streams.add(stream);
    stream.write("retry: 3000\ndata: " + JSON.stringify(this.hello(since, scope)) + "\n\n");
    return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }

  drop(stream) {
    if (!this.streams.delete(stream)) return;
    clearInterval(stream.timer);
  }

  webSocketMessage(socket, message) {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket, code) {
    try { socket.close(code === 1005 ? 1000 : code, "bye"); } catch { /* already closed */ }
  }

  webSocketError() {}
}

function parseScope(raw) {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

// Members (scope null) see every notice. A guest sees a notice only when it names a page it may read, and then only
// those slugs; a notice naming no slug (settings, home cards) is never shown to guests.
export function visible(event, scope) {
  if (scope === null || scope === undefined) return event;
  const allowed = new Set(scope);
  const slugs = event.slugs.filter((s) => allowed.has(s));
  if (!slugs.length) return null;
  return { ...event, slugs, kinds: event.kinds.filter((k) => k === "page" || k === "tree" || k === "title" || k === "deleted") };
}

export default {
  fetch() {
    return new Response("acard-live has no public routes", { status: 404 });
  },
};
