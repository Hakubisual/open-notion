// In-memory fake of the Acard REST API (/api/v1/*) used by the CLI tests.
export const TOKEN = "test-token-123";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseMarkdown(md) {
  const m = md.match(FRONTMATTER);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: m ? md.slice(m[0].length) : md };
}

function renderMarkdown(page) {
  const lines = ["---", `title: ${page.title}`, `slug: ${page.slug}`];
  if (page.parent) lines.push(`parent: ${page.parent}`);
  if (page.icon) lines.push(`icon: ${page.icon}`);
  lines.push(`updated: ${new Date(page.updated).toISOString()}`, "---", "");
  return lines.join("\n") + page.body;
}

export function startFakeApi(initialPages) {
  const pages = new Map(initialPages.map((p) => [p.slug, { parent: null, icon: null, kind: "note", ...p }]));
  const requests = [];
  let clock = 1_700_000_000_000;
  const tick = () => (clock += 1000);
  const json = (data, status = 200) => Response.json(data, { status });
  const pendingEdits = new Map();

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      requests.push({ method: req.method, path: url.pathname, search: url.search });
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return json({ error: "invalid token" }, 401);
      const path = url.pathname;
      if (path === "/api/v1/me" && req.method === "GET") return json({ agent: "test-agent", via: "token", scopes: ["read", "write"] });
      if (path === "/api/v1/pages" && req.method === "GET") {
        return json({ pages: [...pages.values()].map(({ slug, title, parent, kind, icon, updated }) => ({ slug, title, parent, kind, icon, updated })) });
      }
      if (path === "/api/v1/pages" && req.method === "POST") {
        const { markdown } = await req.json();
        const { meta, body } = parseMarkdown(markdown);
        let slug = (meta.title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        while (pages.has(slug)) slug += "-1";
        const page = { slug, title: meta.title || "Untitled", parent: meta.parent || null, icon: meta.icon || null, kind: "note", body, updated: tick() };
        pages.set(slug, page);
        return json({ slug, title: page.title, updated: page.updated }, 201);
      }
      const m = path.match(/^\/api\/v1\/pages\/([^/]+)$/);
      if (m) {
        const page = pages.get(decodeURIComponent(m[1]));
        if (!page) return json({ error: "not found" }, 404);
        if (req.method === "GET") {
          if (url.searchParams.get("format") === "markdown") {
            return new Response(renderMarkdown(page), { headers: { "content-type": "text/markdown; charset=utf-8" } });
          }
          const snapshot = { slug: page.slug, title: page.title, parent: page.parent, kind: page.kind, icon: page.icon, updated: page.updated };
          if (pendingEdits.has(page.slug)) {
            page.body = pendingEdits.get(page.slug);
            page.updated = tick();
            pendingEdits.delete(page.slug);
          }
          return json(snapshot);
        }
        if (req.method === "PUT") {
          const { markdown, expectedUpdated } = await req.json();
          if (expectedUpdated !== undefined && page.updated > Number(expectedUpdated)) {
            return json({ error: "page changed" }, 409);
          }
          const { meta, body } = parseMarkdown(markdown);
          page.body = body;
          if (meta.title) page.title = meta.title;
          page.updated = tick();
          return json({ slug: page.slug, updated: page.updated });
        }
      }
      return json({ error: "no route" }, 404);
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    pages,
    requests,
    tick,
    editAfterNextJsonGet: (slug, body) => pendingEdits.set(slug, body),
    stop: () => server.stop(true),
  };
}
