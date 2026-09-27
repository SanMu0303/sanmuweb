import {SECONDS} from "../scanner/config.mjs";
import {VolumeSpikeSignal} from "../scanner/VolumeSpikeSignal.mjs";
import {OISpikeSignal} from "../scanner/OISpikeSignal.mjs";
import {NewHighSignal} from "../scanner/NewHighSignal.mjs";

// The terminal holds its own direct public Binance streams while it is open.
// We intentionally keep the K-line subscription smaller than the all-market
// ticker stream: a browser cannot safely process every USDⓈ-M contract's 250ms
// K-line update. The status line makes this live liquidity scope explicit.
const TICKER_STREAM_URL = "wss://fstream.binance.com/market/stream?streams=!ticker@arr";
const KLINE_STREAM_URL = "wss://fstream.binance.com/market/ws";
const KLINE_STREAM_TIMEFRAMES = ["15m", "1H"];
const KLINE_TIMEFRAMES = ["15m", "1H", "4H", "1D"];
const KLINE_INTERVALS = {"1H": "1h", "4H": "4h", "1D": "1d"};
const MAX_BROWSER_KLINE_SYMBOLS = 80;
const KLINE_STREAMS_PER_SOCKET = 80;
const BASELINE_CONCURRENCY = 4;
const OI_CONCURRENCY = 3;
const OI_POLL_INTERVAL_MS = 5 * 60_000;
const SAMPLE_INTERVAL_MS = 60_000;
const SAMPLE_RETENTION_MS = 4 * 60 * 60_000;
const TICKER_RANK_REFRESH_MS = 60_000;
const MAX_EVENTS = 64;
const SUPPORTED_SIGNAL_TYPES = new Set(["price", "volume", "oi", "extreme"]);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentChange(current, previous) {
  if (!(previous > 0) || !Number.isFinite(current)) return null;
  return ((current / previous) - 1) * 100;
}

function directionOf(value) {
  return value >= 0 ? "up" : "down";
}

function marketRowList(payload) {
  const data = payload?.data ?? payload;
  return Array.isArray(data) ? data : data ? [data] : [];
}

function klineFromRow(row) {
  const source = row?.k || row;
  const time = Math.floor(Number(source?.t ?? row?.t) / 1_000);
  const open = finite(source?.o);
  const high = finite(source?.h);
  const low = finite(source?.l);
  const close = finite(source?.c);
  const volume = finite(source?.v);
  if (!Number.isFinite(time) || [open, high, low, close, volume].some((value) => value == null)) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume,
    eventTime: finite(row?.E) || Date.now(),
    closed: Boolean(source?.x),
  };
}

function normaliseBar(bar) {
  const rawTime = Number(bar?.time);
  const time = Math.floor(rawTime);
  const open = finite(bar?.open);
  const high = finite(bar?.high);
  const low = finite(bar?.low);
  const close = finite(bar?.close);
  const volume = finite(bar?.volume);
  if (!Number.isFinite(time) || [open, high, low, close, volume].some((value) => value == null)) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume,
    eventTime: finite(bar?.eventTime) || Date.now(),
    closed: Boolean(bar?.closed),
  };
}

function eventSymbol(row) {
  return String(row?.s || row?.k?.s || "").toUpperCase();
}

function isUsdmEvent(row, symbols) {
  const symbol = eventSymbol(row);
  return symbols.has(symbol) && (row?.st == null || Number(row.st) === 1);
}

function uniqueBars(bars, max = 181) {
  const byTime = new Map();
  for (const candidate of Array.isArray(bars) ? bars : []) {
    const bar = normaliseBar(candidate);
    if (bar) byTime.set(bar.time, bar);
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time).slice(-max);
}

function uniquePoints(points, max = 64) {
  const byTime = new Map();
  for (const raw of Array.isArray(points) ? points : []) {
    const time = Math.floor(Number(raw?.time));
    const value = finite(raw?.value ?? raw?.openInterest);
    if (Number.isFinite(time) && value != null) byTime.set(time, {time, value});
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time).slice(-max);
}

