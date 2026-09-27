/**
 * The terminal keeps leaderboard movement in the browser because a serverless
 * API instance cannot reliably retain a previous Top 20 snapshot.  This file
 * also owns a deliberately bounded public-Binance fallback used only if the
 * same-origin heat endpoint is unavailable.
 */

const BINANCE_FAPI = "https://fapi.binance.com";
const CACHE_TTL_MS = 90_000;
const REQUEST_TIMEOUT_MS = 10_000;
const OI_TOTAL_BUDGET_MS = 15_000;
const LIQUIDITY_FLOOR_USDT = 5_000_000;
const CANDIDATE_LIMIT = 60;
const RESULT_LIMIT = 20;
const OI_CONCURRENCY = 4;
const OI_HISTORY_LIMIT = 6;
const HEAT_WEIGHTS = Object.freeze({ activity: 40, price: 30, oi: 30 });

export const BROWSER_HEAT_SOURCE = "binance-usdm-browser";

function number(value) {
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

function validSymbol(symbol) {
  return /^[A-Z0-9]{2,20}USDT$/.test(String(symbol || "").toUpperCase());
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

function percentileScores(items, valueOf) {
  const values = items
    .map((item) => ({ symbol: item.symbol, value: valueOf(item) }))
    .filter((item) => Number.isFinite(item.value));
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

function blendedPercentile(scores) {
  const available = scores.filter((part) => Number.isFinite(part?.score) && part.weight > 0);
  const weight = available.reduce((sum, part) => sum + part.weight, 0);
  return weight
    ? available.reduce((sum, part) => sum + part.score * part.weight, 0) / weight
    : null;
}

function weightedScore(parts) {
  const available = parts.filter((part) => Number.isFinite(part?.score) && Number.isFinite(part?.weight) && part.weight > 0);
  const totalWeight = available.reduce((sum, part) => sum + part.weight, 0);
  if (!totalWeight) return { score: null, effectiveWeights: { activity: 0, price: 0, oi: 0 } };
  const effectiveWeights = { activity: 0, price: 0, oi: 0 };
  for (const part of available) effectiveWeights[part.key] = (part.weight / totalWeight) * 100;
  return {
    score: available.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight,
    effectiveWeights,
  };
}

function normalizeTicker(row) {
  const symbol = String(row?.symbol || "").toUpperCase();
  if (!validSymbol(symbol)) return null;
  return {
    symbol,
    quoteVolume: number(row.quoteVolume),
    tradeCount: number(row.count),
    priceChangePercent: number(row.priceChangePercent),
    highPrice: number(row.highPrice),
    lowPrice: number(row.lowPrice),
  };
}

function oiMetrics(rows) {
  const points = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      time: number(row?.timestamp),
      // Binance documents sumOpenInterestValue as a USDT notional. Use the
      // quantity only if an older upstream response omits that field.
      value: firstNumber(row?.sumOpenInterestValue, row?.sumOpenInterest),
    }))
    .filter((point) => point.time !== null && point.value !== null && point.value > 0)
    .sort((left, right) => left.time - right.time);
  const latest = points.at(-1);
  if (!latest) return { oiChange1h: null, oiChange4h: null, oiActivity: null };
  const oneHour = absolutePercentChange(latest.value, points.at(-2)?.value);
  const fourHour = absolutePercentChange(latest.value, points.at(-5)?.value);
  const weighted = [
    { value: oneHour, weight: 40 },
    { value: fourHour, weight: 60 },
  ].filter((part) => Number.isFinite(part.value));
  const weight = weighted.reduce((sum, part) => sum + part.weight, 0);
  return {
    oiChange1h: oneHour,
    oiChange4h: fourHour,
    oiActivity: weight
      ? weighted.reduce((sum, part) => sum + part.value * part.weight, 0) / weight
      : null,
  };
}

function makeRequestSignal(timeoutMs, parentSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (parentSignal) {
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", abort);
    },
  };
}

