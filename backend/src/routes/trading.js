import express from 'express';
import { store } from '../store.js';
import { authMiddleware } from '../auth.js';
import {
  createAccount,
  getAccounts,
  getAccount,
  accountEquity,
  openPosition,
  closePosition,
  getPortfolio,
  getEquityCurve,
  syncLiveAccount,
  getAccountSecrets,
} from '../trading.js';
import { getAdapter, testExchangeConnection } from '../exchanges/index.js';
import { market, PAIR_META } from '../market.js';

const router = express.Router();
router.use(authMiddleware);

// ------------------------------- exchanges -------------------------------
const SUPPORTED_EXCHANGES = [
  { id: 'paper', name: 'Paper Wallet', type: 'simulated', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'binance', name: 'Binance', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'bybit', name: 'Bybit', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'okx', name: 'OKX', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'bitget', name: 'Bitget', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'gate', name: 'Gate.io', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'kucoin', name: 'KuCoin', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'kraken', name: 'Kraken', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'coinbase', name: 'Coinbase Advanced', type: 'cex', regions: ['us'], markets: ['spot'] },
  { id: 'mexc', name: 'MEXC', type: 'cex', regions: ['global'], markets: ['spot', 'futures'] },
  { id: 'hyperliquid', name: 'Hyperliquid', type: 'dex', regions: ['global'], markets: ['futures'] },
  { id: 'nobitex', name: 'Nobitex', type: 'cex', regions: ['iran'], markets: ['spot'] },
  { id: 'wallex', name: 'Wallex', type: 'cex', regions: ['iran'], markets: ['spot'] },
  { id: 'tabdeal', name: 'Tabdeal', type: 'cex', regions: ['iran'], markets: ['spot'] },
  { id: 'bitpin', name: 'Bitpin', type: 'cex', regions: ['iran'], markets: ['spot'] },
  { id: 'ompfinex', name: 'OMPFinex', type: 'cex', regions: ['iran'], markets: ['spot'] },
  { id: 'abantether', name: 'Abantether', type: 'cex', regions: ['iran'], markets: ['spot'] },
];

router.get('/exchanges/supported', (req, res) => {
  const exchanges = SUPPORTED_EXCHANGES.map((e) => {
    const adapter = getAdapter(e.id);
    return {
      ...e,
      liveCapable: Boolean(adapter),
      requiresSecret: adapter ? adapter.requiresSecret !== false : true,
      requiresPassphrase: adapter ? Boolean(adapter.requiresPassphrase) : false,
      futures: adapter ? Boolean(adapter.supports?.futures) : e.markets.includes('futures'),
      verified: adapter ? adapter.verified !== false : false,
    };
  });
  res.json({ exchanges });
});

router.get('/accounts', (req, res) => {
  const accounts = getAccounts(req.userId).map((a) => ({
    id: a.id,
    exchange: a.exchange,
    label: a.label,
    mode: a.mode,
    marketType: a.marketType || 'futures',
    testnet: Boolean(a.testnet),
    live: Boolean(a.live),
    liveCapable: Boolean(getAdapter(a.exchange)),
    keyLast4: a.keyLast4,
    passphraseSet: Boolean(a.passphraseSet),
    connected: a.connected,
    balances: a.balances,
    equity: +accountEquity(a).toFixed(2),
    syncedAt: a.syncedAt || null,
    createdAt: a.createdAt,
  }));
  res.json({ accounts });
});

