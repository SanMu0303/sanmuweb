import test from 'node:test';
import assert from 'node:assert/strict';
import {createSignalDeskMarket} from '../server/signal-desk-market.mjs';

function fallbackFetcher(input) {
  const url = new URL(String(input));
  if (url.hostname === 'fapi.binance.com') return new Response('regional upstream unavailable', {status: 503});
  if (url.hostname !== 'api.bybit.com') throw new Error(`unexpected host ${url.hostname}`);

  if (url.pathname === '/v5/market/kline') {
    return Response.json({retCode: 0, retMsg: 'OK', result: {list: [
      ['1725000900000', '108', '116', '106', '112', '24', '2650'],
      ['1725000000000', '100', '112', '96', '108', '42', '4400'],
    ]}});
  }

  if (url.pathname === '/v5/market/instruments-info') {
    return Response.json({retCode: 0, retMsg: 'OK', result: {list: [
      {symbol: 'BTCUSDT', status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDT', settleCoin: 'USDT', baseCoin: 'BTC'},
      {symbol: 'ETHUSDT', status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDT', settleCoin: 'USDT', baseCoin: 'ETH'},
      {symbol: 'BTCUSDC', status: 'Trading', contractType: 'LinearPerpetual', quoteCoin: 'USDC', settleCoin: 'USDC', baseCoin: 'BTC'},
    ]}});
  }

  throw new Error(`unexpected path ${url.pathname}`);
}

test('signal desk keeps the original K-line response shape and returns ascending seconds after Binance to Bybit fallback', async () => {
  const market = createSignalDeskMarket({fetcher: fallbackFetcher, now: () => 1_725_001_000_000});
  const result = await market.klines({symbol: 'BTCUSDT', timeframe: '15m'});

  assert.equal(result.meta.source, 'bybit-linear');
  assert.equal(result.meta.fallback, true);
  assert.deepEqual(result.value, [
    {time: 1_725_000_000, open: 100, high: 112, low: 96, close: 108, volume: 42},
    {time: 1_725_000_900, open: 108, high: 116, low: 106, close: 112, volume: 24},
  ]);
  assert.deepEqual(Object.keys(result.value[0]), ['time', 'open', 'high', 'low', 'close', 'volume']);
});

test('signal desk keeps the original contracts array shape and exposes fallback source metadata', async () => {
  const market = createSignalDeskMarket({fetcher: fallbackFetcher});
  const result = await market.contracts();

  assert.equal(result.meta.source, 'bybit-linear');
  assert.equal(result.meta.sourceLabel, 'Bybit USDT Linear');
  assert.equal(result.meta.fallback, true);
  assert.deepEqual(result.meta.degraded, ['fallback_catalog_crypto_only']);
  assert.deepEqual(result.value, [
    {symbol: 'BTCUSDT', market: 'Crypto', name: 'BTC', contractType: 'PERPETUAL', underlyingType: null},
    {symbol: 'ETHUSDT', market: 'Crypto', name: 'ETH', contractType: 'PERPETUAL', underlyingType: null},
  ]);
});

test('signal desk can request a small direct Binance USDⓈ-M K-line window without a fallback', async () => {
  let requestedLimit = null;
  const market = createSignalDeskMarket({
    fetcher(input) {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'fapi.binance.com');
      assert.equal(url.pathname, '/fapi/v1/klines');
      requestedLimit = url.searchParams.get('limit');
      return Response.json([
        ["1725000000000", "100", "102", "99", "101", "11"],
        ["1725000900000", "101", "103", "100", "102", "12"],
      ]);
    },
  });

  const result = await market.klines({
    source: 'binance-usdm',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    limit: 2,
    fresh: true,
  });

  assert.equal(requestedLimit, '2');
  assert.equal(result.meta.source, 'binance-usdm');
  assert.equal(result.meta.fallback, false);
  assert.equal(result.value.length, 2);
  assert.equal(result.value.at(-1).close, 102);
});

test('Binance OI history paginates and returns OI on the same opening-time axis as K lines', async () => {
  const start = 1_728_000_000; // exact 15-minute Unix boundary
  const step = 900;
  const end = start + 600 * step;
  const pageOne = Array.from({length: 500}, (_, offset) => {
    const index = offset + 101;
    return {
      // Binance documents this as a period-end timestamp. `-1` models the
      // common inclusive end-of-period shape and must still map to `index`.
      timestamp: String((start + (index + 1) * step) * 1_000 - 1),
      sumOpenInterest: String(index),
    };
  });
  const pageTwo = Array.from({length: 101}, (_, index) => ({
    timestamp: String((start + (index + 1) * step) * 1_000 - 1),
    sumOpenInterest: String(index),
  }));
  const requestedEnds = [];
  const market = createSignalDeskMarket({
    now: () => (end + step + 60) * 1_000,
    fetcher(input) {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'fapi.binance.com');
      assert.equal(url.pathname, '/futures/data/openInterestHist');
      assert.equal(url.searchParams.get('period'), '15m');
      assert.equal(url.searchParams.get('limit'), '500');
      requestedEnds.push(Number(url.searchParams.get('endTime')));
      if (requestedEnds.length === 1) return Response.json(pageOne);
      if (requestedEnds.length === 2) return Response.json(pageTwo);
      return Response.json([]);
    },
  });

  const result = await market.oiHistory({
    source: 'binance-usdm',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    from: start,
    to: end,
  });

  assert.ok(requestedEnds.length >= 2, 'more than 500 records must request an earlier page');
  assert.equal(requestedEnds[0], (end + step) * 1_000 - 1, 'include the final displayed K line’s period end');
  assert.equal(result.meta.source, 'binance-usdm');
  assert.equal(result.value.length, 601);
  assert.deepEqual(result.value[0], {time: start, value: 0});
  assert.deepEqual(result.value.at(-1), {time: end, value: 600});
  assert.equal(result.value.every((point, index) => point.time === start + index * step), true);
});

