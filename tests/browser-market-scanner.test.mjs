import test from "node:test";
import assert from "node:assert/strict";
import {BrowserMarketScanner, marketStreamRows} from "../terminal-source-src/providers/market-scanner.mjs";

// These are the user-visible default thresholds. They deliberately live in
// the browser-scanner tests because live signals are evaluated client-side.
const config = {
  minQuoteVolumeM: 5,
  maxVolumeRank: 0,
  volume: 10,
  oi1h: 15,
  oi4h: 25,
  cooldown: 45,
};

const scanner = (overrides = {}) => new BrowserMarketScanner({
  config: {...config, ...overrides},
  loadUniverse: async () => [{symbol: "BTCUSDT"}],
  loadTickers: async () => [{symbol: "BTCUSDT", lastPrice: "100", quoteVolume: "9000000", priceChangePercent: "1"}],
  loadOpenInterest: async () => ({openInterest: "100", time: 0}),
});

function makeBars(timeframe, count, {start = 0, volume = 10, high = 102, low = 98, close = 100} = {}) {
  const seconds = {"15m": 900, "1H": 3_600, "4H": 14_400, "1D": 86_400}[timeframe];
  return Array.from({length: count}, (_, index) => ({
    time: start + index * seconds,
    open: 100,
    high,
    low,
    close,
    volume,
    eventTime: (start + index * seconds) * 1_000,
    closed: true,
  }));
}

function allow(subject) {
  subject.symbols.add("BTCUSDT");
  subject.seedTicker({symbol: "BTCUSDT", lastPrice: "100", quoteVolume: "9000000", priceChangePercent: "1"});
  subject.refreshRanks();
  return subject;
}

test("keeps the ticker stream classification used by the all-market scanner", () => {
  assert.deepEqual(
    marketStreamRows(JSON.stringify({stream: "!ticker@arr", data: [{e: "24hrTicker", s: "BTCUSDT"}]})),
    {kind: "ticker", rows: [{e: "24hrTicker", s: "BTCUSDT"}]},
  );
});

test("volume alert uses exactly the previous 20 K-lines and triggers at 10x", () => {
  const subject = allow(scanner());
  const bars = makeBars("15m", 20);
  subject.seedKlines("BTCUSDT", "15m", bars);

  const current = {
    ...bars.at(-1),
    time: 20 * 900,
    high: 103,
    close: 101,
    volume: 100,
    eventTime: 20 * 900_000,
    closed: false,
  };
  const [signal] = subject.ingestKline("BTCUSDT", "15m", current, current.eventTime);

  assert.equal(signal.type, "volume");
  assert.equal(signal.symbol, "BTCUSDT");
  assert.equal(signal.timeframe, "15m");
  assert.equal(signal.metadata.period, 20);
  assert.equal(signal.metadata.average, 10);
  assert.equal(signal.metadata.ratio, 10);
  assert.equal(signal.metadata.confirmation, "intrabar");
});

test("volume signals do not include the trigger K-line in its average and do not repeat for updates to that K-line", () => {
  const subject = allow(scanner());
  const bars = makeBars("1H", 20);
  subject.seedKlines("BTCUSDT", "1H", bars);
  const at = 20 * 3_600;

  // 99.99 / 10 is below the configured 10x threshold. It would be much
  // lower if the trigger candle were accidentally included in the average.
  assert.deepEqual(subject.ingestKline("BTCUSDT", "1H", {
    ...bars.at(-1), time: at, volume: 99.99, eventTime: at * 1_000, closed: false,
  }, at * 1_000), []);

  const first = subject.ingestKline("BTCUSDT", "1H", {
    ...bars.at(-1), time: at, volume: 100, eventTime: at * 1_000 + 1, closed: false,
  }, at * 1_000 + 1);
  assert.equal(first.filter(item => item.type === "volume").length, 1);

  const updated = subject.ingestKline("BTCUSDT", "1H", {
    ...bars.at(-1), time: at, volume: 120, eventTime: at * 1_000 + 2, closed: false,
  }, at * 1_000 + 2);
  assert.equal(updated.filter(item => item.type === "volume").length, 0);
});

