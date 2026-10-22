"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Header } from "@/components/Header";
import { SwipeDeck } from "@/components/SwipeDeck";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Positions, type Activity, type UnarmedStop } from "@/components/Positions";
import { Segmented } from "@/components/Segmented";
import { RISK_LEVELS, SIZES_USD, type Side } from "@/lib/risk";
import { HIDEKI, addHidekiToWallet } from "@/lib/wagmi";
import { bumpStreak } from "@/lib/streak";
import type { DeckCard, TradeResult } from "@/lib/dex";

export default function TradePage() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [deck, setDeck] = useState<DeckCard[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [marginUsd, setMarginUsd] = useState<number>(10);
  const [riskId, setRiskId] = useState<(typeof RISK_LEVELS)[number]["id"]>("balanced");
  const [pending, setPending] = useState<Side | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [toast, setToast] = useState("");
  const [streakTick, setStreakTick] = useState(0);
  const [traded, setTraded] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Positions opened this session: their open tx (so a close can be recorded) and,
  // when the stop-loss failed, what the retry needs to arm it.
  const [openTxBySymbol, setOpenTxBySymbol] = useState<Record<string, string>>({});
  const [unarmed, setUnarmed] = useState<Record<string, UnarmedStop>>({});

  const risk = RISK_LEVELS.find((r) => r.id === riskId)!;
  const onHideki = !!address && chainId === HIDEKI.id;
  const wrongChain = !!address && chainId !== HIDEKI.id;

  const load = useCallback(() => {
    setLoadError("");
    import("@/lib/dex")
      .then(({ loadDeck }) => loadDeck())
      .then(setDeck)
      .catch(() => setLoadError("Could not reach dreamDEX on Hideki testnet. Check your connection and try again."));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const top = deck?.length ? deck[index % deck.length] : null;

  /** Switch to Hideki, adding the chain to the wallet when it does not know it yet. */
  async function switchToHideki() {
    setSwitching(true);
    try {
      await switchChainAsync({ chainId: HIDEKI.id });
    } catch {
      try {
        await addHidekiToWallet();
        await switchChainAsync({ chainId: HIDEKI.id });
      } catch (e) {
        const { errorText } = await import("@/lib/dex");
        setToast(errorText(e));
      }
    } finally {
      setSwitching(false);
    }
  }

  function onSwipe(side: Side) {
    if (!address) {
      setToast("Connect a wallet to trade. Use the button at the top.");
      return;
    }
    if (!onHideki) {
      setToast("Your wallet is on another network. Switch to Hideki testnet to trade.");
      return;
    }
    setPending(side);
  }

  async function onDone(r: TradeResult) {
    if (!top || !pending) return;
    const verb = pending === "long" ? "Long" : "Short";
    const items: Activity[] = [];
    if (r.openTx) items.push({ label: `${verb} ${top.base} opened`, hash: r.openTx });
    if (r.stopTx) items.push({ label: `Stop-loss armed on ${top.base}`, hash: r.stopTx });
    setActivity((a) => [...items, ...a].slice(0, 12));

    if (r.filled > 0) {
      if (r.openTx) setOpenTxBySymbol((m) => ({ ...m, [top.symbol]: r.openTx! }));
      // A filled position with no stop is the one state the user must be able to fix.
      if (!r.stopTx) {
        setUnarmed((m) => ({ ...m, [top.symbol]: { card: top, side: pending, entry: r.plan.price, leverage: risk.leverage } }));
      }
      if (address && r.openTx) await bumpStreak(address, r.openTx);
      setStreakTick((t) => t + 1);
    } else if (r.openTx) {
      setToast(`The order did not fill, so you are not ${pending === "long" ? "long" : "short"} ${top.base}. Only gas was spent.`);
    }

    setTraded(true);
    setRefreshKey((k) => k + 1);
  }

  return (
    <main className="shell">
      <Header streakTick={streakTick} />

      {wrongChain && (
        <div className="banner" role="status">
          <span>Your wallet is on another network. dreamDEX perps live on Hideki testnet.</span>
          <button className="btn btn-small btn-ink" disabled={switching} onClick={switchToHideki}>
            {switching ? "Switching" : "Switch to Hideki"}
          </button>
        </div>
      )}

      <div className="board">
        <section aria-label="Trading deck">
          <div className="settings">
            <div className="setting-row">
              <span className="setting-name">Per trade</span>
              <Segmented
                label="Money per trade"
                value={marginUsd}
                onChange={setMarginUsd}
                options={SIZES_USD.map((v) => ({ value: v, label: `${v} USDso` }))}
              />
            </div>
            <div className="setting-row">
              <span className="setting-name">Risk</span>
              <Segmented
                label="Risk level"
                value={riskId}
                onChange={setRiskId}
                options={RISK_LEVELS.map((r) => ({ value: r.id, label: `${r.name} ${r.leverage}x` }))}
              />
            </div>
            <p className="setting-hint">{risk.hint}</p>
          </div>

          {deck && deck.length > 0 ? (
            <SwipeDeck
              cards={deck}
              index={index}
              marginUsd={marginUsd}
              leverage={risk.leverage}
              onSwipe={onSwipe}
              onSkip={() => setIndex((i) => i + 1)}
              disabled={pending !== null}
            />
          ) : (
            <div className="deck-empty">
              {loadError ? (
                <div>
                  <p>{loadError}</p>
                  <button className="btn" onClick={load}>Try again</button>
                </div>
              ) : deck ? (
                <p>dreamDEX lists no perp markets right now.</p>
              ) : (
                <p>Dealing live markets from dreamDEX</p>
              )}
            </div>
          )}
        </section>

        <Positions
          marginBank={deck?.[0]?.marginBank}
          refreshKey={refreshKey}
          activity={activity}
          unarmed={unarmed}
          openTxBySymbol={openTxBySymbol}
          onArmed={(symbol, hash) => {
            setUnarmed((m) => {
              const next = { ...m };
              delete next[symbol];
              return next;
            });
            setActivity((a) => [{ label: `Stop-loss armed on ${symbol.split("/")[0]}`, hash }, ...a].slice(0, 12));
          }}
          onToast={setToast}
        />
      </div>

      {pending && top && address && (
        <ConfirmSheet
          card={top}
          side={pending}
          marginUsd={marginUsd}
          leverage={risk.leverage}
          account={address}
          onDone={onDone}
          onClose={() => {
            setPending(null);
            if (traded) setIndex((i) => i + 1); // after a trade, deal the next card; after Cancel, keep this one
            setTraded(false);
          }}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
