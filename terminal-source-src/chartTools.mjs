export const DEFAULT_INDICATOR_PERIOD = 20;
export const DEFAULT_BOLLINGER_MULTIPLIER = 2;

function validBars(bars) {
  return Array.isArray(bars)
    ? bars.filter(
        (bar) =>
          Number.isFinite(Number(bar?.time)) &&
          Number.isFinite(Number(bar?.close)),
      )
    : [];
}

export function normalizeIndicatorPeriod(value, fallback = DEFAULT_INDICATOR_PERIOD) {
  const period = Math.floor(Number(value));
  return Number.isFinite(period) && period >= 2 && period <= 500
    ? period
    : fallback;
}

export function simpleMovingAverage(bars, period = DEFAULT_INDICATOR_PERIOD) {
  const points = [];
  const data = validBars(bars);
  const size = normalizeIndicatorPeriod(period);
  if (data.length < size) return points;

  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    sum += Number(data[index].close);
    if (index >= size) sum -= Number(data[index - size].close);
    if (index >= size - 1)
      points.push({ time: Number(data[index].time), value: sum / size });
  }
  return points;
}

export function exponentialMovingAverage(bars, period = DEFAULT_INDICATOR_PERIOD) {
  const points = [];
  const data = validBars(bars);
  const size = normalizeIndicatorPeriod(period);
  if (data.length < size) return points;

  const seed = data
    .slice(0, size)
    .reduce((sum, bar) => sum + Number(bar.close), 0) / size;
  const multiplier = 2 / (size + 1);
  let previous = seed;
  points.push({ time: Number(data[size - 1].time), value: previous });

  for (let index = size; index < data.length; index += 1) {
    previous = (Number(data[index].close) - previous) * multiplier + previous;
    points.push({ time: Number(data[index].time), value: previous });
  }
  return points;
}

export function normalizeBollingerMultiplier(
  value,
  fallback = DEFAULT_BOLLINGER_MULTIPLIER,
) {
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier >= 0.1 && multiplier <= 10
    ? multiplier
    : fallback;
}

/**
 * Bollinger bands calculated from the same close-price series as MA/EMA. The
 * variance is clamped for floating point safety so a flat market does not
 * produce a negative square root.
 */
export function bollingerBands(
  bars,
  period = DEFAULT_INDICATOR_PERIOD,
  multiplier = DEFAULT_BOLLINGER_MULTIPLIER,
) {
  const data = validBars(bars);
  const size = normalizeIndicatorPeriod(period);
  const factor = normalizeBollingerMultiplier(multiplier);
  const middle = [],
    upper = [],
    lower = [];
  if (data.length < size) return { middle, upper, lower };

  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < data.length; index += 1) {
    const close = Number(data[index].close);
    sum += close;
    sumSquares += close * close;
    if (index >= size) {
      const expired = Number(data[index - size].close);
      sum -= expired;
      sumSquares -= expired * expired;
    }
    if (index < size - 1) continue;
    const mean = sum / size;
    const variance = Math.max(0, sumSquares / size - mean * mean);
    const deviation = Math.sqrt(variance) * factor;
    const time = Number(data[index].time);
    middle.push({ time, value: mean });
    upper.push({ time, value: mean + deviation });
    lower.push({ time, value: mean - deviation });
  }
  return { middle, upper, lower };
}

/** Wilder RSI. A perfectly flat lookback is neutral rather than overbought. */
export function relativeStrengthIndex(bars, period = 14) {
  const data = validBars(bars);
  const size = normalizeIndicatorPeriod(period, 14);
  if (data.length <= size) return [];

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= size; index += 1) {
    const change = Number(data[index].close) - Number(data[index - 1].close);
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / size;
  let averageLoss = losses / size;
  const value = () => {
    if (averageLoss === 0 && averageGain === 0) return 50;
    if (averageLoss === 0) return 100;
    if (averageGain === 0) return 0;
    const relativeStrength = averageGain / averageLoss;
    return 100 - 100 / (1 + relativeStrength);
  };
  const points = [{ time: Number(data[size].time), value: value() }];
  for (let index = size + 1; index < data.length; index += 1) {
    const change = Number(data[index].close) - Number(data[index - 1].close);
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (size - 1) + gain) / size;
    averageLoss = (averageLoss * (size - 1) + loss) / size;
    points.push({ time: Number(data[index].time), value: value() });
  }
  return points;
}

/**
 * Session VWAP resets at each UTC trading day. Binance timestamps are UTC, so
 * this keeps the value predictable across clients and browser time zones.
 */
export function volumeWeightedAveragePrice(bars) {
  const data = validBars(bars);
  const points = [];
  let session = null;
  let totalVolume = 0;
  let totalPriceVolume = 0;
  for (const bar of data) {
    const time = Number(bar.time);
    const day = Math.floor(time / 86400);
    if (day !== session) {
      session = day;
      totalVolume = 0;
      totalPriceVolume = 0;
    }
    const high = Number.isFinite(Number(bar.high)) ? Number(bar.high) : Number(bar.close);
    const low = Number.isFinite(Number(bar.low)) ? Number(bar.low) : Number(bar.close);
    const close = Number(bar.close);
    const volume = Math.max(0, Number(bar.volume) || 0);
    const typicalPrice = (high + low + close) / 3;
    totalVolume += volume;
    totalPriceVolume += typicalPrice * volume;
    if (totalVolume > 0)
      points.push({ time, value: totalPriceVolume / totalVolume });
  }
  return points;
}

export function candleChangePercent(bar) {
  const open = Number(bar?.open);
  const close = Number(bar?.close);
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) return null;
  return ((close - open) / open) * 100;
}

export function chartDrawing({ type, start, end }) {
  if (!['trend', 'horizontal'].includes(type)) return null;
  const normalizePoint = (point) => {
    const time = Number(point?.time);
    const price = Number(point?.price);
    return Number.isFinite(time) && Number.isFinite(price) ? { time, price } : null;
  };
  const from = normalizePoint(start);
  const to = normalizePoint(end || start);
  if (!from || !to) return null;
  return {
    id: `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    start: from,
    end: type === 'horizontal' ? { ...from } : to,
  };
}
