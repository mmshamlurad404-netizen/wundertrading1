import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldReconcilePositions } from '../src/trading.js';
import { fetchLivePositions } from '../src/exchanges/index.js';

test('only live futures accounts reconcile against an exchange position list', () => {
  assert.equal(shouldReconcilePositions({ mode: 'live', marketType: 'futures' }, []), true);
  assert.equal(shouldReconcilePositions({ mode: 'live', marketType: 'futures' }, [{ symbol: 'BTCUSDT' }]), true);
  // Spot venues have no position book: an empty list must never close local trades.
  assert.equal(shouldReconcilePositions({ mode: 'live', marketType: 'spot' }, []), false);
  assert.equal(shouldReconcilePositions({ mode: 'live', marketType: 'spot' }, [{ symbol: 'BTCUSDT' }]), false);
  assert.equal(shouldReconcilePositions({ mode: 'demo', marketType: 'futures' }, []), false);
  assert.equal(shouldReconcilePositions({ mode: 'live', marketType: 'futures' }, null), false);
  assert.equal(shouldReconcilePositions(null, []), false);
});

test('fetchLivePositions short-circuits for spot accounts without a network call', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const out = await fetchLivePositions(
      { exchange: 'binance', marketType: 'spot', testnet: false },
      { apiKey: 'key' }
    );
    assert.equal(out, null);
    assert.equal(called, false, 'no exchange request should be made for spot');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
