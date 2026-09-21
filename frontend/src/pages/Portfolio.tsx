import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { Wallet, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { useAsync, useToast, Loader, Empty, Pnl, CoinAvatar } from '../components/ui'
import { useLive } from '../live'
import { fmtPct, fmtPrice, fmtUsd, pnlClass, fmtTime } from '../lib/format'
import type { Account, Position, PortfolioSummary } from '../types'

const PIE_COLORS = ['#5b8cff', '#8b5bff', '#16c784', '#f0b90b', '#ea3943', '#00d4ff', '#ff9f43']

interface PortfolioData {
  portfolio: PortfolioSummary
  accounts: { id: string; exchange: string; label: string; equity: number }[]
  positions: Position[]
  botsSummary: { total: number; running: number; pnl: number }
}

export default function Portfolio() {
  const toast = useToast()
  const { priceOf } = useLive()
  const [tab, setTab] = useState<'open' | 'history'>('open')
  const { data, loading, reload } = useAsync(() => api.get<PortfolioData>('/portfolio'), [])
  const { data: curveData } = useAsync(
    () => api.get<{ curve: { t: number; equity: number }[] }>('/portfolio/equity-curve?points=80'),
    []
  )
  const { data: allocData, reload: reloadAlloc } = useAsync(
    () => api.get<{ allocation: { asset: string; value: number; pct: number; qty: number }[] }>('/portfolio/allocation'),
    []
  )
  const { data: histData, reload: reloadHist } = useAsync(
    () => api.get<{ positions: Position[] }>('/positions?status=closed'),
    []
  )
  const { data: accountsData, reload: reloadAccounts } = useAsync(
    () => api.get<{ accounts: Account[] }>('/accounts'),
    []
  )

  if (loading || !data) return <Loader />

  const p = data.portfolio
  const curve = (curveData?.curve || []).map((c) => ({ ...c, label: new Date(c.t).toLocaleDateString() }))
  const allocation = (allocData?.allocation || []).filter((a) => a.value > 1)

  return (
    <div>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Portfolio</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Consolidated balances, performance and allocation across all accounts.
          </p>
        </div>
        <button
          className="btn"
          onClick={() => {
            reload()
            reloadAlloc()
            reloadAccounts()
          }}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Portfolio value</div>
          <div className="stat-value mono">{fmtUsd(p.equity)}</div>
          <div className={`stat-sub mono ${p.totalPnl >= 0 ? 'up' : 'down'}`}>
            {fmtUsd(p.totalPnl)} ({fmtPct(p.totalPnlPct)})
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Unrealized</div>
          <div className={`stat-value mono ${p.unrealizedPnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(p.unrealizedPnl)}</div>
          <div className="stat-sub">{p.openPositions} positions</div>
        </div>
        <div className="card">
          <div className="stat-label">Realized</div>
          <div className={`stat-value mono ${p.realizedPnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(p.realizedPnl)}</div>
          <div className="stat-sub">{p.totalTrades} trades</div>
        </div>
        <div className="card">
          <div className="stat-label">Bot PnL</div>
          <div className={`stat-value mono ${data.botsSummary.pnl >= 0 ? 'up' : 'down'}`}>
            {fmtUsd(data.botsSummary.pnl)}
          </div>
          <div className="stat-sub">
            {data.botsSummary.running}/{data.botsSummary.total} bots running
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', marginBottom: 16 }}>
        <div className="card">
          <h3 className="card-title">Equity curve (7 days)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={curve}>
              <defs>
                <linearGradient id="peq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5bff" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#8b5bff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ background: '#101725', border: '1px solid #1f2a41', borderRadius: 8, fontSize: 12 }}
                labelFormatter={() => ''}
                formatter={(v: number) => [fmtUsd(v), 'Equity']}
              />
              <Area type="monotone" dataKey="equity" stroke="#8b5bff" strokeWidth={2} fill="url(#peq)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="card-title">Allocation</h3>
          {allocation.length ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={allocation} dataKey="value" nameKey="asset" innerRadius={46} outerRadius={74} paddingAngle={3}>
                    {allocation.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#101725', border: '1px solid #1f2a41', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtUsd(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
              {allocation.slice(0, 6).map((a, i) => (
                <div className="list-item" key={a.asset}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span style={{ fontWeight: 600 }}>{a.asset}</span>
                  </div>
                  <div className="row" style={{ gap: 12 }}>
                    <span className="mono muted">{fmtUsd(a.value)}</span>
                    <span className="mono">{a.pct.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <Empty title="No allocation yet" />
          )}
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3 className="card-title">
            <Wallet size={14} style={{ verticalAlign: -2 }} /> Accounts
          </h3>
          {(accountsData?.accounts || []).map((a) => (
            <div className="list-item" key={a.id}>
              <div className="row" style={{ gap: 10 }}>
                <CoinAvatar symbol={a.exchange.toUpperCase()} />
                <div>
                  <div style={{ fontWeight: 700 }}>{a.label}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {a.exchange} · {a.mode} · key ****{a.keyLast4}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontWeight: 700 }}>
                  {fmtUsd(a.equity)}
                </div>
                <button
                  className="btn ghost sm"
                  style={{ marginTop: 4 }}
                  onClick={async () => {
                    if (!confirm(`Reset ${a.label} to its starting balance?`)) return
                    await api.post(`/accounts/${a.id}/reset`)
                    toast('Account reset', 'success')
                    reload()
                    reloadAccounts()
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 className="card-title">Balances</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num">Amount</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(p.balances).map(([asset, qty]) => {
                  const price = asset === 'USDT' ? 1 : priceOf(`${asset}/USDT`) || 0
                  return (
                    <tr key={asset}>
                      <td style={{ fontWeight: 600 }}>{asset}</td>
                      <td className="num mono">{qty.toFixed(asset === 'USDT' ? 2 : 5)}</td>
                      <td className="num mono">{price ? fmtPrice(price) : '--'}</td>
                      <td className="num mono">{fmtUsd(qty * price)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="panel-head">
          <div className="tabs">
            <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
              Open positions
            </button>
            <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
              Trade history
            </button>
          </div>
          <Link to="/app/terminal" className="btn ghost sm" style={{ marginLeft: 'auto' }}>
            Open terminal
          </Link>
        </div>
        <div className="table-wrap">
          {tab === 'open' ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="num">Entry</th>
                  <th className="num">Mark</th>
                  <th className="num">Size</th>
                  <th className="num">Margin</th>
                  <th className="num">PnL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((pos) => (
                  <tr key={pos.id}>
                    <td style={{ fontWeight: 600 }}>{pos.symbol}</td>
                    <td className={`badge ${pos.side === 'long' ? 'green' : 'red'}`}>{pos.side}</td>
                    <td className="num mono">{fmtPrice(pos.entryPrice)}</td>
                    <td className="num mono">{fmtPrice(priceOf(pos.symbol))}</td>
                    <td className="num mono">{pos.size.toFixed(5)}</td>
                    <td className="num mono">{fmtUsd(pos.margin)}</td>
                    <td className={`num mono ${pnlClass(pos.unrealizedPnl)}`}>{fmtUsd(pos.unrealizedPnl)}</td>
                    <td>
                      <button
                        className="btn danger sm"
                        onClick={async () => {
                          await api.post(`/positions/${pos.id}/close`)
                          reload()
                          reloadHist()
                        }}
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
                {!data.positions.length && (
                  <tr>
                    <td colSpan={8}>
                      <Empty title="No open positions" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="num">Entry</th>
                  <th className="num">Exit</th>
                  <th className="num">PnL</th>
                  <th>Reason</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {(histData?.positions || []).slice(0, 60).map((pos) => (
                  <tr key={pos.id}>
                    <td style={{ fontWeight: 600 }}>{pos.symbol}</td>
                    <td className={`badge ${pos.side === 'long' ? 'green' : 'red'}`}>{pos.side}</td>
                    <td className="num mono">{fmtPrice(pos.entryPrice)}</td>
                    <td className="num mono">{fmtPrice(pos.closePrice)}</td>
                    <td className={`num mono ${pnlClass(pos.realizedPnl)}`}>{fmtUsd(pos.realizedPnl)}</td>
                    <td>
                      <span className="badge gray">{pos.closeReason || 'manual'}</span>
                    </td>
                    <td className="muted">{fmtTime(pos.closedAt)}</td>
                  </tr>
                ))}
                {!(histData?.positions || []).length && (
                  <tr>
                    <td colSpan={7}>
                      <Empty title="No closed trades yet" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
