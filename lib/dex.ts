// Everything PerpSwipe does on dreamDEX goes through this file.
// Browser only: import it from client components.
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, fromHuman, toHuman } from "@somnia-chain/markets-sdk";
import type { Address, WalletClient } from "viem";
import { HIDEKI } from "./chains";
import { publicEnv } from "./env";
import { planTrade, stopPrice as stopPriceFor, type Plan, type Side } from "./risk";
const DECIMALS = 18; // USDso and every Hideki perp base use 18 decimals; read per market below anyway.
const PROBE_ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;

// Markets shown first, in this order. Anything else listed on dreamDEX follows.
const PREFERRED = ["BTC", "ETH", "SOL", "HYPE", "XRP", "SUI", "LINK", "ZEC", "TAO", "NEAR"];

let exchange: SomniaMarkets | null = null;
let ready: Promise<SomniaMarkets> | null = null;

export function getExchange(): Promise<SomniaMarkets> {
  if (!ready) {
    exchange = new SomniaMarkets({
      indexerUrl: publicEnv.indexerUrl,
      chain: HIDEKI,
      wsRpcUrl: publicEnv.hidekiWsUrl,
      addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
    });
    ready = exchange.loadMarkets().then(() => exchange!);
  }
  return ready;
}

/** Called by <SignerBinding/> whenever the connected wallet changes. */
export async function bindWallet(walletClient: WalletClient | undefined) {
  const ex = await getExchange();
  // wagmi and the SDK can resolve slightly different viem builds; the client shape is the same.
  ex.setSigner(walletClient ? ({ walletClient } as never) : {});
}

/** Raw market row the SDK returns for a perp (fields we use). */
type PerpRow = {
  poolAddress: Address;
  marginBank: Address;
  stopRegistry: Address | null;
  baseDecimals: number;
  quoteDecimals: number;
  lotSize: string;
  minQuantity: string;
  initialMarginBps: number;
};

export type DeckCard = {
  symbol: string;
  base: string;
  price: number;
  changePct: number; // 24h, as a fraction (-0.02 = -2%)
  closes: number[]; // last ~12h of 15-minute closes, oldest first
  fundingRate: number;
  minQty: number;
  qtyStep: number;
  mmBps: number;
  maxLeverage: number;
  pool: Address;
  marginBank: Address;
  stopRegistry: Address | null;
};

function rowOf(ex: SomniaMarkets, symbol: string): PerpRow {
  return ex.market(symbol).market as unknown as PerpRow;
}

/** Maintenance margin rate of a market, read from dreamDEX's own liquidation preview. */
async function readMmBps(ex: SomniaMarkets, row: PerpRow): Promise<number> {
  try {
    const qty = BigInt(row.minQuantity);
    const preview = await ex.client.previewPerpLiquidationPrice({
      pool: row.poolAddress,
      marginBank: row.marginBank,
      account: PROBE_ACCOUNT,
      isBid: true,
      quantity: qty,
      price: 1n, // any price: we only read the maintenance requirement at the mark
    });
    if (!preview.priceable || preview.projectedSize === 0n) return 250;
    const p = preview as typeof preview & { projectedMmReq: bigint; markPrice: bigint };
    const oneBase = 10n ** BigInt(row.baseDecimals);
    const bps = (p.projectedMmReq * oneBase * 10_000n) / (p.projectedSize * p.markPrice);
    return Number(bps) || 250;
  } catch {
    return 250; // dreamDEX perps currently use 2.5%
  }
}

export async function loadDeck(): Promise<DeckCard[]> {
  const ex = await getExchange();
  const perps = ex.symbols.filter((s) => s.includes(":") && ex.markets[s]?.active !== false);
  const rank = (s: string) => {
    const i = PREFERRED.indexOf(s.split("/")[0]);
    return i === -1 ? 99 : i;
  };
  perps.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const cards = await Promise.all(
    perps.map(async (symbol): Promise<DeckCard | null> => {
      try {
        const row = rowOf(ex, symbol);
        const [ticker, candles, mmBps] = await Promise.all([
          ex.fetchTicker(symbol),
          ex.fetchOHLCV(symbol, "15m", undefined, 48).catch(() => []),
          readMmBps(ex, row),
        ]);
        const price = ticker.markPrice ?? ticker.last;
        if (!price) return null;
        return {
          symbol,
          base: symbol.split("/")[0],
          price,
          changePct: ticker.percentage ?? 0,
          closes: candles.map((c) => c[4]),
          fundingRate: ticker.fundingRate ?? 0,
          minQty: toHuman(BigInt(row.minQuantity), row.baseDecimals),
          qtyStep: toHuman(BigInt(row.lotSize), row.baseDecimals),
          mmBps,
          maxLeverage: Math.floor(10_000 / row.initialMarginBps),
          pool: row.poolAddress,
          marginBank: row.marginBank,
          stopRegistry: row.stopRegistry,
        };
      } catch {
        return null;
      }
    }),
  );
  return cards.filter((c): c is DeckCard => c !== null);
}

