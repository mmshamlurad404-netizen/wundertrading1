import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, STRATEGIES } from '../src/backtest.js';

const STRATEGY_IDS = ['ema_cross', 'rsi_reversion', 'breakout', 'grid', 'dca'];
const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

test('every strategy produces finite metrics for every timeframe', async () => {
  for (const strategy of STRATEGY_IDS) {
    for (const timeframe of TIMEFRAMES) {
      const r = await runBacktest({ symbol: 'BTC/USDT', timeframe, strategy, params: {}, initialBalance: 10000, candleCount: 300 });
      assert.equal(r.strategy, strategy);
      assert.equal(r.timeframe, timeframe);
      assert.equal(r.candleCount, 300);
      assert.equal(r.equityCurve.length, 299);
      assert.ok(Number.isFinite(r.finalEquity));
      assert.ok(Number.isFinite(r.netProfit));
      assert.ok(Number.isFinite(r.maxDrawdownPct) && r.maxDrawdownPct >= 0);
      assert.ok(Number.isFinite(r.sharpe));
      assert.ok(r.winRate >= 0 && r.winRate <= 100);
      assert.ok(Array.isArray(r.trades) && r.trades.length <= 200);
      assert.equal(r.dataSource, 'simulator');
    }
  }
});

test('backtest results are deterministic', async () => {
  const opts = { symbol: 'ETH/USDT', timeframe: '1h', strategy: 'ema_cross', candleCount: 300, initialBalance: 10000 };
  const a = await runBacktest(opts);
  const b = await runBacktest(opts);
  assert.equal(a.finalEquity, b.finalEquity);
  assert.deepEqual(a.equityCurve, b.equityCurve);
});

test('unknown strategy and timeframe are rejected', async () => {
  await assert.rejects(() => runBacktest({ strategy: 'does_not_exist' }), /Unknown strategy/);
  await assert.rejects(() => runBacktest({ timeframe: '2h' }), /Unknown timeframe/);
});

test('STRATEGIES lists the five supported strategies', () => {
  assert.deepEqual(Object.keys(STRATEGIES).sort(), [...STRATEGY_IDS].sort());
});
