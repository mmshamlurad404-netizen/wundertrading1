import { store } from './store.js';
import { market } from './market.js';
import { marketData } from './marketData.js';
import { simulateFill, roundTripPnl, DEFAULT_FEE_RATE } from './execution.js';
import { queueUserEmail } from './mailer.js';
import { encryptSecret, decryptSecret, maskValue, last4 } from './secret.js';
import {
  getAdapter,
  executeLive,
  fetchLiveBalance,
  fetchLivePositions,
  pairToExchangeSymbol,
} from './exchanges/index.js';

export const STARTING_BALANCE = 100000;

export function createAccount(
  userId,
  {
    exchange,
    label,
    mode = 'demo',
    apiKey,
    apiSecret,
    passphrase,
    testnet = false,
    marketType = 'futures',
  } = {}
) {
  const isPaper = exchange === 'paper';
  const isLive = !isPaper && mode === 'live';
  // Paper and third-party demo accounts trade against a simulated balance.
  const simBalance = isPaper ? STARTING_BALANCE : 25000;
  const startsFunded = !isLive;
  const account = store.insert('exchanges', {
    userId,
    exchange,
    label: label || exchange,
    mode: isPaper ? 'demo' : mode,
    marketType,
    testnet: Boolean(testnet),
    live: isLive,
    ledger: isLive ? 'external' : 'internal',
    apiKeyEnc: apiKey ? encryptSecret(apiKey) : null,
    apiSecretEnc: apiSecret ? encryptSecret(apiSecret) : null,
    passphraseEnc: passphrase ? encryptSecret(passphrase) : null,
    apiKeyMasked: apiKey ? maskValue(apiKey) : isPaper ? 'demo-key' : null,
    apiSecretMasked: apiSecret ? maskValue(apiSecret) : null,
    keyLast4: apiKey ? last4(apiKey) : isPaper ? 'demo' : '----',
    passphraseSet: Boolean(passphrase),
    connected: true,
    initialBalance: startsFunded ? simBalance : 0,
    balances: startsFunded ? { USDT: simBalance } : {},
    equity: startsFunded ? simBalance : 0,
    createdAt: Date.now(),
  });
  return account;
}

export function getAccountSecrets(account) {
  if (!account) return null;
  return {
    apiKey: decryptSecret(account.apiKeyEnc),
    apiSecret: decryptSecret(account.apiSecretEnc),
    passphrase: decryptSecret(account.passphraseEnc),
  };
}

export function getAccounts(userId) {
  return store.filter('exchanges', (a) => a.userId === userId);
}

export function getAccount(userId, accountId) {
  const a = store.find('exchanges', (x) => x.id === accountId && x.userId === userId);
  return a || null;
}

export function accountEquity(account) {
  if (!account) return 0;
  // Live accounts mirror the exchange wallet; equity is synced from the venue.
  if (account.mode === 'live') {
    const synced = Number(account.equity || 0);
    if (synced > 0) return synced;
    let value = 0;
    for (const [asset, qty] of Object.entries(account.balances || {})) {
      if (asset === 'USDT') value += qty;
      else {
        const price = market.getPrice(`${asset}/USDT`);
        value += price ? price * qty : 0;
      }
    }
    return value;
  }
  let equity = 0;
  for (const [asset, qty] of Object.entries(account.balances || {})) {
    if (asset === 'USDT') equity += qty;
    else {
      const price = market.getPrice(`${asset}/USDT`);
      equity += price ? price * qty : 0;
    }
  }
  const openPositions = store.filter(
    'positions',
    (p) => p.accountId === account.id && p.status === 'open'
  );
  // open positions lock margin that is still part of equity, plus unrealized PnL
  equity += openPositions.reduce((s, p) => s + (p.margin || 0) + (p.unrealizedPnl || 0), 0);
  return equity;
}

export function positionUnrealized(p) {
  const price = market.getPrice(p.symbol);
  if (!price) return 0;
  const dir = p.side === 'long' ? 1 : -1;
  return dir * (price - p.entryPrice) * p.size;
}

