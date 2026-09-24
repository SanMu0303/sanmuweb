import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerminalMarket} from '../server/terminal-market.mjs';

const candle = [1_725_000_000_000, '100', '112', '96', '108', '42', 1_725_000_899_999];

function fixtureFetcher({historyStatus = 200} = {}) {
  return async input => {
    const url = new URL(String(input));
    const symbol = url.searchParams.get('symbol');
    if (url.pathname === '/fapi/v1/klines') return Response.json([candle]);
    if (url.pathname === '/fapi/v1/ticker/24hr' && symbol) return Response.json({symbol, lastPrice: '108', priceChangePercent: '3.2', quoteVolume: '25000000', volume: '231481', highPrice: '114', lowPrice: '96'});
    if (url.pathname === '/fapi/v1/ticker/24hr') return Response.json([
      {symbol: 'ETHUSDT', lastPrice: '3000', priceChangePercent: '-1.1', quoteVolume: '10000000', volume: '3333', highPrice: '3100', lowPrice: '2900'},
      {symbol: 'BTCUSDT', lastPrice: '108', priceChangePercent: '3.2', quoteVolume: '25000000', volume: '231481', highPrice: '114', lowPrice: '96'},
      {symbol: 'NOTUSDC', lastPrice: '1', quoteVolume: '999999999'},
    ]);
    if (url.pathname === '/fapi/v1/premiumIndex') return Response.json({markPrice: '107.5', lastFundingRate: '0.0001', nextFundingTime: '1725003600000'});
    if (url.pathname === '/fapi/v1/openInterest') return Response.json({symbol, openInterest: '1234.5', time: '1725000000000'});
    if (url.pathname === '/futures/data/openInterestHist') return new Response(historyStatus === 200 ? JSON.stringify([{timestamp: '1724999100000', sumOpenInterest: '1200', sumOpenInterestValue: '129000'}]) : 'upstream unavailable', {status: historyStatus, headers: {'Content-Type': 'application/json'}});
    if (url.pathname === '/fapi/v1/exchangeInfo') return Response.json({symbols: [
      {symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', contractType: 'PERPETUAL', status: 'TRADING'},
      {symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL', status: 'TRADING'},
      {symbol: 'BTCUSD_240628', baseAsset: 'BTC', quoteAsset: 'USD', contractType: 'CURRENT_QUARTER', status: 'TRADING'},
    ]});
    throw new Error(`unexpected path ${url.pathname}`);
  };
}

test('terminal market validates the allowed Binance perpetual symbol and K-line inputs', async () => {
  const market = createTerminalMarket({fetcher: fixtureFetcher()});
  await assert.rejects(market.candles({symbol: 'BTCUSDC', interval: '15m'}), {message: '交易对格式不正确'});
  await assert.rejects(market.candles({symbol: 'BTCUSDT', interval: '13m'}), {message: 'K 线周期不支持'});
  await assert.rejects(market.candles({symbol: 'BTCUSDT', interval: '15m', endTime: '123'}), {message: '历史时间不正确'});
});

test('snapshot normalizes real fields, keeps chart data when optional OI history fails, and ranks only USDT perpetual symbols', async () => {
  const market = createTerminalMarket({fetcher: fixtureFetcher({historyStatus: 503}), now: () => 1_725_000_000_000});
  const snapshot = await market.snapshot({symbol: 'btcusdt', interval: '15m', limit: 10});
  assert.equal(snapshot.symbol, 'BTCUSDT');
  assert.equal(snapshot.interval, '15m');
  assert.deepEqual(snapshot.candles[0], {time: 1_725_000_000_000, open: 100, high: 112, low: 96, close: 108, volume: 42, closeTime: 1_725_000_899_999});
  assert.equal(snapshot.ticker.quoteVolume, 25_000_000);
  assert.equal(snapshot.mark.markPrice, 107.5);
  assert.equal(snapshot.currentOi.openInterest, 1234.5);
  assert.equal(snapshot.available.oiHistory, false);
  assert.equal(snapshot.rank, 1);
  assert.deepEqual(snapshot.topByVolume.map(item => item.symbol), ['BTCUSDT', 'ETHUSDT']);
});

test('429 is preserved for callers so the client can back off instead of reporting an upstream outage', async () => {
  const market = createTerminalMarket({fetcher: async () => new Response('slow down', {status: 429})});
  await assert.rejects(market.openInterest({symbol: 'BTCUSDT'}), error => error?.status === 429 && error.message.includes('频率'));
});

test('catalog shares a bounded cache and only returns active USDT perpetual contracts', async () => {
  let calls = 0;
  let clock = 1_725_000_000_000;
  const fetcher = async input => {
    calls += 1;
    return fixtureFetcher()(input);
  };
  const market = createTerminalMarket({fetcher, now: () => clock});
  const first = await market.catalog();
  const second = await market.catalog();
  assert.equal(calls, 1);
  assert.deepEqual(first.symbols.map(item => item.symbol), ['BTCUSDT', 'ETHUSDT']);
  assert.deepEqual(second.symbols, first.symbols);
  clock += 60_001;
  await market.catalog();
  assert.equal(calls, 2);
});

function bybitFallbackFetcher(input) {
  const url = new URL(String(input));
  if (url.hostname === 'fapi.binance.com') return new Response('upstream unavailable', {status: 503});
  if (url.hostname !== 'api.bybit.com') throw new Error(`unexpected host ${url.hostname}`);
  const ok = result => Response.json({retCode: 0, retMsg: 'OK', result});
  if (url.pathname === '/v5/market/kline') return ok({list: [
    ['1725000900000', '108', '116', '106', '112', '24', '2650'],
    ['1725000000000', '100', '112', '96', '108', '42', '4400'],
  ]});
  if (url.pathname === '/v5/market/open-interest') return ok({list: [
    {timestamp: '1725000900000', openInterest: '1250'},
    {timestamp: '1725000000000', openInterest: '1200'},
  ]});
  if (url.pathname === '/v5/market/tickers' && url.searchParams.get('symbol')) return ok({list: [{
    symbol: 'BTCUSDT', lastPrice: '112', price24hPcnt: '0.025', turnover24h: '30000000', volume24h: '271000', highPrice24h: '116', lowPrice24h: '96', markPrice: '111.8', fundingRate: '0.0001', nextFundingTime: '1725003600000', openInterest: '1250',
  }]});
  if (url.pathname === '/v5/market/tickers') return ok({list: [
    {symbol: 'ETHUSDT', lastPrice: '3000', price24hPcnt: '-0.01', turnover24h: '12000000', volume24h: '4000', highPrice24h: '3100', lowPrice24h: '2950'},
    {symbol: 'BTCUSDT', lastPrice: '112', price24hPcnt: '0.025', turnover24h: '30000000', volume24h: '271000', highPrice24h: '116', lowPrice24h: '96'},
  ]});
  throw new Error(`unexpected Bybit path ${url.pathname}`);
}

test('falls back to Bybit linear data only after a recoverable Binance outage and labels the response truthfully', async () => {
  const market = createTerminalMarket({fetcher: bybitFallbackFetcher, now: () => 1_725_001_000_000});
  const snapshot = await market.snapshot({symbol: 'BTCUSDT', interval: '15m', limit: 10});
  assert.equal(snapshot.source, 'bybit-linear');
  assert.equal(snapshot.interval, '15m');
  assert.equal(snapshot.sourceInterval, '15m');
  assert.equal(snapshot.ticker.priceChangePercent, 2.5);
  assert.equal(snapshot.ticker.quoteVolume, 30_000_000);
  assert.deepEqual(snapshot.candles.map(item => item.time), [1_725_000_000_000, 1_725_000_900_000]);
  assert.equal(snapshot.oiHistory[0].value, null);
  assert.equal(snapshot.rank, 1);

  const mapped = await market.candles({symbol: 'BTCUSDT', interval: '8h'});
  assert.equal(mapped.source, 'bybit-linear');
  assert.equal(mapped.interval, '8h');
  assert.equal(mapped.sourceInterval, '4h');
});
