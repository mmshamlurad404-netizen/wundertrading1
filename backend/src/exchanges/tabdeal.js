import { httpJson, ExchangeError, splitPair, toFixedTrim, urlEncode, hmacSha256Hex } from './sign.js';

// Tabdeal (Iran). Spot + futures APIs, Binance-compatible signing.
// Auth: header `X-MBX-APIKEY`; `signature` = HMAC-SHA256(secret, query-with-timestamp).
// GET endpoints live under /r/api/v1, write endpoints under /api/v1.
const BASE = 'https://api.tabdeal.org';

function toTabdeal(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}${quote}`.toUpperCase();
}

async function signed(creds, path, { method = 'GET', params = {} } = {}) {
  const query = urlEncode({ ...params, timestamp: Date.now() });
  const signature = hmacSha256Hex(creds.apiSecret, query);
  const prefix = method === 'GET' ? '/r' : '';
  const url = `${BASE}${prefix}${path}?${query}&signature=${signature}`;
  const res = await httpJson(url, { method, headers: { 'X-MBX-APIKEY': creds.apiKey } });
  const data = res.data;
  if (!res.ok || (data && data.code && Number(data.code) !== 200 && data.code !== 'OK')) {
    throw new ExchangeError(data?.msg || data?.message || `Tabdeal request failed (${res.status})`, {
      exchange: 'tabdeal',
      status: res.status,
      code: data?.code,
      body: data,
    });
  }
  return data;
}

export const tabdeal = {
  id: 'tabdeal',
  name: 'Tabdeal',
  supports: { spot: true, futures: false },
  requiresSecret: true,
  requiresPassphrase: false,
  verified: true,
  exSymbol: toTabdeal,

  async testConnection(creds) {
    const balances = await this.getBalance(creds);
    return { ok: true, balances, message: 'Connected to Tabdeal (spot)' };
  },

  async getBalance(creds) {
    const data = await signed(creds, '/api/v1/account');
    const out = {};
    for (const b of data?.balances || []) {
      const total = Number(b.free || 0) + Number(b.locked || 0);
      if (total > 0) out[String(b.asset).toUpperCase()] = total;
    }
    return out;
  },

  async getPrice(pair) {
    const symbol = toTabdeal(pair);
    const { data } = await httpJson(`${BASE}/r/api/v1/depth?symbol=${symbol}`);
    const bid = Number(data?.bids?.[0]?.[0] || 0);
    const ask = Number(data?.asks?.[0]?.[0] || 0);
    return bid && ask ? (bid + ask) / 2 : bid || ask || 0;
  },

  async setLeverage() {
    return { skipped: true };
  },

  async placeOrder(creds, intent) {
    const params = {
      symbol: toTabdeal(intent.symbol),
      side: intent.side === 'buy' ? 'BUY' : 'SELL',
      type: intent.type === 'limit' ? 'LIMIT' : 'MARKET',
      quantity: toFixedTrim(intent.qty),
    };
    if (intent.type === 'limit') params.price = toFixedTrim(intent.price);
    const data = await signed(creds, '/api/v1/order', { method: 'POST', params });
    return {
      orderId: String(data?.orderId || data?.id || ''),
      fillPrice: Number(data?.price || data?.avgPrice || intent.price || 0),
      qty: Number(data?.executedQty || data?.quantity || intent.qty),
      status: data?.status || 'submitted',
      raw: data,
    };
  },

  async cancelOrder(creds, { orderId, symbol }) {
    return signed(creds, '/api/v1/order', {
      method: 'DELETE',
      params: { orderId, symbol: toTabdeal(symbol) },
    });
  },

  async getPositions() {
    return [];
  },
};

export default tabdeal;
