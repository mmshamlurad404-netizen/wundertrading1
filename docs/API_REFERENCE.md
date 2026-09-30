# NebulaTrade API Reference

Base URL: `http://localhost:3001` (development; the Vite dev server proxies
`/api` and `/ws` from port 5173).

Authentication: most routes require a bearer token in the `Authorization`
header. Obtain one from `/api/auth/login` or `/api/auth/register`.

```
Authorization: Bearer <token>
```

Errors are returned as JSON `{ "error": "message" }` with an appropriate HTTP
status (`400` validation, `401` unauthenticated, `404` not found, `409` conflict,
`502` upstream exchange failure).

Numbers in request bodies are accepted as numbers or numeric strings unless
noted otherwise.

---

## Health

### GET /api/health

Public. Returns `{ ok, service, pairs, uptime, time }`.

---

## Auth

### POST /api/auth/register

Public. Body: `{ email, password, name? }`. Creates the user and provisions a
Paper Wallet and starter watchlist.

Returns `201 { token, user }`.

### POST /api/auth/login

Public. Body: `{ email, password }`.

- Without 2FA: `{ token, user }`.
- With 2FA enabled: `{ requires2fa: true, pendingToken, user }`.

### POST /api/auth/login/2fa

Public. Body: `{ pendingToken, code }`. Completes a login that required 2FA.

Returns `{ token, user }`.

### POST /api/auth/2fa/setup

Auth. Begins TOTP enrolment. Returns `{ secret, otpauthUrl }`. Nothing is
enforced until `/2fa/enable` confirms a code.

### POST /api/auth/2fa/enable

Auth. Body: `{ code }`. Confirms the pending secret. Returns `{ ok, user }`.

### POST /api/auth/2fa/disable

Auth. Body: `{ password, code }`. Disables 2FA. Returns `{ ok, user }`.

### GET /api/auth/me

Auth. Returns `{ user }`, including `twoFactorEnabled`.

### PATCH /api/auth/profile

Auth. Body: `{ name?, email? }`. Updates the profile; email must be unique and
well-formed. Returns `{ user }`.

### POST /api/auth/password

Auth. Body: `{ currentPassword, newPassword }`. Returns `{ ok: true }`.

---

## Market data

All market routes are public except backtest.

### GET /api/market/pairs

Returns `{ pairs: [ticker] }` for all supported markets. Each ticker includes
`symbol`, `price`, `change24h`, `high24h`, `low24h`, `volume24h`, `category`.

### GET /api/market/ticker/:symbol

Returns `{ ticker }`. `:symbol` is URL-encoded, for example `BTC%2FUSDT`.

### GET /api/market/candles/:symbol?timeframe=1h&limit=200

Returns `{ symbol, timeframe, candles, source }` where `source` is `live` or
`simulator`. Each candle is `{ t, o, h, l, c, v }`.

### GET /api/market/orderbook/:symbol

Returns `{ symbol, bids, asks, source }`. Bids/asks are price/size pairs. Real
depth is used when a public venue is reachable, otherwise a synthetic ladder.

### GET /api/market/funding

Returns `{ rates: [{ symbol, rate, source }], updatedAt }`.

### GET /api/market/screener

Returns `{ results: [{ symbol, price, change5m, change1h, change24h, volume24h,
volumeRatio, score, signal }] }` where `signal` is one of `STRONG`, `WATCH`,
`MILD`, `NEUTRAL`.

### GET /api/market/overview

Returns `{ totalVolume, gainers, losers, pairCount }`.

### GET /api/market/indicators/:symbol?timeframe=1h

Returns `{ symbol, timeframe, ema9, ema21, ema50, sma20, rsi14, atrProxy }`.

### POST /api/market/backtest

Auth. Body: `{ symbol, timeframe, candles, strategy, initialBalance, ...params }`.

Returns `{ result }` with performance metrics, an equity series and trade list.

---

## Trading

### GET /api/exchanges/supported

Returns `{ exchanges: [{ id, name, type, regions, markets, liveCapable,
requiresSecret, requiresPassphrase, futures, verified }] }`.

### GET /api/accounts

Returns `{ accounts }` with masked key info (`keyLast4`), mode, market type,
equity and sync time.

### POST /api/accounts

Body:
`{ exchange, label?, mode? = "demo", marketType? = "futures", apiKey?, apiSecret?, passphrase?, testnet? = false, validate? = true }`.

