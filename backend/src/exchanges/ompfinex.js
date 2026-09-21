import { httpJson, ExchangeError, splitPair, toFixedTrim } from './sign.js';

// Ompfinex (Iran). Spot only. Auth: `Authorization: Bearer <token>`.
// Ompfinex authenticates with a user access token rather than an API
// key/secret pair, so the platform's "apiKey" field holds that bearer token.
const BASE = 'https://api.ompfinex.com';
let marketCache = { at: 0, map: null };

function toOmpfinex(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}${quote}`.toUpperCase();
}

async function authed(creds, path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${creds.apiKey}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await httpJson(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.data;
  if (!res.ok || (data?.status && data.status !== 'OK')) {
    throw new ExchangeError(data?.message || `Ompfinex request failed (${res.status})`, {
      exchange: 'ompfinex',
      status: res.status,
      code: data?.status,
      body: data,
    });
  }
  return data?.data ?? data;
}

async function marketMap() {
  if (marketCache.map && Date.now() - marketCache.at < 5 * 60 * 1000) return marketCache.map;
  const res = await httpJson(`${BASE}/v1/market/`);
  const rows = res.data?.data || [];
  const map = new Map();
  for (const m of rows) {
    const base = String(m.base_currency?.id || m.base || '').toUpperCase();
    const quote = String(m.quote_currency?.id || m.quote || '').toUpperCase();
    if (base && quote) map.set(`${base}${quote}`, Number(m.id));
  }
  marketCache = { at: Date.now(), map };
  return map;
}

export const ompfinex = {
  id: 'ompfinex',
  name: 'OMPFinex',
  supports: { spot: true, futures: false },
  requiresSecret: false,
  requiresPassphrase: false,
  verified: true,
  exSymbol: toOmpfinex,

  async testConnection(creds) {
    const balances = await this.getBalance(creds);
    return { ok: true, balances, message: 'Connected to OMPFinex (spot)' };
  },

  async getBalance(creds) {
    const data = await authed(creds, '/v1/user/wallet');
    const rows = Array.isArray(data) ? data : data?.wallets || data?.data || [];
    const out = {};
    for (const w of rows) {
      const asset = String(w.currency?.id || w.currency || w.asset || '').toUpperCase();
      const total = Number(w.balance ?? w.amount ?? 0) + Number(w.blocked_balance ?? w.blocked ?? 0);
      if (asset && total > 0) out[asset] = total;
    }
    return out;
  },

  async getPrice(pair) {
    const symbol = toOmpfinex(pair);
    const res = await httpJson(`${BASE}/v1/orderbook/`);
    const book = res.data?.data?.[symbol];
    if (!book) return 0;
    const bid = Number(book.bids?.[0]?.price || 0);
    const ask = Number(book.asks?.[0]?.price || 0);
    return bid && ask ? (bid + ask) / 2 : bid || ask || 0;
  },

  async setLeverage() {
    return { skipped: true };
  },

  async placeOrder(creds, intent) {
    const symbol = toOmpfinex(intent.symbol);
    const map = await marketMap();
    const marketId = map.get(symbol);
    if (!marketId) throw new ExchangeError(`Unknown Ompfinex market ${symbol}`, { exchange: 'ompfinex' });
    const body = {
      market_id: marketId,
      type: intent.side === 'buy' ? 'buy' : 'sell',
      execution: intent.type === 'limit' ? 'LIMIT' : 'MARKET',
      amount: toFixedTrim(intent.qty),
    };
    if (intent.type === 'limit') body.price = toFixedTrim(intent.price);
    const data = await authed(creds, `/v1/market/${marketId}/order`, { method: 'POST', body });
    return {
      orderId: String(data?.id || ''),
      fillPrice: Number(data?.price || intent.price || 0),
      qty: Number(data?.amount || intent.qty),
      status: data?.status || 'submitted',
      raw: data,
    };
  },

  async cancelOrder(creds, { orderId }) {
    return authed(creds, `/v1/user/order?id=${encodeURIComponent(orderId)}`, { method: 'DELETE' });
  },

  async getPositions() {
    return [];
  },
};

export default ompfinex;
