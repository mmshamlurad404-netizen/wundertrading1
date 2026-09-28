import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  PRIVATE_STREAM_EXCHANGES,
  bybitPrivateUrl,
  okxPrivateUrl,
  bybitAuthFrame,
  bybitSubscribeFrame,
  okxLoginFrame,
  okxSubscribeFrame,
  normalizeBybitEvent,
  normalizeOkxEvent,
  normalizePrivateEvent,
} from '../src/exchanges/privateStream.js';

test('private stream exchanges cover binance, bybit and okx', () => {
  assert.deepEqual(PRIVATE_STREAM_EXCHANGES, ['binance', 'bybit', 'okx']);
});

test('bybit private url switches between mainnet and testnet', () => {
  assert.equal(bybitPrivateUrl(), 'wss://stream.bybit.com/v5/private');
  assert.equal(bybitPrivateUrl({ testnet: true }), 'wss://stream-testnet.bybit.com/v5/private');
});

test('okx private url switches between mainnet and demo', () => {
  assert.equal(okxPrivateUrl(), 'wss://ws.okx.com:8443/ws/v5/private');
  assert.match(okxPrivateUrl({ testnet: true }), /^wss:\/\/wspap\.okx\.com:8443\/ws\/v5\/private\?brokerId=/);
});

test('bybit auth frame signs GET/realtime{expires} with the secret', () => {
  const now = 1_700_000_000_000;
  const creds = { apiKey: 'key-1', apiSecret: 'secret-1' };
  const frame = bybitAuthFrame(creds, { now });
  assert.equal(frame.op, 'auth');
  assert.equal(frame.args[0], 'key-1');
  assert.equal(frame.args[1], now + 1000);
  const expected = crypto
    .createHmac('sha256', 'secret-1')
    .update(`GET/realtime${now + 1000}`)
    .digest('hex');
  assert.equal(frame.args[2], expected);

  const other = bybitAuthFrame({ apiKey: 'key-1', apiSecret: 'secret-2' }, { now });
  assert.notEqual(other.args[2], frame.args[2]);
  assert.deepEqual(bybitSubscribeFrame(), { op: 'subscribe', args: ['order', 'execution', 'wallet'] });
});

test('okx login frame signs {timestamp}GET/users/self/verify in base64', () => {
  const now = 1_700_000_000_000;
  const creds = { apiKey: 'key-1', apiSecret: 'secret-1', passphrase: 'pw' };
  const frame = okxLoginFrame(creds, { now });
  assert.equal(frame.op, 'login');
  const ts = String(now / 1000);
  assert.equal(frame.args[0].timestamp, ts);
  assert.equal(frame.args[0].passphrase, 'pw');
  const expected = crypto
    .createHmac('sha256', 'secret-1')
    .update(`${ts}GET/users/self/verify`)
    .digest('base64');
  assert.equal(frame.args[0].sign, expected);
  const subs = okxSubscribeFrame();
  assert.equal(subs.op, 'subscribe');
  assert.deepEqual(subs.args.map((a) => a.channel), ['orders', 'positions', 'account']);
});

test('normalizes a bybit execution frame into an order event', () => {
  const msg = {
    topic: 'execution',
    data: [
      {
        orderId: 'abc',
        orderLinkId: 'nt-1',
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderStatus: 'Filled',
        qty: '0.5',
        cumExecQty: '0.5',
        avgPrice: '60000',
        execPrice: '60000',
        execFee: '1.5',
        feeCurrency: 'USDT',
      },
    ],
  };
  const evt = normalizeBybitEvent(msg);
  assert.equal(evt.type, 'order');
  assert.equal(evt.orderId, 'abc');
  assert.equal(evt.clientOrderId, 'nt-1');
  assert.equal(evt.side, 'buy');
  assert.equal(evt.filledQty, 0.5);
  assert.equal(evt.avgPrice, 60000);
  assert.equal(evt.fee, 1.5);
});

test('normalizes a bybit wallet frame into an account event', () => {
  const msg = {
    topic: 'wallet',
    creationTime: 123,
    data: [{ coin: [{ coin: 'USDT', walletBalance: '1000', availableToWithdraw: '900', locked: '100' }] }],
  };
  const evt = normalizeBybitEvent(msg);
  assert.equal(evt.type, 'account');
  assert.deepEqual(evt.balances[0], { asset: 'USDT', wallet: 1000, free: 900, locked: 100 });
});

test('normalizes an okx order frame into an order event', () => {
  const msg = {
    arg: { channel: 'orders', instType: 'SWAP' },
    data: [
      {
        ordId: '99',
        clOrdId: 'nt-2',
        instId: 'BTC-USDT-SWAP',
        side: 'sell',
        state: 'filled',
        sz: '1',
        accFillSz: '1',
        avgPx: '60000',
        fee: '0.5',
        feeCcy: 'USDT',
        pnl: '12.5',
      },
    ],
  };
  const evt = normalizeOkxEvent(msg);
  assert.equal(evt.type, 'order');
  assert.equal(evt.orderId, '99');
  assert.equal(evt.side, 'sell');
  assert.equal(evt.filledQty, 1);
  assert.equal(evt.realizedPnl, 12.5);
});

test('normalizes an okx account frame and ignores position frames', () => {
  const acct = normalizeOkxEvent({
    arg: { channel: 'account' },
    data: [{ uTime: '5', details: [{ ccy: 'USDT', eq: '500', availBal: '480', frozenBal: '20' }] }],
  });
  assert.equal(acct.type, 'account');
  assert.deepEqual(acct.balances[0], { asset: 'USDT', wallet: 500, free: 480, locked: 20 });

  const pos = normalizeOkxEvent({ arg: { channel: 'positions' }, data: [{ uTime: '6' }] });
  assert.equal(pos.type, 'positions');
});

test('normalizePrivateEvent dispatches by exchange and returns null for unknown', () => {
  assert.equal(normalizePrivateEvent('bybit', { topic: 'wallet', data: [] }).type, 'account');
  assert.equal(normalizePrivateEvent('okx', { arg: { channel: 'orders' }, data: [] }).type, 'order');
  assert.equal(normalizePrivateEvent('binance', { e: 'x' }), null);
  assert.equal(normalizePrivateEvent('bybit', null), null);
});
