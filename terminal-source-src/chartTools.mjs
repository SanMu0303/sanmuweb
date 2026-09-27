export const DEFAULT_INDICATOR_PERIOD = 20;

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
