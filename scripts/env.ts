import "dotenv/config";
import { isHex } from "viem";
import { hidekiTestnet, somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { Chain } from "viem";

export function getKey(): `0x${string}` {
  const k = process.env.PRIVATE_KEY;
  if (!k || !isHex(k, { strict: true }) || k.length !== 66) {
    throw new Error("PRIVATE_KEY missing in .env — run: npm run keygen");
  }
  return k as `0x${string}`;
}

export const json = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

// The same endpoints and defaults the web app uses (lib/env.ts). Kept here rather than
// imported because the scripts run under tsx with no Next.js env inlining, and because
// tsconfig excludes scripts/ from the app's typecheck.
const orDefault = (v: string | undefined, fallback: string) => (v && v.trim() !== "" ? v.trim() : fallback);

export const HIDEKI_RPC_URL = orDefault(process.env.NEXT_PUBLIC_HIDEKI_RPC_URL, "https://api.hideki2.infra.testnet.somnia.network");
export const HIDEKI_WS_URL = orDefault(process.env.NEXT_PUBLIC_HIDEKI_WS_URL, "wss://api.hideki2.infra.testnet.somnia.network/ws");
export const SHANNON_RPC_URL = orDefault(process.env.NEXT_PUBLIC_SHANNON_RPC_URL, "https://api.infra.testnet.somnia.network");
export const INDEXER_URL = orDefault(process.env.NEXT_PUBLIC_DREAMDEX_INDEXER_URL, "https://hideki-dev.smk.somnia.host/v1/graphql");

/** Shannon USDso. Public `mint(address,uint256)` on testnet, 18 decimals. */
export const SHANNON_USDSO = "0x9c32f3827a1a99f0cf9b213de8b53ec3d57bb171" as const;
/** Hideki USDso, the bridged collateral token. */
export const HIDEKI_USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const;

function withEndpoints(chain: Chain, httpUrl: string, websocket?: string): Chain {
  return {
    ...chain,
    rpcUrls: { ...chain.rpcUrls, default: { http: [httpUrl], ...(websocket ? { webSocket: [websocket] } : {}) } },
  };
}

export const HIDEKI = withEndpoints(hidekiTestnet, HIDEKI_RPC_URL, HIDEKI_WS_URL);
export const SHANNON = withEndpoints(somniaShannon, SHANNON_RPC_URL);
