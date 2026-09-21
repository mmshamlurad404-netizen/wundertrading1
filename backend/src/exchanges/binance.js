import {
  hmacSha256Hex,
  urlEncode,
  httpJson,
  ExchangeError,
  splitPair,
  toFixedTrim,
} from './sign.js';

const BASE = {
  spot: { live: 'https://api.binance.com', testnet: 'https://testnet.binance.vision' },
  futures: { live: 'https://fapi.binance.com', testnet: 'https://testnet.binancefuture.com' },
};

const timeOffsets = {};

function baseFor(marketType, testnet) {
  const key = `${marketType}.${testnet ? 'testnet' : 'live'}`;
  return BASE[marketType][testnet ? 'testnet' : 'live'];
}

function symbolOf(pair) {
  const { base, quote } = splitPair(pair);
  return `${base}${quote}`.toUpperCase();
}

async function timestamp(marketType, testnet) {
  const key = `${marketType}.${testnet ? 't' : 'l'}`;
  const base = baseFor(marketType, testnet);
  if (timeOffsets[key] === undefined) {
    try {
      const path = marketType === 'futures' ? '/fapi/v1/time' : '/api/v3/time';
      const { data } = await httpJson(`${base}${path}`);
      timeOffsets[key] = (data?.serverTime || Date.now()) - Date.now();
    } catch {
      timeOffsets[key] = 0;
    }
  }
  return Date.now() + timeOffsets[key];
}

