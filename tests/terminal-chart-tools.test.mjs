import assert from "node:assert/strict";
import test from "node:test";
import {
  candleChangePercent,
  chartDrawing,
  exponentialMovingAverage,
  simpleMovingAverage,
} from "../terminal-source-src/chartTools.mjs";

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
