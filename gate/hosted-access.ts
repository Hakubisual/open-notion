// Self-host edition: the closed beta (waitlist, invite codes) is part of the hosted service and is not included.
// Same exports as the hosted module so gate/agent-entry.ts compiles unchanged; every site is open to its own accounts.
import { type Session, type TenancyEnv } from "./tenancy";

export type BetaEnv = TenancyEnv & { readonly BETA_MODE?: string };
export const WAITLIST_TOOLS: string[] = [];
export const WAITLIST_USES: string[] = [];
export const pickKeys = (_value: unknown, _allowed: readonly string[]): string[] => [];
export const BETA_API = /^\/api\/(?:beta\/|admin\/beta\/)/;
export const betaClosed = (_env: BetaEnv) => false;
export async function isBetaAdmin(_env: BetaEnv, _session: Session | null): Promise<boolean> { return false; }
export async function hasBetaAccess(_env: BetaEnv, _session: Session): Promise<boolean> { return true; }
export async function betaApi(_request: Request, _env: BetaEnv, _url: URL, _session: Session | null): Promise<Response> {
  return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
}
export function trackSignup(_env: BetaEnv, _session: Session) {}
export function rewriteLanding(res: Response, _env: BetaEnv): Response { return res; }
export function injectAppBeta(res: Response): Response { return res; }
