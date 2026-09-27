export function OISpikeSignal(points, c) {
  if (!points?.length) return [];
  const last = points.at(-1);
  return [
    [1, c.oi1h],
    [4, c.oi4h],
  ].flatMap(([h, t]) => {
    const prev = points.findLast((p) => p.time <= last.time - h * 3600);
    if (!prev || last.time - prev.time > h * 3600 + 300 || prev.value <= 0)
      return [];
    // Floating-point arithmetic can represent an exact 15% growth as
    // 14.999999999…; thresholds are inclusive by product rule.
    const pct = Number((((last.value / prev.value) - 1) * 100).toFixed(8));
    return pct >= t
      ? [
          {
            type: "oi",
          title: "OI 持仓增长",
            value: `OI ${h}H +${pct.toFixed(1)}%`,
            metadata: {
              hours: h,
              pct,
              oiTime: last.time,
              venue: "Binance USD-M Futures",
            },
          },
        ]
      : [];
  });
}
