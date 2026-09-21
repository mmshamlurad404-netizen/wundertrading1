import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so historical data / backtests are stable.
// ---------------------------------------------------------------------------
function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TIMEFRAMES = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

// name, base price, annualised-ish volatility factor, category
const PAIR_DEFS = [
  ['BTC/USDT', 94250, 0.018, 'major'],
  ['ETH/USDT', 3280, 0.022, 'major'],
  ['SOL/USDT', 198.4, 0.032, 'layer1'],
  ['BNB/USDT', 712.5, 0.02, 'exchange'],
  ['XRP/USDT', 2.41, 0.03, 'payments'],
  ['ADA/USDT', 1.08, 0.028, 'layer1'],
  ['DOGE/USDT', 0.382, 0.04, 'meme'],
  ['AVAX/USDT', 43.6, 0.033, 'layer1'],
  ['LINK/USDT', 24.8, 0.03, 'oracle'],
  ['MATIC/USDT', 0.612, 0.031, 'layer2'],
  ['DOT/USDT', 8.94, 0.03, 'layer1'],
  ['LTC/USDT', 132.7, 0.025, 'payments'],
  ['ARB/USDT', 0.94, 0.036, 'layer2'],
  ['OP/USDT', 2.16, 0.036, 'layer2'],
  ['INJ/USDT', 31.4, 0.042, 'defi'],
  ['SUI/USDT', 4.62, 0.041, 'layer1'],
  ['APT/USDT', 11.3, 0.038, 'layer1'],
  ['NEAR/USDT', 6.72, 0.038, 'layer1'],
  ['FIL/USDT', 5.41, 0.036, 'storage'],
  ['ATOM/USDT', 7.83, 0.032, 'layer1'],
  ['PEPE/USDT', 0.0000182, 0.06, 'meme'],
  ['WIF/USDT', 2.74, 0.058, 'meme'],
  ['BONK/USDT', 0.0000315, 0.062, 'meme'],
  ['TIA/USDT', 5.92, 0.045, 'modular'],
];

function decimalsFor(price) {
  if (price >= 1000) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 5;
  return 8;
}

function roundPrice(price, ref) {
  const d = decimalsFor(ref);
  const f = Math.pow(10, d);
  return Math.round(price * f) / f;
}

// Generate a deterministic candle series that ends at `endTime` (exclusive end
// aligned to timeframe). `count` candles.
export function generateCandles(pair, timeframe, count, endTime = Date.now()) {
  const bucket = TIMEFRAMES[timeframe];
  if (!bucket) throw new Error(`unknown timeframe ${timeframe}`);
  const def = PAIR_DEFS.find((p) => p[0] === pair);
  if (!def) throw new Error(`unknown pair ${pair}`);
  const [, basePrice, vol] = def;

  const endBucket = Math.floor(endTime / bucket) * bucket;
  const startBucket = endBucket - (count - 1) * bucket;
  const rng = mulberry32(hashStr(pair + timeframe));

  const candles = [];
  let price = basePrice;
  // seed a plausible starting price using a slow sine + noise
  price = basePrice * (0.72 + 0.25 * Math.sin(rng() * Math.PI * 2));
  const drift = (rng() - 0.48) * 0.0006;

  for (let i = 0; i < count; i++) {
    const t = startBucket + i * bucket;
    const cyclic = Math.sin((i / count) * Math.PI * 6 + rng() * 0.4) * vol * 0.5;
    const shock = (rng() - 0.5) * 2;
    const ret = drift + cyclic * 0.4 + shock * vol;
    const open = price;
    const close = Math.max(open * (1 + ret), basePrice * 0.15);
    const wick = Math.abs(shock) * vol * 0.6 + vol * 0.2;
    const high = Math.max(open, close) * (1 + wick * rng());
    const low = Math.min(open, close) * (1 - wick * rng());
    const volume = 1000 * (0.4 + rng() * 2.2) * (1 + Math.abs(ret) * 40);
    candles.push({
      t,
      o: roundPrice(open, basePrice),
      h: roundPrice(high, basePrice),
      l: roundPrice(low, basePrice),
      c: roundPrice(close, basePrice),
      v: Math.round(volume),
    });
    price = close;
  }
  return candles;
}

