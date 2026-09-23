import WebSocket from 'ws';
import { store as defaultStore } from './store.js';
import { market } from './market.js';
import { getAccountSecrets } from './trading.js';
import { getAdapter } from './exchanges/index.js';
import { userStreamUrl } from './exchanges/binance.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Turn a raw Binance user-data event into a normalized, venue-agnostic shape.
// Pure so it can be unit tested without a live socket.
export function normalizeUserEvent(event) {
  if (!event || typeof event !== 'object') return null;

  if (event.e === 'ORDER_TRADE_UPDATE' || event.e === 'executionReport') {
    const o = event.o || event;
    const filledQty = num(o.z);
    const cumQuote = num(o.Z);
    const avgFromQuote = cumQuote !== undefined && filledQty ? cumQuote / filledQty : undefined;
    return {
      type: 'order',
      dedupeKey: `order:${o.i || o.c}:${o.X}:${o.z ?? ''}`,
      clientOrderId: o.c || null,
      orderId: o.i !== undefined && o.i !== null ? String(o.i) : null,
      symbol: o.s || null,
      side: String(o.S || '').toLowerCase(),
      status: o.X || null,
      origQty: num(o.q),
      filledQty,
      avgPrice: num(o.ap) ?? avgFromQuote ?? num(o.L) ?? num(o.p),
      lastPrice: num(o.L),
      fee: num(o.n),
      feeAsset: o.N || null,
      reduceOnly: o.R === true || o.r === true,
      realizedPnl: num(o.rp),
    };
  }

  if (event.e === 'ACCOUNT_UPDATE') {
    const balances = (event.a?.B || []).map((b) => ({
      asset: b.a,
      wallet: num(b.wb),
      cross: num(b.cw),
    }));
    return { type: 'account', dedupeKey: `acct:${event.E}`, balances };
  }

  if (event.e === 'outboundAccountPosition') {
    const balances = (event.B || []).map((b) => ({
      asset: b.a,
      free: num(b.f),
      locked: num(b.l),
    }));
    return { type: 'account', dedupeKey: `acct:${event.u}`, balances };
  }

  if (event.e === 'listenKeyExpired') return { type: 'listenKeyExpired' };
  return null;
}

function equityFromBalances(balances) {
  let equity = 0;
  for (const [asset, qty] of Object.entries(balances || {})) {
    if (asset === 'USDT') equity += qty;
    else {
      const price = market.getPrice(`${asset}/USDT`);
      equity += price ? price * qty : 0;
    }
  }
  return equity;
}

// Apply a normalized event to local state. Returns a short description of what
// changed (or null when nothing matched).
export function applyUserEvent(account, event, { store = defaultStore } = {}) {
  const evt = normalizeUserEvent(event);
  if (!evt || !account) return null;

  if (evt.type === 'order') {
    const order = store.find(
      'orders',
      (o) =>
        (evt.orderId && o.exchangeOrderId === evt.orderId) ||
        (evt.clientOrderId && o.clientOrderId === evt.clientOrderId)
    );
    const patch = {
      status: evt.status,
      filledQty: evt.filledQty,
      filledPrice: evt.avgPrice,
      fee: evt.fee,
      feeAsset: evt.feeAsset,
      exchangeOrderId: evt.orderId,
      syncedAt: Date.now(),
    };
    const status = String(evt.status || '').toUpperCase();
    if (status === 'FILLED') {
      if (order) store.update('orders', order.id, patch);
      // Reflect the fill in the linked position when this was an entry.
      const pos = store.find(
        'positions',
        (p) =>
          p.accountId === account.id &&
          evt.orderId &&
          p.exchangeOrderId === evt.orderId
      );
      if (pos && Number.isFinite(evt.avgPrice) && evt.avgPrice > 0) {
        store.update('positions', pos.id, {
          entryPrice: evt.avgPrice,
          size: evt.filledQty || pos.size,
          unrealizedPnl: 0,
        });
      }
      return `order ${evt.orderId} filled`;
    }
    if (order) {
      store.update('orders', order.id, patch);
      return `order ${evt.orderId} ${status}`;
    }
    return null;
  }

  if (evt.type === 'account') {
    const balances = {};
    for (const b of evt.balances) {
      const total = b.wallet !== undefined ? b.wallet : (b.free || 0) + (b.locked || 0);
      if (Number.isFinite(total) && total > 0) balances[b.asset] = total;
    }
    if (Object.keys(balances).length) {
      account.balances = { ...account.balances, ...balances };
      account.equity = equityFromBalances(account.balances);
      account.syncedAt = Date.now();
      store.markDirty();
      return `account ${account.id} balances synced`;
    }
    return null;
  }

  return null;
}

