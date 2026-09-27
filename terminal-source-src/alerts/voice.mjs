import { SECONDS } from "../scanner/config.mjs";

// The alert toggle remains off until the user explicitly enables it.  This is
// only the level used once speech has been enabled, rather than an autoplay
// setting.
export const DEFAULT_VOICE_VOLUME = 0.7;

export function normalizeVoiceVolume(value, fallback = DEFAULT_VOICE_VOLUME) {
  const safeFallback = Number.isFinite(Number(fallback))
    ? Math.min(1, Math.max(0, Number(fallback)))
    : DEFAULT_VOICE_VOLUME;
  if (value === "" || value === null || value === undefined) return safeFallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : safeFallback;
}

export function speechOptions(volume) {
  return {
    lang: "zh-CN",
    rate: 1,
    volume: normalizeVoiceVolume(volume),
  };
}

// Chinese speech engines may treat an unseparated ticker as an English word.
// Split its letters (and numeric prefixes such as 1000PEPE) so the spoken
// ticker is unambiguous while leaving the surrounding Chinese sentence intact.
export function spellAssetSymbol(symbol) {
  const asset = String(symbol || "")
    .trim()
    .replace(/(?:USDT|USDC|BUSD|FDUSD)$/i, "");
  if (!asset) return "未知标的";
  return (asset.match(/[A-Za-z]+|\d+|[^A-Za-z\d]+/g) || [])
    .map((part) =>
      /^[A-Za-z]+$/.test(part)
        ? part.toUpperCase().split("").join(" ")
        : /^\d+$/.test(part)
          ? part.split("").join(" ")
          : part,
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function announcement(s, mode) {
  const types = {
    volume: "成交量异常",
    oi: "持仓量异常",
    price: "价格异动",
    extreme: s.metadata?.direction === "low" ? "价格创新低" : "价格创新高",
  };
  return `${mode === "DEMO" ? "模拟信号，" : ""}${spellAssetSymbol(s.symbol)}，${types[s.type] || "异常信号"}`;
}
export function newVoiceSignals(signals, seen, enabledAt, now = Date.now()) {
  const result = [];
  for (const s of signals) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const closedAt =
      s.detectedAt || (s.triggeredAt + (SECONDS[s.timeframe] || 0)) * 1000;
    if (
      enabledAt &&
      s.status !== "ignored" &&
      closedAt >= enabledAt &&
      closedAt <= now &&
      now - closedAt < 300000
    )
      result.push(s);
  }
  while (seen.size > 5000) seen.delete(seen.values().next().value);
  return result.sort((a, b) => b.triggeredAt - a.triggeredAt).slice(0, 5);
}
