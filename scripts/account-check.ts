import { createPublicClient, http, formatEther, getAddress, erc20Abi } from "viem";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, toHuman } from "@somnia-chain/markets-sdk";
import { HIDEKI, INDEXER_URL, HIDEKI_USDSO } from "./env.js";
const a = getAddress(process.argv[2]);
const hid = createPublicClient({ chain: HIDEKI, transport: http() });
const USDSO = HIDEKI_USDSO;
const [stt, usd, code, nonce] = await Promise.all([
  hid.getBalance({ address: a }),
  hid.readContract({ address: USDSO, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
  hid.getCode({ address: a }), hid.getTransactionCount({ address: a }),
]);
console.log("Address:", a);
console.log(`Hideki: ${formatEther(stt)} STT | ${formatEther(usd)} USDso | contract: ${code && code !== "0x" ? "yes (smart account)" : "no (normal wallet)"} | nonce ${nonce}`);
if (code && code !== "0x") {
  try {
    const owners = await hid.readContract({ address: a, abi: [{ type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }], functionName: "getOwners" });
    const th = await hid.readContract({ address: a, abi: [{ type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "getThreshold" });
    console.log("Owners:", owners, "threshold:", th.toString());
  } catch (e: any) { console.log("owners read failed:", e.shortMessage ?? e.message); }
}
const ex = new SomniaMarkets({ indexerUrl: INDEXER_URL, chain: HIDEKI, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
await ex.loadMarkets();
const mb = (ex.market(ex.symbols.find((s) => s.startsWith("ETH/") && s.includes(":"))!).market as any).marginBank;
const m = await ex.client.getMarginAccount(mb, a);
console.log(`dreamDEX trading balance: ${toHuman(m.unlockedCollateralBalance, 18)} USDso free, ${toHuman(m.lockedCollateral, 18)} locked`);
const idx = await ex.client.accounts.getIndexedAccount(a).catch(() => null);
console.log("Factory account record:", idx ? JSON.stringify(idx, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 500) : "none");
process.exit(0);
