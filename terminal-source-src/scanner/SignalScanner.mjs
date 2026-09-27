import { signalPriority } from "../signalPresentation.mjs";
import { NewHighSignal } from "./NewHighSignal.mjs";
import { VolumeSpikeSignal } from "./VolumeSpikeSignal.mjs";
import { PriceMoveSignal } from "./PriceMoveSignal.mjs";
import { OISpikeSignal } from "./OISpikeSignal.mjs";
import { SECONDS, validateConfig } from "./config.mjs";
export class SignalScanner {
  constructor(config) {
    this.config = validateConfig(config);
  }
  scan({
    symbol,
    timeframe,
    bars,
    oi = [],
    intrabar = false,
    source = "binance",
    now = Date.now() / 1000,
  }) {
    const b = intrabar
      ? bars
      : bars.filter((x) => x.time + SECONDS[timeframe] <= now);
    if (!b.length) return [];
    const last = b.at(-1);
    const results = [
      ...(intrabar || !["1H", "4H", "1D"].includes(timeframe) ? [] : NewHighSignal(b)),
      ...VolumeSpikeSignal(b, this.config),
      ...PriceMoveSignal(b, this.config, timeframe),
      ...(timeframe === "1H" && (!oi.length || now - oi.at(-1).time < 7200)
        ? OISpikeSignal(oi, this.config)
        : []),
    ];
    return results.map((r) => ({
      ...r,
      metadata: {
        ...r.metadata,
        confirmation: intrabar ? "intrabar" : "closed",
      },
      priority: signalPriority(r),
      id: [
        source,
        symbol,
        timeframe,
        r.type,
        last.time,
        r.metadata.hours ?? r.metadata.period ?? "",
      ].join(":"),
      symbol,
      market: "Crypto",
      timeframe,
      description: r.title + " · " + r.value,
      triggeredAt: last.time,
      triggerPrice: last.close,
      source,
    }));
  }
}
export function localDay(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function ignoreKey(s, day = localDay()) {
  return `${day}:${s.symbol}:${s.type}`;
}
export function acceptSignals(
  incoming,
  existing,
  ignored,
  config,
  now = Date.now(),
) {
  const out = existing.map((s) => ({
    ...s,
    priority: signalPriority(s),
    triggerCount: s.triggerCount || 1,
    firstTriggeredAt: s.firstTriggeredAt ?? s.triggeredAt,
    eventIds: s.eventIds || [s.id],
    triggerTimes: s.triggerTimes || [s.triggeredAt],
  }));
  const seen = new Set(out.flatMap((s) => s.eventIds));
  for (const s of [...incoming].sort((a, b) => a.triggeredAt - b.triggeredAt)) {
    if (seen.has(s.id) || ignored[ignoreKey(s, localDay(now))]) continue;
    const matches = out.filter(
      (x) =>
        x.symbol === s.symbol &&
        x.timeframe === s.timeframe &&
        x.type === s.type &&
        Math.abs(s.triggeredAt - x.firstTriggeredAt) < config.cooldown * 60,
    );
    const group = matches.sort((a, b) => b.triggeredAt - a.triggeredAt)[0];
    if (group) {
      const eventIds = [...group.eventIds, s.id],
        triggerTimes = [...new Set([...group.triggerTimes, s.triggeredAt])];
      const newer = s.triggeredAt >= group.triggeredAt;
      Object.assign(
        group,
        newer
          ? {
              ...s,
              id: group.id,
              status: group.status,
              priority: signalPriority(s),
            }
          : {},
        {
          eventIds,
          triggerTimes,
          triggerCount: triggerTimes.length,
          firstTriggeredAt: Math.min(group.firstTriggeredAt, s.triggeredAt),
        },
      );
    } else
      out.push({
        ...s,
        priority: signalPriority(s),
        status: "unread",
        eventIds: [s.id],
        triggerTimes: [s.triggeredAt],
        triggerCount: 1,
        firstTriggeredAt: s.triggeredAt,
      });
    seen.add(s.id);
  }
  return out
    .sort(
      (a, b) =>
        (b.detectedAt || b.triggeredAt * 1000) -
        (a.detectedAt || a.triggeredAt * 1000),
    )
    .slice(0, 1500);
}
