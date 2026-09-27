export function NewHighSignal(bars) {
  const last = bars.at(-1),
    out = [];
  // Prefer the longer window when both match, so one completed candle does
  // not create duplicate 60/120-period alerts.
  for (const n of [120, 60]) {
    if (bars.length <= n) continue;
    const prev = bars.slice(-n - 1, -1),
      high = Math.max(...prev.map((b) => b.high)),
      low = Math.min(...prev.map((b) => b.low));
    if (last.close > high) {
      out.push({
        type: "extreme",
        title: `${n}周期新高`,
        value: `收盘 ${last.close.toPrecision(6)}`,
        metadata: { period: n, direction: "high", level: high },
      });
      break;
    }
    if (last.close < low) {
      out.push({
        type: "extreme",
        title: `${n}周期新低`,
        value: `收盘 ${last.close.toPrecision(6)}`,
        metadata: { period: n, direction: "low", level: low },
      });
      break;
    }
  }
  return out;
}
