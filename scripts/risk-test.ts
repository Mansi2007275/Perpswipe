// Checks PerpSwipe's risk math against live dreamDEX markets on Hideki.
import { loadDeck, quote } from "../lib/dex";
import { liquidationPrice, planTrade } from "../lib/risk";

const assert = (ok: boolean, msg: string) => { if (!ok) { console.error("FAIL", msg); process.exitCode = 1; } else console.log("ok  ", msg); };

// 1. Formula sanity
assert(Math.abs(liquidationPrice("long", 100, 2, 250) - 51.282) < 0.01, "2x long liquidates ~49% down");
assert(Math.abs(liquidationPrice("short", 100, 5, 250) - 117.07) < 0.01, "5x short liquidates ~17% up");
const p = planTrade({ side: "long", price: 2400, marginUsd: 10, leverage: 3, mmBps: 250, minQty: 0.004, qtyStep: 0.0001 });
assert(p.stopPrice > p.liquidationPrice, "stop-loss fires before liquidation");
assert(p.maxLoss < 10, `max loss ${p.maxLoss.toFixed(2)} stays under the 10 USDso put in`);

// 2. Live markets
const deck = await loadDeck();
console.log(`live perp markets: ${deck.length}`);
for (const c of deck.slice(0, 4)) {
  const q = await quote(c, "long", 10, 3);
  console.log(`${c.base.padEnd(5)} price ${c.price.toFixed(3)} mm ${c.mmBps}bps maxLev ${c.maxLeverage}x | qty ${q.qty} liq ${q.liquidationPrice.toFixed(3)} stop ${q.stopPrice.toFixed(3)} maxLoss ${q.maxLoss.toFixed(2)} closes ${c.closes.length}`);
}
process.exit();
