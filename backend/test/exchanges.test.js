import test from 'node:test';
import assert from 'node:assert/strict';
import { hmacSha256Hex, hmacSha256Base64 } from '../src/exchanges/sign.js';
import { binance } from '../src/exchanges/binance.js';
import { bybit } from '../src/exchanges/bybit.js';
import { okx } from '../src/exchanges/okx.js';
import { nobitex } from '../src/exchanges/nobitex.js';
import { wallex } from '../src/exchanges/wallex.js';
import { tabdeal } from '../src/exchanges/tabdeal.js';
import { bitpin } from '../src/exchanges/bitpin.js';
import { ompfinex } from '../src/exchanges/ompfinex.js';
import { abantether } from '../src/exchanges/abantether.js';
import { isLiveCapable, testExchangeConnection } from '../src/exchanges/index.js';

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    const res = (await handler(u, options)) || {};
    const status = res.status ?? 200;
    const body = res.body ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return calls;
}

function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body));
}

const creds = { apiKey: 'KEY123', apiSecret: 'SECRET456', passphrase: 'PASS' };

test('exSymbol mappings match each venue convention', () => {
  assert.equal(binance.exSymbol('BTC/USDT'), 'BTCUSDT');
  assert.equal(bybit.exSymbol('BTC/USDT'), 'BTCUSDT');
  assert.equal(okx.exSymbol('BTC/USDT', 'spot'), 'BTC-USDT');
  assert.equal(okx.exSymbol('BTC/USDT', 'futures'), 'BTC-USDT-SWAP');
  assert.equal(nobitex.exSymbol('BTC/USDT'), 'BTCUSDT');
  assert.equal(wallex.exSymbol('BTC/USDT'), 'BTCUSDT');
  assert.equal(tabdeal.exSymbol('BTC/USDT'), 'BTCUSDT');
  assert.equal(bitpin.exSymbol('BTC/USDT'), 'BTC_USDT');
  assert.equal(ompfinex.exSymbol('BTC/USDT'), 'BTCUSDT');
  assert.equal(abantether.exSymbol('BTC/USDT'), 'BTCUSDT');
});

test('binance futures market order is signed and shaped correctly', async () => {
  const calls = installFetch((url) => {
    if (url.includes('/time')) return { body: { serverTime: Date.now() } };
    if (url.includes('/fapi/v1/order')) {
      return { body: { orderId: 123, executedQty: '0.5', avgPrice: '60000', status: 'FILLED', cumQuote: '30000' } };
    }
    return { status: 404, body: {} };
  });

  const out = await binance.placeOrder(
    creds,
    { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5, reduceOnly: true },
    { marketType: 'futures' }
  );

  const orderCall = calls.find((c) => c.url.includes('/fapi/v1/order'));
  assert.ok(orderCall, 'order request was sent');
  assert.equal(orderCall.options.method, 'POST');
  assert.equal(orderCall.options.headers['X-MBX-APIKEY'], creds.apiKey);

  const body = orderCall.options.body;
  const query = body.slice(0, body.lastIndexOf('&signature='));
  const params = parseForm(body);
  assert.equal(params.symbol, 'BTCUSDT');
  assert.equal(params.side, 'BUY');
  assert.equal(params.type, 'MARKET');
  assert.equal(params.quantity, '0.5');
  assert.equal(params.reduceOnly, 'true');
  assert.equal(params.signature, hmacSha256Hex(creds.apiSecret, query));

  assert.equal(out.orderId, '123');
  assert.equal(out.fillPrice, 60000);
  assert.equal(out.qty, 0.5);
});

