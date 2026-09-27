import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import { store } from './store.js';
import { market } from './market.js';
import { updateOpenPositions, syncLiveAccount } from './trading.js';
import { liveFeed } from './liveFeed.js';
import { marketData } from './marketData.js';
import { userStreamManager } from './userStream.js';
import './engine.js';

import authRoutes from './routes/auth.js';
import marketRoutes from './routes/market.js';
import tradingRoutes from './routes/trading.js';
import botRoutes from './routes/bots.js';
import miscRoutes, { publicRouter as miscPublicRoutes } from './routes/misc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'nebulatrade-backend',
    pairs: market.listPairs().length,
    uptime: process.uptime(),
    time: Date.now(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/market', marketRoutes);
// Public webhook must be mounted before the authenticated /api routers below.
app.use('/api', miscPublicRoutes);
app.use('/api', tradingRoutes);
app.use('/api/bots', botRoutes);
app.use('/api', miscRoutes);

// Serve built frontend if present (production single-port mode)
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|ws).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[api] error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

// ---- live price websocket ----
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const url = new URL(req.url, 'http://localhost');
  const symbol = url.searchParams.get('symbol');
  ws.send(JSON.stringify({ type: 'snapshot', data: market.getAllTickers(), symbol: symbol || null }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcastTickers() {
  if (!clients.size) return;
  const msg = JSON.stringify({ type: 'tickers', data: market.getAllTickers(), time: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch {
        clients.delete(ws);
      }
    }
  }
}

market.on('tick', () => {
  updateOpenPositions().catch((err) => console.error('[positions]', err.message));
  broadcastTickers();
});

// Periodically reconcile live accounts with their exchanges.
const SYNC_INTERVAL_MS = Number(process.env.NT_SYNC_INTERVAL_MS) || 15000;
async function syncLiveAccounts() {
  const live = store.filter('exchanges', (a) => a.mode === 'live' && a.connected);
  for (const account of live) {
    try {
      await syncLiveAccount(account);
    } catch (err) {
      console.error(`[sync] ${account.exchange} ${account.id}:`, err.message);
    }
  }
}

// Preload real candles for every pair the bots/screener depend on so they do not
// silently fall back to simulated history. Only runs once the public feed is up.
const WARM_INTERVAL_MS = Number(process.env.NT_WARM_INTERVAL_MS) || 30000;
function warmTargets() {
  const timeframes = new Set(['1m', '1h']);
  for (const bot of store.filter('bots', (b) => b.status === 'running')) {
    if (bot.type === 'ai' && bot.config?.timeframe) timeframes.add(bot.config.timeframe);
  }
  return { pairs: market.listPairs(), timeframes: [...timeframes] };
}
async function warmMarketData() {
  if (!liveFeed.enabled) return;
  try {
    const warmed = await marketData.warm(warmTargets());
    if (warmed) console.log(`[marketdata] warmed ${warmed} candle series`);
  } catch (err) {
    console.error('[marketdata] warm failed:', err.message);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[nebulatrade] backend listening on http://0.0.0.0:${PORT}`);
  console.log(`[nebulatrade] websocket on ws://0.0.0.0:${PORT}/ws`);
  console.log(`[nebulatrade] markets loaded: ${market.listPairs().length}`);
  liveFeed.start();
  marketData.start();
  userStreamManager.start();
  setTimeout(warmMarketData, 3000).unref?.();
  setInterval(warmMarketData, WARM_INTERVAL_MS).unref?.();
  setInterval(syncLiveAccounts, SYNC_INTERVAL_MS).unref?.();
});
