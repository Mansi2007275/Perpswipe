// Usage: npx tsx scripts/wallet-check.ts 0xYourAddress
import { createPublicClient, http, formatEther, getAddress, erc20Abi } from "viem";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, toHuman } from "@somnia-chain/markets-sdk";
import { HIDEKI, SHANNON, INDEXER_URL, HIDEKI_USDSO, SHANNON_USDSO } from "./env.js";

const addr = getAddress(process.argv[2] ?? "");
const hid = createPublicClient({ chain: HIDEKI, transport: http() });
const sha = createPublicClient({ chain: SHANNON, transport: http() });
const USDSO_HIDEKI = HIDEKI_USDSO;
const USDSO_SHANNON = SHANNON_USDSO;

const [sttS, nonceS, usdS, sttH, nonceH, usdH] = await Promise.all([
  sha.getBalance({ address: addr }), sha.getTransactionCount({ address: addr }),
  sha.readContract({ address: USDSO_SHANNON, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  hid.getBalance({ address: addr }), hid.getTransactionCount({ address: addr }),
  hid.readContract({ address: USDSO_HIDEKI, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
]);
console.log("Wallet:", addr);
console.log(`Shannon: ${formatEther(sttS)} STT | ${formatEther(usdS)} USDso | ${nonceS} txs sent`);
console.log(`Hideki : ${formatEther(sttH)} STT | ${formatEther(usdH)} USDso | ${nonceH} txs sent`);

const ex = new SomniaMarkets({ indexerUrl: INDEXER_URL, chain: HIDEKI, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
await ex.loadMarkets();
const sym = ex.symbols.find((s) => s.startsWith("ETH/") && s.includes(":"))!;
const mb = (ex.market(sym).market as any).marginBank;
const m = await ex.client.getMarginAccount(mb, addr);
console.log(`dreamDEX trading balance: ${toHuman(m.unlockedCollateralBalance, 18)} USDso free, ${toHuman(m.lockedCollateral, 18)} locked`);
const pos = await ex.client.listPerpPositions(addr).catch(() => []);
console.log("Perp positions:", pos.length);
const acct = await ex.client.accounts?.listControlledAccounts?.(addr).catch(() => null);
console.log("Smart accounts it controls (Perps Arena):", acct ? JSON.stringify(acct, (_, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 400) : "none found");
process.exit(0);
