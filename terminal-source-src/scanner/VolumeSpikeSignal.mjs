export function VolumeSpikeSignal(b, c) {
  if (b.length < 21) return [];
  const avg = b.slice(-21, -1).reduce((s, x) => s + x.volume, 0) / 20,
    ratio = b.at(-1).volume / avg;
  return avg > 0 && ratio >= c.volume
    ? [
        {
          type: "volume",
          title: "成交量放大",
          value: `近20根均量的 ${ratio.toFixed(1)}x`,
          metadata: { ratio, average: avg },
        },
      ]
    : [];
}
