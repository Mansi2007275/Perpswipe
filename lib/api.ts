// Shared bits of every route handler: one JSON shape, one rate-limit gate, one
// "is the database even configured" answer.
import { serverDbConfigured } from "./env";
import { clientIp, rateLimit, WRITE_LIMIT, type Limit } from "./ratelimit";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const ok = (body: Record<string, unknown> = {}) => json({ ok: true, ...body });
export const bad = (error: string, status = 400) => json({ ok: false, error }, status);

/**
 * Supabase is optional. When it is not set up, a write route says so plainly with 503
 * rather than failing in a way the UI would have to guess at — the trade is already
 * on-chain either way, so this is never an error the user must act on mid-trade.
 */
export const DB_OFF = "PerpSwipe has no database configured, so trades are not being recorded. The trade itself is on-chain.";

export function requireDb(): Response | null {
  return serverDbConfigured() ? null : bad(DB_OFF, 503);
}

/** Rate-limit a write route by IP. Returns a 429 to send back, or null to continue. */
export function gate(req: Request, limit: Limit = WRITE_LIMIT): Response | null {
  const r = rateLimit(clientIp(req), limit);
  if (r.ok) return null;
  return json({ ok: false, error: "Too many requests. Wait a moment and try again." }, 429, {
    "retry-after": String(r.retryAfterSec),
  });
}

/** Parse a JSON body without throwing on malformed input. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** A message safe to return: never leaks a key or a connection string. */
export function failureText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/service_role|SUPABASE_SERVICE_ROLE_KEY|apikey|Bearer /i.test(msg)) return "The server could not reach its database.";
  return msg.split("\n")[0].slice(0, 300);
}