/** Price you would actually get right now: best ask for a long, best bid for a short. */
export async function fillPrice(card: DeckCard, side: Side): Promise<number> {
  const ex = await getExchange();
  const book = await ex.fetchOrderBook(card.symbol, 1);
  const level = side === "long" ? book.asks[0] : book.bids[0];
  return level?.[0] ?? card.price;
}

export async function quote(card: DeckCard, side: Side, marginUsd: number, leverage: number): Promise<Plan & { price: number }> {
  const price = await fillPrice(card, side);
  const plan = planTrade({
    side,
    price,
    marginUsd,
    leverage,
    mmBps: card.mmBps,
    minQty: card.minQty,
    qtyStep: card.qtyStep,
  });
  return { ...plan, price };
}

export type Balances = { wallet: number; trading: number; gas: number };

export async function readBalances(account: Address, marginBank: Address): Promise<Balances> {
  const ex = await getExchange();
  const [bal, margin, gasWei] = await Promise.all([
    ex.fetchBalance().catch(() => null),
    ex.client.getMarginAccount(marginBank, account).catch(() => null),
    ex.client.getNativeBalance(account).catch(() => 0n),
  ]);
  return {
    wallet: bal?.USDso?.free ?? bal?.USDso?.total ?? 0,
    trading: margin ? toHuman(margin.unlockedCollateralBalance, DECIMALS) : 0,
    gas: toHuman(gasWei, 18),
  };
}

export async function addToTrading(card: DeckCard, amountUsd: number) {
  const ex = await getExchange();
  return ex.depositMargin(card.symbol, Number(amountUsd.toFixed(2)));
}

