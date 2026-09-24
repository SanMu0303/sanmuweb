const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const BYBIT_LINEAR_BASES = ['https://api.bybit.com', 'https://api.bytick.com'];
const OKX_MARKET_BASE = 'https://www.okx.com';

const INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w']);
const OI_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
const MAX_LIMIT = 1_500;
const BINANCE_FAILURE_WINDOW = 60_000;
const BYBIT_FAILURE_WINDOW = 60_000;
const MAX_CACHE_ITEMS = 64;

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

function intervalDurationMs(interval) {
  return {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000, '8h': 28_800_000,
    '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000,
  }[interval] || 900_000;
}

function okxInterval(interval) {
  return {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '8h': '8H', '12h': '12H',
    '1d': '1D', '3d': '3D', '1w': '1W',
  }[interval] || '15m';
}

function toOkxInstId(symbol) {
  const safeSymbol = cleanSymbol(symbol);
  return `${safeSymbol.slice(0, -4)}-USDT-SWAP`;
}

function fromOkxInstId(value) {
  const match = String(value || '').toUpperCase().match(/^([A-Z0-9]{2,20})-USDT-SWAP$/);
  return match ? `${match[1]}USDT` : null;
}

function cleanSource(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'binance-usdm' || value === 'bybit-linear' || value === 'okx-swap') return value;
  fail('行情来源不支持');
}

function isRetryableProviderError(error) {
  return Number(error?.status) === 502;
}

function isFallbackProviderError(error) {
  const status = Number(error?.status);
  return status === 429 || status === 502;
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

function normalizeBybitCandle(row, duration = 0) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = number(row[0]);
  const open = number(row[1]);
  const high = number(row[2]);
  const low = number(row[3]);
  const close = number(row[4]);
  const volume = number(row[5]);
  if (![time, open, high, low, close, volume].every(value => value !== null)) return null;
  return {time, open, high, low, close, volume, closeTime: duration ? time + duration - 1 : time};
}