function canCheckExtreme(timeframe) {
  return ["1H", "4H", "1D"].includes(timeframe);
}

function runPool(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({length: Math.min(limit, queue.length)}, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch {
        // Individual public-data requests are allowed to fail. The next cycle
        // retries without making the whole scanner look disconnected.
      }
    }
  });
  return Promise.all(workers);
}

export function marketStreamRows(raw) {
  let payload;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {kind: "unknown", rows: []};
  }
  const stream = String(payload?.stream || "").toLowerCase();
  const rows = marketRowList(payload);
  if (stream.includes("ticker") || rows.some((row) => row?.e === "24hrTicker")) return {kind: "ticker", rows};
  if (stream.includes("kline") || rows.some((row) => row?.e === "kline" || row?.k)) return {kind: "kline", rows};
  // Funding and force-order data are deliberately ignored. They used to be
  // surfaced as scanner alerts, but are not part of the active rule set.
  return {kind: "unknown", rows: []};
}

export function makeBrowserSignal({
  symbol,
  timeframe = "1H",
  type,
  title,
  value,
  price,
  now,
  metadata = {},
  bucketMs = 5 * 60_000,
}) {
  const at = Math.floor(now / 1_000);
  const bucket = Math.floor(now / bucketMs);
  const direction = metadata.direction || "flat";
  const period = metadata.period || metadata.hours || "live";
  const eventKey = metadata.eventKey ?? bucket;
  return {
    id: `binance-usdm:browser:${symbol}:${timeframe}:${type}:${period}:${direction}:${eventKey}`,
    symbol,
    market: "Crypto",
    timeframe,
    type,
    title,
    value,
    triggeredAt: at,
    detectedAt: now,
    triggerPrice: Number.isFinite(price) ? price : null,
    source: "binance-usdm",
    priority: type === "price" || type === "extreme" ? "high" : "normal",
    description: `${title} · ${value}`,
    metadata: {
      ...metadata,
      venue: "Binance USDⓈ-M Futures",
    },
  };
}

export class BrowserMarketScanner {
  constructor({
    config = {},
    loadUniverse,
    loadTickers,
    loadKlines,
    loadOIHistory,
    loadOpenInterest,
    onData,
    onError,
    webSocketFactory,
  }) {
    this.config = config;
    this.loadUniverse = loadUniverse;
    this.loadTickers = loadTickers;
    this.loadKlines = loadKlines;
    this.loadOIHistory = loadOIHistory;
    this.loadOpenInterest = loadOpenInterest;
    this.onData = onData;
    this.onError = onError;
    this.webSocketFactory = webSocketFactory || ((url) => new WebSocket(url));
    this.symbols = new Set();
    this.tickers = new Map();
    this.ranks = new Map();
    this.entries = new Map();
    this.klineBars = new Map();
    this.klineStates = new Map();
    this.oi = new Map();
    this.oiStates = new Map();
    this.emitted = new Map();
    this.tickerSocket = null;
    this.klineSockets = new Set();
    this.socketTimers = new Set();
    this.stopped = true;
    this.connectAttempt = 0;
    this.reconnectTimer = 0;
    this.rankTimer = 0;
    this.oiTimer = 0;
    this.heavySymbols = [];
    this.status = {
      state: "scanning",
      transport: "browser_websocket",
      scope: "币安 USDⓈ-M · 价格、成交量、OI 与新高/新低",
      done: 0,
      total: 0,
      connections: 0,
      expectedConnections: 1,
      message: "正在建立实时扫描基线",
      lastSuccess: null,
      source: "binance-usdm",
    };
  }

  setConfig(config) {
    this.config = config || {};
    this.refreshRanks();
    if (!this.stopped) this.restartHeavyStreams();
  }

  snapshot() {
    return {signals: [], status: {...this.status}};
  }

  notify(signals = []) {
    this.onData?.({signals: signals.slice(0, MAX_EVENTS), status: {...this.status}});
  }

