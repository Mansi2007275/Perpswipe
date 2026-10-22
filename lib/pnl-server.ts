// Realised PnL for one close, read server-side from the dreamDEX indexer over HTTP.
//
// MarginBank emits one PositionUpdated per fill, so one close can be several rows.
// The SDK's `client.listPerpPositionChanges` is the same read; it is issued here as a
// plain GraphQL POST so a route handler opens no chain WebSocket. Table and column
// names are the ones the SDK's own query selects.
//
// Rounding note from the SDK docs: `realizedPnl` is PRICE PnL only — fees and funding
// are separate records — so the number stored here is the position's realised price PnL.
import { publicEnv } from "./env";

const QUERY = `
  query PerpSwipePositionChanges($where: PerpPositionChange_bool_exp!) {
    PerpPositionChange(where: $where, order_by: [{ blockNumber: asc }, { logIndex: asc }]) {
      kind
      closedSize
      entryPriceBefore
      exitPrice
      realizedPnl
      sizeAfter
      txHash
    }
  }
`;

type WireChange = {
  kind: string;
  closedSize: string | null;
  entryPriceBefore: string | null;
  exitPrice: string | null;
  realizedPnl: string | null;
  sizeAfter: string | null;
  txHash: string;
};

export type CloseOutcome = {
  /** Realised price PnL in USDso, summed over every fill of this close. */
  pnl: number;
  /** Size-weighted average price the close filled at, or null when nothing closed. */
  closePrice: number | null;
  /** Signed position size after the last row: 0 means the close was complete. */
  sizeAfter: number;
  /** How many PositionUpdated rows the close made. 0 = the indexer has not seen it yet. */
  rows: number;
};

const big = (v: string | null | undefined) => (v ? BigInt(v) : 0n);

/** bigint raw units -> number, for a value that is a price or an amount, not a balance. */
const human = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

/**
 * Read what one transaction did to an account's position.
 *
 * `txHash` alone is not enough — one transaction holds both sides of a fill — so the
 * account is always part of the filter.
 */
export async function closeOutcome(opts: {
  account: string;
  pool: string;
  txHash: string;
  baseDecimals: number;
  quoteDecimals: number;
}): Promise<CloseOutcome> {
  const where = {
    account: { _eq: opts.account.toLowerCase() },
    pool: { _eq: opts.pool.toLowerCase() },
    txHash: { _eq: opts.txHash.toLowerCase() },
    kind: { _in: ["REDUCE", "CLOSE", "FLIP"] },
  };

  const res = await fetch(publicEnv.indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { where } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`dreamDEX indexer answered ${res.status}`);
  const body = (await res.json()) as { data?: { PerpPositionChange?: WireChange[] }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`dreamDEX indexer: ${body.errors[0].message}`);

  const rows = body.data?.PerpPositionChange ?? [];
  if (rows.length === 0) return { pnl: 0, closePrice: null, sizeAfter: 0, rows: 0 };

  let pnlRaw = 0n;
  let closedRaw = 0n;
  // Size-weighted exit price: sum(exit * closed) / sum(closed), all in raw units.
  let weighted = 0n;
  for (const r of rows) {
    pnlRaw += big(r.realizedPnl);
    const closed = big(r.closedSize);
    closedRaw += closed;
    weighted += big(r.exitPrice) * closed;
  }

  const last = rows[rows.length - 1];
  return {
    pnl: human(pnlRaw, opts.quoteDecimals),
    closePrice: closedRaw > 0n ? human(weighted / closedRaw, opts.quoteDecimals) : null,
    sizeAfter: human(big(last.sizeAfter), opts.baseDecimals),
    rows: rows.length,
  };
}

// ------------------------------------------------- what the watcher needs

const STOPS_QUERY = `
  query PerpSwipeFiredStops($where: StopOrder_bool_exp!) {
    StopOrder(where: $where, order_by: [{ updatedAt: desc }]) {
      orderIdRaw
      status
      dropReason
      updatedAt
      txHash
    }
  }
`;

