// The browser's side of the database: tell the server a trade happened, and let the
// server prove it against the chain before it believes us.
//
// Nothing here is allowed to break a trade. The trade is already on-chain by the time
// any of this runs, so a failure to record is reported quietly and never thrown.
import { supabaseConfigured } from "./env";
import type { Plan, Side } from "./risk";

export type RecordResult = { ok: boolean; error?: string };

async function post(path: string, body: unknown): Promise<RecordResult> {
  if (!supabaseConfigured) return { ok: false, error: "no-database" };
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 204) return { ok: true };
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error ?? `server answered ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not reach the server" };
  }
}

export async function recordOpen(args: {
  openTx: string;
  stopTx?: string;
  wallet: string;
  symbol: string;
  side: Side;
  leverage: number;
  plan: Plan & { price: number };
}): Promise<RecordResult> {
  return post("/api/trades", {
    openTx: args.openTx,
    stopTx: args.stopTx,
    wallet: args.wallet,
    symbol: args.symbol,
    side: args.side,
    leverage: args.leverage,
    plan: {
      qty: args.plan.qty,
      price: args.plan.price,
      margin: args.plan.margin,
      stopPrice: args.plan.stopPrice,
      liquidationPrice: args.plan.liquidationPrice,
      maxLoss: args.plan.maxLoss,
    },
  });
}

export async function recordClose(openTx: string, closeTx: string): Promise<RecordResult> {
  return post("/api/trades/close", { openTx, closeTx });
}

export async function bumpServerStreak(wallet: string, openTx: string): Promise<number | null> {
  if (!supabaseConfigured) return null;
  try {
    const res = await fetch("/api/streak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, openTx }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; days?: number } | null;
    return data?.ok && typeof data.days === "number" ? data.days : null;
  } catch {
    return null;
  }
}

export async function readServerStreak(wallet: string): Promise<number | null> {
  if (!supabaseConfigured) return null;
  try {
    const res = await fetch(`/api/streak?wallet=${wallet}`);
    const data = (await res.json().catch(() => null)) as { ok?: boolean; days?: number } | null;
    return data?.ok && typeof data.days === "number" ? data.days : null;
  } catch {
    return null;
  }
}