  setStatus(patch, notify = true) {
    this.status = {...this.status, ...patch};
    if (notify) this.notify();
  }

  entry(symbol) {
    if (!this.entries.has(symbol)) {
      this.entries.set(symbol, {samples: [], change24h: null, initialized: false, priceStates: new Map()});
    }
    return this.entries.get(symbol);
  }

  klineKey(symbol, timeframe) {
    return `${symbol}:${timeframe}`;
  }

  klineState(symbol, timeframe) {
    const key = this.klineKey(symbol, timeframe);
    if (!this.klineStates.has(key)) {
      this.klineStates.set(key, {volumeCandles: new Set(), closedCandles: new Set(), seeded: false});
    }
    return this.klineStates.get(key);
  }

  oiState(symbol) {
    if (!this.oiStates.has(symbol)) this.oiStates.set(symbol, new Map());
    return this.oiStates.get(symbol);
  }

  seedTicker(row) {
    const symbol = String(row?.symbol || row?.s || "").toUpperCase();
    if (!symbol) return;
    const price = finite(row?.lastPrice ?? row?.c);
    const quoteVolume = finite(row?.quoteVolume ?? row?.q);
    const change24h = finite(row?.priceChangePercent ?? row?.P);
    if (!(price > 0)) return;
    this.tickers.set(symbol, {price, quoteVolume: quoteVolume || 0, change24h, at: Date.now()});
    const entry = this.entry(symbol);
    entry.samples = [{at: Date.now(), price}];
    entry.change24h = change24h;
    entry.initialized = false;
  }

  refreshRanks() {
    const sorted = [...this.tickers.entries()]
      .filter(([symbol]) => this.symbols.size === 0 || this.symbols.has(symbol))
      .sort((left, right) => (right[1].quoteVolume || 0) - (left[1].quoteVolume || 0));
    this.ranks.clear();
    sorted.forEach(([symbol], index) => this.ranks.set(symbol, index + 1));
  }

  scheduleRankRefresh() {
    if (this.rankTimer || this.stopped) return;
    this.rankTimer = setTimeout(() => {
      this.rankTimer = 0;
      this.refreshRanks();
      if (!this.stopped) this.scheduleRankRefresh();
    }, TICKER_RANK_REFRESH_MS);
  }

  allowed(symbol, quoteVolume) {
    if (!this.symbols.has(symbol)) return false;
    const config = this.config || {};
    if ((quoteVolume || 0) < Number(config.minQuoteVolumeM || 0) * 1_000_000) return false;
    const maxRank = Number(config.maxVolumeRank || 0);
    return !maxRank || (this.ranks.get(symbol) || Infinity) <= maxRank;
  }

