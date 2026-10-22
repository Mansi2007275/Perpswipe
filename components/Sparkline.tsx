export function Sparkline({ values, rising }: { values: number[]; rising: boolean }) {
  if (values.length < 2) return <svg className="spark" aria-hidden />;
  const w = 400, h = 112, pad = 6;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, pad + (1 - (v - lo) / span) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const area = `${line}L${w} ${h}L0 ${h}Z`;
  const color = rising ? "var(--long)" : "var(--short)";
  const last = pts.at(-1)!;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Price over the last 12 hours">
      <path d={area} fill={color} fillOpacity="0.08" />
      <path d={line} fill="none" stroke="var(--ink)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="5" fill={color} stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
