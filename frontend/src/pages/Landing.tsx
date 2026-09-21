import { Link } from 'react-router-dom'
import {
  Bot,
  Grid3x3,
  TrendingDown,
  Radio,
  GitCompareArrows,
  BrainCircuit,
  CandlestickChart,
  Radar,
  Wallet,
  ShieldCheck,
  Zap,
  ArrowRight,
  Check,
} from 'lucide-react'

const BOTS = [
  {
    icon: Grid3x3,
    name: 'Grid Bot',
    text: 'Automate buy-low / sell-high orders inside a price range. Built for sideways and choppy markets where price keeps oscillating.',
  },
  {
    icon: TrendingDown,
    name: 'DCA Bot',
    text: 'Split entries into a base order plus scaled safety orders, then exit on your target average. Reduces the impact of volatility.',
  },
  {
    icon: Radio,
    name: 'Signal Bot',
    text: 'Turn inbound webhooks or TradingView-style alerts into automatic spot and futures orders across every connected account.',
  },
  {
    icon: GitCompareArrows,
    name: 'Market Neutral Bot',
    text: 'Hold a hedged long/short pair to stay delta-neutral and collect funding while direction is irrelevant.',
  },
  {
    icon: BrainCircuit,
    name: 'AI Bot',
    text: 'A momentum model combining EMA trend detection and RSI filtering, with automatic take-profit and stop-loss management.',
  },
  {
    icon: ShieldCheck,
    name: 'Risk Engine',
    text: 'Every position supports take-profit, stop-loss, trailing stops and liquidation protection, enforced server-side 24/7.',
  },
]

const TOOLS = [
  { icon: CandlestickChart, title: 'Pro Trading Terminal', text: 'Candlestick charts, live order book, market and limit orders, position management and TP/SL editing in one screen.' },
  { icon: Radar, title: 'Pump Screener', text: 'Rank the market by momentum and volume expansion to catch unusual moves before the crowd notices them.' },
  { icon: Wallet, title: 'Portfolio Tracker', text: 'Aggregate balances and PnL across every connected account with allocation breakdowns and an equity curve.' },
  { icon: Zap, title: 'Backtesting', text: 'Replay EMA crossover, RSI mean reversion, breakout, grid and DCA strategies on historical candles in seconds.' },
]

