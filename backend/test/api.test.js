import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('API smoke test boots the server and exercises core flows', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-api-'));
  const port = 32000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      NT_DATA_DIR: dir,
      NT_LIVE_MARKET: '0',
      JWT_SECRET: 'test-secret',
      NT_SYNC_INTERVAL_MS: '600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d.toString()));
  child.stderr.on('data', (d) => (logs += d.toString()));
  t.after(() => child.kill('SIGTERM'));

  const base = `http://127.0.0.1:${port}/api`;
  let healthy = false;
  for (let i = 0; i < 80 && !healthy; i++) {
    await sleep(250);
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      healthy = res.ok;
    } catch {
      /* not up yet */
    }
  }
  assert.ok(healthy, `server did not start:\n${logs}`);

  let token = '';
  async function req(method, p, body, useToken = true) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (useToken && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + p, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  }

  const email = `it${Date.now()}@test.io`;
  let r = await req('POST', '/auth/register', { email, password: 'secret123', name: 'IT' }, false);
  assert.equal(r.status, 201);
  assert.ok(r.data.token);
  token = r.data.token;

  r = await req('GET', '/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, email);

  r = await req('GET', '/accounts');
  assert.equal(r.status, 200);
  const paper = r.data.accounts.find((a) => a.exchange === 'paper');
  assert.ok(paper, 'paper account auto-created');

  r = await req('GET', '/exchanges/supported');
  assert.equal(r.status, 200);
  assert.equal(r.data.exchanges.length, 17);

  r = await req('POST', '/demo/seed', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);

  r = await req('GET', '/dashboard');
  assert.equal(r.status, 200);
  assert.ok(r.data.portfolio && r.data.bots.total >= 5);

  r = await req('GET', '/portfolio/equity-curve?points=80');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.curve) && r.data.curve.length === 80);

  r = await req('GET', '/market/pairs', undefined, false);
  assert.equal(r.data.pairs.length, 24);

  r = await req('GET', `/market/candles/${encodeURIComponent('BTC/USDT')}?timeframe=1h&limit=200`, undefined, false);
  assert.ok(r.data.candles.length > 0);

  r = await req('GET', `/market/orderbook/${encodeURIComponent('BTC/USDT')}`, undefined, false);
  assert.equal(r.data.bids.length, 20);
  assert.equal(r.data.asks.length, 20);

  r = await req('GET', '/market/screener', undefined, false);
  assert.equal(r.data.results.length, 24);

  r = await req('GET', `/market/indicators/${encodeURIComponent('BTC/USDT')}?timeframe=1h`, undefined, false);
  assert.equal(typeof r.data.rsi14, 'number');

  r = await req('POST', '/market/backtest', {
    symbol: 'BTC/USDT',
    timeframe: '1h',
    strategy: 'ema_cross',
    params: {},
    initialBalance: 10000,
    candleCount: 300,
  });
  assert.equal(r.status, 200);
  assert.ok(Number.isFinite(r.data.result.finalEquity));

  r = await req('POST', '/positions', { accountId: paper.id, symbol: 'BTC/USDT', side: 'long', margin: 200, leverage: 3 });
  assert.equal(r.status, 201);
  const pos = r.data.position;
  r = await req('POST', `/positions/${pos.id}/close`);
  assert.equal(r.status, 200);
  assert.equal(r.data.position.status, 'closed');

  r = await req('POST', '/bots', { type: 'grid', symbol: 'BTC/USDT', accountId: paper.id, config: {} });
  assert.equal(r.status, 201);
  const bot = r.data.bot;
  assert.ok(bot.config.lowerPrice > 0, 'grid range defaulted');
  r = await req('POST', `/bots/${bot.id}/start`);
  assert.equal(r.data.bot.status, 'running');
  r = await req('POST', `/bots/${bot.id}/stop`);
  assert.equal(r.data.bot.status, 'stopped');
  r = await req('DELETE', `/bots/${bot.id}`);
  assert.equal(r.status, 200);

  r = await req('GET', '/bots/types');
  assert.equal(r.data.types.length, 5);

  r = await req('GET', '/signals/webhook-token');
  assert.ok(r.data.token);
  r = await req('POST', `/signals/webhook?token=${r.data.token}&symbol=BTCUSDT&action=buy`, { symbol: 'BTCUSDT', action: 'buy' }, false);
  assert.equal(r.status, 201);

  r = await req('GET', '/notifications');
  assert.equal(r.status, 200);
  r = await req('GET', '/logs');
  assert.equal(r.status, 200);

  r = await req('GET', '/watchlist');
  assert.equal(r.status, 200);
});
