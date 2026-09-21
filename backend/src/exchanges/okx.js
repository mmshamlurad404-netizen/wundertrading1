import {
  hmacSha256Base64,
  isoNow,
  httpJson,
  ExchangeError,
  splitPair,
  toFixedTrim,
} from './sign.js';

const BASE = 'https://www.okx.com';
const ctValCache = {};

function instIdOf(pair, marketType) {
  const { base, quote } = splitPair(pair);
  return marketType === 'spot' ? `${base}-${quote}`.toUpperCase() : `${base}-${quote}-SWAP`.toUpperCase();
}

async function getCtVal(instId) {
  if (ctValCache[instId]) return ctValCache[instId];
  try {
    const { data } = await httpJson(`${BASE}/api/v5/public/instruments?instType=SWAP&instId=${instId}`);
    const val = Number(data?.data?.[0]?.ctVal || 1) || 1;
    ctValCache[instId] = val;
    return val;
  } catch {
    return 1;
  }
}

async function signedRequest(creds, opts, { method = 'GET', path, body }) {
  const bodyString = body ? JSON.stringify(body) : '';
  const timestamp = isoNow();
  const sign = hmacSha256Base64(creds.apiSecret, `${timestamp}${method}${path}${bodyString}`);
  const headers = {
    'OK-ACCESS-KEY': creds.apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': creds.passphrase || '',
    'Content-Type': 'application/json',
  };
  if (opts.testnet) headers['x-simulated-trading'] = '1';
  const res = await httpJson(`${BASE}${path}`, { method, headers, body: bodyString || undefined });
  const data = res.data;
  if (!res.ok || (data && data.code && data.code !== '0')) {
    throw new ExchangeError(data?.msg || `OKX request failed (${res.status})`, {
      exchange: 'okx',
      status: res.status,
      code: data?.code,
      body: data,
    });
  }
  return data.data;
}

export const okx = {
  id: 'okx',
  name: 'OKX',
  supports: { spot: true, futures: true },
  requiresPassphrase: true,
  exSymbol: instIdOf,

  async testConnection(creds, opts) {
    const balances = await this.getBalance(creds, opts);
    return {
      ok: true,
      balances,
      message: `Connected to OKX ${opts.testnet ? 'Demo' : 'Live'} (${opts.marketType})`,
    };
  },

  async getBalance(creds, opts = {}) {
    const data = await signedRequest(creds, opts, { path: '/api/v5/account/balance' });
    const out = {};
    for (const detail of data?.[0]?.details || []) {
      const total = Number(detail.eq ?? detail.cashBal ?? 0);
      if (total > 0) out[detail.ccy] = total;
    }
    return out;
  },

  async setLeverage(creds, { symbol, leverage, ...opts }) {
    const marketType = opts.marketType || 'futures';
    if (marketType === 'spot') return { skipped: true };
    try {
      return await signedRequest(creds, opts, {
        method: 'POST',
        path: '/api/v5/account/set-leverage',
        body: { instId: instIdOf(symbol, marketType), lever: String(Math.round(leverage)), mgnMode: 'cross' },
      });
    } catch (err) {
      return { warning: err.message };
    }
  },

  async placeOrder(creds, intent, opts = {}) {
    const marketType = opts.marketType || 'futures';
    const instId = instIdOf(intent.symbol, marketType);
    const isSpot = marketType === 'spot';
    let sz;
    if (isSpot) {
      sz = toFixedTrim(intent.qty);
    } else {
      const ctVal = await getCtVal(instId);
      sz = toFixedTrim(intent.qty / ctVal);
    }
    const body = {
      instId,
      tdMode: isSpot ? 'cash' : 'cross',
      side: intent.side === 'buy' ? 'buy' : 'sell',
      ordType: intent.type === 'limit' ? 'limit' : 'market',
      sz,
    };
    if (isSpot) body.tgtCcy = 'base';
    if (intent.type === 'limit') body.px = toFixedTrim(intent.price);
    if (intent.reduceOnly) body.reduceOnly = true;
    if (intent.takeProfit || intent.stopLoss) {
      body.attachAlgoOrds = [
        {
          ...(intent.takeProfit ? { tpTriggerPx: toFixedTrim(intent.takeProfit), tpOrdPx: '-1' } : {}),
          ...(intent.stopLoss ? { slTriggerPx: toFixedTrim(intent.stopLoss), slOrdPx: '-1' } : {}),
        },
      ];
    }
    const data = await signedRequest(creds, opts, { method: 'POST', path: '/api/v5/trade/order', body });
    const orderId = data?.[0]?.ordId;
    let fillPrice = Number(intent.price || 0);
    try {
      const order = await signedRequest(creds, opts, {
        path: `/api/v5/trade/order?instId=${instId}&ordId=${orderId}`,
      });
      fillPrice = Number(order?.[0]?.avgPx || fillPrice) || fillPrice;
    } catch {
      /* ignore */
    }
    return { orderId: String(orderId), fillPrice, qty: Number(intent.qty), status: 'submitted', raw: data };
  },

  async cancelOrder(creds, { orderId, symbol, ...opts }) {
    const marketType = (opts.marketType || 'futures') === 'spot' ? 'spot' : 'futures';
    return signedRequest(creds, opts, {
      method: 'POST',
      path: '/api/v5/trade/cancel-order',
      body: { instId: instIdOf(symbol, marketType), ordId: orderId },
    });
  },

  async getPositions(creds, opts = {}) {
    if ((opts.marketType || 'futures') === 'spot') return [];
    const data = await signedRequest(creds, opts, { path: '/api/v5/account/positions?instType=SWAP' });
    return (data || [])
      .filter((p) => Number(p.pos) !== 0)
      .map((p) => ({
        symbol: p.instId,
        side: String(p.posSide || (Number(p.pos) > 0 ? 'long' : 'short')) === 'short' ? 'short' : 'long',
        size: Math.abs(Number(p.pos)),
        entryPrice: Number(p.avgPx),
        markPrice: Number(p.markPx),
        unrealizedPnl: Number(p.upl ?? 0),
      }));
  },
};

export default okx;
