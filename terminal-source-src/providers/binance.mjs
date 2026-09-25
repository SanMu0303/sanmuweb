const API_PREFIX = "/api/signal-desk/";
const BINANCE_FAPI = "https://fapi.binance.com";
const BINANCE_MARKET_WS = "wss://fstream.binance.com/market/ws";
const KLINE_RECONNECT_MIN_MS = 1_000;
const KLINE_RECONNECT_MAX_MS = 30_000;
import {BrowserMarketScanner} from "./market-scanner.mjs";
import {decodeKline} from "./realtime.mjs";

const INTERVALS = {
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};
const STEP_SECONDS = {
  "15m": 900,
  "1H": 3_600,
  "4H": 14_400,
  "1D": 86_400,
};
const DIRECT_TIMEOUT_MS = 20_000;
const DIRECT_KLINE_HISTORY_LIMIT = 1_000;
const DIRECT_OI_HISTORY_MAX_PAGES = 8;
const DIRECT_OI_HISTORY_CACHE_MS = 60_000;
let directContractsCache = null;
let directContractsExpiresAt = 0;
let directTickersCache = null;
let directTickersExpiresAt = 0;
const directOiHistoryCache = new Map();

function apiUrl(path) {
  const [endpoint, query = ""] = String(path).split("?", 2);
  const params = new URLSearchParams(query);
  // LIVE mode is intentionally pinned to Binance USDⓈ-M. The server response
  // carries the same source metadata, so another exchange is never presented
  // as Binance data.
  params.set("source", "binance-usdm");
  return `${API_PREFIX}${endpoint}/?${params}`;
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = Error(body?.error || `Provider error ${response.status}`);
    error.status = response.status;
    const retryAfter = Number(response.headers?.get?.("retry-after") || 0);
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfter = retryAfter * 1_000;
    throw error;
  }
  return body;
}

async function proxyRequest(path, options) {
  return readJson(
    await fetch(apiUrl(path), {
      ...options,
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    }),
  );
}

async function binanceRequest(path, params = {}) {
  const url = new URL(path, BINANCE_FAPI);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return readJson(await fetch(url, {signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS)}));
}

async function preferProxy(path, options, direct) {
  try {
    return await proxyRequest(path, options);
  } catch (proxyError) {
    try {
      return await direct();
    } catch (directError) {
      // Keep the public-facing error from the direct Binance request when it
      // exists; it is more actionable than a region-specific proxy failure.
      throw directError || proxyError;
    }
  }
}

function normalizeKlines(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      time: Math.floor(Number(row?.[0]) / 1000),
      open: Number(row?.[1]),
      high: Number(row?.[2]),
      low: Number(row?.[3]),
      close: Number(row?.[4]),
      volume: Number(row?.[5]),
    }))
    .filter((row) => Number.isFinite(row.time) && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite));
}

function normalizeOi(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({time: Math.floor(Number(row?.timestamp) / 1000), value: Number(row?.sumOpenInterest)}))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.value))
    .sort((a, b) => a.time - b.time);
}

function directOiRange(timeframe, at, from, to) {
  const step = STEP_SECONDS[timeframe];
  if (!step) throw Error("K线周期不支持");
  const now = Math.floor(Date.now() / 1_000);
  const safeAt = Number(at);
  const safeFrom = Number(from);
  const safeTo = Number(to);
  const end = Math.min(now, Number.isFinite(safeTo) && safeTo > 0 ? safeTo : Number.isFinite(safeAt) && safeAt > 0 ? safeAt + step * 40 : now);
  const thirtyDaysAgo = Math.ceil((now - 30 * 86_400) / step) * step;
  const start = Math.max(thirtyDaysAgo, Number.isFinite(safeFrom) && safeFrom > 0 ? safeFrom : end - 999 * step);
  return start > end ? null : {start, end};
}