test('binance spot market buy uses quoteOrderQty', async () => {
  const calls = installFetch((url) => {
    if (url.includes('/time')) return { body: { serverTime: Date.now() } };
    return { body: { orderId: 9, executedQty: '0.0016', fills: [{ qty: '0.0016', price: '60000' }], status: 'FILLED' } };
  });
  await binance.placeOrder(
    creds,
    { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.0016, notional: 100 },
    { marketType: 'spot' }
  );
  const call = calls.find((c) => c.url.includes('/api/v3/order'));
  const params = parseForm(call.options.body);
  assert.equal(params.quoteOrderQty, '100');
  assert.equal(params.quantity, undefined);
  assert.equal(params.newOrderRespType, 'FULL');
});

test('bybit signs timestamp + key + recvWindow + body', async () => {
  const calls = installFetch((url) => {
    if (url.includes('/v5/order/create')) return { body: { retCode: 0, result: { orderId: 'by1' } } };
    if (url.includes('/v5/order/realtime')) return { body: { retCode: 0, result: { list: [{ avgPrice: '60000', cumExecQty: '0.5' }] } } };
    return { status: 404, body: {} };
  });

  const out = await bybit.placeOrder(creds, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5 }, { marketType: 'futures' });
  const call = calls.find((c) => c.url.includes('/v5/order/create'));
  const bodyString = call.options.body;
  const h = call.options.headers;
  const expected = hmacSha256Hex(creds.apiSecret, `${h['X-BAPI-TIMESTAMP']}${creds.apiKey}${h['X-BAPI-RECV-WINDOW']}${bodyString}`);
  assert.equal(h['X-BAPI-SIGN'], expected);
  assert.equal(h['X-BAPI-API-KEY'], creds.apiKey);
  const json = JSON.parse(bodyString);
  assert.equal(json.category, 'linear');
  assert.equal(json.symbol, 'BTCUSDT');
  assert.equal(json.side, 'Buy');
  assert.equal(out.orderId, 'by1');
  assert.equal(out.fillPrice, 60000);
});

test('okx signs timestamp + method + path + body', async () => {
  const calls = installFetch((url) => {
    if (url.includes('/public/instruments')) return { body: { code: '0', data: [{ ctVal: '1' }] } };
    if (url.includes('/trade/order') && !url.includes('ordId=')) return { body: { code: '0', data: [{ ordId: 'ok1' }] } };
    if (url.includes('/trade/order?instId=')) return { body: { code: '0', data: [{ avgPx: '60000' }] } };
    return { status: 404, body: {} };
  });

  await okx.placeOrder(creds, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5 }, { marketType: 'futures' });
  const call = calls.find((c) => c.url.endsWith('/api/v5/trade/order'));
  const h = call.options.headers;
  const bodyString = call.options.body;
  const expected = hmacSha256Base64(creds.apiSecret, `${h['OK-ACCESS-TIMESTAMP']}POST/api/v5/trade/order${bodyString}`);
  assert.equal(h['OK-ACCESS-SIGN'], expected);
  assert.equal(h['OK-ACCESS-PASSPHRASE'], creds.passphrase);
  const json = JSON.parse(bodyString);
  assert.equal(json.instId, 'BTC-USDT-SWAP');
  assert.equal(json.side, 'buy');
  assert.equal(json.ordType, 'market');
  assert.equal(json.tdMode, 'cross');
});

test('nobitex market buy sends the quote amount with token auth', async () => {
  const calls = installFetch(() => ({ body: { status: 'ok', order: { id: 5, price: 60000, amount: 0.0016, status: 'active' } } }));
  const out = await nobitex.placeOrder({ apiKey: 'TOK' }, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.0016, notional: 100 });
  const call = calls.find((c) => c.url.includes('/market/orders/add'));
  assert.equal(call.options.headers.Authorization, 'Token TOK');
  const json = JSON.parse(call.options.body);
  assert.deepEqual(json, { type: 'buy', srcCurrency: 'btc', dstCurrency: 'usdt', execution: 'market', amount: '100' });
  assert.equal(out.orderId, '5');
  assert.equal(out.fillPrice, 60000);
});

