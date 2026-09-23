import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { normalizeUserEvent, applyUserEvent } from '../src/userStream.js';
import { userStreamUrl } from '../src/exchanges/binance.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-stream-'));
  return new Store({ dir, file: path.join(dir, 'db.sqlite') });
}

test('normalizeUserEvent handles a futures order update', () => {
  const evt = normalizeUserEvent({
    e: 'ORDER_TRADE_UPDATE',
    E: 1700000000000,
    o: { c: 'nt-abc', i: 42, s: 'BTCUSDT', S: 'BUY', X: 'FILLED', q: '0.5', z: '0.5', ap: '105.2', n: '0.02', N: 'USDT', R: false, rp: '1.5' },
  });
  assert.equal(evt.type, 'order');
  assert.equal(evt.orderId, '42');
  assert.equal(evt.clientOrderId, 'nt-abc');
  assert.equal(evt.status, 'FILLED');
  assert.equal(evt.filledQty, 0.5);
  assert.equal(evt.avgPrice, 105.2);
  assert.equal(evt.fee, 0.02);
  assert.equal(evt.realizedPnl, 1.5);
});

test('normalizeUserEvent handles a spot execution report', () => {
  const evt = normalizeUserEvent({
    e: 'executionReport',
    E: 1,
    o: { c: 'nt-spot', i: 7, s: 'ETHUSDT', S: 'SELL', X: 'PARTIALLY_FILLED', q: '2', z: '1', Z: '101', n: '0.1', N: 'USDT', L: '101' },
  });
  assert.equal(evt.type, 'order');
  assert.equal(evt.side, 'sell');
  assert.equal(evt.status, 'PARTIALLY_FILLED');
  assert.equal(evt.avgPrice, 101);
});

test('normalizeUserEvent handles account updates and unknown frames', () => {
  const acct = normalizeUserEvent({
    e: 'ACCOUNT_UPDATE',
    E: 5,
    a: { B: [{ a: 'USDT', wb: '1000', cw: '0' }, { a: 'BTC', wb: '0.5', cw: '0.5' }] },
  });
  assert.equal(acct.type, 'account');
  assert.deepEqual(acct.balances[0], { asset: 'USDT', wallet: 1000, cross: 0 });
  assert.equal(normalizeUserEvent({ e: 'markPriceUpdate' }), null);
  assert.equal(normalizeUserEvent(null), null);
  assert.equal(normalizeUserEvent({ e: 'listenKeyExpired' }).type, 'listenKeyExpired');
});

test('applyUserEvent fills an order and updates the linked position', () => {
  const store = tempStore();
  const account = store.insert('exchanges', { userId: 'u1', exchange: 'binance', mode: 'live', balances: {} });
  const order = store.insert('orders', { accountId: account.id, exchangeOrderId: '42', status: 'NEW' });
  const pos = store.insert('positions', {
    accountId: account.id,
    exchangeOrderId: '42',
    status: 'open',
    size: 0.5,
    entryPrice: 100,
  });

  const desc = applyUserEvent(account, {
    e: 'ORDER_TRADE_UPDATE',
    o: { i: 42, c: 'nt-x', s: 'BTCUSDT', S: 'BUY', X: 'FILLED', z: '0.5', ap: '105.2', q: '0.5' },
  }, { store });

  assert.match(desc, /filled/);
  assert.equal(store.find('orders', (o) => o.id === order.id).status, 'FILLED');
  assert.equal(store.find('orders', (o) => o.id === order.id).filledPrice, 105.2);
  assert.equal(store.find('positions', (p) => p.id === pos.id).entryPrice, 105.2);
});

test('applyUserEvent syncs account balances and equity', () => {
  const store = tempStore();
  const account = store.insert('exchanges', { userId: 'u1', exchange: 'binance', mode: 'live', balances: { USDT: 100 } });
  const desc = applyUserEvent(account, {
    e: 'ACCOUNT_UPDATE',
    E: 9,
    a: { B: [{ a: 'USDT', wb: '2500', cw: '0' }] },
  }, { store });
  assert.match(desc, /synced/);
  assert.equal(account.balances.USDT, 2500);
  assert.equal(account.equity, 2500);
});

test('userStreamUrl points at spot and futures endpoints', () => {
  assert.match(userStreamUrl('key', { marketType: 'spot' }), /stream\.binance\.com:9443\/ws\/key/);
  assert.match(userStreamUrl('key', { marketType: 'futures' }), /fstream\.binance\.com\/ws\/key/);
  assert.match(userStreamUrl('key', { marketType: 'futures', testnet: true }), /stream\.binancefuture\.com/);
});
