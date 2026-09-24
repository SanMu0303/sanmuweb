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
