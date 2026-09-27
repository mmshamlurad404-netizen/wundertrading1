import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exchangeSymbol,
  parseBinanceKlines,
  parseBinanceDepth,
  parseWallexDepth,
  parseNobitexDepth,
  parseBinanceFunding,
  parseBybitFunding,
  parseOkxFunding,
  MarketData,
} from '../src/marketData.js';
import { market } from '../src/market.js';

test('exchangeSymbol strips separators and uppercases', () => {
  assert.equal(exchangeSymbol('BTC/USDT'), 'BTCUSDT');
  assert.equal(exchangeSymbol('pepe/usdt'), 'PEPEUSDT');
});

test('parseBinanceKlines maps OHLCV rows', () => {
  const rows = [
    [1700000000000, '100', '110', '90', '105', '1234', 1700003599999],
    [1700003600000, '105', '115', '100', '112', '2000', 1700007199999],
  ];
  const candles = parseBinanceKlines(rows);
  assert.equal(candles.length, 2);
  assert.deepEqual(candles[0], { t: 1700000000000, o: 100, h: 110, l: 90, c: 105, v: 1234 });
  assert.equal(candles[1].c, 112);
});

test('parseBinanceKlines ignores malformed rows', () => {
  const candles = parseBinanceKlines([[1, '2'], null, {}, [3, '1', '2', '0.5', '1.5', '9']]);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].t, 3);
});

test('parseBinanceDepth and parseNobitexDepth normalize ladders', () => {
  const binance = parseBinanceDepth({
    bids: [['100', '2'], ['99', '3']],
    asks: [['101', '1.5'], ['102', '0']],
  });
  assert.deepEqual(binance.bids, [{ price: 100, size: 2 }, { price: 99, size: 3 }]);
  assert.deepEqual(binance.asks, [{ price: 101, size: 1.5 }]);

  const nobitex = parseNobitexDepth({ bids: [['50', '4']], asks: [['51', '5']] });
  assert.deepEqual(nobitex.bids, [{ price: 50, size: 4 }]);
  assert.deepEqual(nobitex.asks, [{ price: 51, size: 5 }]);
});

test('parseWallexDepth reads result.bid/ask objects', () => {
  const book = parseWallexDepth({
    result: { bid: [{ price: '10', quantity: '1' }], ask: [{ price: '11', quantity: '2' }] },
  });
  assert.deepEqual(book.bids, [{ price: 10, size: 1 }]);
  assert.deepEqual(book.asks, [{ price: 11, size: 2 }]);
});

test('funding parsers extract rates from each venue', () => {
  assert.deepEqual(parseBinanceFunding([{ symbol: 'BTCUSDT', lastFundingRate: '0.0001' }]), {
    BTCUSDT: 0.0001,
  });
  assert.deepEqual(
    parseBybitFunding({ result: { list: [{ symbol: 'ETHUSDT', fundingRate: '0.0002' }] } }),
    { ETHUSDT: 0.0002 }
  );
  assert.deepEqual(parseOkxFunding({ data: [{ instId: 'SOL-USDT-SWAP', fundingRate: '0.0003' }] }), {
    SOLUSDT: 0.0003,
  });
});

test('MarketData is offline and returns null when NT_LIVE_MARKET=0', async () => {
  const md = new MarketData();
  assert.equal(md.enabled, false);
  assert.equal(await md.getCandles('BTC/USDT', '1h', 10), null);
  assert.equal(await md.getOrderBook('BTC/USDT', 10), null);
  assert.equal(md.fundingRate('BTC/USDT'), null);
  assert.equal(await md.refreshFunding(), false);
});

test('warm is a no-op while live market data is disabled', async () => {
  const md = new MarketData();
  assert.equal(await md.warm({ pairs: ['BTC/USDT'], timeframes: ['1h'] }), 0);
});

test('warm fetches klines and publishes them into the market engine', async () => {
  const md = new MarketData();
  md.enabled = true;
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 5 }, (_, i) => [
    1700000000000 + i * 3600000,
    '100',
    '110',
    '90',
    String(100 + i),
    '1234',
  ]);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => rows });
  try {
    const warmed = await md.warm({ pairs: ['BTC/USDT'], timeframes: ['1h'], concurrency: 1 });
    assert.equal(warmed, 1);
    const candles = market.getCandles('BTC/USDT', '1h', 5);
    assert.equal(candles.length, 5);
    assert.equal(candles[candles.length - 1].c, 104);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
