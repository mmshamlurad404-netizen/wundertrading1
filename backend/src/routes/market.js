import express from 'express';
import { market, PAIR_META, TIMEFRAMES, generateCandles } from '../market.js';
import { authMiddleware } from '../auth.js';
import { ema, rsi, sma } from '../engine.js';
import { runBacktest } from '../backtest.js';
import { marketData } from '../marketData.js';

const router = express.Router();

router.get('/pairs', (req, res) => {
  res.json({ pairs: market.getAllTickers() });
});

router.get('/ticker/:symbol', (req, res) => {
  const t = market.getTicker(req.params.symbol);
  if (!t) return res.status(404).json({ error: 'Unknown market' });
  res.json({ ticker: t });
});

router.get('/candles/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const timeframe = req.query.timeframe || '1h';
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  if (!TIMEFRAMES[timeframe]) return res.status(400).json({ error: 'Invalid timeframe' });
  if (!market.getPrice(symbol)) return res.status(404).json({ error: 'Unknown market' });
  // Prefer real exchange history; the simulator is only a fallback.
  const real = await marketData.getCandles(symbol, timeframe, limit);
  const candles = real || market.getCandles(symbol, timeframe, limit);
  if (!candles.length) return res.status(404).json({ error: 'Unknown market' });
  res.json({ symbol, timeframe, candles, source: real ? 'live' : 'simulator' });
});

router.get('/orderbook/:symbol', async (req, res) => {
  const symbol = req.params.symbol;
  const price = market.getPrice(symbol);
  if (!price) return res.status(404).json({ error: 'Unknown market' });
  // Real depth when a public venue is reachable, otherwise a synthetic ladder.
  const real = await marketData.getOrderBook(symbol, 20);
  if (real) return res.json({ symbol, bids: real.bids, asks: real.asks, source: real.source });
  const meta = PAIR_META[symbol];
  const step = price * 0.0004;
  const bids = Array.from({ length: 20 }, (_, i) => ({
    price: +(price - step * (i + 1)).toFixed(meta.decimals),
    size: +(Math.random() * 4 + 0.2).toFixed(4),
  }));
  const asks = Array.from({ length: 20 }, (_, i) => ({
    price: +(price + step * (i + 1)).toFixed(meta.decimals),
    size: +(Math.random() * 4 + 0.2).toFixed(4),
  }));
  res.json({ symbol, bids, asks, source: 'simulator' });
});

router.get('/funding', (req, res) => {
  const rates = market.listPairs().map((symbol) => {
    const real = marketData.fundingRate(symbol);
    return { symbol, rate: real, source: real === null ? null : 'live' };
  });
  res.json({ rates, updatedAt: marketData.fundingAt || null });
});

router.get('/screener', (req, res) => {
  res.json({ results: market.screener() });
});

router.get('/overview', (req, res) => {
  const tickers = market.getAllTickers();
  const totalVolume = tickers.reduce((s, t) => s + (t.volume24h || 0), 0);
  const gainers = [...tickers].sort((a, b) => b.change24h - a.change24h).slice(0, 5);
  const losers = [...tickers].sort((a, b) => a.change24h - b.change24h).slice(0, 5);
  res.json({ totalVolume, gainers, losers, pairCount: tickers.length });
});

// Simple public indicators preview (used by AI/analysis panels)
router.get('/indicators/:symbol', (req, res) => {
  const timeframe = req.query.timeframe || '1h';
  const symbol = req.params.symbol;
  const engineCandles = market.getCandles(symbol, timeframe, 200);
  if (!engineCandles.length) {
    const fresh = generateCandles(symbol, timeframe, 200);
    if (!fresh.length) return res.status(404).json({ error: 'Unknown market' });
  }
  const candles = engineCandles.length ? engineCandles : generateCandles(symbol, timeframe, 200);
  const closes = candles.map((c) => c.c);
  res.json({
    symbol,
    timeframe,
    ema9: ema(closes, 9).slice(-1)[0],
    ema21: ema(closes, 21).slice(-1)[0],
    ema50: ema(closes, 50).slice(-1)[0],
    sma20: sma(closes, 20),
    rsi14: rsi(closes, 14),
    atrProxy: (Math.max(...closes.slice(-14)) - Math.min(...closes.slice(-14))) / closes[closes.length - 1],
  });
});

router.post('/backtest', authMiddleware, async (req, res) => {
  try {
    const result = await runBacktest(req.body || {});
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
