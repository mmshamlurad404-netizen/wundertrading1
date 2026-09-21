import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, rsi, sma } from '../src/engine.js';

test('ema keeps the input length and is monotonic for a rising series', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.equal(out.length, 5);
  assert.equal(out[0], 1);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] > out[i - 1]);
});

test('ema of a constant series equals the constant', () => {
  const out = ema([7, 7, 7, 7, 7], 4);
  for (const v of out) assert.equal(v, 7);
});

test('rsi is 100 for a strictly rising series', () => {
  const values = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(rsi(values, 14), 100);
});

test('rsi is 0 for a strictly falling series', () => {
  const values = Array.from({ length: 30 }, (_, i) => 200 - i);
  assert.equal(rsi(values, 14), 0);
});

test('rsi stays within 0..100 for noisy data', () => {
  const values = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5 + (i % 5));
  const v = rsi(values, 14);
  assert.ok(v >= 0 && v <= 100, `rsi=${v}`);
});

test('sma averages the last period', () => {
  assert.equal(sma([1, 2, 3, 4, 5], 3), 4);
  assert.equal(sma([2, 4], 5), 4);
});
