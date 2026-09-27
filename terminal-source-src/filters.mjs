import { ignoreKey, localDay } from "./scanner/SignalScanner.mjs";
// Kept at the display boundary as well as the live scanner boundary so old
// localStorage rows cannot bring retired funding, liquidation or system cards
// back after an upgrade.
export const ACTIVE_SIGNAL_TYPES = new Set(["price", "volume", "oi", "extreme"]);

export function activeSignals(signals) {
  return (Array.isArray(signals) ? signals : []).filter((signal) => ACTIVE_SIGNAL_TYPES.has(signal?.type));
}
export function signalStatus(s, ignored = {}, now = Date.now()) {
  return ignored[ignoreKey(s, localDay(now))]
    ? "ignored"
    : s.status || "unread";
}
export function filterSignals(
  signals,
  filters,
  watchlist,
  ignored,
  now = Date.now(),
) {
  return signals.filter((s) => {
    const status = signalStatus(s, ignored, now);
    return (
      ACTIVE_SIGNAL_TYPES.has(s.type) &&
      (filters.status ? status === filters.status : status !== "ignored") &&
      (!filters.market || filters.market === "all" || (s.market || "Crypto") === filters.market) &&
      (filters.timeframe === "all" || s.timeframe === filters.timeframe) &&
      (filters.type === "all" || s.type === filters.type) &&
      (!filters.watched || watchlist.some((w) => w.symbol === s.symbol))
    );
  });
}
