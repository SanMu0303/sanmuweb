export function decodeKline(event, symbol, interval) {
  const e = event.data || event,
    k = e.k;
  if (e.e !== "kline" || e.s !== symbol || !k || k.i !== interval) return null;
  const b = {
    time: Number(k.t) / 1000,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    eventTime: Number(e.E),
    closed: !!k.x,
  };
  if (
    !Object.values(b)
      .filter((v) => typeof v === "number")
      .every(Number.isFinite) ||
    b.volume < 0 ||
    b.low > b.high ||
    b.open < b.low ||
    b.open > b.high ||
    b.close < b.low ||
    b.close > b.high
  )
    return null;
  return b;
}
export function mergeKlines(history, updates, limit = 200) {
  const map = new Map(history.map((b) => [b.time, b]));
  for (const b of updates) {
    const old = map.get(b.time);
    if (!old?.eventTime || b.eventTime >= old.eventTime) map.set(b.time, b);
  }
  return [...map.values()].sort((a, b) => a.time - b.time).slice(-limit);
}