router.post('/accounts', async (req, res) => {
  const {
    exchange,
    label,
    mode = 'demo',
    apiKey,
    apiSecret,
    passphrase,
    testnet = false,
    marketType = 'futures',
    validate = true,
  } = req.body || {};
  if (!exchange) return res.status(400).json({ error: 'exchange is required' });
  const isPaper = exchange === 'paper';
  const adapter = getAdapter(exchange);
  // Spot-only venues (all Iranian providers) always trade the spot market.
  const futuresSupported = adapter ? Boolean(adapter.supports?.futures) : true;
  const normalizedMarket = futuresSupported && marketType !== 'spot' ? 'futures' : 'spot';
  const wantsLive = !isPaper && mode === 'live';
  // Real execution always requires credentials; demo/sandbox accounts do not.
  if (wantsLive && !adapter) {
    return res.status(400).json({ error: `Live trading is not supported for ${exchange}` });
  }
  if (wantsLive && !apiKey) {
    return res.status(400).json({ error: 'API key is required for live trading' });
  }
  if (wantsLive && adapter.requiresSecret !== false && !apiSecret) {
    return res.status(400).json({ error: `API secret is required for live trading on ${adapter.name}` });
  }
  if (wantsLive && adapter.requiresPassphrase && !passphrase) {
    return res.status(400).json({ error: `Passphrase is required for live trading on ${adapter.name}` });
  }
  if (wantsLive && validate) {
    try {
      await testExchangeConnection(
        exchange,
        { apiKey, apiSecret, passphrase },
        { testnet: Boolean(testnet), marketType: normalizedMarket }
      );
    } catch (err) {
      const status = err.code === 'NO_ADAPTER' ? 400 : 502;
      return res.status(status).json({ error: `Connection test failed: ${err.message}` });
    }
  }
  const account = createAccount(req.userId, {
    exchange,
    label,
    mode,
    apiKey,
    apiSecret,
    passphrase,
    testnet: Boolean(testnet),
    marketType: normalizedMarket,
  });
  // Best-effort initial balance sync for live accounts.
  if (account.mode === 'live') {
    await syncLiveAccount(account).catch(() => {});
  }
  res.status(201).json({
    account: {
      id: account.id,
      exchange: account.exchange,
      label: account.label,
      mode: account.mode,
      live: account.live,
      marketType: account.marketType,
      testnet: account.testnet,
      keyLast4: account.keyLast4,
      equity: +accountEquity(account).toFixed(2),
    },
  });
});

