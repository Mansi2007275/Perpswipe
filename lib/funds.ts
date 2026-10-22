// Getting test money onto Hideki, where dreamDEX perps run.
// Hideki has no faucet and its USDso cannot be minted, so we mint on Shannon and bridge over.
import { BridgeToken, ChainId, createBridgeTransfer } from "@somnia-chain/markets-sdk/chains";
import { parseUnits, type Address, type PublicClient, type WalletClient } from "viem";

export { SHANNON_USDSO, SHANNON_FAUCET } from "./env";
import { SHANNON_USDSO } from "./env";

const mintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Mint test USDso on Shannon. The wallet must be on Shannon. */
export async function mintUsdso(wallet: WalletClient, reader: PublicClient, to: Address, amount: number) {
  const hash = await wallet.writeContract({
    address: SHANNON_USDSO,
    abi: mintAbi,
    functionName: "mint",
    args: [to, parseUnits(String(amount), 18)],
    account: to,
    chain: wallet.chain,
    gas: 500_000n,
  });
  await reader.waitForTransactionReceipt({ hash });
  return hash;
}

/** Bridge USDso or STT from Shannon to Hideki. The wallet must be on Shannon. */
export async function bridgeToHideki(
  wallet: WalletClient,
  reader: PublicClient,
  account: Address,
  token: "USDso" | "STT",
  amount: number,
) {
  const plan = createBridgeTransfer({
    token: token === "USDso" ? BridgeToken.USDso : BridgeToken.STT,
    from: ChainId.somniaShannon,
    to: ChainId.hidekiTestnet,
    amount: parseUnits(String(amount), 18),
    recipient: account,
  });
  if (plan.approveStep) {
    const h = await wallet.sendTransaction({ ...plan.approveStep, account, chain: wallet.chain });
    await reader.waitForTransactionReceipt({ hash: h });
  }
  const hash = await wallet.sendTransaction({ ...plan.bridgeStep, account, chain: wallet.chain });
  await reader.waitForTransactionReceipt({ hash });
  return hash;
}
