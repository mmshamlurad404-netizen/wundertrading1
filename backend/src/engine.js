import { store } from './store.js';
import { market } from './market.js';
import {
  openPosition,
  closePosition,
  getAccount,
  accountEquity,
  log,
} from './trading.js';

const BOT_TYPES = ['grid', 'dca', 'signal', 'market_neutral', 'ai'];

export const BOT_TYPE_META = {
  grid: { label: 'Grid Bot', description: 'Buys low and sells high inside a price range.' },
  dca: { label: 'DCA Bot', description: 'Averages entries across safety orders, exits on target.' },
  signal: { label: 'Signal Bot', description: 'Executes TradingView-style webhook or custom signals.' },
  market_neutral: { label: 'Market Neutral Bot', description: 'Delta-neutral funding capture with hedged legs.' },
  ai: { label: 'AI Bot', description: 'Trend + momentum model that adapts to the market.' },
};

// ------------------------------- indicators -------------------------------
export function ema(values, period) {
  const k = 2 / (period + 1);
  let prev;
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values, period = 14) {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period && i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function sma(values, period) {
  if (values.length < period) return values[values.length - 1] || 0;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

// ------------------------------- bot engine -------------------------------
class BotEngine {
  constructor() {
    this.fundingRates = new Map();
    market.on('tick', () => {
      this.onTick().catch((err) => log(null, null, 'error', `Engine tick error: ${err.message}`));
    });
    this._slowCounter = 0;
    this._running = false;
  }

  async onTick() {
    if (this._running) return; // avoid overlapping async exchange calls
    this._running = true;
    try {
      this._slowCounter++;
      const bots = store.filter('bots', (b) => b.status === 'running');
      if (!bots.length) return;
      for (const bot of bots) {
        try {
          const account = getAccount(bot.userId, bot.accountId);
          if (!account) continue;
          switch (bot.type) {
            case 'grid':
              await this.runGrid(bot, account);
              break;
            case 'dca':
              await this.runDca(bot, account);
              break;
            case 'signal':
              await this.runSignal(bot, account);
              break;
            case 'market_neutral':
              await this.runMarketNeutral(bot, account);
              break;
            case 'ai':
              await this.runAi(bot, account);
              break;
          }
          this.refreshStats(bot);
        } catch (err) {
          log(bot.userId, bot.id, 'error', `Bot ${bot.name} error: ${err.message}`);
        }
      }
    } finally {
      this._running = false;
    }
  }

  botPositions(botId) {
    return store.filter('positions', (p) => p.botId === botId && p.status === 'open');
  }

  // Free balance usable for new entries. Live accounts reserve 10% as a buffer.
  availableMargin(account) {
    if (!account) return 0;
    if (account.mode === 'live') {
      const equity = account.equity || account.balances?.USDT || 0;
      return equity * 0.9;
    }
    return (account.balances?.USDT || 0) * 0.9;
  }

  botClosed(botId) {
    return store.filter('positions', (p) => p.botId === botId && p.status === 'closed');
  }

  refreshStats(bot) {
    const open = this.botPositions(bot.id);
    const closed = this.botClosed(bot.id);
    const realized = closed.reduce((s, p) => s + (p.realizedPnl || 0), 0);
    const unrealized = open.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
    const wins = closed.filter((p) => (p.realizedPnl || 0) > 0).length;
    const stats = {
      pnl: +(realized + unrealized).toFixed(2),
      realizedPnl: +realized.toFixed(2),
      unrealizedPnl: +unrealized.toFixed(2),
      trades: closed.length + open.length,
      closedTrades: closed.length,
      winRate: closed.length ? +((wins / closed.length) * 100).toFixed(1) : 0,
      openPositions: open.length,
    };
    const prev = bot.stats;
    const changed =
      !prev ||
      prev.pnl !== stats.pnl ||
      prev.realizedPnl !== stats.realizedPnl ||
      prev.unrealizedPnl !== stats.unrealizedPnl ||
      prev.trades !== stats.trades ||
      prev.winRate !== stats.winRate ||
      prev.openPositions !== stats.openPositions;
    if (changed) {
      store.update('bots', bot.id, { stats: { ...stats, updatedAt: Date.now() } });
    }
  }

  // ------------------------------- GRID -------------------------------
  initGrid(bot) {
    const { lowerPrice, upperPrice, grids } = bot.config;
    const price = market.getPrice(bot.symbol);
    const levels = [];
    for (let i = 0; i <= grids; i++) {
      levels.push(lowerPrice + ((upperPrice - lowerPrice) * i) / grids);
    }
    store.update('bots', bot.id, {
      runtime: {
        levels,
        lastPrice: price,
        gridStepPct: ((upperPrice - lowerPrice) / grids / lowerPrice) * 100,
      },
    });
  }

  async runGrid(bot, account) {
    const cfg = bot.config;
    const price = market.getPrice(bot.symbol);
    if (!price) return;
    if (!bot.runtime?.levels) {
      this.initGrid(bot);
      return;
    }
    const runtime = bot.runtime;
    const lastPrice = runtime.lastPrice || price;
    const open = this.botPositions(bot.id);

    // A buy fires only when price crosses DOWN through a level.
    for (let i = 0; i < runtime.levels.length; i++) {
      const level = runtime.levels[i];
      const crossedDown = lastPrice > level && price <= level;
      const hasLot = open.some((p) => Math.abs(p.entryPrice - level) / level < 0.0004);
      if (crossedDown && !hasLot && open.length < cfg.grids) {
        const takeProfit = runtime.levels[Math.min(i + 1, runtime.levels.length - 1)];
        if (takeProfit <= level) continue;
        const margin = Math.min(cfg.investmentPerGrid, this.availableMargin(account));
        if (margin < 10) continue;
        await openPosition({
          userId: bot.userId,
          accountId: bot.accountId,
          botId: bot.id,
          symbol: bot.symbol,
          side: 'long',
          margin,
          leverage: cfg.leverage || 1,
          takeProfit,
          source: 'grid',
        });
        open.push({ entryPrice: level });
      }
    }
    store.update('bots', bot.id, { runtime: { ...runtime, lastPrice: price } });
  }

  // ------------------------------- DCA -------------------------------
  async initDca(bot) {
    const cfg = bot.config;
    const price = market.getPrice(bot.symbol);
    const margin = Math.min(cfg.baseOrderSize, this.availableMargin(getAccount(bot.userId, bot.accountId)));
    if (margin >= 10) {
      await openPosition({
        userId: bot.userId,
        accountId: bot.accountId,
        botId: bot.id,
        symbol: bot.symbol,
        side: 'long',
        margin,
        leverage: cfg.leverage || 1,
        source: 'dca',
      });
    }
    store.update('bots', bot.id, {
      runtime: { safetyOrders: 0, lastSafetyPrice: price, startedAt: Date.now() },
    });
  }

  async runDca(bot, account) {
    const cfg = bot.config;
    const price = market.getPrice(bot.symbol);
    if (!price) return;
    if (!bot.runtime?.startedAt) {
      await this.initDca(bot);
      return;
    }
    const runtime = { ...bot.runtime };
    const open = this.botPositions(bot.id);
    if (!open.length) {
      await this.initDca(bot);
      return;
    }
    const totalQty = open.reduce((s, p) => s + p.size, 0);
    const totalCost = open.reduce((s, p) => s + p.size * p.entryPrice, 0);
    const avgPrice = totalCost / totalQty;

    // take profit
    if (price >= avgPrice * (1 + cfg.takeProfitPct / 100)) {
      for (const p of open) await closePosition(p.id, 'dca-take-profit');
      log(bot.userId, bot.id, 'success', `DCA target hit for ${bot.symbol} at ${price}`);
      store.update('bots', bot.id, { runtime: { safetyOrders: 0, lastSafetyPrice: price, startedAt: Date.now() } });
      return;
    }

    // stop loss on average
    if (cfg.stopLossPct && price <= avgPrice * (1 - cfg.stopLossPct / 100)) {
      for (const p of open) await closePosition(p.id, 'dca-stop-loss');
      log(bot.userId, bot.id, 'warning', `DCA stop loss for ${bot.symbol} at ${price}`);
      store.update('bots', bot.id, { runtime: { safetyOrders: 0, lastSafetyPrice: price, startedAt: Date.now() } });
      return;
    }

    // safety orders
    if (runtime.safetyOrders < cfg.maxSafetyOrders) {
      const last = runtime.lastSafetyPrice || avgPrice;
      const trigger = last * (1 - cfg.priceDeviation / 100);
      if (price <= trigger) {
        const scale = Math.pow(cfg.safetyOrderVolumeScale || 1.4, runtime.safetyOrders);
        const margin = Math.min(cfg.safetyOrderSize * scale, this.availableMargin(account));
        if (margin >= 10) {
          await openPosition({
            userId: bot.userId,
            accountId: bot.accountId,
            botId: bot.id,
            symbol: bot.symbol,
            side: 'long',
            margin,
            leverage: cfg.leverage || 1,
            source: 'dca-safety',
          });
          runtime.safetyOrders += 1;
          runtime.lastSafetyPrice = price;
          store.update('bots', bot.id, { runtime });
        }
      }
    } else {
      store.update('bots', bot.id, { runtime });
    }
  }

  // ------------------------------- SIGNAL -------------------------------
  async runSignal(bot, account) {
    const signals = store.filter('signals', (s) => s.consumed !== true && s.userId === bot.userId);
    for (const sig of signals) {
      const applies =
        (!bot.config.symbol || bot.config.symbol === sig.symbol) &&
        (!bot.config.allowedSymbols?.length || bot.config.allowedSymbols.includes(sig.symbol));
      if (!applies) continue;
      try {
        await this.executeSignal(bot, sig);
        store.update('signals', sig.id, { consumed: true, consumedBy: bot.id });
      } catch (err) {
        log(bot.userId, bot.id, 'error', `Signal ${sig.action} ${sig.symbol} failed: ${err.message}`);
        store.update('signals', sig.id, { consumed: true, consumedBy: bot.id, error: err.message });
      }
    }
  }

  async executeSignal(bot, sig) {
    const price = sig.price || market.getPrice(sig.symbol);
    const cfg = bot.config;
    const account = getAccount(bot.userId, bot.accountId);
    const available = this.availableMargin(account);
    const action = (sig.action || sig.side || '').toLowerCase();
    const sized = (cfg.orderSize || 200) * (sig.sizeMultiplier || 1);

    if (action === 'buy' || action === 'long') {
      await openPosition({
        userId: bot.userId,
        accountId: bot.accountId,
        botId: bot.id,
        symbol: sig.symbol,
        side: 'long',
        margin: Math.min(sized, available),
        leverage: cfg.leverage || 1,
        takeProfit: cfg.takeProfitPct ? price * (1 + cfg.takeProfitPct / 100) : null,
        stopLoss: cfg.stopLossPct ? price * (1 - cfg.stopLossPct / 100) : null,
        source: 'signal',
      });
      log(bot.userId, bot.id, 'success', `Signal BUY ${sig.symbol} @ ${price}`);
    } else if (action === 'sell' || action === 'short') {
      await openPosition({
        userId: bot.userId,
        accountId: bot.accountId,
        botId: bot.id,
        symbol: sig.symbol,
        side: 'short',
        margin: Math.min(sized, available),
        leverage: cfg.leverage || 1,
        takeProfit: cfg.takeProfitPct ? price * (1 - cfg.takeProfitPct / 100) : null,
        stopLoss: cfg.stopLossPct ? price * (1 + cfg.stopLossPct / 100) : null,
        source: 'signal',
      });
      log(bot.userId, bot.id, 'success', `Signal SHORT ${sig.symbol} @ ${price}`);
    } else if (action === 'close' || action === 'flat') {
      const open = this.botPositions(bot.id).filter((p) => p.symbol === sig.symbol);
      for (const p of open) await closePosition(p.id, 'signal-close');
      log(bot.userId, bot.id, 'info', `Signal CLOSE ${sig.symbol}`);
    }
  }

  // --------------------------- MARKET NEUTRAL ---------------------------
  async runMarketNeutral(bot, account) {
    const cfg = bot.config;
    const price = market.getPrice(bot.symbol);
    if (!price) return;
    const open = this.botPositions(bot.id);
    if (open.length < 2) {
      // open hedged legs: long spot + short perp
      const margin = Math.min(cfg.legSize || 500, this.availableMargin(account) * 0.45);
      if (margin < 10) return;
      await openPosition({
        userId: bot.userId,
        accountId: bot.accountId,
        botId: bot.id,
        symbol: bot.symbol,
        side: 'long',
        margin,
        leverage: 1,
        source: 'neutral-long',
      });
      await openPosition({
        userId: bot.userId,
        accountId: bot.accountId,
        botId: bot.id,
        symbol: bot.symbol,
        side: 'short',
        margin,
        leverage: cfg.leverage || 1,
        source: 'neutral-short',
      });
      store.update('bots', bot.id, { runtime: { accruedFunding: 0, openedAt: Date.now() } });
      log(bot.userId, bot.id, 'info', `Opened delta-neutral pair on ${bot.symbol}`);
      return;
    }
    // accrue simulated funding on the short leg
    const rate = this.fundingRate(bot.symbol);
    const shortLeg = open.find((p) => p.side === 'short');
    if (shortLeg && rate > 0 && account.mode !== 'live') {
      const accrue = shortLeg.notional * (rate / 100);
      const runtime = bot.runtime || { accruedFunding: 0 };
      runtime.accruedFunding = (runtime.accruedFunding || 0) + accrue;
      account.balances.USDT += accrue;
      store.markDirty();
      store.update('bots', bot.id, { runtime });
    }
    // close if target reached
    if ((bot.runtime?.accruedFunding || 0) >= (cfg.targetFunding || 25)) {
      for (const p of open) await closePosition(p.id, 'neutral-target');
      store.update('bots', bot.id, { runtime: { accruedFunding: 0, openedAt: Date.now() } });
      log(bot.userId, bot.id, 'success', `Funding target reached on ${bot.symbol}, re-opening`);
    }
  }

  fundingRate(symbol) {
    if (!this.fundingRates.has(symbol)) this.fundingRates.set(symbol, 0.004 + Math.random() * 0.02);
    let r = this.fundingRates.get(symbol);
    r = Math.max(0.001, Math.min(0.05, r + (Math.random() - 0.5) * 0.002));
    this.fundingRates.set(symbol, r);
    return r;
  }

  // ------------------------------- AI -------------------------------
  async runAi(bot, account) {
    const cfg = bot.config;
    const candles = market.getCandles(bot.symbol, cfg.timeframe || '1m', 120);
    if (candles.length < 60) return;
    const closes = candles.map((c) => c.c);
    const fast = ema(closes, cfg.fastPeriod || 9);
    const slow = ema(closes, cfg.slowPeriod || 21);
    const r = rsi(closes, 14);
    const f = fast[fast.length - 1];
    const s = slow[slow.length - 1];
    const fPrev = fast[fast.length - 2];
    const sPrev = slow[slow.length - 2];
    const price = closes[closes.length - 1];
    const open = this.botPositions(bot.id);

    const crossedUp = fPrev <= sPrev && f > s;
    const crossedDown = fPrev >= sPrev && f < s;
    const trendUp = f > s;

    if (!open.length) {
      const available = this.availableMargin(account);
      if (crossedUp && r < 72) {
        await openPosition({
          userId: bot.userId,
          accountId: bot.accountId,
          botId: bot.id,
          symbol: bot.symbol,
          side: 'long',
          margin: Math.min(cfg.orderSize || 500, available * 0.55),
          leverage: cfg.leverage || 2,
          takeProfit: price * (1 + (cfg.takeProfitPct || 2) / 100),
          stopLoss: price * (1 - (cfg.stopLossPct || 1.5) / 100),
          source: 'ai',
        });
        log(bot.userId, bot.id, 'info', `AI entered LONG ${bot.symbol} (EMA cross, RSI ${r.toFixed(1)})`);
      } else if (crossedDown && r > 28) {
        await openPosition({
          userId: bot.userId,
          accountId: bot.accountId,
          botId: bot.id,
          symbol: bot.symbol,
          side: 'short',
          margin: Math.min(cfg.orderSize || 500, available * 0.55),
          leverage: cfg.leverage || 2,
          takeProfit: price * (1 - (cfg.takeProfitPct || 2) / 100),
          stopLoss: price * (1 + (cfg.stopLossPct || 1.5) / 100),
          source: 'ai',
        });
        log(bot.userId, bot.id, 'info', `AI entered SHORT ${bot.symbol} (EMA cross, RSI ${r.toFixed(1)})`);
      }
    } else {
      const p = open[0];
      const heldBars = (Date.now() - (p.openedAt || Date.now())) / 60000;
      const reversal = p.side === 'long' ? crossedDown : crossedUp;
      if (reversal || heldBars > (cfg.maxHoldMinutes || 240)) {
        await closePosition(p.id, reversal ? 'ai-reversal' : 'ai-timeout');
        log(bot.userId, bot.id, 'info', `AI closed ${p.side} ${bot.symbol} (${reversal ? 'reversal' : 'timeout'})`);
      }
    }
  }
}

export const botEngine = new BotEngine();
export { BOT_TYPES };