async function directBinanceOiHistory(symbol, timeframe, at, from, to) {
  const range = directOiRange(timeframe, at, from, to);
  if (!range) return [];
  const key = `${symbol}:${timeframe}:${range.start}:${range.end}`;
  const cached = directOiHistoryCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const values = new Map();
  let end = range.end * 1_000;
  for (let page = 0; page < DIRECT_OI_HISTORY_MAX_PAGES && end >= range.start * 1_000; page += 1) {
    const rows = await binanceRequest("/futures/data/openInterestHist", {
      symbol,
      period: period(timeframe),
      limit: 500,
      endTime: end,
    });
    if (!Array.isArray(rows) || !rows.length) break;
    let earliest = Infinity;
    for (const row of rows) {
      const timestamp = Number(row?.timestamp);
      const value = Number(row?.sumOpenInterest);
      if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
      earliest = Math.min(earliest, timestamp);
      if (timestamp >= range.start * 1_000 && timestamp <= range.end * 1_000) values.set(timestamp, {time: Math.floor(timestamp / 1_000), value});
    }
    if (!Number.isFinite(earliest) || earliest <= range.start * 1_000 || earliest > end) break;
    end = earliest - 1;
  }
  const value = [...values.values()].sort((left, right) => left.time - right.time);
  directOiHistoryCache.set(key, {value, expiresAt: Date.now() + DIRECT_OI_HISTORY_CACHE_MS});
  if (directOiHistoryCache.size > 24) {
    for (const [cacheKey, entry] of directOiHistoryCache) {
      if (entry.expiresAt <= Date.now() || directOiHistoryCache.size > 24) directOiHistoryCache.delete(cacheKey);
    }
  }
  return value;
}

function period(timeframe) {
  const value = INTERVALS[timeframe];
  if (!value) throw Error("K线周期不支持");
  return value;
}

export function klineStreamUrl(symbol, timeframe) {
  return `${BINANCE_MARKET_WS}/${String(symbol).toLowerCase()}@kline_${period(timeframe)}`;
}

function parseWebSocketMessage(raw) {
  if (typeof raw === "string") return JSON.parse(raw);
  if (raw && typeof raw === "object") return raw;
  return null;
}

function directContractMarket(contractType, underlyingType) {
  if (contractType !== "TRADIFI_PERPETUAL") return "Crypto";
  if (underlyingType === "COMMODITY") return "Commodities";
  if (String(underlyingType || "").includes("EQUITY")) return "Stocks";
  return "TradFi";
}

export function directBinanceContracts(raw) {
  return (Array.isArray(raw?.symbols) ? raw.symbols : [])
    .filter((row) => row?.status === "TRADING" && ["PERPETUAL", "TRADIFI_PERPETUAL"].includes(row?.contractType) && row?.quoteAsset === "USDT" && row?.marginAsset === "USDT" && /^[A-Z0-9]{2,20}USDT$/.test(row?.symbol || ""))
    .map((row) => ({
      symbol: row.symbol,
      market: directContractMarket(row.contractType, row.underlyingType),
      name: row.baseAsset || row.symbol.replace(/USDT$/, ""),
      contractType: row.contractType || "PERPETUAL",
      underlyingType: row.underlyingType || null,
    }));
}

export async function directBinanceContractsRequest() {
  if (directContractsCache && directContractsExpiresAt > Date.now()) return directContractsCache;
  const contracts = await binanceRequest("/fapi/v1/exchangeInfo").then(directBinanceContracts);
  directContractsCache = contracts;
  directContractsExpiresAt = Date.now() + 10 * 60_000;
  return contracts;
}

async function directBinanceTickersRequest() {
  if (directTickersCache && directTickersExpiresAt > Date.now()) return directTickersCache;
  const tickers = await binanceRequest("/fapi/v1/ticker/24hr");
  directTickersCache = Array.isArray(tickers) ? tickers : [];
  directTickersExpiresAt = Date.now() + 30_000;
  return directTickersCache;
}

