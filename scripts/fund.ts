// Shannon testnet -> Hideki: mint USDso on Shannon, then bridge USDso + STT to Hideki.
// Before running: get Shannon STT for your bot address from https://testnet.somnia.network
import { createPublicClient, createWalletClient, http, parseUnits, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BridgeToken, ChainId, createBridgeTransfer, sendBridgeStep } from "@somnia-chain/markets-sdk/chains";
import { getKey, SHANNON, SHANNON_USDSO } from "./env.js";

const account = privateKeyToAccount(getKey());
const pub = createPublicClient({ chain: SHANNON, transport: http() });
const wallet = createWalletClient({ account, chain: SHANNON, transport: http() });

const stt = await pub.getBalance({ address: account.address });
console.log("Bot:", account.address, "| Shannon STT:", formatEther(stt));
if (stt < parseUnits("2", 18)) throw new Error("Need at least 2 STT on Shannon. Use the faucet first.");

// 1) Mint test USDso on Shannon (public mint on testnet)
const mintHash = await wallet.writeContract({
  address: SHANNON_USDSO,
  abi: [{ type: "function", name: "mint", stateMutability: "nonpayable",
          inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }],
  functionName: "mint",
  args: [account.address, parseUnits("200", 18)],
  gas: 500_000n,
});
await pub.waitForTransactionReceipt({ hash: mintHash });
console.log("Minted 200 USDso on Shannon:", mintHash);

// 2) Bridge 200 USDso and 1 STT to Hideki
for (const [token, amount] of [[BridgeToken.USDso, parseUnits("200", 18)], [BridgeToken.STT, parseUnits("1", 18)]] as const) {
  const plan = createBridgeTransfer({ token, from: ChainId.somniaShannon, to: ChainId.hidekiTestnet, amount, recipient: account.address });
  if (plan.approveStep) await sendBridgeStep(pub, plan.approveStep, { account });
  const r = await sendBridgeStep(pub, plan.bridgeStep, { account });
  console.log(`Bridged ${token}:`, r.transactionHash);
}
console.log("Done. Wait 1-3 minutes, then run: npm run check");
