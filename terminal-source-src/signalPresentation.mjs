// Shared semantic colors for cards, chart markers and status accents.
export const SIGNAL_COLORS = Object.freeze({
  low: "#62676B",
  normal: "#E8E8E6",
  observe: "#91AD9B",
  high: "#6FE29A",
  system: "#78E6A3",
  anomaly: "#4ED8C8",
  risk: "#F2A65A",
  invalid: "#EF6A6A",
});
export function signalPriority(s) {
  return (
    s.priority ??
    (s.type === "system" ? "system" : s.type === "breakout" ? "high" : "normal")
  );
}
export function signalTone(s) {
  if (
    s.metadata?.systemType === "invalidated" ||
    s.metadata?.severity === "extreme"
  )
    return "invalid";
  if (
    s.type === "price" ||
    s.type === "liquidation" ||
    s.metadata?.direction === "low" ||
    s.metadata?.severity === "risk"
  )
    return "risk";
  if (s.type === "oi" || s.type === "funding") return "anomaly";
  return signalPriority(s);
}
export function signalColor(s) {
  return SIGNAL_COLORS[signalTone(s)] || SIGNAL_COLORS.normal;
}
