import crypto from 'node:crypto';

export function hmacSha256Hex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function hmacSha256Base64(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

export function urlEncode(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function isoNow() {
  return new Date().toISOString();
}

export function roundQty(qty, step) {
  const s = step || 0.000001;
  return Math.floor(Number(qty) / s) * s;
}

export function toFixedTrim(n, decimals = 8) {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  return Number(n)
    .toFixed(decimals)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

export class ExchangeError extends Error {
  constructor(message, { exchange, status, code, body } = {}) {
    super(message);
    this.name = 'ExchangeError';
    this.exchange = exchange;
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// Small fetch wrapper with timeout and JSON parsing.
export async function httpJson(url, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Convert internal pair "BTC/USDT" -> exchange symbol.
export function splitPair(pair) {
  const [base, quote] = String(pair).split('/');
  return { base, quote };
}
