import { hmacSha256Hex, hmacSha256Base64 } from './sign.js';

// Private (user-data) websocket helpers for exchanges whose stream model is not
// a Binance-style REST listen key: Bybit V5 and OKX V5 require an authenticated
// websocket login handshake. Everything here is pure so it can be unit tested
// without opening a socket; the manager feeds the frames to the socket.

export const PRIVATE_STREAM_EXCHANGES = ['binance', 'bybit', 'okx'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function bybitPrivateUrl({ testnet = false } = {}) {
  return testnet
    ? 'wss://stream-testnet.bybit.com/v5/private'
    : 'wss://stream.bybit.com/v5/private';
}

export function okxPrivateUrl({ testnet = false, brokerId = '9999' } = {}) {
  return testnet
    ? `wss://wspap.okx.com:8443/ws/v5/private?brokerId=${brokerId}`
    : 'wss://ws.okx.com:8443/ws/v5/private';
}

// Bybit signs "GET/realtime{expires}" with the API secret (hex, lowercase).
export function bybitAuthFrame(creds, { now = Date.now() } = {}) {
  const expires = now + 1000;
  const sign = hmacSha256Hex(creds.apiSecret, `GET/realtime${expires}`);
  return { op: 'auth', args: [creds.apiKey, expires, sign] };
}

export function bybitSubscribeFrame() {
  return { op: 'subscribe', args: ['order', 'execution', 'wallet'] };
}

export function bybitPingFrame() {
  return { op: 'ping' };
}

// OKX signs "{timestamp}GET/users/self/verify" with base64 HMAC-SHA256.
export function okxLoginFrame(creds, { now = Date.now() } = {}) {
  const timestamp = String(now / 1000);
  const sign = hmacSha256Base64(creds.apiSecret, `${timestamp}GET/users/self/verify`);
  return {
    op: 'login',
    args: [{ apiKey: creds.apiKey, passphrase: creds.passphrase, timestamp, sign }],
  };
}

export function okxSubscribeFrame() {
  return {
    op: 'subscribe',
    args: [
      { channel: 'orders', instType: 'ANY' },
      { channel: 'positions', instType: 'ANY' },
      { channel: 'account' },
    ],
  };
}

// Normalize a Bybit private-stream frame into the venue-agnostic event shape
// consumed by applyNormalizedEvent.
export function normalizeBybitEvent(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const topic = msg.topic || '';
  const data = Array.isArray(msg.data) ? msg.data : [];

  if (topic.startsWith('order') || topic.startsWith('execution')) {
    const d = data[0] || {};
    const filledQty = num(d.cumExecQty) ?? num(d.execQty);
    const cumValue = num(d.cumExecValue);
    const avgFromValue = cumValue !== undefined && filledQty ? cumValue / filledQty : undefined;
    return {
      type: 'order',
      dedupeKey: `order:${d.orderId || d.orderLinkId}:${d.orderStatus || ''}:${filledQty ?? ''}`,
      clientOrderId: d.orderLinkId || null,
      orderId: d.orderId !== undefined && d.orderId !== null ? String(d.orderId) : null,
      symbol: d.symbol || null,
      side: String(d.side || '').toLowerCase(),
      status: d.orderStatus || null,
      origQty: num(d.qty),
      filledQty,
      avgPrice: num(d.avgPrice) ?? avgFromValue ?? num(d.execPrice),
      lastPrice: num(d.execPrice),
      fee: num(d.execFee),
      feeAsset: d.feeCurrency || null,
      reduceOnly: d.reduceOnly === true || d.closeOnTrigger === true,
      realizedPnl: num(d.closedPnl),
    };
  }

  if (topic.startsWith('wallet')) {
    const d = data[0] || {};
    const coins = Array.isArray(d.coin) ? d.coin : [];
    const balances = coins.map((c) => ({
      asset: c.coin,
      wallet: num(c.walletBalance),
      free: num(c.availableToWithdraw),
      locked: num(c.locked),
    }));
    return { type: 'account', dedupeKey: `acct:${msg.creationTime ?? msg.ts ?? ''}`, balances };
  }

  return null;
}

// Normalize an OKX private-stream frame.
export function normalizeOkxEvent(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const channel = msg.arg?.channel || '';
  const data = Array.isArray(msg.data) ? msg.data : [];

  if (channel === 'orders') {
    const d = data[0] || {};
    return {
      type: 'order',
      dedupeKey: `order:${d.ordId || d.clOrdId}:${d.state || ''}:${d.accFillSz ?? ''}`,
      clientOrderId: d.clOrdId || null,
      orderId: d.ordId !== undefined && d.ordId !== null ? String(d.ordId) : null,
      symbol: d.instId || null,
      side: String(d.side || '').toLowerCase(),
      status: d.state || null,
      origQty: num(d.sz),
      filledQty: num(d.accFillSz),
      avgPrice: num(d.avgPx) || num(d.px),
      lastPrice: num(d.avgPx) || num(d.px),
      fee: num(d.fee),
      feeAsset: d.feeCcy || null,
      reduceOnly: d.reduceOnly === 'true',
      realizedPnl: num(d.pnl),
    };
  }

  if (channel === 'account') {
    const d = data[0] || {};
    const details = Array.isArray(d.details) ? d.details : [];
    const balances = details.map((x) => ({
      asset: x.ccy,
      wallet: num(x.eq),
      free: num(x.availBal),
      locked: num(x.frozenBal),
    }));
    return { type: 'account', dedupeKey: `acct:${msg.data?.[0]?.uTime ?? ''}`, balances };
  }

  if (channel === 'positions') {
    // Position updates carry no balance delta; ignored but recognized.
    return { type: 'positions', dedupeKey: `pos:${msg.data?.[0]?.uTime ?? ''}` };
  }

  return null;
}

export function normalizePrivateEvent(exchange, msg) {
  const name = String(exchange || '').toLowerCase();
  if (name === 'bybit') return normalizeBybitEvent(msg);
  if (name === 'okx') return normalizeOkxEvent(msg);
  return null;
}
