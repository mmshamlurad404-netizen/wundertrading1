import { httpJson, ExchangeError, splitPair, toFixedTrim } from './sign.js';

// Wallex (Iran). Spot only. Auth: `x-api-key: <api-key>`.
const BASE = 'https://api.wallex.ir';

function toWallex(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}${quote}`.toUpperCase();
}

async function authed(creds, path, { method = 'GET', body } = {}) {
  const headers = { 'x-api-key': creds.apiKey };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await httpJson(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.data;
  if (!res.ok || data?.success === false) {
    throw new ExchangeError(data?.message || `Wallex request failed (${res.status})`, {
      exchange: 'wallex',
      status: res.status,
      code: data?.code,
      body: data,
    });
  }
  return data?.result;
}

export const wallex = {
  id: 'wallex',
  name: 'Wallex',
  supports: { spot: true, futures: false },
  requiresSecret: false,
  requiresPassphrase: false,
  verified: true,
  exSymbol: toWallex,

  async testConnection(creds) {
    const balances = await this.getBalance(creds);
    return { ok: true, balances, message: 'Connected to Wallex (spot)' };
  },

  async getBalance(creds) {
    const result = await authed(creds, '/v1/account/balances');
    const source = result?.balances || result || {};
    const out = {};
    for (const [asset, entry] of Object.entries(source)) {
      const total = Number(entry?.value ?? entry) + Number(entry?.locked ?? 0);
      if (Number.isFinite(total) && total > 0) out[asset.toUpperCase()] = total;
    }
    return out;
  },

  async getPrice(pair) {
    const symbol = toWallex(pair);
    const { data } = await httpJson(`${BASE}/v1/depth?symbol=${symbol}`);
    const result = data?.result || {};
    const bid = Number(result.bid?.[0]?.price || 0);
    const ask = Number(result.ask?.[0]?.price || 0);
    if (bid && ask) return (bid + ask) / 2;
    return bid || ask || 0;
  },

  async setLeverage() {
    return { skipped: true };
  },

  async placeOrder(creds, intent) {
    const body = {
      symbol: toWallex(intent.symbol),
      side: intent.side === 'buy' ? 'BUY' : 'SELL',
      type: intent.type === 'limit' ? 'LIMIT' : 'MARKET',
      quantity: toFixedTrim(intent.qty),
    };
    if (intent.type === 'limit') body.price = toFixedTrim(intent.price);
    const result = await authed(creds, '/v1/account/orders', { method: 'POST', body });
    return {
      orderId: String(result?.id || result?.orderId || ''),
      fillPrice: Number(result?.price || intent.price || 0),
      qty: Number(result?.quantity || intent.qty),
      status: result?.status || 'submitted',
      raw: result,
    };
  },

  async cancelOrder(creds, { orderId }) {
    return authed(creds, `/v1/account/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
  },

  async getPositions() {
    return [];
  },
};

export default wallex;