async function binanceJson(fetcher, path, params = {}, { signal } = {}) {
  const url = new URL(path, BINANCE_FAPI);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const request = makeRequestSignal(REQUEST_TIMEOUT_MS, signal);
  try {
    const response = await fetcher(url, {
      signal: request.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = Error(body?.msg || `Binance heat request returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    request.dispose();
  }
}

async function runPool(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(Math.max(1, limit), queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function contractSymbols(exchangeInfo) {
  return new Set(
    (Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : [])
      .filter((row) => row?.status === "TRADING"
        && ["PERPETUAL", "TRADIFI_PERPETUAL"].includes(row?.contractType)
        && row?.quoteAsset === "USDT"
        && row?.marginAsset === "USDT"
        && validSymbol(row?.symbol))
      .map((row) => String(row.symbol).toUpperCase()),
  );
}

/**
 * Score Binance public rows using the same transparent formula as the
 * same-origin endpoint: activity 40%, price activity 30%, OI activity 30%.
 * Missing OI only reweights that contract; it never invents an OI value.
 */
export function rankBrowserContractHeat(candidates) {
  const quoteVolumeScores = percentileScores(candidates, (item) => item.quoteVolume);
  const tradeCountScores = percentileScores(candidates, (item) => item.tradeCount);
  const priceActivityScores = percentileScores(candidates, (item) => {
    const change = Math.abs(item.priceChangePercent ?? NaN);
    const range = item.rangePercent24h;
    if (!Number.isFinite(change) && !Number.isFinite(range)) return null;
    if (!Number.isFinite(change)) return range;
    if (!Number.isFinite(range)) return change;
    return change * 0.65 + range * 0.35;
  });
  const oiActivityScores = percentileScores(candidates, (item) => item.oiActivity);

  return candidates
    .map((candidate) => {
      const activity = blendedPercentile([
        { score: quoteVolumeScores.get(candidate.symbol), weight: 75 },
        { score: tradeCountScores.get(candidate.symbol), weight: 25 },
      ]);
      const price = priceActivityScores.get(candidate.symbol) ?? null;
      const oi = oiActivityScores.get(candidate.symbol) ?? null;
      const composite = weightedScore([
        { key: "activity", score: activity, weight: HEAT_WEIGHTS.activity },
        { key: "price", score: price, weight: HEAT_WEIGHTS.price },
        { key: "oi", score: oi, weight: HEAT_WEIGHTS.oi },
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
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => (right.score - left.score)
      || ((right.metrics.quoteVolume24h || 0) - (left.metrics.quoteVolume24h || 0))
      || left.symbol.localeCompare(right.symbol))
    .slice(0, RESULT_LIMIT)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * Creates a client-only Binance USDⓈ-M heat reader.  It never accepts a URL,
 * exchange, or credentials from the page.  A 90-second cache plus a hard cap
 * of 60 liquid contracts / 4 concurrent OI reads keeps the fallback bounded.
 */
export function createBrowserContractHeatLoader({ fetcher = fetch, now = () => Date.now() } = {}) {
  let cache = null;
  let pending = null;

  async function load() {
    const currentTime = now();
    if (cache?.expiresAt > currentTime) return cache.value;
    if (pending) return pending;

    pending = (async () => {
      const [exchangeInfo, tickers] = await Promise.all([
        binanceJson(fetcher, "/fapi/v1/exchangeInfo"),
        binanceJson(fetcher, "/fapi/v1/ticker/24hr"),
      ]);
      const symbols = contractSymbols(exchangeInfo);
      const universe = (Array.isArray(tickers) ? tickers : [])
        .map(normalizeTicker)
        .filter(Boolean)
        .filter((item) => symbols.has(item.symbol));
      const candidates = universe
        .filter((item) => Number.isFinite(item.quoteVolume) && item.quoteVolume >= LIQUIDITY_FLOOR_USDT)
        .sort((left, right) => (right.quoteVolume - left.quoteVolume) || left.symbol.localeCompare(right.symbol))
        .slice(0, CANDIDATE_LIMIT)
        .map((item) => ({
          ...item,
          rangePercent24h: item.highPrice > 0 && item.lowPrice > 0
            ? ((item.highPrice / item.lowPrice) - 1) * 100
            : null,
          oiChange1h: null,
          oiChange4h: null,
          oiActivity: null,
        }));

      // The total OI budget prevents a regional outage from leaving a browser
      // with an ever-growing queue.  Any candidate without a completed OI
      // response still receives a valid score from the public 24h rows.
      const oiBudget = new AbortController();
      const budgetTimer = setTimeout(() => oiBudget.abort(), OI_TOTAL_BUDGET_MS);
      try {
        await runPool(candidates, OI_CONCURRENCY, async (candidate) => {
          if (oiBudget.signal.aborted) return;
          try {
            const rows = await binanceJson(
              fetcher,
              "/futures/data/openInterestHist",
              { symbol: candidate.symbol, period: "1h", limit: OI_HISTORY_LIMIT },
              { signal: oiBudget.signal },
            );
            Object.assign(candidate, oiMetrics(rows));
          } catch {
            // OI is an optional component of the score. A failed request is
            // recorded as unavailable by its 0% effective OI weight below.
          }
        });
      } finally {
        clearTimeout(budgetTimer);
      }

      const value = {
        source: BROWSER_HEAT_SOURCE,
        sourceLabel: "Binance USDⓈ-M · 浏览器直连",
        fallback: true,
        asOf: now(),
        stale: false,
        universeSize: universe.length,
        candidateCount: candidates.length,
        resultLimit: RESULT_LIMIT,
        liquidityFloorUSDT: LIQUIDITY_FLOOR_USDT,
        weights: HEAT_WEIGHTS,
        items: rankBrowserContractHeat(candidates),
      };
      cache = { value, expiresAt: now() + CACHE_TTL_MS };
      return value;
    })();

    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  return load;
}

const loadBrowserContractHeat = createBrowserContractHeatLoader();

export function directBinanceContractHeat() {
  return loadBrowserContractHeat();
}

/**
 * Keep the last successful leaderboard snapshot in the browser.  The server
 * may also know a previous rank, but this gives a stable in-session movement
 * indicator even when serverless instances rotate.
 */
export function decorateContractHeatItems(items, previousRanks, hasSnapshot) {
  const source = Array.isArray(items) ? items : [];
  const nextRanks = new Map();

  const ranked = source.slice(0, 20).map((item, index) => {
    const rank = Number.isFinite(Number(item?.rank))
      ? Number(item.rank)
      : index + 1;
    const symbol = String(item?.symbol || "").toUpperCase();
    const previousRank = symbol ? previousRanks.get(symbol) : undefined;
    const existedBefore = hasSnapshot && Number.isFinite(previousRank);

    if (symbol) nextRanks.set(symbol, rank);

    return {
      ...item,
      rank,
      // The first response is intentionally neutral.  Calling every entry
      // “NEW” before this browser has seen a prior ranking is misleading.
      previousRank: existedBefore ? previousRank : null,
      rankChange: existedBefore ? previousRank - rank : null,
      isNew: hasSnapshot && Boolean(symbol) && !previousRanks.has(symbol),
      firstSnapshot: !hasSnapshot,
    };
  });

  return { items: ranked, nextRanks };
}
