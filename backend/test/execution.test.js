import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFill, walkBook, roundTripPnl, DEFAULT_FEE_RATE } from '../src/execution.js';

test('walkBook fills from the ladder and reports exhaustion', () => {
  const levels = [
    { price: 100, size: 1 },
    { price: 101, size: 2 },
    { price: 102, size: 5 },
  ];
  const r = walkBook(levels, 2.5);
  assert.equal(r.filled, 2.5);
  assert.equal(r.cost, 100 * 1 + 101 * 1.5);
  assert.equal(r.exhausted, false);

  const short = walkBook(levels, 20);
  assert.equal(short.filled, 8);
  assert.equal(short.exhausted, true);
});

test('simulateFill applies slippage and taker fee without a book', () => {
  const fill = simulateFill({
    side: 'buy',
    notional: 1000,
    referencePrice: 100,
    feeRate: 0.001,
    slippageBps: 10,
  });
  assert.equal(fill.qty, 10);
  assert.equal(fill.fillPrice, 100 * 1.001);
  assert.equal(fill.source, 'slippage');
  assert.ok(Math.abs(fill.fee - 10 * 100 * 1.001 * 0.001) < 1e-9);
});

test('simulateFill sells below the reference price', () => {
  const fill = simulateFill({ side: 'sell', qty: 2, referencePrice: 50, slippageBps: 20 });
  assert.equal(fill.fillPrice, 50 * 0.998);
  assert.equal(fill.source, 'slippage');
});

test('simulateFill walks the real book for the VWAP', () => {
  const book = {
    bids: [{ price: 99, size: 10 }],
    asks: [
      { price: 100, size: 1 },
      { price: 101, size: 4 },
    ],
  };
  const fill = simulateFill({ side: 'buy', qty: 3, referencePrice: 100, book, feeRate: 0 });
  assert.equal(fill.source, 'book');
  assert.equal(fill.fillPrice, (1 * 100 + 2 * 101) / 3);
  assert.equal(fill.fee, 0);
});

test('simulateFill tops up with slippage when the book is too thin', () => {
  const book = { bids: [], asks: [{ price: 100, size: 1 }] };
  const fill = simulateFill({ side: 'buy', qty: 3, referencePrice: 100, book, feeRate: 0, slippageBps: 10 });
  assert.equal(fill.source, 'book+slippage');
  assert.equal(fill.qty, 3);
  assert.equal(fill.fillPrice, (100 + 2 * 100 * 1.001) / 3);
});

test('roundTripPnl subtracts both fees', () => {
  const pnl = roundTripPnl({ side: 'long', entryPrice: 100, exitPrice: 110, size: 2, entryFee: 1, exitFee: 1.1 });
  assert.ok(Math.abs(pnl - (20 - 2.1)) < 1e-9);
  assert.equal(roundTripPnl({ side: 'short', entryPrice: 100, exitPrice: 90, size: 1 }), 10);
});

test('simulateFill rejects a missing reference price', () => {
  assert.throws(() => simulateFill({ side: 'buy', qty: 1 }), /referencePrice/);
  assert.ok(DEFAULT_FEE_RATE >= 0);
});
