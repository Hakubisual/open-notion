// Self-host edition: no paid subscription. Same exports as the hosted module so gate/agent-entry.ts compiles unchanged.
export type BillingEnv = Record<string, unknown>;
export const BILLING_ROUTES = /^\/(?:billing\/(?:checkout|done)|api\/billing\/webhook)\/?$/;
const none = () => new Response(JSON.stringify({ error: "This server does not sell subscriptions." }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
export async function checkoutFor(_env: BillingEnv, _userId: string, _email: string | null, _origin: string): Promise<Response> { return none(); }
export async function webhook(_request: Request, _env: BillingEnv): Promise<Response> { return none(); }
export function donePage(): Response { return none(); }