  heavyUniverse() {
    const sorted = [...this.tickers.entries()]
      .filter(([symbol, row]) => this.allowed(symbol, row.quoteVolume))
      .sort((left, right) => (right[1].quoteVolume || 0) - (left[1].quoteVolume || 0));
    const requested = Number(this.config?.maxVolumeRank || 0);
    // 0 was historically "unlimited". On a browser client that would open
    // thousands of 250ms K-line streams, so it intentionally means the safe
    // default window. Users can set a positive rank to choose a smaller scope.
    const max = requested > 0 ? Math.min(requested, MAX_BROWSER_KLINE_SYMBOLS) : MAX_BROWSER_KLINE_SYMBOLS;
    return sorted.slice(0, max).map(([symbol]) => symbol);
  }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus({state: "scanning", message: "正在读取币安 USDⓈ-M 合约目录与行情基线"});
    try {
      const [contracts, tickers] = await Promise.all([this.loadUniverse?.(), this.loadTickers?.()]);
      if (this.stopped) return;
      for (const contract of Array.isArray(contracts) ? contracts : []) {
        if (contract?.symbol) this.symbols.add(String(contract.symbol).toUpperCase());
      }
      for (const ticker of Array.isArray(tickers) ? tickers : []) this.seedTicker(ticker);
      this.refreshRanks();
      this.openTickerSocket();
      this.restartHeavyStreams();
    } catch (error) {
      this.reconnectTicker(error);
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.rankTimer);
    clearTimeout(this.oiTimer);
    this.reconnectTimer = 0;
    this.rankTimer = 0;
    this.oiTimer = 0;
    for (const timer of this.socketTimers) clearTimeout(timer);
    this.socketTimers.clear();
    this.closeTickerSocket();
    this.closeKlineSockets();
  }

  closeTickerSocket() {
    const socket = this.tickerSocket;
    this.tickerSocket = null;
    try {
      socket?.close();
    } catch {
      // A closed browser WebSocket is already fully released.
    }
  }

  closeKlineSockets() {
    for (const record of this.klineSockets) {
      record.closed = true;
      try {
        record.socket?.close();
      } catch {
        // The browser may already have disposed of a stale socket.
      }
    }
    this.klineSockets.clear();
  }

  reconnectTicker(error) {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.connectAttempt++, 5));
    this.setStatus({
      state: "delayed",
      connections: this.connectedSocketCount(),
      message: `${error?.message || "币安实时连接已断开"}，${Math.ceil(delay / 1_000)} 秒后重连`,
    });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openTickerSocket(), delay);
  }

  connectedSocketCount() {
    let total = this.tickerSocket?.readyState === WebSocket.OPEN ? 1 : 0;
    for (const record of this.klineSockets) if (record.socket?.readyState === WebSocket.OPEN) total += 1;
    return total;
  }

  openTickerSocket() {
    if (this.stopped || typeof WebSocket === "undefined") {
      if (!this.stopped) this.reconnectTicker(Error("当前浏览器不支持实时行情连接"));
      return;
    }
    let socket;
    try {
      socket = this.webSocketFactory(TICKER_STREAM_URL);
    } catch (error) {
      this.reconnectTicker(error);
      return;
    }
    this.tickerSocket = socket;
    socket.addEventListener("open", () => {
      if (this.stopped || this.tickerSocket !== socket) return socket.close();
      this.connectAttempt = 0;
      this.setStatus({
        state: this.status.done >= this.status.total ? "ready" : "scanning",
        connections: this.connectedSocketCount(),
        message: this.status.done >= this.status.total ? "实时扫描中 · 历史基线已就绪" : "实时行情已连接，正在建立 K线与 OI 基线",
        lastSuccess: Date.now(),
      });
      this.scheduleRankRefresh();
    });
    socket.addEventListener("message", (event) => {
      if (this.stopped || this.tickerSocket !== socket) return;
      const found = this.ingest(event.data, Date.now());
      if (found.length) this.notify(found);
    });
    socket.addEventListener("close", () => {
      if (this.stopped || this.tickerSocket !== socket) return;
      this.reconnectTicker(Error("币安实时连接已断开"));
    });
  }

  restartHeavyStreams() {
    if (this.stopped) return;
    this.closeKlineSockets();
    this.heavySymbols = this.heavyUniverse();
    const groups = [];
    for (let index = 0; index < this.heavySymbols.length; index += KLINE_STREAMS_PER_SOCKET) {
      groups.push(this.heavySymbols.slice(index, index + KLINE_STREAMS_PER_SOCKET));
    }
    this.status = {
      ...this.status,
      total: this.heavySymbols.length * KLINE_TIMEFRAMES.length,
      done: 0,
      expectedConnections: 1 + groups.length,
      scope: `币安 USDⓈ-M · 价格全市场；K线/OI 监控成交额前 ${this.heavySymbols.length} 个合约`,
      message: this.heavySymbols.length ? "正在建立 K线与 OI 基线" : "没有符合成交额门槛的合约",
    };
    this.notify();
    groups.forEach((symbols, index) => this.openKlineSocket(symbols, index + 1));
    void this.initialiseKlineBaselines(this.heavySymbols);
    this.scheduleOpenInterest(10_000);
  }

  openKlineSocket(symbols, id) {
    if (this.stopped || !symbols.length || typeof WebSocket === "undefined") return;
    const streams = symbols.flatMap((symbol) =>
      KLINE_STREAM_TIMEFRAMES.map((timeframe) => `${symbol.toLowerCase()}@kline_${KLINE_INTERVALS[timeframe]}`),
    );
    const record = {symbols, streams, socket: null, closed: false, attempts: 0};
    this.klineSockets.add(record);
    const connect = () => {
      if (this.stopped || record.closed) return;
      let socket;
      try {
        socket = this.webSocketFactory(KLINE_STREAM_URL);
      } catch {
        this.reconnectKlineSocket(record, connect);
        return;
      }
      record.socket = socket;
      socket.addEventListener("open", () => {
        if (this.stopped || record.closed || record.socket !== socket) return socket.close();
        record.attempts = 0;
        socket.send(JSON.stringify({method: "SUBSCRIBE", params: streams, id}));
        this.setStatus({connections: this.connectedSocketCount(), lastSuccess: Date.now()}, false);
        this.notify();
      });
      socket.addEventListener("message", (event) => {
        if (this.stopped || record.closed || record.socket !== socket) return;
        const found = this.ingest(event.data, Date.now());
        if (found.length) this.notify(found);
      });
      socket.addEventListener("close", () => {
        if (record.socket === socket) record.socket = null;
        if (!this.stopped && !record.closed) this.reconnectKlineSocket(record, connect);
      });
    };
    connect();
  }

  reconnectKlineSocket(record, connect) {
    if (this.stopped || record.closed) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(record.attempts++, 5));
    const timer = setTimeout(() => {
      this.socketTimers.delete(timer);
      connect();
    }, delay);
    this.socketTimers.add(timer);
    this.setStatus({connections: this.connectedSocketCount(), state: "delayed", message: "部分 K线连接重连中"});
  }

  async initialiseKlineBaselines(symbols) {
    if (typeof this.loadKlines !== "function") {
      this.finishKlineBaseline(0);
      return;
    }
    const tasks = symbols.flatMap((symbol) => KLINE_TIMEFRAMES.map((timeframe) => ({symbol, timeframe})));
    await runPool(tasks, BASELINE_CONCURRENCY, async ({symbol, timeframe}) => {
      if (this.stopped) return;
      try {
        const rows = await this.loadKlines(symbol, timeframe);
        if (!this.stopped) this.seedKlines(symbol, timeframe, rows);
      } finally {
        if (!this.stopped) this.finishKlineBaseline(1);
      }
    });
  }

  finishKlineBaseline(increment) {
    if (this.stopped) return;
    const done = Math.min(this.status.total, this.status.done + increment);
    const ready = done >= this.status.total;
    this.status = {
      ...this.status,
      done,
      state: ready && this.tickerSocket?.readyState === WebSocket.OPEN ? "ready" : "scanning",
      message: ready ? "实时扫描中 · K线基线已就绪，OI 将定时校验" : `正在建立 K线基线 ${done}/${this.status.total}`,
      lastSuccess: Date.now(),
    };
    this.notify();
  }

  seedKlines(symbol, timeframe, bars) {
    const normalised = uniqueBars(bars);
    this.klineBars.set(this.klineKey(symbol, timeframe), normalised);
    const state = this.klineState(symbol, timeframe);
    state.seeded = true;
    const nowSeconds = Math.floor(Date.now() / 1_000);
    for (const bar of normalised) {
      if (bar.closed || bar.time + (SECONDS[timeframe] || 0) <= nowSeconds) state.closedCandles.add(bar.time);
    }
    while (state.closedCandles.size > 200) state.closedCandles.delete(state.closedCandles.values().next().value);
    const last = normalised.at(-1);
    if (last && this.volumeExceeded(normalised)) state.volumeCandles.add(last.time);
  }

  volumeExceeded(bars) {
    return VolumeSpikeSignal(bars, this.config || {}).length > 0;
  }

  ingestKline(symbolInput, timeframe, rawBar, now = Date.now(), skipRelease = false) {
    const symbol = String(symbolInput || "").toUpperCase();
    if (!this.symbols.has(symbol) || !this.allowed(symbol, this.tickers.get(symbol)?.quoteVolume || 0)) return [];
    const bar = normaliseBar(rawBar);
    if (!bar) return [];
    const key = this.klineKey(symbol, timeframe);
    const bars = uniqueBars([...(this.klineBars.get(key) || []), bar]);
    this.klineBars.set(key, bars);
    const state = this.klineState(symbol, timeframe);
    const signals = [];

    const volume = VolumeSpikeSignal(bars, this.config || {})[0];
    if (volume && !state.volumeCandles.has(bar.time)) {
      state.volumeCandles.add(bar.time);
      signals.push(makeBrowserSignal({
        symbol,
        timeframe,
        type: "volume",
        title: volume.title,
        value: volume.value,
        price: bar.close,
        now,
        metadata: {
          ...volume.metadata,
          period: 20,
          direction: "up",
          candleOpenTime: bar.time,
          eventKey: bar.time,
          confirmation: bar.closed ? "closed" : "intrabar",
        },
      }));
    }
    while (state.volumeCandles.size > 200) state.volumeCandles.delete(state.volumeCandles.values().next().value);

    if (bar.closed && canCheckExtreme(timeframe) && !state.closedCandles.has(bar.time)) {
      state.closedCandles.add(bar.time);
      const extreme = NewHighSignal(bars)[0];
      if (extreme) {
        signals.push(makeBrowserSignal({
          symbol,
          timeframe,
          type: "extreme",
          title: extreme.title,
          value: extreme.value,
          price: bar.close,
          now,
          metadata: {
            ...extreme.metadata,
            candleOpenTime: bar.time,
            eventKey: `${bar.time}:${extreme.metadata.period}:${extreme.metadata.direction}`,
            confirmation: "closed",
          },
        }));
      }
    }
    while (state.closedCandles.size > 200) state.closedCandles.delete(state.closedCandles.values().next().value);
    // A 15m/1H stream is light enough for the browser. Higher periods are
    // deterministically built from completed live 1H candles, preserving
    // correct UTC bar boundaries without opening every contract's 4H and 1D
    // high-frequency stream.
    if (timeframe === "1H" && bar.closed) signals.push(...this.ingestDerivedKlines(symbol, bar, now));
    this.status.lastSuccess = now;
    return skipRelease ? signals : signals.map((signal) => this.release(signal)).filter(Boolean);
  }

  ingestDerivedKlines(symbol, sourceBar, now) {
    const source = this.klineBars.get(this.klineKey(symbol, "1H")) || [];
    const signals = [];
    for (const timeframe of ["4H", "1D"]) {
      const seconds = SECONDS[timeframe];
      const bucket = Math.floor(sourceBar.time / seconds) * seconds;
      const members = source.filter((bar) => bar.time >= bucket && bar.time < bucket + seconds);
      if (!members.length) continue;
      const first = members[0];
      const last = members.at(-1);
      const derived = {
        time: bucket,
        open: first.open,
        high: Math.max(...members.map((bar) => bar.high)),
        low: Math.min(...members.map((bar) => bar.low)),
        close: last.close,
        volume: members.reduce((total, bar) => total + bar.volume, 0),
        eventTime: sourceBar.eventTime,
        closed: sourceBar.time + SECONDS["1H"] >= bucket + seconds,
      };
      signals.push(...this.ingestKline(symbol, timeframe, derived, now, true));
    }
    return signals;
  }

  seedOpenInterest(symbol, points) {
    const normalised = uniquePoints(points);
    this.oi.set(symbol, normalised);
    const states = this.oiState(symbol);
    for (const result of OISpikeSignal(normalised, this.config || {})) states.set(result.metadata.hours, true);
  }

  ingestOpenInterest(symbolInput, point, now = Date.now()) {
    const symbol = String(symbolInput || "").toUpperCase();
    if (!this.symbols.has(symbol) || !this.allowed(symbol, this.tickers.get(symbol)?.quoteVolume || 0)) return [];
    const normalised = uniquePoints([...(this.oi.get(symbol) || []), point]);
    this.oi.set(symbol, normalised);
    const states = this.oiState(symbol);
    const price = this.tickers.get(symbol)?.price || null;
    const signals = [];
    const results = OISpikeSignal(normalised, this.config || {});
    const activeHours = new Set(results.map((result) => result.metadata.hours));
    for (const hours of [1, 4]) {
      if (!activeHours.has(hours)) states.set(hours, false);
    }
    for (const result of results) {
      const hours = result.metadata.hours;
      if (states.get(hours)) continue;
      states.set(hours, true);
      signals.push(makeBrowserSignal({
        symbol,
        timeframe: `${hours}H`,
        type: "oi",
        title: result.title,
        value: result.value,
        price,
        now,
        metadata: {
          ...result.metadata,
          period: `${hours}H`,
          direction: "up",
          eventKey: `${point.time}:${hours}`,
          confirmation: "sample",
        },
      }));
    }
    this.status.lastSuccess = now;
    return signals.map((signal) => this.release(signal)).filter(Boolean);
  }

  scheduleOpenInterest(delay = OI_POLL_INTERVAL_MS) {
    clearTimeout(this.oiTimer);
    if (this.stopped || !this.heavySymbols.length || typeof this.loadOpenInterest !== "function") return;
    this.oiTimer = setTimeout(async () => {
      await this.pollOpenInterest();
      if (!this.stopped) this.scheduleOpenInterest();
    }, delay);
  }

  async pollOpenInterest() {
    const symbols = [...this.heavySymbols];
    await runPool(symbols, OI_CONCURRENCY, async (symbol) => {
      const now = Date.now();
      const nowSeconds = Math.floor(now / 1_000);
      const [historyResult, currentResult] = await Promise.allSettled([
        this.loadOIHistory?.(symbol, "1H", undefined, nowSeconds - 5 * 3_600, nowSeconds),
        this.loadOpenInterest(symbol),
      ]);
      if (this.stopped || currentResult.status !== "fulfilled") return;
      const current = currentResult.value;
      const upstreamTime = Number(current?.time);
      const point = {
        time: Math.floor(Number.isFinite(upstreamTime) ? (upstreamTime > 10_000_000_000 ? upstreamTime / 1_000 : upstreamTime) : now / 1_000),
        value: finite(current?.openInterest ?? current?.value),
      };
      if (!point.time || point.value == null) return;
      const history = historyResult.status === "fulfilled" ? historyResult.value : [];
      if (!this.oi.has(symbol)) {
        this.seedOpenInterest(symbol, [...(Array.isArray(history) ? history : []), point]);
        return;
      }
      const found = this.ingestOpenInterest(symbol, point, now);
      if (found.length) this.notify(found);
    });
  }

  cooldownKey(signal) {
    const eventKey = signal.metadata?.eventKey;
    if (signal.type === "volume" || signal.type === "extreme") return `${signal.symbol}:${signal.type}:${eventKey}`;
    return `${signal.symbol}:${signal.type}:${signal.metadata?.period || signal.metadata?.hours || "live"}:${signal.metadata?.direction || "flat"}`;
  }

  release(signal) {
    if (!SUPPORTED_SIGNAL_TYPES.has(signal.type)) return null;
    const key = this.cooldownKey(signal);
    const previous = this.emitted.get(key) || 0;
    const cooldown = signal.type === "volume" || signal.type === "extreme"
      ? 0
      : Math.max(30, Number(this.config?.cooldown || 45)) * 60_000;
    if (cooldown && signal.detectedAt - previous < cooldown) return null;
    if (!cooldown && previous) return null;
    this.emitted.set(key, signal.detectedAt);
    for (const [candidate, at] of this.emitted) {
      if (signal.detectedAt - at > 48 * 60 * 60_000) this.emitted.delete(candidate);
    }
    return signal;
  }

  ingest(raw, now = Date.now()) {
    const {kind, rows} = marketStreamRows(raw);
    if (!rows.length) return [];
    const signals = [];
    for (const row of rows) {
      if (!isUsdmEvent(row, this.symbols)) continue;
      if (kind === "ticker") signals.push(...this.ingestTicker(row, now));
      else if (kind === "kline") {
        const timeframeCode = String(row?.k?.i || row?.i || "").toLowerCase();
        const timeframe = Object.entries(KLINE_INTERVALS).find(([, value]) => value === timeframeCode)?.[0];
        const bar = klineFromRow(row);
        if (timeframe && bar) signals.push(...this.ingestKline(eventSymbol(row), timeframe, bar, now));
      }
    }
    if (kind === "ticker") this.scheduleRankRefresh();
    this.status.lastSuccess = now;
    return signals;
  }

  ingestTicker(row, now) {
    const symbol = String(row.s || "").toUpperCase();
    const price = finite(row.c);
    const quoteVolume = finite(row.q) || 0;
    const change24h = finite(row.P);
    if (!(price > 0)) return [];
    this.tickers.set(symbol, {price, quoteVolume, change24h, at: now});
    const entry = this.entry(symbol);
    const isFirst = entry.samples.length === 0;
    const wasInitialized = entry.initialized;
    const latestSample = entry.samples.at(-1);
    if (!latestSample || now - latestSample.at >= SAMPLE_INTERVAL_MS) {
      entry.samples.push({at: now, price});
      entry.samples = entry.samples.filter((sample) => now - sample.at <= SAMPLE_RETENTION_MS);
    }
    const found = [];
    if (!isFirst && wasInitialized && this.allowed(symbol, quoteVolume)) {
      for (const [hours, threshold] of [[1, Number(this.config?.price1h)], [4, Number(this.config?.price4h)]]) {
        if (!(threshold > 0)) continue;
        const target = now - hours * 60 * 60_000;
        const reference = entry.samples.findLast((sample) => sample.at <= target) || null;
        if (!reference || target - reference.at > 5 * SAMPLE_INTERVAL_MS) continue;
        const change = percentChange(price, reference.price);
        const key = `${hours}h`;
        const active = entry.priceStates.get(key) || false;
        const crossed = Number.isFinite(change) && Math.abs(change) >= threshold;
        if (crossed && !active) {
          found.push(makeBrowserSignal({
            symbol,
            timeframe: `${hours}H`,
            type: "price",
            title: "大幅价格异动",
            value: `${hours}H ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
            price,
            now,
            metadata: {hours, pct: change, period: key, direction: directionOf(change), confirmation: "realtime"},
          }));
        }
        if (crossed) entry.priceStates.set(key, true);
        else if (Number.isFinite(change) && Math.abs(change) < threshold * 0.75) entry.priceStates.set(key, false);
      }
      const threshold24h = Number(this.config?.price24h);
      const prior = entry.change24h;
      const crossed24h = Number.isFinite(change24h) && threshold24h > 0 && Math.abs(change24h) >= threshold24h && !(Math.abs(prior || 0) >= threshold24h);
      if (crossed24h) {
        found.push(makeBrowserSignal({
          symbol,
          timeframe: "1D",
          type: "price",
          title: "24H 价格异动",
          value: `24H ${change24h >= 0 ? "+" : ""}${change24h.toFixed(1)}%`,
          price,
          now,
          metadata: {hours: 24, pct: change24h, period: "24h", direction: directionOf(change24h), confirmation: "realtime"},
        }));
      }
    }
    entry.change24h = change24h;
    entry.initialized = true;
    return found.map((signal) => this.release(signal)).filter(Boolean);
  }
}
