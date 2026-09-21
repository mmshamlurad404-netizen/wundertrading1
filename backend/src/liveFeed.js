import { market, TIMEFRAMES } from './market.js';

// Public, keyless market data. Binance drives the global majors; Iranian venues
// (Wallex, Nobitex, Ompfinex) fill in pairs Binance does not quote. If every
// source is unreachable the platform keeps running on the deterministic
// simulator, so the feed is best-effort and never fatal.
const REQUEST_TIMEOUT = 8000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ---- pure parsers (keyed by concatenated exchange symbol, e.g. "BTCUSDT") ----
export function parseBinanceTickers(rows) {
  const out = {};
  for (const r of rows || []) {
    const price = num(r?.lastPrice);
    if (!r?.symbol || !price || price <= 0) continue;
    out[String(r.symbol).toUpperCase()] = {
      price,
      change24h: num(r.priceChangePercent),
      high24h: num(r.highPrice),
      low24h: num(r.lowPrice),
      volume24h: num(r.quoteVolume),
    };
  }
  return out;
}

export function parseWallexTickers(symbols) {
  const out = {};
  for (const [symbol, entry] of Object.entries(symbols || {})) {
    const stats = entry?.stats || {};
    const price = num(stats.lastPrice);
    if (!price || price <= 0) continue;
    out[String(symbol).toUpperCase()] = {
      price,
      change24h: num(stats['24h_ch']),
      high24h: num(stats['24h_highPrice']),
      low24h: num(stats['24h_lowPrice']),
      volume24h: num(stats['24h_quoteVolume']),
    };
  }
  return out;
}

export function parseNobitexTickers(stats) {
  const out = {};
  for (const [key, entry] of Object.entries(stats || {})) {
    const price = num(entry?.latest);
    if (!price || price <= 0) continue;
    out[key.replace(/[^a-z0-9]/gi, '').toUpperCase()] = {
      price,
      change24h: num(entry.dayChange),
      high24h: num(entry.dayHigh),
      low24h: num(entry.dayLow),
      volume24h: num(entry.volumeDst),
    };
  }
  return out;
}

export function parseOmpfinexTickers(rows) {
  const out = {};
  for (const m of rows || []) {
    const base = String(m?.base_currency?.id || '').toUpperCase();
    const quote = String(m?.quote_currency?.id || '').toUpperCase();
    const price = num(m?.last_price);
    if (!base || !quote || !price || price <= 0) continue;
    out[`${base}${quote}`] = {
      price,
      change24h: num(m.day_change_percent),
      volume24h: num(m.last_volume),
    };
  }
  return out;
}

const SOURCES = [
  {
    id: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/24hr',
    parse: (json) => parseBinanceTickers(json),
  },
  {
    id: 'wallex',
    url: 'https://api.wallex.ir/v1/markets',
    parse: (json) => parseWallexTickers(json?.result?.symbols),
  },
  {
    id: 'nobitex',
    url: 'https://apiv2.nobitex.ir/market/stats',
    parse: (json) => parseNobitexTickers(json?.stats),
  },
  {
    id: 'ompfinex',
    url: 'https://api.ompfinex.com/v1/market/',
    parse: (json) => parseOmpfinexTickers(json?.data),
  },
];

export const FEED_SOURCES = SOURCES.map((s) => s.id);

// Reorder sources so `NT_FEED_PRIORITY` (comma separated ids) is tried first.
// Unknown ids are ignored and every source is always kept as a fallback.
export function orderSources(priority = process.env.NT_FEED_PRIORITY) {
  if (!priority) return SOURCES;
  const ids = String(priority)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const ordered = [];
  for (const id of ids) {
    const source = SOURCES.find((s) => s.id === id);
    if (source && !ordered.includes(source)) ordered.push(source);
  }
  for (const source of SOURCES) {
    if (!ordered.includes(source)) ordered.push(source);
  }
  return ordered;
}

export class LiveFeed {
  constructor() {
    this.enabled = false;
    this.started = false;
    this.lastError = null;
    this.sources = [];
    this.available = [];
    this.errors = new Map(); // source id -> last error message
    this.symbols = new Map(); // internal pair -> concatenated exchange symbol
    this.klinesFetched = new Map(); // `${pair}:${tf}` -> timestamp
    for (const pair of market.listPairs()) {
      this.symbols.set(pair, pair.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
    }
  }

  async start() {
    if (this.started) return this.enabled;
    this.started = true;
    if (process.env.NT_LIVE_MARKET === '0') {
      console.log('[livefeed] disabled via NT_LIVE_MARKET=0 (using simulator)');
      return false;
    }
    const ok = await this.poll();
    if (ok) {
      market.setLiveMode(true);
      this.enabled = true;
      console.log(`[livefeed] live market data enabled (active: ${this.sources.join(', ')}; available: ${this.available.join(', ') || 'none'})`);
      this.timer = setInterval(() => this.poll().catch(() => {}), 5000);
      this.timer.unref?.();
    } else {
      console.log('[livefeed] public feed unavailable, continuing with simulator');
    }
    return this.enabled;
  }

  async fetchSource(source) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(source.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return source.parse(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  async poll() {
    const merged = {};
    const active = [];
    const available = [];
    for (const source of orderSources()) {
      try {
        const ticks = await this.fetchSource(source);
        const parsed = Object.keys(ticks).length;
        if (parsed) available.push(source.id);
        let applied = 0;
        for (const [pair, symbol] of this.symbols) {
          if (merged[pair]) continue; // earlier sources take priority
          const tick = ticks[symbol];
          if (tick) {
            merged[pair] = tick;
            applied++;
          }
        }
        if (applied) active.push(source.id);
        this.errors.delete(source.id);
      } catch (err) {
        this.errors.set(source.id, err.message);
      }
    }
    this.available = available;
    if (Object.keys(merged).length) {
      market.applyLivePrices(merged);
      this.sources = active;
      this.lastError = null;
      return true;
    }
    this.lastError = [...this.errors.values()][0] || 'no data';
    return false;
  }

  async ensureKlines(pair, timeframe, limit = 200) {
    if (!this.enabled) return false;
    const tf = timeframe || '1h';
    if (!TIMEFRAMES[tf]) return false;
    const key = `${pair}:${tf}`;
    const last = this.klinesFetched.get(key) || 0;
    if (Date.now() - last < 15000) return false; // throttle
    const bs = this.symbols.get(pair);
    if (!bs) return false;
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${bs}&interval=${tf}&limit=${Math.min(limit, 500)}`);
      if (!res.ok) return false;
      const rows = await res.json();
      const candles = rows.map((r) => ({
        t: r[0],
        o: Number(r[1]),
        h: Number(r[2]),
        l: Number(r[3]),
        c: Number(r[4]),
        v: Number(r[5]),
      }));
      if (candles.length) {
        market.setCandles(pair, tf, candles);
        this.klinesFetched.set(key, Date.now());
        return true;
      }
    } catch {
      /* keep existing candles */
    }
    return false;
  }

  status() {
    return {
      enabled: this.enabled,
      lastError: this.lastError,
      sources: this.sources,
      available: this.available,
      errors: Object.fromEntries(this.errors),
      source: this.sources.length ? this.sources.join('+') : 'simulator',
    };
  }
}

export const liveFeed = new LiveFeed();
