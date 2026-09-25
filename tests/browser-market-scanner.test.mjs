import test from "node:test";
import assert from "node:assert/strict";
import {BrowserMarketScanner, marketStreamRows} from "../terminal-source-src/providers/market-scanner.mjs";

const config = {minQuoteVolumeM: 5, maxVolumeRank: 0, price1h: 8, price4h: 12, price24h: 20, cooldown: 45};
const scanner = () => new BrowserMarketScanner({
  config,
  loadUniverse: async () => [{symbol: "BTCUSDT"}],
  loadTickers: async () => [{symbol: "BTCUSDT", lastPrice: "100", quoteVolume: "9000000", priceChangePercent: "1"}],
});

test("classifies Binance market combined streams", () => {
  assert.deepEqual(marketStreamRows(JSON.stringify({stream: "!ticker@arr", data: [{e: "24hrTicker", s: "BTCUSDT"}]})), {kind: "ticker", rows: [{e: "24hrTicker", s: "BTCUSDT"}]});
  assert.equal(marketStreamRows(JSON.stringify({stream: "!markPrice@arr@1s", data: [{e: "markPriceUpdate", s: "BTCUSDT"}]})).kind, "mark");
  assert.equal(marketStreamRows(JSON.stringify({stream: "!forceOrder@arr", data: {e: "forceOrder", o: {s: "BTCUSDT"}}})).kind, "liquidation");
});

test("seeds historical ticker state without emitting an alert", () => {
  const subject = scanner();
  subject.symbols.add("BTCUSDT");
  subject.seedTicker({symbol: "BTCUSDT", lastPrice: "100", quoteVolume: "9000000", priceChangePercent: "1"});
  assert.deepEqual(subject.ingestTicker({s: "BTCUSDT", c: "100", q: "9000000", P: "21"}, Date.now() + 1), []);
});

test("emits a new price cross only after a baseline exists", () => {
  const subject = scanner();
  subject.symbols.add("BTCUSDT");
  subject.seedTicker({symbol: "BTCUSDT", lastPrice: "100", quoteVolume: "9000000", priceChangePercent: "1"});
  subject.refreshRanks();
  const entry = subject.entry("BTCUSDT");
  entry.samples = [{at: 0, price: 100}];
  entry.change24h = 1;
  entry.initialized = true;
  const signals = subject.ingestTicker({s: "BTCUSDT", c: "109", q: "9000000", P: "2"}, 60 * 60_000 + 1);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, "price");
  assert.match(signals[0].value, /1H \+9\.0%/);
  assert.equal(signals[0].metadata.confirmation, "realtime");
});

test("does not emit a funding alert for the first observation", () => {
  const subject = scanner();
  subject.symbols.add("BTCUSDT");
  subject.seedTicker({symbol: "BTCUSDT", lastPrice: "100", quoteVolume: "9000000", priceChangePercent: "1"});
  subject.refreshRanks();
  assert.deepEqual(subject.ingestFunding({s: "BTCUSDT", r: "0.001", p: "100"}, 1), []);
  const later = subject.ingestFunding({s: "BTCUSDT", r: "0.0012", p: "100"}, 2);
  assert.deepEqual(later, []);
});

test("marks liquidation data as a per-second snapshot", () => {
  const subject = scanner();
  subject.symbols.add("BTCUSDT");
  subject.seedTicker({symbol: "BTCUSDT", lastPrice: "100", quoteVolume: "9000000", priceChangePercent: "1"});
  subject.refreshRanks();
  const [signal] = subject.ingestLiquidation({o: {s: "BTCUSDT", S: "SELL", ap: "100", l: "600"}}, 600_000);
  assert.equal(signal.type, "liquidation");
  assert.equal(signal.metadata.partial, true);
  assert.match(signal.metadata.note, /非完整逐笔/);
});