class MarketEngine extends EventEmitter {
  constructor() {
    super();
    this.pairs = PAIR_DEFS.map(([symbol, basePrice, vol, category]) => ({
      symbol,
      basePrice,
      vol,
      category,
    }));
    this.state = new Map(); // symbol -> { price, change24h, high24h, low24h, volume24h, candles: {tf: []} }
    this.liveMode = false;
    this._init();
    this._timer = setInterval(() => this.tick(), 1500);
    this._timer.unref();
  }

  setLiveMode(on) {
    this.liveMode = Boolean(on);
  }

  setCandles(symbol, timeframe, candles) {
    const st = this.state.get(symbol);
    if (!st || !candles?.length) return;
    if (!st.candles[timeframe]) st.candles[timeframe] = [];
    st.candles[timeframe] = candles.slice(-520);
    st.liveCandles = true;
  }

  applyLivePrices(updates) {
    for (const [symbol, data] of Object.entries(updates || {})) {
      const st = this.state.get(symbol);
      if (!st) continue;
      if (Number.isFinite(data.price) && data.price > 0) st.price = roundPrice(data.price, st.basePrice);
      if (Number.isFinite(data.change24h)) st.change24h = data.change24h;
      if (Number.isFinite(data.high24h) && data.high24h > 0) st.high24h = data.high24h;
      if (Number.isFinite(data.low24h) && data.low24h > 0) st.low24h = data.low24h;
      if (Number.isFinite(data.volume24h)) st.volume24h = data.volume24h;
      st.live = true;
    }
  }

  _init() {
    for (const p of this.pairs) {
      const daily = generateCandles(p.symbol, '1h', 400);
      const price = daily[daily.length - 1].c;
      const prev24 = daily[daily.length - 25]?.c || price;
      const last24 = daily.slice(-24);
      // Align every timeframe so its final close matches the live spot price.
      const align = (candles) => {
        const last = candles[candles.length - 1];
        if (!last || !last.c) return candles;
        const k = price / last.c;
        return candles.map((c) => ({
          t: c.t,
          o: roundPrice(c.o * k, p.basePrice),
          h: roundPrice(c.h * k, p.basePrice),
          l: roundPrice(c.l * k, p.basePrice),
          c: roundPrice(c.c * k, p.basePrice),
          v: c.v,
        }));
      };
      this.state.set(p.symbol, {
        symbol: p.symbol,
        price,
        priceOpen24h: prev24,
        change24h: ((price - prev24) / prev24) * 100,
        high24h: Math.max(...last24.map((c) => c.h)),
        low24h: Math.min(...last24.map((c) => c.l)),
        volume24h: last24.reduce((s, c) => s + c.v, 0),
        candles: {
          '1m': align(generateCandles(p.symbol, '1m', 300)),
          '5m': align(generateCandles(p.symbol, '5m', 300)),
          '15m': align(generateCandles(p.symbol, '15m', 300)),
          '1h': daily,
          '4h': align(generateCandles(p.symbol, '4h', 300)),
          '1d': align(generateCandles(p.symbol, '1d', 300)),
        },
      });
    }
  }

  listPairs() {
    return this.pairs.map((p) => p.symbol);
  }

  getPrice(symbol) {
    return this.state.get(symbol)?.price ?? null;
  }

  getCandles(symbol, timeframe, limit = 200) {
    const st = this.state.get(symbol);
    if (!st) return [];
    const tf = timeframe || '1h';
    const arr = st.candles[tf] || [];
    return arr.slice(-limit);
  }

  getTicker(symbol) {
    const st = this.state.get(symbol);
    if (!st) return null;
    return {
      symbol: st.symbol,
      price: st.price,
      change24h: st.change24h,
      high24h: st.high24h,
      low24h: st.low24h,
      volume24h: st.volume24h,
      category: this.pairs.find((p) => p.symbol === symbol)?.category,
    };
  }

  getAllTickers() {
    return this.pairs.map((p) => this.getTicker(p.symbol));
  }