async function signedRequest(creds, { marketType = 'futures', testnet = false, method = 'GET', path, params = {} }) {
  const base = baseFor(marketType, testnet);
  const ts = await timestamp(marketType, testnet);
  const full = { ...params, timestamp: ts, recvWindow: 10000 };
  const query = urlEncode(full);
  const signature = hmacSha256Hex(creds.apiSecret, query);
  const url = `${base}${path}?${query}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': creds.apiKey };
  let body;
  if (method !== 'GET' && method !== 'DELETE') {
    body = url;
  }
  const res =
    method === 'GET' || method === 'DELETE'
      ? await httpJson(url, { method, headers })
      : await httpJson(`${base}${path}`, {
          method,
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `${query}&signature=${signature}`,
        });
  if (!res.ok || (res.data && res.data.code && res.data.code < 0)) {
    throw new ExchangeError(res.data?.msg || `Binance request failed (${res.status})`, {
      exchange: 'binance',
      status: res.status,
      code: res.data?.code,
      body: res.data,
    });
  }
  return res.data;
}

function normalizeBalance(rows) {
  const out = {};
  for (const b of rows || []) {
    const free = Number(b.free ?? b.availableBalance ?? b.balance ?? 0);
    const locked = Number(b.locked ?? 0);
    const total = free + locked || free;
    if (total > 0) out[b.asset] = total;
  }
  return out;
}

export const binance = {
  id: 'binance',
  name: 'Binance',
  supports: { spot: true, futures: true },
  requiresPassphrase: false,
  exSymbol: symbolOf,

  async testConnection(creds, opts) {
    const balances = await this.getBalance(creds, opts);
    return {
      ok: true,
      balances,
      message: `Connected to Binance ${opts.testnet ? 'Testnet' : 'Live'} (${opts.marketType})`,
    };
  },

  async getBalance(creds, opts = {}) {
    if (opts.marketType === 'spot') {
      const data = await signedRequest(creds, { ...opts, path: '/api/v3/account' });
      return normalizeBalance(data.balances);
    }
    const data = await signedRequest(creds, { ...opts, path: '/fapi/v2/balance' });
    return normalizeBalance(data);
  },

  async setLeverage(creds, { symbol, leverage, ...opts }) {
    try {
      return await signedRequest(creds, {
        ...opts,
        marketType: 'futures',
        method: 'POST',
        path: '/fapi/v1/leverage',
        params: { symbol: symbolOf(symbol), leverage: Math.round(leverage) },
      });
    } catch (err) {
      // leverage may already be set or unsupported; do not fail the trade
      return { warning: err.message };
    }
  },

  async placeOrder(creds, intent, opts = {}) {
    const marketType = opts.marketType || 'futures';
    const symbol = symbolOf(intent.symbol);
    const params = { symbol };
    const isSpot = marketType === 'spot';

    if (isSpot) {
      params.side = intent.side === 'buy' ? 'BUY' : 'SELL';
      params.type = intent.type === 'limit' ? 'LIMIT' : 'MARKET';
      if (intent.type === 'limit') {
        params.quantity = toFixedTrim(intent.qty);
        params.price = toFixedTrim(intent.price);
        params.timeInForce = 'GTC';
      } else if (intent.side === 'buy') {
        params.quoteOrderQty = toFixedTrim(intent.notional, 2);
      } else {
        params.quantity = toFixedTrim(intent.qty);
      }
      params.newOrderRespType = 'FULL';
      const data = await signedRequest(creds, { ...opts, marketType, method: 'POST', path: '/api/v3/order', params });
      const fills = data.fills || [];
      const qty = fills.reduce((s, f) => s + Number(f.qty), 0) || Number(data.executedQty || intent.qty);
      const quote = fills.reduce((s, f) => s + Number(f.qty) * Number(f.price), 0);
      const fillPrice = qty ? quote / qty : Number(data.fills?.[0]?.price || intent.price || 0);
      return { orderId: String(data.orderId), fillPrice, qty, status: data.status, raw: data };
    }

    params.side = intent.side === 'buy' ? 'BUY' : 'SELL';
    params.type = intent.type === 'limit' ? 'LIMIT' : 'MARKET';
    params.quantity = toFixedTrim(intent.qty);
    if (intent.reduceOnly) params.reduceOnly = 'true';
    if (intent.closePosition) params.closePosition = 'true';
    if (intent.type === 'limit') {
      params.price = toFixedTrim(intent.price);
      params.timeInForce = 'GTC';
    }
    const data = await signedRequest(creds, { ...opts, marketType, method: 'POST', path: '/fapi/v1/order', params });
    const qty = Number(data.executedQty || intent.qty);
    const fillPrice = Number(data.avgPrice || intent.price || 0) || (data.cumQuote && qty ? Number(data.cumQuote) / qty : 0);
    return { orderId: String(data.orderId), fillPrice, qty, status: data.status, raw: data };
  },

  // Futures-only protective orders (closePosition=true).
  async placeProtection(creds, { symbol, side, takeProfit, stopLoss, ...opts }) {
    const results = [];
    const closeSide = side === 'buy' ? 'SELL' : 'BUY';
    const common = { symbol: symbolOf(symbol), side: closeSide, type: 'STOP_MARKET', closePosition: 'true' };
    if (stopLoss) {
      const r = await signedRequest(creds, {
        ...opts,
        marketType: 'futures',
        method: 'POST',
        path: '/fapi/v1/order',
        params: { ...common, stopPrice: toFixedTrim(stopLoss) },
      });
      results.push({ type: 'stopLoss', orderId: r.orderId });
    }
    if (takeProfit) {
      const r = await signedRequest(creds, {
        ...opts,
        marketType: 'futures',
        method: 'POST',
        path: '/fapi/v1/order',
        params: { ...common, type: 'TAKE_PROFIT_MARKET', stopPrice: toFixedTrim(takeProfit) },
      });
      results.push({ type: 'takeProfit', orderId: r.orderId });
    }
    return results;
  },

  async cancelOrder(creds, { orderId, symbol, ...opts }) {
    const path = (opts.marketType || 'futures') === 'spot' ? '/api/v3/order' : '/fapi/v1/order';
    return signedRequest(creds, {
      ...opts,
      method: 'DELETE',
      path,
      params: { symbol: symbolOf(symbol), orderId },
    });
  },

  async getPositions(creds, opts = {}) {
    if ((opts.marketType || 'futures') === 'spot') return [];
    const data = await signedRequest(creds, { ...opts, marketType: 'futures', path: '/fapi/v2/positionRisk' });
    return (data || [])
      .filter((p) => Number(p.positionAmt) !== 0)
      .map((p) => ({
        symbol: p.symbol,
        side: Number(p.positionAmt) > 0 ? 'long' : 'short',
        size: Math.abs(Number(p.positionAmt)),
        entryPrice: Number(p.entryPrice),
        markPrice: Number(p.markPrice),
        unrealizedPnl: Number(p.unRealizedProfit ?? p.unrealizedProfit ?? 0),
      }));
  },

  async getPrice(symbol, opts = {}) {
    const fixture = opts.marketType === 'spot' ? '/api/v3/ticker/price' : '/fapi/v1/ticker/price';
    const base = baseFor(opts.marketType || 'futures', opts.testnet);
    const { data } = await httpJson(`${base}${fixture}?symbol=${symbolOf(symbol)}`);
    return Number(data?.price || 0);
  },
};

export default binance;
