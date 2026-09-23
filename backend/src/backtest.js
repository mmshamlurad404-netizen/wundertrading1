import { generateCandles, market, TIMEFRAMES } from './market.js';
import { ema, rsi, sma } from './engine.js';
import { marketData } from './marketData.js';

const STRATEGIES = {
  ema_cross: 'EMA Crossover',
  rsi_reversion: 'RSI Mean Reversion',
  breakout: 'Range Breakout',
  grid: 'Grid Simulation',
  dca: 'DCA Simulation',
};

function maxDrawdown(curve) {
  let peak = -Infinity;
  let mdd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    if (peak > 0) mdd = Math.max(mdd, (peak - p.equity) / peak);
  }
  return mdd * 100;
}

function sharpe(returns, periodsPerYear) {
  if (!returns.length) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const sd = Math.sqrt(variance);
  if (!sd) return 0;
  return (mean / sd) * Math.sqrt(periodsPerYear);
}

export async function runBacktest({
  symbol = 'BTC/USDT',
  timeframe = '1h',
  strategy = 'ema_cross',
  params = {},
  initialBalance = 10000,
  candleCount = 500,
  feeRate = 0.0005,
  useRealData = true,
} = {}) {
  if (!STRATEGIES[strategy]) throw new Error(`Unknown strategy: ${strategy}`);
  const bucket = TIMEFRAMES[timeframe];
  if (!bucket) throw new Error(`Unknown timeframe: ${timeframe}`);
  const count = Math.min(Math.max(candleCount, 120), 1000);
  // Real exchange history when available; deterministic simulator otherwise.
  let candles = useRealData ? await marketData.getCandles(symbol, timeframe, count) : null;
  const dataSource = candles && candles.length >= 60 ? 'live' : 'simulator';
  if (!candles || candles.length < 60) candles = generateCandles(symbol, timeframe, count);
  const closes = candles.map((c) => c.c);

  const trades = [];
  const curve = [];
  let balance = initialBalance;
  let position = null; // { side, entry, size, entryIdx }

  const takeProfit = (params.takeProfitPct ?? 2) / 100;
  const stopLoss = (params.stopLossPct ?? 1.5) / 100;
  const fee = feeRate;

  let fastArr = [];
  let slowArr = [];
  let rsiArr = [];
  if (strategy === 'ema_cross') {
    fastArr = ema(closes, params.fastPeriod || 9);
    slowArr = ema(closes, params.slowPeriod || 21);
  }
  if (strategy === 'rsi_reversion') rsiArr = rsi(closes, params.rsiPeriod || 14);

  const breakoutWindow = params.window || 20;
  const gridLevels = params.grids || 12;
  const gridLow = Math.min(...closes) * 1.0;
  const gridHigh = Math.max(...closes) * 1.0;
  let gridInventory = 0;
  let gridCash = balance;
  const gridStep = (gridHigh - gridLow) / gridLevels;

  const openTrade = (side, price, idx) => {
    const size = (balance * (params.riskPct ? params.riskPct / 100 : 0.95)) / price;
    if (size <= 0) return;
    position = { side, entry: price, size, entryIdx: idx };
  };

  const closeTrade = (price, idx, reason) => {
    if (!position) return;
    const dir = position.side === 'long' ? 1 : -1;
    const gross = dir * (price - position.entry) * position.size;
    const fees = price * position.size * fee + position.entry * position.size * fee;
    const pnl = gross - fees;
    balance += pnl;
    trades.push({
      side: position.side,
      entry: +position.entry.toFixed(6),
      exit: +price.toFixed(6),
      size: +position.size.toFixed(6),
      pnl: +pnl.toFixed(2),
      returnPct: +((pnl / initialBalance) * 100).toFixed(2),
      entryTime: candles[position.entryIdx]?.t,
      exitTime: candles[idx]?.t,
      reason,
    });
    position = null;
  };

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    if (strategy === 'grid') {
      const price = c.c;
      for (let g = 0; g < gridLevels; g++) {
        const level = gridLow + g * gridStep;
        if (price <= level && gridCash > price * 0.1) {
          const qty = (gridCash / price) * 0.08;
          gridInventory += qty;
          gridCash -= qty * price * (1 + fee);
        } else if (price >= level + gridStep && gridInventory > 0) {
          const qty = Math.min(gridInventory, gridInventory * 0.5);
          gridInventory -= qty;
          gridCash += qty * price * (1 - fee);
          trades.push({ side: 'grid-sell', entry: +level.toFixed(6), exit: +price.toFixed(6), size: +qty.toFixed(6), pnl: +(qty * (price - level)).toFixed(2), reason: 'grid' });
        }
      }
      balance = gridCash;
      curve.push({ t: c.t, equity: +(gridCash + gridInventory * c.c).toFixed(2) });
      continue;
    }

    if (strategy === 'dca') {
      const entry = params.entryDeviation || 2;
      const tp = (params.takeProfitPct ?? 3) / 100;
      if (!position && i % (params.intervalBars || 24) === 0) openTrade('long', c.c, i);
      if (position) {
        const avg = position.entry;
        if (c.c >= avg * (1 + tp)) closeTrade(c.c, i, 'take-profit');
        else if (c.c <= avg * (1 - (params.stopLossPct ?? 8) / 100)) closeTrade(c.c, i, 'stop-loss');
      }
      curve.push({ t: c.t, equity: +(balance + (position ? (c.c - position.entry) * position.size : 0)).toFixed(2) });
      continue;
    }

    if (strategy === 'ema_cross') {
      const crossedUp = fastArr[i - 1] <= slowArr[i - 1] && fastArr[i] > slowArr[i];
      const crossedDown = fastArr[i - 1] >= slowArr[i - 1] && fastArr[i] < slowArr[i];
      if (!position && crossedUp) openTrade('long', c.c, i);
      else if (!position && crossedDown && params.allowShort) openTrade('short', c.c, i);
      else if (position) {
        const tp = position.side === 'long' ? position.entry * (1 + takeProfit) : position.entry * (1 - takeProfit);
        const sl = position.side === 'long' ? position.entry * (1 - stopLoss) : position.entry * (1 + stopLoss);
        const hitTp = position.side === 'long' ? c.c >= tp : c.c <= tp;
        const hitSl = position.side === 'long' ? c.c <= sl : c.c >= sl;
        const flipped = position.side === 'long' ? crossedDown : crossedUp;
        if (hitTp) closeTrade(tp, i, 'take-profit');
        else if (hitSl) closeTrade(sl, i, 'stop-loss');
        else if (flipped) closeTrade(c.c, i, 'reversal');
      }
    }

    if (strategy === 'rsi_reversion') {
      const oversold = params.oversold || 30;
      const overbought = params.overbought || 70;
      if (!position && rsiArr[i] < oversold) openTrade('long', c.c, i);
      else if (!position && rsiArr[i] > overbought) openTrade('short', c.c, i);
      else if (position) {
        const target = position.side === 'long' ? overbought : oversold;
        const done = position.side === 'long' ? rsiArr[i] > 55 : rsiArr[i] < 45;
        const sl = position.side === 'long' ? c.c <= position.entry * (1 - stopLoss) : c.c >= position.entry * (1 + stopLoss);
        if (done || sl) closeTrade(c.c, i, sl ? 'stop-loss' : `rsi-${Math.round(target)}`);
      }
    }

    if (strategy === 'breakout') {
      if (i > breakoutWindow) {
        const window = closes.slice(i - breakoutWindow, i);
        const hi = Math.max(...window);
        const lo = Math.min(...window);
        if (!position && c.c > hi) openTrade('long', c.c, i);
        else if (!position && params.allowShort && c.c < lo) openTrade('short', c.c, i);
        else if (position) {
          const sl = position.side === 'long' ? c.c <= position.entry * (1 - stopLoss) : c.c >= position.entry * (1 + stopLoss);
          const trail = position.side === 'long' ? c.c <= lo : c.c >= hi;
          if (sl) closeTrade(c.c, i, 'stop-loss');
          else if (trail) closeTrade(c.c, i, 'trailing');
        }
      }
    }

    const openPnl = position ? (position.side === 'long' ? 1 : -1) * (c.c - position.entry) * position.size : 0;
    curve.push({ t: c.t, equity: +(balance + openPnl).toFixed(2) });
  }

  if (position) closeTrade(candles[candles.length - 1].c, candles.length - 1, 'end-of-test');

  const finalEquity = balance;
  const netProfit = finalEquity - initialBalance;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const periodsPerYear = (365 * 24 * 3600 * 1000) / bucket;
  const rets = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity;
    if (prev > 0) rets.push((curve[i].equity - prev) / prev);
  }

  return {
    symbol,
    timeframe,
    strategy,
    strategyLabel: STRATEGIES[strategy],
    params,
    initialBalance,
    finalEquity: +finalEquity.toFixed(2),
    netProfit: +netProfit.toFixed(2),
    returnPct: +((netProfit / initialBalance) * 100).toFixed(2),
    maxDrawdownPct: +maxDrawdown(curve).toFixed(2),
    winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
    totalTrades: trades.length,
    profitFactor: grossLoss ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 99 : 0,
    sharpe: +sharpe(rets, periodsPerYear).toFixed(2),
    avgTrade: trades.length ? +(netProfit / trades.length).toFixed(2) : 0,
    equityCurve: curve,
    trades: trades.slice(-200),
    candleCount: candles.length,
    dataSource,
  };
}

export { STRATEGIES };
