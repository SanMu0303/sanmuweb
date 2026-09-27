// Compatibility market-data adapter for the imported Trend Signal Desk.
//
// It deliberately does not share the active terminal's route contract.  The
// imported desk expects small, Binance-shaped REST responses, while this file
// keeps the actual upstream provider visible through route headers / summary
// metadata and falls back only for recoverable upstream failures.

const BINANCE_BASE = 'https://fapi.binance.com';
const BYBIT_BASES = ['https://api.bybit.com', 'https://api.bytick.com'];
const OKX_BASE = 'https://www.okx.com';

const SOURCES = {
  'binance-usdm': {id: 'binance-usdm', label: 'Binance USDⓈ-M', fallback: false},
  'bybit-linear': {id: 'bybit-linear', label: 'Bybit USDT Linear', fallback: true},
  'okx-swap': {id: 'okx-swap', label: 'OKX USDT Swap', fallback: true},
};
const SOURCE_ORDER = ['binance-usdm', 'bybit-linear', 'okx-swap'];
const FAILURE_WINDOW_MS = 60_000;
const MAX_CACHE_ITEMS = 96;
const MAX_OI_PAGES = 8;
// The heat board deliberately remains a bounded, low-frequency read of the
// Binance public API.  It is not a background scanner: one refresh reads the
// 24h ticker batch and a small 1H OI window only for the most liquid contracts.
const HEAT_CACHE_TTL_MS = 90_000;
const HEAT_LIQUIDITY_FLOOR_USDT = 5_000_000;
const HEAT_CANDIDATE_LIMIT = 60;
const HEAT_RESULT_LIMIT = 20;
const HEAT_OI_CONCURRENCY = 6;
const HEAT_OI_HISTORY_LIMIT = 6;
const HEAT_WEIGHTS = Object.freeze({activity: 40, price: 30, oi: 30});

const TIMEFRAMES = {
  '15m': {seconds: 900, binance: '15m', bybit: '15', bybitOi: '15min', okx: '15m'},
  '1H': {seconds: 3_600, binance: '1h', bybit: '60', bybitOi: '1h', okx: '1H'},
  '4H': {seconds: 14_400, binance: '4h', bybit: '240', bybitOi: '4h', okx: '4H'},
  '1D': {seconds: 86_400, binance: '1d', bybit: 'D', bybitOi: '1d', okx: '1D'},
};

const CONTRACT_NAMES = {
  XAU: '黄金', XAG: '白银', XPT: '铂金', XPD: '钯金', COPPER: '铜',
  CL: 'WTI 原油', BZ: '布伦特原油', NATGAS: '天然气', TSLA: '特斯拉',
  NVDA: '英伟达', AAPL: '苹果', MSFT: '微软', AMZN: '亚马逊', GOOGL: '谷歌',
  SPY: '标普500 ETF', QQQ: '纳斯达克100 ETF',
};
const MARKET_CAP_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', NIL: 'nillion', SOL: 'solana',
  DOGE: 'dogecoin', BNB: 'binancecoin',
};
const MARKET_CAP_UNDERLYING = {
  '1000PEPE': 'PEPE', '1000SHIB': 'SHIB', '1000BONK': 'BONK',
  '1000FLOKI': 'FLOKI', '1000SATS': 'SATS',
};

function error(message, status = 400, details = {}) {
  return Object.assign(new Error(message), {status, ...details});
}

function fail(message, status = 400, details = {}) {
  throw error(message, status, details);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function rounded(value, places = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function absolutePercentChange(current, previous) {
  if (!(previous > 0) || !Number.isFinite(current)) return null;
  return Math.abs(((current / previous) - 1) * 100);
}

// Percentiles make assets with very different prices and contract sizes
// comparable. Equal values intentionally receive the same midpoint score
// instead of depending on response order from the exchange.
function percentileScores(items, valueOf) {
  const values = items
    .map(item => ({symbol: item.symbol, value: valueOf(item)}))
    .filter(item => Number.isFinite(item.value));
  const output = new Map();
  if (!values.length) return output;
  if (values.length === 1) {
    output.set(values[0].symbol, 50);
    return output;
  }
  values.sort((left, right) => left.value - right.value || left.symbol.localeCompare(right.symbol));
  for (let start = 0; start < values.length;) {
    let end = start;
    while (end + 1 < values.length && values[end + 1].value === values[start].value) end += 1;
    const score = ((start + end) / 2 / (values.length - 1)) * 100;
    for (let index = start; index <= end; index += 1) output.set(values[index].symbol, score);
    start = end + 1;
  }
  return output;
}

function weightedScore(parts) {
  const available = parts.filter(part => Number.isFinite(part?.score) && Number.isFinite(part?.weight) && part.weight > 0);
  const totalWeight = available.reduce((sum, part) => sum + part.weight, 0);
  if (!totalWeight) return {score: null, effectiveWeights: {activity: 0, price: 0, oi: 0}};
  const effectiveWeights = {activity: 0, price: 0, oi: 0};
  for (const part of available) effectiveWeights[part.key] = (part.weight / totalWeight) * 100;
  return {
    score: available.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight,
    effectiveWeights,
  };
}

function runPool(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({length: Math.min(Math.max(1, limit), queue.length)}, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  return Promise.all(workers);
}

function validSymbol(symbol) {
  return /^[A-Z0-9]{2,20}USDT$/.test(symbol);
}

function cleanSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!validSymbol(symbol)) fail('仅支持格式正确的 USDT 永续合约', 400, {code: 'invalid_symbol'});
  return symbol;
}

function cleanTimeframe(value) {
  const timeframe = String(value || '').trim();
  if (!TIMEFRAMES[timeframe]) fail('K 线周期不支持', 400, {code: 'invalid_timeframe'});
  return timeframe;
}

function cleanKlineLimit(value) {
  if (value === undefined || value === null || value === '') return 1_000;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 2 || limit > 1_000) {
    fail('K 线数量不支持', 400, {code: 'invalid_kline_limit'});
  }
  return limit;
}

