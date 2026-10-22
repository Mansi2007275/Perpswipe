// Server-side proof that a transaction really happened, really came from the wallet
// that claims it, and really went to a dreamDEX perp pool.
//
// Hideki has no public block explorer, so eth_getTransactionReceipt on the Hideki RPC
// is the only source of truth. Nothing here trusts the request body.
//
// The chain read is injected so the rules can be unit-tested without a network.
import { createPublicClient, http, type Address, type Hash } from "viem";
import { publicEnv } from "./env";
import { HIDEKI } from "./chains";

/** The few receipt fields the checks use. A viem TransactionReceipt satisfies this. */
export type MinimalReceipt = {
  status: "success" | "reverted";
  from: string;
  to: string | null;
  transactionHash: string;
  blockNumber: bigint;
};

export type ReceiptReader = (hash: Hash) => Promise<MinimalReceipt | null>;

export type VerifyInput = {
  txHash: string;
  /** The wallet the client claims sent it. */
  wallet: string;
  /** Addresses the transaction is allowed to have been sent to (the market's pool). */
  allowedTo: readonly string[];
};

export type VerifyResult =
  | { ok: true; receipt: MinimalReceipt }
  | { ok: false; reason: string };

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const isTxHash = (v: unknown): v is string => typeof v === "string" && HASH_RE.test(v);
export const isAddress = (v: unknown): v is string => typeof v === "string" && ADDRESS_RE.test(v);

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * All of the checks, in the order that fails most cheaply first. A `false` result
 * carries a reason safe to return to the client: it only ever describes the
 * transaction the client itself supplied.
 */
export async function verifyTxReceipt(input: VerifyInput, getReceipt: ReceiptReader): Promise<VerifyResult> {
  if (!isTxHash(input.txHash)) return { ok: false, reason: "txHash is not a 32-byte transaction hash" };
  if (!isAddress(input.wallet)) return { ok: false, reason: "wallet is not an address" };
  if (input.allowedTo.length === 0) return { ok: false, reason: "no dreamDEX pool to check the transaction against" };
  if (!input.allowedTo.every(isAddress)) return { ok: false, reason: "allowedTo contains something that is not an address" };

  let receipt: MinimalReceipt | null;
  try {
    receipt = await getReceipt(input.txHash as Hash);
  } catch {
    // A receipt that is not there yet throws on viem; both mean the same thing here.
    receipt = null;
  }
  if (!receipt) return { ok: false, reason: "That transaction is not on Hideki yet. Wait for it to confirm and try again." };
  if (receipt.status !== "success") return { ok: false, reason: "That transaction failed on-chain, so nothing was recorded." };
  if (!same(receipt.from, input.wallet)) return { ok: false, reason: "That transaction was not sent by this wallet." };
  if (!input.allowedTo.some((a) => same(receipt!.to, a))) {
    return { ok: false, reason: "That transaction did not go to this market's dreamDEX pool." };
  }
  return { ok: true, receipt };
}

let reader: ReceiptReader | null = null;

/** The real Hideki reader: plain viem over HTTP, so a route handler opens no WebSocket. */
export function hidekiReceiptReader(): ReceiptReader {
  if (!reader) {
    const client = createPublicClient({ chain: HIDEKI, transport: http(publicEnv.hidekiRpcUrl) });
    reader = async (hash) => {
      const r = await client.getTransactionReceipt({ hash });
      return r
        ? { status: r.status, from: r.from, to: r.to, transactionHash: r.transactionHash, blockNumber: r.blockNumber }
        : null;
    };
  }
  return reader;
}

/** A plain Hideki HTTP client for the other server-side chain reads (positions). */
export function hidekiClient() {
  return createPublicClient({ chain: HIDEKI, transport: http(publicEnv.hidekiRpcUrl) });
}

export type { Address, Hash };
