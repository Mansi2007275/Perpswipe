// The two chains, with their endpoints taken from env.
//
// Separate from lib/wagmi.ts on purpose: route handlers, the Node proof scripts and the
// unit tests all need the chain definitions, and none of them should pull in the wagmi
// connector barrel to get them.
import type { Chain } from "viem";
import { hidekiTestnet, somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { publicEnv } from "./env";

function withEndpoints(chain: Chain, httpUrl: string, websocket?: string): Chain {
  return {
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: { http: [httpUrl], ...(websocket ? { webSocket: [websocket] } : {}) },
    },
  };
}

/** Hideki = Somnia Tokyo testnet, where dreamDEX perps live (chain 50383). */
export const HIDEKI = withEndpoints(hidekiTestnet, publicEnv.hidekiRpcUrl, publicEnv.hidekiWsUrl);

/** Shannon = Somnia testnet, used only to mint test USDso and bridge it to Hideki. */
export const SHANNON = withEndpoints(somniaShannon, publicEnv.shannonRpcUrl);

// Hideki has no public block explorer, so a tx is verified with eth_getTransactionReceipt.
export const HIDEKI_HAS_EXPLORER = !!hidekiTestnet.blockExplorers?.default?.url;

/**
 * Add Hideki to the wallet, for a wallet that does not know the chain yet.
 * wagmi's injected connector already does this inside `switchChain`, but it only reaches
 * that branch on a 4902; some wallets report a different code, so this is the explicit
 * fallback the UI calls when `switchChain` fails.
 */
export async function addHidekiToWallet(): Promise<void> {
  const provider = (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
  if (!provider) throw new Error("No browser wallet found. Install MetaMask first.");
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: `0x${HIDEKI.id.toString(16)}`,
        chainName: HIDEKI.name,
        nativeCurrency: HIDEKI.nativeCurrency,
        rpcUrls: [publicEnv.hidekiRpcUrl],
      },
    ],
  });
}