test("OI growth alerts use configurable inclusive 1H and 4H thresholds, never a decline", () => {
  const oneHour = allow(scanner());
  oneHour.seedOpenInterest("BTCUSDT", [{time: 0, value: 100}]);
  const [oneHourSignal] = oneHour.ingestOpenInterest("BTCUSDT", {time: 3_600, value: 115}, 3_600_000);
  assert.equal(oneHourSignal.type, "oi");
  assert.equal(oneHourSignal.metadata.hours, 1);
  assert.equal(oneHourSignal.metadata.pct, 15);
  assert.equal(oneHourSignal.metadata.confirmation, "sample");

  const fourHour = allow(scanner());
  fourHour.seedOpenInterest("BTCUSDT", [{time: 0, value: 100}]);
  const [fourHourSignal] = fourHour.ingestOpenInterest("BTCUSDT", {time: 14_400, value: 125}, 14_400_000);
  assert.equal(fourHourSignal.type, "oi");
  assert.equal(fourHourSignal.metadata.hours, 4);
  assert.equal(fourHourSignal.metadata.pct, 25);

  const custom = allow(scanner({oi1h: 12}));
  custom.seedOpenInterest("BTCUSDT", [{time: 0, value: 100}]);
  assert.equal(custom.ingestOpenInterest("BTCUSDT", {time: 3_600, value: 112}, 3_600_000)[0].metadata.hours, 1);

  const decline = allow(scanner());
  decline.seedOpenInterest("BTCUSDT", [{time: 0, value: 100}]);
  assert.deepEqual(decline.ingestOpenInterest("BTCUSDT", {time: 3_600, value: 80}, 3_600_000), []);
});

test("new highs and lows need closed 1H-or-higher K-lines, choose the longest matching 60/120 window", () => {
  const subject = allow(scanner());
  const bars = makeBars("1H", 120);
  subject.seedKlines("BTCUSDT", "1H", bars);
  const current = {
    ...bars.at(-1),
    time: 120 * 3_600,
    high: 104,
    close: 103,
    volume: 10,
    eventTime: 120 * 3_600_000,
  };

  assert.deepEqual(subject.ingestKline("BTCUSDT", "1H", {...current, closed: false}, current.eventTime), []);
  const [high] = subject.ingestKline("BTCUSDT", "1H", {...current, closed: true, eventTime: current.eventTime + 1}, current.eventTime + 1);
  assert.equal(high.type, "extreme");
  assert.equal(high.metadata.direction, "high");
  assert.equal(high.metadata.period, 120);
  assert.equal(high.metadata.level, 102);
  assert.equal(high.metadata.confirmation, "closed");

  const lowSubject = allow(scanner());
  const fourHourBars = makeBars("4H", 60);
  lowSubject.seedKlines("BTCUSDT", "4H", fourHourBars);
  const [low] = lowSubject.ingestKline("BTCUSDT", "4H", {
    ...fourHourBars.at(-1),
    time: 60 * 14_400,
    low: 96,
    close: 97,
    volume: 10,
    eventTime: 60 * 14_400_000,
    closed: true,
  }, 60 * 14_400_000);
  assert.equal(low.type, "extreme");
  assert.equal(low.metadata.direction, "low");
  assert.equal(low.metadata.period, 60);
});

test("15m K-lines and equal closes never produce a new-high/new-low alert", () => {
  const short = allow(scanner());
  const shortBars = makeBars("15m", 120);
  short.seedKlines("BTCUSDT", "15m", shortBars);
  const shortSignals = short.ingestKline("BTCUSDT", "15m", {
    ...shortBars.at(-1), time: 120 * 900, high: 104, close: 103, volume: 10, eventTime: 120 * 900_000, closed: true,
  }, 120 * 900_000);
  assert.equal(shortSignals.some(item => item.type === "extreme"), false);

  const equal = allow(scanner());
  const hourly = makeBars("1H", 60);
  equal.seedKlines("BTCUSDT", "1H", hourly);
  const equalSignals = equal.ingestKline("BTCUSDT", "1H", {
    ...hourly.at(-1), time: 60 * 3_600, high: 102, close: 102, volume: 10, eventTime: 60 * 3_600_000, closed: true,
  }, 60 * 3_600_000);
  assert.equal(equalSignals.some(item => item.type === "extreme"), false);
});

test("funding, liquidation, and system data are filtered instead of creating alerts", () => {
  const subject = allow(scanner());
  const mark = JSON.stringify({stream: "!markPrice@arr@1s", data: [{e: "markPriceUpdate", s: "BTCUSDT", r: "0.02", p: "100"}]});
  const liquidation = JSON.stringify({stream: "!forceOrder@arr", data: {e: "forceOrder", o: {s: "BTCUSDT", S: "SELL", ap: "100", l: "600"}}});

  assert.equal(marketStreamRows(mark).kind, "unknown");
  assert.equal(marketStreamRows(liquidation).kind, "unknown");
  assert.deepEqual(subject.ingest(mark, 1), []);
  assert.deepEqual(subject.ingest(liquidation, 2), []);
});
