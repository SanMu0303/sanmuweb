import assert from "node:assert/strict";
import test from "node:test";
import {
  bollingerBands,
  candleChangePercent,
  chartDrawing,
  exponentialMovingAverage,
  relativeStrengthIndex,
  simpleMovingAverage,
  volumeWeightedAveragePrice,
} from "../terminal-source-src/chartTools.mjs";
import {
  createChartIndicator,
  DEFAULT_CHART_INDICATORS,
  decodeChartIndicators,
  MAX_CHART_INDICATORS,
  encodeChartIndicators,
  normalizeChartIndicators,
} from "../terminal-source-src/chartIndicators.mjs";

const bars = [
  { time: 1, open: 1, close: 1 },
  { time: 2, open: 1, close: 2 },
  { time: 3, open: 2, close: 4 },
  { time: 4, open: 4, close: 8 },
];

test("simple moving average starts after its complete lookback window", () => {
  assert.deepEqual(simpleMovingAverage(bars, 2), [
    { time: 2, value: 1.5 },
    { time: 3, value: 3 },
    { time: 4, value: 6 },
  ]);
  assert.deepEqual(simpleMovingAverage(bars, 6), []);
});

test("exponential moving average seeds with the first simple moving average", () => {
  const points = exponentialMovingAverage(bars, 2);
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { time: 2, value: 1.5 });
  assert.equal(points[1].time, 3);
  assert.equal(points[1].value, 19 / 6);
  assert.equal(points[2].time, 4);
  assert.equal(points[2].value, 115 / 18);
});

test("drawing coordinates are bounded to chart-friendly point data", () => {
  const horizontal = chartDrawing({
    type: "horizontal",
    start: { time: 123, price: 45.6 },
  });
  assert.equal(horizontal.type, "horizontal");
  assert.deepEqual(horizontal.start, { time: 123, price: 45.6 });
  assert.deepEqual(horizontal.end, { time: 123, price: 45.6 });
  assert.equal(chartDrawing({ type: "trend", start: { time: "no", price: 1 } }), null);
});

test("candle change percentage is based on the hovered candle open and close", () => {
  assert.equal(candleChangePercent({ open: 100, close: 112.5 }), 12.5);
  assert.equal(candleChangePercent({ open: 0, close: 12 }), null);
});


test("Bollinger bands keep three aligned lines with a configurable multiplier", () => {
  const bands = bollingerBands(bars, 2, 2);
  assert.deepEqual(bands.middle, [
    { time: 2, value: 1.5 },
    { time: 3, value: 3 },
    { time: 4, value: 6 },
  ]);
  assert.deepEqual(bands.upper, [
    { time: 2, value: 2.5 },
    { time: 3, value: 5 },
    { time: 4, value: 10 },
  ]);
  assert.deepEqual(bands.lower, [
    { time: 2, value: 0.5 },
    { time: 3, value: 1 },
    { time: 4, value: 2 },
  ]);
});

test("RSI uses Wilder smoothing and treats a flat window as neutral", () => {
  const points = relativeStrengthIndex(
    [
      { time: 1, close: 1 },
      { time: 2, close: 2 },
      { time: 3, close: 1 },
      { time: 4, close: 3 },
    ],
    2,
  );
  assert.deepEqual(points[0], { time: 3, value: 50 });
  assert.equal(points[1].time, 4);
  assert.ok(Math.abs(points[1].value - 83.33333333333333) < 1e-10);
  assert.deepEqual(
    relativeStrengthIndex(
      [
        { time: 1, close: 5 },
        { time: 2, close: 5 },
        { time: 3, close: 5 },
      ],
      2,
    ),
    [{ time: 3, value: 50 }],
  );
});

test("VWAP resets on the next UTC session", () => {
  const points = volumeWeightedAveragePrice([
    { time: 1, high: 2, low: 0, close: 1, volume: 2 },
    { time: 2, high: 4, low: 2, close: 3, volume: 1 },
    { time: 86400, high: 12, low: 6, close: 9, volume: 4 },
  ]);
  assert.deepEqual(points[0], { time: 1, value: 1 });
  assert.equal(points[1].value, 5 / 3);
  assert.deepEqual(points[2], { time: 86400, value: 9 });
});

test("indicator preferences retain multiple moving averages and safe periods", () => {
  const defaults = decodeChartIndicators(null);
  const withFirstAverage = createChartIndicator("sma", defaults);
  const firstAverage = withFirstAverage.find((item) => item.type === "sma");
  assert.equal(withFirstAverage.filter((item) => item.type === "sma").length, 1);
  assert.equal(firstAverage.period, 20);
  assert.equal(firstAverage.enabled, true);

  const withSecondAverage = createChartIndicator("sma", withFirstAverage);
  assert.equal(withSecondAverage.filter((item) => item.type === "sma").length, 2);
  assert.equal(withSecondAverage.at(-1).period, 50);
  assert.equal(withSecondAverage.at(-1).enabled, true);
  const normalized = normalizeChartIndicators([
    { id: "fast", type: "sma", period: 5, enabled: true },
    { id: "slow", type: "sma", period: 200, enabled: true },
    { id: "bad", type: "ema", period: 501, enabled: true },
  ]);
  assert.deepEqual(
    normalized.map((item) => item.period),
    [5, 200, 20],
  );
  assert.deepEqual(
    decodeChartIndicators(encodeChartIndicators(normalized)).map((item) => item.id),
    ["fast", "slow", "bad"],
  );
  const rsi = normalizeChartIndicators([
    { id: "rsi", type: "rsi", period: 14, overbought: 101, oversold: -1 },
  ])[0];
  assert.equal(rsi.overbought, 100);
  assert.equal(rsi.oversold, 0);
  const withVwap = createChartIndicator("vwap", defaults);
  assert.equal(withVwap.filter((item) => item.type === "vwap").length, 1);
  assert.equal(withVwap.find((item) => item.type === "vwap").enabled, true);

  const fullSet = Array.from({ length: MAX_CHART_INDICATORS }, (_, index) => ({
    id: `sma-full-${index}`,
    type: "sma",
    period: index + 2,
    enabled: true,
  }));
  const hiddenPreset = DEFAULT_CHART_INDICATORS.find(
    (indicator) => indicator.id === "ema-20",
  );
  const atLimit = createChartIndicator("ema", [...fullSet, hiddenPreset]);
  assert.equal(atLimit.filter((item) => item.enabled).length, MAX_CHART_INDICATORS);
  assert.equal(atLimit.find((item) => item.id === "ema-20").enabled, false);
});