For `mode: "live"` credentials are required and validated with a connection test
before saving. Returns `201 { account }`.

### POST /api/accounts/:id/test

Runs a connection test and syncs once. Returns `{ ok, result }`.

### POST /api/accounts/:id/sync

Live accounts only. Returns `{ ok, equity, syncedAt }`.

### DELETE /api/accounts/:id

Removes an account. Open positions must be closed first; the Paper Wallet cannot
be removed. Returns `{ ok: true }`.

### POST /api/accounts/:id/reset

Closes open positions and resets the simulated balance. Returns `{ ok: true }`.

### GET /api/positions?status=open|closed|all

Returns `{ positions }`. Defaults to `open`.

### POST /api/positions

Body:
`{ accountId?, symbol, side, margin? = 100, leverage? = 1, stopLoss?, takeProfit?, trailingStop? }`.

Returns `201 { position }`.

### POST /api/positions/:id/close

Closes a position. Returns `{ position }`.

### PATCH /api/positions/:id

Body: `{ stopLoss?, takeProfit?, trailingStop? }` (send `null` to clear).
Returns `{ position }`.

### GET /api/orders

Returns `{ orders }`, most recent first (max 200).

### GET /api/portfolio

Returns `{ portfolio, accounts, positions, botsSummary }`.

### GET /api/portfolio/equity-curve?points=60

Returns `{ curve: [{ t, equity }] }`.

### GET /api/portfolio/allocation

Returns `{ allocation: [{ asset, qty, value, pct }] }`.

---

## Bots

All bot routes require auth.

### GET /api/bots/types

Returns `{ types: [{ id, label, description }] }`.

### GET /api/bots

Returns `{ bots }`.

### GET /api/bots/:id

Returns `{ bot, positions, logs }` (logs capped at 100).

### POST /api/bots

Body: `{ name?, type, symbol, accountId?, config? }`. `type` is one of `grid`,
`dca`, `signal`, `market_neutral`, `ai`. Missing config values fall back to
defaults; grid bounds default to +/-10% around the current price.

Returns `201 { bot }`.

### PATCH /api/bots/:id

Body: `{ name?, config? }`. Config is merged into the existing config.
Returns `{ bot }`.

### POST /api/bots/:id/start

Returns `{ bot }` with status `running`.

### POST /api/bots/:id/stop

Returns `{ bot }` with status `stopped`.

### DELETE /api/bots/:id

Removes the bot record. Its open positions continue to be managed by the
position monitor. Returns `{ ok: true }`.

### POST /api/bots/:id/close-all

Closes every open position belonging to the bot. Returns `{ ok, closed }`.

### POST /api/bots/:id/signal

Body: `{ action, symbol?, price?, sizeMultiplier? = 1 }`. Creates a signal for
the bot. Returns `{ signal }`.

---

## Signals and workspace

### POST /api/signals/webhook?token=<token>

Public (mounted before authenticated routers). The `token` is the target
account id shown in the Signal Hub. Body:
`{ symbol, action, price?, size_multiplier? }`. `symbol` may be `BTCUSDT` or
`BTC/USDT`.

Returns `201 { ok: true, signal }`.

### GET /api/signals

Auth. Returns `{ signals }`, most recent first.

### GET /api/signals/webhook-token

Auth. Returns `{ token, exampleUrl, body }` for the default account.

### GET /api/notifications

Auth. Returns `{ notifications, unread }`.

### POST /api/notifications/read-all

Auth. Returns `{ ok: true }`.

### GET /api/logs?limit=150

Auth. Returns `{ logs }`.

### GET /api/watchlist

Auth. Returns `{ watchlist: [ticker] }`.

### POST /api/watchlist

Auth. Body: `{ symbol, action = "add" }` (`add` or `remove`). Returns
`{ symbols }`.

### GET /api/dashboard

Auth. Returns `{ portfolio, equityCurve, bots, topMovers, screener, signals,
logs, fundingRates }`.

### GET /api/system/status

Auth. Returns integration status:
`{ feed, marketData, userStream, llm, smtp }`.

### POST /api/demo/seed

Auth. Seeds sample bots and trade history (only when the user has no bots yet).
Returns `{ ok: true }`.

---

## Websocket

### ws://localhost:3001/ws

On connect the server sends a snapshot:
`{ type: "snapshot", data: { <symbol>: <ticker> }, symbol }`.

Thereafter it broadcasts `{ type: "tickers", data: { <symbol>: <ticker> }, time }`
on every market tick.