  _appendToTimeframe(st, tf, price, volume) {
    const bucket = TIMEFRAMES[tf];
    const now = Date.now();
    const bucketStart = Math.floor(now / bucket) * bucket;
    const arr = st.candles[tf];
    const last = arr[arr.length - 1];
    if (!last || last.t < bucketStart) {
      arr.push({ t: bucketStart, o: price, h: price, l: price, c: price, v: volume });
      if (arr.length > 520) arr.shift();
    } else {
      last.c = price;
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      last.v += volume;
    }
  }

  tick() {
    const updates = [];
    for (const p of this.pairs) {
      const st = this.state.get(p.symbol);
      if (!st) continue;
      // Live mode: prices are driven by the real exchange feed.
      const ret = this.liveMode
        ? 0
        : (Math.random() - 0.5) * 2 * p.vol * 0.08 +
          (Math.random() < 0.004 ? (Math.random() - 0.45) * 2.6 : 0) * p.vol * 0.5;
      if (!this.liveMode) {
        let next = st.price * (1 + ret);
        next = Math.max(next, p.basePrice * 0.05);
        st.price = roundPrice(next, p.basePrice);
      }

      const vol = this.liveMode
        ? Math.round((0.4 + Math.random()) * 600)
        : Math.round((0.4 + Math.random()) * 600 * (1 + Math.abs(ret) * 30));
      for (const tf of Object.keys(TIMEFRAMES)) {
        this._appendToTimeframe(st, tf, st.price, this.liveMode && st.liveCandles ? 0 : vol);
      }
      if (!this.liveMode) {
        st.change24h = ((st.price - st.priceOpen24h) / st.priceOpen24h) * 100;
        st.high24h = Math.max(st.high24h, st.price);
        st.low24h = Math.min(st.low24h, st.price);
        st.volume24h += vol;
      }
      updates.push({
        symbol: st.symbol,
        price: st.price,
        change24h: st.change24h,
        lastCandle: st.candles['1m'][st.candles['1m'].length - 1],
      });
    }
    this.emit('tick', updates);
  }

  // Screener: detect unusual momentum + volume over the recent window.
  screener() {
    const results = [];
    for (const p of this.pairs) {
      const st = this.state.get(p.symbol);
      if (!st) continue;
      const c1m = st.candles['1m'];
      const recent = c1m.slice(-5);
      const prior = c1m.slice(-20, -5);
      const recentVol = recent.reduce((s, c) => s + c.v, 0);
      const priorVol = prior.reduce((s, c) => s + c.v, 0) || 1;
      const volRatio = recentVol / (priorVol * (5 / 15));
      const priceChange5m =
        ((st.price - (recent[0]?.o || st.price)) / (recent[0]?.o || st.price)) * 100;
      const change1h =
        (() => {
          const c1h = st.candles['1h'];
          const ref = c1h[c1h.length - 2]?.c || st.price;
          return ((st.price - ref) / ref) * 100;
        })();
      const score =
        Math.max(0, priceChange5m) * 12 +
        Math.max(0, volRatio - 1) * 18 +
        Math.max(0, change1h) * 3;
      results.push({
        symbol: st.symbol,
        price: st.price,
        change5m: +priceChange5m.toFixed(2),
        change1h: +change1h.toFixed(2),
        change24h: +st.change24h.toFixed(2),
        volume24h: Math.round(st.volume24h),
        volumeRatio: +volRatio.toFixed(2),
        score: +score.toFixed(2),
        signal:
          score > 45 ? 'STRONG' : score > 20 ? 'WATCH' : score > 8 ? 'MILD' : 'NEUTRAL',
      });
    }
    return results.sort((a, b) => b.score - a.score);
  }
}

export const market = new MarketEngine();
export const PAIRS = PAIR_DEFS.map((p) => p[0]);
export const PAIR_META = Object.fromEntries(
  PAIR_DEFS.map(([symbol, basePrice, vol, category]) => [
    symbol,
    { symbol, basePrice, vol, category, decimals: decimalsFor(basePrice) },
  ])
);
