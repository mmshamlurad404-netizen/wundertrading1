import { market, TIMEFRAMES } from './market.js';

// ---------------------------------------------------------------------------
// Real public market data (no API keys required).
//
// Sources:
//   klines  -> Binance spot REST
//   depth   -> Binance / Wallex / Nobitex
//   funding -> Binance USD-M futures / Bybit linear / OKX swaps
//
// Everything is best-effort: when a source is unreachable (or the platform is
// running offline via NT_LIVE_MARKET=0) callers receive `null` and fall back to
// the deterministic simulator, so this module can never take the app down.
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT = 8000;

export function exchangeSymbol(pair) {
  return String(pair).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ------------------------------- parsers ----------------------------------
export function parseBinanceKlines(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const o = num(r[1]);
    const h = num(r[2]);
    const l = num(r[3]);
    const c = num(r[4]);
    const t = num(r[0]);
    if (t === undefined || c === undefined) continue;
    out.push({ t, o, h, l, c, v: num(r[5]) ?? 0 });
  }
  return out;
}

export function parseBinanceDepth(json) {
  const map = (rows) =>
    (rows || [])
      .map((r) => ({ price: num(r[0]), size: num(r[1]) }))
      .filter((x) => x.price > 0 && x.size > 0);
  return { bids: map(json?.bids), asks: map(json?.asks) };
}

export function parseWallexDepth(json) {
  const result = json?.result || json || {};
  const map = (rows) =>
    (rows || [])
      .map((r) => ({ price: num(r.price), size: num(r.quantity ?? r.size) }))
      .filter((x) => x.price > 0 && x.size > 0);
  return { bids: map(result.bid || result.bids), asks: map(result.ask || result.asks) };
}

export function parseNobitexDepth(json) {
  // Nobitex returns bids/asks as [price, amount] pairs (Rial for some pairs).
  const lot = (rows) =>
    (rows || [])
      .map((r) => ({ price: num(r[0]), size: num(r[1]) }))
      .filter((x) => x.price > 0 && x.size > 0);
  return { bids: lot(json?.bids), asks: lot(json?.asks) };
}

export function parseBinanceFunding(rows) {
  const out = {};
  for (const r of rows || []) {
    const rate = num(r?.lastFundingRate);
    if (!r?.symbol || rate === undefined) continue;
    out[String(r.symbol).toUpperCase()] = rate;
  }
  return out;
}

export function parseBybitFunding(json) {
  const out = {};
  for (const r of json?.result?.list || []) {
    const rate = num(r?.fundingRate);
    if (!r?.symbol || rate === undefined) continue;
    out[String(r.symbol).toUpperCase()] = rate;
  }
  return out;
}

export function parseOkxFunding(json) {
  const out = {};
  for (const r of json?.data || []) {
    const rate = num(r?.fundingRate);
    const inst = String(r?.instId || ''); // BTC-USDT-SWAP
    if (!inst || rate === undefined) continue;
    const [base, quote] = inst.split('-');
    out[`${base}${quote}`.toUpperCase()] = rate;
  }
  return out;
}

// ------------------------------- sources ----------------------------------
const KLINES_SOURCE = {
  id: 'binance',
  url: (symbol, tf, limit) =>
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${Math.min(limit, 1000)}`,
  parse: parseBinanceKlines,
};

const DEPTH_SOURCES = [
  {
    id: 'binance',
    url: (symbol, limit) => `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${Math.min(limit, 100)}`,
    parse: parseBinanceDepth,
  },
  {
    id: 'wallex',
    url: (symbol) => `https://api.wallex.ir/v1/depth?symbol=${symbol}`,
    parse: parseWallexDepth,
  },
  {
    id: 'nobitex',
    url: (symbol) => `https://apiv2.nobitex.ir/v2/orderbook/${symbol}`,
    parse: parseNobitexDepth,
  },
];