export default function Landing() {
  return (
    <div className="landing">
      <nav className="land-nav">
        <Link to="/" className="row" style={{ gap: 10, fontWeight: 800, fontSize: 18 }}>
          <span className="brand-mark">N</span> NebulaTrade
        </Link>
        <div className="nav-links">
          <a href="#bots">Trading Bots</a>
          <a href="#tools">Tools</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="row" style={{ marginLeft: 'auto', gap: 10 }}>
          <Link to="/login" className="btn ghost">
            Sign in
          </Link>
          <Link to="/register" className="btn primary">
            Get started
          </Link>
        </div>
      </nav>

      <header className="land-hero">
        <span className="pill">
          <Zap size={14} /> Automate your crypto strategy 24/7
        </span>
        <h1>
          Crypto trading bots
          <br />
          built for every market
        </h1>
        <p className="lead">
          Run grid, DCA, signal, market-neutral and AI strategies from a single dashboard. Connect
          your exchanges, monitor risk, and let NebulaTrade execute around the clock - without you
          staring at charts.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          <Link to="/register" className="btn primary lg">
            Start free trial <ArrowRight size={17} />
          </Link>
          <Link to="/login" className="btn lg">
            Explore the demo
          </Link>
        </div>
        <div className="muted" style={{ marginTop: 16, fontSize: 13 }}>
          No credit card required. A lifetime paper-trading wallet is included.
        </div>

        <div className="grid g4" style={{ marginTop: 54, textAlign: 'left' }}>
          {[
            ['24', 'Markets streamed live'],
            ['5', 'Bot strategy engines'],
            ['0.5s', 'Risk check cadence'],
            ['100K', 'Virtual paper balance'],
          ].map(([v, l]) => (
            <div className="card" key={l}>
              <div className="stat-value">{v}</div>
              <div className="stat-sub">{l}</div>
            </div>
          ))}
        </div>
      </header>

      <section className="land-section" id="bots">
        <h2>Discover the bot that fits your edge</h2>
        <p className="muted" style={{ fontSize: 16, maxWidth: 680, marginBottom: 28 }}>
          Each engine is a self-contained strategy with its own parameters, logs and performance
          tracking. Launch several at once across different accounts and markets.
        </p>
        <div className="grid g3">
          {BOTS.map((b) => (
            <div className="feature-card" key={b.name}>
              <div className="feature-icon">
                <b.icon size={21} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>{b.name}</h3>
              <p className="muted" style={{ margin: 0, lineHeight: 1.6, fontSize: 13.5 }}>
                {b.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section" id="tools">
        <h2>Tools for smarter trading</h2>
        <p className="muted" style={{ fontSize: 16, maxWidth: 680, marginBottom: 28 }}>
          Everything you need to research, execute and manage positions is part of the same
          workspace.
        </p>
        <div className="grid g2">
          {TOOLS.map((t) => (
            <div className="feature-card" key={t.title}>
              <div className="feature-icon">
                <t.icon size={21} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>{t.title}</h3>
              <p className="muted" style={{ margin: 0, lineHeight: 1.6, fontSize: 13.5 }}>
                {t.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section" id="how">
        <h2>Get started in three steps</h2>
        <div className="grid g3" style={{ marginTop: 26 }}>
          {[
            ['Connect an account', 'Add an exchange API key or start with the built-in paper wallet in one click.'],
            ['Configure your bot', 'Pick a strategy, set your range or deviation, and define take-profit and stop-loss.'],
            ['Monitor and adjust', 'Watch live PnL, positions and logs, then tune parameters whenever the market shifts.'],
          ].map(([t, d], i) => (
            <div className="card pad-lg" key={t}>
              <div className="brand-mark" style={{ marginBottom: 14 }}>
                {i + 1}
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{t}</h3>
              <p className="muted" style={{ margin: 0, lineHeight: 1.6, fontSize: 13.5 }}>
                {d}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section" id="pricing">
        <h2>Simple, transparent pricing</h2>
        <div className="grid g3" style={{ marginTop: 26 }}>
          {[
            { name: 'Free', price: '$0', features: ['Paper trading wallet', '1 running bot', 'Trading terminal', 'Pump screener'], cta: 'Start free' },
            { name: 'Pro', price: '$29', highlight: true, features: ['Unlimited bots', 'Multi-account trading', 'Webhook & API access', 'Backtesting suite', 'Priority risk engine'], cta: 'Start 7-day trial' },
            { name: 'Scale', price: '$79', features: ['Everything in Pro', 'Team accounts', 'Custom strategies', 'Dedicated support'], cta: 'Contact us' },
          ].map((p) => (
            <div
              className="card pad-lg"
              key={p.name}
              style={
                p.highlight
                  ? { borderColor: 'rgba(91,140,255,0.5)', boxShadow: '0 0 0 1px rgba(91,140,255,0.2)' }
                  : undefined
              }
            >
              <div className="spread">
                <h3 style={{ margin: 0, fontSize: 18 }}>{p.name}</h3>
                {p.highlight && <span className="badge blue">Popular</span>}
              </div>
              <div style={{ fontSize: 34, fontWeight: 900, margin: '14px 0' }}>
                {p.price}
                <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>
                  /mo
                </span>
              </div>
              <div style={{ display: 'grid', gap: 9, marginBottom: 20 }}>
                {p.features.map((f) => (
                  <div className="row" key={f} style={{ gap: 8, fontSize: 13.5 }}>
                    <Check size={15} className="up" /> {f}
                  </div>
                ))}
              </div>
              <Link to="/register" className={`btn block ${p.highlight ? 'primary' : ''}`}>
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section" style={{ textAlign: 'center' }}>
        <div className="card pad-lg" style={{ background: 'linear-gradient(135deg, rgba(91,140,255,0.14), rgba(139,91,255,0.1))' }}>
          <Bot size={30} style={{ color: '#a9c1ff' }} />
          <h2 style={{ margin: '14px 0 8px' }}>Ready to put your strategy on autopilot?</h2>
          <p className="muted" style={{ maxWidth: 560, margin: '0 auto 22px' }}>
            Create your workspace in seconds and deploy your first bot against live simulated
            markets - no exchange keys required.
          </p>
          <Link to="/register" className="btn primary lg">
            Create free account <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <footer className="land-footer">
        <div className="land-footer-inner">
          <div>
            <div className="row" style={{ gap: 10, fontWeight: 800, marginBottom: 8 }}>
              <span className="brand-mark">N</span> NebulaTrade
            </div>
            <div>Automated crypto trading, portfolio management and market intelligence.</div>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              NebulaTrade is a simulated trading environment for demonstration and education. It
              does not provide financial advice and does not guarantee profits.
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong style={{ color: 'var(--text)' }}>Platform</strong>
            <a href="#bots">Trading bots</a>
            <a href="#tools">Tools</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong style={{ color: 'var(--text)' }}>Account</strong>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
          </div>
        </div>
        <div style={{ maxWidth: 1180, margin: '24px auto 0', fontSize: 12 }}>
          &copy; {new Date().getFullYear()} NebulaTrade. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
