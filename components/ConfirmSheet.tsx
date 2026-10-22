"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { errorText, looksLikeFunds, openTrade, quote, type DeckCard, type TradeResult, type TradeStep } from "@/lib/dex";
import { fmtPrice, fmtUsd, type Plan, type Side } from "@/lib/risk";
import { recordOpen } from "@/lib/record";
import { supabaseConfigured } from "@/lib/env";
import { MarketHint } from "./MarketHint";

type Phase = "review" | "working" | "done" | "error";

const STEP_LABELS: Record<Exclude<TradeStep, "done">, string> = {
  fund: "Moving USDso to your trading balance",
  open: "Opening your position",
  stop: "Arming the stop-loss on-chain",
};

export function ConfirmSheet({
  card, side, marginUsd, leverage, account, onClose, onDone,
}: {
  card: DeckCard;
  side: Side;
  marginUsd: number;
  leverage: number;
  account: Address;
  onClose: () => void;
  onDone: (r: TradeResult) => void;
}) {
  const [plan, setPlan] = useState<(Plan & { price: number }) | null>(null);
  const [phase, setPhase] = useState<Phase>("review");
  const [steps, setSteps] = useState<TradeStep[]>([]);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [error, setError] = useState("");
  const [recordError, setRecordError] = useState("");

  useEffect(() => {
    let live = true;
    quote(card, side, marginUsd, leverage)
      .then((p) => live && setPlan(p))
      .catch((e) => live && (setError(errorText(e)), setPhase("error")));
    return () => { live = false; };
  }, [card, side, marginUsd, leverage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && phase !== "working" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  async function confirm() {
    setPhase("working");
    setSteps([]);
    try {
      const r = await openTrade(card, side, marginUsd, leverage, account, (s) => setSteps((prev) => [...prev, s]));
      setResult(r);
      setPhase("done");

      // Record it. The trade is already on-chain, so a database that is missing or
      // unreachable must never look like a failed trade: it is reported as its own line.
      if (r.openTx && r.filled > 0 && supabaseConfigured) {
        const saved = await recordOpen({
          openTx: r.openTx,
          stopTx: r.stopTx,
          wallet: account,
          symbol: card.symbol,
          side,
          leverage,
          plan: r.plan,
        });
        if (!saved.ok && saved.error !== "no-database") setRecordError(saved.error ?? "");
      }
      onDone(r);
    } catch (e) {
      setError(errorText(e));
      setPhase("error");
    }
  }

  const verb = side === "long" ? "long" : "short";
  const current = steps.at(-1);
  // What the trade would have needed, for the shortfall message. The plan is the
  // live quote, so this is the real figure rather than the headline size.
  const needed = (plan?.margin ?? marginUsd) * 1.05;

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.target === e.currentTarget && phase !== "working" && onClose()}>
      <div className="sheet">
        {phase === "review" && (
          <>
            <h2 id="sheet-title">Go {verb} on {card.base}?</h2>
            {!plan ? (
              <p className="sheet-note">Checking the live price</p>
            ) : (
              <>
                <dl>
                  <dt>Fills near</dt>
                  <dd>{fmtPrice(plan.price)}</dd>
                  <dt>Size</dt>
                  <dd>{plan.qty} {card.base} ({fmtUsd(plan.notional)})</dd>
                  <dt>Your money in</dt>
                  <dd>{fmtUsd(plan.margin)}</dd>
                  <dt>Stop-loss closes it at</dt>
                  <dd>{fmtPrice(plan.stopPrice)}</dd>
                  <dt>Liquidation at</dt>
                  <dd>{fmtPrice(plan.liquidationPrice)}</dd>
                  <div className="loss-row" style={{ display: "contents" }}>
                    <dt>Most you can lose</dt>
                    <dd>{fmtUsd(plan.maxLoss)}</dd>
                  </div>
                </dl>
                <MarketHint card={card} />
                <p className="sheet-note">
                  Your wallet asks you to sign up to three times: add margin (only if needed), open the trade, arm the stop-loss.
                  The stop fills at market, so a very fast move can lose a little more than shown.
                </p>
              </>
            )}
            <div className="sheet-actions">
              <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
              <button className={`btn ${side === "long" ? "btn-long" : "btn-short"}`} disabled={!plan} onClick={confirm}>
                Open {verb}
              </button>
            </div>
          </>
        )}

        {phase === "working" && (
          <>
            <h2 id="sheet-title">Opening your {verb}</h2>
            <ul className="steps">
              {(Object.keys(STEP_LABELS) as Exclude<TradeStep, "done">[])
                .filter((s) => s !== "fund" || steps.includes("fund"))
                .map((s) => (
                  <li key={s}>
                    <span className={`dot ${current === s ? "dot-now" : steps.includes(s) ? "dot-done" : ""}`} aria-hidden />
                    {STEP_LABELS[s]}
                  </li>
                ))}
            </ul>
            <p className="sheet-note">Keep this open and confirm in your wallet.</p>
          </>
        )}

        {phase === "done" && result && (
          <>
            <h2 id="sheet-title">{result.filled ? `You are ${verb} ${card.base}` : "The order did not fill"}</h2>
            <ul className="steps">
              <li>
                <span className={`dot ${result.filled ? "dot-done" : "dot-fail"}`} aria-hidden />
                <span>
                  Position {result.filled ? `opened, ${result.filled} ${card.base}` : "not filled. Nothing was spent except gas."}
                  {result.openTx && <span className="hash"><br />{result.openTx}</span>}
                </span>
              </li>
              {result.filled > 0 && (
                <li>
                  <span className={`dot ${result.stopTx ? "dot-done" : "dot-fail"}`} aria-hidden />
                  <span>
                    {result.stopTx ? `Stop-loss armed at ${fmtPrice(result.plan.stopPrice)}` : `Stop-loss not armed: ${result.stopError}`}
                    {result.stopTx && <span className="hash"><br />{result.stopTx}</span>}
                    {!result.stopTx && (
                      <span className="hash">
                        <br />
                        Your trade has no stop-loss. Use Arm stop-loss on the position, or close it yourself.
                      </span>
                    )}
                  </span>
                </li>
              )}
              {recordError && (
                <li>
                  <span className="dot dot-fail" aria-hidden />
                  <span>
                    Your trade is on-chain, but PerpSwipe could not save it to your history.
                    <span className="hash"><br />{recordError}</span>
                  </span>
                </li>
              )}
            </ul>
            <div className="sheet-actions" style={{ gridTemplateColumns: "1fr" }}>
              <button className="btn btn-ink" onClick={onClose}>Next card</button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <h2 id="sheet-title">That did not go through</h2>
            <p className="error">{error}</p>
            {looksLikeFunds(error) ? (
              <p className="sheet-note">
                You need about {fmtUsd(needed)} in your trading balance for this trade, plus a little STT for gas.
              </p>
            ) : (
              <p className="sheet-note">Nothing was opened. You can try the same card again.</p>
            )}
            <div className="sheet-actions" style={looksLikeFunds(error) ? undefined : { gridTemplateColumns: "1fr" }}>
              <button className="btn btn-quiet" onClick={onClose}>Back to the deck</button>
              {looksLikeFunds(error) && (
                <a className="btn btn-ink" href="/funds">Get test funds</a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
