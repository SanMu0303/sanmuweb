import test from "node:test";
import assert from "node:assert/strict";
import {BinanceProvider, klineStreamUrl} from "../terminal-source-src/providers/binance.mjs";

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload) {
    this.onmessage?.({data: JSON.stringify(payload)});
  }
  fail() {
    this.onerror?.();
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  closeFromNetwork() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function payload(overrides = {}) {
  return {
    e: "kline",
    E: 2_000,
    s: "BTCUSDT",
    k: {i: "1h", t: 1_000, o: "10", h: "12", l: "9", c: "11", v: "7", x: false},
    ...overrides,
  };
}

test("uses Binance's routed Kline WebSocket instead of a periodic REST refresh", () => {
  const sockets = [];
  const timers = [];
  const cleared = new Set();
  const states = [];
  const bars = [];
  const provider = new BinanceProvider({
    webSocketFactory(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimeoutFn(fn, delay) {
      const timer = {fn, delay};
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      cleared.add(timer);
    },
    random: () => 0,
  });

  const unsubscribe = provider.subscribeKlines("BTCUSDT", "1H", (bar) => bars.push(bar), (state) => states.push(state));
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, "wss://fstream.binance.com/market/ws/btcusdt@kline_1h");
  assert.deepEqual(states, ["connecting"]);

  sockets[0].open();
  sockets[0].message(payload());
  sockets[0].message(payload({s: "ETHUSDT"}));
  assert.equal(bars.length, 1);
  assert.equal(bars[0].close, 11);
  assert.equal(bars[0].eventTime, 2_000);
  assert.equal(states.at(-1), "connected");

  sockets[0].closeFromNetwork();
  assert.equal(states.at(-1), "reconnecting");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1_000);
  timers[0].fn();
  assert.equal(sockets.length, 2);

  unsubscribe();
  assert.equal(sockets[1].closed, true);
  assert.equal(cleared.has(timers[0]), false);
});

test("backs off after a WebSocket error and cleanup prevents further reconnects", () => {
  const sockets = [];
  const timers = [];
  const provider = new BinanceProvider({
    webSocketFactory(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimeoutFn(fn, delay) {
      const timer = {fn, delay};
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    random: () => 0,
  });

  const unsubscribe = provider.subscribeKlines("ETHUSDT", "15m", () => {});
  sockets[0].fail();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1_000);
  unsubscribe();
  assert.equal(timers[0].cleared, true);
  timers[0].fn();
  assert.equal(sockets.length, 1);
});

test("formats a routed lower-case Binance market stream URL", () => {
  assert.equal(klineStreamUrl("SOLUSDT", "4H"), "wss://fstream.binance.com/market/ws/solusdt@kline_4h");
  assert.throws(() => klineStreamUrl("BTCUSDT", "3m"), /K线周期不支持/);
});
