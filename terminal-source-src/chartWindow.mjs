export function chartWindow(bars, triggerTime, limit = 200) {
  if (!triggerTime) return bars.slice(-limit);
  const i = bars.findIndex((b) => b.time === triggerTime);
  if (i < 0) return bars.slice(-limit);
  const end = Math.min(bars.length, Math.max(limit, i + 41));
  return bars.slice(Math.max(0, end - limit), end);
}
export function triggerRange(index) {
  return { from: index - 120, to: index + 40 };
}
