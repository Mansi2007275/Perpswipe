// GET /api/leaderboard — top 20 wallets by realised PnL over the last 7 days,
// with the number that actually matters for PerpSwipe: how often a wallet lost
// MORE than the risk ticket said it could. Lower is better.
import { bad, failureText, json, requireDb } from "@/lib/api";
import { serverDb, type TradeRow } from "@/lib/supabase";

export type LeaderboardEntry = {
  wallet: string;
  pnl: number;
  trades: number;
  wins: number;
  /** Trades whose loss went past the max loss shown before the swipe. */
  overMaxLoss: number;
  /** overMaxLoss as a percentage of trades. Lower is better. */
  overMaxLossPct: number;
};

/** A trade is finished whether the user closed it or its stop-loss did. */
const FINISHED = ["closed", "stopped"];
const WINDOW_DAYS = 7;

export async function GET() {
  const off = requireDb();
  if (off) return off;

  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();

  try {
    // Aggregated here rather than in SQL so the schema stays plain tables with no
    // database functions to install: one bounded read, grouped in memory.
    const { data, error } = await serverDb()
      .from("trades")
      .select("wallet, pnl, max_loss, status, closed_at")
      .in("status", FINISHED)
      .not("pnl", "is", null)
      .gte("closed_at", since)
      .order("closed_at", { ascending: false })
      .limit(5000);
    if (error) return bad(failureText(error), 500);

    const rows = (data ?? []) as Pick<TradeRow, "wallet" | "pnl" | "max_loss" | "status" | "closed_at">[];
    const byWallet = new Map<string, LeaderboardEntry>();

    for (const r of rows) {
      const pnl = Number(r.pnl ?? 0);
      const e =
        byWallet.get(r.wallet) ??
        { wallet: r.wallet, pnl: 0, trades: 0, wins: 0, overMaxLoss: 0, overMaxLossPct: 0 };
      e.pnl += pnl;
      e.trades += 1;
      if (pnl > 0) e.wins += 1;
      // The promise on the card was "you cannot lose more than this". A loss deeper
      // than max_loss means the stop did not hold — a gap, or a stop that never armed.
      const maxLoss = r.max_loss === null ? null : Number(r.max_loss);
      if (maxLoss !== null && pnl < -maxLoss) e.overMaxLoss += 1;
      byWallet.set(r.wallet, e);
    }

    const entries = [...byWallet.values()]
      .map((e) => ({ ...e, pnl: round(e.pnl), overMaxLossPct: round((e.overMaxLoss / e.trades) * 100, 1) }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 20);

    return json({ ok: true, windowDays: WINDOW_DAYS, entries });
  } catch (e) {
    return bad(failureText(e), 502);
  }
}

const round = (n: number, places = 2) => Number(n.toFixed(places));
