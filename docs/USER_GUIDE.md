# NebulaTrade User Guide

This guide walks through every section of the application: what it does and how
to use it. Sections appear in the same order as the left navigation.

The app has two areas:

- Public: Landing, Register, Login.
- Authenticated (`/app`): Dashboard, Terminal, Bots, Portfolio, Screener,
  Backtest, Exchanges, Signal Hub, Settings.

---

## 1. Landing page

The marketing home page at `/`. It presents the bot lineup, the platform tools,
a three-step onboarding flow and plan tiers. Use the top navigation to open the
documentation-style anchors on the page, or use "Sign in" / "Get started" to
enter the app.

How to use:

1. Scroll through the strategy and tools sections to learn what the platform
   offers.
2. Click "Get started" to register, or "Sign in" if you already have an account.

---

## 2. Register and Login

### Register (`/register`)

Creates a new account and provisions a workspace automatically.

How to use:

1. Enter a name, email and a password (minimum 6 characters).
2. Submit. On success you are signed in and redirected to the Dashboard.
3. A Paper Wallet with a 100,000 USDT balance and a starter watchlist
   (BTC/USDT, ETH/USDT, SOL/USDT) are created for you.

### Login (`/login`)

Signs in with email and password, with a second step when two-factor
authentication is enabled on the account.

How to use:

1. Enter your email and password and submit.
2. If 2FA is enabled, the form switches to a verification step. Enter the
   6-digit code from your authenticator app and submit. Use "Back to sign in" to
   restart if needed.

The JWT session is stored in the browser and sent as a bearer token on every API
call. The ticker websocket reconnects automatically.

---

## 3. Dashboard (`/app`)

The live overview. It refreshes automatically every 10 seconds (prices also
stream over the websocket).

What you see:

- Stat cards: Total equity, Unrealized PnL, Realized PnL and Win rate across
  accounts and bots.
- Equity curve for the recent period.
- Top movers (24h), funding rates, recent signals and bot/activity logs.

How to use:

1. Scan the stat cards for overall performance.
2. Use the equity curve to track account growth.
3. Click through to a bot or the Terminal from the lists to act on anything that
   needs attention.

---

## 4. Terminal (`/app/terminal`)

The manual trading and charting workspace.

Layout:

- Market selector and price header on top (with an "add to watchlist" control).
- Candlestick chart with selectable timeframes.
- Positions / Orders / History tabs below the chart.
- Order ticket on the right with a quick order form and the live order book.

How to use the chart:

1. Search or pick a market in the "Search market" box.
2. Choose a timeframe (for example 1m, 15m, 1h, 4h, 1d).
3. Switch between "Classic" candlestick and "Spread" view when a market-neutral
   position exists.

How to place an order:

1. In the order ticket, select the Account to trade with.
2. Choose the side. For classic trading you open a long or short; enter the
   Margin (USDT), Leverage (1x-...), and optionally Take profit, Stop loss and a
   Trailing %.
3. Submit to open the position. Live accounts place a real order; demo and paper
   accounts simulate the fill with fees and slippage.

Managing positions:

1. Open the Positions tab. Each row shows entry, mark, size and PnL.
2. Use the row actions to close a position or edit TP / SL / trailing stop.
3. The Orders tab shows working and filled orders; History shows closed
   positions.

The order book refreshes every 2 seconds; positions refresh every 4 seconds.

---

## 5. Bots (`/app/bots`)

Create and manage automated strategies.

How to use:

1. Click "Create bot".
2. Choose a Strategy (see the strategy reference below), a Market, an Account,
   and optionally a name.
3. Adjust the strategy parameters shown for the selected strategy.
4. Create the bot. It starts in the "stopped" state.
5. Use the Start / Stop controls on the bot card. The list refreshes every 8
   seconds.

### Strategy reference

Grid bot

- Buys low and sells high inside a price range.
- Parameters: `lowerPrice`, `upperPrice`, `grids`, `investmentPerGrid`, `leverage`.
- If price bounds are left empty, they default to +/-10% around the current price.

DCA bot

- Averages entries across safety orders and exits on a target.
- Parameters: `baseOrderSize`, `safetyOrderSize`, `maxSafetyOrders`,
  `priceDeviation`, `safetyOrderVolumeScale`, `takeProfitPct`, `stopLossPct`,
  `leverage`.

Signal bot

- Executes TradingView-style webhooks or manual signals (see Signal Hub).
- Parameters: `orderSize`, `leverage`, `takeProfitPct`, `stopLossPct`.

Market-neutral bot

- Delta-neutral funding capture with hedged legs.
- Parameters: `legSize`, `leverage`, `targetFunding`.

AI bot

- Trend and momentum model that adapts to the market, with an optional LLM
  overlay.
- Parameters: `orderSize`, `leverage`, `timeframe`, `fastPeriod`, `slowPeriod`,
  `takeProfitPct`, `stopLossPct`, `maxHoldMinutes`.
- Enable "Use LLM strategy" in the bot configuration to use the optional LLM
  provider when `NT_LLM_*` is configured; otherwise the built-in rules are used.

---

## 6. Bot detail (`/app/bots/:id`)

The per-bot control panel. It refreshes every 6 seconds.

How to use:

1. Review the bot header: status, type, market, created time.
2. Use Start / Stop to control the bot, and "Close all" to flatten only this
   bot's open positions.