// Stop-loss ids are remembered per market so closing a trade also cancels its stop.
const STOPS_KEY = "perpswipe.stops";
type StopMemo = Record<string, { registry: Address; ids: string[] }>;
const readStops = (): StopMemo => {
  try {
    return JSON.parse(localStorage.getItem(STOPS_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const writeStops = (m: StopMemo) => {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify(m));
  } catch {
    /* storage blocked: stops still work on-chain */
  }
};

export type TradeResult = {
  openTx?: string;
  stopTx?: string;
  stopError?: string;
  filled: number;
  plan: Plan & { price: number };
};

export type TradeStep = "fund" | "open" | "stop" | "done";

export async function openTrade(
  card: DeckCard,
  side: Side,
  marginUsd: number,
  leverage: number,
  account: Address,
  onStep: (step: TradeStep) => void = () => {},
): Promise<TradeResult> {
  const ex = await getExchange();
  const plan = await quote(card, side, marginUsd, leverage);

  // 1. Make sure the trading balance covers this trade's margin (plus a small buffer for fees).
  const { trading } = await readBalances(account, card.marginBank);
  const needed = plan.margin * 1.05 - trading;
  if (needed > 0) {
    onStep("fund");
    await addToTrading(card, Math.max(needed, 1));
  }

  // 2. Open the position at market, at most 1% away from the best price.
  onStep("open");
  const order = await ex.createOrder(card.symbol, "market", side === "long" ? "buy" : "sell", plan.qty, undefined, {
    slippage: 0.01,
  });
  const result: TradeResult = { openTx: order.txHash, filled: order.filled, plan };
  if (!order.filled) return result;

  // 3. Arm the stop-loss on-chain. quantity 0 = "whole position", so it covers later adds too.
  if (card.stopRegistry) {
    onStep("stop");
    try {
      const trigger = ex.priceToPrecision(card.symbol, plan.stopPrice);
      const stop = await ex.trader.placePerpStopOrder({
        registry: card.stopRegistry,
        pool: card.pool,
        isBid: side === "short",
        quantity: 0n,
        triggerPrice: fromHuman(trigger, DECIMALS),
        triggerOperator: side === "long" ? 1 : 0, // long: fire when mark <= trigger; short: when mark >= trigger
        stopOrderType: 1, // market
        limitPrice: 0n,
      });
      result.stopTx = stop.hash;
      if (stop.stopOrderId !== undefined) {
        const memo = readStops();
        const prev = memo[card.symbol]?.ids ?? [];
        memo[card.symbol] = { registry: card.stopRegistry, ids: [...prev, stop.stopOrderId.toString()] };
        writeStops(memo);
      }
    } catch (e) {
      result.stopError = errorText(e);
    }
  } else {
    result.stopError = "This market has no stop-loss registry yet. Close the trade yourself.";
  }
  onStep("done");
  return result;
}

export type Position = {
  symbol: string;
  base: string;
  side: Side;
  size: number;
  entry: number;
  mark?: number;
  pnl?: number;
  liquidation?: number;
};

export async function myPositions(): Promise<Position[]> {
  const ex = await getExchange();
  if (!ex.walletAddress) return [];
  const rows = await ex.fetchPositions();
  return rows
    .filter((p) => p.contracts > 0)
    .map((p) => ({
      symbol: p.symbol,
      base: p.symbol.split("/")[0],
      side: p.side,
      size: p.contracts,
      entry: p.entryPrice,
      mark: p.markPrice,
      pnl: p.unrealizedPnl,
      liquidation: p.liquidationPrice,
    }));
}

export async function closePosition(pos: Position) {
  const ex = await getExchange();
  const order = await ex.createOrder(pos.symbol, "market", pos.side === "long" ? "sell" : "buy", pos.size, undefined, {
    slippage: 0.01,
  });
  // Cancel the stop we armed, so it does not fire on an empty position and burn its trigger gas.
  const memo = readStops();
  const stops = memo[pos.symbol];
  if (stops?.ids.length) {
    try {
      await ex.trader.cancelPerpStopOrders({ registry: stops.registry, orderIds: stops.ids });
    } catch {
      /* already fired or cancelled */
    }
    delete memo[pos.symbol];
    writeStops(memo);
  }
  return order;
}

export function errorText(e: unknown): string {
  const err = e as { shortMessage?: string; errorName?: string; message?: string; name?: string };
  if (err?.name === "UserRejectedRequestError" || /rejected|denied/i.test(err?.message ?? "")) {
    return "You cancelled it in your wallet. Nothing was sent.";
  }
  if (err?.errorName) return `dreamDEX rejected it: ${err.errorName}`;
  return err?.shortMessage ?? err?.message?.split("\n")[0] ?? "Something went wrong. Try again.";
}

/**
 * Does this failure mean "not enough money" rather than "something broke"?
 *
 * The two need different UI: a shortfall sends you to /funds, anything else just lets
 * you try the card again. Matched on the message because dreamDEX surfaces the reason
 * through several different revert names.
 */
export function looksLikeFunds(message: string): boolean {
  return /insufficient|not enough|exceeds balance|InsufficientCollateral|InsufficientBalance|InsufficientFunds|collateral|funds/i.test(
    message,
  );
}

/** Was the order accepted but never filled? Then nothing happened beyond gas. */
export function looksUnfilled(result: Pick<TradeResult, "openTx" | "filled">): boolean {
  return !!result.openTx && result.filled === 0;
}

/**
 * Arm (or re-arm) the stop-loss on a position that has none — the retry behind the
 * "Arm stop-loss" button, for when the stop transaction failed or was rejected while
 * the position itself opened.
 */
export async function armStopLoss(card: DeckCard, side: Side, entryPrice: number, leverage: number): Promise<string> {
  const ex = await getExchange();
  if (!card.stopRegistry) throw new Error("This market has no stop-loss registry yet.");
  const trigger = ex.priceToPrecision(card.symbol, stopPriceFor(side, entryPrice, leverage));
  const stop = await ex.trader.placePerpStopOrder({
    registry: card.stopRegistry,
    pool: card.pool,
    isBid: side === "short",
    quantity: 0n, // the whole position, including anything added later
    triggerPrice: fromHuman(trigger, DECIMALS),
    triggerOperator: side === "long" ? 1 : 0,
    stopOrderType: 1,
    limitPrice: 0n,
  });
  if (stop.stopOrderId !== undefined) {
    const memo = readStops();
    const prev = memo[card.symbol]?.ids ?? [];
    memo[card.symbol] = { registry: card.stopRegistry, ids: [...prev, stop.stopOrderId.toString()] };
    writeStops(memo);
  }
  return stop.hash;
}