// Manages Binance user-data websocket streams so fills are reflected in real
// time instead of waiting for the 15s REST poll.
export class UserStreamManager {
  constructor({ reconnencyDelayMs = 5000 } = {}) {
    this.streams = new Map(); // accountId -> { ws, listenKey, keepAlive, account }
    this.reconnectDelayMs = reconnencyDelayMs;
    this.started = false;
    this.log = [];
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.sync().catch(() => {});
    this.timer = setInterval(() => this.sync().catch(() => {}), 30000);
    this.timer.unref?.();
  }

  async sync() {
    let live = [];
    try {
      live = defaultStore.filter('exchanges', (a) => a.mode === 'live' && a.connected && a.exchange === 'binance');
    } catch {
      return;
    }
    for (const account of live) {
      if (!this.streams.has(account.id)) await this.subscribe(account);
    }
    for (const id of [...this.streams.keys()]) {
      if (!live.some((a) => a.id === id)) this.unsubscribe(id);
    }
  }

  async subscribe(account) {
    const adapter = getAdapter(account.exchange);
    if (!adapter?.createListenKey) return;
    const secrets = getAccountSecrets(account);
    if (!secrets?.apiKey) return;
    try {
      const listenKey = await adapter.createListenKey(secrets, {
        marketType: account.marketType === 'spot' ? 'spot' : 'futures',
        testnet: account.testnet,
      });
      if (!listenKey) return;
      const url = userStreamUrl(listenKey, {
        marketType: account.marketType === 'spot' ? 'spot' : 'futures',
        testnet: account.testnet,
      });
      const ws = new WebSocket(url);
      const entry = { account, ws, listenKey, keepAlive: null, closed: false };
      ws.on('message', (buf) => {
        try {
          const event = JSON.parse(buf.toString());
          applyUserEvent(account, event);
          if (event.e === 'listenKeyExpired') this.resubscribe(account.id);
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.on('close', () => {
        if (!entry.closed) this.resubscribe(account.id);
      });
      ws.on('error', () => {});
      entry.keepAlive = setInterval(() => {
        adapter
          .keepAliveListenKey(secrets, listenKey, {
            marketType: account.marketType === 'spot' ? 'spot' : 'futures',
            testnet: account.testnet,
          })
          .catch(() => {});
      }, 25 * 60 * 1000);
      entry.keepAlive.unref?.();
      this.streams.set(account.id, entry);
      this.log.push(`subscribed ${account.exchange} ${account.id}`);
    } catch (err) {
      this.log.push(`subscribe failed ${account.id}: ${err.message}`);
    }
  }

  resubscribe(accountId) {
    this.unsubscribe(accountId);
    setTimeout(() => {
      const account = defaultStore.find('exchanges', (a) => a.id === accountId);
      if (account && account.mode === 'live') this.subscribe(account).catch(() => {});
    }, this.reconnectDelayMs).unref?.();
  }

  unsubscribe(accountId) {
    const entry = this.streams.get(accountId);
    if (!entry) return;
    entry.closed = true;
    try {
      entry.ws.close();
    } catch {
      /* ignore */
    }
    if (entry.keepAlive) clearInterval(entry.keepAlive);
    this.streams.delete(accountId);
  }

  status() {
    return {
      started: this.started,
      streams: [...this.streams.keys()],
      log: this.log.slice(-20),
    };
  }
}

export const userStreamManager = new UserStreamManager();
