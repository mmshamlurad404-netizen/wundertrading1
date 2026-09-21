import test from 'node:test';
import assert from 'node:assert/strict';
import { market, generateCandles, TIMEFRAMES, PAIRS, PAIR_META } from '../src/market.js';

test('generateCandles is deterministic for a fixed end time', () => {
  const end = 1_700_000_000_000;
  const a = generateCandles('BTC/USDT', '1h', 50, end);
  const b = generateCandles('BTC/USDT', '1h', 50, end);
  assert.deepEqual(a, b);
});

test('generateCandles respects count and timeframe spacing', () => {
  const end = 1_700_000_000_000;
  const candles = generateCandles('ETH/USDT', '15m', 40, end);
  assert.equal(candles.length, 40);
  for (let i = 1; i < candles.length; i++) {
    assert.equal(candles[i].t - candles[i - 1].t, TIMEFRAMES['15m']);
  }
});

test('generateCandles produces valid OHLC values', () => {
  const candles = generateCandles('SOL/USDT', '1m', 120);
  for (const c of candles) {
    assert.ok(c.h >= Math.max(c.o, c.c), `high ${c.h} < body`);
    assert.ok(c.l <= Math.min(c.o, c.c), `low ${c.l} > body`);
    assert.ok(c.h >= c.l);
    assert.ok(c.c > 0 && c.v >= 0);
  }
});

test('generateCandles rejects unknown pairs and timeframes', () => {
  assert.throws(() => generateCandles('NOPE/USDT', '1h', 10), /unknown pair/);
  assert.throws(() => generateCandles('BTC/USDT', '2h', 10), /unknown timeframe/);
});

test('market exposes all 24 configured pairs with metadata', () => {
  assert.equal(market.listPairs().length, 24);
  assert.equal(PAIRS.length, 24);
  assert.ok(PAIR_META['BTC/USDT'].basePrice > 0);
});

test('market returns prices, candles and tickers', () => {
  for (const symbol of market.listPairs()) {
    const price = market.getPrice(symbol);
    assert.ok(Number.isFinite(price) && price > 0, `${symbol} price=${price}`);
    const ticker = market.getTicker(symbol);
    assert.equal(ticker.symbol, symbol);
    assert.ok(Number.isFinite(ticker.change24h));
    for (const tf of Object.keys(TIMEFRAMES)) {
      assert.ok(market.getCandles(symbol, tf, 200).length > 0, `${symbol} ${tf}`);
    }
  }
  assert.equal(market.getCandles('BTC/USDT', '1h', 25).length, 25);
  assert.equal(market.getPrice('NOPE/USDT'), null);
});

test('applyLivePrices overrides simulated price and stats', () => {
  const symbol = 'BTC/USDT';
  market.applyLivePrices({
    [symbol]: { price: 12345.6, change24h: 1.5, high24h: 13000, low24h: 11000, volume24h: 999 },
  });
  const t = market.getTicker(symbol);
  assert.equal(t.price, 12345.6);
  assert.equal(t.change24h, 1.5);
  assert.equal(t.high24h, 13000);
});

test('screener ranks every pair and assigns signal buckets', () => {
  const results = market.screener();
  assert.equal(results.length, 24);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score, 'not sorted desc');
  }
  for (const r of results) {
    assert.ok(['STRONG', 'WATCH', 'MILD', 'NEUTRAL'].includes(r.signal));
    assert.ok(Number.isFinite(r.volumeRatio));
  }
});
