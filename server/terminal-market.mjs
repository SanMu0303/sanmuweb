const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const BYBIT_LINEAR_BASE = 'https://api.bybit.com';

const INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w']);
const OI_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
const MAX_LIMIT = 1_500;
const BINANCE_FAILURE_WINDOW = 60_000;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function cleanSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) fail('交易对格式不正确');
  return symbol;
}

function cleanInterval(value) {
  const interval = String(value || '15m').trim();
  if (!INTERVALS.has(interval)) fail('K 线周期不支持');
  return interval;
}

function cleanLimit(value, fallback = 1_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(20, Math.round(parsed)));
}

function cleanEndTime(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_500_000_000_000 || parsed > Date.now() + 86_400_000) fail('历史时间不正确');
  return Math.floor(parsed);
}

function oiPeriodFor(interval) {
  if (OI_PERIODS.has(interval)) return interval;
  if (interval === '3m' || interval === '1m') return '5m';
  if (interval === '3d' || interval === '1w') return '1d';
  return '15m';
}

function bybitInterval(interval) {
  return {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
    '1h': '60', '2h': '120', '4h': '240', '6h': '360', '8h': '240',
    '12h': '720', '1d': 'D', '3d': 'D', '1w': 'W',
  }[interval] || '15';
}

function bybitSourceInterval(interval) {
  return interval === '8h' ? '4h' : interval === '3d' ? '1d' : interval;
}

function cleanSource(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'binance-usdm' || value === 'bybit-linear') return value;
  fail('行情来源不支持');
}

function isRetryableProviderError(error) {
  return Number(error?.status) === 502;
}

function bybitOiPeriod(interval) {
  return {
    '1m': '5min', '3m': '5min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '1h', '2h': '1h', '4h': '4h', '6h': '4h', '8h': '4h', '12h': '4h',
    '1d': '1d', '3d': '1d', '1w': '1d',
  }[interval] || '15min';
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizeCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = number(row[0]);
  const open = number(row[1]);
  const high = number(row[2]);
  const low = number(row[3]);
  const close = number(row[4]);
  const volume = number(row[5]);
  const closeTime = number(row[6]);
  if (![time, open, high, low, close, volume].every(value => value !== null)) return null;
  return {time, open, high, low, close, volume, closeTime: closeTime || time};
}

function normalizeBybitCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = number(row[0]);
  const open = number(row[1]);
  const high = number(row[2]);
  const low = number(row[3]);
  const close = number(row[4]);
  const volume = number(row[5]);
  if (![time, open, high, low, close, volume].every(value => value !== null)) return null;
  return {time, open, high, low, close, volume, closeTime: time};
}

function normalizeTicker(row) {
  if (!row || typeof row !== 'object') return null;
  const symbol = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : '';
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) return null;
  return {
    symbol,
    lastPrice: number(row.lastPrice),
    priceChangePercent: number(row.priceChangePercent),
    quoteVolume: number(row.quoteVolume),
    volume: number(row.volume),
    highPrice: number(row.highPrice),
    lowPrice: number(row.lowPrice),
  };
}

function normalizeBybitTicker(row) {
  if (!row || typeof row !== 'object') return null;
  const symbol = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : '';
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) return null;
  const change = firstNumber(row.price24hPcnt, row.priceChangePercent);
  return {
    symbol,
    lastPrice: number(row.lastPrice),
    priceChangePercent: change === null ? null : (row.price24hPcnt !== undefined ? change * 100 : change),
    quoteVolume: firstNumber(row.turnover24h, row.quoteVolume),
    volume: firstNumber(row.volume24h, row.volume),
    highPrice: firstNumber(row.highPrice24h, row.highPrice),
    lowPrice: firstNumber(row.lowPrice24h, row.lowPrice),
  };
}

function jsonHeaders() {
  return {Accept: 'application/json', 'User-Agent': 'sanmuqushi-terminal/1.0'};
}

