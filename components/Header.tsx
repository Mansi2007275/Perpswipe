"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { HIDEKI, addHidekiToWallet } from "@/lib/wagmi";
import { readStreak } from "@/lib/streak";
import { supabaseConfigured } from "@/lib/env";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const NAV = [
  { href: "/", label: "Trade" },
  { href: "/funds", label: "Get test funds" },
  { href: "/history", label: "History" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Header({ streakTick = 0 }: { streakTick?: number }) {
  const path = usePathname();
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [streak, setStreak] = useState(0);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let live = true;
    readStreak(address).then((d) => live && setStreak(d));
    return () => {
      live = false;
    };
  }, [streakTick, address]);

  // History and the leaderboard only exist with a database behind them.
  const nav = NAV.filter((n) => supabaseConfigured || (n.href !== "/history" && n.href !== "/leaderboard"));
  // More than one wallet configured means the user gets to choose.
  const choices = connectors.filter((c) => c.type !== "mock");
  const onlyOne = choices.length <= 1;

  async function switchToHideki() {
    try {
      await switchChainAsync({ chainId: HIDEKI.id });
    } catch {
      await addHidekiToWallet().then(() => switchChainAsync({ chainId: HIDEKI.id })).catch(() => {});
    }
  }

  return (
    <header className="topbar">
      <Link href="/" className="wordmark" aria-label="PerpSwipe home">
        <span className="wordmark-glyph" aria-hidden />
        PerpSwipe
      </Link>
      <nav className="topnav">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="navlink" aria-current={path === n.href ? "page" : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>
      <span className="topbar-spacer" />
      {streak > 0 && <span className="streak" title="Days in a row with at least one trade">{streak}-day streak</span>}
      {!isConnected ? (
        onlyOne ? (
          <button
            className="btn btn-ink btn-small"
            disabled={!choices[0] || isPending}
            onClick={() => choices[0] && connect({ connector: choices[0], chainId: HIDEKI.id })}
          >
            {isPending ? "Connecting" : "Connect wallet"}
          </button>
        ) : (
          <span className="wallet-pick">
            <button className="btn btn-ink btn-small" disabled={isPending} onClick={() => setPicking((p) => !p)}>
              {isPending ? "Connecting" : "Connect wallet"}
            </button>
            {picking && (
              <span className="wallet-menu" role="menu">
                {choices.map((c) => (
                  <button
                    key={c.uid}
                    role="menuitem"
                    onClick={() => {
                      setPicking(false);
                      connect({ connector: c, chainId: HIDEKI.id });
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </span>
            )}
          </span>
        )
      ) : chainId !== HIDEKI.id ? (
        <button className="btn btn-small" onClick={switchToHideki}>
          Switch to Hideki
        </button>
      ) : (
        <button className="btn btn-quiet btn-small" onClick={() => disconnect()} title="Disconnect">
          {short(address!)}
        </button>
      )}
    </header>
  );
}