export async function directBinanceMarketSummary(symbol) {
  const [tickerResult, markResult, oiResult, allTickersResult, contractsResult] = await Promise.allSettled([
    binanceRequest("/fapi/v1/ticker/24hr", {symbol}),
    binanceRequest("/fapi/v1/premiumIndex", {symbol}),
    binanceRequest("/fapi/v1/openInterest", {symbol}),
    directBinanceTickersRequest(),
    directBinanceContractsRequest(),
  ]);
  if (tickerResult.status !== "fulfilled") throw tickerResult.reason;
  const ticker = tickerResult.value;
  const mark = markResult.status === "fulfilled" ? markResult.value : null;
  const oi = oiResult.status === "fulfilled" ? oiResult.value : null;
  const allTickers = allTickersResult.status === "fulfilled" ? allTickersResult.value : [];
  const contracts = contractsResult.status === "fulfilled" ? contractsResult.value : [];
  const contractSymbols = new Set(contracts.map((contract) => contract.symbol));
  const markPrice = Number(mark?.markPrice ?? ticker?.lastPrice);
  const openInterest = Number(oi?.openInterest);
  const eligible = (Array.isArray(allTickers) ? allTickers : [])
    .filter((row) => contractSymbols.has(row?.symbol))
    .sort((a, b) => Number(b?.quoteVolume) - Number(a?.quoteVolume));
  const rank = eligible.findIndex((row) => row?.symbol === symbol);
  return {
    symbol,
    base: symbol.replace(/USDT$/, ""),
    volume: Number(ticker?.quoteVolume),
    baseVolume: Number(ticker?.volume),
    openInterest,
    markPrice,
    fundingRate: Number(mark?.lastFundingRate),
    nextFundingTime: Number(mark?.nextFundingTime) || null,
    openInterestUSDT: Number.isFinite(openInterest) && Number.isFinite(markPrice) ? openInterest * markPrice : null,
    oiTime: Number(oi?.time ?? mark?.time) || null,
    rank: rank >= 0 ? rank + 1 : null,
    total: eligible.length || null,
    change: Number(ticker?.priceChangePercent),
    marketCap: null,
    oiError: oi ? null : "持仓量暂不可用",
    source: "browser-direct",
  };
}

