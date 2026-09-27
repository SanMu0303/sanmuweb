export function RangeBreakoutSignal(b, c) {
  if (b.length <= c.lookback) return [];
  const prev = b.slice(-c.lookback - 1, -1),
    highestHigh = Math.max(...prev.map((x) => x.high)),
    lowestLow = Math.min(...prev.map((x) => x.low)),
    rangePct = ((highestHigh - lowestLow) / lowestLow) * 100;
  const atr =
    prev
      .slice(-14)
      .reduce(
        (s, x, i, a) =>
          s +
          Math.max(
            x.high - x.low,
            Math.abs(x.high - (a[i - 1]?.close ?? x.open)),
            Math.abs(x.low - (a[i - 1]?.close ?? x.open)),
          ),
        0,
      ) / 14;
  const drift =
    Math.abs(prev.at(-1).close - prev[0].close) /
    (highestHigh - lowestLow || 1);
  return rangePct <= c.maxRangePct &&
    drift <= 0.65 &&
    b.at(-1).close > highestHigh
    ? [
        {
          type: "breakout",
          title: "横盘突破",
          value: `${c.lookback}K · 区间 ${rangePct.toFixed(1)}%`,
          metadata: {
            length: c.lookback,
            highestHigh,
            lowestLow,
            rangePct,
            atr,
            drift,
          },
        },
      ]
    : [];
}
