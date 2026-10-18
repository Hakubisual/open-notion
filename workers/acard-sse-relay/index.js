import { DurableObject } from "cloudflare:workers";

const KEEPALIVE_MS = 25_000;

export class SseRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.writer = null;
    this.keepalive = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/open") return this.open(url);
    if (url.pathname === "/owner") return Response.json({ owner: (await this.ctx.storage.get("owner")) ?? null });
    if (url.pathname === "/send") return this.send(await request.text());
    return new Response("not found", { status: 404 });
  }

  async open(url) {
    const owner = url.searchParams.get("owner");
    const endpoint = url.searchParams.get("endpoint");
    if (!owner || !endpoint) return new Response("bad request", { status: 400 });
    await this.ctx.storage.put("owner", owner);
    const { readable, writable } = new TransformStream();
    this.writer = writable.getWriter();
    this.write("event: endpoint\ndata: " + endpoint + "\n\n");
    this.keepalive = setInterval(() => this.write(": keepalive\n\n"), KEEPALIVE_MS);
    return new Response(readable, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
    });
  }

  async send(message) {
    if (!this.writer) return new Response("stream closed", { status: 410 });
    const ok = await this.write("event: message\ndata: " + message.replace(/\r?\n/g, " ") + "\n\n");
    return ok ? new Response(null, { status: 202 }) : new Response("stream closed", { status: 410 });
  }

  async write(text) {
    try {
      await this.writer.write(new TextEncoder().encode(text));
      return true;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      clearInterval(this.keepalive);
      this.writer = null;
      await this.ctx.storage.deleteAll();
      return false;
    }
  }
}

export default {
  fetch() {
    return new Response("acard-sse-relay has no public routes", { status: 404 });
  },
};
