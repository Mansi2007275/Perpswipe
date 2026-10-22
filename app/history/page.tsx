"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Header } from "@/components/Header";
import { supabaseConfigured } from "@/lib/env";
import { fmtPrice, fmtUsd } from "@/lib/risk";

type TradeRow = {
  id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry_price: number;
  margin: number;
  leverage: number;
  stop_price: number | null;
  liq_price: number | null;
  max_loss: number | null;
  open_tx: string;
  stop_tx: string | null;
  close_tx: string | null;
  close_price: number | null;
  pnl: number | null;
  status: "open" | "closed" | "stopped";
  opened_at: string;
  closed_at: string | null;
};

const STATUS_LABEL: Record<TradeRow["status"], string> = {
  open: "Open",
  closed: "You closed it",
  stopped: "Stop-loss closed it",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function HistoryPage() {
  const { address } = useAccount();
  const [rows, setRows] = useState<TradeRow[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!address) return;
    setError("");
    fetch(`/api/trades?wallet=${address}`)
      .then(async (res) => {
        const data = (await res.json()) as { ok?: boolean; error?: string; trades?: TradeRow[] };
        if (!res.ok || !data.ok) throw new Error(data.error ?? `server answered ${res.status}`);
        setRows(data.trades ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, [address]);

  useEffect(() => {
    if (supabaseConfigured && address) load();
  }, [load, address]);

  return (
    <main className="shell">
      <Header />
      <section className="board-wide">
        <h1 className="panel-title">Your history</h1>
        <p className="panel-lead">
          Every trade PerpSwipe verified on Hideki for this wallet, with its transaction hashes. Hideki has no public
          block explorer, so a hash is checked with eth_getTransactionReceipt on the RPC, which is exactly what this app
          did before saving the row.
        </p>

        {!supabaseConfigured ? (
          <p className="empty-note">
            History needs a database. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
            SUPABASE_SERVICE_ROLE_KEY, then run supabase/schema.sql.
          </p>
        ) : !address ? (
          <p className="empty-note">Connect your wallet to see its trades.</p>
        ) : error ? (
          <div className="empty-note">
            <p className="error">Could not load your trades: {error}</p>
            <button className="btn" onClick={load}>Try again</button>
          </div>
        ) : rows === null ? (
          <p className="empty-note">Reading your trades</p>
        ) : rows.length === 0 ? (
          <p className="empty-note">No trades recorded yet for this wallet.</p>
        ) : (
          <ul className="history">
            {rows.map((t) => {
              const up = (t.pnl ?? 0) >= 0;
              const base = t.symbol.split("/")[0];
              return (
                <li className="history-row" key={t.id}>
                  <span className="position-name">
                    {base}
                    <span className={`side-chip side-${t.side}`}>{t.side === "long" ? "Long" : "Short"}</span>
                    <span className="status-chip">{STATUS_LABEL[t.status]}</span>
                  </span>
                  <span className={`position-pnl ${up ? "up" : "down"}`}>
                    {t.pnl === null ? "–" : `${up ? "+" : ""}${t.pnl.toFixed(2)} USDso`}
                  </span>
                  <span className="position-meta">
                    {t.qty} {base} at {t.leverage}x from {fmtPrice(t.entry_price)}
                    {t.close_price !== null && `, closed at ${fmtPrice(t.close_price)}`}
                    {t.max_loss !== null && `. Risk ticket said at most ${fmtUsd(t.max_loss)}`}
                    {". "}
                    {when(t.opened_at)}
                  </span>
                  <span className="history-hashes">
                    <span>
                      <b>Open</b> <span className="hash">{t.open_tx}</span>
                    </span>
                    {t.stop_tx && (
                      <span>
                        <b>Stop armed</b> <span className="hash">{t.stop_tx}</span>
                      </span>
                    )}
                    {t.close_tx && (
                      <span>
                        <b>Close</b> <span className="hash">{t.close_tx}</span>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