function cleanSource(value) {
  if (value === undefined || value === null || value === '' || value === 'auto') return undefined;
  if (Object.hasOwn(SOURCES, value)) return value;
  fail('行情来源不支持', 400, {code: 'invalid_source'});
}

function sourceMeta(source, degraded = []) {
  const definition = SOURCES[source];
  return {
    source,
    sourceLabel: definition.label,
    fallback: definition.fallback,
    degraded: [...new Set(degraded)],
  };
}

function contractMarket(contractType, underlyingType) {
  if (contractType !== 'TRADIFI_PERPETUAL') return 'Crypto';
  if (underlyingType === 'COMMODITY') return 'Commodities';
  if (String(underlyingType || '').includes('EQUITY')) return 'Stocks';
  return 'TradFi';
}

function baseFromSymbol(symbol) {
  return String(symbol || '').toUpperCase().replace(/USDT$/, '');
}

function fromOkxInstrument(value) {
  const match = String(value || '').toUpperCase().match(/^([A-Z0-9]{2,20})-USDT-SWAP$/);
  return match ? `${match[1]}USDT` : null;
}

function toOkxInstrument(symbol) {
  return `${cleanSymbol(symbol).slice(0, -4)}-USDT-SWAP`;
}

function normalizeBinanceCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = toNumber(row[0]);
  const open = toNumber(row[1]);
  const high = toNumber(row[2]);
  const low = toNumber(row[3]);
  const close = toNumber(row[4]);
  const volume = toNumber(row[5]);
  if (![time, open, high, low, close, volume].every(value => value !== null)) return null;
  return {time: Math.floor(time / 1000), open, high, low, close, volume};
}

function normalizeBybitCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = toNumber(row[0]);
  const open = toNumber(row[1]);
  const high = toNumber(row[2]);
  const low = toNumber(row[3]);
  const close = toNumber(row[4]);
  const volume = toNumber(row[5]);
  if (![time, open, high, low, close, volume].every(value => value !== null)) return null;
  return {time: Math.floor(time / 1000), open, high, low, close, volume};
}

function normalizeOkxCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = toNumber(row[0]);
  const open = toNumber(row[1]);
  const high = toNumber(row[2]);
  const low = toNumber(row[3]);
  const close = toNumber(row[4]);
  const volume = toNumber(row[5]);
  if (![time, open, high, low, close, volume].every(value => value !== null)) return null;
  return {time: Math.floor(time / 1000), open, high, low, close, volume};
}

// Binance describes openInterestHist.timestamp as the end time of a sampled
// period. The chart library keys K lines by their opening time, so this maps
// each OI observation onto the K line it belongs to. In particular, a record
// ending exactly at 10:00:00 is associated with the 09:00–10:00 1H candle,
// not the candle beginning at 10:00.
export function oiPeriodEndToKlineOpen(timestamp, timeframe) {
  const step = TIMEFRAMES[timeframe]?.seconds;
  const milliseconds = toNumber(timestamp);
  if (!step || milliseconds === null || milliseconds < 0) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(Math.max(0, seconds - 1) / step) * step;
}

export function normalizeBinanceOiHistory(rows, timeframe, range = {}) {
  const from = toNumber(range?.start);
  const to = toNumber(range?.end);
  const byKlineTime = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sourceTime = toNumber(row?.timestamp);
    const value = toNumber(row?.sumOpenInterest);
    const time = oiPeriodEndToKlineOpen(sourceTime, timeframe);
    if (sourceTime === null || value === null || time === null) continue;
    if ((from !== null && time < from) || (to !== null && time > to)) continue;
    // An upstream retry can overlap the prior page. Retain the newest source
    // sample for a candle while returning the stable `{time, value}` contract.
    const previous = byKlineTime.get(time);
    if (!previous || sourceTime >= previous.sourceTime) byKlineTime.set(time, {time, value, sourceTime});
  }
  return [...byKlineTime.values()]
    .sort((left, right) => left.time - right.time)
    .map(({time, value}) => ({time, value}));
}

// The original desk only relies on this Binance-compatible subset.  Numeric
// fields intentionally remain numeric for all sources; Number() callers in
// the imported source work with both the original Binance strings and these.
function normalizeBinanceTicker(row) {
  const symbol = String(row?.symbol || '').toUpperCase();
  if (!validSymbol(symbol)) return null;
  return {
    symbol,
    lastPrice: toNumber(row.lastPrice),
    priceChangePercent: toNumber(row.priceChangePercent),
    quoteVolume: toNumber(row.quoteVolume),
    volume: toNumber(row.volume),
    tradeCount: toNumber(row.count),
    highPrice: toNumber(row.highPrice),
    lowPrice: toNumber(row.lowPrice),
    markPrice: null,
    fundingRate: null,
    nextFundingTime: null,
    openInterest: null,
    openInterestValue: null,
  };
}

function normalizeBybitTicker(row) {
  const symbol = String(row?.symbol || '').toUpperCase();
  if (!validSymbol(symbol)) return null;
  const percent = firstNumber(row.price24hPcnt, row.priceChangePercent);
  return {
    symbol,
    lastPrice: toNumber(row.lastPrice),
    // Bybit returns a ratio (0.01 === 1%), unlike Binance's percent field.
    priceChangePercent: percent === null ? null : row.price24hPcnt !== undefined ? percent * 100 : percent,
    quoteVolume: firstNumber(row.turnover24h, row.quoteVolume),
    volume: firstNumber(row.volume24h, row.volume),
    tradeCount: null,
    highPrice: firstNumber(row.highPrice24h, row.highPrice),
    lowPrice: firstNumber(row.lowPrice24h, row.lowPrice),
    markPrice: firstNumber(row.markPrice, row.lastPrice),
    fundingRate: toNumber(row.fundingRate),
    nextFundingTime: toNumber(row.nextFundingTime),
    openInterest: toNumber(row.openInterest),
    openInterestValue: toNumber(row.openInterestValue),
  };
}

