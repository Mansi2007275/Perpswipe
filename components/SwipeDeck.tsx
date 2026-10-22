"use client";

import { AnimatePresence, motion, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { DeckCard } from "@/lib/dex";
import type { Side } from "@/lib/risk";
import { MarketCard } from "./MarketCard";

const THRESHOLD = 110;

export function SwipeDeck({
  cards, index, marginUsd, leverage, onSwipe, onSkip, disabled,
}: {
  cards: DeckCard[];
  index: number;
  marginUsd: number;
  leverage: number;
  onSwipe: (side: Side) => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 0, 240], [-14, 0, 14]);
  const longOpacity = useTransform(x, [20, THRESHOLD], [0, 1]);
  const shortOpacity = useTransform(x, [-THRESHOLD, -20], [1, 0]);
  const [leaving, setLeaving] = useState<"left" | "right" | "down" | null>(null);

  useEffect(() => x.set(0), [index, x]);

  const top = cards[index % cards.length];
  const behind = [1, 2].map((k) => cards[(index + k) % cards.length]).filter(Boolean);

  const decide = useCallback(
    (side: Side) => {
      if (disabled) return;
      // Card springs back: the trade is only real after you confirm the sheet.
      animate(x, side === "long" ? 60 : -60, { duration: 0.12 }).then(() => animate(x, 0, { type: "spring", stiffness: 500, damping: 30 }));
      onSwipe(side);
    },
    [disabled, onSwipe, x],
  );

  const skip = useCallback(() => {
    setLeaving("down");
    onSkip();
  }, [onSkip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || (e.target as HTMLElement)?.closest("input,textarea,[role=dialog]")) return;
      if (e.key === "ArrowRight") decide("long");
      if (e.key === "ArrowLeft") decide("short");
      if (e.key === "ArrowDown") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, skip, disabled]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > THRESHOLD) decide("long");
    else if (info.offset.x < -THRESHOLD) decide("short");
    else if (info.offset.y > THRESHOLD * 1.2) skip();
    else animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
  }

  if (!top) return null;

  return (
    <>
      <div className="stack">
        {behind
          .slice()
          .reverse()
          .map((c, i) => {
            const depth = behind.length - i; // 2 = furthest back
            return (
              <div
                key={`${c.symbol}-behind-${depth}`}
                className="card card-behind"
                style={{ transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.035}) rotate(${depth % 2 ? 2.5 : -2}deg)`, opacity: 1 - depth * 0.12 }}
                aria-hidden
              >
                <MarketCard card={c} marginUsd={marginUsd} leverage={leverage} />
              </div>
            );
          })}
        <AnimatePresence initial={false} onExitComplete={() => setLeaving(null)}>
          <motion.div
            key={`${top.symbol}-${index}`}
            className="card card-top"
            style={{ x, rotate }}
            drag={disabled ? false : true}
            dragElastic={0.6}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            onDragEnd={onDragEnd}
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={leaving === "down" ? { y: 640, opacity: 0, transition: { duration: 0.25 } } : { opacity: 0, transition: { duration: 0.15 } }}
            aria-roledescription="trading card"
            aria-label={`${top.base} perpetual. Swipe right to go long, left to go short, down to skip.`}
          >
            <MarketCard card={top} marginUsd={marginUsd} leverage={leverage} />
            <motion.span className="stamp stamp-long" style={{ opacity: longOpacity }} aria-hidden>Long</motion.span>
            <motion.span className="stamp stamp-short" style={{ opacity: shortOpacity }} aria-hidden>Short</motion.span>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="controls">
        <button className="btn btn-short" onClick={() => decide("short")} disabled={disabled}>Short</button>
        <button className="btn btn-quiet" onClick={skip} disabled={disabled}>Skip</button>
        <button className="btn btn-long" onClick={() => decide("long")} disabled={disabled}>Long</button>
      </div>
      <p className="controls-hint">Drag the card, or use the arrow keys. Nothing trades until you confirm.</p>
    </>
  );
}