router.post('/accounts/:id/test', async (req, res) => {
  const account = getAccount(req.userId, req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.exchange === 'paper') return res.json({ ok: true, message: 'Paper wallet is always available' });
  const adapter = getAdapter(account.exchange);
  if (!adapter) return res.status(400).json({ error: `Live trading is not supported for ${account.exchange}` });
  const secrets = getAccountSecrets(account);
  try {
    const result = await testExchangeConnection(
      account.exchange,
      secrets,
      { testnet: Boolean(account.testnet), marketType: account.marketType }
    );
    await syncLiveAccount(account).catch(() => {});
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/accounts/:id/sync', async (req, res) => {
  const account = getAccount(req.userId, req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.mode !== 'live') return res.status(400).json({ error: 'Account is not a live account' });
  await syncLiveAccount(account);
  res.json({ ok: true, equity: +accountEquity(account).toFixed(2), syncedAt: account.syncedAt || null });
});

router.delete('/accounts/:id', (req, res) => {
  const account = getAccount(req.userId, req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.exchange === 'paper') return res.status(400).json({ error: 'Paper Wallet cannot be removed' });
  const open = store.filter('positions', (p) => p.accountId === account.id && p.status === 'open');
  if (open.length) return res.status(400).json({ error: 'Close open positions before disconnecting' });
  store.remove('exchanges', account.id);
  res.json({ ok: true });
});

router.post('/accounts/:id/reset', async (req, res) => {
  const account = getAccount(req.userId, req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  for (const p of store.filter('positions', (p) => p.accountId === account.id && p.status === 'open')) {
    await closePosition(p.id, 'reset', account);
  }
  const simBalance = account.exchange === 'paper' ? 100000 : 25000;
  store.update('exchanges', account.id, {
    balances: account.live ? account.balances : { USDT: simBalance },
    ...(account.live ? {} : { equity: simBalance }),
  });
  res.json({ ok: true });
});

// ------------------------------- positions -------------------------------
router.get('/positions', (req, res) => {
  const status = req.query.status || 'open';
  const list = store
    .filter('positions', (p) => p.userId === req.userId && (status === 'all' ? true : p.status === status))
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
  res.json({ positions: list });
});

router.post('/positions', async (req, res) => {
  try {
    const { accountId, symbol, side, margin, leverage = 1, stopLoss, takeProfit, trailingStop } = req.body || {};
    if (!symbol || !side) return res.status(400).json({ error: 'symbol and side are required' });
    const account = accountId ? getAccount(req.userId, accountId) : getAccounts(req.userId).find((a) => a.exchange === 'paper');
    if (!account) return res.status(400).json({ error: 'No trading account available' });
    const position = await openPosition({
      userId: req.userId,
      accountId: account.id,
      symbol,
      side,
      margin: Number(margin) || 100,
      leverage: Number(leverage) || 1,
      stopLoss: stopLoss ? Number(stopLoss) : null,
      takeProfit: takeProfit ? Number(takeProfit) : null,
      trailingStop: trailingStop ? Number(trailingStop) : null,
    });
    res.status(201).json({ position });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/positions/:id/close', async (req, res) => {
  const p = store.find('positions', (x) => x.id === req.params.id && x.userId === req.userId);
  if (!p) return res.status(404).json({ error: 'Position not found' });
  try {
    const closed = await closePosition(p.id, 'manual');
    res.json({ position: closed });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.patch('/positions/:id', (req, res) => {
  const p = store.find('positions', (x) => x.id === req.params.id && x.userId === req.userId);
  if (!p) return res.status(404).json({ error: 'Position not found' });
  const { stopLoss, takeProfit, trailingStop } = req.body || {};
  const updated = store.update('positions', p.id, {
    ...(stopLoss !== undefined ? { stopLoss: stopLoss === null ? null : Number(stopLoss) } : {}),
    ...(takeProfit !== undefined ? { takeProfit: takeProfit === null ? null : Number(takeProfit) } : {}),
    ...(trailingStop !== undefined ? { trailingStop: trailingStop === null ? null : Number(trailingStop) } : {}),
  });
  res.json({ position: updated });
});

// ------------------------------- orders -------------------------------
router.get('/orders', (req, res) => {
  const list = store
    .filter('orders', (o) => o.userId === req.userId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 200);
  res.json({ orders: list });
});

// ------------------------------- portfolio -------------------------------
router.get('/portfolio', (req, res) => {
  const accounts = getAccounts(req.userId);
  const p = getPortfolio(req.userId);
  const openPositions = store
    .filter('positions', (x) => x.userId === req.userId && x.status === 'open')
    .map((pos) => ({ ...pos, markPrice: market.getPrice(pos.symbol) }));
  const bots = store.filter('bots', (b) => b.userId === req.userId);
  res.json({
    portfolio: p,
    accounts: accounts.map((a) => ({ id: a.id, exchange: a.exchange, label: a.label, equity: +accountEquity(a).toFixed(2) })),
    positions: openPositions,
    botsSummary: {
      total: bots.length,
      running: bots.filter((b) => b.status === 'running').length,
      pnl: +bots.reduce((s, b) => s + (b.stats?.pnl || 0), 0).toFixed(2),
    },
  });
});

router.get('/portfolio/equity-curve', (req, res) => {
  res.json({ curve: getEquityCurve(req.userId, Number(req.query.points) || 60) });
});

router.get('/portfolio/allocation', (req, res) => {
  const accounts = getAccounts(req.userId);
  const balances = {};
  for (const a of accounts) {
    for (const [asset, qty] of Object.entries(a.balances || {})) {
      balances[asset] = (balances[asset] || 0) + qty;
    }
  }
  const allocation = Object.entries(balances).map(([asset, qty]) => {
    const price = asset === 'USDT' ? 1 : market.getPrice(`${asset}/USDT`) || 0;
    return { asset, qty, value: +(qty * price).toFixed(2) };
  });
  const total = allocation.reduce((s, a) => s + a.value, 0) || 1;
  res.json({
    allocation: allocation
      .map((a) => ({ ...a, pct: +((a.value / total) * 100).toFixed(2) }))
      .sort((a, b) => b.value - a.value),
  });
});

export { SUPPORTED_EXCHANGES };
export default router;
