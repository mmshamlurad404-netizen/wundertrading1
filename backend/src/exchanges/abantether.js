import { httpJson, ExchangeError, splitPair, toFixedTrim } from './sign.js';

// Abantether (Iran). OTC spot only. Auth: raw `Authorization: <api-key>`.
// NOTE: heavily UNVERIFIED. The public hosts were intermittently unreachable
// from the deployment network and no official API docs portal was confirmed.
const API = 'https://api.abantether.com';
const MONO = 'https://mono.abantether.com';

function toAbantether(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}${quote}`.toUpperCase();
}

async function call(base, path, { method = 'GET', creds, body } = {}) {
  const headers = {};
  if (creds?.apiKey) headers.Authorization = creds.apiKey;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await httpJson(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.data;
  if (!res.ok || data?.error_message || data?.error_code) {
    throw new ExchangeError(data?.error_message || `Abantether request failed (${res.status})`, {
      exchange: 'abantether',
      status: res.status,
      code: data?.error_code,
      body: data,
    });
  }
  return data?.data ?? data;
}

export const abantether = {
  id: 'abantether',
  name: 'Abantether',
  supports: { spot: true, futures: false },
  requiresSecret: false,
  requiresPassphrase: false,
  verified: false,
  exSymbol: toAbantether,

  async testConnection(creds) {
    const balances = await this.getBalance(creds);
    return { ok: true, balances, message: 'Connected to Abantether (OTC spot)' };
  },

  async getBalance(creds) {
    const data = await call(MONO, '/portfolio/portfolio-balance/', { creds });
    const rows = Array.isArray(data) ? data : data?.balances || [];
    const out = {};
    for (const w of rows) {
      const asset = String(w.coin || w.symbol || w.currency || '').toUpperCase();
      const total = Number(w.balance ?? w.amount ?? 0);
      if (asset && total > 0) out[asset] = total;
    }
    return out;
  },

  async getPrice(pair) {
    const { base } = splitPair(pair);
    const data = await call(MONO, `/api/v1/otc/coin-price/?coin=${encodeURIComponent(base)}`);
    return Number(data?.price || data?.sellPrice || data?.buyPrice || 0);
  },

  async setLeverage() {
    return { skipped: true };
  },

  async placeOrder(creds, intent) {
    const { base, quote } = splitPair(intent.symbol);
    const isLimit = intent.type === 'limit';
    const body = {
      side: intent.side === 'buy' ? 'buy' : 'sell',
      base_symbol: base.toUpperCase(),
      quote_symbol: quote.toUpperCase(),
      volume: toFixedTrim(intent.qty),
    };
    if (isLimit) body.price = toFixedTrim(intent.price);
    const data = await call(API, isLimit ? '/order_handler/orders/otc/limit' : '/order_handler/orders/otc/market', {
      method: 'POST',
      creds,
      body,
    });
    return {
      orderId: String(data?.id || ''),
      fillPrice: Number(data?.price || intent.price || 0),
      qty: Number(data?.volume || intent.qty),
      status: data?.status || 'submitted',
      raw: data,
    };
  },

  async cancelOrder(creds, { orderId }) {
    return call(API, '/otc/orders/cancel', { method: 'POST', creds, body: { id: orderId } });
  },

  async getPositions() {
    return [];
  },
};

export default abantether;
