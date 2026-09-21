import { httpJson, ExchangeError, splitPair, toFixedTrim } from './sign.js';

// Nobitex (Iran). Spot only. Auth: `Authorization: Token <api-key>`.
// Primary host is the v2 gateway which is reachable outside Iran as well.
const BASES = ['https://apiv2.nobitex.ir', 'https://api.nobitex.ir'];

async function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt < BASES.length; attempt++) {
    const base = BASES[attempt % BASES.length];
    try {
      const h = { ...headers };
      if (token) h.Authorization = `Token ${token}`;
      const res = await httpJson(`${base}${path}`, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = res.data;
      const failed = !res.ok || (data && data.status && data.status !== 'ok');
      if (failed) {
        throw new ExchangeError(data?.message || data?.detail || `Nobitex request failed (${res.status})`, {
          exchange: 'nobitex',
          status: res.status,
          code: data?.code || data?.status,
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

function toNobitex(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}${quote}`.toUpperCase();
}

export const nobitex = {
  id: 'nobitex',
  name: 'Nobitex',
  supports: { spot: true, futures: false },
  requiresSecret: false,
  requiresPassphrase: false,
  verified: true,
  exSymbol: toNobitex,

  async testConnection(creds) {
    const balances = await this.getBalance(creds);
    return { ok: true, balances, message: 'Connected to Nobitex (spot)' };
  },

  async getBalance(creds) {
    const data = await call('/users/wallets/list', { token: creds.apiKey });
    const out = {};
    for (const w of data?.wallets || []) {
      const total = Number(w.balance || 0) + Number(w.blockedBalance || 0);
      if (total > 0) out[String(w.currency).toUpperCase()] = total;
    }
    return out;
  },

  async getPrice(pair) {
    const { base, quote } = splitPair(pair);
    const data = await call(
      `/market/stats?srcCurrency=${base.toLowerCase()}&dstCurrency=${quote.toLowerCase()}`
    );
    const stat = data?.stats?.[`${base.toLowerCase()}-${quote.toLowerCase()}`];
    return Number(stat?.latest || stat?.bestSell || stat?.bestBuy || 0);
  },

  async setLeverage() {
    return { skipped: true };
  },

  async placeOrder(creds, intent) {
    const { base, quote } = splitPair(intent.symbol);
    const isMarket = intent.type !== 'limit';
    const body = {
      type: intent.side === 'buy' ? 'buy' : 'sell',
      srcCurrency: base.toLowerCase(),
      dstCurrency: quote.toLowerCase(),
      execution: isMarket ? 'market' : 'limit',
    };
    if (isMarket) {
      // Nobitex expects the quote amount for market buys and base amount for sells.
      body.amount = intent.side === 'buy' ? toFixedTrim(intent.notional, 2) : toFixedTrim(intent.qty);
    } else {
      body.amount = toFixedTrim(intent.qty);
      body.price = toFixedTrim(intent.price);
    }
    const data = await call('/market/orders/add', {
      method: 'POST',
      token: creds.apiKey,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const order = data?.order || {};
    return {
      orderId: String(order.id || ''),
      fillPrice: Number(order.price || order.executionPrice || intent.price || 0),
      qty: Number(order.amount || intent.qty),
      status: order.status || 'submitted',
      raw: data,
    };
  },

  async cancelOrder(creds, { orderId }) {
    return call('/market/orders/update-status', {
      method: 'POST',
      token: creds.apiKey,
      headers: { 'Content-Type': 'application/json' },
      body: { order_id: orderId, status: 'canceled' },
    });
  },

  async getPositions() {
    return [];
  },
};

export default nobitex;
