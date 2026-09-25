const MARKET_STREAM_URL =
  "wss://fstream.binance.com/market/stream?streams=!ticker@arr/!markPrice@arr@1s/!forceOrder@arr/!contractInfo";

const SAMPLE_INTERVAL_MS = 60_000;
const SAMPLE_RETENTION_MS = 4 * 60 * 60_000;
const TICKER_RANK_REFRESH_MS = 60_000;
const FUNDING_ABNORMAL_RATE = 0.0008;
const LIQUIDATION_MIN_NOTIONAL = 50_000;
const MAX_EVENTS = 64;

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

function isUsdmEvent(row, symbols) {
  const symbol = String(row?.s || row?.o?.s || "").toUpperCase();
  // The market endpoint can carry product status.  `st === 1` is USDⓈ-M;
  // a missing field is still safe because the fstream host is USDⓈ-M and the
  // static exchangeInfo catalogue remains the final contract allowlist.
  return symbols.has(symbol) && (row?.st == null || Number(row.st) === 1);
}

function timeframeForSignal() {
  // The chart panel accepts existing scanner timeframes.  Events are still
  // labelled as real-time via metadata.confirmation.
  return "1H";
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
  if (stream.includes("ticker") || rows.some((row) => row?.e === "24hrTicker")) {
    return {kind: "ticker", rows};
  }
  if (stream.includes("markprice") || rows.some((row) => row?.e === "markPriceUpdate")) {
    return {kind: "mark", rows};
  }
  if (stream.includes("forceorder") || rows.some((row) => row?.e === "forceOrder")) {
    return {kind: "liquidation", rows};
  }
  if (stream.includes("contractinfo") || rows.some((row) => row?.e === "CONTRACT_INFO")) {
    return {kind: "contract", rows};
  }
  return {kind: "unknown", rows: []};
}

export function makeBrowserSignal({
  symbol,
  type,
  title,
  value,
  price,
  now,
  metadata = {},
  bucketMs = 5 * 60_000,
}) {
  const at = Math.floor(now / 1000);
  const bucket = Math.floor(now / bucketMs);
  const direction = metadata.direction || "flat";
  return {
    id: `binance-usdm:browser:${symbol}:${type}:${metadata.period || metadata.hours || "live"}:${direction}:${bucket}`,
    symbol,
    market: "Crypto",
    timeframe: timeframeForSignal(),
    type,
    title,
    value,
    triggeredAt: at,
    detectedAt: now,
    triggerPrice: Number.isFinite(price) ? price : null,
    source: "binance-usdm",
    priority: type === "liquidation" || type === "price" ? "high" : "normal",
    description: `${title} · ${value}`,
    metadata: {
      ...metadata,
      confirmation: "realtime",
      venue: "Binance USDⓈ-M Futures",
    },
  };
}

export class BrowserMarketScanner {
  constructor({config, loadUniverse, loadTickers, loadOpenInterest, onData, onError}) {
    this.config = config;
    this.loadUniverse = loadUniverse;
    this.loadTickers = loadTickers;
    this.loadOpenInterest = loadOpenInterest;
    this.onData = onData;
    this.onError = onError;
    this.symbols = new Set();
    this.tickers = new Map();
    this.ranks = new Map();
    this.entries = new Map();
    this.markPrices = new Map();
    this.funding = new Map();
    this.emitted = new Map();
    this.oi = new Map();
    this.ws = null;
    this.stopped = true;
    this.connectAttempt = 0;
    this.reconnectTimer = 0;
    this.rankTimer = 0;
    this.status = {
      state: "scanning",
      transport: "browser_websocket",
      scope: "币安 USDⓈ-M · 全市场价格、资金费率、强平快照",
      done: 0,
      total: 0,
      connections: 0,
      expectedConnections: 1,
      message: "正在建立全市场扫描基线",
      lastSuccess: null,
      source: "binance-usdm",
    };
  }

