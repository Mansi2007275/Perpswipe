// POST /api/streak — bump a wallet's daily streak. Only ever called for a trade that
//                    is already in the trades table, which means its receipt was
//                    verified on Hideki first. Body: { wallet, openTx }.
// GET  /api/streak?wallet=0x… — read it.
import { z } from "zod";
import { bad, failureText, gate, json, ok, readJson, requireDb } from "@/lib/api";
import { serverDb, type StreakRow } from "@/lib/supabase";
import { isAddress } from "@/lib/verify";

const bodySchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address"),
  openTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "not a transaction hash"),
});

// Dates in UTC, to match the `date` column and so a streak does not change with a
// user's timezone.
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = () => dayOf(Date.now());
const yesterday = () => dayOf(Date.now() - 864e5);

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
  const wallet = parsed.data.wallet.toLowerCase();

  try {
    const db = serverDb();

    // The gate: a streak only moves on a trade that passed receipt verification, and
    // the row is only there because POST /api/trades put it there.
    const { data: trade, error: tradeError } = await db
      .from("trades")
      .select("open_tx, wallet")
      .eq("open_tx", parsed.data.openTx.toLowerCase())
      .eq("wallet", wallet)
      .maybeSingle();
    if (tradeError) return bad(failureText(tradeError), 500);
    if (!trade) return bad("No verified trade with that transaction for this wallet.", 422);

    const { data: current, error: readError } = await db
      .from("streaks")
      .select("*")
      .eq("wallet", wallet)
      .maybeSingle();
    if (readError) return bad(failureText(readError), 500);

    const prev = current as StreakRow | null;
    const t = today();
    let days: number;
    if (prev?.last_day === t) days = prev.days; // already counted today
    else if (prev?.last_day === yesterday()) days = prev.days + 1;
    else days = 1;

    const { error: writeError } = await db
      .from("streaks")
      .upsert({ wallet, days, last_day: t }, { onConflict: "wallet" });
    if (writeError) return bad(failureText(writeError), 500);

    return ok({ days });
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
      .from("streaks")
      .select("*")
      .eq("wallet", wallet.toLowerCase())
      .maybeSingle();
    if (error) return bad(failureText(error), 500);

    const row = data as StreakRow | null;
    // A streak that skipped a day is over, even though the row still holds its length.
    const live = row && (row.last_day === today() || row.last_day === yesterday()) ? row.days : 0;
    return json({ ok: true, days: live });
  } catch (e) {
    return bad(failureText(e), 502);
  }
}
