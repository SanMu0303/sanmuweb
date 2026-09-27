import {
  DEFAULT_BOLLINGER_MULTIPLIER,
  DEFAULT_INDICATOR_PERIOD,
  normalizeBollingerMultiplier,
  normalizeIndicatorPeriod,
} from "./chartTools.mjs";

export const CHART_INDICATOR_SCHEMA_VERSION = 1;
export const MAX_CHART_INDICATORS = 8;

export const INDICATOR_TYPES = Object.freeze({
  sma: { label: "MA", defaultPeriod: 20, pane: "main" },
  ema: { label: "EMA", defaultPeriod: 20, pane: "main" },
  bollinger: { label: "BOLL", defaultPeriod: 20, pane: "main" },
  rsi: {
    label: "RSI",
    defaultPeriod: 14,
    defaultOverbought: 70,
    defaultOversold: 30,
    pane: "rsi",
  },
  vwap: { label: "VWAP", pane: "main" },
});

const COLORS = Object.freeze([
  "#F2A65A",
  "#7C9EFF",
  "#D98BC5",
  "#4ED8C8",
  "#D2C96A",
  "#B695F5",
  "#E4876E",
  "#75B7D5",
]);

const SUGGESTED_PERIODS = Object.freeze({
  sma: [20, 50, 100, 200],
  ema: [20, 50, 100, 200],
  bollinger: [20, 50],
  rsi: [14, 21],
});

export const DEFAULT_CHART_INDICATORS = Object.freeze([
  { id: "sma-20", type: "sma", period: 20, enabled: false, color: COLORS[0] },
  { id: "ema-20", type: "ema", period: 20, enabled: false, color: COLORS[1] },
  {
    id: "bollinger-20",
    type: "bollinger",
    period: 20,
    multiplier: DEFAULT_BOLLINGER_MULTIPLIER,
    enabled: false,
    color: COLORS[2],
  },
  {
    id: "rsi-14",
    type: "rsi",
    period: 14,
    overbought: 70,
    oversold: 30,
    enabled: false,
    color: COLORS[3],
  },
  { id: "vwap", type: "vwap", enabled: false, color: COLORS[4] },
]);

function safeType(value) {
  return Object.hasOwn(INDICATOR_TYPES, value) ? value : "sma";
}

function safeId(value, fallback) {
  const id = String(value || "").trim();
  return /^[a-z0-9-]{1,64}$/i.test(id) ? id : fallback;
}

function colorFor(index, preferred) {
  return /^#[\da-f]{6}$/i.test(String(preferred || ""))
    ? preferred
    : COLORS[index % COLORS.length];
}

function normalizeRsiLevel(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric * 100) / 100));
}

function normalizedIndicator(raw, index, usedIds) {
  const type = safeType(raw?.type);
  const base = `${type}-${index + 1}`;
  let id = safeId(raw?.id, base);
  let collision = 2;
  while (usedIds.has(id)) id = `${base}-${collision++}`;
  usedIds.add(id);
  const defaultPeriod = INDICATOR_TYPES[type].defaultPeriod;
  const indicator = {
    id,
    type,
    enabled: Boolean(raw?.enabled),
    color: colorFor(index, raw?.color),
  };
  if (defaultPeriod)
    indicator.period = normalizeIndicatorPeriod(raw?.period, defaultPeriod);
  if (type === "bollinger")
    indicator.multiplier = normalizeBollingerMultiplier(raw?.multiplier);
  if (type === "rsi") {
    const definition = INDICATOR_TYPES.rsi;
    indicator.overbought = normalizeRsiLevel(
      raw?.overbought,
      definition.defaultOverbought,
      50,
      100,
    );
    indicator.oversold = normalizeRsiLevel(
      raw?.oversold,
      definition.defaultOversold,
      0,
      50,
    );
  }
  return indicator;
}

export function normalizeChartIndicators(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.indicators)
      ? value.indicators
      : DEFAULT_CHART_INDICATORS;
  const usedIds = new Set();
  return source
    .slice(0, MAX_CHART_INDICATORS)
    .map((indicator, index) => normalizedIndicator(indicator, index, usedIds));
}

export function decodeChartIndicators(stored) {
  return normalizeChartIndicators(stored);
}

export function encodeChartIndicators(indicators) {
  return {
    schemaVersion: CHART_INDICATOR_SCHEMA_VERSION,
    indicators: normalizeChartIndicators(indicators),
  };
}

export function createChartIndicator(type, indicators = []) {
  const safe = safeType(type);
  const current = normalizeChartIndicators(indicators);
  if (safe === "vwap") {
    const existing = current.find((indicator) => indicator.type === "vwap");
    if (existing) {
      return current.map((indicator) =>
        indicator.id === existing.id ? { ...indicator, enabled: true } : indicator,
      );
    }
  }
  const sequence = current.filter((indicator) => indicator.type === safe).length + 1;
  const definition = INDICATOR_TYPES[safe];
  const usedIds = new Set(current.map((indicator) => indicator.id));
  const usedPeriods = new Set(
    current
      .filter((indicator) => indicator.type === safe && indicator.period)
      .map((indicator) => indicator.period),
  );
  const suggested = SUGGESTED_PERIODS[safe] || [];
  const nextPeriod =
    suggested.find((period) => !usedPeriods.has(period)) ||
    definition.defaultPeriod ||
    undefined;
  const next = normalizedIndicator(
    {
      id: `${safe}-${Date.now().toString(36)}-${sequence}`,
      type: safe,
      enabled: true,
      period: nextPeriod,
      multiplier:
        safe === "bollinger" ? DEFAULT_BOLLINGER_MULTIPLIER : undefined,
      overbought:
        safe === "rsi" ? INDICATOR_TYPES.rsi.defaultOverbought : undefined,
      oversold: safe === "rsi" ? INDICATOR_TYPES.rsi.defaultOversold : undefined,
      color: COLORS[current.length % COLORS.length],
    },
    current.length,
    usedIds,
  );
  return [...current, next].slice(0, MAX_CHART_INDICATORS);
}

export function chartIndicatorLabel(indicator) {
  const item = indicator || {};
  const label = INDICATOR_TYPES[safeType(item.type)].label;
  if (item.type === "bollinger")
    return `${label}${item.period || 20}×${item.multiplier || DEFAULT_BOLLINGER_MULTIPLIER}`;
  if (item.type === "vwap") return label;
  return `${label}${item.period || INDICATOR_TYPES[safeType(item.type)].defaultPeriod}`;
}

export function isMainIndicator(indicator) {
  return INDICATOR_TYPES[safeType(indicator?.type)].pane === "main";
}