test('contract heat returns a bounded Binance USDⓈ-M Top 20 and records a real rank change after its snapshot expires', async () => {
  let time = 1_728_000_000_000;
  let pass = 1;
  const oiRequests = [];
  const symbols = Array.from({length: 21}, (_, index) => `T${String(index + 1).padStart(2, '0')}USDT`);
  const market = createSignalDeskMarket({
    now: () => time,
    fetcher(input) {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'fapi.binance.com');
      if (url.pathname === '/fapi/v1/exchangeInfo') {
        return Response.json({symbols: symbols.map(symbol => ({
          symbol, status: 'TRADING', quoteAsset: 'USDT', marginAsset: 'USDT', contractType: 'PERPETUAL', baseAsset: symbol.slice(0, -4),
        }))});
      }
      if (url.pathname === '/fapi/v1/ticker/24hr') {
        return Response.json(symbols.map((symbol, index) => {
          const number = index + 1;
          const quoteVolume = pass === 2 && number === 21 ? 100_000_000 : (50 - number) * 1_000_000;
          return {
            symbol, lastPrice: '1', priceChangePercent: '1', quoteVolume: String(quoteVolume), volume: '1000',
            count: String(pass === 2 && number === 21 ? 50_000 : 10_000 - number), highPrice: '1.05', lowPrice: '0.95',
          };
        }));
      }
      if (url.pathname === '/futures/data/openInterestHist') {
        oiRequests.push(url);
        const symbol = url.searchParams.get('symbol');
        if (symbol === 'T10USDT') return new Response('temporarily unavailable', {status: 503});
        return Response.json(Array.from({length: 6}, (_, index) => ({
          timestamp: String((time - (5 - index) * 3_600_000)),
          sumOpenInterestValue: '1000000',
        })));
      }
      throw new Error(`unexpected path ${url.pathname}`);
    },
  });

  const first = await market.contractHeat({source: 'binance-usdm'});
  assert.equal(first.meta.source, 'binance-usdm');
  assert.equal(first.value.items.length, 20);
  assert.equal(first.value.items[0].symbol, 'T01USDT');
  assert.equal(first.value.items.at(-1).symbol, 'T20USDT');
  assert.equal(first.value.items.every((item, index) => item.rank === index + 1), true);
  assert.equal(first.value.items.every(item => item.firstSnapshot === true), true);
  assert.equal(first.value.items.find(item => item.symbol === 'T10USDT').components.effectiveWeights.oi, 0, 'one failed OI query must only reweight its own score');
  assert.ok(oiRequests.length >= 21);
  assert.equal(oiRequests[0].searchParams.get('period'), '1h');
  assert.equal(oiRequests[0].searchParams.get('limit'), '6');

  pass = 2;
  time += 91_000;
  const second = await market.contractHeat({source: 'binance-usdm'});
  assert.equal(second.value.items.length, 20);
  assert.equal(second.value.items[0].symbol, 'T21USDT');
  assert.equal(second.value.items[0].isNew, true);
  assert.equal(second.value.items[1].symbol, 'T01USDT');
  assert.equal(second.value.items[1].rankChange, -1);
  assert.equal(second.value.items[1].firstSnapshot, false);
});

test('contract heat rejects a non-Binance source instead of relabeling another exchange as Binance heat', async () => {
  const market = createSignalDeskMarket({fetcher: fallbackFetcher});
  await assert.rejects(
    () => market.contractHeat({source: 'bybit-linear'}),
    error => error?.status === 400 && error?.code === 'heat_source_not_supported',
  );
});