function normalizeOkxCandle(row) {
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

function normalizeOkxTicker(row) {
  if (!row || typeof row !== 'object') return null;
  const symbol = fromOkxInstId(row.instId);
  if (!symbol) return null;
  const lastPrice = number(row.last);
  const open24h = number(row.open24h);
  const baseVolume = number(row.volCcy24h);
  return {
    symbol,
    lastPrice,
    priceChangePercent: lastPrice !== null && open24h !== null && open24h !== 0 ? ((lastPrice - open24h) / open24h) * 100 : null,
    // For USDT-margined swaps OKX returns volCcy24h in the base currency.
    quoteVolume: lastPrice !== null && baseVolume !== null ? lastPrice * baseVolume : null,
    volume: baseVolume,
    highPrice: number(row.high24h),
    lowPrice: number(row.low24h),
  };
}

function jsonHeaders() {
  return {Accept: 'application/json', 'User-Agent': 'sanmuqushi-terminal/1.0'};
}

export function createTerminalMarket({fetcher = fetch, now = () => Date.now()} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let binanceUnavailableUntil = 0;
  let bybitUnavailableUntil = 0;

  function pruneCache() {
    const current = now();
    for (const [key, entry] of cache) if (entry.expiresAt <= current) cache.delete(key);
    while (cache.size >= MAX_CACHE_ITEMS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function cached(key, ttl, action) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) {
      // Keep the insertion order as a small LRU, rather than retaining unique history queries forever.
      cache.delete(key);
      cache.set(key, hit);
      return hit.value;
    }
    if (hit) cache.delete(key);
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = Promise.resolve().then(action);
    inFlight.set(key, pending);
    try {
      const value = await pending;
      pruneCache();
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
    let lastError;
    for (const base of BYBIT_LINEAR_BASES) {
      try {
        const raw = await requestJson(base, 'Bybit', path, search);
        const code = Number(raw?.retCode);
        if (code === 10006) fail('Bybit请求频率受限，请稍后重试', 429);
        if (!raw || code !== 0) fail('Bybit行情服务暂时不可用', 502);
        return raw.result;
      } catch (error) {
        lastError = error;
        if (!isFallbackProviderError(error)) throw error;
      }
    }
    throw lastError || Object.assign(new Error('Bybit行情服务暂时不可用'), {status: 502});
  }

  async function okxRequest(path, search) {
    const raw = await requestJson(OKX_MARKET_BASE, 'OKX', path, search);
    if (!raw || String(raw.code) !== '0' || !Array.isArray(raw.data)) fail('OKX行情服务暂时不可用', 502);
    return raw.data;
  }

  async function withBybitFallback(bybitAction, okxAction) {
    if (bybitUnavailableUntil > now()) return okxAction();
    try {
      return await bybitAction();
    } catch (error) {
      if (!isFallbackProviderError(error)) throw error;
      bybitUnavailableUntil = now() + BYBIT_FAILURE_WINDOW;
      return okxAction();
    }
  }

  async function withBinanceFallback(binanceAction, bybitAction, okxAction) {
    if (binanceUnavailableUntil > now()) return withBybitFallback(bybitAction, okxAction);
    try {
      return await binanceAction();
    } catch (error) {
      if (!isRetryableProviderError(error)) throw error;
      binanceUnavailableUntil = now() + BINANCE_FAILURE_WINDOW;
      return withBybitFallback(bybitAction, okxAction);
    }
  }

  function preferredSource() {
    if (binanceUnavailableUntil <= now()) return 'binance-usdm';
    return bybitUnavailableUntil > now() ? 'okx-swap' : 'bybit-linear';
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
    const candles = (Array.isArray(raw?.list) ? raw.list : []).map(row => normalizeBybitCandle(row, intervalDurationMs(bybitSourceInterval(safeInterval)))).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!candles.length) fail('未取得 K 线数据，请检查交易对后重试', 502);
    return {symbol: safeSymbol, interval: safeInterval, sourceInterval: bybitSourceInterval(safeInterval), candles, source: 'bybit-linear'};
  }

  async function okxCandles({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const rows = await okxRequest('/api/v5/market/candles', {
      instId: toOkxInstId(safeSymbol), bar: okxInterval(safeInterval), limit: Math.min(300, cleanLimit(limit)), after: cleanEndTime(endTime),
    });
    const candles = rows.map(normalizeOkxCandle).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!candles.length) fail('未取得 K 线数据，请检查交易对后重试', 502);
    return {symbol: safeSymbol, interval: safeInterval, sourceInterval: safeInterval, candles, source: 'okx-swap'};
  }

  async function candles(input = {}) {
    const source = cleanSource(input.source);
    if (source === 'binance-usdm') return binanceCandles(input);
    if (source === 'bybit-linear') return bybitCandles(input);
    if (source === 'okx-swap') return okxCandles(input);
    return withBinanceFallback(() => binanceCandles(input), () => bybitCandles(input), () => okxCandles(input));
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

  async function okxCatalog() {
    const rows = await okxRequest('/api/v5/public/instruments', {instType: 'SWAP'});
    const symbols = rows
      .filter(item => item?.state === 'live' && /-USDT-SWAP$/i.test(String(item?.instId || '')))
      .map(item => {
        const symbol = fromOkxInstId(item?.instId);
        return symbol ? {symbol, baseAsset: String(item.ctValCcy || item.baseCcy || symbol.slice(0, -4)), quoteAsset: 'USDT', contractType: 'PERPETUAL'} : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return {symbols, source: 'okx-swap', fetchedAt: new Date(now()).toISOString()};
  }

  async function catalog(input = {}) {
    const source = cleanSource(input.source) || preferredSource();
    const action = source === 'binance-usdm' ? binanceCatalog
      : source === 'bybit-linear' ? bybitCatalog
      : okxCatalog;
    return cached(`catalog:${source}`, 60_000, () => input.source ? action() : withBinanceFallback(binanceCatalog, bybitCatalog, okxCatalog));
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

  async function okxOpenInterest({symbol} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const row = (await okxRequest('/api/v5/public/open-interest', {instType: 'SWAP', instId: toOkxInstId(safeSymbol)}))[0];
    if (!row || typeof row !== 'object') fail('行情服务返回的数据格式不正确', 502);
    const oiUsd = number(row.oiUsd);
    const price = number(row.oiCcy) && number(row.oi) ? number(row.oiUsd) / number(row.oiCcy) : null;
    // Expose a base-equivalent value so the existing UI can show the USD estimate as openInterest * price.
    return {symbol: safeSymbol, openInterest: oiUsd !== null && price ? oiUsd / price : null, time: number(row.ts), source: 'okx-swap'};
  }

  async function openInterest(input = {}) {
    const safeSymbol = cleanSymbol(input.symbol);
    const source = cleanSource(input.source);
    if (source === 'binance-usdm') return cached(`open-interest:binance-usdm:${safeSymbol}`, 2_500, () => binanceOpenInterest({...input, symbol: safeSymbol}));
    if (source === 'bybit-linear') return cached(`open-interest:bybit-linear:${safeSymbol}`, 2_500, () => bybitOpenInterest({...input, symbol: safeSymbol}));
    if (source === 'okx-swap') return cached(`open-interest:okx-swap:${safeSymbol}`, 2_500, () => okxOpenInterest({...input, symbol: safeSymbol}));
    return cached(`open-interest:${preferredSource()}:${safeSymbol}`, 2_500, () => withBinanceFallback(
      () => binanceOpenInterest({...input, symbol: safeSymbol}),
      () => bybitOpenInterest({...input, symbol: safeSymbol}),
      () => okxOpenInterest({...input, symbol: safeSymbol}),
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
    const candles = (Array.isArray(value(0)?.list) ? value(0).list : []).map(row => normalizeBybitCandle(row, intervalDurationMs(bybitSourceInterval(safeInterval)))).filter(Boolean).sort((a, b) => a.time - b.time);
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

  async function okxSnapshot({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const safeLimit = cleanLimit(limit);
    const safeEndTime = cleanEndTime(endTime);
    const instId = toOkxInstId(safeSymbol);
    // Use the all-ticker endpoint for the selected ticker and ranking in one request.
    // OI history is deliberately omitted: OKX's public aggregate history is asset-level,
    // not this exact USDT swap, so presenting it as per-contract history would be misleading.
    const result = await Promise.allSettled([
      okxRequest('/api/v5/market/candles', {instId, bar: okxInterval(safeInterval), limit: Math.min(300, safeLimit), after: safeEndTime}),
      okxRequest('/api/v5/market/tickers', {instType: 'SWAP'}),
      okxRequest('/api/v5/public/open-interest', {instType: 'SWAP', instId}),
    ]);
    const value = index => result[index].status === 'fulfilled' ? result[index].value : null;
    const candles = (Array.isArray(value(0)) ? value(0) : []).map(normalizeOkxCandle).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!candles.length) {
      const candleError = result[0].status === 'rejected' ? result[0].reason : null;
      if (candleError) throw candleError;
      fail('未取得 K 线数据，请检查交易对后重试', 502);
    }
    const allTickers = (Array.isArray(value(1)) ? value(1) : []).map(normalizeOkxTicker).filter(Boolean).sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
    const ticker = allTickers.find(item => item.symbol === safeSymbol) || {symbol: safeSymbol, lastPrice: candles.at(-1)?.close || null, priceChangePercent: null, quoteVolume: null, volume: null, highPrice: null, lowPrice: null};
    const oiRow = Array.isArray(value(2)) ? value(2)[0] : null;
    const oiUsd = number(oiRow?.oiUsd);
    const baseOi = number(oiRow?.oiCcy);
    const oiTime = number(oiRow?.ts);
    const markPrice = ticker.lastPrice;
    const currentOi = oiUsd !== null && markPrice ? {openInterest: oiUsd / markPrice, time: oiTime} : baseOi !== null ? {openInterest: baseOi, time: oiTime} : null;
    const rank = allTickers.findIndex(item => item.symbol === safeSymbol);
    return {
      symbol: safeSymbol, interval: safeInterval, sourceInterval: safeInterval, candles, ticker,
      mark: {markPrice, fundingRate: null, nextFundingTime: null}, currentOi, oiHistory: [],
      rank: rank >= 0 ? rank + 1 : null, topByVolume: allTickers.slice(0, 50), source: 'okx-swap',
      available: {ticker: result[1].status === 'fulfilled', mark: true, currentOi: result[2].status === 'fulfilled', oiHistory: false, rank: result[1].status === 'fulfilled'},
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
      () => okxSnapshot({...input, symbol: safeSymbol, interval: safeInterval, limit: safeLimit, endTime: safeEndTime}),
    ));
  }

  return {candles, catalog, openInterest, snapshot};
}
