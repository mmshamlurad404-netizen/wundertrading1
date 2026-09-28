import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Bot as BotIcon, ArrowUpRight, Play, Pause, TrendingUp, Activity } from 'lucide-react'
import { api } from '../api'
import { useAsync, Loader, Pnl, CoinAvatar, Empty } from '../components/ui'
import { useLive } from '../live'
import { fmtCompact, fmtPct, fmtPrice, fmtUsd, timeAgo } from '../lib/format'
import type { Bot, LogEntry, PortfolioSummary, Signal } from '../types'

interface DashboardData {
  portfolio: PortfolioSummary
  equityCurve: { t: number; equity: number }[]
  bots: { total: number; running: number; pnl: number; items: Bot[] }
  topMovers: any[]
  screener: any[]
  signals: Signal[]
  logs: LogEntry[]
  fundingRates: { symbol: string; rate: number }[]
}

export default function Dashboard() {
  const { data, loading, reload } = useAsync(() => api.get<DashboardData>('/dashboard'), [], { pollMs: 10000 })
  const { tickers, list } = useLive()

  if (loading || !data) return <Loader label="Loading dashboard" />

  const p = data.portfolio
  const curve = data.equityCurve.map((c) => ({ ...c, label: new Date(c.t).toLocaleDateString() }))

  return (
    <div>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Live overview of your bots, portfolio and market activity.
          </p>
        </div>
        <Link to="/app/bots" className="btn primary">
          <BotIcon size={16} /> Manage bots
        </Link>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Total equity</div>
          <div className="stat-value mono">{fmtUsd(p.equity)}</div>
          <div className={`stat-sub mono ${p.totalPnl >= 0 ? 'up' : 'down'}`}>
            {fmtPct(p.totalPnlPct)} all time
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Unrealized PnL</div>
          <div className={`stat-value mono ${p.unrealizedPnl >= 0 ? 'up' : 'down'}`}>
            {fmtUsd(p.unrealizedPnl)}
          </div>
          <div className="stat-sub">{p.openPositions} open positions</div>
        </div>
        <div className="card">
          <div className="stat-label">Realized PnL</div>
          <div className={`stat-value mono ${p.realizedPnl >= 0 ? 'up' : 'down'}`}>
            {fmtUsd(p.realizedPnl)}
          </div>
          <div className="stat-sub">{p.totalTrades} trades executed</div>
        </div>
        <div className="card">
          <div className="stat-label">Win rate</div>
          <div className="stat-value mono">{p.winRate.toFixed(1)}%</div>
          <div className="stat-sub">
            {data.bots.running}/{data.bots.total} bots running
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', marginBottom: 16 }}>
        <div className="card">
          <div className="spread" style={{ marginBottom: 8 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              Equity curve
            </h3>
            <span className="badge blue">Paper</span>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={curve}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5b8cff" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#5b8cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <YAxis domain={['auto', 'auto']} hide />
              <Tooltip
                contentStyle={{ background: '#101725', border: '1px solid #1f2a41', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#8593ad' }}
                formatter={(v: number) => [fmtUsd(v), 'Equity']}
              />
              <Area type="monotone" dataKey="equity" stroke="#5b8cff" strokeWidth={2} fill="url(#eq)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="card-title">Top movers (24h)</h3>
          {(list.length ? list : data.topMovers)
            .slice()
            .sort((a: any, b: any) => Math.abs(b.change24h) - Math.abs(a.change24h))
            .slice(0, 6)
            .map((t: any) => (
              <div className="list-item" key={t.symbol}>
                <div className="row" style={{ gap: 10 }}>
                  <CoinAvatar symbol={t.symbol} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{t.symbol}</div>
                    <div className="muted mono" style={{ fontSize: 12 }}>
                      {fmtPrice(t.price)}
                    </div>
                  </div>
                </div>
                <span className={`mono ${t.change24h >= 0 ? 'up' : 'down'}`}>{fmtPct(t.change24h)}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              Your bots
            </h3>
            <Link to="/app/bots" className="btn ghost sm">
              View all <ArrowUpRight size={14} />
            </Link>
          </div>
          {data.bots.items.length === 0 && <Empty title="No bots yet" hint="Create your first bot to get started." />}
          {data.bots.items.map((b) => (
            <div className="list-item" key={b.id}>
              <div className="row" style={{ gap: 10 }}>
                <span className={`dot ${b.status === 'running' ? '' : 'off'}`} />
                <div>
                  <div style={{ fontWeight: 700 }}>
                    <Link to={`/app/bots/${b.id}`}>{b.name}</Link>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {b.type.toUpperCase()} · {b.symbol} · {b.stats?.trades || 0} trades
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span className="badge gray">{b.status}</span>
                <Pnl value={b.stats?.pnl} />
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    await api.post(`/bots/${b.id}/${b.status === 'running' ? 'stop' : 'start'}`)
                    reload()
                  }}
                >
                  {b.status === 'running' ? <Pause size={14} /> : <Play size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 className="card-title">Funding rates</h3>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {data.fundingRates.map((f) => (
              <div className="list-item" key={f.symbol}>
                <span style={{ fontWeight: 600 }}>{f.symbol}</span>
                <span className="mono up">{f.rate.toFixed(4)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid g3">
        <div className="card">
          <h3 className="card-title">
            <Activity size={14} style={{ verticalAlign: -2 }} /> Pump screener
          </h3>
          {data.screener.map((s) => (
            <div className="list-item" key={s.symbol}>
              <div className="row" style={{ gap: 8 }}>
                <CoinAvatar symbol={s.symbol} size={24} />
                <span style={{ fontWeight: 600 }}>{s.symbol}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className={`mono ${s.change5m >= 0 ? 'up' : 'down'}`}>{fmtPct(s.change5m)}</span>
                <span className={`badge ${s.signal === 'STRONG' ? 'green' : s.signal === 'WATCH' ? 'yellow' : 'gray'}`}>
                  {s.signal}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 className="card-title">Recent signals</h3>
          {data.signals.length === 0 && <Empty title="No signals yet" hint="Send a webhook or test a signal bot." />}
          {data.signals.map((s) => (
            <div className="list-item" key={s.id}>
              <div>
                <div style={{ fontWeight: 700 }}>{s.symbol}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {s.source} · {timeAgo(s.createdAt)}
                </div>
              </div>
              <span className={`badge ${s.action === 'buy' || s.action === 'long' ? 'green' : 'red'}`}>
                {s.action}
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 className="card-title">
            <TrendingUp size={14} style={{ verticalAlign: -2 }} /> Activity log
          </h3>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {data.logs.map((l) => (
              <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <div className="row" style={{ gap: 8, fontSize: 12.5 }}>
                  <span
                    className={`badge ${
                      l.level === 'success' ? 'green' : l.level === 'error' ? 'red' : l.level === 'warning' ? 'yellow' : 'gray'
                    }`}
                    style={{ fontSize: 9.5, padding: '2px 7px' }}
                  >
                    {l.level}
                  </span>
                  <span className="muted">{timeAgo(l.createdAt)}</span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 4 }}>{l.message}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="muted" style={{ marginTop: 18, fontSize: 12 }}>
        Markets tracked: {list.length} · Data volume 24h:{' '}
        {fmtCompact(list.reduce((s, t) => s + (t.volume24h || 0), 0))}
        <span className="mono" style={{ marginLeft: 8 }}>
          {tickers['BTC/USDT'] ? `BTC ${fmtPrice(tickers['BTC/USDT'].price)}` : ''}
        </span>
      </div>
    </div>
  )
}