test('wallex posts a JSON order with x-api-key', async () => {
  const calls = installFetch(() => ({ body: { success: true, result: { id: 'w1', price: 60000, quantity: 0.5, status: 'active' } } }));
  const out = await wallex.placeOrder({ apiKey: 'WK' }, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5 });
  const call = calls.find((c) => c.url.includes('/v1/account/orders'));
  assert.equal(call.options.headers['x-api-key'], 'WK');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.5' });
  assert.equal(out.orderId, 'w1');
});

test('tabdeal signs the query and posts the order', async () => {
  const calls = installFetch(() => ({ body: { orderId: 't1', price: 60000, executedQty: 0.5, status: 'FILLED' } }));
  await tabdeal.placeOrder(creds, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5 });
  const call = calls.find((c) => c.url.includes('/api/v1/order'));
  assert.equal(call.options.headers['X-MBX-APIKEY'], creds.apiKey);
  const url = call.url;
  const query = url.slice(url.indexOf('?') + 1, url.lastIndexOf('&signature='));
  const sig = url.slice(url.lastIndexOf('&signature=') + '&signature='.length);
  assert.equal(sig, hmacSha256Hex(creds.apiSecret, query));
  const params = new URLSearchParams(query);
  assert.equal(params.get('symbol'), 'BTCUSDT');
  assert.equal(params.get('side'), 'BUY');
  assert.equal(params.get('quantity'), '0.5');
});

test('bitpin posts base_amount with Api-Key auth', async () => {
  const calls = installFetch(() => ({ body: { id: 'b1', price: 60000, base_amount: 0.5, status: 'active' } }));
  const out = await bitpin.placeOrder({ apiKey: 'BK' }, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5 });
  const call = calls.find((c) => c.url.includes('/api/v1/odr/orders/'));
  assert.equal(call.options.headers.Authorization, 'Api-Key BK');
  assert.deepEqual(JSON.parse(call.options.body), { symbol: 'BTC_USDT', type: 'market', side: 'buy', base_amount: '0.5' });
  assert.equal(out.orderId, 'b1');
});

test('ompfinex resolves the market id then places the order', async () => {
  const calls = installFetch((url) => {
    if (url.endsWith('/v1/market/')) {
      return { body: { data: [{ id: 7, base_currency: { id: 'BTC' }, quote_currency: { id: 'USDT' } }] } };
    }
    if (url.includes('/v1/market/7/order')) {
      return { body: { data: { id: 'o1', price: 60000, amount: 0.5, status: 'active' } } };
    }
    return { status: 404, body: {} };
  });
  const out = await ompfinex.placeOrder({ apiKey: 'OT' }, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5 });
  const call = calls.find((c) => c.url.includes('/v1/market/7/order'));
  assert.equal(call.options.headers.Authorization, 'Bearer OT');
  assert.deepEqual(JSON.parse(call.options.body), { market_id: 7, type: 'buy', execution: 'MARKET', amount: '0.5' });
  assert.equal(out.orderId, 'o1');
});

test('abantether posts an OTC market order', async () => {
  const calls = installFetch(() => ({ body: { data: { id: 'a1', price: 60000, volume: 0.5, status: 'active' } } }));
  const out = await abantether.placeOrder({ apiKey: 'AK' }, { symbol: 'BTC/USDT', side: 'buy', type: 'market', qty: 0.5 });
  const call = calls.find((c) => c.url.includes('/order_handler/orders/otc/market'));
  assert.equal(call.options.headers.Authorization, 'AK');
  assert.deepEqual(JSON.parse(call.options.body), { side: 'buy', base_symbol: 'BTC', quote_symbol: 'USDT', volume: '0.5' });
  assert.equal(out.orderId, 'a1');
});

test('live capability registry rejects unsupported venues', async () => {
  assert.equal(isLiveCapable('binance'), true);
  assert.equal(isLiveCapable('nobitex'), true);
  assert.equal(isLiveCapable('kraken'), false);
  await assert.rejects(() => testExchangeConnection('kraken', creds), /not supported/);
});
