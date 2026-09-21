import express from 'express';
import { store } from '../store.js';
import { authMiddleware } from '../auth.js';
import { BOT_TYPE_META, BOT_TYPES, botEngine } from '../engine.js';
import { getAccounts, getAccount, log } from '../trading.js';
import { market } from '../market.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/types', (req, res) => {
  res.json({ types: BOT_TYPES.map((t) => ({ id: t, ...BOT_TYPE_META[t] })) });
});

router.get('/', (req, res) => {
  const bots = store
    .filter('bots', (b) => b.userId === req.userId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({ bots });
});

router.get('/:id', (req, res) => {
  const bot = store.find('bots', (b) => b.id === req.params.id && b.userId === req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const positions = store.filter('positions', (p) => p.botId === bot.id);
  const logs = store
    .filter('logs', (l) => l.botId === bot.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
  res.json({ bot, positions, logs });
});

const DEFAULT_CONFIG = {
  grid: { lowerPrice: 0, upperPrice: 0, grids: 10, investmentPerGrid: 200, leverage: 1 },
  dca: {
    baseOrderSize: 300,
    safetyOrderSize: 200,
    maxSafetyOrders: 5,
    priceDeviation: 2,
    safetyOrderVolumeScale: 1.4,
    takeProfitPct: 1.5,
    stopLossPct: 12,
    leverage: 1,
  },
  signal: { orderSize: 200, leverage: 1, takeProfitPct: 2, stopLossPct: 1.5 },
  market_neutral: { legSize: 500, leverage: 2, targetFunding: 25 },
  ai: {
    orderSize: 500,
    leverage: 2,
    timeframe: '1m',
    fastPeriod: 9,
    slowPeriod: 21,
    takeProfitPct: 2,
    stopLossPct: 1.5,
    maxHoldMinutes: 240,
  },
};

router.post('/', (req, res) => {
  const { name, type, symbol, accountId, config = {} } = req.body || {};
  if (!BOT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid bot type' });
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  if (!market.getPrice(symbol)) return res.status(400).json({ error: 'Unknown market symbol' });
  const account = accountId
    ? getAccount(req.userId, accountId)
    : getAccounts(req.userId).find((a) => a.exchange === 'paper');
  if (!account) return res.status(400).json({ error: 'No trading account available' });

  const merged = { ...DEFAULT_CONFIG[type], ...config };
  if (type === 'grid') {
    const price = market.getPrice(symbol);
    if (!merged.lowerPrice || !merged.upperPrice) {
      merged.lowerPrice = +(price * 0.9).toFixed(6);
      merged.upperPrice = +(price * 1.1).toFixed(6);
    }
    if (merged.lowerPrice >= merged.upperPrice) {
      return res.status(400).json({ error: 'lowerPrice must be below upperPrice' });
    }
  }

  const bot = store.insert('bots', {
    userId: req.userId,
    accountId: account.id,
    name: name || `${BOT_TYPE_META[type].label} ${symbol}`,
    type,
    symbol,
    status: 'stopped',
    config: merged,
    runtime: null,
    stats: { pnl: 0, trades: 0, winRate: 0, openPositions: 0 },
  });
  log(req.userId, bot.id, 'info', `Created ${BOT_TYPE_META[type].label} for ${symbol}`);
  res.status(201).json({ bot });
});

router.patch('/:id', (req, res) => {
  const bot = store.find('bots', (b) => b.id === req.params.id && b.userId === req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const { name, config } = req.body || {};
  const updated = store.update('bots', bot.id, {
    ...(name ? { name } : {}),
    ...(config ? { config: { ...bot.config, ...config } } : {}),
  });
  if (bot.type === 'grid' && config && bot.status !== 'running') {
    store.update('bots', bot.id, { runtime: null });
  }
  res.json({ bot: updated });
});

router.post('/:id/start', (req, res) => {
  const bot = store.find('bots', (b) => b.id === req.params.id && b.userId === req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.status === 'running') return res.json({ bot });
  if (bot.type === 'grid' || bot.type === 'dca') store.update('bots', bot.id, { runtime: null });
  const updated = store.update('bots', bot.id, {
    status: 'running',
    startedAt: bot.startedAt || Date.now(),
  });
  log(req.userId, bot.id, 'info', `Bot ${bot.name} started`);
  res.json({ bot: updated });
});

router.post('/:id/stop', (req, res) => {
  const bot = store.find('bots', (b) => b.id === req.params.id && b.userId === req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const updated = store.update('bots', bot.id, { status: 'stopped', stoppedAt: Date.now() });
  log(req.userId, bot.id, 'info', `Bot ${bot.name} stopped`);
  res.json({ bot: updated });
});

router.delete('/:id', (req, res) => {
  const bot = store.find('bots', (b) => b.id === req.params.id && b.userId === req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  // Open positions are intentionally left untouched so they keep being managed
  // by the position monitor; the bot record itself is removed.
  store.remove('bots', bot.id);
  log(req.userId, bot.id, 'warning', `Bot ${bot.name} deleted`);
  res.json({ ok: true });
});

router.post('/:id/close-all', async (req, res) => {
  const bot = store.find('bots', (b) => b.id === req.params.id && b.userId === req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const open = store.filter('positions', (p) => p.botId === bot.id && p.status === 'open');
  const { closePosition } = await import('../trading.js');
  let closed = 0;
  for (const p of open) {
    try {
      await closePosition(p.id, 'bot-close-all');
      closed++;
    } catch (err) {
      log(req.userId, bot.id, 'error', `Failed to close ${p.symbol}: ${err.message}`);
    }
  }
  log(req.userId, bot.id, 'warning', `Closing all positions for ${bot.name}`);
  res.json({ ok: true, closed });
});

// manually send a signal to a signal bot / fire a webhook-style signal
router.post('/:id/signal', (req, res) => {
  const bot = store.find('bots', (b) => b.id === req.params.id && b.userId === req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const { action, symbol = bot.symbol, price, sizeMultiplier = 1 } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required' });
  const sig = store.insert('signals', {
    userId: req.userId,
    botId: bot.id,
    symbol,
    action,
    price: price ? Number(price) : market.getPrice(symbol),
    sizeMultiplier: Number(sizeMultiplier) || 1,
    source: 'manual',
    consumed: false,
  });
  res.status(201).json({ signal: sig });
});

export default router;
