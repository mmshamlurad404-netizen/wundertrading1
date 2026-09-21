import express from 'express';
import { store } from '../store.js';
import { authMiddleware } from '../auth.js';
import { market } from '../market.js';
import { openPosition, getAccounts, getPortfolio, getEquityCurve, log } from '../trading.js';
import { botEngine } from '../engine.js';

const router = express.Router();

// Public (unauthenticated) endpoints. Mounted ahead of the authenticated
// routers in index.js so they are reachable without a bearer token.
export const publicRouter = express.Router();

// ---------------------------- public webhook ----------------------------
// TradingView-style webhook: POST /api/signals/webhook?token=<accountId>&symbol=BTCUSDT&action=buy
publicRouter.post('/signals/webhook', (req, res) => {
  const token = req.query.token || req.body?.token;
  if (!token) return res.status(401).json({ error: 'Missing webhook token' });
  const account = store.find('exchanges', (a) => a.id === token);
  if (!account) return res.status(401).json({ error: 'Invalid webhook token' });
  const body = req.body || {};
  const rawSymbol = body.symbol || req.query.symbol || '';
  const symbol = normalizeSymbol(rawSymbol);
  const action = String(body.action || body.side || req.query.action || '').toLowerCase();
  if (!symbol || !action) return res.status(400).json({ error: 'symbol and action are required' });
  if (!market.getPrice(symbol)) return res.status(400).json({ error: `Unknown symbol ${symbol}` });

  const sig = store.insert('signals', {
    userId: account.userId,
    accountId: account.id,
    symbol,
    action,
    price: body.price ? Number(body.price) : market.getPrice(symbol),
    sizeMultiplier: Number(body.size_multiplier || body.sizeMultiplier) || 1,
    source: 'webhook',
    payload: body,
    consumed: false,
  });
  log(account.userId, null, 'info', `Webhook signal ${action.toUpperCase()} ${symbol}`);
  res.status(201).json({ ok: true, signal: sig });
});

function normalizeSymbol(s) {
  const up = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!up) return '';
  for (const p of market.listPairs()) {
    if (p.replace('/', '') === up) return p;
  }
  if (up.endsWith('USDT')) return `${up.slice(0, -4)}/USDT`;
  return '';
}

router.use(authMiddleware);

// ------------------------------- signals -------------------------------
router.get('/signals', (req, res) => {
  const list = store
    .filter('signals', (s) => s.userId === req.userId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 100);
  res.json({ signals: list });
});

router.get('/signals/webhook-token', (req, res) => {
  const account = getAccounts(req.userId).find((a) => a.exchange === 'paper') || getAccounts(req.userId)[0];
  res.json({
    token: account?.id,
    exampleUrl: `/api/signals/webhook?token=${account?.id}&symbol=BTCUSDT&action=buy`,
    body: { symbol: 'BTCUSDT', action: 'buy', price: '{{close}}', size_multiplier: 1 },
  });
});

// ------------------------------- notifications -------------------------------
router.get('/notifications', (req, res) => {
  const list = store
    .filter('notifications', (n) => n.userId === req.userId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 50);
  res.json({ notifications: list, unread: list.filter((n) => !n.read).length });
});

router.post('/notifications/read-all', (req, res) => {
  for (const n of store.filter('notifications', (n) => n.userId === req.userId && !n.read)) {
    store.update('notifications', n.id, { read: true });
  }
  res.json({ ok: true });
});

// ------------------------------- logs -------------------------------
router.get('/logs', (req, res) => {
  const list = store
    .filter('logs', (l) => l.userId === req.userId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, Number(req.query.limit) || 150);
  res.json({ logs: list });
});

// ------------------------------- watchlist -------------------------------
router.get('/watchlist', (req, res) => {
  let w = store.find('watchlist', (x) => x.userId === req.userId);
  if (!w) w = store.insert('watchlist', { userId: req.userId, symbols: ['BTC/USDT', 'ETH/USDT'] });
  res.json({
    watchlist: w.symbols.map((s) => market.getTicker(s)).filter(Boolean),
  });
});

