import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-store-'));
  return new Store({ dir, file: path.join(dir, 'db.json') });
}

test('insert assigns an id and createdAt', () => {
  const store = tempStore();
  const rec = store.insert('bots', { name: 'b1' });
  assert.ok(rec.id.startsWith('bots_'));
  assert.equal(rec.name, 'b1');
  assert.ok(Number.isFinite(rec.createdAt));
  assert.equal(store.find('bots', (b) => b.id === rec.id), rec);
});

test('filter, update and remove operate on the collection', () => {
  const store = tempStore();
  const a = store.insert('bots', { status: 'running' });
  const b = store.insert('bots', { status: 'stopped' });
  assert.equal(store.filter('bots', (x) => x.status === 'running').length, 1);

  const updated = store.update('bots', a.id, { status: 'stopped' });
  assert.equal(updated.status, 'stopped');
  assert.ok(updated.updatedAt);
  assert.equal(store.update('bots', 'missing', {}), null);

  assert.equal(store.remove('bots', b.id), true);
  assert.equal(store.remove('bots', b.id), false);
  assert.equal(store.all('bots').length, 1);
});

test('nextId increments the sequence', () => {
  const store = tempStore();
  const before = store.data.meta.seq;
  const id1 = store.nextId('orders');
  const id2 = store.nextId('orders');
  assert.notEqual(id1, id2);
  assert.equal(store.data.meta.seq, before + 2);
});

test('trim caps high-churn collections', () => {
  const store = tempStore();
  for (let i = 0; i < 4100; i++) store.insert('logs', { message: `l${i}` });
  for (let i = 0; i < 5100; i++) store.insert('orders', { i });
  for (let i = 0; i < 4100; i++) store.insert('notifications', { i });
  for (let i = 0; i < 2100; i++) store.insert('signals', { i });

  store.trim();

  assert.equal(store.data.logs.length, 4000);
  assert.equal(store.data.orders.length, 5000);
  assert.equal(store.data.notifications.length, 4000);
  assert.equal(store.data.signals.length, 2000);
  // keeps the newest records
  assert.equal(store.data.logs[store.data.logs.length - 1].message, 'l4099');
});

test('trim preserves open positions and caps history', () => {
  const store = tempStore();
  for (let i = 0; i < 10; i++) store.insert('positions', { status: 'open', i });
  for (let i = 0; i < 5000; i++) store.insert('positions', { status: 'closed', i });

  store.trim();

  assert.equal(store.data.positions.length, 5000);
  assert.equal(store.data.positions.filter((p) => p.status === 'open').length, 10);
});

test('save and load round-trip through disk', () => {
  const store = tempStore();
  store.insert('users', { email: 'a@b.io' });
  store.save();

  const reloaded = new Store({ dir: store.dir, file: store.file });
  assert.equal(reloaded.all('users').length, 1);
  assert.equal(reloaded.all('users')[0].email, 'a@b.io');
});
