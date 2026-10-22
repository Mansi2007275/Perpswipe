"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { supabaseConfigured } from "@/lib/env";
import { fmtUsd } from "@/lib/risk";

type Entry = {
  wallet: string;
  pnl: number;
  trades: number;
  wins: number;
  overMaxLoss: number;
  overMaxLossPct: number;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [windowDays, setWindowDays] = useState(7);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    fetch("/api/leaderboard")
      .then(async (res) => {
        const data = (await res.json()) as { ok?: boolean; error?: string; entries?: Entry[]; windowDays?: number };
        if (!res.ok || !data.ok) throw new Error(data.error ?? `server answered ${res.status}`);
        setEntries(data.entries ?? []);
        setWindowDays(data.windowDays ?? 7);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (supabaseConfigured) load();
  }, [load]);

  return (
    <main className="shell">
      <Header />
      <section className="board-wide">
        <h1 className="panel-title">Leaderboard</h1>
        <p className="panel-lead">
          Realised profit over the last {windowDays} days, from trades this app verified on Hideki. The second number is
          the one that matters here: how often a trade lost more than its risk ticket said it could. Lower is better.
        </p>

        {!supabaseConfigured ? (
          <p className="empty-note">
            The leaderboard needs a database. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
            SUPABASE_SERVICE_ROLE_KEY, then run supabase/schema.sql.
          </p>
        ) : error ? (
          <div className="empty-note">
            <p className="error">Could not load the leaderboard: {error}</p>
            <button className="btn" onClick={load}>Try again</button>
          </div>
        ) : entries === null ? (
          <p className="empty-note">Reading closed trades</p>
        ) : entries.length === 0 ? (
          <p className="empty-note">No trades have been closed in the last {windowDays} days yet. Be the first.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Wallet</th>
                <th scope="col" className="num">Profit</th>
                <th scope="col" className="num">Trades</th>
                <th scope="col" className="num">Won</th>
                <th scope="col" className="num">Past max loss</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.wallet}>
                  <td>{i + 1}</td>
                  <td><span className="mono">{short(e.wallet)}</span></td>
                  <td className={`num ${e.pnl >= 0 ? "up" : "down"}`}>
                    {e.pnl >= 0 ? "+" : ""}
                    {fmtUsd(e.pnl)}
                  </td>
                  <td className="num">{e.trades}</td>
                  <td className="num">{e.wins}</td>
                  <td className="num">{e.overMaxLoss === 0 ? "none" : `${e.overMaxLossPct}% (${e.overMaxLoss})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
