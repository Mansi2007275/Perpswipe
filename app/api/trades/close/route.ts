// POST /api/trades/close — record the close of a trade, after proving it on-chain.
//
// Body: { openTx, closeTx }. The wallet is NOT taken from the request: it comes from
// the stored trade, and the close transaction must have been sent by that same wallet.
import { z } from "zod";
import { bad, failureText, gate, ok, readJson, requireDb } from "@/lib/api";
import { serverDb, type TradeRow } from "@/lib/supabase";
import { perpMarket } from "@/lib/markets-server";
import { closeOutcome } from "@/lib/pnl-server";
import { hidekiReceiptReader, verifyTxReceipt } from "@/lib/verify";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "not a transaction hash");
const bodySchema = z.object({ openTx: hash, closeTx: hash });

export async function POST(req: Request) {
  const limited = gate(req);
  if (limited) return limited;
  const off = requireDb();
  if (off) return off;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return bad(`${i.path.join(".") || "body"}: ${i.message}`);
  }
  const { openTx, closeTx } = parsed.data;

  try {
    const db = serverDb();
    const { data: trade, error: readError } = await db
      .from("trades")
      .select("*")
      .eq("open_tx", openTx.toLowerCase())
      .maybeSingle();
    if (readError) return bad(failureText(readError), 500);
    if (!trade) return bad("No trade with that open transaction. Record the open first.", 404);

    const row = trade as TradeRow;
    const market = await perpMarket(row.symbol);
    if (!market) return bad(`dreamDEX has no perp market called ${row.symbol}.`, 404);

    const check = await verifyTxReceipt(
      { txHash: closeTx, wallet: row.wallet, allowedTo: [market.pool] },
      hidekiReceiptReader(),
    );
    if (!check.ok) return bad(check.reason, 422);

    // What the close actually did, from the chain's own position updates.
    const outcome = await closeOutcome({
      account: row.wallet,
      pool: market.pool,
      txHash: closeTx,
      baseDecimals: market.baseDecimals,
      quoteDecimals: market.quoteDecimals,
    });
    if (outcome.rows === 0) {
      return bad("That close is on-chain but dreamDEX has not indexed it yet. Try again in a few seconds.", 409);
    }

    const { data, error } = await db
      .from("trades")
      .update({
        close_tx: closeTx.toLowerCase(),
        close_price: outcome.closePrice,
        pnl: outcome.pnl,
        // A close that left size behind is still open; only a flat position is closed.
        status: outcome.sizeAfter === 0 ? "closed" : "open",
        closed_at: outcome.sizeAfter === 0 ? new Date().toISOString() : null,
      })
      .eq("open_tx", openTx.toLowerCase())
      .select()
      .single();
    if (error) return bad(failureText(error), 500);

    return ok({ trade: data as TradeRow, pnl: outcome.pnl, closePrice: outcome.closePrice });
  } catch (e) {
    return bad(failureText(e), 502);
  }
}