router.post('/watchlist', (req, res) => {
  const { symbol, action = 'add' } = req.body || {};
  let w = store.find('watchlist', (x) => x.userId === req.userId);
  if (!w) w = store.insert('watchlist', { userId: req.userId, symbols: [] });
  let symbols = w.symbols || [];
  if (action === 'add' && symbol && !symbols.includes(symbol)) symbols = [...symbols, symbol];
  if (action === 'remove') symbols = symbols.filter((s) => s !== symbol);
  store.update('watchlist', w.id, { symbols });
  res.json({ symbols });
});

// ------------------------------- dashboard summary -------------------------------
router.get('/dashboard', (req, res) => {
  const portfolio = getPortfolio(req.userId);
  const bots = store.filter('bots', (b) => b.userId === req.userId);
  const signals = store
    .filter('signals', (s) => s.userId === req.userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);
  const logs = store
    .filter('logs', (l) => l.userId === req.userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  res.json({
    portfolio,
    equityCurve: getEquityCurve(req.userId, 48),
    bots: {
      total: bots.length,
      running: bots.filter((b) => b.status === 'running').length,
      pnl: +bots.reduce((s, b) => s + (b.stats?.pnl || 0), 0).toFixed(2),
      items: bots.slice(0, 6),
    },
    topMovers: market
      .getAllTickers()
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 6),
    screener: market.screener().slice(0, 6),
    signals,
    logs,
    fundingRates: market.listPairs().slice(0, 12).map((s) => ({
      symbol: s,
      rate: +botEngine.fundingRate(s).toFixed(4),
    })),
  });
});

// ------------------------------- demo seed -------------------------------
router.post('/demo/seed', async (req, res) => {
  await seedDemo(req.userId);
  res.json({ ok: true });
});

export async function seedDemo(userId) {
  const account = getAccounts(userId).find((a) => a.exchange === 'paper') || getAccounts(userId)[0];
  if (!account) return;
  const existing = store.filter('bots', (b) => b.userId === userId);
  if (existing.length) return;

  const specs = [
    { name: 'BTC Range Harvester', type: 'grid', symbol: 'BTC/USDT', accountId: account.id,
      config: { lowerPrice: market.getPrice('BTC/USDT') * 0.94, upperPrice: market.getPrice('BTC/USDT') * 1.06, grids: 12, investmentPerGrid: 150, leverage: 1 }, status: 'running' },
    { name: 'ETH Dip Accumulator', type: 'dca', symbol: 'ETH/USDT', accountId: account.id,
      config: { baseOrderSize: 400, safetyOrderSize: 250, maxSafetyOrders: 5, priceDeviation: 2.5, safetyOrderVolumeScale: 1.5, takeProfitPct: 2, stopLossPct: 15, leverage: 1 }, status: 'running' },
    { name: 'SOL Momentum AI', type: 'ai', symbol: 'SOL/USDT', accountId: account.id,
      config: { orderSize: 500, leverage: 2, timeframe: '1m', fastPeriod: 9, slowPeriod: 21, takeProfitPct: 2, stopLossPct: 1.5, maxHoldMinutes: 240 }, status: 'running' },
    { name: 'Funding Neutral BTC', type: 'market_neutral', symbol: 'BTC/USDT', accountId: account.id,
      config: { legSize: 500, leverage: 2, targetFunding: 30 }, status: 'running' },
    { name: 'TV Alerts Bot', type: 'signal', symbol: 'BTC/USDT', accountId: account.id,
      config: { orderSize: 250, leverage: 1, takeProfitPct: 2, stopLossPct: 1.5 }, status: 'stopped' },
  ];

  for (const spec of specs) {
    store.insert('bots', {
      userId,
      accountId: spec.accountId,
      name: spec.name,
      type: spec.type,
      symbol: spec.symbol,
      status: spec.status,
      config: spec.config,
      runtime: null,
      stats: { pnl: 0, trades: 0, winRate: 0, openPositions: 0 },
    });
  }

  // a little trade history so analytics look meaningful
  const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'LINK/USDT', 'AVAX/USDT'];
  for (let i = 0; i < 12; i++) {
    const sym = symbols[i % symbols.length];
    const price = market.getPrice(sym);
    const side = Math.random() > 0.45 ? 'long' : 'short';
    const margin = 100 + Math.random() * 300;
    await openPosition({ userId, accountId: account.id, symbol: sym, side, margin, leverage: 2, source: 'seed' });
  }
  log(userId, null, 'success', 'Demo workspace seeded with sample bots and positions');
}

export default router;
