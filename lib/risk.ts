// Pure risk math for one PerpSwipe trade. No network, no SDK — easy to test.
//
// Liquidation (isolated estimate, same rule the MarginBank uses: equity == maintenance margin)
//   long  p = entry * (1 - im) / (1 - mm)
//   short p = entry * (1 + im) / (1 + mm)
// where im = 1 / leverage (the margin you put in) and mm = maintenance margin rate.
// On dreamDEX the account is cross-margin, so extra balance only moves the real
// liquidation price FURTHER away. This estimate is the worst case for this trade.

export type Side = "long" | "short";

export type RiskLevel = { id: "steady" | "balanced" | "bold"; name: string; leverage: number; hint: string };

export const RISK_LEVELS: RiskLevel[] = [
  { id: "steady", name: "Steady", leverage: 2, hint: "Price must move about 49% against you to liquidate" },
  { id: "balanced", name: "Balanced", leverage: 3, hint: "Good default for a first week" },
  { id: "bold", name: "Bold", leverage: 5, hint: "Small moves matter. Stop-loss is closer" },
];

export const SIZES_USD = [5, 10, 25] as const;

export type PlanInput = {
  side: Side;
  /** Price you expect to fill at (best ask for a long, best bid for a short). */
  price: number;
  /** USDso of your own money for this trade. */
  marginUsd: number;
  leverage: number;
  /** Maintenance margin rate in basis points (250 = 2.5%). */
  mmBps: number;
  /** Smallest order size the market accepts, in base units. */
  minQty: number;
  /** Size step (lot), in base units. */
  qtyStep: number;
  /** Taker fee per side in basis points, used only for the max-loss estimate. */
  feeBps?: number;
};

export type Plan = {
  qty: number;
  notional: number;
  margin: number;
  liquidationPrice: number;
  stopPrice: number;
  /** Most you lose if the stop-loss fills at its trigger, fees included. */
  maxLoss: number;
  /** How far price can move against you before the stop fires, as a fraction. */
  stopDistance: number;
  /** How far price can move against you before liquidation, as a fraction. */
  liquidationDistance: number;
  bumpedToMinimum: boolean;
};

const floorToStep = (x: number, step: number) => {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.floor(x / step + 1e-9) * step).toFixed(decimals));
};

export function liquidationPrice(side: Side, entry: number, leverage: number, mmBps: number) {
  const im = 1 / leverage;
  const mm = mmBps / 10_000;
  return side === "long" ? (entry * (1 - im)) / (1 - mm) : (entry * (1 + im)) / (1 + mm);
}

/** The stop sits halfway to the money you put in, so it always fires well before liquidation. */
export function stopPrice(side: Side, entry: number, leverage: number) {
  const distance = 1 / leverage / 2;
  return side === "long" ? entry * (1 - distance) : entry * (1 + distance);
}

export function planTrade(p: PlanInput): Plan {
  const feeBps = p.feeBps ?? 10;
  let qty = floorToStep((p.marginUsd * p.leverage) / p.price, p.qtyStep);
  let bumpedToMinimum = false;
  if (qty < p.minQty) {
    qty = p.minQty;
    bumpedToMinimum = true;
  }
  const notional = qty * p.price;
  const margin = notional / p.leverage;
  const liq = liquidationPrice(p.side, p.price, p.leverage, p.mmBps);
  const stop = stopPrice(p.side, p.price, p.leverage);
  const fees = (notional * feeBps * 2) / 10_000;
  const maxLoss = qty * Math.abs(p.price - stop) + fees;
  return {
    qty,
    notional,
    margin,
    liquidationPrice: liq,
    stopPrice: stop,
    maxLoss,
    stopDistance: Math.abs(p.price - stop) / p.price,
    liquidationDistance: Math.abs(p.price - liq) / p.price,
    bumpedToMinimum,
  };
}

export function fmtPrice(n: number) {
  if (!Number.isFinite(n)) return "–";
  const digits = n >= 1000 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
}

export function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "–";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDso`;
}

export function fmtPct(fraction: number) {
  const v = fraction * 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
