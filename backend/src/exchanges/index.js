import { binance } from './binance.js';
import { bybit } from './bybit.js';
import { okx } from './okx.js';
import { nobitex } from './nobitex.js';
import { wallex } from './wallex.js';
import { tabdeal } from './tabdeal.js';
import { bitpin } from './bitpin.js';
import { ompfinex } from './ompfinex.js';
import { abantether } from './abantether.js';

// Exchanges with a live trading adapter. Everything else falls back to paper.
export const ADAPTERS = {
  binance,
  bybit,
  okx,
  nobitex,
  wallex,
  tabdeal,
  bitpin,
  ompfinex,
  abantether,
};

export const LIVE_EXCHANGE_IDS = Object.keys(ADAPTERS);

export function getAdapter(exchangeId) {
  return ADAPTERS[String(exchangeId).toLowerCase()] || null;
}

export function isLiveCapable(exchangeId) {
  return Boolean(getAdapter(exchangeId));
}

// A normalized order intent the engine can hand to any adapter.
// { symbol, side:'buy'|'sell', type:'market'|'limit', qty, notional, price,
//   reduceOnly, closePosition, leverage, takeProfit, stopLoss }
export async function executeLive(account, intent, secrets) {
  const adapter = getAdapter(account.exchange);
  if (!adapter) {
    const err = new Error(`No live adapter for ${account.exchange}`);
    err.code = 'NO_ADAPTER';
    throw err;
  }
  const opts = {
    testnet: Boolean(account.testnet),
    marketType: account.marketType === 'spot' ? 'spot' : 'futures',
  };
  const creds = {
    apiKey: secrets.apiKey,
    apiSecret: secrets.apiSecret,
    passphrase: secrets.passphrase,
  };
  if (intent.leverage && intent.leverage > 1) {
    await adapter.setLeverage(creds, { symbol: intent.symbol, leverage: intent.leverage, ...opts });
  }
  return adapter.placeOrder(creds, intent, opts);
}

export async function testExchangeConnection(exchangeId, creds, { testnet = false, marketType = 'futures' } = {}) {
  const adapter = getAdapter(exchangeId);
  if (!adapter) {
    const err = new Error(`Live trading is not supported for ${exchangeId}`);
    err.code = 'NO_ADAPTER';
    throw err;
  }
  return adapter.testConnection(creds, { testnet, marketType });
}

export async function fetchLiveBalance(account, secrets) {
  const adapter = getAdapter(account.exchange);
  if (!adapter) return null;
  const opts = {
    testnet: Boolean(account.testnet),
    marketType: account.marketType === 'spot' ? 'spot' : 'futures',
  };
  return adapter.getBalance({ apiKey: secrets.apiKey, apiSecret: secrets.apiSecret, passphrase: secrets.passphrase }, opts);
}

export async function fetchLivePositions(account, secrets) {
  const adapter = getAdapter(account.exchange);
  if (!adapter || !adapter.getPositions) return null;
  // Spot markets have no exchange-side position book; local spot positions are
  // tracked by the app, so never let an empty list trigger reconciliation.
  if (account.marketType === 'spot') return null;
  const opts = {
    testnet: Boolean(account.testnet),
    marketType: account.marketType === 'spot' ? 'spot' : 'futures',
  };
  return adapter.getPositions(
    { apiKey: secrets.apiKey, apiSecret: secrets.apiSecret, passphrase: secrets.passphrase },
    opts
  );
}

// Attach exchange-side stop-loss / take-profit where the venue supports it.
export async function placeLiveProtection(account, secrets, { symbol, side, takeProfit, stopLoss }) {
  const adapter = getAdapter(account.exchange);
  if (!adapter || !adapter.placeProtection) return [];
  const opts = {
    testnet: Boolean(account.testnet),
    marketType: account.marketType === 'spot' ? 'spot' : 'futures',
  };
  return adapter.placeProtection(
    { apiKey: secrets.apiKey, apiSecret: secrets.apiSecret, passphrase: secrets.passphrase },
    { symbol, side, takeProfit, stopLoss, ...opts }
  );
}

// Map an internal pair to the exchange-specific instrument id.
export function pairToExchangeSymbol(adapter, pair, marketType) {
  if (!adapter) return String(pair).replace('/', '').toUpperCase();
  if (adapter.exSymbol) return adapter.exSymbol(pair, marketType === 'spot' ? 'spot' : 'futures');
  return String(pair).replace('/', '').toUpperCase();
}
