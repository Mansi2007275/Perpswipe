// Opens and closes one small BTC perp position for your Perps Arena account,
// signed by a bot key you linked in the dreamDEX app ("Link a bot").
// Prints Tokyo explorer links for both transactions = whitelist proof.
//
//   .env:  PRIVATE_KEY=0x...   (bot key from `npm run keygen`)
//          ACCOUNT=0x...       (your Perps Arena smart account)
//   run:   npm run bot-trade            (add -- --check to only check the setup)
import "dotenv/config";
import { createPublicClient, formatEther, getAddress, http, isHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, fromHuman, toHuman } from "@somnia-chain/markets-sdk";
import { HIDEKI, INDEXER_URL } from "./env.js";

const EXPLORER = "https://explorer.testnet.somnia.network/tokyo/tx/";
const key = process.env.PRIVATE_KEY;
const accountEnv = process.env.ACCOUNT;
if (!key || !isHex(key, { strict: true }) || key.length !== 66) throw new Error("PRIVATE_KEY missing in .env. Run: npm run keygen");
if (!accountEnv) throw new Error("ACCOUNT missing in .env. Put your Perps Arena account address there.");
const ACCOUNT = getAddress(accountEnv);
const bot = privateKeyToAccount(key as `0x${string}`);
const checkOnly = process.argv.includes("--check");

const rpc = createPublicClient({ chain: HIDEKI, transport: http() });
const ownersAbi = [{ type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }] as const;

// ---- 1. Setup checks -------------------------------------------------------
const [owners, botGas] = await Promise.all([
  rpc.readContract({ address: ACCOUNT, abi: ownersAbi, functionName: "getOwners" }),
  rpc.getBalance({ address: bot.address }),
]);
const linked = owners.map((o) => o.toLowerCase()).includes(bot.address.toLowerCase());
console.log("Arena account :", ACCOUNT);
console.log("Bot key       :", bot.address);
console.log("Account owners:", owners.join(", "));
console.log("Bot linked    :", linked ? "yes" : "NO");
console.log("Bot gas       :", formatEther(botGas), "STT");

if (!linked) {
  console.log("\nThe bot is not an owner of the account yet.");
  console.log("Open app.testnet.dreamdex.io, use 'Link a bot', paste the bot address above, approve, then run this again.");
  console.log("If the app linked it as an operator instead, send me this output and I will switch the script.");
  process.exit(1);
}
if (botGas < 600_000_000_000_000_000n) { // the SDK reserves 0.6 STT of gas ceiling per write
  console.log("\nThe bot pays gas for each order and needs about 1 STT on Tokyo.");
  console.log(`Send 1-2 STT from your Arena wallet (or ask in your dreamDEX ticket) to ${bot.address}, then run again.`);
  process.exit(1);
}
if (checkOnly) {
  console.log("\nSetup looks good. Run without --check to place the orders.");
  process.exit(0);
}

// ---- 2. Trade through the account -----------------------------------------
const ex = new SomniaMarkets({ indexerUrl: INDEXER_URL, chain: HIDEKI, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
await ex.loadMarkets();
const symbol = ex.symbols.find((s) => s.startsWith("BTC/") && s.includes(":"))!;
const row = ex.market(symbol).market as unknown as { poolAddress: Address; marginBank: Address; minQuantity: string; baseDecimals: number };
const client = ex.client;
const inner = client.createExecutor({ privateKey: key as `0x${string}` });
const executor = client.createExecutor({ smartAccount: ACCOUNT, inner });
const trader = client.createTrader({ executor });

const margin = await client.getMarginAccount(row.marginBank, ACCOUNT);
console.log(`\nTrading balance: ${toHuman(margin.unlockedCollateralBalance, 18)} USDso`);

const qty = BigInt(row.minQuantity); // smallest allowed size
const book1 = await ex.fetchOrderBook(symbol, 1);
const ask = book1.asks[0]?.[0];
if (!ask) throw new Error("No sellers on the BTC book right now. Try again in a minute.");
console.log(`Opening LONG ${toHuman(qty, row.baseDecimals)} BTC near ${ask} ...`);
const open = await trader.placePerpOrder({
  pool: row.poolAddress,
  isBid: true,
  quantity: qty,
  price: fromHuman(ex.priceToPrecision(symbol, ask * 1.01), 18),
  orderType: 2, // market (IOC), bounded by the price above
});
console.log("OPEN  tx:", EXPLORER + open.hash);

await new Promise((r) => setTimeout(r, 3000));
const book2 = await ex.fetchOrderBook(symbol, 1);
const bid = book2.bids[0]?.[0];
if (!bid) throw new Error("No buyers on the BTC book right now. Close the position in the dreamDEX app.");
console.log(`Closing at market near ${bid} ...`);
const close = await trader.placePerpOrder({
  pool: row.poolAddress,
  isBid: false,
  quantity: qty,
  price: fromHuman(ex.priceToPrecision(symbol, bid * 0.99), 18),
  orderType: 2,
});
console.log("CLOSE tx:", EXPLORER + close.hash);

console.log("\nPaste for your whitelist ticket:");
console.log(`- Account (Wallet 1): ${ACCOUNT}`);
console.log(`- Linked Bot Key: ${bot.address}`);
console.log(`- Live BTC-PERP Open Tx: ${EXPLORER}${open.hash}`);
console.log(`- Live BTC-PERP Close Tx: ${EXPLORER}${close.hash}`);
await ex.close();
process.exit(0);