const FUNDING_SOURCES = [
  {
    id: 'binance',
    url: 'https://fapi.binance.com/fapi/v1/premiumIndex',
    parse: parseBinanceFunding,
  },
  {
    id: 'bybit',
    url: 'https://api.bybit.com/v5/market/tickers?category=linear',
    parse: parseBybitFunding,
  },
  {
    id: 'okx',
    url: 'https://www.okx.com/api/v5/public/funding-rate',
    parse: parseOkxFunding,
  },
];

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class MarketData {
  constructor() {
    this.enabled = process.env.NT_LIVE_MARKET !== '0';
    this.klines = new Map(); // `${pair}:${tf}` -> { at, data }
    this.books = new Map(); // pair -> { at, data }
    this.funding = new Map(); // concatenated symbol -> rate
    this.fundingAt = 0;
    this.errors = new Map();
    this._warming = false;
    this.warmedAt = 0;
  }

  async getCandles(pair, timeframe, limit = 200) {
    if (!this.enabled) return null;
    const tf = timeframe || '1h';
    if (!TIMEFRAMES[tf]) return null;
    if (!market.getPrice(pair)) return null;
    const symbol = exchangeSymbol(pair);
    const key = `${pair}:${tf}`;
    const cached = this.klines.get(key);
    if (cached && Date.now() - cached.at < 20000) return cached.data.slice(-limit);
    try {
      const rows = await fetchJson(KLINES_SOURCE.url(symbol, tf, Math.min(Math.max(limit, 200), 1000)));
      const candles = KLINES_SOURCE.parse(rows);
      if (!candles.length) throw new Error('empty klines');
      this.klines.set(key, { at: Date.now(), data: candles });
      this.errors.delete(key);
      // Publish into the shared market state so the AI engine, screener and
      // websocket consumers all see the same real candles.
      market.setCandles(pair, tf, candles);
      return candles.slice(-limit);
    } catch (err) {
      this.errors.set(key, err.message);
      if (cached) return cached.data.slice(-limit); // stale is better than fake
      return null;
    }
  }

  async getOrderBook(pair, limit = 20) {
    if (!this.enabled) return null;
    if (!market.getPrice(pair)) return null;
    const cached = this.books.get(pair);
    if (cached && Date.now() - cached.at < 2000) return cached.data;
    const symbol = exchangeSymbol(pair);
    for (const source of DEPTH_SOURCES) {
      try {
        const json = await fetchJson(source.url(symbol, limit));
        const book = source.parse(json);
        if (!book.bids.length && !book.asks.length) continue;
        const data = { ...book, source: source.id };
        this.books.set(pair, { at: Date.now(), data });
        this.errors.delete(`book:${pair}`);
        return data;
      } catch (err) {
        this.errors.set(`book:${pair}`, `${source.id}: ${err.message}`);
      }
    }
    if (cached) return cached.data;
    return null;
  }

  async refreshFunding() {
    if (!this.enabled) return false;
    if (Date.now() - this.fundingAt < 60000) return true;
    let applied = false;
    for (const source of FUNDING_SOURCES) {
      try {
        const json = await fetchJson(source.url);
        const rates = source.parse(json);
        const keys = Object.keys(rates);
        if (!keys.length) continue;
        for (const [symbol, rate] of Object.entries(rates)) {
          if (!this.funding.has(symbol)) this.funding.set(symbol, rate);
        }
        applied = true;
        this.errors.delete(`funding:${source.id}`);
      } catch (err) {
        this.errors.set(`funding:${source.id}`, err.message);
      }
    }
    if (applied) this.fundingAt = Date.now();
    return applied;
  }

  // Synchronous read for the engine; null means "no real rate available".
  fundingRate(pair) {
    const rate = this.funding.get(exchangeSymbol(pair));
    return Number.isFinite(rate) ? rate : null;
  }

  // Proactively pull real history into the shared market state so the bot
  // engine and screener do not fall back to simulated candles. Bounded
  // concurrency keeps a dead upstream from blocking the scheduler.
  async warm({ pairs = [], timeframes = [], limit = 200, concurrency = 4 } = {}) {
    if (!this.enabled || this._warming) return 0;
    this._warming = true;
    const queue = [];
    for (const pair of pairs) {
      for (const tf of timeframes) {
        if (TIMEFRAMES[tf]) queue.push([pair, tf]);
      }
    }
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const [pair, tf] = queue.shift();
        try {
          if (await this.getCandles(pair, tf, limit)) done++;
        } catch {
          /* best-effort */
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    } finally {
      this._warming = false;
    }
    this.warmedAt = Date.now();
    return done;
  }

  status() {
    return {
      enabled: this.enabled,
      warming: Boolean(this._warming),
      warmedAt: this.warmedAt || null,
      fundingSymbols: this.funding.size,
      fundingUpdatedAt: this.fundingAt || null,
      klineCacheSize: this.klines.size,
      errors: Object.fromEntries(this.errors),
    };
  }

  start() {
    if (!this.enabled) return;
    this.refreshFunding().catch(() => {});
    this.timer = setInterval(() => this.refreshFunding().catch(() => {}), 60000);
    this.timer.unref?.();
  }
}

export const marketData = new MarketData();
