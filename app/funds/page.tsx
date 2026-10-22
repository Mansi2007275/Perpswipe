"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient, useBalance } from "wagmi";
import { formatEther } from "viem";
import { Header } from "@/components/Header";
import { HIDEKI, SHANNON } from "@/lib/wagmi";
import { SHANNON_FAUCET } from "@/lib/funds";
import { fmtUsd } from "@/lib/risk";

type Busy = "mint" | "bridge-usd" | "bridge-stt" | "deposit" | null;

export default function FundsPage() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: wallet } = useWalletClient();
  const shannonReader = usePublicClient({ chainId: SHANNON.id });
  const sttShannon = useBalance({ address, chainId: SHANNON.id, query: { refetchInterval: 10_000 } });
  const sttHideki = useBalance({ address, chainId: HIDEKI.id, query: { refetchInterval: 10_000 } });
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [trading, setTrading] = useState<{ wallet: number; trading: number } | null>(null);

  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 8));

  async function onShannon() {
    if (chainId !== SHANNON.id) await switchChainAsync({ chainId: SHANNON.id });
  }

  async function refreshTrading() {
    if (!address || chainId !== HIDEKI.id) return;
    const { getExchange, readBalances } = await import("@/lib/dex");
    const ex = await getExchange();
    const sym = ex.symbols.find((s) => s.includes(":"));
    if (!sym) return;
    const mb = (ex.market(sym).market as unknown as { marginBank: `0x${string}` }).marginBank;
    setTrading(await readBalances(address, mb));
  }
  useEffect(() => { refreshTrading(); }, [address, chainId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(kind: Exclude<Busy, null>) {
    if (!address || !wallet) return;
    setBusy(kind);
    setError("");
    try {
      if (kind === "deposit") {
        if (chainId !== HIDEKI.id) await switchChainAsync({ chainId: HIDEKI.id });
        const { getExchange } = await import("@/lib/dex");
        const ex = await getExchange();
        const sym = ex.symbols.find((s) => s.includes(":"))!;
        const amount = Math.floor((trading?.wallet ?? 0) * 100) / 100;
        if (amount <= 0) throw new Error("No USDso in your wallet on Hideki yet. Bridge some first.");
        await ex.depositMargin(sym, amount);
        say(`Moved ${fmtUsd(amount)} to your trading balance`);
        await refreshTrading();
      } else {
        await onShannon();
        const { mintUsdso, bridgeToHideki } = await import("@/lib/funds");
        if (!shannonReader) throw new Error("Shannon RPC not ready. Try again.");
        if (kind === "mint") say(`Minted 200 test USDso on Shannon: ${await mintUsdso(wallet, shannonReader, address, 200)}`);
        if (kind === "bridge-usd") say(`Sent 200 USDso to Hideki: ${await bridgeToHideki(wallet, shannonReader, address, "USDso", 200)}`);
        if (kind === "bridge-stt") say(`Sent 1 STT to Hideki for gas: ${await bridgeToHideki(wallet, shannonReader, address, "STT", 1)}`);
      }
    } catch (e) {
      const { errorText } = await import("@/lib/dex");
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const fmtStt = (v?: bigint) => (v === undefined ? "–" : `${Number(formatEther(v)).toFixed(3)} STT`);

  return (
    <main className="shell">
      <Header />
      <section className="funds">
        <h1 className="panel-title">Get test funds</h1>
        <p className="panel-lead">
          dreamDEX perps run on Hideki testnet, which has no faucet. You mint free test USDso on Shannon, send it across, then move it
          to your trading balance. All of this is test money.
        </p>
        {!isConnected && <p className="error">Connect a wallet first, with the button at the top.</p>}

        <ol>
          <li>
            <h3>Get STT on Shannon for gas</h3>
            <p>Use the Somnia faucet with your wallet address. You have {fmtStt(sttShannon.data?.value)} on Shannon.</p>
            <div className="row">
              <a className="btn btn-small" href={SHANNON_FAUCET} target="_blank" rel="noreferrer">Open the faucet</a>
            </div>
          </li>
          <li>
            <h3>Mint 200 test USDso on Shannon</h3>
            <p>Your wallet switches to Shannon and asks you to sign once.</p>
            <div className="row">
              <button className="btn btn-small" disabled={!isConnected || busy !== null} onClick={() => run("mint")}>
                {busy === "mint" ? "Minting" : "Mint 200 USDso"}
              </button>
            </div>
          </li>
          <li>
            <h3>Send USDso and gas to Hideki</h3>
            <p>Bridging takes one to three minutes to arrive. You have {fmtStt(sttHideki.data?.value)} on Hideki.</p>
            <div className="row">
              <button className="btn btn-small" disabled={!isConnected || busy !== null} onClick={() => run("bridge-usd")}>
                {busy === "bridge-usd" ? "Sending" : "Send 200 USDso"}
              </button>
              <button className="btn btn-small" disabled={!isConnected || busy !== null} onClick={() => run("bridge-stt")}>
                {busy === "bridge-stt" ? "Sending" : "Send 1 STT for gas"}
              </button>
            </div>
          </li>
          <li>
            <h3>Move USDso to your trading balance</h3>
            <p>
              {trading
                ? `In wallet on Hideki: ${fmtUsd(trading.wallet)}. Trading balance: ${fmtUsd(trading.trading)}.`
                : "Switch to Hideki to see your balances."}
            </p>
            <div className="row">
              <button className="btn btn-small btn-ink" disabled={!isConnected || busy !== null} onClick={() => run("deposit")}>
                {busy === "deposit" ? "Moving" : "Move all to trading"}
              </button>
              <button className="btn btn-small btn-quiet" disabled={chainId !== HIDEKI.id} onClick={refreshTrading}>Refresh</button>
            </div>
          </li>
        </ol>

        {error && <p className="error" style={{ marginTop: 18 }}>{error}</p>}
        {log.length > 0 && (
          <div className="recent">
            <h3>Done so far</h3>
            <ul>{log.map((l, i) => <li key={i}><span className="hash">{l}</span></li>)}</ul>
          </div>
        )}
      </section>
    </main>
  );
}