// size here is base-asset quantity * entry handled as notional? We use:
// notional = size; margin = notional / leverage.
export async function openPosition({ userId, accountId, botId = null, symbol, side, margin, leverage = 1, stopLoss, takeProfit, trailingStop, source = 'manual' }) {
  const account = getAccount(userId, accountId);
  if (!account) throw new Error('Account not found');
  if (margin <= 0) throw new Error('Margin must be positive');

  if (account.mode === 'live') {
    return openLivePosition({ account, userId, botId, symbol, side, margin, leverage, stopLoss, takeProfit, trailingStop, source });
  }

  const price = market.getPrice(symbol);
  if (!price) throw new Error('Unknown market');
  const notional = margin * leverage;
  // Fill against real depth when available, otherwise apply slippage.
  const book = await marketData.getOrderBook(symbol, 20);
  const fill = simulateFill({
    side: side === 'long' ? 'buy' : 'sell',
    notional,
    referencePrice: price,
    book,
  });
  if ((account.balances.USDT || 0) < margin + fill.fee) throw new Error('Insufficient USDT balance');

  account.balances.USDT -= margin + fill.fee;
  const size = fill.qty;

  const position = store.insert('positions', {
    userId,
    accountId,
    botId,
    symbol,
    side,
    size,
    notional: fill.notional,
    margin,
    leverage,
    entryPrice: fill.fillPrice,
    entryFee: fill.fee,
    fillSource: fill.source,
    slippageBps: fill.slippageBps,
    stopLoss: stopLoss ?? null,
    takeProfit: takeProfit ?? null,
    trailingStop: trailingStop ?? null,
    trailingPeak: fill.fillPrice,
    unrealizedPnl: 0,
    realizedPnl: 0,
    status: 'open',
    mode: 'paper',
    source,
    openedAt: Date.now(),
  });

  store.insert('orders', {
    userId,
    accountId,
    botId,
    symbol,
    side: side === 'long' ? 'buy' : 'sell',
    type: 'market',
    qty: size,
    price,
    filledPrice: fill.fillPrice,
    fee: fill.fee,
    feeRate: fill.feeRate,
    status: 'filled',
    reduceOnly: false,
    source,
    mode: 'paper',
  });

  log(userId, botId, 'info', `Opened ${side.toUpperCase()} ${symbol} @ ${fill.fillPrice.toFixed(2)} (${leverage}x, margin ${margin.toFixed(2)}, fee ${fill.fee.toFixed(2)})`);
  return position;
}

