const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';

const INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w']);
const OI_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
const MAX_LIMIT = 1_500;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

function cleanSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5,24}$/.test(symbol) || !symbol.endsWith('USDT')) fail('交易对格式不正确');
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
  if (interval === '3m') return '5m';
  if (interval === '1m') return '5m';
  if (interval === '3d' || interval === '1w') return '1d';
  return '15m';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function jsonHeaders() {
  return {
    Accept: 'application/json',
    'User-Agent': 'sanmuqushi-terminal/1.0',
  };
}

export function createTerminalMarket({fetcher = fetch, now = () => Date.now()} = {}) {
  const cache = new Map();
  const inFlight = new Map();

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

  async function request(path, search = {}) {
    const url = new URL(`${BINANCE_FUTURES_BASE}${path}`);
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetcher(url, {headers: jsonHeaders(), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000)});
    } catch {
      fail('币安行情服务暂时不可用', 502);
    }
    if (!response.ok) {
      if (response.status === 429) fail('币安请求频率受限，请稍后重试', 429);
      const status = response.status === 400 || response.status === 404 ? 400 : 502;
      fail(status === 400 ? '交易对或行情参数无效' : '币安行情服务暂时不可用', status);
    }
    try { return await response.json(); }
    catch { fail('行情服务返回的数据格式不正确', 502); }
  }

  async function candles({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const rows = await request('/fapi/v1/klines', {symbol: safeSymbol, interval: safeInterval, limit: cleanLimit(limit), endTime: cleanEndTime(endTime)});
    if (!Array.isArray(rows)) fail('行情服务返回的数据格式不正确', 502);
    return {symbol: safeSymbol, interval: safeInterval, candles: rows.map(normalizeCandle).filter(Boolean)};
  }

  async function catalog() {
    return cached('catalog', 60_000, async () => {
      const raw = await request('/fapi/v1/exchangeInfo');
      const symbols = Array.isArray(raw?.symbols) ? raw.symbols
        .filter(item => item?.contractType === 'PERPETUAL' && item?.quoteAsset === 'USDT' && item?.status === 'TRADING')
        .map(item => ({symbol: String(item.symbol || '').toUpperCase(), baseAsset: String(item.baseAsset || ''), quoteAsset: String(item.quoteAsset || ''), contractType: String(item.contractType || '')}))
        .filter(item => /^[A-Z0-9]{2,20}USDT$/.test(item.symbol))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)) : [];
      return {symbols, fetchedAt: new Date(now()).toISOString()};
    });
  }

  async function openInterest({symbol} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    return cached(`open-interest:${safeSymbol}`, 2_500, async () => {
      const raw = await request('/fapi/v1/openInterest', {symbol: safeSymbol});
      if (!raw || typeof raw !== 'object') fail('行情服务返回的数据格式不正确', 502);
      return {
        symbol: safeSymbol,
        openInterest: number(raw.openInterest),
        time: number(raw.time),
      };
    });
  }

  async function snapshot({symbol, interval, limit, endTime} = {}) {
    const safeSymbol = cleanSymbol(symbol);
    const safeInterval = cleanInterval(interval);
    const safeLimit = cleanLimit(limit);
    const oiPeriod = oiPeriodFor(safeInterval);
    const cacheKey = `snapshot:${safeSymbol}:${safeInterval}:${safeLimit}:${cleanEndTime(endTime) || ''}`;
    return cached(cacheKey, 2_500, async () => {
      const result = await Promise.allSettled([
        request('/fapi/v1/klines', {symbol: safeSymbol, interval: safeInterval, limit: safeLimit, endTime: cleanEndTime(endTime)}),
        request('/fapi/v1/ticker/24hr', {symbol: safeSymbol}),
        request('/fapi/v1/premiumIndex', {symbol: safeSymbol}),
        request('/fapi/v1/openInterest', {symbol: safeSymbol}),
        request('/futures/data/openInterestHist', {symbol: safeSymbol, period: oiPeriod, limit: Math.min(500, safeLimit)}),
        request('/fapi/v1/ticker/24hr'),
      ]);
      const value = index => result[index].status === 'fulfilled' ? result[index].value : null;
      const candles = Array.isArray(value(0)) ? value(0).map(normalizeCandle).filter(Boolean) : [];
      if (!candles.length) fail('未取得 K 线数据，请检查交易对后重试', 502);
      const ticker = normalizeTicker(value(1)) || {symbol: safeSymbol, lastPrice: candles.at(-1)?.close || null, priceChangePercent: null, quoteVolume: null, volume: null, highPrice: null, lowPrice: null};
      const mark = value(2) && typeof value(2) === 'object' ? {markPrice: number(value(2).markPrice), fundingRate: number(value(2).lastFundingRate), nextFundingTime: number(value(2).nextFundingTime)} : null;
      const currentOi = value(3) && typeof value(3) === 'object' ? {openInterest: number(value(3).openInterest), time: number(value(3).time)} : null;
      const oiHistory = Array.isArray(value(4)) ? value(4).map(item => ({time: number(item?.timestamp), openInterest: number(item?.sumOpenInterest), value: number(item?.sumOpenInterestValue)})).filter(item => item.time !== null && item.openInterest !== null) : [];
      const allTickers = Array.isArray(value(5)) ? value(5).map(normalizeTicker).filter(Boolean).sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0)) : [];
      const rank = allTickers.findIndex(item => item.symbol === safeSymbol);
      return {
        symbol: safeSymbol,
        interval: safeInterval,
        candles,
        ticker,
        mark,
        currentOi,
        oiHistory,
        rank: rank >= 0 ? rank + 1 : null,
        topByVolume: allTickers.slice(0, 50),
        available: {
          ticker: result[1].status === 'fulfilled',
          mark: result[2].status === 'fulfilled',
          currentOi: result[3].status === 'fulfilled',
          oiHistory: result[4].status === 'fulfilled',
          rank: result[5].status === 'fulfilled',
        },
        fetchedAt: new Date(now()).toISOString(),
      };
    });
  }

  return {candles, catalog, openInterest, snapshot};
}