export type FiredStop = { orderIdRaw: string; status: string; dropReason: string | null; updatedAt: string; txHash: string };

/**
 * Stops on this pool, for this owner, that have already fired.
 *
 * `StopOrder` is shared with spot markets, so the read is scoped by `market_id` to the
 * perp pool — a spot stop's `orderIdRaw` addresses a different registry entirely.
 *
 * `TRIGGER_FAILED` is included deliberately: per the SDK docs a `ReduceOnly*` drop
 * reason means the stop was overtaken by events rather than rejected, and the SOMI is
 * spent either way, so for "did this stop stop being armed" both are terminal.
 */
export async function firedStops(opts: { account: string; pool: string; sinceSec?: number }): Promise<FiredStop[]> {
  const where: Record<string, unknown> = {
    market_id: { _eq: opts.pool.toLowerCase() },
    owner: { _eq: opts.account.toLowerCase() },
    status: { _in: ["TRIGGERED", "TRIGGER_FAILED"] },
  };
  if (opts.sinceSec !== undefined) where.updatedAt = { _gte: String(opts.sinceSec) };

  const res = await fetch(publicEnv.indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: STOPS_QUERY, variables: { where } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`dreamDEX indexer answered ${res.status}`);
  const body = (await res.json()) as { data?: { StopOrder?: FiredStop[] }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`dreamDEX indexer: ${body.errors[0].message}`);
  return body.data?.StopOrder ?? [];
}

const LAST_CLOSE_QUERY = `
  query PerpSwipeLastClose($where: PerpPositionChange_bool_exp!) {
    PerpPositionChange(where: $where, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: 50) {
      kind
      closedSize
      exitPrice
      realizedPnl
      sizeAfter
      txHash
      timestamp
    }
  }
`;

export type LastClose = CloseOutcome & { txHash: string };

/**
 * The most recent close of this position, whoever closed it — the user, a stop-loss or
 * a liquidation. Used by the watcher, which has no close transaction to look up.
 *
 * Rows are read newest-first and only the newest transaction's rows are summed, because
 * one close is one transaction but one transaction can be several fills.
 */
export async function lastClose(opts: {
  account: string;
  pool: string;
  sinceSec?: number;
  baseDecimals: number;
  quoteDecimals: number;
}): Promise<LastClose | null> {
  const where: Record<string, unknown> = {
    account: { _eq: opts.account.toLowerCase() },
    pool: { _eq: opts.pool.toLowerCase() },
    kind: { _in: ["REDUCE", "CLOSE", "FLIP"] },
  };
  if (opts.sinceSec !== undefined) where.timestamp = { _gte: String(opts.sinceSec) };

  const res = await fetch(publicEnv.indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: LAST_CLOSE_QUERY, variables: { where } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`dreamDEX indexer answered ${res.status}`);
  const body = (await res.json()) as { data?: { PerpPositionChange?: WireChange[] }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`dreamDEX indexer: ${body.errors[0].message}`);

  const rows = body.data?.PerpPositionChange ?? [];
  if (rows.length === 0) return null;

  const txHash = rows[0].txHash;
  const sameTx = rows.filter((r) => r.txHash === txHash);

  let pnlRaw = 0n;
  let closedRaw = 0n;
  let weighted = 0n;
  for (const r of sameTx) {
    pnlRaw += big(r.realizedPnl);
    const closed = big(r.closedSize);
    closedRaw += closed;
    weighted += big(r.exitPrice) * closed;
  }
  // rows[0] is the newest row of that transaction, so its sizeAfter is the final size.
  return {
    txHash,
    pnl: human(pnlRaw, opts.quoteDecimals),
    closePrice: closedRaw > 0n ? human(weighted / closedRaw, opts.quoteDecimals) : null,
    sizeAfter: human(big(rows[0].sizeAfter), opts.baseDecimals),
    rows: sameTx.length,
  };
}
