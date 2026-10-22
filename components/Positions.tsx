"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  armStopLoss,
  closePosition,
  errorText,
  myPositions,
  readBalances,
  type Balances,
  type DeckCard,
  type Position,
} from "@/lib/dex";
import { fmtPrice, fmtUsd } from "@/lib/risk";
import { HIDEKI } from "@/lib/wagmi";
import { supabaseConfigured } from "@/lib/env";
import { recordClose } from "@/lib/record";

export type Activity = { label: string; hash?: string };

/**
 * A position whose stop-loss did not arm, so the UI can offer the retry.
 * Keyed by symbol, which is what a position is keyed on everywhere else here.
 */
export type UnarmedStop = { card: DeckCard; side: Position["side"]; entry: number; leverage: number };

export function Positions({
  marginBank,
  refreshKey,
  activity,
  unarmed,
  onArmed,
  onToast,
  openTxBySymbol,
}: {
  marginBank?: DeckCard["marginBank"];
  refreshKey: number;
  activity: Activity[];
  /** Positions opened this session whose stop-loss failed, by symbol. */
  unarmed: Record<string, UnarmedStop>;
  onArmed: (symbol: string, hash: string) => void;
  onToast: (msg: string) => void;
  /** The open tx of each position opened this session, so a close can be recorded. */
  openTxBySymbol: Record<string, string>;
}) {
  const { address, chainId } = useAccount();
  const ready = !!address && chainId === HIDEKI.id;
  const [rows, setRows] = useState<Position[] | null>(null);
  const [bal, setBal] = useState<Balances | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [arming, setArming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const [p, b] = await Promise.all([myPositions(), marginBank ? readBalances(address!, marginBank) : Promise.resolve(null)]);
      setRows(p);
      setBal(b);
    } catch {
      /* keep the last good read */
    }
  }, [ready, address, marginBank]);

  useEffect(() => {
    load();
    if (!ready) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load, ready, refreshKey]);

  async function close(p: Position) {
    setClosing(p.symbol);
    try {
      const o = await closePosition(p);
      onToast(`Closed ${p.base} ${p.side}. ${o.txHash ?? ""}`.trim());

      // Record the close. The position is already closed on-chain, so a database
      // problem is said out loud but never presented as a failed close.
      const openTx = openTxBySymbol[p.symbol];
      if (supabaseConfigured && openTx && o.txHash) {
        const saved = await recordClose(openTx, o.txHash);
        if (!saved.ok && saved.error !== "no-database") {
          onToast(`Closed ${p.base}, but its result could not be saved: ${saved.error}`);
        }
      }
      await load();
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setClosing(null);
    }
  }

  async function arm(p: Position) {
    const target = unarmed[p.symbol];
    if (!target) return;
    setArming(p.symbol);
    try {
      const hash = await armStopLoss(target.card, p.side, p.entry, target.leverage);
      onArmed(p.symbol, hash);
      onToast(`Stop-loss armed on ${p.base}.`);
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setArming(null);
    }
  }

  const shareUrl = (p: Position) => {
    const pct = p.pnl !== undefined && p.entry ? p.pnl / (p.size * p.entry) : 0; // move on the position's value
    const q = new URLSearchParams({ base: p.base, side: p.side, pnl: (p.pnl ?? 0).toFixed(2), pct: pct.toFixed(4) });
    return `/api/card?${q}`;
  };

  return (
    <section aria-labelledby="pos-title">
      <h2 className="panel-title" id="pos-title">Your trades</h2>
      <p className="panel-lead">
        Every trade here has a stop-loss armed on dreamDEX. It closes on its own, even if you close this tab.
      </p>

      {!ready ? (
        <p className="empty-note">Connect a wallet on Hideki testnet to see your trades. You can browse the deck without one.</p>
      ) : (
        <>
          <div className="balances">
            <div className="balance"><span>Trading balance</span><strong>{bal ? fmtUsd(bal.trading) : "–"}</strong></div>
            <div className="balance"><span>In wallet</span><strong>{bal ? fmtUsd(bal.wallet) : "–"}</strong></div>
            <div className="balance"><span>Gas</span><strong>{bal ? `${bal.gas.toFixed(3)} STT` : "–"}</strong></div>
          </div>
          {rows === null ? (
            <p className="empty-note">Reading your positions</p>
          ) : rows.length === 0 ? (
            <p className="empty-note">No open trades. Swipe a card to open one.</p>
          ) : (
            <ul className="positions">
              {rows.map((p) => {
                const up = (p.pnl ?? 0) >= 0;
                const needsStop = !!unarmed[p.symbol];
                return (
                  <li className="position" key={p.symbol}>
                    <span className="position-name">
                      {p.base}
                      <span className={`side-chip side-${p.side}`}>{p.side === "long" ? "Long" : "Short"}</span>
                    </span>
                    <span className={`position-pnl ${up ? "up" : "down"}`}>
                      {p.pnl === undefined ? "–" : `${up ? "+" : ""}${p.pnl.toFixed(2)} USDso`}
                    </span>
                    <span className="position-meta">
                      {p.size} {p.base} from {fmtPrice(p.entry)}
                      {p.mark !== undefined && `, now ${fmtPrice(p.mark)}`}
                      {p.liquidation !== undefined && `. Liquidation at ${fmtPrice(p.liquidation)}`}
                    </span>
                    {needsStop && (
                      <span className="position-warning">
                        This trade has no stop-loss, so nothing closes it for you.
                      </span>
                    )}
                    <span className="position-actions">
                      {needsStop && (
                        <button className="btn btn-small btn-ink" disabled={arming === p.symbol} onClick={() => arm(p)}>
                          {arming === p.symbol ? "Arming" : "Arm stop-loss"}
                        </button>
                      )}
                      <a className="btn btn-quiet btn-small" href={shareUrl(p)} target="_blank" rel="noreferrer">Share card</a>
                      <button className="btn btn-small" disabled={closing === p.symbol} onClick={() => close(p)}>
                        {closing === p.symbol ? "Closing" : "Close"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {activity.length > 0 && (
        <div className="recent">
          <h3>On-chain proof from this session</h3>
          <ul>
            {activity.map((a, i) => (
              <li key={i}>
                <span>{a.label}</span>
                {a.hash && <span className="hash">{a.hash}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
