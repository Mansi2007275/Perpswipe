// The perp market list, read server-side straight from the dreamDEX indexer over HTTP.
//
// Why not the SDK here: `SomniaMarkets` reaches the chain over a WebSocket (the SDK has
// no HTTP fallback for chain reads), and a route handler should not open one for what is
// a single GraphQL row lookup. The `Market` table and these column names are the ones
// the SDK's own market query selects.
import { publicEnv } from "./env";

export type PerpMarketRow = {
  symbol: string;
  pool: string;
  marginBank: string;
  stopRegistry: string | null;
  baseDecimals: number;
  quoteDecimals: number;
};

const QUERY = `
  query PerpSwipePerpMarkets {
    Market(where: { marketType: { _eq: "PERP" } }) {
      poolAddress
      marginBank
      stopRegistry
      baseSymbol
      quoteSymbol
      baseDecimals
      quoteDecimals
    }
  }
`;

type WireRow = {
  poolAddress: string | null;
  marginBank: string | null;
  stopRegistry: string | null;
  baseSymbol: string | null;
  quoteSymbol: string | null;
  baseDecimals: number | null;
  quoteDecimals: number | null;
};

// Same rule the SDK uses to build a unified symbol for a perp: a linear perp settles
// in its quote, so the quote appears twice.
const sanitize = (s: string) => s.replace(/[^A-Za-z0-9.]+/g, "");
const perpSymbol = (base: string, quote: string) => `${sanitize(base)}/${sanitize(quote)}:${sanitize(quote)}`;

let cache: { rows: PerpMarketRow[]; at: number } | null = null;
const TTL_MS = 60_000;

export async function perpMarkets(): Promise<PerpMarketRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;

  const res = await fetch(publicEnv.indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`dreamDEX indexer answered ${res.status}`);
  const body = (await res.json()) as { data?: { Market?: WireRow[] }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`dreamDEX indexer: ${body.errors[0].message}`);

  const rows = (body.data?.Market ?? [])
    .filter((r): r is WireRow & { poolAddress: string; marginBank: string; baseSymbol: string; quoteSymbol: string } =>
      !!r.poolAddress && !!r.marginBank && !!r.baseSymbol && !!r.quoteSymbol,
    )
    .map((r) => ({
      symbol: perpSymbol(r.baseSymbol, r.quoteSymbol),
      pool: r.poolAddress.toLowerCase(),
      marginBank: r.marginBank.toLowerCase(),
      stopRegistry: r.stopRegistry ? r.stopRegistry.toLowerCase() : null,
      baseDecimals: r.baseDecimals ?? 18,
      quoteDecimals: r.quoteDecimals ?? 18,
    }));

  if (rows.length === 0) throw new Error("dreamDEX lists no perp markets right now.");
  cache = { rows, at: Date.now() };
  return rows;
}

/** One market by its unified symbol, matched case-insensitively (BTC/USDso:USDso vs BTC/USDSO:USDSO). */
export async function perpMarket(symbol: string): Promise<PerpMarketRow | null> {
  const rows = await perpMarkets();
  const want = symbol.toLowerCase();
  return rows.find((r) => r.symbol.toLowerCase() === want) ?? null;
}

/** Every perp pool address. An open or close tx must have gone to one of these. */
export async function perpPoolAddresses(): Promise<string[]> {
  return (await perpMarkets()).map((r) => r.pool);
}
