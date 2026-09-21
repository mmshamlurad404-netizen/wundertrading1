import {
  hmacSha256Hex,
  httpJson,
  ExchangeError,
  splitPair,
  toFixedTrim,
} from './sign.js';

const BASE = {
  live: 'https://api.bybit.com',
  testnet: 'https://api-testnet.bybit.com',
};

function symbolOf(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}${quote}`.toUpperCase();
}

async function signedRequest(creds, opts, { method = 'GET', path, query = {}, body }) {
  const base = opts.testnet ? BASE.testnet : BASE.live;
  const ts = Date.now().toString();
  const recvWindow = '5000';
  const queryString = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const bodyString = body ? JSON.stringify(body) : '';
  const payload = `${ts}${creds.apiKey}${recvWindow}${method === 'GET' ? queryString : bodyString}`;
  const sign = hmacSha256Hex(creds.apiSecret, payload);
  const headers = {
    'X-BAPI-API-KEY': creds.apiKey,
    'X-BAPI-TIMESTAMP': ts,
    'X-BAPI-RECV-WINDOW': recvWindow,
    'X-BAPI-SIGN': sign,
    'Content-Type': 'application/json',
  };
  const url = `${base}${path}${queryString ? `?${queryString}` : ''}`;
  const res = await httpJson(url, { method, headers, body: bodyString || undefined });
  if (!res.ok || (res.data && res.data.retCode !== 0)) {
    throw new ExchangeError(res.data?.retMsg || `Bybit request failed (${res.status})`, {
      exchange: 'bybit',
      status: res.status,
      code: res.data?.retCode,
      body: res.data,
    });
  }
  return res.data.result;
}

export const bybit = {
  id: 'bybit',
  name: 'Bybit',
  supports: { spot: true, futures: true },
  requiresPassphrase: false,
  exSymbol: symbolOf,

  async testConnection(creds, opts) {
    const balances = await this.getBalance(creds, opts);
    return {
      ok: true,
      balances,
      message: `Connected to Bybit ${opts.testnet ? 'Testnet' : 'Live'} (${opts.marketType})`,
    };
  },

  async getBalance(creds, opts = {}) {
    let result;
    try {
      result = await signedRequest(creds, opts, {
        path: '/v5/account/wallet-balance',
        query: { accountType: 'UNIFIED' },
      });
    } catch (err) {
      result = await signedRequest(creds, opts, {
        path: '/v5/account/wallet-balance',
        query: { accountType: 'SPOT' },
      });
    }
    const out = {};
    for (const account of result?.list || []) {
      for (const coin of account.coin || []) {
        const total = Number(coin.walletBalance ?? coin.equity ?? 0) + Number(coin.locked || 0);
        const value = Number(coin.usdValue || 0);
        if (total > 0) out[coin.coin] = total;
        else if (value > 0 && coin.coin === 'USDT') out[coin.coin] = value;
      }
    }
    return out;
  },

  async setLeverage(creds, { symbol, leverage, ...opts }) {
    if ((opts.marketType || 'futures') !== 'linear' && (opts.marketType || 'futures') !== 'futures') {
      return { skipped: true };
    }
    try {
      return await signedRequest(creds, opts, {
        method: 'POST',
        path: '/v5/position/set-leverage',
        body: {
          category: 'linear',
          symbol: symbolOf(symbol),
          buyLeverage: String(leverage),
          sellLeverage: String(leverage),
        },
      });
    } catch (err) {
      return { warning: err.message };
    }
  },

  async placeOrder(creds, intent, opts = {}) {
    const category = (opts.marketType || 'futures') === 'spot' ? 'spot' : 'linear';
    const body = {
      category,
      symbol: symbolOf(intent.symbol),
      side: intent.side === 'buy' ? 'Buy' : 'Sell',
      orderType: intent.type === 'limit' ? 'Limit' : 'Market',
      qty: toFixedTrim(intent.qty),
    };
    if (intent.type === 'limit') body.price = toFixedTrim(intent.price);
    if (intent.reduceOnly || intent.closePosition) body.reduceOnly = true;
    if (intent.takeProfit) {
      body.takeProfit = toFixedTrim(intent.takeProfit);
      body.tpTriggerBy = 'LastPrice';
    }
    if (intent.stopLoss) {
      body.stopLoss = toFixedTrim(intent.stopLoss);
      body.slTriggerBy = 'LastPrice';
    }
    const result = await signedRequest(creds, opts, { method: 'POST', path: '/v5/order/create', body });
    const orderId = result?.orderId;
    // market fills are async; try to read the average price shortly after
    let fillPrice = Number(intent.price || 0);
    let qty = Number(intent.qty);
    try {
      const realtime = await signedRequest(creds, opts, {
        path: '/v5/order/realtime',
        query: { category, symbol: symbolOf(intent.symbol), orderId },
      });
      const order = realtime?.list?.[0];
      if (order) {
        fillPrice = Number(order.avgPrice || order.price || fillPrice) || fillPrice;
        qty = Number(order.cumExecQty || order.qty || qty) || qty;
      }
    } catch {
      /* fill details unavailable; caller uses intent price */
    }
    return { orderId: String(orderId), fillPrice, qty, status: 'submitted', raw: result };
  },

  async cancelOrder(creds, { orderId, symbol, ...opts }) {
    const category = (opts.marketType || 'futures') === 'spot' ? 'spot' : 'linear';
    return signedRequest(creds, opts, {
      method: 'POST',
      path: '/v5/order/cancel',
      body: { category, symbol: symbolOf(symbol), orderId },
    });
  },

  async getPositions(creds, opts = {}) {
    if ((opts.marketType || 'futures') === 'spot') return [];
    const result = await signedRequest(creds, opts, {
      path: '/v5/position/list',
      query: { category: 'linear', settleCoin: 'USDT' },
    });
    return (result?.list || [])
      .filter((p) => Number(p.size) > 0)
      .map((p) => ({
        symbol: p.symbol,
        side: String(p.side).toLowerCase() === 'buy' ? 'long' : 'short',
        size: Number(p.size),
        entryPrice: Number(p.avgPrice),
        markPrice: Number(p.markPrice),
        unrealizedPnl: Number(p.unrealisedPnl ?? p.unrealizedPnl ?? 0),
      }));
  },
};

export default bybit;
