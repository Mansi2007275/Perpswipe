// POST /api/trades            record a trade, but only after proving it on-chain
// GET  /api/trades?wallet=0x…  that wallet's history
import { z } from "zod";
import { bad, failureText, gate, json, ok, readJson, requireDb } from "@/lib/api";
import { serverDb, type TradeRow } from "@/lib/supabase";
import { perpMarket } from "@/lib/markets-server";
import { hidekiReceiptReader, isAddress, verifyTxReceipt } from "@/lib/verify";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "not a transaction hash");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address");
const positive = z.number().finite().positive();

const bodySchema = z.object({
  openTx: hash,
  stopTx: hash.optional(),
  wallet: address,
  symbol: z.string().min(3).max(64),
  side: z.enum(["long", "short"]),
  leverage: z.number().int().min(1).max(100),
  plan: z.object({
    qty: positive,
    price: positive,
    margin: positive,
    stopPrice: z.number().finite().nonnegative(),
    liquidationPrice: z.number().finite().nonnegative(),
    maxLoss: z.number().finite().nonnegative(),
  }),
});

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
  const b = parsed.data;

  try {
    const market = await perpMarket(b.symbol);
    if (!market) return bad(`dreamDEX has no perp market called ${b.symbol}.`, 404);

    // The whole point of this route: a trade is only recorded if the chain agrees it
    // happened, came from this wallet, and went to this market's pool.
    const check = await verifyTxReceipt(
      { txHash: b.openTx, wallet: b.wallet, allowedTo: [market.pool] },
      hidekiReceiptReader(),
    );
    if (!check.ok) return bad(check.reason, 422);

    const row = {
      wallet: b.wallet.toLowerCase(),
      symbol: market.symbol,
      side: b.side,
      qty: b.plan.qty,
      entry_price: b.plan.price,
      margin: b.plan.margin,
      leverage: b.leverage,
      stop_price: b.plan.stopPrice,
      liq_price: b.plan.liquidationPrice,
      max_loss: b.plan.maxLoss,
      open_tx: b.openTx.toLowerCase(),
      stop_tx: b.stopTx?.toLowerCase() ?? null,
      status: "open" as const,
    };

    // open_tx is unique, so a retried request updates the stop hash instead of
    // inserting the same trade twice.
    const { data, error } = await serverDb()
      .from("trades")
      .upsert(row, { onConflict: "open_tx" })
      .select()
      .single();
    if (error) return bad(failureText(error), 500);

    return ok({ trade: data as TradeRow });
  } catch (e) {
    return bad(failureText(e), 502);
  }
}

export async function GET(req: Request) {
  const off = requireDb();
  if (off) return off;

  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!isAddress(wallet)) return bad("Pass ?wallet=0x… with a wallet address.");

  try {
    const { data, error } = await serverDb()
      .from("trades")
      .select("*")
      .eq("wallet", wallet.toLowerCase())
      .order("opened_at", { ascending: false })
      .limit(100);
    if (error) return bad(failureText(error), 500);
    return json({ ok: true, trades: (data ?? []) as TradeRow[] });
  } catch (e) {
    return bad(failureText(e), 502);
  }
}
