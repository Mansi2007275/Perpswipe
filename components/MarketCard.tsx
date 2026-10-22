import type { DeckCard } from "@/lib/dex";
import { fmtPct, fmtPrice, fmtUsd, planTrade } from "@/lib/risk";
import { Sparkline } from "./Sparkline";

export function MarketCard({ card, marginUsd, leverage }: { card: DeckCard; marginUsd: number; leverage: number }) {
  const base = { price: card.price, marginUsd, leverage, mmBps: card.mmBps, minQty: card.minQty, qtyStep: card.qtyStep };
  const long = planTrade({ ...base, side: "long" });
  const short = planTrade({ ...base, side: "short" });
  const rising = card.changePct >= 0;
  const maxLoss = Math.max(long.maxLoss, short.maxLoss);

  return (
    <>
      <div className="card-body">
        <div className="card-head">
          <span className="card-pair">{card.base} perpetual, paid in USDso</span>
          <span className="card-pair">{leverage}x</span>
        </div>
        <div className="card-ticker">{card.base}</div>
        <div>
          <span className="card-price">{fmtPrice(card.price)}</span>
          <span className={`card-change ${rising ? "up" : "down"}`}>{fmtPct(card.changePct)} today</span>
        </div>
        <Sparkline values={card.closes} rising={rising} />
        <div className="card-facts">
          <span>
            Funding <strong>{(card.fundingRate * 100).toFixed(3)}%</strong> per 8h
          </span>
          <span>
            Trade size <strong>{long.qty} {card.base}</strong>
          </span>
        </div>
      </div>
      <div className="ticket">
        <div className="ticket-loss">
          <span>Most you can lose</span>
          <strong>{fmtUsd(maxLoss)}</strong>
        </div>
        <table className="ticket-table">
          <thead>
            <tr>
              <th scope="col">If you swipe</th>
              <th scope="col">Stop-loss</th>
              <th scope="col">Liquidation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="up">Right, long</th>
              <td>{fmtPrice(long.stopPrice)}</td>
              <td>{fmtPrice(long.liquidationPrice)}</td>
            </tr>
            <tr>
              <th scope="row" className="down">Left, short</th>
              <td>{fmtPrice(short.stopPrice)}</td>
              <td>{fmtPrice(short.liquidationPrice)}</td>
            </tr>
          </tbody>
        </table>
        {long.bumpedToMinimum && (
          <div className="ticket-lines" style={{ marginTop: 6 }}>
            <span>Raised to this market&apos;s minimum size, so it uses {fmtUsd(long.margin)} of your money.</span>
          </div>
        )}
      </div>
    </>
  );
}
