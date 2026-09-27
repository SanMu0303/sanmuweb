export function PriceMoveSignal(b, c, timeframe) {
  if (timeframe !== "1H") return [];
  return [
    [1, c.price1h],
    [4, c.price4h],
    [24, c.price24h],
  ].flatMap(([n, t]) => {
    if (b.length <= n) return [];
    const pct = (b.at(-1).close / b.at(-n - 1).close - 1) * 100;
    return Math.abs(pct) > t
      ? [
          {
            type: "price",
            title: "大幅价格异动",
            value: `${n}H ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
            metadata: { hours: n, pct },
          },
        ]
      : [];
  });
}