async function openLivePosition({ account, userId, botId, symbol, side, margin, leverage, stopLoss, takeProfit, trailingStop, source }) {
  const adapter = getAdapter(account.exchange);
  if (!adapter) throw new Error(`Live trading is not supported for ${account.exchange}`);
  if (account.marketType === 'spot' && side === 'short') {
    throw new Error('Shorting is not available on spot markets');
  }
  const secrets = getAccountSecrets(account);
  // Token-only venues (Nobitex, Wallex, Bitpin, OMPFinex, Abantether) do not
  // use an API secret, so only require it when the adapter says it does.
  if (!secrets?.apiKey) throw new Error('Missing exchange API credentials');
  if (adapter.requiresSecret !== false && !secrets?.apiSecret) {
    throw new Error(`Missing API secret for ${adapter.name}`);
  }

  let price = market.getPrice(symbol);
  if (!price && adapter.getPrice) price = await adapter.getPrice(symbol, { testnet: account.testnet, marketType: account.marketType });
  if (!price) throw new Error('Unknown market price');

  const effLeverage = account.marketType === 'spot' ? 1 : Math.max(1, Number(leverage) || 1);
  const notional = margin * effLeverage;
  const qty = notional / price;

  const clientOrderId = `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fill = await executeLive(
    account,
    {
      symbol,
      side: side === 'long' ? 'buy' : 'sell',
      type: 'market',
      qty,
      notional,
      leverage: effLeverage,
      takeProfit,
      stopLoss,
      clientOrderId,
    },
    secrets
  );

  const entryPrice = Number(fill.fillPrice) > 0 ? Number(fill.fillPrice) : price;
  const filledSize = Number(fill.qty) > 0 ? Number(fill.qty) : qty;

  // Exchange-side protection for venues that need separate orders (Binance futures).
  try {
    await placeLiveProtection(account, secrets, { symbol, side: side === 'long' ? 'buy' : 'sell', takeProfit, stopLoss });
  } catch (err) {
    log(userId, botId, 'warning', `Could not place exchange protection for ${symbol}: ${err.message}`);
  }

  const position = store.insert('positions', {
    userId,
    accountId: account.id,
    botId,
    symbol,
    side,
    size: filledSize,
    notional: filledSize * entryPrice,
    margin,
    leverage: effLeverage,
    entryPrice,
    stopLoss: stopLoss ?? null,
    takeProfit: takeProfit ?? null,
    trailingStop: trailingStop ?? null,
    trailingPeak: entryPrice,
    unrealizedPnl: 0,
    realizedPnl: 0,
    status: 'open',
    mode: 'live',
    exchange: account.exchange,
    exchangeOrderId: fill.orderId || null,
    clientOrderId,
    source,
    openedAt: Date.now(),
  });

  store.insert('orders', {
    userId,
    accountId: account.id,
    botId,
    symbol,
    side: side === 'long' ? 'buy' : 'sell',
    type: 'market',
    qty: filledSize,
    price: entryPrice,
    filledPrice: entryPrice,
    status: 'filled',
    reduceOnly: false,
    source,
    mode: 'live',
    exchangeOrderId: fill.orderId || null,
    clientOrderId,
  });

  log(userId, botId, 'success', `LIVE ${side.toUpperCase()} ${symbol} filled @ ${entryPrice} (${effLeverage}x, order ${fill.orderId})`);
  return position;
}

export async function closePosition(positionId, reason = 'manual', accountOverride = null) {
  const p = store.find('positions', (x) => x.id === positionId);
  if (!p || p.status !== 'open') return null;
  const account = accountOverride || findAccountById(p.accountId);

  if (p.mode === 'live' || account?.mode === 'live') {
    return closeLivePosition(p, account, reason);
  }

  const price = market.getPrice(p.symbol);
  const book = await marketData.getOrderBook(p.symbol, 20);
  const fill = simulateFill({
    side: p.side === 'long' ? 'sell' : 'buy',
    qty: p.size,
    referencePrice: price,
    book,
  });
  const exitPrice = fill.fillPrice;
  const entryFee = p.entryFee || 0;
  const pnl = roundTripPnl({
    side: p.side,
    entryPrice: p.entryPrice,
    exitPrice,
    size: p.size,
    entryFee,
    exitFee: fill.fee,
  });
  if (account) {
    account.balances.USDT = (account.balances.USDT || 0) + p.margin + pnl + entryFee;
    store.markDirty();
  }
  const updated = store.update('positions', positionId, {
    status: 'closed',
    closedAt: Date.now(),
    closePrice: exitPrice,
    exitFee: fill.fee,
    realizedPnl: pnl,
    unrealizedPnl: 0,
    closeReason: reason,
  });
  store.insert('orders', {
    userId: p.userId,
    accountId: p.accountId,
    botId: p.botId,
    symbol: p.symbol,
    side: p.side === 'long' ? 'sell' : 'buy',
    type: 'market',
    qty: p.size,
    price,
    filledPrice: exitPrice,
    fee: fill.fee,
    feeRate: fill.feeRate,
    status: 'filled',
    reduceOnly: true,
    source: reason,
    mode: 'paper',
  });
  log(p.userId, p.botId, pnl >= 0 ? 'success' : 'warning', `Closed ${p.side.toUpperCase()} ${p.symbol} @ ${exitPrice.toFixed(2)} => PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${reason})`);
  return updated;
}

async function closeLivePosition(p, account, reason) {
  if (!account) throw new Error('Account not found');
  const adapter = getAdapter(account.exchange);
  if (!adapter) throw new Error(`Live trading is not supported for ${account.exchange}`);
  const secrets = getAccountSecrets(account);
  if (!secrets?.apiKey) throw new Error('Missing exchange API credentials');

  const clientOrderId = `ntc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fill = await executeLive(
    account,
    {
      symbol: p.symbol,
      side: p.side === 'long' ? 'sell' : 'buy',
      type: 'market',
      qty: p.size,
      reduceOnly: true,
      closePosition: true,
      clientOrderId,
    },
    secrets
  );

  const price = Number(fill.fillPrice) > 0 ? Number(fill.fillPrice) : market.getPrice(p.symbol) || p.entryPrice;
  const dir = p.side === 'long' ? 1 : -1;
  // Live PnL is authoritative on the exchange; estimate locally for display.
  const pnl = Number(fill.pnl) || dir * (price - p.entryPrice) * p.size;

  const updated = store.update('positions', p.id, {
    status: 'closed',
    closedAt: Date.now(),
    closePrice: price,
    realizedPnl: pnl,
    unrealizedPnl: 0,
    closeReason: reason,
    exchangeOrderId: fill.orderId || p.exchangeOrderId || null,
  });
  store.insert('orders', {
    userId: p.userId,
    accountId: p.accountId,
    botId: p.botId,
    symbol: p.symbol,
    side: p.side === 'long' ? 'sell' : 'buy',
    type: 'market',
    qty: p.size,
    price,
    filledPrice: price,
    status: 'filled',
    reduceOnly: true,
    source: reason,
    mode: 'live',
    exchangeOrderId: fill.orderId || null,
    clientOrderId,
  });
  log(p.userId, p.botId, pnl >= 0 ? 'success' : 'warning', `LIVE closed ${p.side.toUpperCase()} ${p.symbol} @ ${price} => PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${reason})`);
  return updated;
}

