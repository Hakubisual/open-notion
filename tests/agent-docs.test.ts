import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '..', 'agent-docs.js'), 'utf8').replace(/^export /gm, '');
const { openapiSpec, llmsTxt, agentsMd } = new Function(
  `${src}\nreturn { openapiSpec, llmsTxt, agentsMd };`,
)();

const origin = 'https://legacy.notes.example.com';
const spec = openapiSpec(origin);

function resolveRef(doc: any, ref: string) {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').reduce((o: any, k) => (o == null ? undefined : o[k]), doc);
}

function collectRefs(node: any, out: string[] = []) {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') out.push(node.$ref);
    Object.values(node).forEach((v) => collectRefs(v, out));
  }
  return out;
}

describe('openapiSpec', () => {
  test('version and security schemes', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.components.securitySchemes.bearer.scheme).toBe('bearer');
    const flow = spec.components.securitySchemes.oauth2.flows.authorizationCode;
    expect(flow.authorizationUrl).toBe(`${origin}/oauth/authorize`);
    expect(flow.tokenUrl).toBe(`${origin}/oauth/token`);
    expect(spec.security).toEqual([{ bearer: [] }, { oauth2: ['read', 'write'] }]);
  });

  test('every contract path and method exists with unique operationIds', () => {
    const contract: [string, string][] = [
      ['/me', 'get'], ['/pages', 'get'], ['/pages', 'post'], ['/pages/{slug}', 'get'], ['/pages/{slug}', 'put'],
      ['/pages/{slug}/append', 'post'], ['/databases', 'get'], ['/databases/{slug}/rows', 'get'],
      ['/databases/{slug}/rows', 'post'], ['/databases/{slug}/rows/{rowId}', 'patch'], ['/decisions', 'get'],
      ['/agent-skills', 'get'], ['/pages/{slug}/blocks', 'get'], ['/pages/{slug}/blocks', 'post'],
      ['/pages/{slug}/blocks/{blockId}', 'patch'], ['/pages/{slug}/blocks/{blockId}', 'delete'],
    ];
    const ids = new Set<string>();
    for (const [path, method] of contract) {
      const op = spec.paths[path]?.[method];
      expect(op, `${method} ${path}`).toBeDefined();
      expect(typeof op.operationId).toBe('string');
      ids.add(op.operationId);
      for (const code of ['401', '403', '404', '409', '413']) {
        const res = op.responses[code];
        const resolved = res.$ref ? resolveRef(spec, res.$ref) : res;
        expect(resolved.content['application/json'].schema.$ref).toBe('#/components/schemas/Error');
      }
    }
    expect(ids.size).toBe(contract.length);
  });

  test('every $ref resolves inside the document', () => {
    const refs = collectRefs(spec);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(resolveRef(spec, r), r).toBeDefined();
  });
});

describe('text documents', () => {
  test('llms.txt shape', () => {
    const t = llmsTxt(origin);
    expect(t.startsWith('# ')).toBe(true);
    expect(t).toContain(`${origin}/mcp`);
  });
  test('AGENTS.md decision marker', () => {
    expect(agentsMd(origin)).toContain('> [!decision]');
  });
});