export class BinanceProvider {
  constructor(options = {}) {
    this.scannerConfig = null;
    this.marketScanner = null;
    this.webSocketFactory = options.webSocketFactory || ((url) => new WebSocket(url));
    this.setTimeoutFn = options.setTimeoutFn || setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
    this.random = options.random || Math.random;
  }
  getKlines(symbol, timeframe, at, fresh = false, limit) {
    const params = {
      symbol,
      timeframe,
      ...(at ? {at} : {}),
      ...(fresh ? {fresh: "1"} : {}),
      ...(limit ? {limit: String(limit)} : {}),
    };
    const directEndTime = at
      ? Math.min(Date.now(), (Number(at) + STEP_SECONDS[timeframe] * 40) * 1_000)
      : undefined;
    return preferProxy(
      "klines?" + new URLSearchParams(params),
      undefined,
      () => binanceRequest("/fapi/v1/klines", {
        symbol,
        interval: period(timeframe),
        limit: limit || DIRECT_KLINE_HISTORY_LIMIT,
        ...(directEndTime ? {endTime: directEndTime} : {}),
      }).then(normalizeKlines),
    );
  }
  getEarlierKlines(symbol, timeframe, before) {
    const params = {symbol, timeframe, before: String(before)};
    return preferProxy(
      "klines?" + new URLSearchParams(params),
      undefined,
      () => binanceRequest("/fapi/v1/klines", {
        symbol,
        interval: period(timeframe),
        limit: DIRECT_KLINE_HISTORY_LIMIT,
        endTime: Number(before) * 1_000 - 1,
      }).then(normalizeKlines),
    );
  }
  subscribeKlines(symbol, timeframe, onBar, onStatus = () => {}) {
    // Load the initial history over REST once in ChartPanel. Every active bar
    // afterwards comes directly from Binance's public USDⓈ-M Kline stream.
    // This is intentionally browser-local: the chart remains live while the
    // terminal page is open, without claiming a server-side persistent feed.
    const interval = period(timeframe);
    const url = klineStreamUrl(symbol, timeframe);
    let closed = false;
    let socket = null;
    let reconnectTimer = null;
    let attempts = 0;

    const report = (state) => {
      if (!closed) onStatus(state);
    };
    const reconnect = () => {
      if (closed || reconnectTimer !== null) return;
      attempts += 1;
      report("reconnecting");
      const exponential = Math.min(
        KLINE_RECONNECT_MAX_MS,
        KLINE_RECONNECT_MIN_MS * 2 ** Math.min(attempts - 1, 5),
      );
      const jitter = Math.floor(exponential * 0.2 * this.random());
      reconnectTimer = this.setTimeoutFn(() => {
        reconnectTimer = null;
        connect();
      }, exponential + jitter);
    };
    const connect = () => {
      if (closed) return;
      report(attempts ? "reconnecting" : "connecting");
      let nextSocket;
      try {
        nextSocket = this.webSocketFactory(url);
      } catch {
        reconnect();
        return;
      }
      socket = nextSocket;
      nextSocket.onopen = () => {
        if (closed || socket !== nextSocket) return;
        attempts = 0;
        report("connected");
      };
      nextSocket.onmessage = (message) => {
        if (closed || socket !== nextSocket) return;
        try {
          const bar = decodeKline(parseWebSocketMessage(message?.data), symbol, interval);
          if (bar) onBar(bar);
        } catch {
          // Ignore malformed upstream frames and retain the established stream.
        }
      };
      nextSocket.onerror = () => {
        if (closed || socket !== nextSocket) return;
        reconnect();
        try {
          nextSocket.close();
        } catch {
          // The reconnect timer above still restores the stream.
        }
      };
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = null;
        reconnect();
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) this.clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // The terminal is already leaving the chart; no reconnect is needed.
        }
      }
      socket = null;
    };
  }
  async getVolume(s, t) {
    return (await this.getKlines(s, t)).map(({time, volume}) => ({time, volume}));
  }
  getOIHistory(symbol, timeframe, at, from, to) {
    const params = {symbol, timeframe, ...(at ? {at} : {}), ...(from ? {from, to} : {})};
    return preferProxy(
      "oi-history?" + new URLSearchParams(params),
      undefined,
      () => directBinanceOiHistory(symbol, timeframe, at, from, to),
    );
  }
  getOI(symbol) {
    return preferProxy("oi?symbol=" + encodeURIComponent(symbol), undefined, () => binanceRequest("/fapi/v1/openInterest", {symbol}));
  }
  getUniverse() {
    return preferProxy("universe", undefined, () => directBinanceContractsRequest());
  }
  getTickers() {
    return preferProxy("tickers", undefined, () => directBinanceTickersRequest());
  }
  subscribeSignals(onData, onError) {
    // This scanner runs in the open terminal, where a browser can hold one
    // direct public Binance market stream without a serverless relay. It is
    // deliberately not presented as a background service after the page is
    // closed; a persistent scanner remains a separate future deployment.
    this.marketScanner?.stop();
    const scanner = new BrowserMarketScanner({
      config: this.scannerConfig || {},
      loadUniverse: () => this.getUniverse(),
      loadTickers: () => this.getTickers(),
      loadOpenInterest: (symbol) => this.getOI(symbol),
      onData,
      onError,
    });
    this.marketScanner = scanner;
    void scanner.start();
    return () => {
      scanner.stop();
      if (this.marketScanner === scanner) this.marketScanner = null;
    };
  }
  getSignals() {
    return Promise.resolve(
      this.marketScanner?.snapshot() || {
        signals: [],
        status: {
          state: "scanning",
          transport: "browser_websocket",
          message: "等待启动币安 USDⓈ-M 实时扫描",
          scope: "币安 USDⓈ-M · 全市场价格、资金费率、强平快照",
        },
      },
    );
  }
  configure(config) {
    this.scannerConfig = config;
    this.marketScanner?.setConfig(config);
    return this.getSignals().then((result) => ({accepted: true, ...result}));
  }
}