function findAccountById(id) {
  return store.find('exchanges', (a) => a.id === id);
}

export async function updateOpenPositions() {
  const open = store.filter('positions', (p) => p.status === 'open');
  for (const p of open) {
    const price = market.getPrice(p.symbol);
    if (!price) continue;
    const dir = p.side === 'long' ? 1 : -1;
    const pnl = dir * (price - p.entryPrice) * p.size;
    const patch = { unrealizedPnl: pnl, markPrice: price };

    // Live futures venues keep protective orders on the exchange; spot venues
    // (all Iranian providers) have no stop orders, so we manage protection here.
    let exchangeProtection = false;
    if (p.mode === 'live') {
      const account = findAccountById(p.accountId);
      const adapter = account ? getAdapter(account.exchange) : null;
      exchangeProtection = Boolean(adapter?.placeProtection) && account?.marketType === 'futures';
    }

    // Trailing stops are always managed locally (they are not universally
    // exchange-native), even when fixed TP/SL live on the venue.
    if (p.trailingStop) {
      const dist = p.trailingStop;
      if (p.side === 'long') {
        p.trailingPeak = Math.max(p.trailingPeak || price, price);
        if (price <= p.trailingPeak * (1 - dist / 100)) {
          store.update('positions', p.id, { ...patch, trailingPeak: p.trailingPeak });
          await closePosition(p.id, 'trailing-stop');
          continue;
        }
      } else {
        p.trailingPeak = Math.min(p.trailingPeak || price, price);
        if (price >= p.trailingPeak * (1 + dist / 100)) {
          store.update('positions', p.id, { ...patch, trailingPeak: p.trailingPeak });
          await closePosition(p.id, 'trailing-stop');
          continue;
        }
      }
      patch.trailingPeak = p.trailingPeak;
    }

    // When the venue holds native TP/SL, do not duplicate them locally.
    if (!exchangeProtection) {
      if (p.stopLoss) {
        if ((p.side === 'long' && price <= p.stopLoss) || (p.side === 'short' && price >= p.stopLoss)) {
          store.update('positions', p.id, patch);
          await closePosition(p.id, 'stop-loss');
          continue;
        }
      }
      if (p.takeProfit) {
        if ((p.side === 'long' && price >= p.takeProfit) || (p.side === 'short' && price <= p.takeProfit)) {
          store.update('positions', p.id, patch);
          await closePosition(p.id, 'take-profit');
          continue;
        }
      }
    }
    // liquidation
    if (pnl <= -p.margin * 0.95) {
      store.update('positions', p.id, patch);
      await closePosition(p.id, 'liquidation');
      continue;
    }
    store.update('positions', p.id, patch);
  }
}

// Pull balances and open positions from the venue so the dashboard mirrors reality.
export async function syncLiveAccount(account) {
  if (!account || account.mode !== 'live') return;
  const secrets = getAccountSecrets(account);
  if (!secrets?.apiKey) return;
  let balances = null;
  let positions = null;
  try {
    [balances, positions] = await Promise.all([
      fetchLiveBalance(account, secrets).catch(() => null),
      fetchLivePositions(account, secrets).catch(() => null),
    ]);
  } catch {
    return;
  }
  if (balances) {
    account.balances = balances;
    let equity = 0;
    for (const [asset, qty] of Object.entries(balances)) {
      if (asset === 'USDT') equity += qty;
      else {
        const price = market.getPrice(`${asset}/USDT`);
        equity += price ? price * qty : 0;
      }
    }
    account.equity = equity;
    account.syncedAt = Date.now();
    store.markDirty();
  }
  if (shouldReconcilePositions(account, positions)) reconcileLivePositions(account, positions);
}

// Spot venues expose no exchange-side "position" list, so an empty (or missing)
// list must never be interpreted as "the user has no positions". Only futures
// markets keep a real position book that the local state can be reconciled to.
export function shouldReconcilePositions(account, exchangePositions) {
  if (!account || account.mode !== 'live') return false;
  if (account.marketType === 'spot') return false;
  return Array.isArray(exchangePositions);
}