3. Edit the Configuration fields inline and save. Some changes reset runtime
   state (for example, a stopped grid bot re-plans its levels).
4. Use "Send a signal" to dispatch a manual signal to this bot: choose an
   Action, optional Size multiplier, and a market/price.
5. Review the Recent logs to audit every action the bot took.

---

## 7. Portfolio (`/app/portfolio`)

Consolidated balances, performance and allocation across all accounts.

What you see:

- Equity curve (7 days).
- Allocation donut with per-asset value and percentage.
- Balances and open/closed position tables.

How to use:

1. Switch between the Open and History tabs to review live and closed positions.
2. Use "Refresh" to force an immediate sync.
3. Data refreshes automatically (portfolio every 8 seconds, allocation every 15
   seconds, history every 20 seconds).

---

## 8. Screener (`/app/screener`)

Ranks markets by short-term momentum and volume expansion.

What you see, per market:

- Price, 5m / 1h / 24h change, 24h volume, volume ratio and a composite score.
- A signal badge: STRONG, WATCH, MILD or NEUTRAL.

How to use:

1. Use the filter box to narrow by symbol.
2. Filter by signal strength.
3. Click column headers to sort.
4. Auto-refresh runs every 3 seconds; toggle it off to freeze the view. Click a
   row to open that market.

---

## 9. Backtest (`/app/backtest`)

Replays strategies on historical candles so you can compare performance before
going live.

How to use:

1. Configure Market, Timeframe, number of Candles, Strategy, Initial balance and
   the strategy parameters.
2. Run the backtest. Results include total return, win rate, number of trades,
   max drawdown, an equity chart and a trade PnL distribution.
3. Adjust parameters and re-run to compare.

---

## 10. Exchanges (`/app/exchanges`)

Connect exchange accounts or trade with the built-in paper wallet.

Connected accounts:

- Each card shows the exchange, mode (demo/live), market type, testnet flag,
  equity, masked API key and last sync time.
- Live accounts show a Sync button to reconcile immediately.
- Use Disconnect to remove an account. Close all open positions first.

Connecting an account:

1. Click "Add exchange" or the Connect button in the Supported exchanges table.
2. Enter an Account label.
3. Choose Mode:
   - Demo (simulated balances) works for every exchange, even without keys.
   - Live (real orders) is only selectable for exchanges marked "live". It
     requires API credentials.
4. For futures venues, choose Market type (Futures/perpetual or Spot).
5. Paste the API key, the API secret (when required) and the passphrase (when
   required). Enable the testnet/sandbox checkbox to use exchange test endpoints.
6. Connect. For live accounts the credentials are validated with a connection
   test before the account is saved, then the balance is synced.

Security: enable trade permission only and never enable withdrawals. Keys are
stored encrypted and only the last 4 characters are displayed.

---

## 11. Signal Hub (`/app/signals`)

Connect TradingView-style webhooks or dispatch manual signals to signal bots.

Webhook endpoint:

1. Copy the generated URL, for example
   `https://<host>/api/signals/webhook?token=<your-token>`.
2. Configure your alert tool to POST a JSON body such as:

```json
{
  "symbol": "BTCUSDT",
  "action": "buy",
  "price": 94250,
  "size_multiplier": 1
}
```

- `symbol`: market symbol, either `BTCUSDT` or `BTC/USDT`.
- `action`: `buy`, `sell` or `close`.
- `price`: optional; defaults to the current market price.
- `size_multiplier`: optional size scaling factor.

Dispatch a manual signal:

1. Choose a Target signal bot.
2. Choose an Action (Buy/Long, Sell/Short, Close).
3. Enter the Market and an optional Price (defaults to market).
4. Dispatch. The signal history table shows time, market, action, price, source
   and whether it was consumed (executed) or still pending.

---

## 12. Settings (`/app/settings`)

Profile, security, two-factor authentication, integration status and watchlist.

Profile:

1. Edit Name and Email and click "Save profile".

Password:

1. Enter your current password and a new password (minimum 6 characters) and
   click "Change password".

Two-factor authentication (TOTP):

1. Click "Set up 2FA".
2. Add the displayed secret key to your authenticator app (Google Authenticator,
   Authy, 1Password, etc.).
3. Enter the 6-digit code and click "Enable 2FA". The badge turns green and the
   next sign-in will require a code.
4. To disable, enter your account password and a current code, then click
   "Disable 2FA".

Integration status badges:

- LLM strategy provider: active when `NT_LLM_*` is configured.
- Email alerts: active when `NT_SMTP_*` is configured.
- Market data feed: Live or Simulated.
- Real-time order stream: number of active user-data websockets (Binance, Bybit,
  OKX).

Watchlist:

1. Pick a market and click Add.
2. Remove entries with the trash button. The table shows live price and 24h
   change.

---

## Tips and conventions

- Markets are written as `BASE/QUOTE` in the UI (for example `BTC/USDT`). Webhook
  payloads accept the concatenated form (`BTCUSDT`).
- Live pages poll automatically; use a page's Refresh button when you want an
  immediate update.
- Paper trading is safe for experimentation. Demo accounts behave like paper
  trading but are labelled per exchange.
- Bot actions are written to the activity log, visible on the Dashboard and the
  bot detail page.