function normalizeOkxTicker(row) {
  const symbol = fromOkxInstrument(row?.instId);
  if (!symbol) return null;
  const lastPrice = toNumber(row.last);
  const open24h = toNumber(row.open24h);
  const baseVolume = toNumber(row.volCcy24h);
  return {
    symbol,
    lastPrice,
    priceChangePercent: lastPrice !== null && open24h !== null && open24h !== 0 ? ((lastPrice - open24h) / open24h) * 100 : null,
    quoteVolume: lastPrice !== null && baseVolume !== null ? lastPrice * baseVolume : null,
    volume: baseVolume,
    tradeCount: null,
    highPrice: toNumber(row.high24h),
    lowPrice: toNumber(row.low24h),
    markPrice: lastPrice,
    fundingRate: null,
    nextFundingTime: null,
    openInterest: null,
    openInterestValue: null,
  };
}

function responseRetryAfter(response) {
  const value = Number(response.headers?.get?.('retry-after') || 0);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
}

function isRetryable(error) {
  return error?.retryable === true || Number(error?.status) === 502 || Number(error?.status) === 503;
}

export function createSignalDeskMarket({fetcher = fetch, now = () => Date.now()} = {}) {
  const cache = new Map();
  const pending = new Map();
  const unavailableUntil = new Map();
  // A warm edge/serverless instance retains the preceding Top 20 long enough
  // to show rank movement. It is deliberately only an in-process snapshot:
  // cross-instance persistence needs a durable store and is not claimed here.
  let heatSnapshot = null;

  function pruneCache() {
    const time = now();
    for (const [key, entry] of cache) if (entry.expiresAt <= time) cache.delete(key);
    while (cache.size > MAX_CACHE_ITEMS) cache.delete(cache.keys().next().value);
  }

  async function cached(key, ttl, action) {
    const previous = cache.get(key);
    if (previous && previous.expiresAt > now()) return previous.value;
    if (previous) cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    const task = Promise.resolve().then(action);
    pending.set(key, task);
    try {
      const value = await task;
      pruneCache();
      cache.set(key, {value, expiresAt: now() + ttl});
      return value;
    } finally {
      pending.delete(key);
    }
  }

  async function requestJson(base, source, path, params = {}) {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetcher(url, {
        headers: {Accept: 'application/json', 'User-Agent': 'sanmuqushi-signal-desk/1.0'},
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(9_000),
      });
    } catch {
      fail(`${SOURCES[source].label} 行情服务暂时不可用`, 502, {source, retryable: true, code: 'upstream_unavailable'});
    }
    if (!response.ok) {
      if (response.status === 418 || response.status === 429) {
        fail(`${SOURCES[source].label} 请求频率受限，请稍后重试`, 429, {
          source, retryAfter: responseRetryAfter(response), code: 'upstream_rate_limited',
        });
      }
      if (response.status === 400 || response.status === 404) {
        fail('交易对或行情参数无效', 400, {source, code: 'upstream_invalid_request'});
      }
      // For Bybit, HTTP 403 can mean either the documented regional restriction
      // or IP throttling.  In both cases another provider may still be usable.
      fail(`${SOURCES[source].label} 行情服务暂时不可用`, 502, {source, retryable: true, code: 'upstream_unavailable'});
    }
    try {
      return await response.json();
    } catch {
      fail(`${SOURCES[source].label} 返回的数据格式不正确`, 502, {source, retryable: true, code: 'upstream_invalid_response'});
    }
  }

  async function binance(path, params) {
    return requestJson(BINANCE_BASE, 'binance-usdm', path, params);
  }

  async function bybit(path, params) {
    let latest;
    for (const base of BYBIT_BASES) {
      try {
        const raw = await requestJson(base, 'bybit-linear', path, params);
        const code = Number(raw?.retCode);
        if (code === 0) return raw.result;
        if (code === 10006) fail('Bybit 请求频率受限，请稍后重试', 429, {source: 'bybit-linear', code: 'upstream_rate_limited'});
        if (code === 10001) fail('交易对或行情参数无效', 400, {source: 'bybit-linear', code: 'upstream_invalid_request'});
        fail('Bybit 行情服务暂时不可用', 502, {source: 'bybit-linear', retryable: true, code: 'upstream_unavailable'});
      } catch (caught) {
        latest = caught;
        if (!isRetryable(caught)) throw caught;
      }
    }
    throw latest || error('Bybit 行情服务暂时不可用', 502, {source: 'bybit-linear', retryable: true, code: 'upstream_unavailable'});
  }

  async function okx(path, params) {
    const raw = await requestJson(OKX_BASE, 'okx-swap', path, params);
    if (!raw || String(raw.code) !== '0' || !Array.isArray(raw.data)) {
      fail('OKX 行情服务暂时不可用', 502, {source: 'okx-swap', retryable: true, code: 'upstream_unavailable'});
    }
    return raw.data;
  }

  function allowedAutoSources() {
    const time = now();
    const permitted = SOURCE_ORDER.filter(source => (unavailableUntil.get(source) || 0) <= time);
    return permitted.length ? permitted : [];
  }

  async function fromSource(requested, actions) {
    if (requested) return actions[requested]();
    const sources = allowedAutoSources();
    if (!sources.length) {
      fail('全部行情来源暂时不可用，请稍后重试', 503, {code: 'all_upstreams_unavailable', retryable: true});
    }
    let latest;
    for (const source of sources) {
      try {
        const result = await actions[source]();
        unavailableUntil.delete(source);
        return result;
      } catch (caught) {
        latest = caught;
        if (!isRetryable(caught)) throw caught;
        unavailableUntil.set(source, now() + FAILURE_WINDOW_MS);
      }
    }
    throw latest || error('行情服务暂时不可用', 503, {code: 'all_upstreams_unavailable', retryable: true});
  }

  function withMeta(value, source, degraded = []) {
    return {value, meta: sourceMeta(source, degraded)};
  }

  function cleanSecond(value, field, {optional = true} = {}) {
    if (value === undefined || value === null || value === '' || Number(value) === 0) {
      if (optional) return undefined;
      fail(`${field} 不正确`, 400, {code: 'invalid_time'});
    }
    const seconds = Number(value);
    const current = Math.floor(now() / 1000);
    if (!Number.isFinite(seconds) || seconds < 1_500_000_000 || seconds > current + 86_400) {
      fail(`${field} 不正确`, 400, {code: 'invalid_time'});
    }
    return Math.floor(seconds);
  }

  function klineEnd(input, timeframe) {
    const before = cleanSecond(input.before, 'before');
    if (before) return before * 1000 - 1;
    const at = cleanSecond(input.at, 'at');
    if (!at) return undefined;
    return Math.min(now(), (at + TIMEFRAMES[timeframe].seconds * 40) * 1000);
  }

  function oiRange(input, timeframe) {
    const step = TIMEFRAMES[timeframe].seconds;
    const current = Math.floor(now() / 1000);
    const at = cleanSecond(input.at, 'at');
    const from = cleanSecond(input.from, 'from');
    const to = cleanSecond(input.to, 'to');
    const end = Math.min(current, to || (at ? at + step * 40 : current));
    const thirtyDaysAgo = Math.ceil((current - 30 * 86_400) / step) * step;
    const start = Math.max(thirtyDaysAgo, from || end - 999 * step);
    return start > end ? null : {start, end};
  }

  async function binanceContracts() {
    const raw = await binance('/fapi/v1/exchangeInfo');
    const rows = Array.isArray(raw?.symbols) ? raw.symbols : [];
    const value = rows
      .filter(item => item?.status === 'TRADING' && item?.quoteAsset === 'USDT' && item?.marginAsset === 'USDT' && ['PERPETUAL', 'TRADIFI_PERPETUAL'].includes(item?.contractType))
      .map(item => {
        const symbol = String(item.symbol || '').toUpperCase();
        const base = String(item.baseAsset || baseFromSymbol(symbol));
        return {
          symbol,
          market: contractMarket(item.contractType, item.underlyingType),
          name: CONTRACT_NAMES[base] || base || symbol,
          contractType: String(item.contractType || 'PERPETUAL'),
          underlyingType: item.underlyingType || null,
        };
      })
      .filter(item => validSymbol(item.symbol))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return withMeta(value, 'binance-usdm');
  }

  async function bybitContracts() {
    const rows = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const raw = await bybit('/v5/market/instruments-info', {category: 'linear', limit: 1_000, cursor});
      if (Array.isArray(raw?.list)) rows.push(...raw.list);
      cursor = typeof raw?.nextPageCursor === 'string' ? raw.nextPageCursor : '';
      if (!cursor) break;
    }
    const value = rows
      .filter(item => item?.status === 'Trading' && item?.contractType === 'LinearPerpetual' && item?.quoteCoin === 'USDT' && item?.settleCoin === 'USDT')
      .map(item => ({
        symbol: String(item.symbol || '').toUpperCase(),
        market: 'Crypto',
        name: String(item.baseCoin || baseFromSymbol(item.symbol)),
        contractType: 'PERPETUAL',
        underlyingType: null,
      }))
      .filter(item => validSymbol(item.symbol))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return withMeta(value, 'bybit-linear', ['fallback_catalog_crypto_only']);
  }

  async function okxContracts() {
    const rows = await okx('/api/v5/public/instruments', {instType: 'SWAP'});
    const value = rows
      .filter(item => item?.state === 'live' && /-USDT-SWAP$/i.test(String(item?.instId || '')))
      .map(item => {
        const symbol = fromOkxInstrument(item?.instId);
        if (!symbol) return null;
        const base = String(item.ctValCcy || item.baseCcy || baseFromSymbol(symbol));
        return {symbol, market: 'Crypto', name: base, contractType: 'PERPETUAL', underlyingType: null};
      })
      .filter(Boolean)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return withMeta(value, 'okx-swap', ['fallback_catalog_crypto_only']);
  }

  async function contracts(input = {}) {
    const requested = cleanSource(input.source);
    const action = source => cached(`contracts:${source}`, 60 * 60 * 1000, () => ({
      'binance-usdm': binanceContracts,
      'bybit-linear': bybitContracts,
      'okx-swap': okxContracts,
    })[source]());
    return fromSource(requested, {
      'binance-usdm': () => action('binance-usdm'),
      'bybit-linear': () => action('bybit-linear'),
      'okx-swap': () => action('okx-swap'),
    });
  }

  async function universe(input = {}) {
    const result = await contracts(input);
    return {value: result.value.map(item => item.symbol), meta: result.meta};
  }

  function eligibleTickers(rows, contracts, normalizer) {
    const symbols = new Set(contracts.map(item => item.symbol));
    return rows.map(normalizer).filter(item => item && symbols.has(item.symbol));
  }

  async function binanceTickers() {
    // The contract directory changes far less often than ticker data. Reuse
    // the cached catalog here so an all-market reader does not repeatedly
    // request exchangeInfo just to filter the 24h ticker batch.
    const [raw, contractResult] = await Promise.all([binance('/fapi/v1/ticker/24hr'), contracts({source: 'binance-usdm'})]);
    const rows = Array.isArray(raw) ? raw : [];
    return withMeta(eligibleTickers(rows, contractResult.value, normalizeBinanceTicker), 'binance-usdm');
  }

  async function bybitTickers() {
    const [raw, contractResult] = await Promise.all([bybit('/v5/market/tickers', {category: 'linear'}), bybitContracts()]);
    const rows = Array.isArray(raw?.list) ? raw.list : [];
    return withMeta(eligibleTickers(rows, contractResult.value, normalizeBybitTicker), 'bybit-linear', contractResult.meta.degraded);
  }

  async function okxTickers() {
    const [raw, contractResult] = await Promise.all([okx('/api/v5/market/tickers', {instType: 'SWAP'}), okxContracts()]);
    return withMeta(eligibleTickers(raw, contractResult.value, normalizeOkxTicker), 'okx-swap', contractResult.meta.degraded);
  }

  async function tickers(input = {}) {
    const requested = cleanSource(input.source);
    return fromSource(requested, { 'binance-usdm': binanceTickers, 'bybit-linear': bybitTickers, 'okx-swap': okxTickers });
  }

  function binanceHeatOiMetrics(rows) {
    const points = (Array.isArray(rows) ? rows : [])
      .map(row => ({
        time: toNumber(row?.timestamp),
        // USDⓈ-M exposes a USDT notional field here. Older / incomplete rows
        // can omit it, in which case the same contract's quantity still gives
        // a valid percentage change.
        value: firstNumber(row?.sumOpenInterestValue, row?.sumOpenInterest),
      }))
      .filter(point => point.time !== null && point.value !== null && point.value > 0)
      .sort((left, right) => left.time - right.time);
    const latest = points.at(-1);
    if (!latest) return {oiChange1h: null, oiChange4h: null, oiActivity: null};
    const oneHour = absolutePercentChange(latest.value, points.at(-2)?.value);
    const fourHour = absolutePercentChange(latest.value, points.at(-5)?.value);
    const weighted = [
      {value: oneHour, weight: 40},
      {value: fourHour, weight: 60},
    ].filter(part => Number.isFinite(part.value));
    const weight = weighted.reduce((sum, part) => sum + part.weight, 0);
    return {
      oiChange1h: oneHour,
      oiChange4h: fourHour,
      oiActivity: weight
        ? weighted.reduce((sum, part) => sum + part.value * part.weight, 0) / weight
        : null,
    };
  }

  function blendedPercentile(scores) {
    const available = scores.filter(part => Number.isFinite(part?.score) && part.weight > 0);
    const weight = available.reduce((sum, part) => sum + part.weight, 0);
    return weight
      ? available.reduce((sum, part) => sum + part.score * part.weight, 0) / weight
      : null;
  }

  // This is a transparent, bounded ranking rather than a claim of an
  // exchange-provided "trending" feed. Every score comes from Binance
  // USDⓈ-M public data: 24h activity (40%), 24h price activity (30%), and
  // recent 1H / 4H OI change (30%).
  async function contractHeat(input = {}) {
    const requested = cleanSource(input.source);
    if (requested && requested !== 'binance-usdm') {
      fail('合约热度当前仅支持 Binance USDⓈ-M', 400, {code: 'heat_source_not_supported'});
    }

    return cached('contract-heat:binance-usdm', HEAT_CACHE_TTL_MS, async () => {
      const tickerResult = await binanceTickers();
      const universe = tickerResult.value;
      const candidates = universe
        .filter(item => Number.isFinite(item.quoteVolume) && item.quoteVolume >= HEAT_LIQUIDITY_FLOOR_USDT)
        .sort((left, right) => (right.quoteVolume - left.quoteVolume) || left.symbol.localeCompare(right.symbol))
        .slice(0, HEAT_CANDIDATE_LIMIT)
        .map(item => ({
          ...item,
          rangePercent24h: item.highPrice > 0 && item.lowPrice > 0
            ? ((item.highPrice / item.lowPrice) - 1) * 100
            : null,
          oiChange1h: null,
          oiChange4h: null,
          oiActivity: null,
        }));

      // A missing OI series removes only the OI component for that contract;
      // it must never make the entire public heat board unavailable.
      await runPool(candidates, HEAT_OI_CONCURRENCY, async candidate => {
        try {
          const raw = await binance('/futures/data/openInterestHist', {
            symbol: candidate.symbol,
            period: '1h',
            limit: HEAT_OI_HISTORY_LIMIT,
          });
          Object.assign(candidate, binanceHeatOiMetrics(raw));
        } catch {
          // The final score reweights the remaining components. The client
          // receives no invented OI value and still gets a usable Top 20.
        }
      });

      const quoteVolumeScores = percentileScores(candidates, item => item.quoteVolume);
      const tradeCountScores = percentileScores(candidates, item => item.tradeCount);
      const priceActivityScores = percentileScores(candidates, item => {
        const change = Math.abs(item.priceChangePercent ?? NaN);
        const range = item.rangePercent24h;
        if (!Number.isFinite(change) && !Number.isFinite(range)) return null;
        if (!Number.isFinite(change)) return range;
        if (!Number.isFinite(range)) return change;
        return change * 0.65 + range * 0.35;
      });
      const oiActivityScores = percentileScores(candidates, item => item.oiActivity);

      const ranked = candidates.map(candidate => {
        const activity = blendedPercentile([
          {score: quoteVolumeScores.get(candidate.symbol), weight: 75},
          {score: tradeCountScores.get(candidate.symbol), weight: 25},
        ]);
        const price = priceActivityScores.get(candidate.symbol) ?? null;
        const oi = oiActivityScores.get(candidate.symbol) ?? null;
        const composite = weightedScore([
          {key: 'activity', score: activity, weight: HEAT_WEIGHTS.activity},
          {key: 'price', score: price, weight: HEAT_WEIGHTS.price},
          {key: 'oi', score: oi, weight: HEAT_WEIGHTS.oi},
        ]);
        return {
          symbol: candidate.symbol,
          score: rounded(composite.score),
          components: {
            activity: rounded(activity),
            price: rounded(price),
            oi: rounded(oi),
            effectiveWeights: Object.fromEntries(
              Object.entries(composite.effectiveWeights).map(([key, value]) => [key, rounded(value)]),
            ),
          },
          metrics: {
            quoteVolume24h: candidate.quoteVolume,
            tradeCount24h: candidate.tradeCount,
            priceChangePercent24h: candidate.priceChangePercent,
            rangePercent24h: rounded(candidate.rangePercent24h, 4),
            oiChange1h: rounded(candidate.oiChange1h, 4),
            oiChange4h: rounded(candidate.oiChange4h, 4),
          },
        };
      }).filter(item => Number.isFinite(item.score));

      ranked.sort((left, right) => (right.score - left.score)
        || ((right.metrics.quoteVolume24h || 0) - (left.metrics.quoteVolume24h || 0))
        || left.symbol.localeCompare(right.symbol));
      const firstSnapshot = heatSnapshot === null;
      const nextItems = ranked.slice(0, HEAT_RESULT_LIMIT).map((item, index) => {
        const rank = index + 1;
        const previousRank = heatSnapshot?.ranks?.get(item.symbol);
        return {
          ...item,
          rank,
          previousRank: Number.isInteger(previousRank) ? previousRank : null,
          rankChange: firstSnapshot || !Number.isInteger(previousRank) ? null : previousRank - rank,
          isNew: !firstSnapshot && !Number.isInteger(previousRank),
          firstSnapshot,
        };
      });
      heatSnapshot = {
        ranks: new Map(nextItems.map(item => [item.symbol, item.rank])),
        asOf: now(),
      };

      return withMeta({
        source: 'binance-usdm',
        asOf: now(),
        stale: false,
        universeSize: universe.length,
        candidateCount: candidates.length,
        resultLimit: HEAT_RESULT_LIMIT,
        liquidityFloorUSDT: HEAT_LIQUIDITY_FLOOR_USDT,
        weights: HEAT_WEIGHTS,
        items: nextItems,
      }, 'binance-usdm');
    });
  }

  async function binanceKlines(input) {
    const symbol = cleanSymbol(input.symbol);
    const timeframe = cleanTimeframe(input.timeframe);
    const limit = cleanKlineLimit(input.limit);
    const endTime = klineEnd(input, timeframe);
    const raw = await binance('/fapi/v1/klines', {symbol, interval: TIMEFRAMES[timeframe].binance, limit, endTime});
    const value = (Array.isArray(raw) ? raw : []).map(normalizeBinanceCandle).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!value.length) fail('未取得 K 线数据，请检查交易对后重试', 502, {source: 'binance-usdm', retryable: true, code: 'empty_klines'});
    return withMeta(value, 'binance-usdm');
  }

  async function bybitKlines(input) {
    const symbol = cleanSymbol(input.symbol);
    const timeframe = cleanTimeframe(input.timeframe);
    const limit = cleanKlineLimit(input.limit);
    const end = klineEnd(input, timeframe);
    const raw = await bybit('/v5/market/kline', {category: 'linear', symbol, interval: TIMEFRAMES[timeframe].bybit, limit, end});
    // Bybit returns newest-first; the imported chart expects increasing seconds.
    const value = (Array.isArray(raw?.list) ? raw.list : []).map(normalizeBybitCandle).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!value.length) fail('未取得 K 线数据，请检查交易对后重试', 502, {source: 'bybit-linear', retryable: true, code: 'empty_klines'});
    return withMeta(value, 'bybit-linear');
  }

  async function okxKlines(input) {
    const symbol = cleanSymbol(input.symbol);
    const timeframe = cleanTimeframe(input.timeframe);
    const limit = cleanKlineLimit(input.limit);
    const endTime = klineEnd(input, timeframe);
    const raw = await okx('/api/v5/market/candles', {
      instId: toOkxInstrument(symbol), bar: TIMEFRAMES[timeframe].okx, limit: Math.min(limit, 300),
      ...(endTime ? {after: endTime} : {}),
    });
    const value = raw.map(normalizeOkxCandle).filter(Boolean).sort((a, b) => a.time - b.time);
    if (!value.length) fail('未取得 K 线数据，请检查交易对后重试', 502, {source: 'okx-swap', retryable: true, code: 'empty_klines'});
    return withMeta(value, 'okx-swap', ['fallback_history_limit_300']);
  }

  async function klines(input = {}) {
    const requested = cleanSource(input.source);
    // Validate prior to provider selection so an invalid client request never
    // gets interpreted as a provider outage.
    cleanSymbol(input.symbol);
    cleanTimeframe(input.timeframe);
    cleanKlineLimit(input.limit);
    return fromSource(requested, {
      'binance-usdm': () => input.fresh ? binanceKlines(input) : cached(`klines:binance-usdm:${input.symbol}:${input.timeframe}:${input.limit || ''}:${input.at || ''}:${input.before || ''}`, 45_000, () => binanceKlines(input)),
      'bybit-linear': () => input.fresh ? bybitKlines(input) : cached(`klines:bybit-linear:${input.symbol}:${input.timeframe}:${input.limit || ''}:${input.at || ''}:${input.before || ''}`, 45_000, () => bybitKlines(input)),
      'okx-swap': () => input.fresh ? okxKlines(input) : cached(`klines:okx-swap:${input.symbol}:${input.timeframe}:${input.limit || ''}:${input.at || ''}:${input.before || ''}`, 45_000, () => okxKlines(input)),
    });
  }

  async function binanceOiHistory(input) {
    const symbol = cleanSymbol(input.symbol);
    const timeframe = cleanTimeframe(input.timeframe);
    const range = oiRange(input, timeframe);
    if (!range) return withMeta([], 'binance-usdm');
    const rows = [];
    // `range` is made of K-line open times. Include one final period so a
    // closed final candle can receive its period-end OI record. No point is
    // invented for the still-open current candle.
    let end = Math.min(now(), (range.end + TIMEFRAMES[timeframe].seconds) * 1000 - 1);
    for (let page = 0; page < MAX_OI_PAGES && end >= range.start * 1000; page += 1) {
      const raw = await binance('/futures/data/openInterestHist', {
        symbol, period: TIMEFRAMES[timeframe].binance, limit: 500, endTime: end,
      });
      if (!Array.isArray(raw) || !raw.length) break;
      let earliest = Infinity;
      for (const row of raw) {
        const timestamp = toNumber(row?.timestamp);
        if (timestamp === null) continue;
        earliest = Math.min(earliest, timestamp);
        rows.push(row);
      }
      if (!Number.isFinite(earliest) || earliest <= range.start * 1000 || earliest > end) break;
      end = earliest - 1;
    }
    return withMeta(normalizeBinanceOiHistory(rows, timeframe, range), 'binance-usdm');
  }

  async function bybitOiHistory(input) {
    const symbol = cleanSymbol(input.symbol);
    const timeframe = cleanTimeframe(input.timeframe);
    const range = oiRange(input, timeframe);
    if (!range) return withMeta([], 'bybit-linear');
    const values = new Map();
    let cursor = '';
    for (let page = 0; page < MAX_OI_PAGES; page += 1) {
      const raw = await bybit('/v5/market/open-interest', {
        category: 'linear', symbol, intervalTime: TIMEFRAMES[timeframe].bybitOi,
        startTime: range.start * 1000, endTime: range.end * 1000, limit: 200, cursor,
      });
      const rows = Array.isArray(raw?.list) ? raw.list : [];
      for (const row of rows) {
        const timestamp = toNumber(row?.timestamp);
        const value = toNumber(row?.openInterest);
        if (timestamp !== null && value !== null && timestamp >= range.start * 1000 && timestamp <= range.end * 1000) {
          values.set(timestamp, {time: Math.floor(timestamp / 1000), value});
        }
      }
      cursor = typeof raw?.nextPageCursor === 'string' ? raw.nextPageCursor : '';
      if (!cursor || !rows.length) break;
    }
    // This is the public contract quantity.  Bybit does not publish a
    // historical USDT notional field, so no invented historical value is used.
    return withMeta([...values.values()].sort((a, b) => a.time - b.time), 'bybit-linear', ['oi_contract_quantity']);
  }

  async function okxOiHistory(input) {
    cleanSymbol(input.symbol);
    cleanTimeframe(input.timeframe);
    // OKX's public OI history is asset-level, not an exact USDT-swap series.
    // Returning an empty series is truthful and lets the imported chart hide it.
    return withMeta([], 'okx-swap', ['oi_history_unavailable']);
  }

  async function oiHistory(input = {}) {
    const requested = cleanSource(input.source);
    const symbol = cleanSymbol(input.symbol);
    const timeframe = cleanTimeframe(input.timeframe);
    const keySuffix = `${symbol}:${timeframe}:${input.at || ''}:${input.from || ''}:${input.to || ''}`;
    return fromSource(requested, {
      'binance-usdm': () => cached(`oi-history:binance-usdm:${keySuffix}`, 60_000, () => binanceOiHistory({...input, symbol, timeframe})),
      'bybit-linear': () => cached(`oi-history:bybit-linear:${keySuffix}`, 60_000, () => bybitOiHistory({...input, symbol, timeframe})),
      'okx-swap': () => cached(`oi-history:okx-swap:${keySuffix}`, 30_000, () => okxOiHistory({...input, symbol, timeframe})),
    });
  }

  async function binanceOi(input) {
    const result = await binanceOiHistory({...input, timeframe: '1H', from: Math.floor(now() / 1000) - 6 * 3_600, to: Math.floor(now() / 1000)});
    return withMeta(result.value.slice(-6), 'binance-usdm', result.meta.degraded);
  }

  async function bybitOi(input) {
    const result = await bybitOiHistory({...input, timeframe: '1H', from: Math.floor(now() / 1000) - 6 * 3_600, to: Math.floor(now() / 1000)});
    return withMeta(result.value.slice(-6), 'bybit-linear', result.meta.degraded);
  }

  async function okxOi(input) {
    const symbol = cleanSymbol(input.symbol);
    const rows = await okx('/api/v5/public/open-interest', {instType: 'SWAP', instId: toOkxInstrument(symbol)});
    const row = rows[0];
    const time = toNumber(row?.ts);
    const value = firstNumber(row?.oiCcy, row?.oi);
    const points = time !== null && value !== null ? [{time: Math.floor(time / 1000), value}] : [];
    return withMeta(points, 'okx-swap', ['oi_history_unavailable', 'oi_contract_quantity']);
  }

  async function oi(input = {}) {
    const requested = cleanSource(input.source);
    cleanSymbol(input.symbol);
    return fromSource(requested, {
      'binance-usdm': () => cached(`oi:binance-usdm:${input.symbol}`, 60_000, () => binanceOi(input)),
      'bybit-linear': () => cached(`oi:bybit-linear:${input.symbol}`, 60_000, () => bybitOi(input)),
      'okx-swap': () => cached(`oi:okx-swap:${input.symbol}`, 20_000, () => okxOi(input)),
    });
  }

  async function selectedBinanceMetrics(symbol) {
    const [markResult, oiResult] = await Promise.allSettled([
      binance('/fapi/v1/premiumIndex', {symbol}),
      binance('/fapi/v1/openInterest', {symbol}),
    ]);
    const mark = markResult.status === 'fulfilled' ? markResult.value : null;
    const oi = oiResult.status === 'fulfilled' ? oiResult.value : null;
    return {
      markPrice: toNumber(mark?.markPrice), markTime: toNumber(mark?.time),
      fundingRate: toNumber(mark?.lastFundingRate), nextFundingTime: toNumber(mark?.nextFundingTime),
      openInterest: toNumber(oi?.openInterest), openInterestValue: null, oiTime: toNumber(oi?.time),
      oiError: oi && mark ? null : '持仓量或标记价格暂不可用',
    };
  }

  async function selectedOkxMetrics(symbol, ticker) {
    const response = await Promise.allSettled([okx('/api/v5/public/open-interest', {instType: 'SWAP', instId: toOkxInstrument(symbol)})]);
    const row = response[0].status === 'fulfilled' ? response[0].value?.[0] : null;
    const oiValue = toNumber(row?.oiUsd);
    const openInterest = firstNumber(row?.oiCcy, row?.oi);
    return {
      markPrice: ticker?.markPrice ?? ticker?.lastPrice ?? null,
      markTime: toNumber(row?.ts), fundingRate: ticker?.fundingRate ?? null, nextFundingTime: ticker?.nextFundingTime ?? null,
      openInterest,
      openInterestValue: oiValue,
      oiTime: toNumber(row?.ts),
      oiError: row ? null : '持仓量暂不可用',
    };
  }

  async function marketCap(base, market) {
    if (market !== 'Crypto') return {value: null, error: '传统资产合约不使用加密代币市值'};
    const normalized = MARKET_CAP_UNDERLYING[base] || base;
    const id = MARKET_CAP_IDS[normalized];
    if (!id) return {value: null, error: '未配置可验证的流通市值映射'};
    return cached(`market-cap:${id}`, 300_000, async () => {
      try {
        const url = new URL('/api/v3/coins/markets', 'https://api.coingecko.com');
        url.searchParams.set('vs_currency', 'usd');
        url.searchParams.set('ids', id);
        const response = await fetcher(url, {headers: {Accept: 'application/json', 'User-Agent': 'sanmuqushi-signal-desk/1.0'}, cache: 'no-store', signal: AbortSignal.timeout(8_000)});
        if (!response.ok) return {value: null, error: 'CoinGecko 市值数据暂不可用'};
        const rows = await response.json();
        const item = Array.isArray(rows) ? rows.find(row => row?.id === id) : null;
        const value = toNumber(item?.market_cap);
        return value !== null && value > 0
          ? {value, source: 'CoinGecko', coinId: id, updatedAt: item?.last_updated || null, error: null}
          : {value: null, error: '未取得可验证的流通市值'};
      } catch {
        return {value: null, error: 'CoinGecko 市值数据暂不可用'};
      }
    });
  }

  async function summaryForSource(source, input) {
    const symbol = cleanSymbol(input.symbol);
    const [contractResult, tickerResult] = await Promise.all([
      ({'binance-usdm': binanceContracts, 'bybit-linear': bybitContracts, 'okx-swap': okxContracts})[source](),
      ({'binance-usdm': binanceTickers, 'bybit-linear': bybitTickers, 'okx-swap': okxTickers})[source](),
    ]);
    const contract = contractResult.value.find(item => item.symbol === symbol) || null;
    const ticker = tickerResult.value.find(item => item.symbol === symbol) || null;
    if (!contract || !ticker) {
      return withMeta({
        symbol, base: baseFromSymbol(symbol), updatedAt: now(), volume: null, baseVolume: null, change: null,
        rank: null, total: tickerResult.value.length, openInterest: null, openInterestUSDT: null,
        markPrice: null, markTime: null, fundingRate: null, nextFundingTime: null, oiTime: null, marketCap: null,
        error: '无该合约行情', oiError: '持仓量暂不可用',
        source: sourceMeta(source, contractResult.meta.degraded),
      }, source, contractResult.meta.degraded);
    }
    const metrics = source === 'binance-usdm'
      ? await selectedBinanceMetrics(symbol)
      : source === 'okx-swap'
        ? await selectedOkxMetrics(symbol, ticker)
        : {
            markPrice: ticker.markPrice, markTime: now(), fundingRate: ticker.fundingRate, nextFundingTime: ticker.nextFundingTime,
            openInterest: ticker.openInterest, openInterestValue: ticker.openInterestValue, oiTime: now(),
            oiError: ticker.openInterest === null ? '持仓量暂不可用' : null,
          };
    const rank = [...tickerResult.value].sort((left, right) => (right.quoteVolume || 0) - (left.quoteVolume || 0)).findIndex(item => item.symbol === symbol);
    const openInterestUSDT = metrics.openInterestValue ?? (
      metrics.openInterest !== null && metrics.markPrice !== null ? metrics.openInterest * metrics.markPrice : null
    );
    const degraded = [...contractResult.meta.degraded, ...tickerResult.meta.degraded];
    return withMeta({
      symbol,
      base: baseFromSymbol(symbol),
      updatedAt: now(),
      volume: ticker.quoteVolume,
      baseVolume: ticker.volume,
      change: ticker.priceChangePercent,
      rank: rank >= 0 ? rank + 1 : null,
      total: tickerResult.value.length,
      openInterest: metrics.openInterest,
      openInterestUSDT,
      markPrice: metrics.markPrice,
      markTime: metrics.markTime,
      fundingRate: metrics.fundingRate ?? null,
      nextFundingTime: metrics.nextFundingTime ?? null,
      oiTime: metrics.oiTime,
      marketCap: null,
      error: null,
      oiError: metrics.oiError || (openInterestUSDT === null ? '持仓量或标记价格暂不可用' : null),
      source: sourceMeta(source, degraded),
    }, source, degraded);
  }

  async function marketSummary(input = {}) {
    const requested = cleanSource(input.source);
    cleanSymbol(input.symbol);
    return fromSource(requested, {
      'binance-usdm': () => cached(`summary:binance-usdm:${input.symbol}`, 10_000, () => summaryForSource('binance-usdm', input)),
      'bybit-linear': () => cached(`summary:bybit-linear:${input.symbol}`, 10_000, () => summaryForSource('bybit-linear', input)),
      'okx-swap': () => cached(`summary:okx-swap:${input.symbol}`, 10_000, () => summaryForSource('okx-swap', input)),
    });
  }

  return {contracts, universe, tickers, contractHeat, klines, oi, oiHistory, marketSummary};
}