  setConfig(config) {
    this.config = config;
    this.refreshRanks();
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

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus({state: "scanning", message: "正在读取币安 USDⓈ-M 合约目录与行情基线"});
    try {
      const [contracts, tickers] = await Promise.all([this.loadUniverse(), this.loadTickers()]);
      if (this.stopped) return;
      for (const contract of Array.isArray(contracts) ? contracts : []) {
        if (contract?.symbol) this.symbols.add(String(contract.symbol).toUpperCase());
      }
      for (const ticker of Array.isArray(tickers) ? tickers : []) this.seedTicker(ticker);
      this.refreshRanks();
      this.status.total = this.symbols.size;
      this.status.done = this.symbols.size;
      this.openSocket();
    } catch (error) {
      this.reconnect(error);
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.rankTimer);
    this.reconnectTimer = 0;
    this.rankTimer = 0;
    const socket = this.ws;
    this.ws = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
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

  entry(symbol) {
    if (!this.entries.has(symbol)) {
      this.entries.set(symbol, {samples: [], change24h: null, initialized: false, priceStates: new Map()});
    }
    return this.entries.get(symbol);
  }

  refreshRanks() {
    const sorted = [...this.tickers.entries()]
      .filter(([symbol, row]) => this.symbols.size === 0 || this.symbols.has(symbol))
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

  openSocket() {
    if (this.stopped) return;
    if (typeof WebSocket === "undefined") {
      this.reconnect(Error("当前浏览器不支持实时行情连接"));
      return;
    }
    let socket;
    try {
      socket = new WebSocket(MARKET_STREAM_URL);
    } catch (error) {
      this.reconnect(error);
      return;
    }
    this.ws = socket;
    socket.addEventListener("open", () => {
      if (this.stopped || this.ws !== socket) return socket.close();
      this.connectAttempt = 0;
      this.status = {
        ...this.status,
        state: "ready",
        connections: 1,
        message: "实时扫描中 · 初始行情仅用于建立基线",
        lastSuccess: Date.now(),
      };
      this.notify();
      this.scheduleRankRefresh();
    });
    socket.addEventListener("message", (event) => {
      if (this.stopped || this.ws !== socket) return;
      const found = this.ingest(event.data, Date.now());
      if (found.length) this.notify(found);
    });
    socket.addEventListener("error", () => {
      // close provides a consistent reconnection path in every browser.
    });
    socket.addEventListener("close", () => {
      if (this.stopped || this.ws !== socket) return;
      this.reconnect(Error("币安实时连接已断开"));
    });
  }

  reconnect(error) {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.connectAttempt++, 5));
    this.status = {
      ...this.status,
      state: "delayed",
      connections: 0,
      message: `${error?.message || "实时连接中断"}，${Math.ceil(delay / 1000)} 秒后重连`,
    };
    this.notify();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  allowed(symbol, quoteVolume) {
    if (!this.symbols.has(symbol)) return false;
    const config = this.config || {};
    if ((quoteVolume || 0) < Number(config.minQuoteVolumeM || 0) * 1_000_000) return false;
    const maxRank = Number(config.maxVolumeRank || 0);
    return !maxRank || (this.ranks.get(symbol) || Infinity) <= maxRank;
  }

  cooldownKey(signal) {
    return `${signal.symbol}:${signal.type}:${signal.metadata?.period || signal.metadata?.hours || "live"}:${signal.metadata?.direction || "flat"}`;
  }

  release(signal) {
    const key = this.cooldownKey(signal);
    const cooldown = Math.max(30, Number(this.config?.cooldown || 45)) * 60_000;
    const previous = this.emitted.get(key) || 0;
    if (signal.detectedAt - previous < cooldown) return null;
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
      else if (kind === "mark") signals.push(...this.ingestFunding(row, now));
      else if (kind === "liquidation") signals.push(...this.ingestLiquidation(row, now));
    }
    if (kind === "ticker") this.scheduleRankRefresh();
    this.status.lastSuccess = now;
    return signals.map((signal) => this.release(signal)).filter(Boolean);
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
            type: "price",
            title: "大幅价格异动",
            value: `${hours}H ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
            price,
            now,
            metadata: {hours, pct: change, period: key, direction: directionOf(change)},
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
          type: "price",
          title: "24H 价格异动",
          value: `24H ${change24h >= 0 ? "+" : ""}${change24h.toFixed(1)}%`,
          price,
          now,
          metadata: {hours: 24, pct: change24h, period: "24h", direction: directionOf(change24h)},
        }));
      }
    }
    entry.change24h = change24h;
    entry.initialized = true;
    return found;
  }

  ingestFunding(row, now) {
    const symbol = String(row.s || "").toUpperCase();
    const rate = finite(row.r);
    const price = finite(row.p) || this.tickers.get(symbol)?.price || null;
    if (rate == null || !this.allowed(symbol, this.tickers.get(symbol)?.quoteVolume || 0)) return [];
    const previous = this.funding.get(symbol);
    this.funding.set(symbol, rate);
    // The first received funding rate is baseline only.  This avoids treating
    // a pre-existing extreme value as a newly triggered live alert.
    if (previous == null || Math.abs(previous) >= FUNDING_ABNORMAL_RATE || Math.abs(rate) < FUNDING_ABNORMAL_RATE) return [];
    const sign = directionOf(rate);
    return [makeBrowserSignal({
      symbol,
      type: "funding",
      title: "资金费率异常",
      value: `当前 ${rate >= 0 ? "+" : ""}${(rate * 100).toFixed(4)}%`,
      price,
      now,
      metadata: {rate, nextFundingTime: finite(row.T), period: "funding", direction: sign},
    })];
  }

  ingestLiquidation(row, now) {
    const order = row.o || row;
    const symbol = String(order?.s || row?.s || "").toUpperCase();
    const side = String(order?.S || "").toUpperCase();
    const price = finite(order?.ap) || finite(order?.p) || this.tickers.get(symbol)?.price || null;
    const quantity = finite(order?.l) || finite(order?.z) || finite(order?.q) || 0;
    const notional = price && quantity ? price * quantity : 0;
    if (!this.allowed(symbol, this.tickers.get(symbol)?.quoteVolume || 0) || notional < LIQUIDATION_MIN_NOTIONAL) return [];
    const direction = side === "SELL" ? "long" : "short";
    return [makeBrowserSignal({
      symbol,
      type: "liquidation",
      title: "检测到强平快照",
      value: `${direction === "long" ? "多头" : "空头"}约 ${(notional / 1_000_000).toFixed(2)}M USDT`,
      price,
      now,
      metadata: {
        direction,
        period: "5m",
        notional,
        partial: true,
        note: "币安每秒仅提供该标的最后一笔强平快照，非完整逐笔总量",
      },
    })];
  }
}
