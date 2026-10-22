// The risk ticket is the promise PerpSwipe makes before anyone swipes, so these tests
// pin the three numbers on it: the stop price, the liquidation price and the max loss.
import { describe, expect, it } from "vitest";
import { fmtPct, fmtPrice, fmtUsd, liquidationPrice, planTrade, stopPrice, RISK_LEVELS, SIZES_USD } from "./risk";

const market = { mmBps: 250, minQty: 0.0001, qtyStep: 0.0001 };

describe("liquidationPrice", () => {
  // entry * (1 - 1/lev) / (1 - mm) = 100 * 0.5 / 0.975
  it("puts a 2x long about 49% below entry", () => {
    expect(liquidationPrice("long", 100, 2, 250)).toBeCloseTo(51.282, 3);
  });

  // entry * (1 + 1/lev) / (1 + mm) = 100 * 1.2 / 1.025
  it("puts a 5x short about 17% above entry", () => {
    expect(liquidationPrice("short", 100, 5, 250)).toBeCloseTo(117.073, 3);
  });

  it("moves closer to entry as leverage rises", () => {
    const low = liquidationPrice("long", 100, 2, 250);
    const high = liquidationPrice("long", 100, 10, 250);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(100);
  });

  it("is symmetric in direction: a long liquidates below entry, a short above", () => {
    expect(liquidationPrice("long", 2000, 3, 250)).toBeLessThan(2000);
    expect(liquidationPrice("short", 2000, 3, 250)).toBeGreaterThan(2000);
  });

  it("widens the distance when maintenance margin is lower", () => {
    const tight = liquidationPrice("long", 100, 5, 500);
    const loose = liquidationPrice("long", 100, 5, 0);
    expect(loose).toBeLessThan(tight); // less maintenance margin = more room before liquidation
  });
});

describe("stopPrice", () => {
  it("sits halfway to the margin put in", () => {
    // 4x: margin is 25% of the move, so the stop is 12.5% away.
    expect(stopPrice("long", 100, 4)).toBeCloseTo(87.5, 6);
    expect(stopPrice("short", 100, 4)).toBeCloseTo(112.5, 6);
  });

  it("always fires before liquidation, at every risk level the app offers", () => {
    for (const level of RISK_LEVELS) {
      const long = planTrade({ ...market, side: "long", price: 2400, marginUsd: 10, leverage: level.leverage });
      const short = planTrade({ ...market, side: "short", price: 2400, marginUsd: 10, leverage: level.leverage });
      expect(long.stopPrice, `${level.id} long`).toBeGreaterThan(long.liquidationPrice);
      expect(short.stopPrice, `${level.id} short`).toBeLessThan(short.liquidationPrice);
    }
  });
});

describe("planTrade", () => {
  it("sizes the position from margin and leverage", () => {
    const p = planTrade({ ...market, side: "long", price: 100, marginUsd: 10, leverage: 3 });
    expect(p.qty).toBeCloseTo(0.3, 6); // 10 * 3 / 100
    expect(p.notional).toBeCloseTo(30, 6);
    expect(p.margin).toBeCloseTo(10, 6);
  });

  it("rounds the size down to the market's lot, never up", () => {
    const p = planTrade({ side: "long", price: 100, marginUsd: 10, leverage: 3, mmBps: 250, minQty: 0.001, qtyStep: 0.01 });
    expect(p.qty).toBe(0.3);
    const awkward = planTrade({ side: "long", price: 97, marginUsd: 10, leverage: 3, mmBps: 250, minQty: 0.001, qtyStep: 0.05 });
    expect(awkward.qty).toBe(0.3); // 0.309... floors to 0.30, so it never needs more margin than promised
    expect(awkward.notional).toBeLessThanOrEqual(10 * 3);
  });

  it("flags a size raised to the market minimum, because it then costs more than asked", () => {
    const p = planTrade({ side: "long", price: 100000, marginUsd: 5, leverage: 2, mmBps: 250, minQty: 0.01, qtyStep: 0.01 });
    expect(p.bumpedToMinimum).toBe(true);
    expect(p.qty).toBe(0.01);
    expect(p.margin).toBeGreaterThan(5); // the card says so, which is why the flag exists
  });

  it("does not flag an ordinary size", () => {
    expect(planTrade({ ...market, side: "long", price: 100, marginUsd: 10, leverage: 3 }).bumpedToMinimum).toBe(false);
  });

  it("keeps the max loss under the money put in, for every size and risk level offered", () => {
    for (const size of SIZES_USD) {
      for (const level of RISK_LEVELS) {
        for (const price of [0.42, 104, 2400, 81000]) {
          for (const side of ["long", "short"] as const) {
            const p = planTrade({ ...market, side, price, marginUsd: size, leverage: level.leverage });
            // The whole promise of the risk ticket: the stop fires before the margin is gone.
            expect(p.maxLoss, `${side} ${size} ${level.id} @${price}`).toBeLessThan(p.margin);
          }
        }
      }
    }
  });

  it("counts fees on both sides of the round trip in the max loss", () => {
    const free = planTrade({ ...market, side: "long", price: 100, marginUsd: 10, leverage: 2, feeBps: 0 });
    const paid = planTrade({ ...market, side: "long", price: 100, marginUsd: 10, leverage: 2, feeBps: 10 });
    // 2 sides * 10bps on a notional of 20 = 0.04
    expect(paid.maxLoss - free.maxLoss).toBeCloseTo(0.04, 6);
  });

  it("reports the distances the card shows as percentages", () => {
    const p = planTrade({ ...market, side: "long", price: 100, marginUsd: 10, leverage: 4 });
    expect(p.stopDistance).toBeCloseTo(0.125, 6);
    expect(p.liquidationDistance).toBeCloseTo(1 - 75 / 97.5, 6);
    expect(p.stopDistance).toBeLessThan(p.liquidationDistance);
  });

  it("loses the same whichever way a symmetric trade is taken", () => {
    const long = planTrade({ ...market, side: "long", price: 100, marginUsd: 10, leverage: 3 });
    const short = planTrade({ ...market, side: "short", price: 100, marginUsd: 10, leverage: 3 });
    expect(long.maxLoss).toBeCloseTo(short.maxLoss, 6);
  });
});

describe("formatting", () => {
  it("shows more decimals for smaller prices", () => {
    expect(fmtPrice(81377.07)).toBe("81,377.07");
    expect(fmtPrice(2386.5012)).toBe("2,386.50");
    expect(fmtPrice(0.004213)).toBe("0.004213");
  });

  it("never prints NaN or Infinity at someone", () => {
    expect(fmtPrice(Number.NaN)).toBe("–");
    expect(fmtPrice(Number.POSITIVE_INFINITY)).toBe("–");
    expect(fmtUsd(Number.NaN)).toBe("–");
  });

  it("names the unit on money and signs a percentage", () => {
    expect(fmtUsd(5)).toBe("5.00 USDso");
    expect(fmtPct(0.0312)).toBe("+3.12%");
    expect(fmtPct(-0.0312)).toBe("-3.12%");
    expect(fmtPct(0)).toBe("0.00%");
  });
});
