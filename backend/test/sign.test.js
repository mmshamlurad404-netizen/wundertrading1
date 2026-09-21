import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  hmacSha256Hex,
  hmacSha256Base64,
  urlEncode,
  roundQty,
  toFixedTrim,
  splitPair,
  ExchangeError,
  httpJson,
} from '../src/exchanges/sign.js';

test('hmacSha256Hex matches node crypto', () => {
  const payload = 'symbol=BTCUSDT&side=BUY&timestamp=1700000000000';
  const expected = crypto.createHmac('sha256', 'secret').update(payload).digest('hex');
  assert.equal(hmacSha256Hex('secret', payload), expected);
});

test('hmacSha256Base64 matches node crypto', () => {
  const payload = '2024-01-01T00:00:00.000ZGET/api/v5/account/balance';
  const expected = crypto.createHmac('sha256', 'secret').update(payload).digest('base64');
  assert.equal(hmacSha256Base64('secret', payload), expected);
});

test('urlEncode filters empty values and encodes', () => {
  const q = urlEncode({ a: 1, b: undefined, c: '', d: 'x y', e: null });
  assert.equal(q, 'a=1&d=x%20y');
});

test('roundQty floors to the given step', () => {
  assert.equal(roundQty(1.23456, 0.001), 1.234);
  assert.equal(roundQty(0.0000009), 0);
  assert.equal(roundQty(12.5), 12.5);
});

test('toFixedTrim trims trailing zeros', () => {
  assert.equal(toFixedTrim(1.5), '1.5');
  assert.equal(toFixedTrim(2), '2');
  assert.equal(toFixedTrim(0.1, 8), '0.1');
  assert.equal(toFixedTrim(Number.NaN), '0');
});

test('splitPair splits base and quote', () => {
  assert.deepEqual(splitPair('BTC/USDT'), { base: 'BTC', quote: 'USDT' });
});

test('ExchangeError carries metadata', () => {
  const err = new ExchangeError('boom', { exchange: 'binance', status: 400, code: -1121, body: { x: 1 } });
  assert.equal(err.name, 'ExchangeError');
  assert.equal(err.exchange, 'binance');
  assert.equal(err.status, 400);
  assert.equal(err.code, -1121);
  assert.deepEqual(err.body, { x: 1 });
});

test('httpJson parses JSON and reports non-2xx', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: url.endsWith('/ok'),
    status: url.endsWith('/ok') ? 200 : 500,
    text: async () => JSON.stringify({ url }),
  });
  try {
    const good = await httpJson('https://x/ok');
    assert.equal(good.ok, true);
    assert.deepEqual(good.data, { url: 'https://x/ok' });
    const bad = await httpJson('https://x/bad');
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 500);
  } finally {
    globalThis.fetch = original;
  }
});

test('httpJson times out slow requests', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  try {
    await assert.rejects(() => httpJson('https://x/slow', { timeout: 20 }), /aborted/);
  } finally {
    globalThis.fetch = original;
  }
});
