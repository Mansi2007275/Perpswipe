import { ImageResponse } from "next/og";

// Node runtime, not edge: ImageResponse runs on both, and the edge runtime would also
// turn off static generation for every page in this build.

// Share image for a trade: /api/card?base=ETH&side=long&pnl=12.40&pct=0.0312
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const base = (q.get("base") ?? "ETH").slice(0, 8);
  const side = q.get("side") === "short" ? "short" : "long";
  const pnl = Number(q.get("pnl") ?? 0);
  const pct = Number(q.get("pct") ?? 0);
  const up = pnl >= 0;
  const ink = "#1a2238", mist = "#d9dfea", stock = "#f7f8fb", amber = "#fbefd6";
  const green = "#0e7a55", red = "#b8324a";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: mist, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 980, height: 520, background: stock, border: `4px solid ${ink}`, borderRadius: 48, boxShadow: `0 14px 0 ${ink}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column", padding: "48px 56px 0", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, color: "#4a5571" }}>
              <span>{`${side === "long" ? "Long" : "Short"} ${base} on dreamDEX`}</span>
              <span>PerpSwipe</span>
            </div>
            <div style={{ fontSize: 170, fontWeight: 800, color: ink, letterSpacing: -6, lineHeight: 1, marginTop: 18 }}>{base}</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: up ? green : red, marginTop: 12 }}>
              {`${up ? "+" : ""}${pnl.toFixed(2)} USDso`}
              <span style={{ fontSize: 40, marginLeft: 24, alignSelf: "center" }}>{`${up ? "+" : ""}${(pct * 100).toFixed(2)}%`}</span>
            </div>
          </div>
          <div style={{ display: "flex", background: amber, borderTop: `4px dashed ${ink}`, padding: "26px 56px", fontSize: 30, color: ink }}>
            Saw my liquidation price before I swiped.
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
