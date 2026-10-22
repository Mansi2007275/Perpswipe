// GET /api/cron/sync — the stop-loss watcher.
//
// A stop-loss fires on-chain without the browser being open, so nothing in the app
// would notice. This walks every trade still marked 'open', reads its position from
// the MarginBank, and when the position is flat and a stop has fired it records the
// close the stop made.
//
// Protected by CRON_SECRET: either `Authorization: Bearer <secret>` (what Vercel Cron
// sends) or `?secret=<secret>`.
import { bad, failureText, json } from "@/lib/api";
import { optionalServerEnv, serverDbConfigured } from "@/lib/env";
import { serverDb, type TradeRow } from "@/lib/supabase";
import { perpMarket } from "@/lib/markets-server";
import { firedStops, lastClose } from "@/lib/pnl-server";
import { hidekiClient } from "@/lib/verify";
import type { Address } from "viem";

// The one MarginBank read this route needs. Signature taken from the SDK's own
// marginBankReadAbi.
const marginBankAbi = [
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "perpPool", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "size", type: "int128" },
          { name: "avgEntryPrice", type: "uint128" },
          { name: "entryFundingIndex", type: "int256" },
          { name: "lastUpdatedTimestampNs", type: "uint64" },
        ],
      },
    ],
  },
] as const;

function authorized(req: Request): boolean {
  const secret = optionalServerEnv.cronSecret();
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!optionalServerEnv.cronSecret()) {
    return bad("CRON_SECRET is not set, so this route is disabled. Add it to .env.", 503);
  }
  if (!authorized(req)) return bad("Not authorised.", 401);
  if (!serverDbConfigured()) return bad("Supabase is not configured, so there is nothing to sync.", 503);

  try {
    const db = serverDb();
    const { data, error } = await db
      .from("trades")
      .select("*")
      .eq("status", "open")
      .order("opened_at", { ascending: true })
      .limit(200);
    if (error) return bad(failureText(error), 500);

    const open = (data ?? []) as TradeRow[];
    const chain = hidekiClient();
    const checked: { openTx: string; outcome: string }[] = [];

    for (const trade of open) {
      try {
        const market = await perpMarket(trade.symbol);
        if (!market) {
          checked.push({ openTx: trade.open_tx, outcome: "market no longer listed" });
          continue;
        }

        const position = await chain.readContract({
          address: market.marginBank as Address,
          abi: marginBankAbi,
          functionName: "getPosition",
          args: [trade.wallet as Address, market.pool as Address],
        });
        if (position.size !== 0n) {
          checked.push({ openTx: trade.open_tx, outcome: "still open" });
          continue;
        }

        // Flat. Was it a stop that did it? Only count stops that fired at or after the
        // trade opened, so an older stop on the same market cannot claim this close.
        const openedSec = Math.floor(new Date(trade.opened_at).getTime() / 1000);
        const stops = await firedStops({ account: trade.wallet, pool: market.pool, sinceSec: openedSec });
        const close = await lastClose({
          account: trade.wallet,
          pool: market.pool,
          sinceSec: openedSec,
          baseDecimals: market.baseDecimals,
          quoteDecimals: market.quoteDecimals,
        });

        if (!close) {
          checked.push({ openTx: trade.open_tx, outcome: "flat but no close indexed yet" });
          continue;
        }
        // The user's own close is recorded by POST /api/trades/close, which runs in the
        // browser right after the close. Anything the watcher finds that a fired stop
        // explains is a stop close; anything else is flat for a reason this route
        // cannot attribute (a liquidation, or a close made elsewhere), and is recorded
        // as closed rather than guessed at.
        const stopped = stops.length > 0;

        const { error: writeError } = await db
          .from("trades")
          .update({
            status: stopped ? "stopped" : "closed",
            close_tx: trade.close_tx ?? close.txHash,
            close_price: close.closePrice,
            pnl: close.pnl,
            closed_at: new Date().toISOString(),
          })
          .eq("open_tx", trade.open_tx);
        if (writeError) {
          checked.push({ openTx: trade.open_tx, outcome: `could not save: ${failureText(writeError)}` });
          continue;
        }
        checked.push({ openTx: trade.open_tx, outcome: stopped ? "stopped" : "closed" });
      } catch (e) {
        checked.push({ openTx: trade.open_tx, outcome: `skipped: ${failureText(e)}` });
      }
    }

    return json({
      ok: true,
      openTrades: open.length,
      stopped: checked.filter((c) => c.outcome === "stopped").length,
      closed: checked.filter((c) => c.outcome === "closed").length,
      checked,
    });
  } catch (e) {
    return bad(failureText(e), 502);
  }
}