export function createTerminalMarket({fetcher = fetch, now = () => Date.now()} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let binanceUnavailableUntil = 0;

  async function cached(key, ttl, action) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = Promise.resolve().then(action);
    inFlight.set(key, pending);
    try {
      const value = await pending;
      cache.set(key, {value, expiresAt: now() + ttl});
      return value;
    } finally {
      inFlight.delete(key);
    }
  }

  async function requestJson(base, provider, path, search = {}) {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetcher(url, {headers: jsonHeaders(), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000)});
    } catch {
      fail(`${provider}行情服务暂时不可用`, 502);
    }
    if (!response.ok) {
      if (response.status === 429 || (provider === 'Bybit' && response.status === 403)) fail(`${provider}请求频率受限，请稍后重试`, 429);
      const status = response.status === 400 || response.status === 404 ? 400 : 502;
      fail(status === 400 ? '交易对或行情参数无效' : `${provider}行情服务暂时不可用`, status);
    }
    try { return await response.json(); }
    catch { fail('行情服务返回的数据格式不正确', 502); }
  }

  async function binanceRequest(path, search) {
    return requestJson(BINANCE_FUTURES_BASE, '币安', path, search);
  }

  async function bybitRequest(path, search) {
    const raw = await requestJson(BYBIT_LINEAR_BASE, 'Bybit', path, search);
    const code = Number(raw?.retCode);
    if (code === 10006) fail('Bybit请求频率受限，请稍后重试', 429);
    if (!raw || code !== 0) fail('Bybit行情服务暂时不可用', 502);
    return raw.result;
  }

  async function withBinanceFallback(binanceAction, bybitAction) {
    if (binanceUnavailableUntil > now()) return bybitAction();
    try {
      return await binanceAction();
    } catch (error) {
      if (!isRetryableProviderError(error)) throw error;
      binanceUnavailableUntil = now() + BINANCE_FAILURE_WINDOW;
      return bybitAction();
    }
  }

  function preferredSource() {
    return binanceUnavailableUntil > now() ? 'bybit-linear' : 'binance-usdm';
  }

  async function binanceCandles({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const rows = await binanceRequest('/fapi/v1/klines', {symbol: safeSymbol, interval: safeInterval, limit: cleanLimit(limit), endTime: cleanEndTime(endTime)});
    if (!Array.isArray(rows)) fail('行情服务返回的数据格式不正确', 502);
    const candles = rows.map(normalizeCandle).filter(Boolean);
    if (!candles.length) fail('未取得 K 线数据，请检查交易对后重试', 502);
    return {symbol: safeSymbol, interval: safeInterval, sourceInterval: safeInterval, candles, source: 'binance-usdm'};
  }

  async function bybitCandles({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const raw = await bybitRequest('/v5/market/kline', {
      category: 'linear', symbol: safeSymbol, interval: bybitInterval(safeInterval),
      limit: Math.min(1_000, cleanLimit(limit)), end: cleanEndTime(endTime),
    });
    const candles = (Array.isArray(raw?.list) ? raw.list : []).map(normalizeBybitCandle).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!candles.length) fail('未取得 K 线数据，请检查交易对后重试', 502);
    return {symbol: safeSymbol, interval: safeInterval, sourceInterval: bybitSourceInterval(safeInterval), candles, source: 'bybit-linear'};
  }

  async function candles(input = {}) {
    const source = cleanSource(input.source);
    if (source === 'binance-usdm') return binanceCandles(input);
    if (source === 'bybit-linear') return bybitCandles(input);
    return withBinanceFallback(() => binanceCandles(input), () => bybitCandles(input));
  }

  async function binanceCatalog() {
    const raw = await binanceRequest('/fapi/v1/exchangeInfo');
    const symbols = Array.isArray(raw?.symbols) ? raw.symbols
      .filter(item => item?.contractType === 'PERPETUAL' && item?.quoteAsset === 'USDT' && item?.status === 'TRADING')
      .map(item => ({symbol: String(item.symbol || '').toUpperCase(), baseAsset: String(item.baseAsset || ''), quoteAsset: String(item.quoteAsset || ''), contractType: String(item.contractType || '')}))
      .filter(item => /^[A-Z0-9]{2,20}USDT$/.test(item.symbol))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)) : [];
    return {symbols, source: 'binance-usdm', fetchedAt: new Date(now()).toISOString()};
  }

  async function bybitCatalog() {
    const rows = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const raw = await bybitRequest('/v5/market/instruments-info', {category: 'linear', limit: 1_000, cursor});
      if (Array.isArray(raw?.list)) rows.push(...raw.list);
      cursor = typeof raw?.nextPageCursor === 'string' ? raw.nextPageCursor : '';
      if (!cursor) break;
    }
    const symbols = rows
      .filter(item => item?.contractType === 'LinearPerpetual' && item?.quoteCoin === 'USDT' && item?.settleCoin === 'USDT' && item?.status === 'Trading')
      .map(item => ({symbol: String(item.symbol || '').toUpperCase(), baseAsset: String(item.baseCoin || ''), quoteAsset: String(item.quoteCoin || ''), contractType: 'PERPETUAL'}))
      .filter(item => /^[A-Z0-9]{2,20}USDT$/.test(item.symbol))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return {symbols, source: 'bybit-linear', fetchedAt: new Date(now()).toISOString()};
  }

  async function catalog() {
    const source = preferredSource();
    return cached(`catalog:${source}`, 60_000, () => withBinanceFallback(binanceCatalog, bybitCatalog));
  }

  async function binanceOpenInterest({symbol} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const raw = await binanceRequest('/fapi/v1/openInterest', {symbol: safeSymbol});
    if (!raw || typeof raw !== 'object') fail('行情服务返回的数据格式不正确', 502);
    return {symbol: safeSymbol, openInterest: number(raw.openInterest), time: number(raw.time), source: 'binance-usdm'};
  }

  async function bybitOpenInterest({symbol} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const raw = await bybitRequest('/v5/market/tickers', {category: 'linear', symbol: safeSymbol});
    const ticker = Array.isArray(raw?.list) ? raw.list[0] : null;
    if (!ticker || typeof ticker !== 'object') fail('行情服务返回的数据格式不正确', 502);
    return {symbol: safeSymbol, openInterest: number(ticker.openInterest), time: now(), source: 'bybit-linear'};
  }

  async function openInterest(input = {}) {
    const safeSymbol = cleanSymbol(input.symbol);
    const source = cleanSource(input.source);
    if (source === 'binance-usdm') return cached(`open-interest:binance-usdm:${safeSymbol}`, 2_500, () => binanceOpenInterest({...input, symbol: safeSymbol}));
    if (source === 'bybit-linear') return cached(`open-interest:bybit-linear:${safeSymbol}`, 2_500, () => bybitOpenInterest({...input, symbol: safeSymbol}));
    return cached(`open-interest:${preferredSource()}:${safeSymbol}`, 2_500, () => withBinanceFallback(
      () => binanceOpenInterest({...input, symbol: safeSymbol}),
      () => bybitOpenInterest({...input, symbol: safeSymbol}),
    ));
  }

  async function binanceSnapshot({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const safeLimit = cleanLimit(limit);
    const safeEndTime = cleanEndTime(endTime);
    const oiPeriod = oiPeriodFor(safeInterval);
    const result = await Promise.allSettled([
      binanceRequest('/fapi/v1/klines', {symbol: safeSymbol, interval: safeInterval, limit: safeLimit, endTime: safeEndTime}),
      binanceRequest('/fapi/v1/ticker/24hr', {symbol: safeSymbol}),
      binanceRequest('/fapi/v1/premiumIndex', {symbol: safeSymbol}),
      binanceRequest('/fapi/v1/openInterest', {symbol: safeSymbol}),
      binanceRequest('/futures/data/openInterestHist', {symbol: safeSymbol, period: oiPeriod, limit: Math.min(500, safeLimit)}),
      binanceRequest('/fapi/v1/ticker/24hr'),
    ]);
    const value = index => result[index].status === 'fulfilled' ? result[index].value : null;
    if (result[0].status === 'rejected' && result[0].reason?.status === 429) throw result[0].reason;
    const candles = Array.isArray(value(0)) ? value(0).map(normalizeCandle).filter(Boolean) : [];
    if (!candles.length) fail('未取得 K 线数据，请检查交易对后重试', 502);
    const ticker = normalizeTicker(value(1)) || {symbol: safeSymbol, lastPrice: candles.at(-1)?.close || null, priceChangePercent: null, quoteVolume: null, volume: null, highPrice: null, lowPrice: null};
    const mark = value(2) && typeof value(2) === 'object' ? {markPrice: number(value(2).markPrice), fundingRate: number(value(2).lastFundingRate), nextFundingTime: number(value(2).nextFundingTime)} : null;
    const currentOi = value(3) && typeof value(3) === 'object' ? {openInterest: number(value(3).openInterest), time: number(value(3).time)} : null;
    const oiHistory = Array.isArray(value(4)) ? value(4).map(item => ({time: number(item?.timestamp), openInterest: number(item?.sumOpenInterest), value: number(item?.sumOpenInterestValue)})).filter(item => item.time !== null && item.openInterest !== null) : [];
    const allTickers = Array.isArray(value(5)) ? value(5).map(normalizeTicker).filter(Boolean).sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0)) : [];
    const rank = allTickers.findIndex(item => item.symbol === safeSymbol);
    return {
      symbol: safeSymbol, interval: safeInterval, sourceInterval: safeInterval, candles, ticker, mark, currentOi, oiHistory,
      rank: rank >= 0 ? rank + 1 : null, topByVolume: allTickers.slice(0, 50), source: 'binance-usdm',
      available: {ticker: result[1].status === 'fulfilled', mark: result[2].status === 'fulfilled', currentOi: result[3].status === 'fulfilled', oiHistory: result[4].status === 'fulfilled', rank: result[5].status === 'fulfilled'},
      fetchedAt: new Date(now()).toISOString(),
    };
  }

  async function bybitSnapshot({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const safeLimit = cleanLimit(limit);
    const safeEndTime = cleanEndTime(endTime);
    const result = await Promise.allSettled([
      bybitRequest('/v5/market/kline', {category: 'linear', symbol: safeSymbol, interval: bybitInterval(safeInterval), limit: Math.min(1_000, safeLimit), end: safeEndTime}),
      bybitRequest('/v5/market/tickers', {category: 'linear', symbol: safeSymbol}),
      bybitRequest('/v5/market/open-interest', {category: 'linear', symbol: safeSymbol, intervalTime: bybitOiPeriod(safeInterval), limit: Math.min(200, safeLimit)}),
      bybitRequest('/v5/market/tickers', {category: 'linear'}),
    ]);
    const value = index => result[index].status === 'fulfilled' ? result[index].value : null;
    if (result[0].status === 'rejected' && result[0].reason?.status === 429) throw result[0].reason;
    const candles = (Array.isArray(value(0)?.list) ? value(0).list : []).map(normalizeBybitCandle).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!candles.length) fail('未取得 K 线数据，请检查交易对后重试', 502);
    const tickerRaw = Array.isArray(value(1)?.list) ? value(1).list[0] : null;
    const ticker = normalizeBybitTicker(tickerRaw) || {symbol: safeSymbol, lastPrice: candles.at(-1)?.close || null, priceChangePercent: null, quoteVolume: null, volume: null, highPrice: null, lowPrice: null};
    const mark = tickerRaw && typeof tickerRaw === 'object' ? {markPrice: firstNumber(tickerRaw.markPrice, tickerRaw.lastPrice), fundingRate: number(tickerRaw.fundingRate), nextFundingTime: number(tickerRaw.nextFundingTime)} : null;
    const currentOi = tickerRaw && typeof tickerRaw === 'object' ? {openInterest: number(tickerRaw.openInterest), time: now()} : null;
    const oiHistory = (Array.isArray(value(2)?.list) ? value(2).list : []).map(item => {
      const openInterest = number(item?.openInterest);
      const time = number(item?.timestamp);
      return {time, openInterest, value: null};
    }).filter(item => item.time !== null && item.openInterest !== null).sort((a, b) => a.time - b.time);
    const allTickers = (Array.isArray(value(3)?.list) ? value(3).list : []).map(normalizeBybitTicker).filter(Boolean).sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
    const rank = allTickers.findIndex(item => item.symbol === safeSymbol);
    return {
      symbol: safeSymbol, interval: safeInterval, sourceInterval: bybitSourceInterval(safeInterval), candles, ticker, mark, currentOi, oiHistory,
      rank: rank >= 0 ? rank + 1 : null, topByVolume: allTickers.slice(0, 50), source: 'bybit-linear',
      available: {ticker: result[1].status === 'fulfilled', mark: result[1].status === 'fulfilled', currentOi: result[1].status === 'fulfilled', oiHistory: result[2].status === 'fulfilled', rank: result[3].status === 'fulfilled'},
      fetchedAt: new Date(now()).toISOString(),
    };
  }

  async function snapshot(input = {}) {
    const safeSymbol = cleanSymbol(input.symbol);
    const safeInterval = cleanInterval(input.interval);
    const safeLimit = cleanLimit(input.limit);
    const safeEndTime = cleanEndTime(input.endTime);
    const key = `snapshot:${preferredSource()}:${safeSymbol}:${safeInterval}:${safeLimit}:${safeEndTime || ''}`;
    return cached(key, 2_500, () => withBinanceFallback(
      () => binanceSnapshot({...input, symbol: safeSymbol, interval: safeInterval, limit: safeLimit, endTime: safeEndTime}),
      () => bybitSnapshot({...input, symbol: safeSymbol, interval: safeInterval, limit: safeLimit, endTime: safeEndTime}),
    ));
  }

  return {candles, catalog, openInterest, snapshot};
}