export function reconcileLivePositions(account, exchangePositions) {
  if (!shouldReconcilePositions(account, exchangePositions)) return;
  const adapter = getAdapter(account.exchange);
  if (!adapter) return;
  const openSymbols = new Set();
  for (const pos of exchangePositions) {
    if (pos.side === 'flat') continue;
    openSymbols.add(pos.symbol);
  }
  const local = store.filter('positions', (p) => p.accountId === account.id && p.status === 'open');
  const GRACE_MS = 30_000;
  for (const p of local) {
    const exSym = pairToExchangeSymbol(adapter, p.symbol, account.marketType);
    if (openSymbols.has(exSym)) continue;
    if (Date.now() - (p.openedAt || 0) < GRACE_MS) continue;
    const price = market.getPrice(p.symbol) || p.entryPrice;
    const dir = p.side === 'long' ? 1 : -1;
    const pnl = dir * (price - p.entryPrice) * p.size;
    store.update('positions', p.id, {
      status: 'closed',
      closedAt: Date.now(),
      closePrice: price,
      realizedPnl: pnl,
      unrealizedPnl: 0,
      closeReason: 'exchange-close',
    });
    log(p.userId, p.botId, 'info', `Exchange closed ${p.side.toUpperCase()} ${p.symbol} (detected via sync)`);
  }
}

export function log(userId, botId, level, message) {
  store.insert('logs', { userId, botId: botId || null, level, message });
  // cap logs
  const all = store.data.logs;
  if (all.length > 4000) all.splice(0, all.length - 4000);
  if (level === 'success' || level === 'warning' || level === 'error') {
    const title = level === 'success' ? 'Trade executed' : level === 'error' ? 'Error' : 'Alert';
    store.insert('notifications', {
      userId,
      title,
      body: message,
      read: false,
      botId: botId || null,
    });
    queueUserEmail(userId, `NebulaTrade: ${title}`, message);
  }
}

export function getPortfolio(userId) {
  const accounts = getAccounts(userId);
  const open = store.filter('positions', (p) => p.userId === userId && p.status === 'open');
  const closed = store.filter('positions', (p) => p.userId === userId && p.status === 'closed');
  const equity = accounts.reduce((s, a) => s + accountEquity(a), 0);
  const balances = {};
  for (const a of accounts) {
    for (const [asset, qty] of Object.entries(a.balances || {})) {
      balances[asset] = (balances[asset] || 0) + qty;
    }
  }
  const unrealized = open.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const realized = closed.reduce((s, p) => s + (p.realizedPnl || 0), 0);
  const initial = accounts.reduce((s, a) => s + (a.initialBalance ?? STARTING_BALANCE), 0);
  return {
    equity,
    balances,
    unrealizedPnl: unrealized,
    realizedPnl: realized,
    totalPnl: unrealized + realized,
    totalPnlPct: initial ? ((unrealized + realized) / initial) * 100 : 0,
    openPositions: open.length,
    totalTrades: closed.length + open.length,
    winRate: computeWinRate(closed),
  };
}

function computeWinRate(closed) {
  if (!closed.length) return 0;
  const wins = closed.filter((p) => (p.realizedPnl || 0) > 0).length;
  return (wins / closed.length) * 100;
}

// equity curve for charts: reconstructs from closed trades over time
export function getEquityCurve(userId, points = 60) {
  const accounts = getAccounts(userId);
  const start = accounts.reduce((s, a) => s + (a.initialBalance ?? STARTING_BALANCE), 0) || STARTING_BALANCE;
  const closed = store
    .filter('positions', (p) => p.userId === userId && p.status === 'closed')
    .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
  const now = Date.now();
  const span = 7 * 24 * 3600 * 1000;
  const step = span / points;
  const curve = [];
  let idx = 0;
  let running = start;
  for (let i = 0; i < points; i++) {
    const t = now - span + i * step;
    while (idx < closed.length && (closed[idx].closedAt || 0) <= t) {
      running += closed[idx].realizedPnl || 0;
      idx++;
    }
    curve.push({ t: Math.round(t), equity: +running.toFixed(2) });
  }
  const live = accountEquity(accounts.find((a) => a.exchange === 'paper')) || running;
  if (curve.length) curve[curve.length - 1] = { ...curve[curve.length - 1], equity: +live.toFixed(2) };
  return curve;
}
