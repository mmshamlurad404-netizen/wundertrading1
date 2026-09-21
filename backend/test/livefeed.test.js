import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBinanceTickers,
  parseWallexTickers,
  parseNobitexTickers,
  parseOmpfinexTickers,
  FEED_SOURCES,
  orderSources,
  LiveFeed,
  liveFeed,
} from '../src/liveFeed.js';
import { market } from '../src/market.js';

test('feed sources are ordered with Binance first', () => {
  assert.deepEqual(FEED_SOURCES, ['binance', 'wallex', 'nobitex', 'ompfinex']);
});

test('orderSources honors NT_FEED_PRIORITY and keeps every fallback', () => {
  assert.equal(orderSources(null)[0].id, 'binance');
  const ordered = orderSources('wallex, nobitex').map((s) => s.id);
  assert.deepEqual(ordered.slice(0, 2), ['wallex', 'nobitex']);
  assert.deepEqual([...ordered].sort(), ['binance', 'nobitex', 'ompfinex', 'wallex']);
  assert.equal(orderSources('made-up').length, 4);
});

test('parseBinanceTickers maps rows and skips bad prices', () => {
  const out = parseBinanceTickers([
    { symbol: 'BTCUSDT', lastPrice: '81000', priceChangePercent: '1.2', highPrice: '82000', lowPrice: '79000', quoteVolume: '123456' },
    { symbol: 'BADUSDT', lastPrice: '0' },
    { symbol: 'NOUSDT' },
  ]);
  assert.deepEqual(out.BTCUSDT, { price: 81000, change24h: 1.2, high24h: 82000, low24h: 79000, volume24h: 123456 });
  assert.equal(out.BADUSDT, undefined);
  assert.equal(out.NOUSDT, undefined);
});

test('parseWallexTickers reads stats fields', () => {
  const out = parseWallexTickers({
    BTCUSDT: { stats: { lastPrice: '80989.55', '24h_ch': -0.01, '24h_highPrice': '81400', '24h_lowPrice': '79800', '24h_quoteVolume': '1534877' } },
    BADUSDT: { stats: {} },
  });
  assert.deepEqual(out.BTCUSDT, { price: 80989.55, change24h: -0.01, high24h: 81400, low24h: 79800, volume24h: 1534877 });
  assert.equal(out.BADUSDT, undefined);
});

test('parseNobitexTickers normalizes dashed keys', () => {
  const out = parseNobitexTickers({
    'btc-usdt': { latest: '80951', dayChange: '-0.2', dayHigh: '81398.72', dayLow: '80000', volumeDst: '1270859' },
    'btc-rls': { latest: '185781146680' },
  });
  assert.equal(out.BTCUSDT.price, 80951);
  assert.equal(out.BTCUSDT.change24h, -0.2);
  assert.ok(out.BTCRLS, 'toman market is parsed too');
});

test('parseOmpfinexTickers reads currency ids and last price', () => {
  const out = parseOmpfinexTickers([
    { base_currency: { id: 'BTC' }, quote_currency: { id: 'USDT' }, last_price: '81116.1', day_change_percent: 0.02, last_volume: '1000' },
    { base_currency: { id: 'ETH' }, quote_currency: { id: 'IRR' }, last_price: '0' },
  ]);
  assert.deepEqual(out.BTCUSDT, { price: 81116.1, change24h: 0.02, volume24h: 1000 });
  assert.equal(out.ETHIRR, undefined);
});

test('parsers tolerate empty input', () => {
  assert.deepEqual(parseBinanceTickers(null), {});
  assert.deepEqual(parseWallexTickers(undefined), {});
  assert.deepEqual(parseNobitexTickers({}), {});
  assert.deepEqual(parseOmpfinexTickers([]), {});
});

test('poll merges sources and gives Binance priority', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body = {};
    if (u.includes('api.binance.com')) {
      body = [
        { symbol: 'BTCUSDT', lastPrice: '80000', priceChangePercent: '1', highPrice: '81000', lowPrice: '79000', quoteVolume: '1000' },
        { symbol: 'ETHUSDT', lastPrice: '3000', priceChangePercent: '2', highPrice: '3100', lowPrice: '2900', quoteVolume: '500' },
      ];
    } else if (u.includes('api.wallex.ir')) {
      body = { result: { symbols: { ETHUSDT: { stats: { lastPrice: '3999', '24h_ch': 9 } }, SOLUSDT: { stats: { lastPrice: '200', '24h_ch': 3 } } } } };
    } else if (u.includes('apiv2.nobitex.ir')) {
      body = { stats: { 'eth-usdt': { latest: '2222' }, 'btc-usdt': { latest: '5555' }, 'avax-usdt': { latest: '44' } } };
    } else if (u.includes('api.ompfinex.com')) {
      body = { data: [{ base_currency: { id: 'LINK' }, quote_currency: { id: 'USDT' }, last_price: '25.5', day_change_percent: 1 }] };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const ok = await liveFeed.poll();
    assert.equal(ok, true);
    assert.deepEqual(liveFeed.sources, ['binance', 'wallex', 'nobitex', 'ompfinex']);
    assert.deepEqual(liveFeed.available, ['binance', 'wallex', 'nobitex', 'ompfinex']);
    assert.equal(market.getPrice('BTC/USDT'), 80000, 'binance wins for BTC');
    assert.equal(market.getPrice('ETH/USDT'), 3000, 'binance wins over wallex/nobitex');
    assert.equal(market.getPrice('SOL/USDT'), 200, 'wallex fills SOL');
    assert.equal(market.getPrice('AVAX/USDT'), 44, 'nobitex fills AVAX');
    assert.equal(market.getPrice('LINK/USDT'), 25.5, 'ompfinex fills pairs binance omitted');
  } finally {
    globalThis.fetch = original;
  }
});

test('poll reports failure when every source is unreachable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const feed = new LiveFeed();
    const ok = await feed.poll();
    assert.equal(ok, false);
    assert.equal(feed.status().source, 'simulator');
  } finally {
    globalThis.fetch = original;
  }
});
