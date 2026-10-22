"use client";

import { useEffect, useState } from "react";
import type { DeckCard } from "@/lib/dex";

/**
 * One plain sentence about the market, written by /api/hint.
 *
 * Renders nothing at all unless the server actually returns a sentence. With no
 * AI_API_KEY the route answers 204, so there is no placeholder and no invented text.
 */
export function MarketHint({ card }: { card: DeckCard }) {
  const [hint, setHint] = useState("");

  useEffect(() => {
    let live = true;
    setHint("");
    fetch("/api/hint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol: card.symbol,
        change24h: card.changePct,
        fundingRate: card.fundingRate,
        closes: card.closes,
      }),
    })
      .then(async (res) => (res.status === 204 ? null : res.json()))
      .then((data: { hint?: string } | null) => {
        if (live && data?.hint) setHint(data.hint);
      })
      .catch(() => {
        /* no hint is a fine outcome */
      });
    return () => {
      live = false;
    };
  }, [card.symbol, card.changePct, card.fundingRate, card.closes]);

  if (!hint) return null;
  return <p className="hint">{hint}</p>;
}
