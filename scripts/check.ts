// Read-only: connects to Hideki (Somnia Tokyo perps testnet) and lists perp markets + balances
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { getKey, HIDEKI, INDEXER_URL } from "./env.js";

const exchange = new SomniaMarkets({
  indexerUrl: INDEXER_URL,
  chain: HIDEKI,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  privateKey: getKey(),
});

await exchange.loadMarkets();
console.log("Wallet:", exchange.walletAddress);
const perps = exchange.symbols.filter((s) => s.includes(":"));
console.log("Perp markets:", perps);
for (const s of perps) {
  const ob = await exchange.fetchOrderBook(s, 1);
  console.log(s, "best bid:", ob.bids[0]?.[0], "best ask:", ob.asks[0]?.[0], "min size:", exchange.markets[s]?.limits.amount.min);
}
const bal = await exchange.fetchBalance();
console.log("STT (gas):", bal.STT?.total, "| USDso:", bal.USDso?.total);
await exchange.close();
