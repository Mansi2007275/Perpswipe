// Places ONE small perp LONG on Hideki, then closes it. Prints both tx hashes = your proof.
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { getKey, json, HIDEKI, INDEXER_URL } from "./env.js";

const exchange = new SomniaMarkets({
  indexerUrl: INDEXER_URL,
  chain: HIDEKI,
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  privateKey: getKey(),
});
await exchange.loadMarkets();

const symbol = exchange.symbols.find((s) => s.startsWith("BTC/") && s.includes(":"))
  ?? exchange.symbols.find((s) => s.includes(":"));
if (!symbol) throw new Error("No perp market found");
const size = exchange.markets[symbol]?.limits.amount.min ?? 0.001;
console.log("Wallet:", exchange.walletAddress, "| Market:", symbol, "| Size:", size);

// Margin: perps take collateral from the MarginBank
const dep = await exchange.depositMargin(symbol, 50);
console.log("Deposited 50 USDso margin:", json(dep));

// OPEN long: buy at a price that crosses the best ask (fills immediately)
let ob = await exchange.fetchOrderBook(symbol, 1);
const ask = ob.asks[0]?.[0];
if (!ask) throw new Error("Order book has no asks right now, try again later");
const open = await exchange.createOrder(symbol, "limit", "buy", size, exchange.priceToPrecision(symbol, ask * 1.01), { timeInForce: "IOC" });
console.log("OPEN  tx:", open.txHash, "| status:", open.status, "| filled:", open.filled);

// CLOSE: sell same size at a price that crosses the best bid
ob = await exchange.fetchOrderBook(symbol, 1);
const bid = ob.bids[0]?.[0];
if (bid && open.filled > 0) {
  const close = await exchange.createOrder(symbol, "limit", "sell", open.filled, exchange.priceToPrecision(symbol, bid * 0.99), { timeInForce: "IOC" });
  console.log("CLOSE tx:", close.txHash, "| status:", close.status, "| filled:", close.filled);
}
console.log("Positions:", json(await exchange.fetchPositions()));
await exchange.close();
