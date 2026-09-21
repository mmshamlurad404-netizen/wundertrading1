import { httpJson, ExchangeError, splitPair, toFixedTrim } from './sign.js';

// Bitpin (Iran). Spot only. Auth: `Authorization: Api-Key <api-key>`.
// NOTE: api.bitpin.org / api.bitpin.ir are Cloudflare-protected and could not be
// verified from the deployment network. Endpoints follow Bitpin's v1 API.
const BASES = ['https://api.bitpin.org', 'https://api.bitpin.ir'];

function toBitpin(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}_${quote}`.toUpperCase();
}

function headersFor(creds, json = false) {
  const h = { Authorization: `Api-Key ${creds.apiKey}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function request(creds, path, { method = 'GET', body, auth = true } = {}) {
  let lastError;
  for (const base of BASES) {
    try {
      const res = await httpJson(`${base}${path}`, {
        method,
        headers: auth ? headersFor(creds, Boolean(body)) : { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = res.data;
      if (!res.ok || data?.detail || (data?.code && data.code >= 400)) {
        throw new ExchangeError(data?.detail || data?.message || `Bitpin request failed (${res.status})`, {
          exchange: 'bitpin',
          status: res.status,
          code: data?.code,
          body: data,
        });
      }
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function midPrice(orderbook) {
  const bidRaw = orderbook?.bids?.[0];
  const askRaw = orderbook?.asks?.[0];
  const bid = Number(Array.isArray(bidRaw) ? bidRaw[0] : bidRaw?.price || 0);
  const ask = Number(Array.isArray(askRaw) ? askRaw[0] : askRaw?.price || 0);
  return bid && ask ? (bid + ask) / 2 : bid || ask || 0;
}

export const bitpin = {
  id: 'bitpin',
  name: 'Bitpin',
  supports: { spot: true, futures: false },
  requiresSecret: false,
  requiresPassphrase: false,
  verified: false,
  exSymbol: toBitpin,

  async testConnection(creds) {
    const balances = await this.getBalance(creds);
    return { ok: true, balances, message: 'Connected to Bitpin (spot)' };
  },

  async getBalance(creds) {
    const data = await request(creds, '/api/v1/wlt/wallets/');
    const rows = Array.isArray(data) ? data : data?.results || [];
    const out = {};
    for (const w of rows) {
      const asset = String(w.currency?.code || w.asset || w.currency || '').toUpperCase();
      const total = Number(w.balance ?? w.amount ?? 0) + Number(w.blocked ?? w.locked ?? 0);
      if (asset && total > 0) out[asset] = total;
    }
    return out;
  },

  async getPrice(pair) {
    const code = toBitpin(pair);
    const data = await request(null, `/api/v1/mth/orderbook/${code}/`, { auth: false });
    return midPrice(data);
  },

  async setLeverage() {
    return { skipped: true };
  },

  async placeOrder(creds, intent) {
    const body = {
      symbol: toBitpin(intent.symbol),
      type: intent.type === 'limit' ? 'limit' : 'market',
      side: intent.side === 'buy' ? 'buy' : 'sell',
      base_amount: toFixedTrim(intent.qty),
    };
    if (intent.type === 'limit') body.price = toFixedTrim(intent.price);
    const data = await request(creds, '/api/v1/odr/orders/', { method: 'POST', body });
    return {
      orderId: String(data?.id || data?.order_id || ''),
      fillPrice: Number(data?.price || intent.price || 0),
      qty: Number(data?.base_amount || intent.qty),
      status: data?.status || 'submitted',
      raw: data,
    };
  },

  async cancelOrder(creds, { orderId }) {
    return request(creds, `/api/v1/odr/orders/${encodeURIComponent(orderId)}/`, { method: 'DELETE' });
  },

  async getPositions() {
    return [];
  },
};

export default bitpin;
